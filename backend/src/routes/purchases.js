// Entrada de materiais (compras / notas de fornecedor).
import { Router } from 'express';
import { z } from 'zod';
import { q, one, tx } from '../db.js';
import { need } from '../auth.js';
import { parse, notFound, bad, round2 } from '../util.js';
import { nextNumber, moveStock } from '../domain.js';

const r = Router();
r.use(need('purchases'));

const s = z.string().trim();
const opt = s.nullable().optional();
const schema = z.object({
  supplier_id: z.string().uuid().nullable().optional(),
  invoice_number: opt, invoice_series: opt, invoice_key: opt,
  issue_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  items: z.array(z.object({
    product_id: z.string().uuid().nullable().optional(),
    description: s.min(1, 'descrição obrigatória'),
    unit: opt,
    category: opt,
    qty: z.coerce.number().positive('quantidade deve ser maior que zero'),
    unit_cost: z.coerce.number().min(0),
    sale_price: z.coerce.number().min(0).optional(),
    lot: opt, certificate: opt,
    po_item_id: z.string().uuid().nullable().optional(),
    qty_ordered: z.coerce.number().min(0).nullable().optional(),
  })).min(1, 'inclua ao menos um item'),
  freight: z.coerce.number().min(0).default(0),
  other: z.coerce.number().min(0).default(0),
  discount: z.coerce.number().min(0).default(0),
  notes: opt,
  receive: z.boolean().default(false),
  installments: z.array(z.object({
    due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    amount: z.coerce.number().positive(),
    method: z.string().nullable().optional(),
    paid: z.boolean().default(false),
  })).default([]),
});

const list = async (companyId, where = '', params = []) => (await q(
  `select p.*, s.name as supplier_name, u.name as created_by_name,
          (select count(*) from purchase_items i where i.purchase_id = p.id)::int as items_count
     from purchases p left join suppliers s on s.id = p.supplier_id left join users u on u.id = p.created_by
    where p.company_id = $1 ${where} order by p.created_at desc limit 500`, [companyId, ...params])).rows;

r.get('/', async (req, res) => {
  const params = [];
  let where = '';
  if (req.query.status) { params.push(req.query.status); where += ` and p.status = $${params.length + 1}`; }
  if (req.query.from) { params.push(req.query.from); where += ` and p.created_at >= $${params.length + 1}::date`; }
  if (req.query.to) { params.push(req.query.to); where += ` and p.created_at < $${params.length + 1}::date + 1`; }
  res.json(await list(req.companyId, where, params));
});

async function full(id, companyId) {
  const p = await one(
    `select p.*, s.name as supplier_name, s.document as supplier_document from purchases p
       left join suppliers s on s.id = p.supplier_id where p.id = $1 and p.company_id = $2`, [id, companyId]);
  if (!p) throw notFound();
  const { rows: items } = await q(
    `select i.*, pr.name as product_name, pr.stock as product_stock, pr.price as product_price
       from purchase_items i left join products pr on pr.id = i.product_id where i.purchase_id = $1 order by position`, [id]);
  const { rows: payables } = await q('select * from transactions where purchase_id = $1 order by due_date', [id]);
  return { ...p, items, payables };
}

r.get('/:id', async (req, res) => res.json(await full(req.params.id, req.companyId)));

export async function save(db, req, d, existing) {
  const subtotal = round2(d.items.reduce((a, i) => a + i.qty * i.unit_cost, 0));
  const total = round2(subtotal + d.freight + d.other - d.discount);
  if (total < 0) throw bad('Desconto maior que o total da compra.');
  let id = existing?.id;
  const vals = [d.supplier_id || null, d.invoice_number || null, d.invoice_series || null, d.invoice_key || null,
    d.issue_date || null, subtotal, d.freight, d.other, d.discount, total, d.notes || null];
  if (existing) {
    await db.query(
      `update purchases set supplier_id=$1, invoice_number=$2, invoice_series=$3, invoice_key=$4, issue_date=$5,
              subtotal=$6, freight=$7, other=$8, discount=$9, total=$10, notes=$11 where id=$12`, [...vals, id]);
  } else {
    const number = await nextNumber(db, 'purchases', req.companyId);
    const { rows: [p] } = await db.query(
      `insert into purchases (company_id, number, supplier_id, invoice_number, invoice_series, invoice_key, issue_date,
              subtotal, freight, other, discount, total, notes, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning id`,
      [req.companyId, number, ...vals, req.user.id]);
    id = p.id;
  }
  await db.query('delete from purchase_items where purchase_id = $1', [id]);
  for (const [position, i] of d.items.entries()) {
    await db.query(
      `insert into purchase_items (purchase_id, product_id, description, unit, qty, unit_cost, total, position, lot, certificate, po_item_id, qty_ordered)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [id, i.product_id || null, i.description, i.unit || null, i.qty, i.unit_cost, round2(i.qty * i.unit_cost), position,
        i.lot || null, i.certificate || null, i.po_item_id || null, i.qty_ordered ?? null]);
  }
  return { id, subtotal, total };
}

export async function receive(db, req, id, d) {
  const { rows: [p] } = await db.query('select * from purchases where id = $1 for update', [id]);
  if (p.status !== 'rascunho') throw bad('Esta entrada já foi processada.');
  const { rows: items } = await db.query('select * from purchase_items where purchase_id = $1 order by position', [id]);
  // rateio de frete/outras despesas/desconto no custo unitário
  const factor = p.subtotal > 0 ? p.total / p.subtotal : 1;
  const extra = Object.fromEntries((d?.items || []).map((i, k) => [k, i]));
  for (const [k, it] of items.entries()) {
    let pid = it.product_id;
    const unitCost = Math.round(it.unit_cost * factor * 10000) / 10000;
    if (!pid) {
      const { rows: [np] } = await db.query(
        `insert into products (company_id, name, unit, category, cost, price, supplier_id)
         values ($1,$2,$3,$4,$5,$6,$7) returning id`,
        [req.companyId, it.description, it.unit || 'un', extra[k]?.category || null, unitCost, extra[k]?.sale_price || 0, p.supplier_id]);
      pid = np.id;
      await db.query('update purchase_items set product_id = $1 where id = $2', [pid, it.id]);
    } else {
      const { rows: [pr] } = await db.query('select stock, cost from products where id = $1 and company_id = $2 for update', [pid, req.companyId]);
      if (!pr) throw bad(`Material do item "${it.description}" não encontrado.`);
      const base = Math.max(Number(pr.stock), 0);
      const avg = (base * Number(pr.cost) + Number(it.qty) * unitCost) / (base + Number(it.qty));
      await db.query('update products set cost = $1, supplier_id = coalesce(supplier_id, $2) where id = $3',
        [Math.round(avg * 10000) / 10000, p.supplier_id, pid]);
      if (extra[k]?.sale_price) await db.query('update products set price = $1 where id = $2', [extra[k].sale_price, pid]);
    }
    await moveStock(db, { companyId: req.companyId, productId: pid, qty: Number(it.qty), type: 'entrada',
      reason: `Entrada nº ${p.number}${p.invoice_number ? ` — NF ${p.invoice_number}` : ''}`, unitCost, purchaseId: id, userId: req.user.id });
  }
  // contas a pagar
  const inst = d?.installments || [];
  if (inst.length) {
    const sum = round2(inst.reduce((a, x) => a + x.amount, 0));
    if (Math.abs(sum - p.total) > 0.05) throw bad(`As parcelas somam ${sum.toFixed(2)}, mas o total da entrada é ${Number(p.total).toFixed(2)}.`);
    const { rows: [session] } = await db.query('select id from cash_sessions where company_id=$1 and closed_at is null limit 1', [req.companyId]);
    for (const [k, x] of inst.entries()) {
      await db.query(
        `insert into transactions (company_id, type, category, description, amount, method, due_date, paid_at, cash_session_id,
                                   purchase_id, supplier_id, document, auto, created_by)
         values ($1,'saida','Compra de materiais',$2,$3,$4,$5, case when $6 then now() end, $7, $8, $9, $10, true, $11)`,
        [req.companyId, `Entrada nº ${p.number}${inst.length > 1 ? ` (${k + 1}/${inst.length})` : ''}`, x.amount, x.method || null,
          x.due_date, x.paid, x.paid ? session?.id || null : null, id, p.supplier_id, p.invoice_number, req.user.id]);
    }
  }
  await db.query("update purchases set status = 'recebida', received_at = now() where id = $1", [id]);
}

r.post('/', async (req, res) => {
  const d = parse(schema, req.body);
  const id = await tx(async (db) => {
    const { id: pid } = await save(db, req, d);
    if (d.receive) await receive(db, req, pid, d);
    return pid;
  });
  res.status(201).json(await full(id, req.companyId));
});

r.put('/:id', async (req, res) => {
  const d = parse(schema, req.body);
  await tx(async (db) => {
    const { rows: [cur] } = await db.query('select * from purchases where id = $1 and company_id = $2 for update', [req.params.id, req.companyId]);
    if (!cur) throw notFound();
    if (cur.status !== 'rascunho') throw bad('Só é possível editar entradas em rascunho.');
    await save(db, req, d, cur);
    if (d.receive) await receive(db, req, cur.id, d);
  });
  res.json(await full(req.params.id, req.companyId));
});

r.post('/:id/cancel', async (req, res) => {
  await tx(async (db) => {
    const { rows: [p] } = await db.query('select * from purchases where id = $1 and company_id = $2 for update', [req.params.id, req.companyId]);
    if (!p) throw notFound();
    if (p.status === 'cancelada') throw bad('Entrada já cancelada.');
    if (p.status === 'recebida') {
      const { rows: items } = await db.query('select * from purchase_items where purchase_id = $1 and product_id is not null', [p.id]);
      for (const it of items) {
        await moveStock(db, { companyId: req.companyId, productId: it.product_id, qty: -Number(it.qty), type: 'saida',
          reason: `Cancelamento da entrada nº ${p.number}`, purchaseId: p.id, userId: req.user.id });
      }
      const { rows: [{ n }] } = await db.query('select count(*)::int as n from transactions where purchase_id = $1 and paid_at is not null', [p.id]);
      if (n > 0) throw bad('Há parcelas já pagas desta entrada. Estorne/exclua os pagamentos no financeiro antes de cancelar.');
      await db.query('delete from transactions where purchase_id = $1', [p.id]);
    }
    if (p.purchase_order_id && p.status === 'recebida') {
      await db.query(
        `update purchase_order_items poi set qty_received = greatest(0, poi.qty_received - pi.qty)
           from purchase_items pi where pi.purchase_id = $1 and pi.po_item_id = poi.id`, [p.id]);
      await db.query(
        `update purchase_orders po set status = case
            when not exists (select 1 from purchase_order_items i where i.purchase_order_id = po.id and i.qty_received > 0) then 'enviado'
            else 'parcial' end where po.id = $1 and po.status in ('parcial','recebido')`, [p.purchase_order_id]);
    }
    await db.query("update purchases set status = 'cancelada' where id = $1", [p.id]);
  });
  res.json(await full(req.params.id, req.companyId));
});

r.delete('/:id', async (req, res) => {
  const p = await one("delete from purchases where id = $1 and company_id = $2 and status = 'rascunho' returning id", [req.params.id, req.companyId]);
  if (!p) throw bad('Só é possível excluir entradas em rascunho. Use cancelar.');
  res.status(204).end();
});

export default r;
