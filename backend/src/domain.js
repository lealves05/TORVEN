// Regras de negócio compartilhadas: numeração, itens, estoque, financeiro da OS.
import { z } from 'zod';
import { round2, bad, withDefaults } from './util.js';

/** Próximo número sequencial por empresa (orders, quotes, purchases). Deve rodar dentro de tx. */
export async function nextNumber(db, table, companyId) {
  await db.query('select id from companies where id = $1 for update', [companyId]);
  const { rows: [r] } = await db.query(`select coalesce(max(number), 0) + 1 as n from ${table} where company_id = $1`, [companyId]);
  return r.n;
}

export const ITEM_KINDS = ['servico', 'material', 'consumivel', 'deslocamento', 'terceiro', 'outro', 'avulso'];
/** Itens que movimentam estoque (têm material vinculado). */
export const isGoods = (i) => ['material', 'consumivel'].includes(i.kind) && !!i.product_id;

export const itemSchema = z.object({
  kind: z.enum(ITEM_KINDS),
  optional: z.boolean().optional(),
  approved: z.boolean().nullable().optional(),
  group_label: z.string().trim().nullable().optional(),
  notes: z.string().trim().nullable().optional(),
  service_id: z.string().uuid().nullable().optional(),
  product_id: z.string().uuid().nullable().optional(),
  technician_id: z.string().uuid().nullable().optional(),
  description: z.string().trim().min(1, 'descrição do item obrigatória'),
  unit: z.string().trim().nullable().optional(),
  qty: z.coerce.number().positive('quantidade deve ser maior que zero'),
  unit_price: z.coerce.number().min(0),
  unit_cost: z.coerce.number().min(0).optional(),
  discount: z.coerce.number().min(0).default(0),
});

/**
 * Normaliza itens: busca custo/comissão do catálogo, calcula totais.
 * Retorna { items, subtotal } com total por item = qty*unit_price - discount.
 */
export async function prepareItems(db, companyId, items, { defaultTechnician = null } = {}) {
  const svcIds = items.filter((i) => i.service_id).map((i) => i.service_id);
  const prodIds = items.filter((i) => i.product_id).map((i) => i.product_id);
  const svcs = svcIds.length
    ? (await db.query('select id, cost, commission_rate, unit from services where company_id=$1 and id = any($2)', [companyId, svcIds])).rows : [];
  const prods = prodIds.length
    ? (await db.query('select id, cost, unit from products where company_id=$1 and id = any($2)', [companyId, prodIds])).rows : [];
  const techIds = [...new Set(items.map((i) => i.technician_id || defaultTechnician).filter(Boolean))];
  const techs = techIds.length
    ? (await db.query('select id, commission_rate from technicians where company_id=$1 and id = any($2)', [companyId, techIds])).rows : [];
  const S = Object.fromEntries(svcs.map((x) => [x.id, x]));
  const P = Object.fromEntries(prods.map((x) => [x.id, x]));
  const T = Object.fromEntries(techs.map((x) => [x.id, x]));

  const out = items.map((i, position) => {
    if (i.kind === 'servico' && i.service_id && !S[i.service_id]) throw bad('Serviço não encontrado.');
    if (i.kind === 'material' && !i.product_id) throw bad(`Selecione o material do item "${i.description}".`);
    if (i.product_id && !P[i.product_id]) throw bad('Material não encontrado.');
    const gross = round2(i.qty * i.unit_price);
    if (i.discount > gross) throw bad(`Desconto maior que o valor do item "${i.description}".`);
    const total = round2(gross - (i.discount || 0));
    const technician_id = i.kind === 'servico' ? (i.technician_id || defaultTechnician || null) : (i.technician_id || null);
    const catalogCost = i.product_id ? P[i.product_id]?.cost : S[i.service_id]?.cost;
    const unit_cost = i.unit_cost ?? catalogCost ?? 0;
    let commission_rate = 0;
    if (i.kind === 'servico' && technician_id) {
      commission_rate = Number(S[i.service_id]?.commission_rate ?? T[technician_id]?.commission_rate ?? 0);
    }
    return {
      position, kind: i.kind, service_id: i.service_id || null, product_id: i.product_id || null, technician_id,
      description: i.description, unit: i.unit || P[i.product_id]?.unit || S[i.service_id]?.unit || (i.kind === 'servico' ? 'serv' : 'un'),
      qty: i.qty, unit_price: i.unit_price, unit_cost, discount: i.discount || 0, total,
      commission_rate, commission_value: round2(total * commission_rate / 100),
      optional: !!i.optional, approved: i.approved ?? null, group_label: i.group_label || null, notes: i.notes || null,
    };
  });
  const counted = out.filter((x) => !x.optional);
  return {
    items: out,
    subtotal: round2(counted.reduce((a, x) => a + x.total, 0)),
    cost: round2(counted.reduce((a, x) => a + x.qty * Number(x.unit_cost || 0), 0)),
  };
}

export async function insertItems(db, table, fk, parentId, items) {
  // separação física já confirmada é preservada ao reeditar os itens da OS
  const picked = {};
  if (table === 'order_items') {
    const { rows } = await db.query(
      `select product_id, sum(picked_qty) as q, max(picked_at) as at, (array_agg(picked_by))[1] as by from order_items
        where order_id = $1 and picked_qty > 0 and product_id is not null group by product_id`, [parentId]);
    for (const x of rows) picked[x.product_id] = { q: Number(x.q), at: x.at, by: x.by };
  }
  await db.query(`delete from ${table} where ${fk} = $1`, [parentId]);
  const cols = ['position', 'kind', 'service_id', 'product_id', 'description', 'unit', 'qty', 'unit_price', 'unit_cost', 'discount', 'total',
    ...(table === 'order_items' ? ['technician_id', 'commission_rate', 'commission_value'] : ['optional', 'approved', 'group_label', 'notes'])];
  for (const i of items) {
    await db.query(
      `insert into ${table} (${fk}, ${cols.join(', ')}) values ($1, ${cols.map((_, k) => `$${k + 2}`).join(', ')})`,
      [parentId, ...cols.map((c) => i[c] ?? null)]);
  }
  for (const [pid, p] of Object.entries(picked)) {
    let left = p.q;
    const { rows } = await db.query('select id, qty from order_items where order_id = $1 and product_id = $2 order by position', [parentId, pid]);
    for (const it of rows) {
      if (left <= 0) break;
      const take = Math.min(left, Number(it.qty));
      await db.query('update order_items set picked_qty = $2, picked_at = $3, picked_by = $4 where id = $1', [it.id, take, p.at, p.by]);
      left -= take;
    }
  }
}

/** Movimenta o estoque de um produto e grava o histórico. qty positivo entra, negativo sai. */
export async function moveStock(db, { companyId, productId, qty, type, reason, unitCost = null, orderId = null, purchaseId = null, userId = null, allowNegative = true }) {
  const { rows: [p] } = await db.query(
    'update products set stock = stock + $1 where id = $2 and company_id = $3 returning stock, name', [qty, productId, companyId]);
  if (!p) throw bad('Material não encontrado.');
  if (!allowNegative && p.stock < 0) throw bad(`Estoque insuficiente de "${p.name}" (ficaria ${p.stock}).`);
  await db.query(
    `insert into stock_movements (company_id, product_id, type, qty, balance_after, unit_cost, reason, order_id, purchase_id, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [companyId, productId, type, qty, p.stock, unitCost, reason, orderId, purchaseId, userId]);
  return p.stock;
}

/**
 * Sincroniza o estoque com os materiais da OS: o consumo registrado passa a ser
 * exatamente o que está nos itens (ou zero se a OS estiver cancelada).
 */
export async function syncOrderStock(db, order, userId, settings) {
  const allowNegative = withDefaults(settings).orders.allowNegativeStock;
  const { rows: want } = await db.query(
    `select product_id, sum(qty) as qty, max(unit_cost) as unit_cost from order_items
      where order_id = $1 and kind in ('material','consumivel') and product_id is not null group by product_id`, [order.id]);
  const { rows: have } = await db.query(
    'select product_id, -sum(qty) as qty from stock_movements where order_id = $1 group by product_id', [order.id]);
  const W = Object.fromEntries(want.map((x) => [x.product_id, order.status === 'cancelada' ? 0 : Number(x.qty)]));
  const H = Object.fromEntries(have.map((x) => [x.product_id, Number(x.qty)]));
  const label = order.kind === 'venda' ? `Venda nº ${order.number}` : `OS nº ${order.number}`;
  for (const pid of new Set([...Object.keys(W), ...Object.keys(H)])) {
    const diff = round2((W[pid] || 0) - (H[pid] || 0));
    if (Math.abs(diff) < 0.0005) continue;
    await moveStock(db, {
      companyId: order.company_id, productId: pid, qty: -diff, type: diff > 0 ? 'saida' : 'entrada',
      reason: diff > 0 ? `Consumo — ${label}` : `Devolução — ${label}`, orderId: order.id, userId,
      allowNegative: diff > 0 ? allowNegative : true,
    });
  }
}

export async function logEvent(db, orderId, { type = 'nota', from = null, to = null, message = null, isPublic = false, userId = null }) {
  await db.query(
    `insert into order_events (order_id, type, from_status, to_status, message, public, user_id)
     values ($1,$2,$3,$4,$5,$6,$7)`, [orderId, type, from, to, message, isPublic, userId]);
}

/** Resumo financeiro de uma OS a partir dos lançamentos. */
export async function orderFinance(db, orderId) {
  const { rows: [f] } = await db.query(
    `select coalesce(sum(amount) filter (where type='entrada' and paid_at is not null and category <> 'Taxas de cartão'), 0) as paid,
            coalesce(sum(amount) filter (where type='entrada' and paid_at is null), 0) as receivable,
            coalesce(sum(amount) filter (where type='saida' and category = 'Estornos'), 0) as refunded
       from transactions where order_id = $1`, [orderId]);
  return f;
}

export const STATUS_LABEL = {
  aberta: 'Recebida', diagnostico: 'Em diagnóstico', aguardando_aprovacao: 'Aguardando aprovação',
  aprovada: 'Aprovada', aguardando_material: 'Aguardando material', em_execucao: 'Em execução',
  pronta: 'Pronta para entrega', entregue: 'Entregue', cancelada: 'Cancelada',
};

export const DEFAULT_CHECKLISTS = [
  { name: 'Inspeção final de solda', kind: 'inspecao', items: [
    'Inspeção visual do cordão (trincas, porosidade, mordedura)', 'Dimensões conferidas com o pedido', 'Alinhamento e esquadro',
    'Rebarbas removidas / acabamento', 'Teste funcional (quando aplicável)', 'Limpeza da peça'] },
  { name: 'Entrega ao cliente', kind: 'entrega', items: [
    'Serviço demonstrado ao cliente', 'Peças substituídas devolvidas/descartadas conforme combinado', 'Garantia explicada', 'Acessórios devolvidos'] },
];

/** Estrutura mínima de uma empresa nova: unidade principal e checklists padrão. */
export async function ensureCompanyDefaults(db, companyId) {
  await db.query(`insert into units (company_id, name, is_default) select $1, 'Matriz', true
                   where not exists (select 1 from units where company_id = $1)`, [companyId]);
  await db.query(`insert into financial_accounts (company_id, name, kind, is_default_cash) select $1, 'Caixa da oficina', 'caixa', true
                   where not exists (select 1 from financial_accounts where company_id = $1 and is_default_cash)`, [companyId]);
  await db.query(`insert into financial_accounts (company_id, name, kind, is_default_bank) select $1, 'Conta bancária principal', 'banco', true
                   where not exists (select 1 from financial_accounts where company_id = $1 and is_default_bank)`, [companyId]);
  for (const t of DEFAULT_CHECKLISTS) {
    await db.query(`insert into checklist_templates (company_id, name, kind, items) select $1, $2, $3, $4
                     where not exists (select 1 from checklist_templates where company_id = $1 and kind = $3)`,
    [companyId, t.name, t.kind, JSON.stringify(t.items)]);
  }
}

/** Recalcula minutos e custo real de mão de obra da OS a partir dos apontamentos. */
export async function refreshLabor(db, orderId) {
  await db.query(
    `update orders set labor_minutes = coalesce((select sum(minutes) from order_time_logs where order_id = $1 and ended_at is not null), 0),
                       labor_cost = coalesce((select sum(cost) from order_time_logs where order_id = $1 and ended_at is not null), 0)
      where id = $1`, [orderId]);
}
