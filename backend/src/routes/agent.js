// Assistente da oficina: a pessoa pergunta ou pede por texto/voz; ele responde consultas na hora e, para gravar
// qualquer coisa (incluir conta, dar baixa, criar lembrete), devolve um resumo e só grava depois do "Confirmar".
// Cada ação depende do perfil do assistente do usuário (Configurações › Usuários › Assistente) E da permissão normal.
import { Router } from 'express';
import { z } from 'zod';
import { q, one, tx } from '../db.js';
import { parse, bad, round2, AGENT_ACTIONS, agentAllowed, HttpError } from '../util.js';
import { audit } from '../audit.js';
import { understand, todayIn } from '../agentParse.js';
import { scopeWhere } from './orders.js';

const r = Router();

const brl = (n) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const br = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '—');
const STATUS = { aberta: 'aberta', diagnostico: 'em diagnóstico', aguardando_aprovacao: 'aguardando aprovação', aprovada: 'aprovada',
  aguardando_material: 'aguardando material', em_execucao: 'em execução', pronta: 'pronta', entregue: 'entregue', cancelada: 'cancelada' };

// intenção → ação do perfil do assistente
const NEEDS = {
  resumo: 'consultar_financeiro', caixa: 'consultar_financeiro', listar_contas: 'consultar_financeiro',
  lancar_conta: 'lancar_conta', baixar_conta: 'baixar_conta', lembrete: 'lembretes', listar_lembretes: 'lembretes', consultar_os: 'consultar_os',
};
const EXAMPLES = {
  consultar_financeiro: ['Resumo financeiro', 'Contas a pagar desta semana', 'Contas vencidas', 'Como está o caixa?'],
  lancar_conta: ['Lançar conta a pagar de 350 reais da energia para dia 10', 'Incluir conta a receber de 1.200 reais do João para sexta'],
  baixar_conta: ['Paguei a conta de energia', 'Recebi 300 reais do João'],
  lembretes: ['Me lembre de pagar o IPTU dia 20', 'Meus lembretes'],
  consultar_os: ['Como está a OS 123?'],
};

async function log(req, text, intent, outcome, detail = null) {
  await q('insert into agent_log (company_id, user_id, text, intent, outcome, detail) values ($1,$2,$3,$4,$5,$6)',
    [req.companyId, req.user.id, String(text).slice(0, 500), intent, outcome, detail ? String(detail).slice(0, 500) : null]).catch(() => {});
}
const allowed = (req, key) => agentAllowed(req.user, req.perms, key);

/** O que este usuário pode pedir (para a tela montar as sugestões). */
r.get('/profile', (req, res) => {
  const actions = AGENT_ACTIONS.filter((a) => allowed(req, a.key));
  res.json({ enabled: actions.length > 0, actions: actions.map((a) => ({ key: a.key, label: a.label })),
    examples: actions.flatMap((a) => EXAMPLES[a.key] || []) });
});

// ---------- consultas (respondem na hora) ----------
async function resumo(req) {
  const t = await one(
    `select coalesce(sum(amount) filter (where type='entrada' and paid_at is null),0)::float8 as a_receber,
            coalesce(sum(amount) filter (where type='saida' and paid_at is null),0)::float8 as a_pagar,
            coalesce(sum(amount) filter (where type='entrada' and paid_at is null and due_date < current_date),0)::float8 as receber_vencido,
            coalesce(sum(amount) filter (where type='saida' and paid_at is null and due_date < current_date),0)::float8 as pagar_vencido,
            count(*) filter (where type='saida' and paid_at is null and due_date between current_date and current_date + 7)::int as pagar_semana,
            coalesce(sum(amount) filter (where type='saida' and paid_at is null and due_date between current_date and current_date + 7),0)::float8 as pagar_semana_valor
       from transactions where company_id = $1 and category <> 'Transferência entre contas'`, [req.companyId]);
  const s = await one("select id from cash_sessions where company_id = $1 and closed_at is null limit 1", [req.companyId]);
  const lines = [
    `A receber: ${brl(t.a_receber)}${t.receber_vencido ? ` (${brl(t.receber_vencido)} vencido)` : ''}.`,
    `A pagar: ${brl(t.a_pagar)}${t.pagar_vencido ? ` (${brl(t.pagar_vencido)} vencido)` : ''}.`,
    t.pagar_semana ? `Nos próximos 7 dias vencem ${t.pagar_semana} conta(s) a pagar, somando ${brl(t.pagar_semana_valor)}.` : 'Nenhuma conta a pagar vence nos próximos 7 dias.',
    `Saldo previsto: ${brl(t.a_receber - t.a_pagar)}.`,
    s ? 'O caixa está aberto.' : 'O caixa está fechado.',
  ];
  return { text: lines.join(' '), link: '/financeiro/receber' };
}

async function caixa(req) {
  const s = await one(
    `select cs.*, u.name as opened_by_name from cash_sessions cs left join users u on u.id = cs.opened_by
      where cs.company_id = $1 and cs.closed_at is null limit 1`, [req.companyId]);
  if (!s) {
    const last = await one('select closed_at, closing_amount, expected_amount from cash_sessions where company_id = $1 and closed_at is not null order by closed_at desc limit 1', [req.companyId]);
    return { text: `O caixa está fechado.${last ? ` Último fechamento em ${br(last.closed_at.toISOString())}, contado ${brl(last.closing_amount)} (diferença ${brl(last.closing_amount - last.expected_amount)}).` : ''}`, link: '/financeiro/caixa' };
  }
  const m = await one(
    `select coalesce(sum(amount) filter (where type='entrada'),0)::float8 as entradas, coalesce(sum(amount) filter (where type='saida'),0)::float8 as saidas,
            coalesce(sum(amount) filter (where type='entrada' and method='dinheiro'),0)::float8 as din_in,
            coalesce(sum(amount) filter (where type='saida' and method='dinheiro'),0)::float8 as din_out
       from transactions where cash_session_id = $1 and paid_at is not null`, [s.id]);
  const expected = round2(Number(s.opening_amount) + m.din_in - m.din_out);
  return { text: `Caixa aberto por ${s.opened_by_name || '—'}. Entradas ${brl(m.entradas)}, saídas ${brl(m.saidas)}. Dinheiro esperado na gaveta: ${brl(expected)}.`, link: '/financeiro/caixa' };
}

async function listarContas(req, { type, period }) {
  const p = [req.companyId];
  let w = "company_id = $1 and paid_at is null and category <> 'Transferência entre contas'";
  if (type) { p.push(type); w += ` and type = $${p.length}`; }
  if (period.from) { p.push(period.from); w += ` and due_date >= $${p.length}`; }
  if (period.to) { p.push(period.to); w += ` and due_date <= $${p.length}`; }
  const { rows } = await q(`select id, type, description, category, amount::float8, due_date::text from transactions where ${w} order by due_date nulls last, amount desc limit 200`, p);
  const what = type === 'saida' ? 'contas a pagar' : type === 'entrada' ? 'contas a receber' : 'contas';
  if (!rows.length) return { text: `Nenhuma ${what.replace(/s$/, '').replace('contas', 'conta')} ${period.label}.`, link: type === 'entrada' ? '/financeiro/receber' : '/financeiro/pagar' };
  const total = rows.reduce((a, x) => a + x.amount, 0);
  return {
    text: `${rows.length} ${what} ${period.label}, somando ${brl(total)}.${rows.length > 10 ? ' As 10 primeiras:' : ''}`,
    items: rows.slice(0, 10).map((x) => ({ id: x.id, title: x.description || x.category, detail: `${x.type === 'entrada' ? 'Receber' : 'Pagar'} · vence ${br(x.due_date)}`, value: brl(x.amount), tone: x.type })),
    link: type === 'entrada' ? '/financeiro/receber' : '/financeiro/pagar',
  };
}

async function listarLembretes(req) {
  const { rows } = await q(
    `select id, title, due_date::text, amount::float8 from finance_reminders where company_id = $1 and done_at is null
      and (assigned_to is null or assigned_to = $2) order by due_date limit 20`, [req.companyId, req.user.id]);
  if (!rows.length) return { text: 'Você não tem lembretes pendentes.', link: '/financeiro/alertas' };
  return { text: `${rows.length} lembrete(s) pendente(s):`, link: '/financeiro/alertas',
    items: rows.map((x) => ({ id: x.id, title: x.title, detail: `dia ${br(x.due_date)}`, value: x.amount ? brl(x.amount) : '' })) };
}

async function consultarOs(req, { number }) {
  const params = [req.companyId, number];
  const scope = scopeWhere(req, params);
  const o = await one(
    `select o.id, o.number, o.status, o.total::float8, o.promised_at, c.name as customer_name, e.description as equipment, e.plate
       from orders o left join customers c on c.id = o.customer_id left join equipment e on e.id = o.equipment_id
      where o.company_id = $1 and o.number = $2 and o.kind = 'os'${scope}`, params);
  if (!o) return { text: `Não encontrei a OS ${number} (ou você não tem acesso a ela).` };
  const values = req.perms.orders_values === true;
  return { text: `OS ${o.number} de ${o.customer_name || 'cliente não informado'}${o.plate ? ` (placa ${o.plate})` : o.equipment ? ` (${o.equipment})` : ''}: ${STATUS[o.status] || o.status}.`
      + `${o.promised_at ? ` Prazo: ${br(o.promised_at.toISOString())}.` : ''}${values ? ` Total ${brl(o.total)}.` : ''}`, link: `/os/${o.id}` };
}

// ---------- pedidos que gravam: primeiro um resumo para confirmar ----------
const confirmCard = (intent, params, summary, fields = []) => ({ kind: 'confirm', intent, params, summary, fields });

async function prepareBaixa(req, { type, amount, term }) {
  const p = [req.companyId, type];
  let w = "t.company_id = $1 and t.type = $2 and t.paid_at is null and t.transfer_id is null and t.category <> 'Transferência entre contas'";
  if (amount) { p.push(amount); w += ` and t.amount = $${p.length}`; }
  if (term) {
    p.push(`%${term.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')}%`);
    w += ` and (translate(lower(coalesce(t.description,'') || ' ' || t.category || ' ' || coalesce(c.name,'') || ' ' || coalesce(s.name,'')),
      'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc') like $${p.length})`;
  }
  const { rows } = await q(
    `select t.id, t.description, t.category, t.amount::float8, t.due_date::text, c.name as customer_name, s.name as supplier_name
       from transactions t left join customers c on c.id = t.customer_id left join suppliers s on s.id = t.supplier_id
      where ${w} order by t.due_date nulls last limit 6`, p);
  const what = type === 'entrada' ? 'conta a receber' : 'conta a pagar';
  if (!rows.length) return { kind: 'answer', text: `Não encontrei ${what} em aberto${term ? ` com "${term}"` : ''}${amount ? ` de ${brl(amount)}` : ''}.`, link: type === 'entrada' ? '/financeiro/receber' : '/financeiro/pagar' };
  const label = (x) => `${x.description || x.category}${x.customer_name || x.supplier_name ? ` · ${x.customer_name || x.supplier_name}` : ''}`;
  if (rows.length === 1) {
    const x = rows[0];
    return confirmCard('baixar_conta', { transaction_id: x.id }, `Dar baixa (${type === 'entrada' ? 'recebido' : 'pago'} hoje) em: ${label(x)}, ${brl(x.amount)}, vencimento ${br(x.due_date)}.`);
  }
  return { kind: 'choose', text: `Encontrei ${rows.length} contas. Qual delas?`,
    options: rows.map((x) => confirmCard('baixar_conta', { transaction_id: x.id }, `Dar baixa em: ${label(x)}, ${brl(x.amount)}, vencimento ${br(x.due_date)}.`)) };
}

r.post('/ask', async (req, res) => {
  const { text } = parse(z.object({ text: z.string().trim().min(1, 'escreva o que precisa').max(500) }), req.body);
  if (!AGENT_ACTIONS.some((a) => allowed(req, a.key))) {
    await log(req, text, 'bloqueado', 'negado');
    throw new HttpError(403, 'O assistente não está liberado para o seu usuário. Peça ao administrador em Configurações › Usuários.');
  }
  const today = todayIn(req.settings.timezone);
  const u = understand(text, { today, settings: req.settings });
  const need = NEEDS[u.intent];
  if (u.intent === 'ajuda' || u.intent === 'desconhecido') {
    const ex = AGENT_ACTIONS.filter((a) => allowed(req, a.key)).flatMap((a) => EXAMPLES[a.key] || []);
    await log(req, text, u.intent, u.intent === 'ajuda' ? 'respondido' : 'nao_entendido');
    return res.json({ kind: 'answer', intent: u.intent,
      text: u.intent === 'ajuda' ? 'Posso ajudar com isto (é só escrever ou falar):' : 'Não entendi. Tente de um destes jeitos:', examples: ex });
  }
  if (!allowed(req, need)) {
    await log(req, text, u.intent, 'negado');
    const label = AGENT_ACTIONS.find((a) => a.key === need)?.label || need;
    return res.json({ kind: 'denied', intent: u.intent, text: `Seu usuário não tem liberação para isto no assistente (${label.toLowerCase()}). Fale com o administrador.` });
  }
  let out;
  switch (u.intent) {
    case 'resumo': out = { kind: 'answer', ...(await resumo(req)) }; break;
    case 'caixa': out = { kind: 'answer', ...(await caixa(req)) }; break;
    case 'listar_contas': out = { kind: 'answer', ...(await listarContas(req, u.params)) }; break;
    case 'listar_lembretes': out = { kind: 'answer', ...(await listarLembretes(req)) }; break;
    case 'consultar_os': out = { kind: 'answer', ...(await consultarOs(req, u.params)) }; break;
    case 'lancar_conta': {
      const pm = u.params;
      if (u.missing?.length) { out = { kind: 'answer', text: `Para incluir a conta, falta ${u.missing.join(' e ')}. Ex.: "Lançar conta a pagar de 350 reais da energia para dia 10".` }; break; }
      out = confirmCard('lancar_conta', pm,
        `Incluir conta a ${pm.type === 'saida' ? 'PAGAR' : 'RECEBER'}: ${pm.description}, ${brl(pm.amount)}, vencimento ${br(pm.due_date)}${pm.has_date ? '' : ' (hoje — não ouvi a data)'}, categoria ${pm.category}.`,
        ['description', 'amount', 'due_date']);
      break;
    }
    case 'baixar_conta': out = await prepareBaixa(req, u.params); break;
    case 'lembrete': {
      const pm = u.params;
      out = confirmCard('lembrete', pm, `Criar lembrete: "${pm.title}" para ${br(pm.due_date)}${pm.has_date ? '' : ' (hoje — não ouvi a data)'}${pm.amount ? `, valor ${brl(pm.amount)}` : ''}.`, ['title', 'due_date']);
      break;
    }
    default: out = { kind: 'answer', text: 'Não entendi.' };
  }
  await log(req, text, u.intent, out.kind === 'confirm' || out.kind === 'choose' ? 'aguardando' : 'respondido', out.summary || out.text);
  res.json({ intent: u.intent, ...out });
});

// ---------- confirmação: valida de novo e grava ----------
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data inválida');
const SCHEMAS = {
  lancar_conta: z.object({
    type: z.enum(['entrada', 'saida']), amount: z.coerce.number().positive('valor deve ser maior que zero').max(10_000_000),
    due_date: ymd, description: z.string().trim().min(2, 'descreva a conta').max(200), category: z.string().trim().min(1).max(80),
  }),
  baixar_conta: z.object({ transaction_id: z.string().uuid() }),
  lembrete: z.object({ title: z.string().trim().min(2, 'escreva o lembrete').max(200), due_date: ymd, amount: z.coerce.number().positive().nullable().optional() }),
};

r.post('/confirm', async (req, res) => {
  const { intent, params, text } = parse(z.object({ intent: z.enum(Object.keys(SCHEMAS)), params: z.record(z.any()), text: z.string().max(500).optional() }), req.body);
  if (!allowed(req, NEEDS[intent])) {
    await log(req, text || intent, intent, 'negado');
    throw new HttpError(403, 'Seu usuário não tem liberação para isto no assistente.');
  }
  const d = parse(SCHEMAS[intent], params);
  let result;
  if (intent === 'lancar_conta') {
    const cats = (d.type === 'entrada' ? req.settings.incomeCategories : req.settings.expenseCategories) || [];
    const category = cats.includes(d.category) ? d.category : (d.type === 'entrada' ? 'Outras receitas' : 'Outras despesas');
    const t = await one(
      `insert into transactions (company_id, type, category, description, amount, due_date, created_by)
       values ($1,$2,$3,$4,$5,$6,$7) returning id, type, description, amount::float8, due_date::text`,
      [req.companyId, d.type, category, d.description, d.amount, d.due_date, req.user.id]);
    await audit(null, req, { entity: 'transaction', entityId: t.id, action: 'create',
      summary: `Assistente: conta a ${d.type === 'saida' ? 'pagar' : 'receber'} "${d.description}" de ${brl(d.amount)} para ${br(d.due_date)}` });
    result = { text: `Pronto: conta a ${d.type === 'saida' ? 'pagar' : 'receber'} "${d.description}" de ${brl(d.amount)} incluída para ${br(d.due_date)}.`, link: d.type === 'saida' ? '/financeiro/pagar' : '/financeiro/receber' };
  } else if (intent === 'baixar_conta') {
    const t = await tx(async (db) => {
      const { rows: [session] } = await db.query('select id from cash_sessions where company_id = $1 and closed_at is null limit 1', [req.companyId]);
      const { rows: [x] } = await db.query(
        `update transactions set paid_at = now(), method = case when method = 'fiado' then null else method end, cash_session_id = $3
          where id = $1 and company_id = $2 and paid_at is null and transfer_id is null returning id, type, description, category, amount::float8`,
        [d.transaction_id, req.companyId, session?.id || null]);
      if (!x) throw bad('Esta conta não foi encontrada ou já foi baixada.');
      return x;
    });
    await audit(null, req, { entity: 'transaction', entityId: t.id, action: 'pay',
      summary: `Assistente: baixa em "${t.description || t.category}" (${brl(t.amount)})` });
    result = { text: `Pronto: "${t.description || t.category}" (${brl(t.amount)}) marcada como ${t.type === 'entrada' ? 'recebida' : 'paga'} hoje.`, link: t.type === 'entrada' ? '/financeiro/receber' : '/financeiro/pagar' };
  } else {
    const x = await one(
      `insert into finance_reminders (company_id, title, due_date, amount, source, created_by, assigned_to)
       values ($1,$2,$3,$4,'assistente',$5,$5) returning id`, [req.companyId, d.title, d.due_date, d.amount || null, req.user.id]);
    await audit(null, req, { entity: 'reminder', entityId: x.id, action: 'create', summary: `Assistente: lembrete "${d.title}" para ${br(d.due_date)}` });
    result = { text: `Pronto: vou te lembrar de "${d.title}" em ${br(d.due_date)}. O aviso aparece no sino.`, link: '/financeiro/alertas' };
  }
  await log(req, text || intent, intent, 'confirmado', result.text);
  res.json({ kind: 'done', ...result });
});

r.post('/cancel', async (req, res) => {
  const { intent, text } = parse(z.object({ intent: z.string().max(40), text: z.string().max(500).optional() }), req.body);
  await log(req, text || intent, intent, 'cancelado');
  res.status(204).end();
});

/** Histórico das interações (o próprio usuário; quem gerencia usuários vê todos). */
r.get('/log', async (req, res) => {
  const all = req.perms.users === true && req.query.all === '1';
  const { rows } = await q(
    `select l.id, l.text, l.intent, l.outcome, l.detail, l.created_at, u.name as user_name from agent_log l left join users u on u.id = l.user_id
      where l.company_id = $1 ${all ? '' : 'and l.user_id = $2'} order by l.created_at desc limit 100`, all ? [req.companyId] : [req.companyId, req.user.id]);
  res.json(rows);
});

export default r;
