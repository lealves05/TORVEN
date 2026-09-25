// Materiais (estoque) e movimentações.
import { Router } from 'express';
import { z } from 'zod';
import { q, one, tx } from '../db.js';
import { need, can } from '../auth.js';
import { parse, notFound, bad, round2 } from '../util.js';
import { moveStock } from '../domain.js';

const r = Router();
const s = z.string().trim();
const opt = s.nullable().optional();
const schema = z.object({
  name: s.min(2, 'informe o nome'), sku: opt, barcode: opt, category: opt, unit: s.min(1).default('un'),
  cost: z.coerce.number().min(0).default(0), price: z.coerce.number().min(0).default(0),
  min_stock: z.coerce.number().min(0).default(0), max_stock: z.coerce.number().min(0).nullable().optional(), lead_days: z.coerce.number().int().min(0).nullable().optional(), location: opt, ncm: opt, cfop: opt,
  origin: z.coerce.number().int().min(0).max(8).default(0), supplier_id: z.string().uuid().nullable().optional(),
  active: z.boolean().optional(),
});
const COLS = Object.keys(schema.shape);

r.get('/', async (req, res) => {
  const params = [req.companyId];
  let where = 'p.company_id = $1';
  if (req.query.all !== '1') where += ' and p.active';
  if (req.query.low === '1') where += ' and p.stock <= p.min_stock';
  if (req.query.category) { params.push(req.query.category); where += ` and p.category = $${params.length}`; }
  if (req.query.search) {
    params.push(`%${String(req.query.search).toLowerCase()}%`);
    where += ` and (lower(p.name) like $${params.length} or lower(coalesce(p.sku,'')) like $${params.length} or coalesce(p.barcode,'') like $${params.length})`;
  }
  const { rows } = await q(
    `select p.*, s.name as supplier_name, round(p.stock * p.cost, 2) as stock_value
       from products p left join suppliers s on s.id = p.supplier_id
      where ${where} order by p.category nulls last, lower(p.name) limit 2000`, params);
  const hideCost = !can(req, 'materials_manage') && !can(req, 'purchases');
  res.json(hideCost ? rows.map(({ cost, stock_value, ...x }) => x) : rows);
});

r.get('/:id/movements', need('materials_manage', 'purchases'), async (req, res) => {
  const { rows } = await q(
    `select m.*, u.name as user_name, o.number as order_number, o.kind as order_kind, pu.number as purchase_number
       from stock_movements m left join users u on u.id = m.created_by
       left join orders o on o.id = m.order_id left join purchases pu on pu.id = m.purchase_id
      where m.product_id = $1 and m.company_id = $2 order by m.created_at desc limit 300`, [req.params.id, req.companyId]);
  res.json(rows);
});

r.post('/', need('materials_manage', 'purchases'), async (req, res) => {
  const d = parse(schema.extend({ stock: z.coerce.number().default(0) }), req.body);
  const p = await tx(async (db) => {
    const keys = COLS.filter((k) => d[k] !== undefined);
    const { rows: [row] } = await db.query(
      `insert into products (company_id, ${keys.join(',')}) values ($1, ${keys.map((_, i) => `$${i + 2}`).join(',')}) returning *`,
      [req.companyId, ...keys.map((k) => d[k])]);
    if (d.stock) {
      await moveStock(db, { companyId: req.companyId, productId: row.id, qty: d.stock, type: 'ajuste',
        reason: 'Estoque inicial', unitCost: d.cost, userId: req.user.id });
    }
    return (await db.query('select * from products where id = $1', [row.id])).rows[0];
  });
  res.status(201).json(p);
});

r.put('/:id', need('materials_manage'), async (req, res) => {
  const d = parse(schema.partial(), req.body);
  const keys = COLS.filter((k) => d[k] !== undefined);
  const p = await one(
    `update products set ${keys.map((k, i) => `${k} = $${i + 3}`).join(', ')} where id = $1 and company_id = $2 returning *`,
    [req.params.id, req.companyId, ...keys.map((k) => d[k])]);
  if (!p) throw notFound();
  res.json(p);
});

r.delete('/:id', need('materials_manage'), async (req, res) => {
  await q('update products set active = false where id = $1 and company_id = $2', [req.params.id, req.companyId]);
  res.status(204).end();
});

/** Entrada, saída avulsa ou inventário (define saldo). */
r.post('/:id/adjust', need('materials_manage'), async (req, res) => {
  const d = parse(z.object({
    type: z.enum(['entrada', 'saida', 'inventario']),
    qty: z.coerce.number().min(0),
    reason: s.min(2, 'informe o motivo'),
    unit_cost: z.coerce.number().min(0).optional(),
  }), req.body);
  const out = await tx(async (db) => {
    const { rows: [p] } = await db.query('select * from products where id = $1 and company_id = $2 for update', [req.params.id, req.companyId]);
    if (!p) throw notFound();
    let qty = d.qty;
    if (d.type === 'saida') qty = -d.qty;
    if (d.type === 'inventario') qty = round2(d.qty - Number(p.stock));
    if (qty === 0) throw bad('O saldo informado é igual ao atual.');
    if (d.type === 'entrada' && d.unit_cost != null && d.qty > 0) {
      // custo médio ponderado
      const base = Math.max(Number(p.stock), 0);
      const avg = (base * Number(p.cost) + d.qty * d.unit_cost) / (base + d.qty);
      await db.query('update products set cost = $1 where id = $2', [Math.round(avg * 10000) / 10000, p.id]);
    }
    const stock = await moveStock(db, { companyId: req.companyId, productId: p.id, qty,
      type: d.type === 'inventario' ? 'ajuste' : d.type, reason: d.reason, unitCost: d.unit_cost ?? p.cost, userId: req.user.id });
    return { stock };
  });
  res.json(out);
});

export default r;
