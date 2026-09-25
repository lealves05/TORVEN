// Orçamentos: revisões versionadas, itens opcionais/alternativos, aprovação total ou parcial registrada.
import { Router } from 'express';
import { z } from 'zod';
import { q, one, tx } from '../db.js';
import { need, can } from '../auth.js';
import { parse, notFound, bad, round2, publicToken, HttpError } from '../util.js';
import { nextNumber, itemSchema, prepareItems, insertItems, syncOrderStock, logEvent } from '../domain.js';
import { audit } from '../audit.js';
import { syncRequestFromQuote } from './requests.js';

const r = Router();
r.use(need('quotes_view', 'quotes', 'quotes_approve'));

export const QUOTE_STATUS = {
  rascunho: 'Rascunho', enviado: 'Enviado', aguardando_decisao: 'Aguardando decisão', aprovado: 'Aprovado',
  parcialmente_aprovado: 'Parcialmente aprovado', recusado: 'Recusado', vencido: 'Vencido', convertido: 'Convertido em OS',
};
const SENT = ['enviado', 'aguardando_decisao'];
const APPROVED = ['aprovado', 'parcialmente_aprovado'];
const VIAS = ['presencial', 'telefone', 'whatsapp', 'email', 'link', 'assinatura', 'outro'];

const s = z.string().trim();
const opt = s.nullable().optional();
const schema = z.object({
  customer_id: z.string().uuid({ message: 'selecione o cliente' }),
  equipment_id: z.string().uuid().nullable().optional(),
  equipment: z.object({ category: opt, description: s.min(2), brand: opt, model: opt, serial: opt, material: opt, dimensions: opt }).nullable().optional(),
  technician_id: z.string().uuid().nullable().optional(),
  unit_id: z.string().uuid().nullable().optional(),
  request_id: z.string().uuid().nullable().optional(),
  title: s.min(2, 'informe o título do orçamento'),
  description: opt,
  scope: opt,
  assumptions: opt,
  exclusions: opt,
  items: z.array(itemSchema).min(1, 'inclua ao menos um item'),
  discount: z.coerce.number().min(0).default(0),
  surcharge: z.coerce.number().min(0).default(0),
  tax_rate: z.coerce.number().min(0).max(100).default(0),
  valid_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  payment_terms: opt,
  delivery_days: z.coerce.number().int().min(0).nullable().optional(),
  warranty_days: z.coerce.number().int().min(0).nullable().optional(),
  terms: opt,
  internal_notes: opt,
});

/** Orçamentos enviados e não respondidos passam a "vencido" após a validade. */
export const expireQuotes = (where, params) => q(
  `update quotes set status = 'vencido', updated_at = now() where ${where} and status in ('enviado','aguardando_decisao')
      and valid_until < (now() at time zone 'America/Sao_Paulo')::date`, params);

/** Remove custos e margem para quem não vê valores internos. */
const strip = (req) => (qt) => {
  if (can(req, 'orders_values')) return qt;
  const out = { ...qt, cost_total: null, margin: null, margin_pct: null };
  if (qt.items) out.items = qt.items.map((i) => ({ ...i, unit_cost: null }));
  return out;
};

r.get('/', async (req, res) => {
  await expireQuotes('company_id = $1', [req.companyId]);
  const params = [req.companyId];
  let where = 'qt.company_id = $1';
  const { status, search, from, to, customer_id } = req.query;
  if (status === 'pendentes') where += " and qt.status in ('rascunho','enviado','aguardando_decisao')";
  else if (status === 'aprovados') where += " and qt.status in ('aprovado','parcialmente_aprovado')";
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
    `select qt.id, qt.number, qt.revision, qt.title, qt.status, qt.total, qt.approved_total, qt.cost_total, qt.valid_until,
            qt.created_at, qt.sent_at, qt.approved_at, qt.order_id, qt.request_id, qt.customer_id, c.name as customer_name,
            c.phone as customer_phone, e.description as equipment_description, o.number as order_number, sr.number as request_number,
            u.name as created_by_name
       from quotes qt left join customers c on c.id = qt.customer_id left join equipment e on e.id = qt.equipment_id
       left join orders o on o.id = qt.order_id left join users u on u.id = qt.created_by
       left join service_requests sr on sr.id = qt.request_id
      where ${where} order by qt.created_at desc limit 1000`, params);
  res.json(rows.map(strip(req)));
});

export async function loadQuote(id, companyId, db = { query: q }) {
  const { rows: [qt] } = await db.query(
    `select qt.*, c.name as customer_name, c.phone as customer_phone, c.email as customer_email, c.document as customer_document,
            c.street, c.number as address_number, c.district, c.city, c.uf,
            e.description as equipment_description, e.brand as equipment_brand, e.model as equipment_model, e.serial as equipment_serial,
            t.name as technician_name, o.number as order_number, u.name as created_by_name, sr.number as request_number,
            un.name as unit_name
       from quotes qt left join customers c on c.id = qt.customer_id left join equipment e on e.id = qt.equipment_id
       left join technicians t on t.id = qt.technician_id left join orders o on o.id = qt.order_id
       left join users u on u.id = qt.created_by left join service_requests sr on sr.id = qt.request_id
       left join units un on un.id = qt.unit_id
      where qt.id = $1 and qt.company_id = $2`, [id, companyId]);
  if (!qt) throw notFound('Orçamento não encontrado');
  // consultas em sequência: pode rodar dentro de uma transação (mesmo cliente)
  const { rows: items } = await db.query('select * from quote_items where quote_id = $1 order by position', [id]);
  const { rows: versions } = await db.query(
    `select v.id, v.revision, v.total, v.sent_via, v.created_at, u.name as created_by_name
       from quote_versions v left join users u on u.id = v.created_by where v.quote_id = $1 order by v.revision desc`, [id]);
  const { rows: approvals } = await db.query(
    `select a.*, u.name as recorded_by_name from quote_approvals a left join users u on u.id = a.recorded_by
      where a.quote_id = $1 order by a.created_at desc`, [id]);
  const base = Number(qt.approved_total ?? qt.total);
  const margin = round2(base - Number(qt.cost_total) - Number(qt.tax_amount));
  return { ...qt, items, versions, approvals, margin, margin_pct: base > 0 ? round2((margin / base) * 100) : null };
}

r.get('/:id', async (req, res) => {
  await expireQuotes('id = $1 and company_id = $2', [req.params.id, req.companyId]);
  res.json(strip(req)(await loadQuote(req.params.id, req.companyId)));
});

r.get('/:id/versions/:rev', async (req, res) => {
  const v = await one(
    `select v.* from quote_versions v join quotes qt on qt.id = v.quote_id
      where v.quote_id = $1 and qt.company_id = $2 and v.revision = $3`, [req.params.id, req.companyId, Number(req.params.rev) || 0]);
  if (!v) throw notFound('Revisão não encontrada');
  res.json(can(req, 'orders_values') ? v : { ...v, snapshot: strip(req)(v.snapshot) });
});

/** Totais do orçamento a partir dos itens (opcionais não entram no total). */
function totals(subtotal, cost, d) {
  const total = round2(subtotal - d.discount + d.surcharge);
  if (total < 0) throw bad('Desconto maior que o total.');
  return { total, tax_amount: round2(total * (d.tax_rate || 0) / 100), cost_total: cost };
}

async function upsert(db, req, d, cur) {
  if ((d.discount > 0 || d.items.some((i) => i.discount > 0)) && !can(req, 'discount') && (!cur || Number(cur.discount) !== d.discount || d.items.some((i) => i.discount > 0))) {
    throw new HttpError(403, 'Seu perfil não permite dar desconto.');
  }
  const { rows: [cust] } = await db.query('select id from customers where id = $1 and company_id = $2', [d.customer_id, req.companyId]);
  if (!cust) throw notFound('Cliente não encontrado');
  let equipmentId = d.equipment_id || null;
  if (equipmentId) {
    const { rows: [e] } = await db.query('select id from equipment where id = $1 and company_id = $2', [equipmentId, req.companyId]);
    if (!e) throw notFound('Objeto de serviço não encontrado');
  } else if (d.equipment) {
    const e = d.equipment;
    const { rows: [row] } = await db.query(
      `insert into equipment (company_id, customer_id, category, description, brand, model, serial, material, dimensions)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
      [req.companyId, d.customer_id, e.category || null, e.description, e.brand || null, e.model || null, e.serial || null, e.material || null, e.dimensions || null]);
    equipmentId = row.id;
  }
  const { items, subtotal, cost } = await prepareItems(db, req.companyId, d.items);
  const t = totals(subtotal, cost, d);
  const cfg = req.settings.orders;
  const valid = d.valid_until || new Date(Date.now() + cfg.quoteValidityDays * 86400000).toISOString().slice(0, 10);
  const vals = [d.customer_id, equipmentId, d.technician_id || null, d.title, d.description || null, subtotal, d.discount, t.total,
    valid, d.payment_terms || null, d.delivery_days ?? null, d.warranty_days ?? cfg.defaultWarrantyDays, d.terms ?? cfg.termsQuote,
    d.internal_notes || null, d.scope || null, d.assumptions ?? null, d.exclusions ?? null, d.surcharge, d.tax_rate, t.tax_amount, t.cost_total];
  let id;
  if (cur) {
    // alteração após envio/decisão abre a próxima revisão (volta a rascunho)
    await db.query(
      `update quotes set customer_id=$1, equipment_id=$2, technician_id=$3, title=$4, description=$5, subtotal=$6, discount=$7, total=$8,
              valid_until=$9, payment_terms=$10, delivery_days=$11, warranty_days=$12, terms=$13, internal_notes=$14, scope=$15,
              assumptions=$16, exclusions=$17, surcharge=$18, tax_rate=$19, tax_amount=$20, cost_total=$21, updated_at=now(),
              status = 'rascunho', approved_total = null, approved_at = null, refused_at = null
        where id=$22`, [...vals, cur.id]);
    id = cur.id;
    const priceChanged = Number(cur.total) !== t.total || Number(cur.discount) !== d.discount;
    await audit(db, req, {
      entity: 'quote', entityId: id, action: 'update',
      summary: `Orçamento nº ${cur.number} alterado${cur.status !== 'rascunho' ? ` (era ${QUOTE_STATUS[cur.status]}, volta a rascunho para a revisão ${cur.revision + 1})` : ''}${priceChanged ? `: total ${cur.total} → ${t.total}` : ''}`,
      data: priceChanged ? { before: { total: Number(cur.total), discount: Number(cur.discount) }, after: { total: t.total, discount: d.discount } } : null,
    });
  } else {
    const number = await nextNumber(db, 'quotes', req.companyId);
    let requestId = null;
    if (d.request_id) {
      const { rows: [rq] } = await db.query('select id from service_requests where id = $1 and company_id = $2', [d.request_id, req.companyId]);
      if (!rq) throw notFound('Solicitação não encontrada');
      requestId = rq.id;
    }
    const unitId = d.unit_id || req.user.unit_id
      || (await db.query('select id from units where company_id = $1 and is_default', [req.companyId])).rows[0]?.id || null;
    const { rows: [row] } = await db.query(
      `insert into quotes (company_id, number, customer_id, equipment_id, technician_id, title, description, subtotal, discount, total,
              valid_until, payment_terms, delivery_days, warranty_days, terms, internal_notes, scope, assumptions, exclusions, surcharge,
              tax_rate, tax_amount, cost_total, public_token, created_by, unit_id, request_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27) returning id`,
      [req.companyId, number, ...vals, publicToken(), req.user.id, unitId, requestId]);
    id = row.id;
    if (requestId) await db.query('update service_requests set quote_id = $2, updated_at = now() where id = $1 and quote_id is null', [requestId, id]);
    await audit(db, req, { entity: 'quote', entityId: id, action: 'create', summary: `Orçamento nº ${number} criado — total ${t.total}` });
  }
  await insertItems(db, 'quote_items', 'quote_id', id, items);
  return id;
}

r.post('/', need('quotes'), async (req, res) => {
  const d = parse(schema, req.body);
  const id = await tx((db) => upsert(db, req, d));
  res.status(201).json(strip(req)(await loadQuote(id, req.companyId)));
});

r.put('/:id', need('quotes'), async (req, res) => {
  const d = parse(schema, req.body);
  await tx(async (db) => {
    const { rows: [cur] } = await db.query('select * from quotes where id = $1 and company_id = $2 for update', [req.params.id, req.companyId]);
    if (!cur) throw notFound();
    if (cur.status === 'convertido') throw bad('Orçamento convertido em OS não pode ser alterado. Duplique-o.');
    if (APPROVED.includes(cur.status)) throw bad('Orçamento aprovado. Use "Reabrir para revisão" antes de alterar.');
    await upsert(db, req, d, cur);
  });
  res.json(strip(req)(await loadQuote(req.params.id, req.companyId)));
});

/** Congela a revisão atual (snapshot) e marca como enviada. */
async function freezeRevision(db, req, cur, via) {
  const rev = cur.revision + 1;
  const full = await loadQuote(cur.id, req.companyId, db);
  const snapshot = { ...full, versions: undefined, approvals: undefined, revision: rev };
  await db.query(
    `insert into quote_versions (quote_id, revision, snapshot, total, sent_via, created_by) values ($1,$2,$3,$4,$5,$6)`,
    [cur.id, rev, JSON.stringify(snapshot), cur.total, via, req.user.id]);
  await db.query(
    `update quotes set revision = $2, status = 'enviado', sent_at = now(), sent_via = $3, updated_at = now() where id = $1`,
    [cur.id, rev, via]);
  await syncRequestFromQuote(db, req.user.id, cur, 'orcada', `Orçamento nº ${cur.number} (rev. ${rev}) enviado`);
  return rev;
}

const lockQuote = async (db, req) => {
  const { rows: [cur] } = await db.query('select * from quotes where id = $1 and company_id = $2 for update', [req.params.id, req.companyId]);
  if (!cur) throw notFound('Orçamento não encontrado');
  return cur;
};

/**
 * Registra o envio. O TORVEN não dispara mensagens sozinho: o usuário copia o link, imprime ou abre o WhatsApp
 * no próprio aparelho; aqui fica registrada a revisão enviada e o canal usado.
 */
r.post('/:id/send', need('quotes_send'), async (req, res) => {
  const d = parse(z.object({ via: z.enum(['link', 'whatsapp', 'email', 'impresso', 'presencial', 'outro']).default('link') }), req.body);
  const rev = await tx(async (db) => {
    const cur = await lockQuote(db, req);
    if (!['rascunho', 'enviado', 'aguardando_decisao', 'vencido'].includes(cur.status)) {
      throw bad(`Orçamento ${QUOTE_STATUS[cur.status].toLowerCase()} não pode ser reenviado.`);
    }
    if (Number(cur.total) <= 0) throw bad('O orçamento precisa ter valor para ser enviado.');
    const today = new Date().toISOString().slice(0, 10);
    if (cur.valid_until && cur.valid_until < today) throw bad('Validade vencida. Atualize a data de validade antes de enviar.');
    if (SENT.includes(cur.status)) {
      // reenvio da mesma revisão: só registra o canal
      await db.query('update quotes set sent_at = now(), sent_via = $2, updated_at = now() where id = $1', [cur.id, d.via]);
      await audit(db, req, { entity: 'quote', entityId: cur.id, action: 'resend', summary: `Orçamento nº ${cur.number} (rev. ${cur.revision}) reenviado via ${d.via}` });
      return cur.revision;
    }
    const n = await freezeRevision(db, req, cur, d.via);
    await audit(db, req, { entity: 'quote', entityId: cur.id, action: 'send', summary: `Orçamento nº ${cur.number} enviado (revisão ${n}) via ${d.via} — total ${cur.total}` });
    return n;
  });
  res.json({ ...strip(req)(await loadQuote(req.params.id, req.companyId)), sent_revision: rev });
});

const decisionSchema = z.object({
  decision: z.enum(['aprovado', 'parcialmente_aprovado', 'recusado']),
  decided_by: s.min(2, 'informe quem decidiu pelo cliente'),
  via: z.enum(VIAS),
  approved_item_ids: z.array(z.string().uuid()).optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

/** Aplica a decisão do cliente (usado pela equipe e pelo link público). */
export async function applyDecision(db, cur, d, { userId = null } = {}) {
  if (cur.status === 'convertido') throw bad('Orçamento já convertido em OS.');
  if (APPROVED.includes(cur.status) || cur.status === 'recusado') throw bad('Decisão já registrada para esta revisão. Reabra o orçamento para revisar.');
  if (cur.status === 'vencido') throw bad('Orçamento vencido. Atualize a validade e envie uma nova revisão.');
  const { rows: items } = await db.query('select id, optional, total from quote_items where quote_id = $1 order by position', [cur.id]);
  const ids = new Set(d.approved_item_ids || []);
  for (const id of ids) if (!items.some((i) => i.id === id)) throw bad('Item aprovado não pertence a este orçamento.');
  let approved = [];
  if (d.decision === 'aprovado') approved = items.filter((i) => !i.optional || ids.has(i.id));
  else if (d.decision === 'parcialmente_aprovado') {
    approved = items.filter((i) => ids.has(i.id));
    if (!approved.length) throw bad('Selecione os itens aprovados pelo cliente.');
  }
  const approvedSub = round2(approved.reduce((a, i) => a + Number(i.total), 0));
  const baseSub = Number(cur.subtotal) || 0;
  // desconto/acréscimo gerais acompanham a parte aprovada dos itens principais (opcionais não entram na base)
  const approvedBase = round2(approved.filter((i) => !i.optional).reduce((a, i) => a + Number(i.total), 0));
  const ratio = d.decision === 'recusado' ? 0 : baseSub > 0 ? Math.min(1, approvedBase / baseSub) : 1;
  const approvedTotal = d.decision === 'recusado' ? null
    : round2(approvedSub - Number(cur.discount) * ratio + Number(cur.surcharge) * ratio);
  await db.query('update quote_items set approved = case when id = any($2) then true else false end where quote_id = $1',
    [cur.id, approved.map((i) => i.id)]);
  await db.query(
    `update quotes set status = $2, approved_total = $3, approved_at = case when $2 <> 'recusado' then now() end,
            refused_at = case when $2 = 'recusado' then now() end, customer_response = $4, updated_at = now() where id = $1`,
    [cur.id, d.decision, approvedTotal,
      `${d.decision === 'recusado' ? 'Recusado' : d.decision === 'aprovado' ? 'Aprovado' : 'Aprovado parcialmente'} por ${d.decided_by} (${d.via})${d.notes ? `: ${d.notes}` : ''}`]);
  await db.query(
    `insert into quote_approvals (quote_id, revision, decision, decided_by, via, approved_items, approved_total, notes, recorded_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [cur.id, cur.revision, d.decision, d.decided_by, d.via, JSON.stringify(approved.map((i) => i.id)), approvedTotal, d.notes || null, userId]);
  if (d.decision === 'recusado') {
    await syncRequestFromQuote(db, userId, cur, 'perdida', `Orçamento nº ${cur.number} recusado${d.notes ? `: ${d.notes}` : ''}`);
    if (cur.request_id) await db.query("update service_requests set lost_reason = coalesce(lost_reason, $2) where id = $1", [cur.request_id, `Orçamento recusado${d.notes ? `: ${d.notes}` : ''}`]);
  }
  return { approvedTotal, approvedCount: approved.length };
}

r.post('/:id/decision', need('quotes_approve'), async (req, res) => {
  const d = parse(decisionSchema, req.body);
  await tx(async (db) => {
    let cur = await lockQuote(db, req);
    // aprovação presencial de orçamento ainda não enviado: congela a revisão antes
    if (cur.status === 'rascunho') {
      if (!cur.total || Number(cur.total) <= 0) throw bad('O orçamento precisa ter valor.');
      await freezeRevision(db, req, cur, d.via);
      cur = await lockQuote(db, req);
    }
    const r2 = await applyDecision(db, cur, d, { userId: req.user.id });
    await audit(db, req, {
      entity: 'quote', entityId: cur.id, action: 'decision',
      summary: `Orçamento nº ${cur.number} (rev. ${cur.revision}): ${QUOTE_STATUS[d.decision]} por ${d.decided_by} via ${d.via}${r2.approvedTotal != null ? ` — valor aprovado ${r2.approvedTotal}` : ''}`,
      data: { decision: d.decision, approved_item_ids: d.approved_item_ids || [], approved_total: r2.approvedTotal },
    });
  });
  res.json(strip(req)(await loadQuote(req.params.id, req.companyId)));
});

/** Reabre um orçamento decidido/vencido para nova revisão. */
r.post('/:id/reopen', need('quotes'), async (req, res) => {
  const d = parse(z.object({ reason: opt }), req.body);
  await tx(async (db) => {
    const cur = await lockQuote(db, req);
    if (!['aprovado', 'parcialmente_aprovado', 'recusado', 'vencido', 'enviado', 'aguardando_decisao'].includes(cur.status)) {
      throw bad('Este orçamento não pode ser reaberto.');
    }
    const today = new Date().toISOString().slice(0, 10);
    const valid = cur.valid_until && cur.valid_until >= today ? cur.valid_until
      : new Date(Date.now() + req.settings.orders.quoteValidityDays * 86400000).toISOString().slice(0, 10);
    await db.query(
      `update quotes set status = 'rascunho', approved_total = null, approved_at = null, refused_at = null, valid_until = $2, updated_at = now()
        where id = $1`, [cur.id, valid]);
    await db.query('update quote_items set approved = null where quote_id = $1', [cur.id]);
    await audit(db, req, { entity: 'quote', entityId: cur.id, action: 'reopen', summary: `Orçamento nº ${cur.number} reaberto para revisão${d.reason ? `: ${d.reason}` : ''} (era ${QUOTE_STATUS[cur.status]})` });
  });
  res.json(strip(req)(await loadQuote(req.params.id, req.companyId)));
});

/** Converte orçamento aprovado em OS (somente os itens aprovados). */
export async function convertQuote(db, req, quoteId, { technicianId = null } = {}) {
  const companyId = req.companyId;
  const userId = req.user.id;
  const { rows: [qt] } = await db.query('select * from quotes where id = $1 and company_id = $2 for update', [quoteId, companyId]);
  if (!qt) throw notFound();
  if (qt.status === 'convertido') throw bad('Orçamento já convertido.');
  if (!APPROVED.includes(qt.status)) throw bad('Registre a aprovação do cliente antes de gerar a OS.');
  const { rows: all } = await db.query('select * from quote_items where quote_id = $1 order by position', [qt.id]);
  const hasFlags = all.some((i) => i.approved !== null);
  const items = all.filter((i) => (hasFlags ? i.approved : !i.optional));
  if (!items.length) throw bad('Nenhum item aprovado para gerar a OS.');
  const number = await nextNumber(db, 'orders', companyId);
  const tech = technicianId || qt.technician_id;
  const { items: prepared, subtotal } = await prepareItems(db, companyId, items.map((i) => ({
    ...i, optional: false, qty: Number(i.qty), unit_price: Number(i.unit_price), unit_cost: Number(i.unit_cost), discount: Number(i.discount),
  })), { defaultTechnician: tech });
  const target = qt.approved_total != null ? Number(qt.approved_total) : round2(subtotal - Number(qt.discount) + Number(qt.surcharge));
  // desconto/acréscimo proporcionais viram o desconto líquido da OS
  const discount = round2(Math.max(0, subtotal - target));
  if (target > subtotal + 0.009) {
    prepared.push({
      position: prepared.length, kind: 'outro', service_id: null, product_id: null, technician_id: null, description: 'Acréscimos do orçamento',
      unit: 'un', qty: 1, unit_price: round2(target - subtotal), unit_cost: 0, discount: 0, total: round2(target - subtotal),
      commission_rate: 0, commission_value: 0,
    });
  }
  const orderSubtotal = round2(prepared.reduce((a, i) => a + i.total, 0));
  const promised = qt.delivery_days ? new Date(Date.now() + qt.delivery_days * 86400000).toISOString() : null;
  const problem = [qt.title, qt.description, qt.scope && `Escopo: ${qt.scope}`].filter(Boolean).join('\n');
  const { rows: [o] } = await db.query(
    `insert into orders (company_id, number, kind, customer_id, equipment_id, quote_id, request_id, unit_id, technician_id, status, problem,
            subtotal, discount, total, warranty_days, promised_at, public_token, created_by)
     values ($1,$2,'os',$3,$4,$5,$6,$7,$8,'aprovada',$9,$10,$11,$12,$13,$14,$15,$16) returning *`,
    [companyId, number, qt.customer_id, qt.equipment_id, qt.id, qt.request_id, qt.unit_id, tech, problem,
      orderSubtotal, discount, round2(orderSubtotal - discount), qt.warranty_days ?? 0, promised, publicToken(), userId]);
  await insertItems(db, 'order_items', 'order_id', o.id, prepared);
  await syncOrderStock(db, o, userId, req.settings);
  await logEvent(db, o.id, { type: 'criacao', to: 'aprovada', message: `Criada a partir do orçamento nº ${qt.number} (rev. ${qt.revision})`, isPublic: true, userId });
  await db.query(`update quotes set status = 'convertido', order_id = $2, updated_at = now() where id = $1`, [qt.id, o.id]);
  await syncRequestFromQuote(db, userId, { ...qt, order_id: o.id }, 'convertida', `OS nº ${o.number} gerada do orçamento nº ${qt.number}`);
  await audit(db, req, { entity: 'order', entityId: o.id, action: 'create', summary: `OS nº ${o.number} gerada do orçamento nº ${qt.number} — total ${o.total}` });
  return o;
}

r.post('/:id/convert', need('quotes_approve'), async (req, res) => {
  const d = parse(z.object({ technician_id: z.string().uuid().nullable().optional() }), req.body);
  if (!can(req, 'orders_create')) throw new HttpError(403, 'Seu perfil não permite abrir OS.');
  const o = await tx((db) => convertQuote(db, req, req.params.id, { technicianId: d.technician_id }));
  res.status(201).json({ order_id: o.id, number: o.number });
});

r.post('/:id/duplicate', need('quotes'), async (req, res) => {
  const src = await loadQuote(req.params.id, req.companyId);
  const id = await tx((db) => upsert(db, req, {
    ...src, valid_until: null, request_id: null, surcharge: Number(src.surcharge), tax_rate: Number(src.tax_rate), discount: Number(src.discount),
    items: src.items.map((i) => ({
      ...i, approved: null, qty: Number(i.qty), unit_price: Number(i.unit_price), unit_cost: Number(i.unit_cost), discount: Number(i.discount),
    })),
  }));
  res.status(201).json(strip(req)(await loadQuote(id, req.companyId)));
});

r.delete('/:id', need('quotes'), async (req, res) => {
  const cur = await one('select id, number, status from quotes where id = $1 and company_id = $2', [req.params.id, req.companyId]);
  if (!cur) throw notFound();
  if (cur.status !== 'rascunho' || (await one('select 1 from quote_versions where quote_id = $1 limit 1', [cur.id]))) {
    throw bad('Só orçamentos em rascunho nunca enviados podem ser excluídos. Os demais ficam no histórico.');
  }
  await q('update service_requests set quote_id = null where quote_id = $1', [cur.id]);
  await q('delete from quotes where id = $1', [cur.id]);
  await audit(null, req, { entity: 'quote', entityId: cur.id, action: 'delete', summary: `Orçamento nº ${cur.number} excluído (rascunho)` });
  res.status(204).end();
});

export default r;
