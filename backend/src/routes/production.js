// Execução: apontamento de horas (cronômetro ou manual), painel de produção e folha de horas.
import { Router } from 'express';
import { z } from 'zod';
import { q, tx } from '../db.js';
import { need, can } from '../auth.js';
import { parse, notFound, bad, round2, HttpError, OPEN_STATUSES } from '../util.js';
import { logEvent, refreshLabor } from '../domain.js';
import { audit } from '../audit.js';
import { scopeWhere } from './orders.js';

const r = Router();

export const ACTIVITY = {
  diagnostico: 'Diagnóstico', execucao: 'Execução', retrabalho: 'Retrabalho', inspecao: 'Inspeção', deslocamento: 'Deslocamento', outro: 'Outro',
};
const opt = z.string().trim().nullable().optional();

/** Técnico que pode apontar: o próprio (escopo 'own') ou qualquer um (escopo 'all'). */
function resolveTechnician(req, technicianId) {
  const scope = req.user.role === 'owner' ? 'all' : req.perms.time_log;
  if (scope === 'all') {
    const t = technicianId || req.ownTechnician;
    if (!t) throw bad('Selecione o técnico.');
    return t;
  }
  if (scope === 'own') {
    if (!req.ownTechnician) throw bad('Seu usuário não está vinculado a um técnico. Peça ao administrador para vincular em Usuários.');
    if (technicianId && technicianId !== req.ownTechnician) throw new HttpError(403, 'Você só pode apontar as suas próprias horas.');
    return req.ownTechnician;
  }
  throw new HttpError(403, 'Seu perfil de acesso não permite apontar horas.');
}

async function visibleOrder(db, req, orderId, lock = false) {
  const params = [orderId, req.companyId];
  const scope = scopeWhere(req, params);
  const { rows: [o] } = await db.query(`select o.* from orders o where o.id = $1 and o.company_id = $2 ${scope}${lock ? ' for update' : ''}`, params);
  if (!o) throw notFound('OS não encontrada');
  return o;
}

const closeLog = async (db, log, endedAt, notes) => {
  const minutes = round2(Math.max(1, (new Date(endedAt) - new Date(log.started_at)) / 60000));
  const { rows: [x] } = await db.query(
    `update order_time_logs set ended_at = $2, minutes = $3, cost = round($3 / 60.0 * hourly_cost, 2), notes = coalesce($4, notes)
      where id = $1 returning *`, [log.id, endedAt, minutes, notes || null]);
  await refreshLabor(db, log.order_id);
  return x;
};

r.get('/orders/:id/time', need('time_log', 'orders_view'), async (req, res) => {
  await visibleOrder({ query: q }, req, req.params.id);
  const { rows } = await q(
    `select l.*, t.name as technician_name, u.name as user_name from order_time_logs l
       join technicians t on t.id = l.technician_id left join users u on u.id = l.user_id
      where l.order_id = $1 order by l.started_at desc`, [req.params.id]);
  res.json(can(req, 'orders_values') ? rows : rows.map((x) => ({ ...x, hourly_cost: null, cost: null })));
});

/** Inicia o cronômetro. Se o técnico tiver outro aberto, ele é encerrado antes. */
r.post('/orders/:id/time/start', need('time_log'), async (req, res) => {
  const d = parse(z.object({ technician_id: z.string().uuid().nullable().optional(), activity: z.enum(Object.keys(ACTIVITY)).default('execucao'), notes: opt }), req.body);
  const log = await tx(async (db) => {
    const o = await visibleOrder(db, req, req.params.id, true);
    if (!OPEN_STATUSES.includes(o.status)) throw bad('OS entregue ou cancelada: reabra para apontar horas.');
    if (o.status === 'aguardando_aprovacao' && d.activity === 'execucao') throw bad('Execução só depois da aprovação do cliente. Aponte como diagnóstico, se for o caso.');
    const techId = resolveTechnician(req, d.technician_id);
    const { rows: [tech] } = await db.query('select id, name, hourly_cost from technicians where id = $1 and company_id = $2 and active', [techId, req.companyId]);
    if (!tech) throw notFound('Técnico não encontrado ou inativo');
    const { rows: [open] } = await db.query('select * from order_time_logs where technician_id = $1 and ended_at is null for update', [techId]);
    if (open) await closeLog(db, open, new Date().toISOString(), 'Encerrado automaticamente ao iniciar outro apontamento');
    const { rows: [x] } = await db.query(
      `insert into order_time_logs (company_id, order_id, technician_id, user_id, activity, started_at, hourly_cost, notes)
       values ($1,$2,$3,$4,$5, now(), $6, $7) returning *`,
      [req.companyId, o.id, techId, req.user.id, d.activity, tech.hourly_cost || 0, d.notes || null]);
    if (['execucao', 'retrabalho'].includes(d.activity) && ['aberta', 'diagnostico', 'aprovada', 'aguardando_material'].includes(o.status)) {
      await db.query("update orders set status = 'em_execucao', started_at = coalesce(started_at, now()), updated_at = now() where id = $1", [o.id]);
      await logEvent(db, o.id, { type: 'status', from: o.status, to: 'em_execucao', message: `Execução iniciada por ${tech.name}`, isPublic: true, userId: req.user.id });
    }
    await db.query(
      `update schedule_entries set status = 'em_andamento', updated_at = now()
        where order_id = $1 and technician_id = $2 and status = 'agendado' and starts_at::date <= current_date and ends_at::date >= current_date`,
      [o.id, techId]);
    return x;
  });
  res.status(201).json(log);
});

r.post('/time/:logId/stop', need('time_log'), async (req, res) => {
  const d = parse(z.object({ notes: opt }), req.body);
  const log = await tx(async (db) => {
    const { rows: [cur] } = await db.query('select * from order_time_logs where id = $1 and company_id = $2 for update', [req.params.logId, req.companyId]);
    if (!cur) throw notFound('Apontamento não encontrado');
    if (cur.ended_at) throw bad('Apontamento já encerrado.');
    resolveTechnician(req, cur.technician_id);
    return closeLog(db, cur, new Date().toISOString(), d.notes);
  });
  res.json(log);
});

/** Lançamento manual (esqueceu de ligar o cronômetro). */
r.post('/orders/:id/time', need('time_log'), async (req, res) => {
  const d = parse(z.object({
    technician_id: z.string().uuid().nullable().optional(), activity: z.enum(Object.keys(ACTIVITY)).default('execucao'),
    started_at: z.string().min(10), ended_at: z.string().min(10), notes: z.string().trim().min(3, 'justifique o lançamento manual'),
  }), req.body);
  const start = new Date(d.started_at);
  const end = new Date(d.ended_at);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) throw bad('Período inválido.');
  if (end > new Date(Date.now() + 5 * 60000)) throw bad('Não é possível apontar horas no futuro.');
  if (end - start > 16 * 3600000) throw bad('Período máximo de 16 horas por lançamento.');
  const log = await tx(async (db) => {
    const o = await visibleOrder(db, req, req.params.id, true);
    if (o.status === 'cancelada') throw bad('OS cancelada.');
    const techId = resolveTechnician(req, d.technician_id);
    const { rows: [tech] } = await db.query('select id, name, hourly_cost from technicians where id = $1 and company_id = $2', [techId, req.companyId]);
    if (!tech) throw notFound('Técnico não encontrado');
    const { rows: [overlap] } = await db.query(
      `select 1 from order_time_logs where technician_id = $1 and started_at < $3 and coalesce(ended_at, now()) > $2 limit 1`,
      [techId, start.toISOString(), end.toISOString()]);
    if (overlap) throw bad('O técnico já tem horas apontadas nesse período.');
    const minutes = round2((end - start) / 60000);
    const { rows: [x] } = await db.query(
      `insert into order_time_logs (company_id, order_id, technician_id, user_id, activity, started_at, ended_at, minutes, hourly_cost, cost, notes, manual)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9, round($8 / 60.0 * $9, 2), $10, true) returning *`,
      [req.companyId, o.id, techId, req.user.id, d.activity, start.toISOString(), end.toISOString(), minutes, tech.hourly_cost || 0, d.notes]);
    await refreshLabor(db, o.id);
    await audit(db, req, { entity: 'time', entityId: x.id, action: 'manual', summary: `Apontamento manual de ${Math.round(minutes)} min para ${tech.name} na OS nº ${o.number}: ${d.notes}` });
    return x;
  });
  res.status(201).json(log);
});

r.delete('/time/:logId', need('time_log'), async (req, res) => {
  await tx(async (db) => {
    const { rows: [cur] } = await db.query(
      `select l.*, o.number from order_time_logs l join orders o on o.id = l.order_id where l.id = $1 and l.company_id = $2 for update`,
      [req.params.logId, req.companyId]);
    if (!cur) throw notFound();
    const scope = req.user.role === 'owner' ? 'all' : req.perms.time_log;
    if (scope !== 'all') {
      resolveTechnician(req, cur.technician_id);
      if (Date.now() - new Date(cur.created_at) > 24 * 3600000) throw new HttpError(403, 'Apontamentos com mais de 24 h só podem ser removidos pelo supervisor.');
    }
    await db.query('delete from order_time_logs where id = $1', [cur.id]);
    await refreshLabor(db, cur.order_id);
    await audit(db, req, { entity: 'time', entityId: cur.id, action: 'delete', summary: `Apontamento removido da OS nº ${cur.number} (${Math.round(cur.minutes || 0)} min)` });
  });
  res.status(204).end();
});

/** Painel de produção: quem está trabalhando em quê, agenda do dia e fila de execução. */
r.get('/board', need('schedule_view', 'time_log'), async (req, res) => {
  const tz = req.settings.timezone || 'America/Sao_Paulo';
  const own = !can(req, 'schedule_manage') && req.user.role !== 'owner' && req.ownTechnician;
  const { rows: techs } = await q(
    `select t.id, t.name, t.color, t.specialty,
            l.id as log_id, l.started_at as log_started_at, l.activity as log_activity, o.id as order_id, o.number as order_number,
            c.name as customer_name, e.description as equipment_description,
            (select coalesce(sum(minutes), 0) from order_time_logs x where x.technician_id = t.id and x.ended_at is not null
               and (x.started_at at time zone $2)::date = (now() at time zone $2)::date) as minutes_today
       from technicians t
       left join order_time_logs l on l.technician_id = t.id and l.ended_at is null
       left join orders o on o.id = l.order_id left join customers c on c.id = o.customer_id left join equipment e on e.id = o.equipment_id
      where t.company_id = $1 and t.active ${own ? 'and t.id = $3' : ''}
      order by lower(t.name)`, own ? [req.companyId, tz, req.ownTechnician] : [req.companyId, tz]);
  const params = [req.companyId];
  const scope = scopeWhere(req, params);
  const { rows: queue } = await q(
    `select o.id, o.number, o.status, o.priority, o.promised_at, o.technician_id, o.labor_minutes, o.inspection_result,
            c.name as customer_name, e.description as equipment_description, t.name as technician_name
       from orders o left join customers c on c.id = o.customer_id left join equipment e on e.id = o.equipment_id
       left join technicians t on t.id = o.technician_id
      where o.company_id = $1 and o.kind = 'os' and o.status in ('aprovada','aguardando_material','em_execucao','pronta') ${scope}
      order by case o.priority when 'urgente' then 0 when 'alta' then 1 when 'normal' then 2 else 3 end, o.promised_at nulls last
      limit 200`, params);
  const tparams = [req.companyId, tz];
  let tw = '';
  if (own) { tparams.push(req.ownTechnician); tw = ` and se.technician_id = $${tparams.length}`; }
  const { rows: today } = await q(
    `select se.id, se.kind, se.title, se.starts_at, se.ends_at, se.status, se.technician_id, se.order_id, se.request_id, se.location,
            o.number as order_number, sr.number as request_number
       from schedule_entries se left join orders o on o.id = se.order_id left join service_requests sr on sr.id = se.request_id
      where se.company_id = $1 and se.status in ('agendado','em_andamento')
        and (se.starts_at at time zone $2)::date <= (now() at time zone $2)::date
        and (se.ends_at at time zone $2)::date >= (now() at time zone $2)::date ${tw}
      order by se.starts_at`, tparams);
  res.json({ technicians: techs, queue, today });
});

/** Folha de horas por período. */
r.get('/timesheet', need('time_log', 'reports'), async (req, res) => {
  const { from, to, technician_id } = req.query;
  const params = [req.companyId];
  let where = 'l.company_id = $1 and l.ended_at is not null';
  if (from) { params.push(from); where += ` and l.started_at >= $${params.length}::date`; }
  if (to) { params.push(to); where += ` and l.started_at < $${params.length}::date + 1`; }
  const scope = req.user.role === 'owner' || can(req, 'reports') ? 'all' : req.perms.time_log;
  if (scope !== 'all') { params.push(req.ownTechnician || '00000000-0000-0000-0000-000000000000'); where += ` and l.technician_id = $${params.length}`; }
  else if (technician_id) { params.push(technician_id); where += ` and l.technician_id = $${params.length}`; }
  const { rows } = await q(
    `select l.id, l.order_id, l.technician_id, l.activity, l.started_at, l.ended_at, l.minutes, l.cost, l.manual, l.notes,
            t.name as technician_name, o.number as order_number, c.name as customer_name
       from order_time_logs l join technicians t on t.id = l.technician_id join orders o on o.id = l.order_id
       left join customers c on c.id = o.customer_id
      where ${where} order by l.started_at desc limit 3000`, params);
  const showCost = can(req, 'orders_values');
  const byTech = {};
  for (const x of rows) {
    const k = x.technician_id;
    byTech[k] ??= { technician_id: k, technician_name: x.technician_name, minutes: 0, cost: 0, entries: 0, manual: 0 };
    byTech[k].minutes += Number(x.minutes); byTech[k].cost += Number(x.cost || 0); byTech[k].entries += 1; if (x.manual) byTech[k].manual += 1;
  }
  const totals = Object.values(byTech).map((t) => ({ ...t, minutes: round2(t.minutes), cost: showCost ? round2(t.cost) : null }));
  res.json({ rows: showCost ? rows : rows.map((x) => ({ ...x, cost: null })), totals });
});

export default r;
