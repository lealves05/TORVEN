// Ordens de serviço e vendas de balcão.
import { Router } from 'express';
import { z } from 'zod';
import { q, one, tx } from '../db.js';
import { need, can } from '../auth.js';
import { parse, notFound, bad, round2, publicToken, OPEN_STATUSES, HttpError } from '../util.js';
import {
  nextNumber, itemSchema, prepareItems, insertItems, syncOrderStock, logEvent, orderFinance, STATUS_LABEL,
} from '../domain.js';

const r = Router();
r.use(need('orders_view', 'orders_create'));

const s = z.string().trim();
const opt = s.nullable().optional();
const isoDate = z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/));

const orderSchema = z.object({
  kind: z.enum(['os', 'venda']).default('os'),
  customer_id: z.string().uuid().nullable().optional(),
  equipment_id: z.string().uuid().nullable().optional(),
  equipment: z.object({
    category: opt, description: s.min(2), brand: opt, model: opt, serial: opt, year: opt, notes: opt,
  }).nullable().optional(),
  technician_id: z.string().uuid().nullable().optional(),
  priority: z.enum(['baixa', 'normal', 'alta', 'urgente']).default('normal'),
  service_location: z.enum(['oficina', 'externo']).default('oficina'),
  service_address: opt,
  received_at: isoDate.nullable().optional(),
  promised_at: isoDate.nullable().optional(),
  problem: opt, diagnosis: opt, solution: opt, accessories: opt, condition: opt,
  items: z.array(itemSchema).default([]),
  discount: z.coerce.number().min(0).default(0),
  warranty_days: z.coerce.number().int().min(0).max(3650).optional(),
  notes: opt, internal_notes: opt,
  status: z.enum(['aberta', 'diagnostico', 'aguardando_aprovacao', 'aprovada', 'aguardando_material', 'em_execucao', 'pronta']).optional(),
});

// ---------- helpers ----------
function scopeWhere(req, params, alias = 'o') {
  if (can(req, 'orders_view') && req.perms.orders_view === 'all') return '';
  if (req.user.role === 'owner') return '';
  const own = req.ownTechnician;
  if (!own) { params.push(req.user.id); return ` and ${alias}.created_by = $${params.length}`; }
  params.push(own);
  const i = params.length;
  return ` and (${alias}.technician_id = $${i} or exists (select 1 from order_items oi where oi.order_id = ${alias}.id and oi.technician_id = $${i}))`;
}

const stripValues = (req) => (o) => {
  if (can(req, 'orders_values')) return o;
  const x = { ...o, subtotal: null, discount: null, total: null, paid: null, receivable: null, balance: null };
  if (x.items) x.items = x.items.map((i) => ({ ...i, unit_price: null, unit_cost: null, total: null, discount: null, commission_value: null }));
  delete x.payments;
  return x;
};

/** Executa em série (mesma conexão de transação) ou em paralelo (pool). */
const seqFactory = (db) => async (fns) => {
  if (!db) return Promise.all(fns.map((f) => f()));
  const out = [];
  for (const f of fns) out.push(await f());
  return out;
};

async function loadOrder(req, id, db = null) {
  const seq = seqFactory(db);
  const run = db ? (t, p) => db.query(t, p) : q;
  const params = [id, req.companyId];
  const scope = scopeWhere(req, params);
  const { rows: [o] } = await run(
    `select o.*, c.name as customer_name, c.phone as customer_phone, c.email as customer_email, c.document as customer_document,
            c.kind as customer_kind,
            e.description as equipment_description, e.brand as equipment_brand, e.model as equipment_model,
            e.serial as equipment_serial, e.category as equipment_category,
            t.name as technician_name, t.color as technician_color, u.name as created_by_name, qt.number as quote_number
       from orders o left join customers c on c.id = o.customer_id left join equipment e on e.id = o.equipment_id
       left join technicians t on t.id = o.technician_id left join users u on u.id = o.created_by
       left join quotes qt on qt.id = o.quote_id
      where o.id = $1 and o.company_id = $2 ${scope}`, params);
  if (!o) throw notFound('OS não encontrada');
  const [{ rows: items }, { rows: events }, { rows: payments }, { rows: invoices }] = await seq([
    () => run(`select i.*, t.name as technician_name, p.stock as product_stock
           from order_items i left join technicians t on t.id = i.technician_id left join products p on p.id = i.product_id
          where i.order_id = $1 order by i.position`, [id]),
    () => run(`select ev.*, u.name as user_name from order_events ev left join users u on u.id = ev.user_id
          where ev.order_id = $1 order by ev.created_at desc`, [id]),
    () => run(`select id, type, category, description, amount, method, due_date, paid_at, created_at
           from transactions where order_id = $1 order by created_at`, [id]),
    () => run(`select id, kind, status, number, series, amount, provider, pdf_url, created_at
           from invoices where order_id = $1 order by created_at desc`, [id]),
  ]);
  const fin = await orderFinance(db || { query: q }, id);
  const paid = round2(Number(fin.paid) - Number(fin.refunded));
  return {
    ...o, items, events, payments, invoices,
    paid, receivable: Number(fin.receivable), balance: round2(o.total - paid - Number(fin.receivable)),
  };
}

/** Para perfis sem acesso a valores: preço vem do catálogo (ou do item já existente). */
async function catalogPrices(db, companyId, items, old) {
  const { rows: sv } = await db.query('select id, price from services where company_id = $1', [companyId]);
  const { rows: pr } = await db.query('select id, price from products where company_id = $1', [companyId]);
  const S = Object.fromEntries(sv.map((x) => [x.id, Number(x.price)]));
  const P = Object.fromEntries(pr.map((x) => [x.id, Number(x.price)]));
  return items.map((i) => {
    const prev = old.find((o) => o.description === i.description && o.kind === i.kind);
    const unit_price = prev ? Number(prev.unit_price) : i.product_id ? P[i.product_id] ?? 0 : i.service_id ? S[i.service_id] ?? 0 : 0;
    return { ...i, unit_price, discount: prev ? Number(prev.discount) : 0, unit_cost: undefined };
  });
}

// ---------- listagem ----------
r.get('/', async (req, res) => {
  const params = [req.companyId];
  let where = 'o.company_id = $1';
  const { status, kind, technician_id, customer_id, search, from, to, overdue, payment } = req.query;
  if (status === 'abertas') { params.push(OPEN_STATUSES); where += ` and o.status = any($${params.length})`; }
  else if (status) { params.push(String(status).split(',')); where += ` and o.status = any($${params.length})`; }
  if (kind) { params.push(kind); where += ` and o.kind = $${params.length}`; }
  if (technician_id) { params.push(technician_id); where += ` and o.technician_id = $${params.length}`; }
  if (customer_id) { params.push(customer_id); where += ` and o.customer_id = $${params.length}`; }
  if (from) { params.push(from); where += ` and o.created_at >= $${params.length}::date`; }
  if (to) { params.push(to); where += ` and o.created_at < $${params.length}::date + 1`; }
  if (overdue === '1') { params.push(OPEN_STATUSES); where += ` and o.status = any($${params.length}) and o.promised_at < now()`; }
  if (search) {
    const t = String(search).trim().toLowerCase();
    params.push(`%${t}%`);
    const i = params.length;
    const num = /^\d+$/.test(t) ? ` or o.number = ${parseInt(t, 10)}` : '';
    where += ` and (lower(coalesce(c.name,'')) like $${i} or lower(coalesce(e.description,'')) like $${i}
                 or lower(coalesce(e.serial,'')) like $${i} or lower(coalesce(o.problem,'')) like $${i}${num})`;
  }
  where += scopeWhere(req, params);
  const { rows } = await q(
    `select o.id, o.number, o.kind, o.status, o.priority, o.service_location, o.received_at, o.promised_at, o.finished_at,
            o.delivered_at, o.created_at, o.updated_at, o.total, o.problem, o.customer_id, o.technician_id, o.equipment_id,
            c.name as customer_name, c.phone as customer_phone, e.description as equipment_description, e.brand as equipment_brand,
            e.model as equipment_model, t.name as technician_name, t.color as technician_color,
            coalesce(f.paid, 0) as paid, coalesce(f.receivable, 0) as receivable,
            (select count(*) from invoices iv where iv.order_id = o.id and iv.status in ('autorizada','interna'))::int as invoices_count
       from orders o left join customers c on c.id = o.customer_id left join equipment e on e.id = o.equipment_id
       left join technicians t on t.id = o.technician_id
       left join lateral (
         select sum(amount) filter (where type='entrada' and paid_at is not null and category <> 'Taxas de cartão')
                - coalesce(sum(amount) filter (where type='saida' and category='Estornos'), 0) as paid,
                sum(amount) filter (where type='entrada' and paid_at is null) as receivable
           from transactions where order_id = o.id) f on true
      where ${where}
      order by case when o.status in ('entregue','cancelada') then 1 else 0 end,
               case o.priority when 'urgente' then 0 when 'alta' then 1 when 'normal' then 2 else 3 end,
               o.created_at desc
      limit ${Math.min(Number(req.query.limit) || 500, 2000)}`, params);
  let out = rows.map((o) => ({ ...o, balance: round2(o.total - o.paid - o.receivable) }));
  if (payment === 'aberto') out = out.filter((o) => o.balance > 0.009 && o.status !== 'cancelada');
  res.json(out.map(stripValues(req)));
});

r.get('/:id', async (req, res) => res.json(stripValues(req)(await loadOrder(req, req.params.id))));

// ---------- criar / editar ----------
async function resolveEquipment(db, req, d) {
  if (d.equipment_id || !d.equipment) return d.equipment_id || null;
  if (!d.customer_id) throw bad('Selecione o cliente para cadastrar o equipamento.');
  const e = d.equipment;
  const { rows: [row] } = await db.query(
    `insert into equipment (company_id, customer_id, category, description, brand, model, serial, year, notes)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
    [req.companyId, d.customer_id, e.category || null, e.description, e.brand || null, e.model || null, e.serial || null, e.year || null, e.notes || null]);
  return row.id;
}

function checkDiscount(req, d, cur) {
  const itemDisc = d.items.some((i) => i.discount > 0);
  if ((d.discount > 0 || itemDisc) && !can(req, 'discount')) {
    if (!cur || Number(cur.discount) !== d.discount || itemDisc) throw new HttpError(403, 'Seu perfil não permite dar desconto.');
  }
}

r.post('/', need('orders_create'), async (req, res) => {
  const d = parse(orderSchema, req.body);
  if (d.kind === 'os' && !d.customer_id) throw bad('Selecione o cliente da OS.');
  checkDiscount(req, d);
  const cfg = req.settings.orders;
  const id = await tx(async (db) => {
    const number = await nextNumber(db, 'orders', req.companyId);
    const equipmentId = await resolveEquipment(db, req, d);
    const technician = d.technician_id || (req.user.role === 'technician' ? req.ownTechnician : null);
    const src = can(req, 'orders_values') ? d.items : await catalogPrices(db, req.companyId, d.items, []);
    if (!can(req, 'orders_values')) d.discount = 0;
    const { items, subtotal } = await prepareItems(db, req.companyId, src, { defaultTechnician: technician });
    const total = round2(subtotal - d.discount);
    if (total < 0) throw bad('Desconto maior que o total.');
    const promised = d.promised_at || (d.kind === 'os' && cfg.defaultPromiseDays
      ? new Date(Date.now() + cfg.defaultPromiseDays * 86400000).toISOString() : null);
    const { rows: [o] } = await db.query(
      `insert into orders (company_id, number, kind, customer_id, equipment_id, technician_id, status, priority, service_location,
              service_address, received_at, promised_at, problem, diagnosis, solution, accessories, condition, subtotal, discount, total,
              warranty_days, notes, internal_notes, public_token, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,coalesce($11::timestamptz, now()),$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
       returning *`,
      [req.companyId, number, d.kind, d.customer_id || null, equipmentId, technician, d.status || 'aberta', d.priority,
        d.service_location, d.service_address || null, d.received_at || null, promised, d.problem || null, d.diagnosis || null,
        d.solution || null, d.accessories || null, d.condition || null, subtotal, d.discount, total,
        d.warranty_days ?? (d.kind === 'os' ? cfg.defaultWarrantyDays : 0), d.notes || null, d.internal_notes || null,
        publicToken(), req.user.id]);
    await insertItems(db, 'order_items', 'order_id', o.id, items);
    await syncOrderStock(db, o, req.user.id, req.settings);
    await logEvent(db, o.id, { type: 'criacao', to: o.status, message: d.kind === 'venda' ? 'Venda criada' : 'OS aberta', isPublic: true, userId: req.user.id });
    return o.id;
  });
  res.status(201).json(stripValues(req)(await loadOrder(req, id)));
});

r.put('/:id', need('orders_edit'), async (req, res) => {
  const d = parse(orderSchema.omit({ status: true }), req.body);
  await tx(async (db) => {
    const { rows: [cur] } = await db.query('select * from orders where id = $1 and company_id = $2 for update', [req.params.id, req.companyId]);
    if (!cur) throw notFound();
    await loadOrder(req, cur.id, db); // valida escopo
    if (['entregue', 'cancelada'].includes(cur.status)) throw bad('OS entregue ou cancelada. Reabra para editar.');
    const canValues = can(req, 'orders_values');
    let items = d.items;
    if (!canValues) {
      const { rows: old } = await db.query('select * from order_items where order_id = $1 order by position', [cur.id]);
      items = await catalogPrices(db, req.companyId, d.items, old);
      d.discount = Number(cur.discount);
    }
    checkDiscount(req, { ...d, items }, cur);
    const equipmentId = await resolveEquipment(db, req, d);
    const { items: prepared, subtotal } = await prepareItems(db, req.companyId, items, { defaultTechnician: d.technician_id || cur.technician_id });
    const total = round2(subtotal - d.discount);
    if (total < 0) throw bad('Desconto maior que o total.');
    const fin = await orderFinance(db, cur.id);
    if (total + 0.009 < Number(fin.paid) - Number(fin.refunded) + Number(fin.receivable)) {
      throw bad('O novo total ficou menor que o valor já recebido/faturado. Estorne pagamentos antes.');
    }
    const { rows: [o] } = await db.query(
      `update orders set customer_id=$3, equipment_id=$4, technician_id=$5, priority=$6, service_location=$7, service_address=$8,
              received_at=coalesce($9::timestamptz, received_at), promised_at=$10, problem=$11, diagnosis=$12, solution=$13,
              accessories=$14, condition=$15, subtotal=$16, discount=$17, total=$18, warranty_days=coalesce($19, warranty_days),
              notes=$20, internal_notes=$21, updated_at=now()
        where id=$1 and company_id=$2 returning *`,
      [cur.id, req.companyId, d.customer_id || null, equipmentId, d.technician_id || null, d.priority, d.service_location,
        d.service_address || null, d.received_at || null, d.promised_at || null, d.problem || null, d.diagnosis || null,
        d.solution || null, d.accessories || null, d.condition || null, subtotal, d.discount, total, d.warranty_days ?? null,
        d.notes || null, d.internal_notes || null]);
    await insertItems(db, 'order_items', 'order_id', o.id, prepared);
    await syncOrderStock(db, o, req.user.id, req.settings);
  });
  res.json(stripValues(req)(await loadOrder(req, req.params.id)));
});

// ---------- status ----------
r.post('/:id/status', need('orders_edit'), async (req, res) => {
  const d = parse(z.object({
    status: z.enum(['aberta', 'diagnostico', 'aguardando_aprovacao', 'aprovada', 'aguardando_material', 'em_execucao', 'pronta']),
    message: opt, public: z.boolean().default(true),
  }), req.body);
  await tx(async (db) => {
    const { rows: [cur] } = await db.query('select * from orders where id = $1 and company_id = $2 for update', [req.params.id, req.companyId]);
    if (!cur) throw notFound();
    await loadOrder(req, cur.id, db);
    if (['entregue', 'cancelada'].includes(cur.status)) throw bad('OS entregue ou cancelada. Use "Reabrir".');
    if (cur.status === d.status) return;
    await db.query(
      `update orders set status = $2, updated_at = now(),
              started_at = case when $2 = 'em_execucao' then coalesce(started_at, now()) else started_at end,
              finished_at = case when $2 = 'pronta' then now() when $2 <> 'pronta' then null else finished_at end
        where id = $1`, [cur.id, d.status]);
    await logEvent(db, cur.id, { type: 'status', from: cur.status, to: d.status, message: d.message || null, isPublic: d.public, userId: req.user.id });
  });
  res.json(stripValues(req)(await loadOrder(req, req.params.id)));
});

r.post('/:id/events', async (req, res) => {
  const d = parse(z.object({ message: s.min(1, 'escreva a anotação'), public: z.boolean().default(false) }), req.body);
  const o = await loadOrder(req, req.params.id);
  await logEvent({ query: q }, o.id, { type: 'nota', message: d.message, isPublic: d.public, userId: req.user.id });
  res.status(201).json(stripValues(req)(await loadOrder(req, o.id)));
});

// ---------- pagamentos ----------
const paySchema = z.object({
  payments: z.array(z.object({ method: s.min(1), amount: z.coerce.number().positive() })).default([]),
  installments: z.array(z.object({
    due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), amount: z.coerce.number().positive(), method: z.string().nullable().optional(),
  })).default([]),
});

async function registerPayments(db, req, order, d) {
  const settings = req.settings;
  const fin = await orderFinance(db, order.id);
  const balance = round2(order.total - (Number(fin.paid) - Number(fin.refunded)) - Number(fin.receivable));
  const payNow = round2(d.payments.reduce((a, p) => a + p.amount, 0));
  const later = round2(d.installments.reduce((a, p) => a + p.amount, 0));
  const cashPaid = round2(d.payments.filter((p) => p.method === 'dinheiro').reduce((a, p) => a + p.amount, 0));
  const change = round2(Math.max(0, payNow + later - balance));
  if (change > 0 && change > cashPaid + 0.001) throw bad(`Valor informado (${(payNow + later).toFixed(2)}) maior que o saldo (${balance.toFixed(2)}).`);
  if (payNow + later <= 0) throw bad('Informe ao menos um pagamento.');
  if (settings.requireOpenCash && d.payments.length) {
    const { rows: [s0] } = await db.query('select id from cash_sessions where company_id=$1 and closed_at is null', [req.companyId]);
    if (!s0) throw bad('Abra o caixa antes de receber.');
  }
  const { rows: [session] } = await db.query('select id from cash_sessions where company_id=$1 and closed_at is null limit 1', [req.companyId]);
  const category = order.kind === 'venda' ? 'Venda de materiais' : 'Ordens de serviço';
  const label = order.kind === 'venda' ? `Venda nº ${order.number}` : `OS nº ${order.number}`;
  let remainingChange = change;
  for (const p of d.payments) {
    let amount = p.amount;
    if (p.method === 'dinheiro' && remainingChange > 0) { const c = Math.min(amount, remainingChange); amount = round2(amount - c); remainingChange = round2(remainingChange - c); }
    if (amount <= 0) continue;
    await db.query(
      `insert into transactions (company_id, type, category, description, amount, method, due_date, paid_at, cash_session_id,
                                 order_id, customer_id, auto, created_by)
       values ($1,'entrada',$2,$3,$4,$5,current_date, now(), $6, $7, $8, true, $9)`,
      [req.companyId, category, label, amount, p.method, session?.id || null, order.id, order.customer_id, req.user.id]);
    const m = settings.paymentMethods.find((x) => x.id === p.method);
    if (settings.cardFeesAsExpense && m?.fee > 0) {
      await db.query(
        `insert into transactions (company_id, type, category, description, amount, method, due_date, paid_at, cash_session_id, order_id, auto, created_by)
         values ($1,'saida','Taxas de cartão',$2,$3,$4,current_date, now(), $5, $6, true, $7)`,
        [req.companyId, `Taxa ${m.name} — ${label}`, round2(amount * m.fee / 100), p.method, session?.id || null, order.id, req.user.id]);
    }
  }
  for (const [k, p] of d.installments.entries()) {
    await db.query(
      `insert into transactions (company_id, type, category, description, amount, method, due_date, order_id, customer_id, auto, created_by)
       values ($1,'entrada',$2,$3,$4,$5,$6,$7,$8,true,$9)`,
      [req.companyId, category, `${label} — parcela ${k + 1}/${d.installments.length}`, p.amount, p.method || 'boleto', p.due_date,
        order.id, order.customer_id, req.user.id]);
  }
  await logEvent(db, order.id, { type: 'pagamento', message: `Recebido ${payNow.toFixed(2).replace('.', ',')}${later ? ` + a receber ${later.toFixed(2).replace('.', ',')}` : ''}`, userId: req.user.id });
  return change;
}

r.post('/:id/payments', need('checkout'), async (req, res) => {
  const d = parse(paySchema, req.body);
  const change = await tx(async (db) => {
    const { rows: [o] } = await db.query('select * from orders where id = $1 and company_id = $2 for update', [req.params.id, req.companyId]);
    if (!o) throw notFound();
    if (o.status === 'cancelada') throw bad('OS cancelada.');
    return registerPayments(db, req, o, d);
  });
  res.json({ change, order: await loadOrder(req, req.params.id) });
});

r.delete('/:id/payments/:tid', need('checkout'), async (req, res) => {
  if (!can(req, 'cash')) throw new HttpError(403, 'Estornar pagamento exige acesso ao financeiro.');
  await tx(async (db) => {
    const { rows: [t] } = await db.query(
      "select * from transactions where id = $1 and order_id = $2 and company_id = $3 and type = 'entrada'", [req.params.tid, req.params.id, req.companyId]);
    if (!t) throw notFound('Pagamento não encontrado');
    await db.query('delete from transactions where id = $1', [t.id]);
    if (t.paid_at) {
      await db.query(
        `delete from transactions where id = (select id from transactions where order_id = $1 and category = 'Taxas de cartão'
           and method = $2 and paid_at is not null order by abs(extract(epoch from paid_at - $3::timestamptz)) limit 1)`,
        [req.params.id, t.method, t.paid_at]);
    }
    await logEvent(db, req.params.id, { type: 'pagamento', message: `Pagamento estornado: ${Number(t.amount).toFixed(2).replace('.', ',')}`, userId: req.user.id });
  });
  res.json(await loadOrder(req, req.params.id));
});

// ---------- entrega / cancelamento / reabertura ----------
r.post('/:id/deliver', need('orders_deliver'), async (req, res) => {
  const d = parse(paySchema.extend({ message: opt }), req.body);
  await tx(async (db) => {
    const { rows: [o] } = await db.query('select * from orders where id = $1 and company_id = $2 for update', [req.params.id, req.companyId]);
    if (!o) throw notFound();
    if (['entregue', 'cancelada'].includes(o.status)) throw bad('OS já entregue ou cancelada.');
    if (d.payments.length || d.installments.length) {
      if (!can(req, 'checkout')) throw new HttpError(403, 'Seu perfil não permite receber pagamentos.');
      await registerPayments(db, req, o, d);
    }
    const fin = await orderFinance(db, o.id);
    const balance = round2(o.total - (Number(fin.paid) - Number(fin.refunded)) - Number(fin.receivable));
    if (req.settings.orders.requirePaymentToDeliver && balance > 0.009) {
      throw bad(`Há saldo de ${balance.toFixed(2).replace('.', ',')} em aberto. Receba ou lance como "a receber" antes de entregar.`);
    }
    await db.query(
      `update orders set status='entregue', delivered_at=now(), finished_at=coalesce(finished_at, now()), updated_at=now(),
              warranty_until = case when warranty_days > 0 then (now() at time zone $2)::date + warranty_days end
        where id = $1`, [o.id, req.settings.timezone]);
    await logEvent(db, o.id, { type: 'status', from: o.status, to: 'entregue', message: d.message || null, isPublic: true, userId: req.user.id });
  });
  res.json(await loadOrder(req, req.params.id));
});

r.post('/:id/cancel', need('orders_cancel'), async (req, res) => {
  const d = parse(z.object({ reason: s.min(3, 'informe o motivo'), refund: z.boolean().default(true) }), req.body);
  await tx(async (db) => {
    const { rows: [o] } = await db.query('select * from orders where id = $1 and company_id = $2 for update', [req.params.id, req.companyId]);
    if (!o) throw notFound();
    if (o.status === 'cancelada') throw bad('OS já cancelada.');
    const { rows: [inv] } = await db.query("select count(*)::int as n from invoices where order_id = $1 and status = 'autorizada'", [o.id]);
    if (inv.n > 0) throw bad('Há nota fiscal autorizada para esta OS. Cancele a nota antes.');
    await db.query("delete from transactions where order_id = $1 and paid_at is null", [o.id]);
    const fin = await orderFinance(db, o.id);
    const paid = round2(Number(fin.paid) - Number(fin.refunded));
    if (paid > 0 && d.refund) {
      await db.query(
        `insert into transactions (company_id, type, category, description, amount, method, due_date, paid_at, order_id, customer_id, auto, created_by)
         values ($1,'saida','Estornos',$2,$3,'dinheiro',current_date, now(), $4, $5, true, $6)`,
        [req.companyId, `Estorno — ${o.kind === 'venda' ? 'Venda' : 'OS'} nº ${o.number}`, paid, o.id, o.customer_id, req.user.id]);
    }
    const { rows: [upd] } = await db.query(
      "update orders set status='cancelada', cancelled_at=now(), updated_at=now() where id=$1 returning *", [o.id]);
    await syncOrderStock(db, upd, req.user.id, req.settings);
    await logEvent(db, o.id, { type: 'status', from: o.status, to: 'cancelada', message: d.reason, isPublic: true, userId: req.user.id });
  });
  res.json(await loadOrder(req, req.params.id));
});

r.post('/:id/reopen', need('orders_edit'), async (req, res) => {
  await tx(async (db) => {
    const { rows: [o] } = await db.query('select * from orders where id = $1 and company_id = $2 for update', [req.params.id, req.companyId]);
    if (!o) throw notFound();
    if (!['entregue', 'cancelada'].includes(o.status)) throw bad('A OS já está aberta.');
    if (o.status === 'cancelada' && !can(req, 'orders_cancel')) throw new HttpError(403, 'Seu perfil não permite reabrir OS cancelada.');
    const to = o.kind === 'venda' ? 'aberta' : 'em_execucao';
    const { rows: [upd] } = await db.query(
      `update orders set status=$2, delivered_at=null, cancelled_at=null, warranty_until=null, updated_at=now() where id=$1 returning *`, [o.id, to]);
    await syncOrderStock(db, upd, req.user.id, req.settings);
    await logEvent(db, o.id, { type: 'status', from: o.status, to, message: 'OS reaberta', userId: req.user.id });
  });
  res.json(await loadOrder(req, req.params.id));
});

/** Venda de balcão em um passo: cria, recebe e entrega. */
r.post('/quick-sale', need('orders_create'), async (req, res) => {
  const d = parse(z.object({
    customer_id: z.string().uuid().nullable().optional(),
    items: z.array(itemSchema).min(1, 'inclua ao menos um item'),
    discount: z.coerce.number().min(0).default(0),
    notes: opt,
  }).merge(paySchema), req.body);
  if (!can(req, 'checkout')) throw new HttpError(403, 'Seu perfil não permite receber pagamentos.');
  checkDiscount(req, d);
  const out = await tx(async (db) => {
    const number = await nextNumber(db, 'orders', req.companyId);
    const { items, subtotal } = await prepareItems(db, req.companyId, d.items);
    const total = round2(subtotal - d.discount);
    if (total < 0) throw bad('Desconto maior que o total.');
    const { rows: [o] } = await db.query(
      `insert into orders (company_id, number, kind, customer_id, status, subtotal, discount, total, notes, public_token, created_by)
       values ($1,$2,'venda',$3,'aberta',$4,$5,$6,$7,$8,$9) returning *`,
      [req.companyId, number, d.customer_id || null, subtotal, d.discount, total, d.notes || null, publicToken(), req.user.id]);
    await insertItems(db, 'order_items', 'order_id', o.id, items);
    await syncOrderStock(db, o, req.user.id, req.settings);
    await logEvent(db, o.id, { type: 'criacao', to: 'aberta', message: 'Venda de balcão', userId: req.user.id });
    const change = total > 0 ? await registerPayments(db, req, o, d) : 0;
    if (d.installments.length && !d.customer_id) throw bad('Venda a prazo exige cliente identificado.');
    await db.query("update orders set status='entregue', delivered_at=now(), finished_at=now() where id=$1", [o.id]);
    await logEvent(db, o.id, { type: 'status', from: 'aberta', to: 'entregue', userId: req.user.id });
    return { id: o.id, change };
  });
  res.status(201).json({ change: out.change, order: await loadOrder(req, out.id) });
});

export { STATUS_LABEL };
export default r;
