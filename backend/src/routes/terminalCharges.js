// Cobrança da OS na maquininha: envia o valor, acompanha e, quando o provedor confirma, lança o pagamento na OS
// (uma única vez). Nunca lança por aviso do navegador ou webhook sem consultar o provedor.
import { Router } from 'express';
import { z } from 'zod';
import { q, tx } from '../db.js';
import { need } from '../auth.js';
import { parse, notFound, bad, round2, withDefaults, HttpError } from '../util.js';
import { orderFinance, logEvent } from '../domain.js';
import { loadIntegration } from '../integrations/store.js';
import { TERMINAL_PROVIDERS, newReference } from '../integrations/terminals.js';

const r = Router();
const FINAL = ['paga', 'recusada', 'cancelada', 'expirada', 'erro', 'divergente'];
const METHOD_LABEL = { credito: 'crédito', debito: 'débito', pix: 'Pix' };

const publicCharge = (c) => (c ? {
  id: c.id, order_id: c.order_id, terminal_id: c.terminal_id, provider: c.provider, provider_name: TERMINAL_PROVIDERS[c.provider]?.name || c.provider,
  amount: Number(c.amount), method: c.method, installments: c.installments, status: c.status, link_url: c.link_url,
  paid_amount: c.paid_amount != null ? Number(c.paid_amount) : null, nsu: c.nsu, card_brand: c.card_brand, message: c.message,
  created_at: c.created_at, paid_at: c.paid_at,
} : null);

/** Endereço público do site (para links de retorno e webhooks), a partir do Worker ou da configuração. */
export function siteUrl(req) {
  const site = req.get('x-edge-site');
  if (site && /^[a-z0-9.-]+(:\d+)?$/i.test(site)) return `https://${site}`;
  const env = String(process.env.APP_URL || '').replace(/\/$/, '');
  return /^https:\/\//.test(env) ? env : null;
}

async function providerCtx(companyId, charge, terminal) {
  const cfg = await loadIntegration(companyId, 'maquininha', charge.provider);
  if (!cfg) throw bad('Integração da maquininha não configurada.');
  return { config: cfg.config || {}, secrets: cfg.secrets || {}, terminal };
}

/**
 * Consulta o provedor e aplica o resultado (idempotente). O lançamento no financeiro acontece uma única vez,
 * com a cobrança travada (for update) e só se o valor pago bater com o valor enviado.
 */
export async function settleCharge(chargeId, { userId = null } = {}) {
  const { rows: [c0] } = await q('select * from terminal_charges where id = $1', [chargeId]);
  if (!c0) throw notFound('Cobrança não encontrada');
  if (FINAL.includes(c0.status)) return c0;
  const prov = TERMINAL_PROVIDERS[c0.provider];
  const { rows: [term] } = await q('select * from payment_terminals where id = $1', [c0.terminal_id]);
  const ctx = await providerCtx(c0.company_id, c0, term);
  if (!c0.external_id && prov.mode !== 'link') return c0;
  const st = await prov.status(ctx, c0);

  return tx(async (db) => {
    const { rows: [c] } = await db.query('select * from terminal_charges where id = $1 for update', [chargeId]);
    if (FINAL.includes(c.status)) return c;
    const raw = st.raw ?? c.raw;
    if (st.status !== 'paga') {
      const { rows: [u] } = await db.query('update terminal_charges set status = $2, raw = $3, updated_at = now() where id = $1 returning *', [c.id, st.status || c.status, raw]);
      if (FINAL.includes(u.status)) {
        await logEvent(db, c.order_id, { type: 'pagamento', message: `Maquininha (${prov.name}): cobrança ${u.status}`, userId });
      }
      return u;
    }
    const paid = round2(st.paid_amount ?? Number(c.amount));
    if (Math.abs(paid - Number(c.amount)) > 0.009) {
      const { rows: [u] } = await db.query(
        `update terminal_charges set status = 'divergente', paid_amount = $2, nsu = $3, card_brand = $4, raw = $5, updated_at = now(),
                message = 'Valor pago diferente do enviado: confira e lance manualmente.' where id = $1 returning *`,
        [c.id, paid, st.nsu || null, st.card_brand || null, raw]);
      await logEvent(db, c.order_id, { type: 'pagamento', message: `Maquininha: valor pago (${paid.toFixed(2)}) diferente do enviado (${Number(c.amount).toFixed(2)}) — conferir`, userId });
      return u;
    }
    const { rows: [o] } = await db.query('select * from orders where id = $1 for update', [c.order_id]);
    const { rows: [co] } = await db.query('select settings from companies where id = $1', [c.company_id]);
    const settings = withDefaults(co.settings);
    const method = st.method || c.method;
    const label = `${o.kind === 'venda' ? 'Venda' : 'OS'} nº ${o.number}`;
    const { rows: [session] } = await db.query('select id from cash_sessions where company_id = $1 and closed_at is null limit 1', [c.company_id]);
    const { rows: [t] } = await db.query(
      `insert into transactions (company_id, type, category, description, amount, method, due_date, paid_at, cash_session_id,
                                 order_id, customer_id, auto, created_by)
       values ($1,'entrada',$2,$3,$4,$5,current_date, now(), $6, $7, $8, true, $9) returning id`,
      [c.company_id, o.kind === 'venda' ? 'Venda de materiais' : 'Ordens de serviço', `${label} — maquininha ${prov.name}${st.nsu ? ` (NSU ${st.nsu})` : ''}`,
        paid, method, session?.id || null, o.id, o.customer_id, c.created_by]);
    const m = settings.paymentMethods.find((x) => x.id === method);
    if (settings.cardFeesAsExpense && m?.fee > 0) {
      await db.query(
        `insert into transactions (company_id, type, category, description, amount, method, due_date, paid_at, cash_session_id, order_id, auto, created_by)
         values ($1,'saida','Taxas de cartão',$2,$3,$4,current_date, now(), $5, $6, true, $7)`,
        [c.company_id, `Taxa ${m.name} — ${label}`, round2(paid * m.fee / 100), method, session?.id || null, o.id, c.created_by]);
    }
    const { rows: [u] } = await db.query(
      `update terminal_charges set status = 'paga', paid_amount = $2, nsu = $3, card_brand = $4, raw = $5, transaction_id = $6,
              method = $7, paid_at = now(), updated_at = now(), message = null where id = $1 returning *`,
      [c.id, paid, st.nsu || null, st.card_brand || null, raw, t.id, method]);
    await logEvent(db, o.id, { type: 'pagamento', message: `Recebido ${paid.toFixed(2).replace('.', ',')} na maquininha (${prov.name}, ${METHOD_LABEL[method] || method})`, userId });
    return u;
  });
}

// ---------------- rotas autenticadas (/api/terminal-charges) ----------------
r.get('/', need('checkout', 'orders_view'), async (req, res) => {
  const orderId = String(req.query.order_id || '');
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) throw bad('Informe a OS.');
  const { rows } = await q('select * from terminal_charges where company_id = $1 and order_id = $2 order by created_at desc limit 20', [req.companyId, orderId]);
  res.json(rows.map(publicCharge));
});

/** Maquininhas disponíveis para cobrar (sem segredos). */
r.get('/devices', need('checkout'), async (req, res) => {
  const { rows } = await q(`select t.id, t.name, t.provider, t.is_default from payment_terminals t
                              join integration_configs i on i.company_id = t.company_id and i.kind = 'maquininha' and i.provider = t.provider and i.enabled
                             where t.company_id = $1 and t.active order by t.is_default desc, lower(t.name)`, [req.companyId]);
  res.json(rows.map((d) => ({ ...d, provider_name: TERMINAL_PROVIDERS[d.provider]?.name, mode: TERMINAL_PROVIDERS[d.provider]?.mode,
    ready: !!TERMINAL_PROVIDERS[d.provider]?.ready, methods: TERMINAL_PROVIDERS[d.provider]?.methods || [] })));
});

const createSchema = z.object({
  order_id: z.string().uuid(), terminal_id: z.string().uuid().nullable().optional(),
  amount: z.coerce.number().positive().optional(), method: z.enum(['credito', 'debito', 'pix']).default('credito'),
  installments: z.coerce.number().int().min(1).max(18).default(1),
});

r.post('/', need('checkout'), async (req, res) => {
  const d = parse(createSchema, req.body);
  const { rows: [o] } = await q('select * from orders where id = $1 and company_id = $2', [d.order_id, req.companyId]);
  if (!o) throw notFound('OS não encontrada');
  if (['cancelada'].includes(o.status)) throw bad('OS cancelada.');
  const { rows: [term] } = d.terminal_id
    ? await q('select * from payment_terminals where id = $1 and company_id = $2 and active', [d.terminal_id, req.companyId])
    : await q('select * from payment_terminals where company_id = $1 and active and is_default limit 1', [req.companyId]);
  if (!term) throw bad('Cadastre uma maquininha (padrão) em Configurações › Integrações.');
  const prov = TERMINAL_PROVIDERS[term.provider];
  if (!prov) throw bad('Provedor da maquininha desconhecido.');
  if (!prov.methods.includes(d.method)) throw bad(`${prov.name} não recebe ${METHOD_LABEL[d.method]} por esta integração.`);
  const cfg = await loadIntegration(req.companyId, 'maquininha', term.provider);
  if (!cfg?.enabled) throw bad(`Integração ${prov.name} desligada. Ative em Configurações › Integrações.`);

  // valor: saldo da OS (servidor calcula; o navegador só pode pedir valor menor, ex.: pagamento dividido)
  const fin = await orderFinance({ query: q }, o.id);
  const balance = round2(Number(o.total) - (Number(fin.paid) - Number(fin.refunded)) - Number(fin.receivable));
  const amount = round2(d.amount ?? balance);
  if (balance <= 0) throw bad('Esta OS não tem saldo a receber.');
  if (amount > balance + 0.009) throw bad(`Valor maior que o saldo da OS (${balance.toFixed(2).replace('.', ',')}).`);

  const reference = newReference();
  let charge;
  try {
    ({ rows: [charge] } = await q(
      `insert into terminal_charges (company_id, order_id, terminal_id, provider, amount, method, installments, external_reference, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
      [req.companyId, o.id, term.id, term.provider, amount, d.method, d.method === 'credito' ? d.installments : 1, reference, req.user.id]));
  } catch (e) {
    if (e.code === '23505') throw new HttpError(409, 'Já existe uma cobrança em andamento para esta OS. Aguarde ou cancele antes de enviar outra.');
    throw e;
  }
  const site = siteUrl(req);
  const ctx = { config: cfg.config || {}, secrets: cfg.secrets || {}, terminal: term,
    webhookUrl: site ? `${site}/api/public/terminals/${term.provider}/webhook?ref=${reference}` : null,
    redirectUrl: site ? `${site}/os/${o.id}?cobranca=${charge.id}` : null };
  const { rows: [cust] } = await q('select name from customers where id = $1', [o.customer_id]);
  try {
    const out = await prov.create(ctx, { ...charge, amount, description: `${o.kind === 'venda' ? 'Venda' : 'OS'} ${o.number}`, customer_name: cust?.name });
    ({ rows: [charge] } = await q(
      'update terminal_charges set status = $2, external_id = $3, link_url = $4, raw = $5, updated_at = now() where id = $1 returning *',
      [charge.id, out.status || 'enviada', out.external_id || null, out.link_url || null, out.raw ? JSON.stringify(out.raw).slice(0, 20000) : null]));
    await logEvent({ query: q }, o.id, { type: 'pagamento', message: `Enviado ${amount.toFixed(2).replace('.', ',')} para a maquininha ${term.name} (${prov.name})`, userId: req.user.id });
  } catch (e) {
    await q("update terminal_charges set status = 'erro', message = $2, updated_at = now() where id = $1", [charge.id, String(e.message).slice(0, 300)]);
    throw e;
  }
  res.status(201).json(publicCharge(charge));
});

/** Consulta a situação no provedor (o navegador chama a cada poucos segundos enquanto a tela está aberta). */
r.get('/:id', need('checkout', 'orders_view'), async (req, res) => {
  const { rows: [c] } = await q('select * from terminal_charges where id = $1 and company_id = $2', [req.params.id, req.companyId]);
  if (!c) throw notFound('Cobrança não encontrada');
  let out = c;
  if (!FINAL.includes(c.status) && req.query.refresh !== '0') {
    try { out = await settleCharge(c.id, { userId: req.user.id }); } catch (e) { return res.json({ ...publicCharge(c), check_error: e.message }); }
  }
  res.json(publicCharge(out));
});

r.post('/:id/cancel', need('checkout'), async (req, res) => {
  const { rows: [c] } = await q('select * from terminal_charges where id = $1 and company_id = $2', [req.params.id, req.companyId]);
  if (!c) throw notFound('Cobrança não encontrada');
  if (FINAL.includes(c.status)) return res.json(publicCharge(c));
  // antes de cancelar, confere se já não foi paga (evita cancelar algo cobrado)
  const now = await settleCharge(c.id, { userId: req.user.id }).catch(() => c);
  if (now.status === 'paga') throw bad('A cobrança já foi paga na maquininha.');
  const prov = TERMINAL_PROVIDERS[c.provider];
  const { rows: [term] } = await q('select * from payment_terminals where id = $1', [c.terminal_id]);
  if (c.external_id) await prov.cancel(await providerCtx(req.companyId, c, term), c).catch(() => null);
  const { rows: [u] } = await q("update terminal_charges set status = 'cancelada', updated_at = now() where id = $1 and status in ('pendente','enviada') returning *", [c.id]);
  if (u) await logEvent({ query: q }, c.order_id, { type: 'pagamento', message: 'Cobrança na maquininha cancelada', userId: req.user.id });
  res.json(publicCharge(u || now));
});

/** Retorno do link (InfinitePay): o navegador repassa os identificadores; a confirmação é feita na própria InfinitePay. */
r.post('/:id/return', need('checkout', 'orders_view'), async (req, res) => {
  const d = parse(z.object({ transaction_nsu: z.string().trim().max(120).optional(), slug: z.string().trim().max(120).optional(),
    invoice_slug: z.string().trim().max(120).optional() }), req.body);
  const { rows: [c] } = await q('select * from terminal_charges where id = $1 and company_id = $2', [req.params.id, req.companyId]);
  if (!c) throw notFound('Cobrança não encontrada');
  if (!FINAL.includes(c.status) && d.transaction_nsu && (d.slug || d.invoice_slug)) {
    await q("update terminal_charges set raw = coalesce(raw, '{}'::jsonb) || $2::jsonb where id = $1",
      [c.id, JSON.stringify({ transaction_nsu: d.transaction_nsu, invoice_slug: d.invoice_slug || d.slug })]);
  }
  res.json(publicCharge(await settleCharge(c.id, { userId: req.user.id })));
});

export default r;
