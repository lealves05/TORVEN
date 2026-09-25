// Suprimentos: sugestão de compra, cotação com vários fornecedores, pedido de compra, recebimento conferido e separação para OS.
import { Router } from 'express';
import { z } from 'zod';
import { q, one, tx } from '../db.js';
import { need, can } from '../auth.js';
import { parse, notFound, bad, round2, HttpError } from '../util.js';
import { nextNumber } from '../domain.js';
import { audit } from '../audit.js';
import { save as savePurchase, receive as receivePurchase } from './purchases.js';

const r = Router();
const s = z.string().trim();
const opt = s.nullable().optional();
const uuidOpt = z.string().uuid().nullable().optional();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional();

// ---------- Sugestão de compra ----------
r.get('/suggestions', need('purchases', 'materials_manage'), async (req, res) => {
  const { rows } = await q(
    `with demand as (
       select i.product_id, sum(i.qty - i.picked_qty) as pending, array_agg(distinct o.number) as orders
         from order_items i join orders o on o.id = i.order_id
        where o.company_id = $1 and o.status in ('aberta','diagnostico','aguardando_aprovacao','aprovada','aguardando_material','em_execucao')
          and i.product_id is not null and i.kind in ('material','consumivel') and i.qty > i.picked_qty
        group by i.product_id),
     incoming as (
       select poi.product_id, sum(poi.qty - poi.qty_received) as qty
         from purchase_order_items poi join purchase_orders po on po.id = poi.purchase_order_id
        where po.company_id = $1 and po.status in ('rascunho','enviado','parcial') and poi.qty > poi.qty_received and poi.product_id is not null
        group by poi.product_id)
     select p.id, p.name, p.unit, p.stock, p.min_stock, p.max_stock, p.cost, p.lead_days, p.supplier_id, s.name as supplier_name,
            coalesce(d.pending, 0) as os_pending, d.orders, coalesce(inc.qty, 0) as incoming
       from products p left join suppliers s on s.id = p.supplier_id
       left join demand d on d.product_id = p.id left join incoming inc on inc.product_id = p.id
      where p.company_id = $1 and p.active
        and (p.stock + coalesce(inc.qty, 0) <= p.min_stock and p.min_stock > 0 or p.stock < 0)
      order by (p.stock - p.min_stock) asc, lower(p.name)`, [req.companyId]);
  res.json(rows.map((x) => {
    const target = Number(x.max_stock) > 0 ? Number(x.max_stock) : Math.max(Number(x.min_stock) * 2, Number(x.min_stock) + 1);
    const suggested = round2(Math.max(0, target - Number(x.stock) - Number(x.incoming)));
    return { ...x, suggested: suggested || round2(Math.max(0, -Number(x.stock))) };
  }).filter((x) => x.suggested > 0));
});

// ---------- Cotações ----------
const quotationSchema = z.object({
  title: s.min(2, 'informe um título'),
  due_date: date,
  notes: opt,
  supplier_ids: z.array(z.string().uuid()).min(1, 'escolha ao menos um fornecedor').max(10),
  items: z.array(z.object({
    product_id: uuidOpt, order_id: uuidOpt, description: s.min(1), unit: opt, qty: z.coerce.number().positive(),
  })).min(1, 'inclua ao menos um item').max(100),
});

async function checkIds(db, companyId, table, ids, label) {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return;
  const { rows } = await db.query(`select id from ${table} where company_id = $1 and id = any($2)`, [companyId, list]);
  if (rows.length !== list.length) throw notFound(`${label} não encontrado`);
}

async function loadQuotation(id, companyId, db = { query: q }) {
  const { rows: [qt] } = await db.query(
    `select qt.*, u.name as created_by_name from purchase_quotations qt left join users u on u.id = qt.created_by
      where qt.id = $1 and qt.company_id = $2`, [id, companyId]);
  if (!qt) throw notFound('Cotação não encontrada');
  const { rows: suppliers } = await db.query(
    `select s.id, s.name, s.phone, s.email from quotation_suppliers qs join suppliers s on s.id = qs.supplier_id
      where qs.quotation_id = $1 order by lower(s.name)`, [id]);
  const { rows: items } = await db.query(
    `select i.*, p.stock as product_stock, p.cost as last_cost, o.number as order_number from quotation_items i
       left join products p on p.id = i.product_id left join orders o on o.id = i.order_id where i.quotation_id = $1 order by i.position`, [id]);
  const { rows: prices } = await db.query(
    'select qp.* from quotation_prices qp join quotation_items i on i.id = qp.item_id where i.quotation_id = $1', [id]);
  const { rows: pos } = await db.query(
    `select po.id, po.number, po.status, po.total, s.name as supplier_name from purchase_orders po join suppliers s on s.id = po.supplier_id
      where po.quotation_id = $1 order by po.number`, [id]);
  const withPrices = items.map((i) => {
    const ps = prices.filter((p) => p.item_id === i.id);
    const best = ps.reduce((b, p) => (!b || Number(p.unit_cost) < Number(b.unit_cost) ? p : b), null);
    return { ...i, prices: ps, best_supplier_id: best?.supplier_id || null };
  });
  const totals = suppliers.map((sp) => {
    const quoted = withPrices.filter((i) => i.prices.some((p) => p.supplier_id === sp.id));
    return { supplier_id: sp.id, items_quoted: quoted.length,
      total: round2(quoted.reduce((a, i) => a + Number(i.qty) * Number(i.prices.find((p) => p.supplier_id === sp.id).unit_cost), 0)) };
  });
  return { ...qt, suppliers, items: withPrices, totals, purchase_orders: pos };
}

r.get('/quotations', need('purchases'), async (req, res) => {
  const { rows } = await q(
    `select qt.*, (select count(*) from quotation_items i where i.quotation_id = qt.id)::int as items_count,
            (select count(*) from quotation_suppliers x where x.quotation_id = qt.id)::int as suppliers_count
       from purchase_quotations qt where qt.company_id = $1 ${req.query.status ? 'and qt.status = $2' : ''}
      order by qt.created_at desc limit 500`, req.query.status ? [req.companyId, req.query.status] : [req.companyId]);
  res.json(rows);
});

r.get('/quotations/:id', need('purchases'), async (req, res) => res.json(await loadQuotation(req.params.id, req.companyId)));

r.post('/quotations', need('purchases'), async (req, res) => {
  const d = parse(quotationSchema, req.body);
  const id = await tx(async (db) => {
    await checkIds(db, req.companyId, 'suppliers', d.supplier_ids, 'Fornecedor');
    await checkIds(db, req.companyId, 'products', d.items.map((i) => i.product_id), 'Material');
    await checkIds(db, req.companyId, 'orders', d.items.map((i) => i.order_id), 'OS');
    const number = await nextNumber(db, 'purchase_quotations', req.companyId);
    const { rows: [qt] } = await db.query(
      `insert into purchase_quotations (company_id, number, title, due_date, notes, created_by) values ($1,$2,$3,$4,$5,$6) returning id`,
      [req.companyId, number, d.title, d.due_date || null, d.notes || null, req.user.id]);
    for (const sid of new Set(d.supplier_ids)) await db.query('insert into quotation_suppliers (quotation_id, supplier_id) values ($1,$2)', [qt.id, sid]);
    for (const [k, i] of d.items.entries()) {
      await db.query(
        'insert into quotation_items (quotation_id, product_id, order_id, description, unit, qty, position) values ($1,$2,$3,$4,$5,$6,$7)',
        [qt.id, i.product_id || null, i.order_id || null, i.description, i.unit || null, i.qty, k]);
    }
    await audit(db, req, { entity: 'purchase', entityId: qt.id, action: 'quotation', summary: `Cotação nº ${number} aberta com ${d.supplier_ids.length} fornecedor(es)` });
    return qt.id;
  });
  res.status(201).json(await loadQuotation(id, req.companyId));
});

/** Registra os preços informados pelos fornecedores. */
r.post('/quotations/:id/prices', need('purchases'), async (req, res) => {
  const d = parse(z.object({ prices: z.array(z.object({
    item_id: z.string().uuid(), supplier_id: z.string().uuid(), unit_cost: z.coerce.number().min(0).nullable(), lead_days: z.coerce.number().int().min(0).nullable().optional(), notes: opt,
  })).max(1000) }), req.body);
  await tx(async (db) => {
    const qt = await loadQuotation(req.params.id, req.companyId, db);
    if (qt.status !== 'aberta') throw bad('Cotação encerrada.');
    const itemIds = new Set(qt.items.map((i) => i.id));
    const supIds = new Set(qt.suppliers.map((x) => x.id));
    for (const p of d.prices) {
      if (!itemIds.has(p.item_id) || !supIds.has(p.supplier_id)) throw bad('Item ou fornecedor não pertence a esta cotação.');
      if (p.unit_cost == null) {
        await db.query('delete from quotation_prices where item_id = $1 and supplier_id = $2', [p.item_id, p.supplier_id]);
      } else {
        await db.query(
          `insert into quotation_prices (item_id, supplier_id, unit_cost, lead_days, notes) values ($1,$2,$3,$4,$5)
           on conflict (item_id, supplier_id) do update set unit_cost = excluded.unit_cost, lead_days = excluded.lead_days, notes = excluded.notes, updated_at = now()`,
          [p.item_id, p.supplier_id, p.unit_cost, p.lead_days ?? null, p.notes || null]);
      }
    }
  });
  await audit(null, req, { entity: 'price', entityId: req.params.id, action: 'quotation_prices', summary: `Preços da cotação atualizados (${d.prices.length} valor(es))` });
  res.json(await loadQuotation(req.params.id, req.companyId));
});

/** Fecha a cotação escolhendo o fornecedor de cada item e gera um pedido de compra por fornecedor. */
r.post('/quotations/:id/close', need('purchases'), async (req, res) => {
  const d = parse(z.object({ choices: z.array(z.object({ item_id: z.string().uuid(), supplier_id: z.string().uuid().nullable() })).min(1),
    expected_date: date }), req.body);
  const created = await tx(async (db) => {
    await db.query('select id from purchase_quotations where id = $1 and company_id = $2 for update', [req.params.id, req.companyId]);
    const qt = await loadQuotation(req.params.id, req.companyId, db);
    if (qt.status !== 'aberta') throw bad('Cotação já encerrada.');
    const bySupplier = {};
    for (const c of d.choices) {
      const item = qt.items.find((i) => i.id === c.item_id);
      if (!item) throw bad('Item não pertence a esta cotação.');
      if (!c.supplier_id) continue;
      const price = item.prices.find((p) => p.supplier_id === c.supplier_id);
      if (!price) throw bad(`O fornecedor escolhido não cotou "${item.description}".`);
      await db.query('update quotation_items set chosen_supplier_id = $2 where id = $1', [item.id, c.supplier_id]);
      (bySupplier[c.supplier_id] ??= []).push({ ...item, unit_cost: Number(price.unit_cost), lead_days: price.lead_days });
    }
    if (!Object.keys(bySupplier).length) throw bad('Escolha o fornecedor de ao menos um item.');
    const out = [];
    for (const [supplierId, items] of Object.entries(bySupplier)) {
      const number = await nextNumber(db, 'purchase_orders', req.companyId);
      const total = round2(items.reduce((a, i) => a + Number(i.qty) * i.unit_cost, 0));
      const lead = Math.max(0, ...items.map((i) => i.lead_days || 0));
      const expected = d.expected_date || (lead ? new Date(Date.now() + lead * 86400000).toISOString().slice(0, 10) : null);
      const { rows: [po] } = await db.query(
        `insert into purchase_orders (company_id, number, supplier_id, quotation_id, expected_date, total, created_by)
         values ($1,$2,$3,$4,$5,$6,$7) returning id, number`, [req.companyId, number, supplierId, qt.id, expected, total, req.user.id]);
      for (const [k, i] of items.entries()) {
        await db.query(
          `insert into purchase_order_items (purchase_order_id, product_id, order_id, description, unit, qty, unit_cost, position)
           values ($1,$2,$3,$4,$5,$6,$7,$8)`, [po.id, i.product_id, i.order_id, i.description, i.unit, i.qty, i.unit_cost, k]);
      }
      out.push(po);
    }
    await db.query("update purchase_quotations set status = 'fechada', closed_at = now() where id = $1", [qt.id]);
    await audit(db, req, { entity: 'purchase', entityId: qt.id, action: 'quotation_close', summary: `Cotação nº ${qt.number} fechada: ${out.length} pedido(s) de compra gerado(s)` });
    return out;
  });
  res.json({ purchase_orders: created, quotation: await loadQuotation(req.params.id, req.companyId) });
});

r.post('/quotations/:id/cancel', need('purchases'), async (req, res) => {
  const row = await one("update purchase_quotations set status = 'cancelada', closed_at = now() where id = $1 and company_id = $2 and status = 'aberta' returning id, number", [req.params.id, req.companyId]);
  if (!row) throw bad('Só cotações abertas podem ser canceladas.');
  await audit(null, req, { entity: 'purchase', entityId: row.id, action: 'quotation_cancel', summary: `Cotação nº ${row.number} cancelada` });
  res.json(await loadQuotation(row.id, req.companyId));
});

// ---------- Pedidos de compra ----------
async function loadPO(id, companyId, db = { query: q }) {
  const { rows: [po] } = await db.query(
    `select po.*, s.name as supplier_name, s.phone as supplier_phone, s.email as supplier_email, qt.number as quotation_number,
            u.name as created_by_name
       from purchase_orders po join suppliers s on s.id = po.supplier_id left join purchase_quotations qt on qt.id = po.quotation_id
       left join users u on u.id = po.created_by where po.id = $1 and po.company_id = $2`, [id, companyId]);
  if (!po) throw notFound('Pedido de compra não encontrado');
  const { rows: items } = await db.query(
    `select i.*, p.stock as product_stock, o.number as order_number from purchase_order_items i
       left join products p on p.id = i.product_id left join orders o on o.id = i.order_id where i.purchase_order_id = $1 order by i.position`, [id]);
  const { rows: receipts } = await db.query(
    'select id, number, invoice_number, status, total, received_at from purchases where purchase_order_id = $1 order by created_at', [id]);
  return { ...po, items, receipts };
}

r.get('/orders', need('purchases'), async (req, res) => {
  const params = [req.companyId];
  let where = 'po.company_id = $1';
  if (req.query.status === 'abertos') where += " and po.status in ('rascunho','enviado','parcial')";
  else if (req.query.status) { params.push(req.query.status); where += ` and po.status = $${params.length}`; }
  const { rows } = await q(
    `select po.*, s.name as supplier_name, (select count(*) from purchase_order_items i where i.purchase_order_id = po.id)::int as items_count
       from purchase_orders po join suppliers s on s.id = po.supplier_id where ${where} order by po.created_at desc limit 500`, params);
  res.json(rows);
});

r.get('/orders/:id', need('purchases'), async (req, res) => res.json(await loadPO(req.params.id, req.companyId)));

r.post('/orders', need('purchases'), async (req, res) => {
  const d = parse(z.object({
    supplier_id: z.string().uuid({ message: 'selecione o fornecedor' }), expected_date: date, notes: opt,
    items: z.array(z.object({ product_id: uuidOpt, order_id: uuidOpt, description: s.min(1), unit: opt, qty: z.coerce.number().positive(), unit_cost: z.coerce.number().min(0) })).min(1),
  }), req.body);
  const id = await tx(async (db) => {
    await checkIds(db, req.companyId, 'suppliers', [d.supplier_id], 'Fornecedor');
    await checkIds(db, req.companyId, 'products', d.items.map((i) => i.product_id), 'Material');
    await checkIds(db, req.companyId, 'orders', d.items.map((i) => i.order_id), 'OS');
    const number = await nextNumber(db, 'purchase_orders', req.companyId);
    const total = round2(d.items.reduce((a, i) => a + i.qty * i.unit_cost, 0));
    const { rows: [po] } = await db.query(
      `insert into purchase_orders (company_id, number, supplier_id, expected_date, total, notes, created_by) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [req.companyId, number, d.supplier_id, d.expected_date || null, total, d.notes || null, req.user.id]);
    for (const [k, i] of d.items.entries()) {
      await db.query(
        `insert into purchase_order_items (purchase_order_id, product_id, order_id, description, unit, qty, unit_cost, position) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [po.id, i.product_id || null, i.order_id || null, i.description, i.unit || null, i.qty, i.unit_cost, k]);
    }
    await audit(db, req, { entity: 'purchase', entityId: po.id, action: 'po_create', summary: `Pedido de compra nº ${number} criado — ${total}` });
    return po.id;
  });
  res.status(201).json(await loadPO(id, req.companyId));
});

/** Registra o envio ao fornecedor (o TORVEN não envia sozinho). */
r.post('/orders/:id/send', need('purchases'), async (req, res) => {
  const d = parse(z.object({ via: z.enum(['email', 'whatsapp', 'telefone', 'portal', 'presencial', 'outro']).default('email') }), req.body);
  const row = await one(
    `update purchase_orders set status = 'enviado', sent_at = now(), sent_via = $3 where id = $1 and company_id = $2 and status = 'rascunho' returning id, number`,
    [req.params.id, req.companyId, d.via]);
  if (!row) throw bad('Só pedidos em rascunho podem ser enviados.');
  await audit(null, req, { entity: 'purchase', entityId: row.id, action: 'po_send', summary: `Pedido de compra nº ${row.number} enviado via ${d.via}` });
  res.json(await loadPO(row.id, req.companyId));
});

r.post('/orders/:id/cancel', need('purchases'), async (req, res) => {
  const d = parse(z.object({ reason: s.min(3, 'informe o motivo') }), req.body);
  const row = await one(
    `update purchase_orders set status = 'cancelado', cancel_reason = $3 where id = $1 and company_id = $2 and status in ('rascunho','enviado') returning id, number`,
    [req.params.id, req.companyId, d.reason]);
  if (!row) throw bad('Pedido já recebido (total ou parcial) não pode ser cancelado.');
  await audit(null, req, { entity: 'purchase', entityId: row.id, action: 'po_cancel', summary: `Pedido de compra nº ${row.number} cancelado: ${d.reason}` });
  res.json(await loadPO(row.id, req.companyId));
});

/**
 * Recebimento conferido: gera a entrada de materiais (estoque, custo médio, contas a pagar) a partir do pedido,
 * com a quantidade realmente recebida, lote e certificado. Divergências ficam registradas.
 */
r.post('/orders/:id/receive', need('purchases'), async (req, res) => {
  const d = parse(z.object({
    invoice_number: opt, invoice_series: opt, invoice_key: opt, issue_date: date,
    freight: z.coerce.number().min(0).default(0), other: z.coerce.number().min(0).default(0), discount: z.coerce.number().min(0).default(0),
    notes: opt,
    items: z.array(z.object({
      po_item_id: z.string().uuid(), qty: z.coerce.number().min(0), unit_cost: z.coerce.number().min(0).optional(), lot: opt, certificate: opt,
    })).min(1),
    allow_over: z.boolean().default(false),
    installments: z.array(z.object({ due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), amount: z.coerce.number().positive(), method: opt, paid: z.boolean().default(false) })).default([]),
  }), req.body);
  const out = await tx(async (db) => {
    const { rows: [lock] } = await db.query('select id from purchase_orders where id = $1 and company_id = $2 for update', [req.params.id, req.companyId]);
    if (!lock) throw notFound('Pedido de compra não encontrado');
    const po = await loadPO(req.params.id, req.companyId, db);
    if (!['rascunho', 'enviado', 'parcial'].includes(po.status)) throw bad('Pedido encerrado.');
    const lines = [];
    const divergences = [];
    for (const r0 of d.items) {
      if (!r0.qty) continue;
      const it = po.items.find((i) => i.id === r0.po_item_id);
      if (!it) throw bad('Item não pertence a este pedido.');
      const pending = round2(Number(it.qty) - Number(it.qty_received));
      if (r0.qty > pending + 0.0005) {
        if (!d.allow_over) throw bad(`"${it.description}": recebido ${r0.qty} ${it.unit || ''}, pendente ${pending}. Confirme o recebimento acima do pedido.`);
        divergences.push(`${it.description}: +${round2(r0.qty - pending)} acima do pedido`);
      } else if (r0.qty < pending - 0.0005) divergences.push(`${it.description}: ${round2(pending - r0.qty)} ainda pendente`);
      const cost = r0.unit_cost ?? Number(it.unit_cost);
      if (Math.abs(cost - Number(it.unit_cost)) > 0.0001) divergences.push(`${it.description}: custo ${cost} (pedido ${Number(it.unit_cost)})`);
      lines.push({ product_id: it.product_id, description: it.description, unit: it.unit, qty: r0.qty, unit_cost: cost,
        lot: r0.lot, certificate: r0.certificate, po_item_id: it.id, qty_ordered: Number(it.qty) });
    }
    if (!lines.length) throw bad('Informe a quantidade recebida de ao menos um item.');
    const notes = [d.notes, divergences.length ? `Divergências: ${divergences.join('; ')}` : null].filter(Boolean).join('\n') || null;
    const { id: purchaseId } = await savePurchase(db, req, {
      supplier_id: po.supplier_id, invoice_number: d.invoice_number, invoice_series: d.invoice_series, invoice_key: d.invoice_key,
      issue_date: d.issue_date, items: lines, freight: d.freight, other: d.other, discount: d.discount, notes,
    });
    await db.query('update purchases set purchase_order_id = $2 where id = $1', [purchaseId, po.id]);
    await receivePurchase(db, req, purchaseId, { items: lines, installments: d.installments });
    for (const l of lines) await db.query('update purchase_order_items set qty_received = qty_received + $2 where id = $1', [l.po_item_id, l.qty]);
    const { rows: [st] } = await db.query(
      'select bool_and(qty_received >= qty - 0.0005) as done from purchase_order_items where purchase_order_id = $1', [po.id]);
    await db.query('update purchase_orders set status = $2 where id = $1', [po.id, st.done ? 'recebido' : 'parcial']);
    // OS aguardando este material: registra a chegada no histórico
    const osIds = [...new Set(po.items.filter((i) => i.order_id && lines.some((l) => l.po_item_id === i.id)).map((i) => i.order_id))];
    for (const oid of osIds) {
      await db.query(
        `insert into order_events (order_id, type, message, public, user_id) values ($1,'nota',$2,false,$3)`,
        [oid, `Material do pedido de compra nº ${po.number} recebido`, req.user.id]);
    }
    await audit(db, req, { entity: 'stock', entityId: purchaseId, action: 'po_receive',
      summary: `Recebimento do pedido nº ${po.number} (${st.done ? 'total' : 'parcial'})${divergences.length ? ` — ${divergences.length} divergência(s)` : ''}`,
      data: divergences.length ? { divergences } : null });
    return { purchaseId, done: st.done, divergences };
  });
  res.json({ ...(await loadPO(req.params.id, req.companyId)), purchase_id: out.purchaseId, divergences: out.divergences });
});

// ---------- Separação de materiais para OS ----------
r.get('/picking', need('materials_manage', 'purchases', 'orders_edit'), async (req, res) => {
  const { rows } = await q(
    `select i.id, i.order_id, i.product_id, i.description, i.unit, i.qty, i.picked_qty, i.picked_at, p.location, p.stock,
            o.number as order_number, o.status as order_status, o.priority, o.promised_at, c.name as customer_name, t.name as technician_name
       from order_items i join orders o on o.id = i.order_id left join products p on p.id = i.product_id
       left join customers c on c.id = o.customer_id left join technicians t on t.id = o.technician_id
      where o.company_id = $1 and o.status in ('aprovada','aguardando_material','em_execucao') and i.kind in ('material','consumivel')
        and i.product_id is not null ${req.query.all === '1' ? '' : 'and i.picked_qty < i.qty'}
      order by case o.priority when 'urgente' then 0 when 'alta' then 1 else 2 end, o.promised_at nulls last, o.number, i.position`, [req.companyId]);
  res.json(rows);
});

/** Confirma a separação física do material (o saldo já foi reservado/baixado ao lançar na OS). */
r.post('/picking/:itemId', need('materials_manage', 'orders_edit'), async (req, res) => {
  const d = parse(z.object({ qty: z.coerce.number().min(0) }), req.body);
  const row = await tx(async (db) => {
    const { rows: [it] } = await db.query(
      `select i.*, o.number as order_number, o.status from order_items i join orders o on o.id = i.order_id
        where i.id = $1 and o.company_id = $2 for update of i`, [req.params.itemId, req.companyId]);
    if (!it) throw notFound('Item não encontrado');
    if (['entregue', 'cancelada'].includes(it.status)) throw bad('OS encerrada.');
    if (d.qty > Number(it.qty) + 0.0005) throw bad(`Quantidade maior que a lançada na OS (${Number(it.qty)}).`);
    if (!can(req, 'materials_manage') && d.qty < Number(it.picked_qty)) throw new HttpError(403, 'Só o estoque pode desfazer uma separação.');
    const { rows: [x] } = await db.query(
      'update order_items set picked_qty = $2::numeric, picked_at = case when $2::numeric > 0 then now() end, picked_by = case when $2::numeric > 0 then $3::uuid end where id = $1 returning *',
      [it.id, d.qty, req.user.id]);
    await db.query(`insert into order_events (order_id, type, message, public, user_id) values ($1,'nota',$2,false,$3)`,
      [it.order_id, `Separado: ${d.qty} ${it.unit || ''} de ${it.description}`, req.user.id]);
    await audit(db, req, { entity: 'stock', entityId: it.id, action: 'picking', summary: `Separação OS nº ${it.order_number}: ${it.description} ${Number(it.picked_qty)} → ${d.qty}` });
    return x;
  });
  res.json(row);
});

export default r;
