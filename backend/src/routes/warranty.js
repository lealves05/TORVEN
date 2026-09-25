// Garantias: chamados sobre OS entregues, análise técnica e OS de retrabalho sem custo ao cliente.
import { Router } from 'express';
import { z } from 'zod';
import { q, one, tx } from '../db.js';
import { need, can } from '../auth.js';
import { parse, notFound, bad, publicToken, HttpError } from '../util.js';
import { nextNumber, logEvent } from '../domain.js';
import { audit } from '../audit.js';

const r = Router();
r.use(need('warranty_manage', 'orders_view'));

export const WARRANTY_STATUS = { aberta: 'Aberta', em_analise: 'Em análise', procedente: 'Procedente', improcedente: 'Improcedente', concluida: 'Concluída' };
const NEXT = {
  aberta: ['em_analise', 'procedente', 'improcedente'],
  em_analise: ['procedente', 'improcedente'],
  procedente: ['concluida'],
  improcedente: ['concluida', 'em_analise'],
  concluida: [],
};

const SELECT = `
  select w.*, o.number as order_number, o.delivered_at, o.warranty_until, o.warranty_days, c.name as customer_name, c.phone as customer_phone,
         e.description as equipment_description, ro.number as rework_number, ro.status as rework_status, u.name as opened_by_name
    from warranty_claims w join orders o on o.id = w.order_id left join customers c on c.id = w.customer_id
    left join equipment e on e.id = o.equipment_id left join orders ro on ro.id = w.rework_order_id
    left join users u on u.id = w.opened_by`;

r.get('/', async (req, res) => {
  const params = [req.companyId];
  let where = 'w.company_id = $1';
  const { status, search, order_id } = req.query;
  if (status === 'abertas') where += " and w.status in ('aberta','em_analise','procedente')";
  else if (status) { params.push(String(status).split(',')); where += ` and w.status = any($${params.length})`; }
  if (order_id) { params.push(order_id); where += ` and w.order_id = $${params.length}`; }
  if (search) {
    const t = String(search).trim().toLowerCase();
    params.push(`%${t}%`);
    const num = /^\d+$/.test(t) ? ` or w.number = ${parseInt(t, 10)} or o.number = ${parseInt(t, 10)}` : '';
    where += ` and (lower(coalesce(c.name,'')) like $${params.length} or lower(w.description) like $${params.length}${num})`;
  }
  const { rows } = await q(`${SELECT} where ${where} order by case when w.status in ('concluida','improcedente') then 1 else 0 end, w.opened_at desc limit 1000`, params);
  res.json(rows);
});

r.get('/:id', async (req, res) => {
  const w = await one(`${SELECT} where w.id = $1 and w.company_id = $2`, [req.params.id, req.companyId]);
  if (!w) throw notFound('Garantia não encontrada');
  res.json(w);
});

r.post('/', need('warranty_manage'), async (req, res) => {
  const d = parse(z.object({ order_id: z.string().uuid(), description: z.string().trim().min(5, 'descreva o problema relatado') }), req.body);
  const out = await tx(async (db) => {
    const { rows: [o] } = await db.query('select * from orders where id = $1 and company_id = $2 for update', [d.order_id, req.companyId]);
    if (!o) throw notFound('OS não encontrada');
    if (o.status !== 'entregue') throw bad('Garantia só pode ser aberta para OS entregue.');
    const { rows: [open] } = await db.query("select number from warranty_claims where order_id = $1 and status in ('aberta','em_analise','procedente')", [o.id]);
    if (open) throw bad(`Já existe a garantia nº ${open.number} em andamento para esta OS.`);
    const today = new Date().toISOString().slice(0, 10);
    const within = !!o.warranty_until && o.warranty_until >= today;
    const number = await nextNumber(db, 'warranty_claims', req.companyId);
    const { rows: [w] } = await db.query(
      `insert into warranty_claims (company_id, number, order_id, customer_id, within_warranty, description, opened_by)
       values ($1,$2,$3,$4,$5,$6,$7) returning *`,
      [req.companyId, number, o.id, o.customer_id, within, d.description, req.user.id]);
    await logEvent(db, o.id, { type: 'nota', message: `Garantia nº ${number} aberta${within ? '' : ' (fora do prazo de garantia)'}: ${d.description}`, userId: req.user.id });
    await audit(db, req, { entity: 'warranty', entityId: w.id, action: 'create', summary: `Garantia nº ${number} aberta para a OS nº ${o.number}${within ? '' : ' — fora do prazo'}` });
    return w;
  });
  res.status(201).json(await one(`${SELECT} where w.id = $1`, [out.id]));
});

r.post('/:id/status', need('warranty_manage'), async (req, res) => {
  const d = parse(z.object({
    status: z.enum(Object.keys(WARRANTY_STATUS)), analysis: z.string().trim().max(4000).nullable().optional(),
    resolution: z.string().trim().max(4000).nullable().optional(),
  }), req.body);
  await tx(async (db) => {
    const { rows: [w] } = await db.query('select * from warranty_claims where id = $1 and company_id = $2 for update', [req.params.id, req.companyId]);
    if (!w) throw notFound();
    if (!NEXT[w.status].includes(d.status)) throw bad(`Não é possível passar de "${WARRANTY_STATUS[w.status]}" para "${WARRANTY_STATUS[d.status]}".`);
    const analysis = d.analysis ?? w.analysis;
    const resolution = d.resolution ?? w.resolution;
    if (['procedente', 'improcedente'].includes(d.status) && !analysis) throw bad('Registre a análise técnica.');
    if (d.status === 'concluida' && !resolution) throw bad('Descreva a solução dada ao cliente.');
    if (d.status === 'concluida' && w.rework_order_id) {
      const { rows: [ro] } = await db.query('select status from orders where id = $1', [w.rework_order_id]);
      if (ro && !['entregue', 'cancelada'].includes(ro.status)) throw bad('A OS de retrabalho ainda não foi entregue.');
    }
    await db.query(
      `update warranty_claims set status = $2, analysis = $3, resolution = $4,
              closed_at = case when $2 in ('concluida') then now() else null end where id = $1`,
      [w.id, d.status, analysis || null, resolution || null]);
    await audit(db, req, { entity: 'warranty', entityId: w.id, action: 'status', summary: `Garantia nº ${w.number}: ${WARRANTY_STATUS[w.status]} → ${WARRANTY_STATUS[d.status]}` });
  });
  res.json(await one(`${SELECT} where w.id = $1`, [req.params.id]));
});

/** Abre OS de retrabalho (sem valor para o cliente) vinculada à OS original. */
r.post('/:id/rework', need('warranty_manage'), async (req, res) => {
  if (!can(req, 'orders_create')) throw new HttpError(403, 'Seu perfil não permite abrir OS.');
  const out = await tx(async (db) => {
    const { rows: [w] } = await db.query('select * from warranty_claims where id = $1 and company_id = $2 for update', [req.params.id, req.companyId]);
    if (!w) throw notFound();
    if (w.rework_order_id) throw bad('Esta garantia já tem OS de retrabalho.');
    if (!['aberta', 'em_analise', 'procedente'].includes(w.status)) throw bad('Garantia encerrada.');
    const { rows: [o] } = await db.query('select * from orders where id = $1', [w.order_id]);
    const number = await nextNumber(db, 'orders', req.companyId);
    const { rows: [ro] } = await db.query(
      `insert into orders (company_id, number, kind, unit_id, customer_id, equipment_id, technician_id, status, priority, service_location,
              service_address, problem, warranty_days, warranty_of, public_token, created_by)
       values ($1,$2,'os',$3,$4,$5,$6,'aberta','alta',$7,$8,$9,0,$10,$11,$12) returning id, number`,
      [req.companyId, number, o.unit_id, o.customer_id, o.equipment_id, o.technician_id, o.service_location, o.service_address,
        `GARANTIA da OS nº ${o.number} (chamado nº ${w.number}): ${w.description}`, o.id, publicToken(), req.user.id]);
    await logEvent(db, ro.id, { type: 'criacao', to: 'aberta', message: `OS de retrabalho — garantia da OS nº ${o.number}`, isPublic: true, userId: req.user.id });
    await logEvent(db, o.id, { type: 'nota', message: `Retrabalho em garantia: OS nº ${ro.number}`, userId: req.user.id });
    await db.query(
      `update warranty_claims set rework_order_id = $2, status = case when status in ('aberta','em_analise') then 'procedente' else status end,
              analysis = coalesce(analysis, 'Procedente — retrabalho aberto') where id = $1`, [w.id, ro.id]);
    await audit(db, req, { entity: 'warranty', entityId: w.id, action: 'rework', summary: `Garantia nº ${w.number}: OS de retrabalho nº ${ro.number} aberta` });
    return ro;
  });
  res.status(201).json({ order_id: out.id, number: out.number });
});

export default r;
