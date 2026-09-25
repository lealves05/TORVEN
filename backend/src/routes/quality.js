// Qualidade: modelos de checklist e inspeções (recebimento, inspeção final, entrega) por OS.
import { Router } from 'express';
import { z } from 'zod';
import { q, one, tx } from '../db.js';
import { need, can } from '../auth.js';
import { parse, notFound, bad, HttpError } from '../util.js';
import { logEvent } from '../domain.js';
import { audit } from '../audit.js';
import { scopeWhere } from './orders.js';

const r = Router();
export const CHECK_KIND = { recebimento: 'Recebimento', inspecao: 'Inspeção final', entrega: 'Entrega' };
export const RESULT = { aprovado: 'Aprovado', aprovado_ressalva: 'Aprovado com ressalva', reprovado: 'Reprovado' };

// ---------- modelos ----------
r.get('/templates', async (req, res) => {
  const { rows } = await q(
    `select * from checklist_templates where company_id = $1 ${req.query.all === '1' ? '' : 'and active'} order by kind, lower(name)`, [req.companyId]);
  res.json(rows);
});

const tplSchema = z.object({
  name: z.string().trim().min(2, 'informe o nome'),
  kind: z.enum(Object.keys(CHECK_KIND)),
  items: z.array(z.string().trim().min(2)).min(1, 'inclua ao menos um item').max(60),
  active: z.boolean().default(true),
});

r.post('/templates', need('settings', 'inspections'), async (req, res) => {
  const d = parse(tplSchema, req.body);
  const row = await one(
    'insert into checklist_templates (company_id, name, kind, items, active) values ($1,$2,$3,$4,$5) returning *',
    [req.companyId, d.name, d.kind, JSON.stringify(d.items), d.active]);
  await audit(null, req, { entity: 'settings', entityId: row.id, action: 'checklist', summary: `Checklist "${d.name}" criado` });
  res.status(201).json(row);
});

r.put('/templates/:id', need('settings', 'inspections'), async (req, res) => {
  const d = parse(tplSchema, req.body);
  const row = await one(
    'update checklist_templates set name=$3, kind=$4, items=$5, active=$6 where id=$1 and company_id=$2 returning *',
    [req.params.id, req.companyId, d.name, d.kind, JSON.stringify(d.items), d.active]);
  if (!row) throw notFound();
  await audit(null, req, { entity: 'settings', entityId: row.id, action: 'checklist', summary: `Checklist "${d.name}" alterado` });
  res.json(row);
});

// ---------- inspeções da OS ----------
async function visibleOrder(db, req, id, lock = false) {
  const params = [id, req.companyId];
  const scope = scopeWhere(req, params);
  const { rows: [o] } = await db.query(`select o.* from orders o where o.id = $1 and o.company_id = $2 ${scope}${lock ? ' for update' : ''}`, params);
  if (!o) throw notFound('OS não encontrada');
  return o;
}

r.get('/orders/:id/inspections', need('orders_view', 'inspections'), async (req, res) => {
  await visibleOrder({ query: q }, req, req.params.id);
  const { rows } = await q(
    `select i.*, u.name as inspector_name, t.name as template_name from order_inspections i
       left join users u on u.id = i.inspector_id left join checklist_templates t on t.id = i.template_id
      where i.order_id = $1 order by i.created_at desc`, [req.params.id]);
  res.json(rows);
});

const inspSchema = z.object({
  kind: z.enum(Object.keys(CHECK_KIND)).default('inspecao'),
  template_id: z.string().uuid().nullable().optional(),
  items: z.array(z.object({
    label: z.string().trim().min(1), result: z.enum(['ok', 'nok', 'na']), note: z.string().trim().max(500).nullable().optional(),
  })).min(1, 'preencha o checklist'),
  result: z.enum(Object.keys(RESULT)),
  notes: z.string().trim().max(2000).nullable().optional(),
});

r.post('/orders/:id/inspections', async (req, res) => {
  const d = parse(inspSchema, req.body);
  const allowed = d.kind === 'inspecao' ? can(req, 'inspections')
    : d.kind === 'entrega' ? can(req, 'orders_deliver') || can(req, 'inspections')
      : can(req, 'orders_edit') || can(req, 'orders_create') || can(req, 'inspections');
  if (!allowed) throw new HttpError(403, 'Seu perfil de acesso não permite registrar esta verificação.');
  const noks = d.items.filter((i) => i.result === 'nok');
  if (d.result === 'aprovado' && noks.length) throw bad('Há itens não conformes: use "Aprovado com ressalva" ou "Reprovado".');
  if (d.result !== 'aprovado' && !noks.length && !d.notes) throw bad('Descreva a ressalva ou o motivo da reprovação.');
  const row = await tx(async (db) => {
    const o = await visibleOrder(db, req, req.params.id, true);
    if (o.status === 'cancelada') throw bad('OS cancelada.');
    if (d.kind === 'inspecao' && !['em_execucao', 'pronta', 'aguardando_material', 'aprovada'].includes(o.status)) {
      throw bad('A inspeção final é feita durante/ao fim da execução.');
    }
    if (d.template_id) {
      const { rows: [t] } = await db.query('select id from checklist_templates where id = $1 and company_id = $2', [d.template_id, req.companyId]);
      if (!t) throw notFound('Checklist não encontrado');
    }
    const { rows: [x] } = await db.query(
      `insert into order_inspections (company_id, order_id, kind, template_id, items, result, notes, inspector_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
      [req.companyId, o.id, d.kind, d.template_id || null, JSON.stringify(d.items), d.result, d.notes || null, req.user.id]);
    const label = `${CHECK_KIND[d.kind]}: ${RESULT[d.result]}${noks.length ? ` (${noks.length} item(ns) não conforme(s))` : ''}`;
    if (d.kind === 'inspecao') {
      await db.query('update orders set inspection_result = $2, updated_at = now() where id = $1', [o.id, d.result]);
      if (d.result === 'reprovado' && o.status === 'pronta') {
        await db.query("update orders set status = 'em_execucao', finished_at = null, updated_at = now() where id = $1", [o.id]);
        await logEvent(db, o.id, { type: 'status', from: 'pronta', to: 'em_execucao', message: 'Reprovada na inspeção — volta para execução', userId: req.user.id });
      }
    }
    await logEvent(db, o.id, { type: 'nota', message: label + (d.notes ? ` — ${d.notes}` : ''), isPublic: false, userId: req.user.id });
    await audit(db, req, { entity: 'inspection', entityId: x.id, action: d.kind, summary: `OS nº ${o.number} — ${label}` });
    return x;
  });
  res.status(201).json(row);
});

export default r;
