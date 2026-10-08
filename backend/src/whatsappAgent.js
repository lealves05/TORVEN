// Agente de atendimento do WhatsApp: consulta de OS pela placa, pedido de serviço (pré-OS) e pedido de horário.
// Regras de segurança:
//  - Pedidos viram SOLICITAÇÃO (pré-OS) aguardando aprovação da equipe; o agente não abre OS nem marca agenda sozinho.
//  - Detalhes da OS só para o telefone do cliente dono do veículo; para outros números, só que existe serviço.
//  - Respostas montadas com dados reais do banco; a IA (opcional) só entende o texto.
import { q, tx } from './db.js';
import { withDefaults, zonedToUtc, utcToZoned, weekdayOf } from './util.js';
import { nextNumber, STATUS_LABEL } from './domain.js';
import { audit } from './audit.js';
import { addEvent } from './routes/requests.js';
import { normalizePlate, formatPlate } from './integrations/plates.js';
import { normalizePhone, samePhone } from './integrations/whatsapp.js';
import { understand } from './integrations/ai.js';
import { loadIntegration } from './integrations/store.js';
import { hit } from './security.js';

export const AGENT_DEFAULTS = {
  agent_enabled: true, hours_start: '08:00', hours_end: '18:00', work_days: '1,2,3,4,5', slot_minutes: 60,
  greeting: '', ai_enabled: false, site_url: '',
};
export const agentConfig = (cfg) => ({ ...AGENT_DEFAULTS, ...Object.fromEntries(Object.entries(cfg || {}).filter(([, v]) => v !== null && v !== '')) });

const WD = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const strip = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const brMoney = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const brDate = (ymd) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
const addDays = (ymd, n) => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// ---------------- leitura do texto (sem IA) ----------------
export function findPlate(text) {
  const t = String(text || '').toUpperCase();
  const m = t.match(/\b([A-Z]{3})[\s-]?(\d[A-Z0-9]\d{2})\b/);
  return m ? normalizePlate(m[1] + m[2]) : null;
}

export function findDate(text, today) {
  const t = strip(text);
  if (/\bdepois de amanha\b/.test(t)) return addDays(today, 2);
  if (/\bamanha\b/.test(t)) return addDays(today, 1);
  if (/\bhoje\b/.test(t)) return today;
  const m = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (m) {
    let y = m[3] ? Number(m[3]) : Number(today.slice(0, 4));
    if (y < 100) y += 2000;
    const ymd = `${y}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
    const real = (v) => { const dt = new Date(`${v}T12:00:00Z`); return !Number.isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === v; };
    if (real(ymd)) {
      if (m[3] || ymd >= today) return ymd;
      const next = `${y + 1}${ymd.slice(4)}`;
      return real(next) ? next : null;
    }
  }
  const names = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
  for (let i = 0; i < 7; i += 1) {
    if (new RegExp(`\\b${names[i]}`).test(t) || new RegExp(`\\b${names[i].slice(0, 3)}\\b`).test(t)) {
      const cur = weekdayOf(today);
      const diff = ((i - cur + 7) % 7) || 7;
      return addDays(today, diff);
    }
  }
  return null;
}

export function findTime(text) {
  const t = strip(text);
  let m = t.match(/\b(\d{1,2}):(\d{2})\b/) || t.match(/\b(\d{1,2})\s*h\s*(\d{2})?\b/) || t.match(/\bas\s+(\d{1,2})(?::(\d{2}))?\b/);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2] || 0);
  if (h > 23 || mi > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

export function findIntent(text) {
  const t = strip(text);
  if (/\b(atendente|humano|pessoa|falar com)\b/.test(t)) return 'atendente';
  if (/\b(cancelar|desistir|sair)\b/.test(t)) return 'cancelar';
  if (/(status|como esta|andamento|ficou pronto|esta pronto|situacao|minha os|meu carro esta|consultar)/.test(t)) return 'status';
  if (/(agend|marcar|horario|levar o|trazer o|que horas|vaga)/.test(t)) return 'agendar';
  if (/(orcament|servico|consert|problema|abrir os|solda|reparo|defeito|barulho|quebr|vazament|revis)/.test(t)) return 'abrir_os';
  if (/^(oi|ola|bom dia|boa tarde|boa noite|e ai|opa|menu|inicio)\b/.test(t)) return 'saudacao';
  return null;
}

// ---------------- agenda: horários livres ----------------
/** Capacidade (técnicos ativos) e compromissos/pedidos do período — numa ida ao banco. */
async function loadBusy(companyId, from, to) {
  const { rows: [r] } = await q(
    `select greatest(1, (select count(*) from technicians where company_id = $1 and active))::int as cap,
            coalesce((select json_agg(json_build_array(extract(epoch from starts_at) * 1000, extract(epoch from ends_at) * 1000))
                        from schedule_entries where company_id = $1 and status in ('agendado','em_andamento') and starts_at < $3 and ends_at > $2), '[]') as entries,
            coalesce((select json_agg(extract(epoch from requested_start) * 1000)
                        from service_requests where company_id = $1 and status = 'nova' and requested_start is not null
                         and requested_start < $3 and requested_start > $2::timestamptz - interval '1 day'), '[]') as requests`,
    [companyId, from, to]);
  return { cap: r.cap, busy: [...r.entries.map(([s0, e0]) => [Number(s0), Number(e0)]), ...r.requests.map((s0) => [Number(s0), Number(s0) + 3600000])] };
}

function withinHours(cfg, ymd, hm) {
  const days = String(cfg.work_days).split(',').map(Number);
  if (!days.includes(weekdayOf(ymd))) return false;
  return hm >= cfg.hours_start && hm < cfg.hours_end;
}

function freeIn(load, start, minutes) {
  const s0 = start.getTime();
  const e0 = s0 + minutes * 60000;
  return load.busy.filter(([a, b]) => a < e0 && b > s0).length < load.cap;
}

export async function slotFree(companyId, cfg, tz, ymd, hm, load = null) {
  if (!withinHours(cfg, ymd, hm)) return { ok: false, why: 'fora' };
  const start = zonedToUtc(ymd, hm, tz);
  if (start.getTime() < Date.now() + 30 * 60000) return { ok: false, why: 'passado' };
  const minutes = Number(cfg.slot_minutes) || 60;
  const l = load || await loadBusy(companyId, start, new Date(start.getTime() + minutes * 60000));
  return freeIn(l, start, minutes) ? { ok: true, start } : { ok: false, why: 'ocupado' };
}

export async function suggestSlots(companyId, cfg, tz, fromYmd, n = 3) {
  const out = [];
  const step = Math.max(30, Number(cfg.slot_minutes) || 60);
  const [hs, ms] = cfg.hours_start.split(':').map(Number);
  const [he, me] = cfg.hours_end.split(':').map(Number);
  const load = await loadBusy(companyId, zonedToUtc(fromYmd, '00:00', tz), zonedToUtc(addDays(fromYmd, 15), '00:00', tz));
  for (let d = 0; d < 14 && out.length < n; d += 1) {
    const ymd = addDays(fromYmd, d);
    for (let m = hs * 60 + ms; m + step <= he * 60 + me && out.length < n; m += step) {
      const hm = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      if ((await slotFree(companyId, cfg, tz, ymd, hm, load)).ok) { out.push({ date: ymd, time: hm }); break; } // um por dia, para variar
    }
  }
  return out;
}
const slotText = (s, today = null) => {
  const rel = today && s.date === today ? 'hoje, ' : today && s.date === addDays(today, 1) ? 'amanhã, ' : '';
  return `${rel}${WD[weekdayOf(s.date)]} ${brDate(s.date)} às ${s.time}`;
};

// ---------------- dados ----------------
async function findCustomerByPhone(companyId, phone) {
  const tail = normalizePhone(phone).slice(-8);
  if (tail.length < 8) return null;
  const { rows } = await q(
    `select id, name, phone, phone2 from customers where company_id = $1 and active is not false
        and (right(regexp_replace(coalesce(phone,''), '\\D', '', 'g'), 8) = $2 or right(regexp_replace(coalesce(phone2,''), '\\D', '', 'g'), 8) = $2)
      limit 5`, [companyId, tail]);
  const hits = rows.filter((c) => samePhone(c.phone, phone) || samePhone(c.phone2, phone));
  return hits.length === 1 ? hits[0] : null;
}

async function vehicleByPlate(companyId, plate) {
  const { rows } = await q(
    `select e.id, e.customer_id, e.description, e.brand, e.model, c.name as customer_name, c.phone, c.phone2
       from equipment e join customers c on c.id = e.customer_id
      where e.company_id = $1 and e.active is not false and upper(regexp_replace(coalesce(e.plate,''), '[^A-Za-z0-9]', '', 'g')) = $2
      order by e.created_at desc limit 5`, [companyId, plate]);
  return rows;
}

async function statusReply(conv, company, cfg, plate) {
  const cars = await vehicleByPlate(conv.company_id, plate);
  if (!cars.length) return [`Não encontrei veículo com a placa ${formatPlate(plate)} no nosso cadastro. Confira a placa ou digite *4* para falar com um atendente.`];
  const { rows: orders } = await q(
    `select o.id, o.number, o.status, o.promised_at, o.total, o.public_token, o.customer_id, o.updated_at
       from orders o where o.company_id = $1 and o.equipment_id = any($2::uuid[]) and o.kind = 'os' and o.status <> 'cancelada'
         and (o.status <> 'entregue' or o.delivered_at > now() - interval '30 days')
      order by o.created_at desc limit 3`, [conv.company_id, cars.map((c) => c.id)]);
  if (!orders.length) return [`Não há serviço em aberto para a placa ${formatPlate(plate)}. Quer agendar um? Digite *2*.`];
  const owner = cars.find((c) => c.customer_id === conv.customer_id || samePhone(c.phone, conv.phone) || samePhone(c.phone2, conv.phone));
  if (!owner) {
    return [`Encontrei ${orders.length === 1 ? '1 serviço' : `${orders.length} serviços`} para a placa ${formatPlate(plate)}. `
      + 'Por segurança, os detalhes só são informados ao telefone cadastrado do cliente. Digite *4* para falar com um atendente.'];
  }
  const tz = withDefaults(company.settings).timezone;
  const lines = orders.filter((o) => o.customer_id === owner.customer_id).map((o) => {
    const prev = o.promised_at && !['entregue', 'pronta'].includes(o.status) ? ` · previsão ${brDate(utcToZoned(new Date(o.promised_at), tz).date)}` : '';
    const link = cfg.site_url && o.public_token ? `\nAcompanhe: ${cfg.site_url.replace(/\/$/, '')}/p/os/${o.public_token}` : '';
    return `*OS nº ${o.number}* — ${STATUS_LABEL[o.status] || o.status}${prev}${o.status === 'pronta' ? ' ✅ pode retirar' : ''}${Number(o.total) ? ` · total ${brMoney(o.total)}` : ''}${link}`;
  });
  return [`Placa ${formatPlate(plate)} (${[owner.brand, owner.model].filter(Boolean).join(' ') || owner.description}):\n${lines.join('\n')}`,
    'Precisa de mais alguma coisa? Digite *menu* para ver as opções.'];
}

// ---------------- conversa ----------------
const menuText = (company, cfg, name) => [
  `${cfg.greeting || `Olá${name ? `, ${name.split(' ')[0]}` : ''}! Aqui é o atendimento automático da *${company.trade_name || company.name}*.`}\n`
  + 'Digite o número da opção:\n*1* - Saber como está meu serviço (pela placa)\n*2* - Agendar um horário\n*3* - Pedir um serviço ou orçamento\n*4* - Falar com um atendente',
];

async function createRequest(conv, company, ctx, cfg) {
  const tz = withDefaults(company.settings).timezone;
  return tx(async (db) => {
    const number = await nextNumber(db, 'service_requests', conv.company_id);
    let equipmentId = null;
    if (ctx.plate && conv.customer_id) {
      const { rows: [e] } = await db.query(
        `select id from equipment where company_id = $1 and customer_id = $2 and upper(regexp_replace(coalesce(plate,''), '[^A-Za-z0-9]', '', 'g')) = $3 limit 1`,
        [conv.company_id, conv.customer_id, ctx.plate]);
      equipmentId = e?.id || null;
    }
    const start = ctx.date && ctx.time ? zonedToUtc(ctx.date, ctx.time, tz) : null;
    const title = `${ctx.kind === 'agendar' ? 'Agendamento' : 'Pedido'} pelo WhatsApp: ${ctx.problem || 'serviço'}`.slice(0, 140);
    const desc = [ctx.problem && `Relato do cliente: ${ctx.problem}`, ctx.plate && `Placa: ${formatPlate(ctx.plate)}`,
      start && `Horário pedido: ${slotText({ date: ctx.date, time: ctx.time })}`, 'Recebido pelo agente do WhatsApp — confirme antes de abrir a OS.'].filter(Boolean).join('\n');
    const { rows: [unit] } = await db.query('select id from units where company_id = $1 and is_default', [conv.company_id]);
    const { rows: [x] } = await db.query(
      `insert into service_requests (company_id, number, unit_id, customer_id, contact_name, contact_phone, channel, equipment_id, title,
              description, desired_date, requested_start, plate, conversation_id, priority)
       values ($1,$2,$3,$4,$5,$6,'whatsapp',$7,$8,$9,$10,$11,$12,$13,'normal') returning id, number`,
      [conv.company_id, number, unit?.id || null, conv.customer_id || null, ctx.name || conv.name || null, `+${conv.phone}`, equipmentId,
        title, desc, ctx.date || null, start, ctx.plate ? formatPlate(ctx.plate) : null, conv.id]);
    await addEvent(db, x.id, null, { to: 'nova', message: 'Pedido recebido pelo agente do WhatsApp — aguardando aprovação' });
    await audit(db, { companyId: conv.company_id, user: { name: 'Agente WhatsApp' } }, { entity: 'request', entityId: x.id, action: 'create', summary: `Solicitação nº ${x.number} recebida pelo WhatsApp: ${title}` });
    return x;
  });
}

/**
 * Decide as respostas do agente para uma mensagem recebida.
 * @returns {Promise<{replies: string[], state: string, context: object, mode?: string, requestId?: string}>}
 */
export async function agentReply(conv, company, cfg, aiCfg, text) {
  const tz = withDefaults(company.settings).timezone;
  const today = utcToZoned(new Date(), tz).date;
  const ctx = { ...(conv.context || {}) };
  const t = String(text || '').trim();
  const low = strip(t);
  let state = conv.state || 'inicio';
  const out = (replies, s = state, extra = {}) => ({ replies, state: s, context: s === 'inicio' || s === 'menu' ? {} : ctx, ...extra });

  // entende a frase: primeiro pelas regras; a IA completa o que faltar
  let ai = null;
  const needsAi = cfg.ai_enabled && aiCfg?.enabled && t.length > 3 && !/^\d$/.test(t);
  const intentRule = findIntent(t);
  if (needsAi && (!intentRule || ['inicio', 'menu', 'fim'].includes(state) || (state === 'pede_horario' && !findDate(t, today)))) {
    // limite de chamadas pagas por conversa por dia
    if (!(await hit(`wa-ai:${conv.id}`, 40, 86400)).blocked) ai = await understand(aiCfg.config, aiCfg.secrets, t, `${today} (${WD[weekdayOf(today)]})`);
  }
  const plate = findPlate(t) || normalizePlate(ai?.plate || '');
  const date = findDate(t, today) || ai?.date || null;
  const time = findTime(t) || ai?.time || null;
  let intent = intentRule || ai?.intent || null;

  if (low === 'menu' || low === '0' || intent === 'cancelar') return out(menuText(company, cfg, conv.name), 'menu');
  if (intent === 'atendente' || (['menu', 'inicio', 'fim'].includes(state) && low === '4')) {
    return out(['Certo! Já avisei a equipe. Um atendente vai responder por aqui assim que possível. 👍'], 'inicio', { mode: 'humano' });
  }
  if (['menu', 'inicio', 'fim'].includes(state)) {
    if (low === '1') intent = 'status';
    else if (low === '2') intent = 'agendar';
    else if (low === '3') intent = 'abrir_os';
    if (!intent || intent === 'saudacao' || intent === 'outro') {
      return out(state === 'menu' && intent !== 'saudacao' ? ['Não entendi. 🙂 Responda só com o número da opção (1, 2, 3 ou 4).', ...menuText(company, cfg, conv.name)]
        : menuText(company, cfg, conv.name), 'menu');
    }
    Object.keys(ctx).forEach((k) => delete ctx[k]);
    ctx.kind = intent;
  }
  // dados que vierem na mesma frase já ficam guardados
  if (plate) ctx.plate = plate;
  if (ai?.problem && !ctx.problem && ctx.kind !== 'status') ctx.problem = ai.problem;
  if (ai?.name && !ctx.name) ctx.name = ai.name;

  // ---- consulta pela placa ----
  if (ctx.kind === 'status') {
    if (!ctx.plate) {
      if (state === 'pede_placa' && t) return out(['Não reconheci a placa. Envie só as letras e números, por exemplo *ABC1D23* ou *ABC-1234*.'], 'pede_placa');
      return out(['Me envie a *placa* do veículo, por exemplo ABC1D23.'], 'pede_placa');
    }
    return out(await statusReply(conv, company, cfg, ctx.plate), 'fim');
  }

  // ---- pedido de serviço / agendamento ----
  if (state === 'pede_placa' && !ctx.plate && /^(nao|n|sem placa|nao tenho)/.test(low)) ctx.plate = '-';
  if (!ctx.plate) {
    if (state === 'pede_placa' && t) return out(['Não reconheci a placa. Envie, por exemplo, *ABC1D23*. Se não for veículo, responda *não tenho*.'], 'pede_placa');
    return out(['Para começar, qual é a *placa* do veículo? (ex.: ABC1D23). Se não for veículo, responda *não tenho*.'], 'pede_placa');
  }
  if (!ctx.problem) {
    if (state === 'pede_problema' && t.length >= 3) ctx.problem = t.slice(0, 300);
    else return out(['Conte em poucas palavras *o que precisa ser feito* ou qual é o problema.'], 'pede_problema');
  }
  if (ctx.kind === 'agendar' && !(ctx.date && ctx.time)) {
    if (state === 'pede_horario' && /^[1-3]$/.test(low) && ctx.slots?.[Number(low) - 1]) {
      const s = ctx.slots[Number(low) - 1];
      ctx.date = s.date; ctx.time = s.time;
    } else {
      if (date) ctx.date = date;
      if (time) ctx.time = time;
      if (ctx.date && ctx.time) {
        const ok = await slotFree(conv.company_id, cfg, tz, ctx.date, ctx.time);
        if (!ok.ok) {
          const why = ok.why === 'fora' ? `Atendemos de ${cfg.hours_start} às ${cfg.hours_end}` + `, ${String(cfg.work_days) === '1,2,3,4,5' ? 'de segunda a sexta' : 'nos dias de funcionamento'}.`
            : ok.why === 'passado' ? 'Esse horário já passou ou está muito em cima.' : 'Esse horário já está ocupado.';
          ctx.date = null; ctx.time = null;
          ctx.slots = await suggestSlots(conv.company_id, cfg, tz, today);
          return out([`${why} Escolha um destes horários livres:\n${ctx.slots.map((s, i) => `*${i + 1}* - ${slotText(s, today)}`).join('\n')}\nOu escreva outro dia e hora (ex.: *sexta às 14h*).`], 'pede_horario');
        }
      } else {
        ctx.slots = await suggestSlots(conv.company_id, cfg, tz, ctx.date || today);
        const ask = ctx.date && !ctx.time ? `Qual horário em ${brDate(ctx.date)}? ` : '';
        return out([`${ask}Estes horários estão livres:\n${ctx.slots.map((s, i) => `*${i + 1}* - ${slotText(s, today)}`).join('\n')}\nResponda com o número ou escreva o dia e a hora (ex.: *amanhã às 9h*).`], 'pede_horario');
      }
    }
  }
  if (!conv.customer_id && !ctx.name) {
    if (state === 'pede_nome' && t.length >= 2) ctx.name = t.slice(0, 80);
    else return out(['Qual é o seu *nome completo*?'], 'pede_nome');
  }
  if (state !== 'confirma') {
    const resumo = [`*Confira o pedido:*`, ctx.plate !== '-' && `Placa: ${formatPlate(ctx.plate)}`, `Serviço: ${ctx.problem}`,
      ctx.date && ctx.time && `Horário: ${slotText({ date: ctx.date, time: ctx.time }, today)}`, !conv.customer_id && `Nome: ${ctx.name}`].filter(Boolean).join('\n');
    return out([`${resumo}\n\nEstá certo? Responda *1* para confirmar ou *2* para corrigir.`], 'confirma');
  }
  if (low === '2' || /^(nao|corrigir|errado)/.test(low)) {
    Object.keys(ctx).forEach((k) => { if (k !== 'kind') delete ctx[k]; });
    return out(['Sem problema, vamos de novo. Qual é a *placa* do veículo?'], 'pede_placa');
  }
  if (!(low === '1' || /^(sim|s|ok|isso|confirmo|confirmar|pode)/.test(low))) return out(['Responda *1* para confirmar ou *2* para corrigir.'], 'confirma');
  if (ctx.plate === '-') ctx.plate = null;
  const x = await createRequest(conv, company, ctx, cfg);
  const when = ctx.date && ctx.time ? ` para *${slotText({ date: ctx.date, time: ctx.time }, today)}*` : '';
  return out([`Pronto! Seu pedido nº *${x.number}*${when} foi registrado. ✅\nA equipe vai conferir e *confirmar por aqui*. Se precisar, digite *menu*.`], 'fim', { requestId: x.id });
}

// ---------------- entrada de mensagens ----------------
/** Conversa da empresa com o telefone (cria na primeira mensagem e já liga ao cliente pelo telefone). */
export async function upsertConversation(companyId, phone, name) {
  const p = normalizePhone(phone);
  // mensagem real de um telefone usado antes num teste: a conversa de teste é descartada (nada dela é real)
  await q('delete from wa_conversations where company_id = $1 and phone = $2 and simulated', [companyId, p]);
  const { rows: [c] } = await q(
    `insert into wa_conversations (company_id, phone, name) values ($1,$2,$3)
     on conflict (company_id, phone) do update set name = coalesce(wa_conversations.name, excluded.name)
     returning *`, [companyId, p, name || null]);
  if (!c.customer_id) {
    const cust = await findCustomerByPhone(companyId, p);
    if (cust) {
      await q('update wa_conversations set customer_id = $2, name = coalesce(name, $3) where id = $1', [c.id, cust.id, cust.name]);
      c.customer_id = cust.id;
      c.name = c.name || cust.name;
    }
  }
  return c;
}

export async function saveMessage(conv, { direction, author, body, waId = null, status = 'ok', error = null, userId = null }) {
  const { rows: [m] } = await q(
    `insert into wa_messages (company_id, conversation_id, direction, author, body, wa_message_id, status, error, user_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (company_id, wa_message_id) where wa_message_id is not null do nothing returning *`,
    [conv.company_id, conv.id, direction, author, body, waId, status, error, userId]);
  return m || null;
}

/**
 * Trata uma mensagem recebida: grava, roda o agente (se ligado e a conversa não estiver com a equipe) e envia as respostas.
 * @param send async (conv, text) => { waId, status: 'enviado'|'simulado', error? }
 */
export async function handleInbound(companyId, msg, send, { cfg: waCfg = null, agentOff = false, simulated = false } = {}) {
  const { rows: [company] } = await q('select id, name, trade_name, settings from companies where id = $1', [companyId]);
  if (!company) return { ignored: true };
  const cfg = agentConfig(waCfg);
  const conv = simulated ? (await q('select * from wa_conversations where company_id = $1 and phone = $2 and simulated', [companyId, normalizePhone(msg.from)])).rows[0]
    : await upsertConversation(companyId, msg.from, msg.name);
  if (!conv) return { ignored: true };
  const saved = await saveMessage(conv, { direction: 'in', author: 'cliente', body: msg.text || '', waId: msg.id || null });
  if (!saved) return { duplicate: true };
  // volta ao agente sozinho se a equipe não respondeu em 12 h
  const { rows: [c2] } = await q(
    `update wa_conversations set unread = unread + 1, last_inbound_at = now(), last_message_at = now(),
            mode = case when mode = 'humano' and coalesce((select max(created_at) from wa_messages m where m.conversation_id = $1 and m.author = 'equipe'), last_inbound_at, now()) < now() - interval '12 hours' then 'agente' else mode end
      where id = $1 returning *`, [conv.id]);
  if (c2.mode === 'humano' || !cfg.agent_enabled || agentOff) return { conversation: c2, replies: [] };
  // muitas mensagens seguidas do mesmo número: passa para a equipe e avisa uma vez
  if (!simulated && (await hit(`wa-in:${companyId}:${conv.phone}`, 20, 600)).blocked) {
    await q("update wa_conversations set mode = 'humano', state = 'inicio', context = '{}' where id = $1", [c2.id]);
    const body = 'Recebemos muitas mensagens seguidas. Um atendente vai continuar a conversa por aqui. 🙂';
    let res;
    try { res = await send(c2, body); } catch (e) { res = { status: 'falhou', error: e.message }; }
    await saveMessage(c2, { direction: 'out', author: 'agente', body, waId: res.waId || null, status: res.status, error: res.error || null });
    return { conversation: { ...c2, mode: 'humano' }, replies: [] };
  }
  const aiCfg = cfg.ai_enabled ? await loadIntegration(companyId, 'ia', 'anthropic').catch(() => null) : null;
  let r;
  try {
    r = await agentReply(c2, company, cfg, aiCfg, msg.text);
  } catch (e) {
    console.error('[whatsapp] agente', e.message);
    r = { replies: ['Tive um problema para processar sua mensagem. Um atendente vai responder em breve.'], state: 'inicio', context: {}, mode: 'humano' };
  }
  await q('update wa_conversations set state = $2, context = $3, mode = coalesce($4, mode) where id = $1', [c2.id, r.state, JSON.stringify(r.context || {}), r.mode || null]);
  const sent = [];
  for (const body of r.replies) {
    let res;
    try { res = await send(c2, body); } catch (e) { res = { status: 'falhou', error: e.message }; }
    sent.push(await saveMessage(c2, { direction: 'out', author: 'agente', body, waId: res.waId || null, status: res.status, error: res.error || null }));
  }
  await q('update wa_conversations set last_message_at = now() where id = $1', [c2.id]);
  return { conversation: { ...c2, state: r.state, mode: r.mode || c2.mode }, replies: sent.filter(Boolean), requestId: r.requestId || null };
}
