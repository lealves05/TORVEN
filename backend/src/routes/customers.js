import { Router } from 'express';
import { z } from 'zod';
import { q, one } from '../db.js';
import { need, can } from '../auth.js';
import { parse, notFound, onlyDigits, bad } from '../util.js';
import { audit } from '../audit.js';

const r = Router();
r.use(need('customers_view', 'orders_create', 'quotes', 'requests_manage'));

const s = z.string().trim();
const opt = s.nullable().optional();
const schema = z.object({
  kind: z.enum(['pf', 'pj']).default('pf'),
  name: s.min(2, 'informe o nome'),
  trade_name: opt, document: opt, state_registration: opt, municipal_registration: opt,
  phone: opt, phone2: opt, email: z.string().trim().email('e-mail inválido').nullable().optional().or(z.literal('')),
  cep: opt, street: opt, number: opt, complement: opt, district: opt, city: opt,
  uf: z.string().trim().max(2).nullable().optional(), city_code: opt, notes: opt,
  tags: z.array(s).optional(), active: z.boolean().optional(),
});
const COLS = Object.keys(schema.shape);

/** Esconde contato/documento para quem não tem a permissão. */
const redact = (req) => (c) => (can(req, 'customers_contact') || !c ? c
  : { ...c, phone: null, phone2: null, email: null, document: c.document ? '•••' : null });

r.get('/', async (req, res) => {
  const params = [req.companyId];
  let where = 'c.company_id = $1';
  if (req.query.all !== '1') where += ' and c.active';
  if (req.query.search) {
    const t = String(req.query.search).toLowerCase();
    params.push(`%${t}%`);
    const i = params.length;
    let extra = '';
    const dig = onlyDigits(t);
    if (dig.length >= 3) { params.push(`%${dig}%`); extra = ` or regexp_replace(coalesce(c.phone,'')||coalesce(c.document,''), '\\D', '', 'g') like $${params.length}`; }
    where += ` and (lower(c.name) like $${i} or lower(coalesce(c.trade_name,'')) like $${i} or lower(coalesce(c.email,'')) like $${i}${extra})`;
  }
  const { rows } = await q(
    `select c.*,
            (select count(*) from orders o where o.customer_id = c.id and o.status <> 'cancelada')::int as orders_count,
            (select coalesce(sum(o.total),0) from orders o where o.customer_id = c.id and o.status = 'entregue') as total_spent,
            (select max(o.created_at) from orders o where o.customer_id = c.id) as last_order_at,
            (select count(*) from equipment e where e.customer_id = c.id and e.active)::int as equipment_count
       from customers c where ${where} order by lower(c.name) limit ${req.query.limit ? Math.min(+req.query.limit, 1000) : 1000}`, params);
  res.json(rows.map(redact(req)));
});

r.get('/:id', async (req, res) => {
  const c = await one('select * from customers where id = $1 and company_id = $2', [req.params.id, req.companyId]);
  if (!c) throw notFound();
  const [{ rows: equipment }, { rows: orders }, { rows: quotes }, { rows: [fin] }, { rows: contacts }, { rows: addresses }, { rows: requests }, { rows: attachments }] = await Promise.all([
    q('select * from equipment where customer_id = $1 and active order by created_at desc', [c.id]),
    q(`select o.id, o.number, o.kind, o.status, o.total, o.created_at, o.delivered_at, e.description as equipment
         from orders o left join equipment e on e.id = o.equipment_id where o.customer_id = $1 order by o.created_at desc limit 100`, [c.id]),
    q('select id, number, title, status, total, created_at from quotes where customer_id = $1 order by created_at desc limit 50', [c.id]),
    q(`select coalesce(sum(amount) filter (where type='entrada' and paid_at is null), 0) as receivable,
              coalesce(sum(amount) filter (where type='entrada' and paid_at is null and due_date < current_date), 0) as overdue
         from transactions where customer_id = $1`, [c.id]),
    q('select * from customer_contacts where customer_id = $1 order by is_primary desc, lower(name)', [c.id]),
    q('select * from customer_addresses where customer_id = $1 order by kind, created_at', [c.id]),
    q(`select id, number, title, status, channel, created_at from service_requests where customer_id = $1 order by created_at desc limit 50`, [c.id]),
    q(`select id, entity, entity_id, filename, mime, size, caption, created_at from attachments
        where company_id = $2 and ((entity = 'customer' and entity_id = $1)
          or (entity = 'equipment' and entity_id in (select id from equipment where customer_id = $1))) order by created_at`, [c.id, req.companyId]),
  ]);
  const canContact = can(req, 'customers_contact');
  const showValues = can(req, 'orders_values');
  res.json({
    ...redact(req)(c), equipment, quotes: showValues ? quotes : quotes.map((x) => ({ ...x, total: null })),
    orders: showValues ? orders : orders.map((x) => ({ ...x, total: null })), finance: fin,
    contacts: canContact ? contacts : contacts.map((x) => ({ ...x, phone: null, email: null })),
    addresses, requests, attachments,
  });
});

r.post('/', need('customers_edit', 'orders_create'), async (req, res) => {
  const d = parse(schema, req.body);
  const keys = COLS.filter((k) => d[k] !== undefined);
  const c = await one(
    `insert into customers (company_id, ${keys.join(',')}) values ($1, ${keys.map((_, i) => `$${i + 2}`).join(',')}) returning *`,
    [req.companyId, ...keys.map((k) => (d[k] === '' ? null : d[k]))]);
  await audit(null, req, { entity: 'customer', entityId: c.id, action: 'create', summary: `Cliente ${c.name} cadastrado` });
  res.status(201).json(c);
});

r.put('/:id', need('customers_edit'), async (req, res) => {
  const d = parse(schema.partial(), req.body);
  const keys = COLS.filter((k) => d[k] !== undefined);
  const c = await one(
    `update customers set ${keys.map((k, i) => `${k} = $${i + 3}`).join(', ')} where id = $1 and company_id = $2 returning *`,
    [req.params.id, req.companyId, ...keys.map((k) => (d[k] === '' ? null : d[k]))]);
  if (!c) throw notFound();
  await audit(null, req, { entity: 'customer', entityId: c.id, action: 'update', summary: `Cliente ${c.name} alterado: ${keys.join(', ')}` });
  res.json(c);
});

r.delete('/:id', need('customers_edit'), async (req, res) => {
  const c = await one('update customers set active = false where id = $1 and company_id = $2 returning id, name', [req.params.id, req.companyId]);
  if (!c) throw notFound();
  await audit(null, req, { entity: 'customer', entityId: c.id, action: 'deactivate', summary: `Cliente ${c.name} inativado` });
  res.status(204).end();
});

// ---------- Objetos de serviço (equipamentos, peças, estruturas, veículos) ----------
const eqSchema = z.object({
  customer_id: z.string().uuid(),
  category: opt, description: s.min(2, 'descreva o objeto de serviço'), brand: opt, model: opt, serial: opt, year: opt, notes: opt,
  quantity: z.coerce.number().positive().optional(), dimensions: opt, material: opt, asset_tag: opt, plate: opt, condition: opt,
});
const EQ = ['category', 'description', 'brand', 'model', 'serial', 'year', 'notes', 'quantity', 'dimensions', 'material', 'asset_tag', 'plate', 'condition'];
const eqVals = (d) => EQ.map((k) => (k === 'quantity' ? d.quantity ?? 1 : d[k] || null));

r.get('/:id/equipment', async (req, res) => {
  const { rows } = await q('select * from equipment where customer_id = $1 and company_id = $2 and active order by created_at desc', [req.params.id, req.companyId]);
  res.json(rows);
});

r.post('/:id/equipment', need('customers_edit', 'orders_create', 'requests_manage'), async (req, res) => {
  const d = parse(eqSchema, { ...req.body, customer_id: req.params.id });
  const c = await one('select id from customers where id = $1 and company_id = $2', [d.customer_id, req.companyId]);
  if (!c) throw notFound('Cliente não encontrado');
  const e = await one(
    `insert into equipment (company_id, customer_id, ${EQ.join(', ')}) values ($1,$2,${EQ.map((_, i) => `$${i + 3}`).join(',')}) returning *`,
    [req.companyId, d.customer_id, ...eqVals(d)]);
  res.status(201).json(e);
});

r.put('/equipment/:eid', need('customers_edit', 'orders_edit'), async (req, res) => {
  const d = parse(eqSchema.omit({ customer_id: true }), req.body);
  const e = await one(
    `update equipment set ${EQ.map((k, i) => `${k} = $${i + 3}`).join(', ')} where id=$1 and company_id=$2 returning *`,
    [req.params.eid, req.companyId, ...eqVals(d)]);
  if (!e) throw notFound();
  res.json(e);
});

r.delete('/equipment/:eid', need('customers_edit'), async (req, res) => {
  await q('update equipment set active = false where id = $1 and company_id = $2', [req.params.eid, req.companyId]);
  res.status(204).end();
});

// ---------- Contatos ----------
const contactSchema = z.object({
  name: s.min(2, 'informe o nome do contato'), role: opt, phone: opt,
  email: z.string().trim().email('e-mail inválido').nullable().optional().or(z.literal('')),
  is_primary: z.boolean().default(false), receives_quotes: z.boolean().default(true), notes: opt,
});
const CT = Object.keys(contactSchema.shape);

async function ownCustomer(req, id) {
  const c = await one('select id, name from customers where id = $1 and company_id = $2', [id, req.companyId]);
  if (!c) throw notFound('Cliente não encontrado');
  return c;
}

r.post('/:id/contacts', need('customers_edit'), async (req, res) => {
  const d = parse(contactSchema, req.body);
  const c = await ownCustomer(req, req.params.id);
  if (d.is_primary) await q('update customer_contacts set is_primary = false where customer_id = $1', [c.id]);
  const row = await one(
    `insert into customer_contacts (company_id, customer_id, ${CT.join(',')}) values ($1,$2,${CT.map((_, i) => `$${i + 3}`).join(',')}) returning *`,
    [req.companyId, c.id, ...CT.map((k) => (d[k] === '' ? null : d[k] ?? null))]);
  res.status(201).json(row);
});

r.put('/:id/contacts/:cid', need('customers_edit'), async (req, res) => {
  const d = parse(contactSchema, req.body);
  const c = await ownCustomer(req, req.params.id);
  if (d.is_primary) await q('update customer_contacts set is_primary = false where customer_id = $1 and id <> $2', [c.id, req.params.cid]);
  const row = await one(
    `update customer_contacts set ${CT.map((k, i) => `${k} = $${i + 3}`).join(', ')} where id = $1 and customer_id = $2 returning *`,
    [req.params.cid, c.id, ...CT.map((k) => (d[k] === '' ? null : d[k] ?? null))]);
  if (!row) throw notFound();
  res.json(row);
});

r.delete('/:id/contacts/:cid', need('customers_edit'), async (req, res) => {
  const c = await ownCustomer(req, req.params.id);
  await q('delete from customer_contacts where id = $1 and customer_id = $2', [req.params.cid, c.id]);
  res.status(204).end();
});

// ---------- Endereços (cobrança, execução, entrega) ----------
const addrSchema = z.object({
  kind: z.enum(['cobranca', 'execucao', 'entrega']).default('execucao'), label: opt,
  cep: opt, street: s.min(2, 'informe o logradouro'), number: opt, complement: opt, district: opt, city: opt,
  uf: z.string().trim().max(2).nullable().optional(), city_code: opt, reference: opt,
});
const AD = Object.keys(addrSchema.shape);

r.post('/:id/addresses', need('customers_edit'), async (req, res) => {
  const d = parse(addrSchema, req.body);
  const c = await ownCustomer(req, req.params.id);
  const { rows: [{ n }] } = await q('select count(*)::int as n from customer_addresses where customer_id = $1', [c.id]);
  if (n >= 30) throw bad('Limite de endereços atingido.');
  const row = await one(
    `insert into customer_addresses (company_id, customer_id, ${AD.join(',')}) values ($1,$2,${AD.map((_, i) => `$${i + 3}`).join(',')}) returning *`,
    [req.companyId, c.id, ...AD.map((k) => d[k] ?? null)]);
  res.status(201).json(row);
});

r.put('/:id/addresses/:aid', need('customers_edit'), async (req, res) => {
  const d = parse(addrSchema, req.body);
  const c = await ownCustomer(req, req.params.id);
  const row = await one(
    `update customer_addresses set ${AD.map((k, i) => `${k} = $${i + 3}`).join(', ')} where id = $1 and customer_id = $2 returning *`,
    [req.params.aid, c.id, ...AD.map((k) => d[k] ?? null)]);
  if (!row) throw notFound();
  res.json(row);
});

r.delete('/:id/addresses/:aid', need('customers_edit'), async (req, res) => {
  const c = await ownCustomer(req, req.params.id);
  await q('delete from customer_addresses where id = $1 and customer_id = $2', [req.params.aid, c.id]);
  res.status(204).end();
});

export default r;
