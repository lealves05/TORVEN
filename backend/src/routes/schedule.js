// Agenda / programação: visitas, execuções, entregas e retiradas por técnico, com verificação de conflito.
import { Router } from 'express';
import { z } from 'zod';
import { q, one, tx } from '../db.js';
import { need, can } from '../auth.js';
import { parse, notFound, bad, HttpError } from '../util.js';
import { audit } from '../audit.js';

const r = Router();
r.use(need('schedule_view', 'schedule_manage'));

export const SCHEDULE_KIND = { visita: 'Visita técnica', execucao: 'Execução', entrega: 'Entrega', retirada: 'Retirada', outro: 'Outro' };
const s = z.string().trim();
const opt = s.nullable().optional();
const uuidOpt = z.string().uuid().nullable().optional();
const schema = z.object({
  kind: z.enum(Object.keys(SCHEDULE_KIND)).default('execucao'),
  title: s.min(2, 'informe o título'),
  order_id: uuidOpt,
  request_id: uuidOpt,
  technician_id: uuidOpt,
  starts_at: z.string().min(10),
  ends_at: z.string().min(10),
  location: opt,
  notes: opt,
  force: z.boolean().optional(),
});

const SELECT = `
  select se.*, t.name as technician_name, t.color as technician_color,
         o.number as order_number, o.status as order_status, sr.number as request_number, sr.status as request_status,
         coalesce(c1.name, c2.name, sr.contact_name) as customer_name, u.name as created_by_name
    from schedule_entries se
    left join technicians t on t.id = se.technician_id
    left join orders o on o.id = se.order_id left join customers c1 on c1.id = o.customer_id
    left join service_requests sr on sr.id = se.request_id left join customers c2 on c2.id = sr.customer_id
    left join users u on u.id = se.created_by`;

/** Técnico sem permissão de programar vê só a própria agenda. */
const ownFilter = (req, params) => {
  if (can(req, 'schedule_manage') || req.user.role === 'owner' || !req.ownTechnician) return '';
  params.push(req.ownTechnician);
  return ` and se.technician_id = $${params.length}`;
};

r.get('/', async (req, res) => {
  const params = [req.companyId];
  let where = 'se.company_id = $1';
  const { from, to, technician_id, kind, status, order_id, request_id } = req.query;
  if (from) { params.push(from); where += ` and se.ends_at >= $${params.length}::timestamptz`; }
  if (to) { params.push(to); where += ` and se.starts_at < $${params.length}::timestamptz`; }
  if (technician_id) { params.push(technician_id); where += ` and se.technician_id = $${params.length}`; }
  if (kind) { params.push(String(kind).split(',')); where += ` and se.kind = any($${params.length})`; }
  if (status) { params.push(String(status).split(',')); where += ` and se.status = any($${params.length})`; }
  if (order_id) { params.push(order_id); where += ` and se.order_id = $${params.length}`; }
  if (request_id) { params.push(request_id); where += ` and se.request_id = $${params.length}`; }
  where += ownFilter(req, params);
  const { rows } = await q(`${SELECT} where ${where} order by se.starts_at limit 2000`, params);
  res.json(rows);
});

/** Compromissos do técnico que se sobrepõem ao intervalo. */
export async function conflicts(db, companyId, technicianId, startsAt, endsAt, ignoreId = null) {
  if (!technicianId) return [];
  const { rows } = await db.query(
    `select se.id, se.title, se.starts_at, se.ends_at from schedule_entries se
      where se.company_id = $1 and se.technician_id = $2 and se.status in ('agendado','em_andamento')
        and se.starts_at < $4 and se.ends_at > $3 and ($5::uuid is null or se.id <> $5)`,
    [companyId, technicianId, startsAt, endsAt, ignoreId]);
  return rows;
}

async function validate(db, req, d) {
  const start = new Date(d.starts_at);
  const end = new Date(d.ends_at);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw bad('Data/hora inválida.');
  if (end <= start) throw bad('O término deve ser depois do início.');
  if (end - start > 14 * 86400000) throw bad('Período máximo de 14 dias por compromisso.');
  const check = async (table, id, label) => {
    if (!id) return;
    const { rows: [x] } = await db.query(`select id from ${table} where id = $1 and company_id = $2`, [id, req.companyId]);
    if (!x) throw notFound(`${label} não encontrado(a)`);
  };
  await check('orders', d.order_id, 'OS');
  await check('service_requests', d.request_id, 'Solicitação');
  await check('technicians', d.technician_id, 'Técnico');
  return { start: start.toISOString(), end: end.toISOString() };
}

const conflictError = (list) => new HttpError(409,
  `Conflito de agenda: o técnico já tem ${list.map((c) => `"${c.title}"`).join(', ')} nesse horário. Confirme para agendar mesmo assim.`,
  { conflicts: list });

/** Mantém a visita da solicitação alinhada à agenda. */
async function syncRequestVisit(db, entry) {
  if (entry.kind !== 'visita' || !entry.request_id) return;
  await db.query(
    `update service_requests set visit_at = $2, visit_technician_id = $3, updated_at = now()
      where id = $1 and status in ('nova','em_triagem','visita_agendada','diagnosticada')`,
    [entry.request_id, entry.starts_at, entry.technician_id]);
}

r.post('/', need('schedule_manage'), async (req, res) => {
  const d = parse(schema, req.body);
  const row = await tx(async (db) => {
    const { start, end } = await validate(db, req, d);
    const c = await conflicts(db, req.companyId, d.technician_id, start, end);
    if (c.length && !d.force) throw conflictError(c);
    const unit = req.user.unit_id || (await db.query('select id from units where company_id = $1 and is_default', [req.companyId])).rows[0]?.id || null;
    const { rows: [x] } = await db.query(
      `insert into schedule_entries (company_id, unit_id, kind, title, order_id, request_id, technician_id, starts_at, ends_at, location, notes, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`,
      [req.companyId, unit, d.kind, d.title, d.order_id || null, d.request_id || null, d.technician_id || null, start, end,
        d.location || null, d.notes || null, req.user.id]);
    await syncRequestVisit(db, x);
    await audit(db, req, { entity: 'schedule', entityId: x.id, action: 'create', summary: `${SCHEDULE_KIND[x.kind]} agendada: ${x.title}${c.length ? ' (com conflito confirmado)' : ''}` });
    return x;
  });
  res.status(201).json(await one(`${SELECT} where se.id = $1`, [row.id]));
});

r.put('/:id', need('schedule_manage'), async (req, res) => {
  const d = parse(schema, req.body);
  await tx(async (db) => {
    const { rows: [cur] } = await db.query('select * from schedule_entries where id = $1 and company_id = $2 for update', [req.params.id, req.companyId]);
    if (!cur) throw notFound('Compromisso não encontrado');
    const { start, end } = await validate(db, req, d);
    const c = await conflicts(db, req.companyId, d.technician_id, start, end, cur.id);
    if (c.length && !d.force) throw conflictError(c);
    const { rows: [x] } = await db.query(
      `update schedule_entries set kind=$2, title=$3, order_id=$4, request_id=$5, technician_id=$6, starts_at=$7, ends_at=$8, location=$9,
              notes=$10, updated_at=now() where id=$1 returning *`,
      [cur.id, d.kind, d.title, d.order_id || null, d.request_id || null, d.technician_id || null, start, end, d.location || null, d.notes || null]);
    await syncRequestVisit(db, x);
    const moved = new Date(cur.starts_at).getTime() !== new Date(start).getTime() || cur.technician_id !== (d.technician_id || null);
    await audit(db, req, { entity: 'schedule', entityId: cur.id, action: 'update', summary: `Agenda alterada: ${x.title}${moved ? ' (reprogramada)' : ''}` });
  });
  res.json(await one(`${SELECT} where se.id = $1`, [req.params.id]));
});

r.post('/:id/status', async (req, res) => {
  const d = parse(z.object({ status: z.enum(['agendado', 'em_andamento', 'concluido', 'cancelado', 'nao_realizado']), notes: opt }), req.body);
  const cur = await one('select * from schedule_entries where id = $1 and company_id = $2', [req.params.id, req.companyId]);
  if (!cur) throw notFound();
  const own = req.ownTechnician && cur.technician_id === req.ownTechnician;
  if (!can(req, 'schedule_manage') && !(own && ['em_andamento', 'concluido', 'nao_realizado'].includes(d.status))) {
    throw new HttpError(403, 'Seu perfil de acesso não permite esta ação.');
  }
  if (['cancelado', 'nao_realizado'].includes(d.status) && !d.notes) throw bad('Informe o motivo.');
  await q(`update schedule_entries set status = $2, notes = coalesce($3, notes), updated_at = now() where id = $1`, [cur.id, d.status, d.notes ? `${cur.notes ? `${cur.notes}\n` : ''}${d.notes}` : null]);
  await audit(null, req, { entity: 'schedule', entityId: cur.id, action: 'status', summary: `${cur.title}: ${d.status.replace('_', ' ')}${d.notes ? ` — ${d.notes}` : ''}` });
  res.json(await one(`${SELECT} where se.id = $1`, [cur.id]));
});

r.delete('/:id', need('schedule_manage'), async (req, res) => {
  const cur = await one('delete from schedule_entries where id = $1 and company_id = $2 returning id, title', [req.params.id, req.companyId]);
  if (!cur) throw notFound();
  await audit(null, req, { entity: 'schedule', entityId: cur.id, action: 'delete', summary: `Compromisso excluído: ${cur.title}` });
  res.status(204).end();
});

export default r;
