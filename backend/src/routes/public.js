// Links públicos: orçamento para aprovação e acompanhamento da OS pelo cliente.
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { q, one, tx } from '../db.js';
import { parse, notFound, bad, withDefaults, round2 } from '../util.js';
import { logEvent, orderFinance } from '../domain.js';

const r = Router();
r.use(rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false, message: { error: 'Muitas requisições.' } }));

async function companyInfo(id) {
  const c = await one(
    `select name, trade_name, document, phone, email, street, number, district, city, uf, logo_url, settings
       from companies where id = $1`, [id]);
  const s = withDefaults(c.settings);
  if (!s.modules.publicLinks) throw notFound('Link indisponível');
  delete c.settings;
  return { ...c, primaryColor: s.primaryColor, paymentMethods: s.paymentMethods.filter((m) => m.active !== false).map((m) => m.name) };
}

r.get('/quote/:token', async (req, res) => {
  await q(`update quotes set status = 'expirado' where public_token = $1 and status in ('rascunho','enviado')
             and valid_until < (now() at time zone 'America/Sao_Paulo')::date`, [req.params.token]);
  const qt = await one(
    `select qt.id, qt.company_id, qt.number, qt.title, qt.description, qt.status, qt.valid_until, qt.subtotal, qt.discount, qt.total,
            qt.payment_terms, qt.delivery_days, qt.warranty_days, qt.terms, qt.created_at, qt.approved_at, qt.refused_at,
            qt.customer_response, c.name as customer_name, e.description as equipment_description, e.brand as equipment_brand,
            e.model as equipment_model, o.public_token as order_token
       from quotes qt left join customers c on c.id = qt.customer_id left join equipment e on e.id = qt.equipment_id
       left join orders o on o.id = qt.order_id
      where qt.public_token = $1`, [req.params.token]);
  if (!qt) throw notFound('Orçamento não encontrado');
  const { rows: items } = await q(
    'select kind, description, unit, qty, unit_price, discount, total from quote_items where quote_id = $1 order by position', [qt.id]);
  const company = await companyInfo(qt.company_id);
  delete qt.company_id; delete qt.id;
  res.json({ company, quote: { ...qt, items } });
});

r.post('/quote/:token/:action', async (req, res) => {
  if (!['approve', 'refuse'].includes(req.params.action)) throw notFound();
  const d = parse(z.object({ name: z.string().trim().min(2, 'informe seu nome'), note: z.string().trim().max(1000).optional() }), req.body);
  const qt = await one('select * from quotes where public_token = $1', [req.params.token]);
  if (!qt) throw notFound();
  if (!['rascunho', 'enviado'].includes(qt.status)) throw bad('Este orçamento não está mais aguardando resposta.');
  if (qt.valid_until && qt.valid_until < new Date().toISOString().slice(0, 10)) throw bad('Orçamento vencido. Fale com a empresa.');
  const approve = req.params.action === 'approve';
  await q(
    `update quotes set status = $2, approved_at = case when $2='aprovado' then now() end, refused_at = case when $2='recusado' then now() end,
            customer_response = $3, updated_at = now() where id = $1`,
    [qt.id, approve ? 'aprovado' : 'recusado', `${approve ? 'Aprovado' : 'Recusado'} por ${d.name} pelo link${d.note ? `: ${d.note}` : ''}`]);
  res.json({ ok: true, status: approve ? 'aprovado' : 'recusado' });
});

r.get('/order/:token', async (req, res) => {
  const o = await one(
    `select o.id, o.company_id, o.number, o.kind, o.status, o.priority, o.received_at, o.promised_at, o.finished_at, o.delivered_at,
            o.problem, o.diagnosis, o.solution, o.subtotal, o.discount, o.total, o.warranty_days, o.warranty_until, o.accessories,
            c.name as customer_name, e.description as equipment_description, e.brand as equipment_brand, e.model as equipment_model,
            e.serial as equipment_serial
       from orders o left join customers c on c.id = o.customer_id left join equipment e on e.id = o.equipment_id
      where o.public_token = $1`, [req.params.token]);
  if (!o) throw notFound('OS não encontrada');
  const [{ rows: items }, { rows: events }, fin, company] = await Promise.all([
    q('select kind, description, unit, qty, unit_price, discount, total from order_items where order_id = $1 order by position', [o.id]),
    q(`select type, to_status, message, created_at from order_events where order_id = $1 and (public or type in ('status','criacao'))
        order by created_at`, [o.id]),
    orderFinance({ query: q }, o.id),
    companyInfo(o.company_id),
  ]);
  const paid = round2(Number(fin.paid) - Number(fin.refunded));
  delete o.company_id; delete o.id;
  res.json({ company, order: { ...o, items, events, paid, balance: round2(o.total - paid) } });
});

r.post('/order/:token/approve', async (req, res) => {
  const d = parse(z.object({ name: z.string().trim().min(2, 'informe seu nome'), note: z.string().trim().max(1000).optional() }), req.body);
  await tx(async (db) => {
    const { rows: [o] } = await db.query('select * from orders where public_token = $1 for update', [req.params.token]);
    if (!o) throw notFound();
    if (o.status !== 'aguardando_aprovacao') throw bad('Esta OS não está aguardando aprovação.');
    await db.query("update orders set status = 'aprovada', updated_at = now() where id = $1", [o.id]);
    await logEvent(db, o.id, { type: 'status', from: o.status, to: 'aprovada', isPublic: true,
      message: `Aprovado pelo cliente (${d.name}) pelo link${d.note ? `: ${d.note}` : ''}` });
  });
  res.json({ ok: true });
});

export default r;
