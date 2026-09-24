// Orçamentos.
import { Router } from 'express';
import { z } from 'zod';
import { q, one, tx } from '../db.js';
import { need, can } from '../auth.js';
import { parse, notFound, bad, round2, publicToken, HttpError } from '../util.js';
import { nextNumber, itemSchema, prepareItems, insertItems, syncOrderStock, logEvent } from '../domain.js';

const r = Router();
r.use(need('quotes', 'quotes_approve'));

const s = z.string().trim();
const opt = s.nullable().optional();
const schema = z.object({
  customer_id: z.string().uuid({ message: 'selecione o cliente' }),
  equipment_id: z.string().uuid().nullable().optional(),
  equipment: z.object({ category: opt, description: s.min(2), brand: opt, model: opt, serial: opt }).nullable().optional(),
  technician_id: z.string().uuid().nullable().optional(),
  title: s.min(2, 'informe o título do orçamento'),
  description: opt,
  items: z.array(itemSchema).min(1, 'inclua ao menos um item'),
  discount: z.coerce.number().min(0).default(0),
  valid_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  payment_terms: opt,
  delivery_days: z.coerce.number().int().min(0).nullable().optional(),
  warranty_days: z.coerce.number().int().min(0).nullable().optional(),
  terms: opt,
  internal_notes: opt,
});

/** Orçamentos vencidos passam a "expirado" automaticamente. */
const expire = (companyId) => q(
  `update quotes set status = 'expirado' where company_id = $1 and status in ('rascunho','enviado')
      and valid_until < (now() at time zone 'America/Sao_Paulo')::date`, [companyId]);

r.get('/', async (req, res) => {
  await expire(req.companyId);
  const params = [req.companyId];
  let where = 'qt.company_id = $1';
  const { status, search, from, to, customer_id } = req.query;
  if (status === 'pendentes') where += " and qt.status in ('rascunho','enviado')";
  else if (status) { params.push(String(status).split(',')); where += ` and qt.status = any($${params.length})`; }
  if (customer_id) { params.push(customer_id); where += ` and qt.customer_id = $${params.length}`; }
  if (from) { params.push(from); where += ` and qt.created_at >= $${params.length}::date`; }
  if (to) { params.push(to); where += ` and qt.created_at < $${params.length}::date + 1`; }
  if (search) {
    const t = String(search).trim().toLowerCase();
    params.push(`%${t}%`);
    const num = /^\d+$/.test(t) ? ` or qt.number = ${parseInt(t, 10)}` : '';
    where += ` and (lower(qt.title) like $${params.length} or lower(coalesce(c.name,'')) like $${params.length}${num})`;
  }
  const { rows } = await q(
    `select qt.id, qt.number, qt.title, qt.status, qt.total, qt.valid_until, qt.created_at, qt.approved_at, qt.order_id,
            qt.customer_id, c.name as customer_name, c.phone as customer_phone, e.description as equipment_description,
            o.number as order_number, u.name as created_by_name
       from quotes qt left join customers c on c.id = qt.customer_id left join equipment e on e.id = qt.equipment_id
       left join orders o on o.id = qt.order_id left join users u on u.id = qt.created_by
      where ${where} order by qt.created_at desc limit 1000`, params);
  res.json(rows);
});

export async function loadQuote(id, companyId) {
  const qt = await one(
    `select qt.*, c.name as customer_name, c.phone as customer_phone, c.email as customer_email, c.document as customer_document,
            c.street, c.number as address_number, c.district, c.city, c.uf,
            e.description as equipment_description, e.brand as equipment_brand, e.model as equipment_model, e.serial as equipment_serial,
            t.name as technician_name, o.number as order_number, u.name as created_by_name
       from quotes qt left join customers c on c.id = qt.customer_id left join equipment e on e.id = qt.equipment_id
       left join technicians t on t.id = qt.technician_id left join orders o on o.id = qt.order_id
       left join users u on u.id = qt.created_by
      where qt.id = $1 and qt.company_id = $2`, [id, companyId]);
  if (!qt) throw notFound('Orçamento não encontrado');
  const { rows: items } = await q('select * from quote_items where quote_id = $1 order by position', [id]);
  return { ...qt, items };
}

r.get('/:id', async (req, res) => res.json(await loadQuote(req.params.id, req.companyId)));

async function upsert(db, req, d, cur) {
  if ((d.discount > 0 || d.items.some((i) => i.discount > 0)) && !can(req, 'discount') && (!cur || Number(cur.discount) !== d.discount)) {
    throw new HttpError(403, 'Seu perfil não permite dar desconto.');
  }
  let equipmentId = d.equipment_id || null;
  if (!equipmentId && d.equipment) {
    const e = d.equipment;
    const { rows: [row] } = await db.query(
      `insert into equipment (company_id, customer_id, category, description, brand, model, serial) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [req.companyId, d.customer_id, e.category || null, e.description, e.brand || null, e.model || null, e.serial || null]);
    equipmentId = row.id;
  }
  const { items, subtotal } = await prepareItems(db, req.companyId, d.items);
  const total = round2(subtotal - d.discount);
  if (total < 0) throw bad('Desconto maior que o total.');
  const cfg = req.settings.orders;
  const valid = d.valid_until || new Date(Date.now() + cfg.quoteValidityDays * 86400000).toISOString().slice(0, 10);
  const vals = [d.customer_id, equipmentId, d.technician_id || null, d.title, d.description || null, subtotal, d.discount, total,
    valid, d.payment_terms || null, d.delivery_days ?? null, d.warranty_days ?? cfg.defaultWarrantyDays, d.terms ?? cfg.termsQuote,
    d.internal_notes || null];
  let id;
  if (cur) {
    await db.query(
      `update quotes set customer_id=$1, equipment_id=$2, technician_id=$3, title=$4, description=$5, subtotal=$6, discount=$7, total=$8,
              valid_until=$9, payment_terms=$10, delivery_days=$11, warranty_days=$12, terms=$13, internal_notes=$14, updated_at=now(),
              status = case when status = 'expirado' then 'rascunho' else status end
        where id=$15`, [...vals, cur.id]);
    id = cur.id;
  } else {
    const number = await nextNumber(db, 'quotes', req.companyId);
    const { rows: [row] } = await db.query(
      `insert into quotes (company_id, number, customer_id, equipment_id, technician_id, title, description, subtotal, discount, total,
              valid_until, payment_terms, delivery_days, warranty_days, terms, internal_notes, public_token, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) returning id`,
      [req.companyId, number, ...vals, publicToken(), req.user.id]);
    id = row.id;
  }
  await insertItems(db, 'quote_items', 'quote_id', id, items);
  return id;
}

r.post('/', need('quotes'), async (req, res) => {
  const d = parse(schema, req.body);
  const id = await tx((db) => upsert(db, req, d));
  res.status(201).json(await loadQuote(id, req.companyId));
});

r.put('/:id', need('quotes'), async (req, res) => {
  const d = parse(schema, req.body);
  await tx(async (db) => {
    const { rows: [cur] } = await db.query('select * from quotes where id = $1 and company_id = $2 for update', [req.params.id, req.companyId]);
    if (!cur) throw notFound();
    if (['convertido', 'aprovado'].includes(cur.status)) throw bad('Orçamento aprovado/convertido não pode ser alterado. Duplique-o.');
    await upsert(db, req, d, cur);
  });
  res.json(await loadQuote(req.params.id, req.companyId));
});

r.post('/:id/status', async (req, res) => {
  const d = parse(z.object({ status: z.enum(['rascunho', 'enviado', 'aprovado', 'recusado']), note: opt }), req.body);
  if (['aprovado', 'recusado'].includes(d.status) && !can(req, 'quotes_approve')) throw new HttpError(403, 'Seu perfil não permite aprovar orçamentos.');
  const cur = await one('select * from quotes where id = $1 and company_id = $2', [req.params.id, req.companyId]);
  if (!cur) throw notFound();
  if (cur.status === 'convertido') throw bad('Orçamento já convertido em OS.');
  await q(
    `update quotes set status = $2, updated_at = now(),
            approved_at = case when $2 = 'aprovado' then now() else null end,
            refused_at = case when $2 = 'recusado' then now() else null end,
            customer_response = coalesce($3, customer_response),
            valid_until = case when $2 in ('rascunho','enviado') and valid_until < current_date then current_date + 7 else valid_until end
      where id = $1`, [cur.id, d.status, d.note || null]);
  res.json(await loadQuote(cur.id, req.companyId));
});

/** Converte orçamento aprovado em OS (copia itens, cliente e equipamento). */
export async function convertQuote(db, companyId, quoteId, userId, settings, { technicianId = null } = {}) {
  const { rows: [qt] } = await db.query('select * from quotes where id = $1 and company_id = $2 for update', [quoteId, companyId]);
  if (!qt) throw notFound();
  if (qt.status === 'convertido') throw bad('Orçamento já convertido.');
  if (['recusado', 'expirado'].includes(qt.status)) throw bad('Orçamento recusado/expirado. Reabra antes de converter.');
  const { rows: items } = await db.query('select * from quote_items where quote_id = $1 order by position', [qt.id]);
  const number = await nextNumber(db, 'orders', companyId);
  const tech = technicianId || qt.technician_id;
  const { items: prepared, subtotal } = await prepareItems(db, companyId, items.map((i) => ({
    ...i, qty: Number(i.qty), unit_price: Number(i.unit_price), unit_cost: Number(i.unit_cost), discount: Number(i.discount),
  })), { defaultTechnician: tech });
  const promised = qt.delivery_days ? new Date(Date.now() + qt.delivery_days * 86400000).toISOString() : null;
  const { rows: [o] } = await db.query(
    `insert into orders (company_id, number, kind, customer_id, equipment_id, quote_id, technician_id, status, problem,
            subtotal, discount, total, warranty_days, promised_at, public_token, created_by)
     values ($1,$2,'os',$3,$4,$5,$6,'aprovada',$7,$8,$9,$10,$11,$12,$13,$14) returning *`,
    [companyId, number, qt.customer_id, qt.equipment_id, qt.id, tech, [qt.title, qt.description].filter(Boolean).join('\n'),
      subtotal, qt.discount, round2(subtotal - qt.discount), qt.warranty_days ?? 0, promised, publicToken(), userId]);
  await insertItems(db, 'order_items', 'order_id', o.id, prepared);
  await syncOrderStock(db, o, userId, settings);
  await logEvent(db, o.id, { type: 'criacao', to: 'aprovada', message: `Criada a partir do orçamento nº ${qt.number}`, isPublic: true, userId });
  await db.query(
    `update quotes set status = 'convertido', order_id = $2, approved_at = coalesce(approved_at, now()), updated_at = now() where id = $1`,
    [qt.id, o.id]);
  return o;
}

r.post('/:id/convert', need('quotes_approve'), async (req, res) => {
  const d = parse(z.object({ technician_id: z.string().uuid().nullable().optional() }), req.body);
  const o = await tx((db) => convertQuote(db, req.companyId, req.params.id, req.user.id, req.settings, { technicianId: d.technician_id }));
  res.status(201).json({ order_id: o.id, number: o.number });
});

r.post('/:id/duplicate', need('quotes'), async (req, res) => {
  const src = await loadQuote(req.params.id, req.companyId);
  const id = await tx((db) => upsert(db, req, {
    ...src, valid_until: null, title: src.title,
    items: src.items.map((i) => ({ ...i, qty: Number(i.qty), unit_price: Number(i.unit_price), unit_cost: Number(i.unit_cost), discount: Number(i.discount) })),
  }));
  res.status(201).json(await loadQuote(id, req.companyId));
});

r.delete('/:id', need('quotes'), async (req, res) => {
  const row = await one("delete from quotes where id = $1 and company_id = $2 and status <> 'convertido' returning id", [req.params.id, req.companyId]);
  if (!row) throw bad('Orçamento convertido em OS não pode ser excluído.');
  res.status(204).end();
});

export default r;
