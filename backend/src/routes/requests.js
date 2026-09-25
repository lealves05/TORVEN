// Solicitações de atendimento: entrada → triagem/visita → diagnóstico → orçamento → OS.
import { Router } from 'express';
import { z } from 'zod';
import { q, one, tx } from '../db.js';
import { need, can } from '../auth.js';
import { parse, notFound, bad, publicToken, HttpError } from '../util.js';
import { nextNumber, logEvent } from '../domain.js';
import { audit } from '../audit.js';
import { conflicts } from './schedule.js';

const r = Router();
r.use(need('requests_view', 'requests_manage'));

export const REQUEST_STATUS = {
  nova: 'Nova', em_triagem: 'Em triagem', visita_agendada: 'Visita agendada', diagnosticada: 'Diagnosticada',
  em_orcamento: 'Em orçamento', orcada: 'Orçada', convertida: 'Convertida em OS', perdida: 'Perdida', cancelada: 'Cancelada',
};
/** Transições manuais permitidas. "orcada" e "convertida" também são definidas pelo fluxo de orçamento/OS. */
const NEXT = {
  nova: ['em_triagem', 'visita_agendada', 'diagnosticada', 'em_orcamento', 'perdida', 'cancelada'],
  em_triagem: ['visita_agendada', 'diagnosticada', 'em_orcamento', 'perdida', 'cancelada'],
  visita_agendada: ['em_triagem', 'diagnosticada', 'em_orcamento', 'perdida', 'cancelada'],
  diagnosticada: ['em_triagem', 'visita_agendada', 'em_orcamento', 'perdida', 'cancelada'],
  em_orcamento: ['diagnosticada', 'orcada', 'perdida', 'cancelada'],
  orcada: ['em_orcamento', 'perdida', 'cancelada'],
  perdida: ['nova'],
  cancelada: ['nova'],
  convertida: [],
};
export const OPEN_REQUEST = ['nova', 'em_triagem', 'visita_agendada', 'diagnosticada', 'em_orcamento', 'orcada'];

const s = z.string().trim();
const opt = s.nullable().optional();
const uuidOpt = z.string().uuid().nullable().optional();
const schema = z.object({
  customer_id: uuidOpt,
  contact_name: opt, contact_phone: opt, contact_email: opt,
  channel: z.enum(['telefone', 'whatsapp', 'email', 'presencial', 'site', 'indicacao', 'outro']).default('telefone'),
  equipment_id: uuidOpt,
  equipment: z.object({ category: opt, description: s.min(2), brand: opt, model: opt, serial: opt, material: opt, dimensions: opt, quantity: z.coerce.number().positive().optional() }).nullable().optional(),
  title: s.min(3, 'descreva o pedido em poucas palavras'),
  description: opt,
  service_location: z.enum(['oficina', 'externo']).default('oficina'),
  address: opt,
  desired_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().or(z.literal('')),
  priority: z.enum(['baixa', 'normal', 'alta', 'urgente']).default('normal'),
  assigned_to: uuidOpt,
  unit_id: uuidOpt,
});

async function addEvent(db, requestId, userId, { from = null, to = null, message = null }) {
  await db.query('insert into request_events (request_id, from_status, to_status, message, user_id) values ($1,$2,$3,$4,$5)',
    [requestId, from, to, message, userId]);
}

async function loadRequest(id, companyId, db = { query: q }) {
  const { rows: [x] } = await db.query(
    `select r.*, c.name as customer_name, c.phone as customer_phone, c.email as customer_email,
            e.description as equipment_description, e.brand as equipment_brand, e.model as equipment_model,
            t.name as visit_technician_name, ua.name as assigned_name, uc.name as created_by_name, un.name as unit_name,
            qt.number as quote_number, qt.status as quote_status, qt.total as quote_total,
            o.number as order_number, o.status as order_status
       from service_requests r
       left join customers c on c.id = r.customer_id left join equipment e on e.id = r.equipment_id
       left join technicians t on t.id = r.visit_technician_id left join users ua on ua.id = r.assigned_to
       left join users uc on uc.id = r.created_by left join units un on un.id = r.unit_id
       left join quotes qt on qt.id = r.quote_id left join orders o on o.id = r.order_id
      where r.id = $1 and r.company_id = $2`, [id, companyId]);
  if (!x) throw notFound('Solicitação não encontrada');
  const { rows: events } = await db.query(
    `select ev.*, u.name as user_name from request_events ev left join users u on u.id = ev.user_id
      where ev.request_id = $1 order by ev.created_at`, [id]);
  const { rows: [att] } = await db.query("select count(*)::int as n from attachments where entity = 'request' and entity_id = $1", [id]);
  return { ...x, events, attachments_count: att.n };
}

const redact = (req) => (x) => (can(req, 'quotes_view') || can(req, 'orders_values') ? x : { ...x, quote_total: null });

r.get('/', async (req, res) => {
  const params = [req.companyId];
  let where = 'r.company_id = $1';
  const { status, search, from, to, customer_id, channel } = req.query;
  if (status === 'abertas') where += ` and r.status in (${OPEN_REQUEST.map((x) => `'${x}'`).join(',')})`;
  else if (status) { params.push(String(status).split(',')); where += ` and r.status = any($${params.length})`; }
  if (customer_id) { params.push(customer_id); where += ` and r.customer_id = $${params.length}`; }
  if (channel) { params.push(channel); where += ` and r.channel = $${params.length}`; }
  if (from) { params.push(from); where += ` and r.created_at >= $${params.length}::date`; }
  if (to) { params.push(to); where += ` and r.created_at < $${params.length}::date + 1`; }
  if (search) {
    const t = String(search).trim().toLowerCase();
    params.push(`%${t}%`);
    const num = /^\d+$/.test(t) ? ` or r.number = ${parseInt(t, 10)}` : '';
    where += ` and (lower(r.title) like $${params.length} or lower(coalesce(c.name, r.contact_name, '')) like $${params.length}${num})`;
  }
  const { rows } = await q(
    `select r.id, r.number, r.title, r.status, r.channel, r.priority, r.service_location, r.desired_date, r.visit_at,
            r.created_at, r.updated_at, r.customer_id, coalesce(c.name, r.contact_name) as customer_name,
            coalesce(c.phone, r.contact_phone) as customer_phone, e.description as equipment_description,
            t.name as visit_technician_name, qt.number as quote_number, qt.total as quote_total, o.number as order_number,
            r.quote_id, r.order_id
       from service_requests r left join customers c on c.id = r.customer_id left join equipment e on e.id = r.equipment_id
       left join technicians t on t.id = r.visit_technician_id left join quotes qt on qt.id = r.quote_id
       left join orders o on o.id = r.order_id
      where ${where}
      order by case when r.status in ('convertida','perdida','cancelada') then 1 else 0 end,
               case r.priority when 'urgente' then 0 when 'alta' then 1 when 'normal' then 2 else 3 end, r.created_at desc
      limit ${Math.min(Number(req.query.limit) || 500, 2000)}`, params);
  res.json(rows.map(redact(req)));
});

r.get('/:id', async (req, res) => res.json(redact(req)(await loadRequest(req.params.id, req.companyId))));

async function resolveEquipment(db, req, d) {
  if (d.equipment_id) {
    const { rows: [e] } = await db.query('select id from equipment where id = $1 and company_id = $2', [d.equipment_id, req.companyId]);
    if (!e) throw notFound('Objeto de serviço não encontrado');
    return e.id;
  }
  if (!d.equipment) return null;
  if (!d.customer_id) throw bad('Selecione o cliente para cadastrar o objeto de serviço.');
  const e = d.equipment;
  const { rows: [row] } = await db.query(
    `insert into equipment (company_id, customer_id, category, description, brand, model, serial, material, dimensions, quantity)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
    [req.companyId, d.customer_id, e.category || null, e.description, e.brand || null, e.model || null, e.serial || null,
      e.material || null, e.dimensions || null, e.quantity || 1]);
  return row.id;
}

async function checkRefs(db, req, d) {
  if (d.customer_id) {
    const { rows: [c] } = await db.query('select id from customers where id = $1 and company_id = $2', [d.customer_id, req.companyId]);
    if (!c) throw notFound('Cliente não encontrado');
  } else if (!d.contact_name) throw bad('Selecione o cliente ou informe o nome do contato.');
  if (d.assigned_to) {
    const { rows: [u] } = await db.query('select id from users where id = $1 and company_id = $2', [d.assigned_to, req.companyId]);
    if (!u) throw notFound('Responsável não encontrado');
  }
}

const defaultUnit = async (db, req) => req.user.unit_id
  || (await db.query('select id from units where company_id = $1 and is_default', [req.companyId])).rows[0]?.id || null;

r.post('/', need('requests_manage'), async (req, res) => {
  const d = parse(schema, req.body);
  const id = await tx(async (db) => {
    await checkRefs(db, req, d);
    const equipmentId = await resolveEquipment(db, req, d);
    const number = await nextNumber(db, 'service_requests', req.companyId);
    const { rows: [x] } = await db.query(
      `insert into service_requests (company_id, number, unit_id, customer_id, contact_name, contact_phone, contact_email, channel,
              equipment_id, title, description, service_location, address, desired_date, priority, assigned_to, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) returning id, number`,
      [req.companyId, number, d.unit_id || await defaultUnit(db, req), d.customer_id || null, d.contact_name || null,
        d.contact_phone || null, d.contact_email || null, d.channel, equipmentId, d.title, d.description || null,
        d.service_location, d.address || null, d.desired_date || null, d.priority, d.assigned_to || null, req.user.id]);
    await addEvent(db, x.id, req.user.id, { to: 'nova', message: `Solicitação registrada (${d.channel})` });
    await audit(db, req, { entity: 'request', entityId: x.id, action: 'create', summary: `Solicitação nº ${x.number} registrada: ${d.title}` });
    return x.id;
  });
  res.status(201).json(await loadRequest(id, req.companyId));
});

r.put('/:id', need('requests_manage'), async (req, res) => {
  const d = parse(schema, req.body);
  await tx(async (db) => {
    const { rows: [cur] } = await db.query('select * from service_requests where id = $1 and company_id = $2 for update', [req.params.id, req.companyId]);
    if (!cur) throw notFound();
    if (['convertida', 'cancelada'].includes(cur.status)) throw bad('Solicitação encerrada não pode ser alterada.');
    await checkRefs(db, req, d);
    const equipmentId = await resolveEquipment(db, req, d);
    await db.query(
      `update service_requests set customer_id=$2, contact_name=$3, contact_phone=$4, contact_email=$5, channel=$6, equipment_id=$7,
              title=$8, description=$9, service_location=$10, address=$11, desired_date=$12, priority=$13, assigned_to=$14,
              unit_id = coalesce($15, unit_id), updated_at = now()
        where id = $1`,
      [cur.id, d.customer_id || null, d.contact_name || null, d.contact_phone || null, d.contact_email || null, d.channel, equipmentId,
        d.title, d.description || null, d.service_location, d.address || null, d.desired_date || null, d.priority, d.assigned_to || null,
        d.unit_id || null]);
    await addEvent(db, cur.id, req.user.id, { message: 'Dados da solicitação atualizados' });
  });
  res.json(await loadRequest(req.params.id, req.companyId));
});

async function changeStatus(db, req, cur, to, message, extra = {}) {
  if (cur.status !== to && !NEXT[cur.status]?.includes(to)) {
    throw bad(`Não é possível passar de "${REQUEST_STATUS[cur.status]}" para "${REQUEST_STATUS[to]}".`);
  }
  const sets = ['status = $2', 'updated_at = now()'];
  const vals = [cur.id, to];
  for (const [k, v] of Object.entries(extra)) { vals.push(v); sets.push(`${k} = $${vals.length}`); }
  await db.query(`update service_requests set ${sets.join(', ')} where id = $1`, vals);
  await addEvent(db, cur.id, req.user.id, { from: cur.status, to, message });
  if (['perdida', 'cancelada'].includes(to)) {
    await db.query("update schedule_entries set status = 'cancelado', updated_at = now() where request_id = $1 and status = 'agendado'", [cur.id]);
  }
  await audit(db, req, { entity: 'request', entityId: cur.id, action: 'status', summary: `Solicitação nº ${cur.number}: ${REQUEST_STATUS[cur.status]} → ${REQUEST_STATUS[to]}${message ? ` — ${message}` : ''}` });
}

const lockRequest = async (db, req) => {
  const { rows: [cur] } = await db.query('select * from service_requests where id = $1 and company_id = $2 for update', [req.params.id, req.companyId]);
  if (!cur) throw notFound('Solicitação não encontrada');
  return cur;
};

r.post('/:id/status', need('requests_manage'), async (req, res) => {
  const d = parse(z.object({ status: z.enum(Object.keys(REQUEST_STATUS)), note: opt, reason: opt }), req.body);
  if (d.status === 'convertida') throw bad('Use "Gerar OS" para converter a solicitação.');
  if (['perdida', 'cancelada'].includes(d.status) && !d.reason) throw bad('Informe o motivo.');
  await tx(async (db) => {
    const cur = await lockRequest(db, req);
    await changeStatus(db, req, cur, d.status, d.reason || d.note || null,
      ['perdida', 'cancelada'].includes(d.status) ? { lost_reason: d.reason } : d.status === 'nova' ? { lost_reason: null } : {});
  });
  res.json(await loadRequest(req.params.id, req.companyId));
});

r.post('/:id/visit', need('requests_manage'), async (req, res) => {
  const d = parse(z.object({
    visit_at: z.string().min(10, 'informe data e hora da visita'),
    visit_technician_id: uuidOpt, visit_notes: opt,
    minutes: z.coerce.number().int().min(15).max(24 * 60).optional(), force: z.boolean().optional(),
  }), req.body);
  const when = new Date(d.visit_at);
  if (Number.isNaN(when.getTime())) throw bad('Data da visita inválida.');
  await tx(async (db) => {
    const cur = await lockRequest(db, req);
    if (d.visit_technician_id) {
      const { rows: [t] } = await db.query('select id from technicians where id = $1 and company_id = $2', [d.visit_technician_id, req.companyId]);
      if (!t) throw notFound('Técnico não encontrado');
    }
    const end = new Date(when.getTime() + (d.minutes || req.settings.orders.defaultVisitMinutes || 60) * 60000);
    const { rows: [entry] } = await db.query("select id from schedule_entries where request_id = $1 and kind = 'visita' and status in ('agendado','em_andamento')", [cur.id]);
    const clash = await conflicts(db, req.companyId, d.visit_technician_id || null, when.toISOString(), end.toISOString(), entry?.id || null);
    if (clash.length && !d.force) {
      throw new HttpError(409, `Conflito de agenda: o técnico já tem ${clash.map((c) => `"${c.title}"`).join(', ')} nesse horário. Confirme para agendar mesmo assim.`, { conflicts: clash });
    }
    await changeStatus(db, req, cur, 'visita_agendada', `Visita/triagem agendada para ${when.toLocaleString('pt-BR', { timeZone: req.settings.timezone || 'America/Sao_Paulo' })}`,
      { visit_at: when.toISOString(), visit_technician_id: d.visit_technician_id || null, visit_notes: d.visit_notes || null });
    if (entry) {
      await db.query('update schedule_entries set starts_at = $2, ends_at = $3, technician_id = $4, notes = $5, updated_at = now() where id = $1',
        [entry.id, when.toISOString(), end.toISOString(), d.visit_technician_id || null, d.visit_notes || null]);
    } else {
      await db.query(
        `insert into schedule_entries (company_id, unit_id, kind, title, request_id, technician_id, starts_at, ends_at, location, notes, created_by)
         values ($1,$2,'visita',$3,$4,$5,$6,$7,$8,$9,$10)`,
        [req.companyId, cur.unit_id, `Visita — ${cur.title}`, cur.id, d.visit_technician_id || null, when.toISOString(), end.toISOString(),
          cur.service_location === 'externo' ? cur.address : null, d.visit_notes || null, req.user.id]);
    }
  });
  res.json(await loadRequest(req.params.id, req.companyId));
});

r.post('/:id/diagnosis', need('requests_manage'), async (req, res) => {
  const d = parse(z.object({ diagnosis: s.min(3, 'descreva o diagnóstico') }), req.body);
  await tx(async (db) => {
    const cur = await lockRequest(db, req);
    if (['em_orcamento', 'orcada'].includes(cur.status)) {
      await db.query('update service_requests set diagnosis = $2, updated_at = now() where id = $1', [cur.id, d.diagnosis]);
      await addEvent(db, cur.id, req.user.id, { message: 'Diagnóstico atualizado' });
    } else {
      await changeStatus(db, req, cur, 'diagnosticada', 'Diagnóstico registrado', { diagnosis: d.diagnosis });
    }
  });
  res.json(await loadRequest(req.params.id, req.companyId));
});

/** Cria um orçamento em rascunho vinculado à solicitação. */
r.post('/:id/quote', need('quotes'), async (req, res) => {
  const out = await tx(async (db) => {
    const cur = await lockRequest(db, req);
    if (cur.quote_id) {
      const { rows: [qt] } = await db.query('select id, status from quotes where id = $1', [cur.quote_id]);
      if (qt && !['recusado', 'vencido'].includes(qt.status)) throw bad('Esta solicitação já tem um orçamento ativo.');
    }
    if (!cur.customer_id) throw bad('Vincule um cliente cadastrado à solicitação antes de orçar.');
    if (!OPEN_REQUEST.includes(cur.status)) throw bad('Solicitação encerrada.');
    const cfg = req.settings;
    const number = await nextNumber(db, 'quotes', req.companyId);
    const valid = new Date(Date.now() + cfg.orders.quoteValidityDays * 86400000).toISOString().slice(0, 10);
    const { rows: [qt] } = await db.query(
      `insert into quotes (company_id, number, unit_id, request_id, customer_id, equipment_id, technician_id, title, description, scope,
              valid_until, warranty_days, terms, assumptions, exclusions, tax_rate, public_token, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) returning id, number`,
      [req.companyId, number, cur.unit_id, cur.id, cur.customer_id, cur.equipment_id, cur.visit_technician_id, cur.title,
        cur.description, cur.diagnosis, valid, cfg.orders.defaultWarrantyDays, cfg.orders.termsQuote, cfg.quotes.assumptions || null,
        cfg.quotes.exclusions || null, cfg.quotes.taxRate || 0, publicToken(), req.user.id]);
    await db.query("update service_requests set quote_id = $2, updated_at = now() where id = $1", [cur.id, qt.id]);
    if (cur.status !== 'em_orcamento') await changeStatus(db, req, { ...cur, status: cur.status === 'orcada' ? 'em_orcamento' : cur.status }, 'em_orcamento', `Orçamento nº ${qt.number} iniciado`);
    await audit(db, req, { entity: 'quote', entityId: qt.id, action: 'create', summary: `Orçamento nº ${qt.number} criado a partir da solicitação nº ${cur.number}` });
    return qt;
  });
  res.status(201).json({ quote_id: out.id, number: out.number });
});

/** Gera OS direto da solicitação (serviço simples, sem orçamento formal). */
r.post('/:id/order', need('orders_create'), async (req, res) => {
  const out = await tx(async (db) => {
    const cur = await lockRequest(db, req);
    if (!OPEN_REQUEST.includes(cur.status)) throw bad('Solicitação encerrada.');
    if (cur.order_id) throw bad('Esta solicitação já gerou uma OS.');
    if (!cur.customer_id) throw bad('Vincule um cliente cadastrado à solicitação antes de gerar a OS.');
    if (cur.quote_id) {
      const { rows: [qt] } = await db.query('select status from quotes where id = $1', [cur.quote_id]);
      if (qt && !['recusado', 'vencido'].includes(qt.status)) throw bad('Há um orçamento vinculado. Converta o orçamento aprovado em OS.');
    }
    const number = await nextNumber(db, 'orders', req.companyId);
    const cfg = req.settings.orders;
    const promised = cur.desired_date ? `${cur.desired_date}T18:00:00-03:00`
      : cfg.defaultPromiseDays ? new Date(Date.now() + cfg.defaultPromiseDays * 86400000).toISOString() : null;
    const { rows: [o] } = await db.query(
      `insert into orders (company_id, number, kind, unit_id, request_id, customer_id, equipment_id, technician_id, status, priority,
              service_location, service_address, promised_at, problem, diagnosis, warranty_days, public_token, created_by)
       values ($1,$2,'os',$3,$4,$5,$6,$7,'aberta',$8,$9,$10,$11,$12,$13,$14,$15,$16) returning id, number`,
      [req.companyId, number, cur.unit_id, cur.id, cur.customer_id, cur.equipment_id, cur.visit_technician_id, cur.priority,
        cur.service_location, cur.address, promised, [cur.title, cur.description].filter(Boolean).join('\n'), cur.diagnosis,
        cfg.defaultWarrantyDays, publicToken(), req.user.id]);
    await logEvent(db, o.id, { type: 'criacao', to: 'aberta', message: `OS aberta a partir da solicitação nº ${cur.number}`, isPublic: true, userId: req.user.id });
    await db.query("update service_requests set status = 'convertida', order_id = $2, updated_at = now() where id = $1", [cur.id, o.id]);
    await addEvent(db, cur.id, req.user.id, { from: cur.status, to: 'convertida', message: `OS nº ${o.number} gerada` });
    await audit(db, req, { entity: 'order', entityId: o.id, action: 'create', summary: `OS nº ${o.number} gerada da solicitação nº ${cur.number}` });
    return o;
  });
  res.status(201).json({ order_id: out.id, number: out.number });
});

r.post('/:id/note', need('requests_manage'), async (req, res) => {
  const d = parse(z.object({ message: s.min(1).max(2000) }), req.body);
  const cur = await one('select id from service_requests where id = $1 and company_id = $2', [req.params.id, req.companyId]);
  if (!cur) throw notFound();
  await addEvent({ query: q }, cur.id, req.user.id, { message: d.message });
  res.json(await loadRequest(cur.id, req.companyId));
});

r.delete('/:id', need('requests_manage'), async (req, res) => {
  const cur = await one('select * from service_requests where id = $1 and company_id = $2', [req.params.id, req.companyId]);
  if (!cur) throw notFound();
  if (cur.quote_id || cur.order_id) throw new HttpError(409, 'Solicitação com orçamento ou OS vinculados não pode ser excluída. Cancele-a.');
  await q('delete from service_requests where id = $1', [cur.id]);
  await q("delete from attachments where company_id = $1 and entity = 'request' and entity_id = $2", [req.companyId, cur.id]);
  await audit(null, req, { entity: 'request', entityId: cur.id, action: 'delete', summary: `Solicitação nº ${cur.number} excluída` });
  res.status(204).end();
});

/** Atualiza a solicitação de origem quando o orçamento muda de fase. */
export async function syncRequestFromQuote(db, userId, quote, to, message) {
  if (!quote.request_id) return;
  const { rows: [cur] } = await db.query('select * from service_requests where id = $1 for update', [quote.request_id]);
  if (!cur || cur.status === to || ['convertida', 'cancelada'].includes(cur.status)) return;
  const sets = to === 'convertida' && quote.order_id ? ', order_id = $3' : '';
  await db.query(`update service_requests set status = $2, updated_at = now()${sets} where id = $1`,
    sets ? [cur.id, to, quote.order_id] : [cur.id, to]);
  await addEvent(db, cur.id, userId, { from: cur.status, to, message });
}

export default r;
