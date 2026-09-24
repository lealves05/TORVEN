// Regras de negócio compartilhadas: numeração, itens, estoque, financeiro da OS.
import { z } from 'zod';
import { round2, bad, withDefaults } from './util.js';

/** Próximo número sequencial por empresa (orders, quotes, purchases). Deve rodar dentro de tx. */
export async function nextNumber(db, table, companyId) {
  await db.query('select id from companies where id = $1 for update', [companyId]);
  const { rows: [r] } = await db.query(`select coalesce(max(number), 0) + 1 as n from ${table} where company_id = $1`, [companyId]);
  return r.n;
}

export const itemSchema = z.object({
  kind: z.enum(['servico', 'material', 'avulso']),
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
    const catalogCost = i.kind === 'material' ? P[i.product_id]?.cost : S[i.service_id]?.cost;
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
    };
  });
  return { items: out, subtotal: round2(out.reduce((a, x) => a + x.total, 0)) };
}

export async function insertItems(db, table, fk, parentId, items) {
  await db.query(`delete from ${table} where ${fk} = $1`, [parentId]);
  const withComm = table === 'order_items';
  for (const i of items) {
    await db.query(
      `insert into ${table} (${fk}, position, kind, service_id, product_id, ${withComm ? 'technician_id, commission_rate, commission_value,' : ''}
         description, unit, qty, unit_price, unit_cost, discount, total)
       values ($1,$2,$3,$4,$5,${withComm ? '$12,$13,$14,' : ''}$6,$7,$8,$9,$10,$11,${withComm ? '$15' : '$12'})`,
      withComm
        ? [parentId, i.position, i.kind, i.service_id, i.product_id, i.description, i.unit, i.qty, i.unit_price, i.unit_cost, i.discount,
          i.technician_id, i.commission_rate, i.commission_value, i.total]
        : [parentId, i.position, i.kind, i.service_id, i.product_id, i.description, i.unit, i.qty, i.unit_price, i.unit_cost, i.discount, i.total],
    );
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
      where order_id = $1 and kind = 'material' and product_id is not null group by product_id`, [order.id]);
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
