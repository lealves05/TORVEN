// Qualidade: modelos de checklist e inspeções (recebimento, inspeção final, entrega) por OS.
import { Router } from 'express';
import { z } from 'zod';
import { q, one, tx } from '../db.js';
import { need, can } from '../auth.js';
import { parse, notFound, bad, HttpError } from '../util.js';
import { logEvent } from '../domain.js';
import { audit } from '../audit.js';
import { scopeWhere } from './orders.js';
import { CATALOG, SEGMENTS, CATALOG_VERSION, installCatalog, ensureCatalog, syncCatalogChecklists, applyProfile } from '../osCatalog.js';

const r = Router();
export const CHECK_KIND = { recebimento: 'Recebimento', inspecao: 'Inspeção final', entrega: 'Entrega' };
export const RESULT = { aprovado: 'Aprovado', aprovado_ressalva: 'Aprovado com ressalva', reprovado: 'Reprovado' };

// ---------- tipos de OS ----------
/** Empresas antigas recebem os tipos padrão na primeira vez que abrem a lista. */
async function catalogOnce(companyId) {
  const c = await one('select os_catalog_version from companies where id = $1', [companyId]);
  if (c && c.os_catalog_version < CATALOG_VERSION) await tx((db) => ensureCatalog(db, companyId));
}

r.get('/types', async (req, res) => {
  await catalogOnce(req.companyId);
  const { rows } = await q(
    `select t.*, coalesce(l.ids, '{}') as checklist_ids, coalesce(l.n, 0) as checklists, coalesce(o.n, 0) as orders
       from order_types t
       left join lateral (select array_agg(x.template_id) as ids, count(*) filter (where c.active)::int as n
                            from order_type_checklists x join checklist_templates c on c.id = x.template_id where x.order_type_id = t.id) l on true
       left join lateral (select count(*)::int as n from orders where company_id = t.company_id and order_type_id = t.id) o on true
      where t.company_id = $1 ${req.query.all === '1' ? '' : 'and t.active'}
      order by array_position(array['mecanica','autoeletrica','motos','serralheria','soldas'], t.segment) nulls first, lower(t.name)`, [req.companyId]);
  res.json(rows);
});

const typeSchema = z.object({
  name: z.string().trim().min(2, 'informe o nome do tipo').max(80),
  description: z.string().trim().max(300).nullable().optional(),
  active: z.boolean().default(true),
});

const dupName = (e) => { if (e.code === '23505') throw bad('Já existe um tipo de OS com este nome.'); throw e; };

r.post('/types', need('settings', 'inspections'), async (req, res) => {
  const d = parse(typeSchema, req.body);
  const row = await one('insert into order_types (company_id, name, description, active) values ($1,$2,$3,$4) returning *',
    [req.companyId, d.name, d.description || null, d.active]).catch(dupName);
  await audit(null, req, { entity: 'settings', entityId: row.id, action: 'order_type', summary: `Tipo de OS "${d.name}" criado` });
  res.status(201).json(row);
});

r.put('/types/:id', need('settings', 'inspections'), async (req, res) => {
  const d = parse(typeSchema, req.body);
  const row = await tx(async (db) => {
    const { rows: [t] } = await db.query('update order_types set name=$3, description=$4, active=$5, updated_at=now() where id=$1 and company_id=$2 returning *',
      [req.params.id, req.companyId, d.name, d.description || null, d.active]).catch(dupName);
    if (!t) throw notFound('Tipo de OS não encontrado');
    await syncCatalogChecklists(db, req.companyId, { activate: t.active ? [t.id] : [] });
    return t;
  });
  await audit(null, req, { entity: 'settings', entityId: row.id, action: 'order_type', summary: `Tipo de OS "${d.name}" alterado` });
  res.json(row);
});

r.delete('/types/:id', need('settings', 'inspections'), async (req, res) => {
  await tx(async (db) => {
    const { rows: [t] } = await db.query('select * from order_types where id = $1 and company_id = $2 for update', [req.params.id, req.companyId]);
    if (!t) throw notFound('Tipo de OS não encontrado');
    const { rows: [u] } = await db.query('select count(*)::int as n from orders where order_type_id = $1', [t.id]);
    if (u.n) throw bad(`Há ${u.n} OS deste tipo. Para não usar mais, desative o tipo em vez de excluir.`);
    // checklists usados só por este tipo são desativados (não viram "gerais" de repente); os vínculos saem com o tipo
    await db.query(
      `update checklist_templates c set active = false where c.company_id = $2
          and exists (select 1 from order_type_checklists x where x.template_id = c.id and x.order_type_id = $1)
          and not exists (select 1 from order_type_checklists x where x.template_id = c.id and x.order_type_id <> $1)`, [t.id, req.companyId]);
    await db.query('delete from order_types where id = $1', [t.id]);
    await audit(db, req, { entity: 'settings', entityId: t.id, action: 'order_type', summary: `Tipo de OS "${t.name}" excluído` });
  });
  res.status(204).end();
});

/** Exibir ou ocultar um tipo na abertura da OS (as OS antigas continuam com ele). */
r.post('/types/:id/visible', need('settings', 'inspections'), async (req, res) => {
  const d = parse(z.object({ visible: z.boolean() }), req.body);
  const row = await tx(async (db) => {
    const { rows: [t] } = await db.query('update order_types set active = $3, updated_at = now() where id = $1 and company_id = $2 returning *', [req.params.id, req.companyId, d.visible]);
    if (!t) throw notFound('Tipo de OS não encontrado');
    await syncCatalogChecklists(db, req.companyId, { activate: d.visible ? [t.id] : [] });
    return t;
  });
  await audit(null, req, { entity: 'settings', entityId: row.id, action: 'order_type', summary: `Tipo de OS "${row.name}" ${d.visible ? 'exibido' : 'ocultado'} na abertura da OS` });
  res.json(row);
});

/** Exibir ou ocultar todos os tipos de um ramo (ou os criados pela empresa: segment = "proprios"). */
r.post('/types/segment-visible', need('settings', 'inspections'), async (req, res) => {
  const d = parse(z.object({ segment: z.enum([...Object.keys(SEGMENTS), 'proprios']), visible: z.boolean() }), req.body);
  const rowCount = await tx(async (db) => {
    const { rows } = await db.query(
      'update order_types set active = $3, updated_at = now() where company_id = $1 and segment is not distinct from $2::text returning id',
      [req.companyId, d.segment === 'proprios' ? null : d.segment, d.visible]);
    await syncCatalogChecklists(db, req.companyId, { activate: d.visible ? rows.map((x) => x.id) : [] });
    return rows.length;
  });
  await audit(null, req, { entity: 'settings', entityId: null, action: 'order_type', summary: `${rowCount} tipo(s) de ${SEGMENTS[d.segment] || 'OS próprios'} ${d.visible ? 'exibidos' : 'ocultados'}` });
  res.json({ updated: rowCount });
});

/** Catálogo padrão: ramos e quantos tipos de cada um faltam na empresa (foram apagados). */
r.get('/catalog', need('settings', 'inspections'), async (req, res) => {
  const { rows } = await q('select template_key from order_types where company_id = $1 and template_key is not null', [req.companyId]);
  const have = new Set(rows.map((x) => x.template_key));
  res.json(Object.entries(CATALOG).map(([k, c]) => ({
    segment: k, name: SEGMENTS[k], types: c.types.map(([key, name]) => ({ key, name, installed: have.has(key) })),
  })));
});

/** Restaura os tipos padrão que faltam (com os checklists), exibidos. */
r.post('/catalog/install', need('settings', 'inspections'), async (req, res) => {
  const d = parse(z.object({ segments: z.array(z.enum(Object.keys(SEGMENTS))).min(1) }), req.body);
  const created = await tx(async (db) => {
    await ensureCatalog(db, req.companyId);
    const n = await installCatalog(db, req.companyId, { segments: d.segments, visible: true });
    const { rows } = await db.query('update order_types set active = true, updated_at = now() where company_id = $1 and segment = any($2::text[]) returning id', [req.companyId, d.segments]);
    await syncCatalogChecklists(db, req.companyId, { activate: rows.map((x) => x.id) });
    await audit(db, req, { entity: 'settings', entityId: null, action: 'order_type', summary: `Tipos de OS padrão restaurados (${d.segments.map((x) => SEGMENTS[x]).join(', ')}): ${n} novo(s)` });
    return n;
  });
  res.json({ created });
});

/** Ramo da oficina: exibe os tipos padrão dos ramos escolhidos, oculta os dos outros ramos (os criados pela oficina
 *  não mudam), completa as listas de categorias e, se só trabalha com motos, a Tabela FIPE já abre em "Moto". */
r.get('/catalog/profile', need('settings', 'inspections'), async (req, res) => {
  const c = await one('select settings from companies where id = $1', [req.companyId]);
  res.json({ segments: c?.settings?.segments || [] });
});
r.post('/catalog/profile', need('settings'), async (req, res) => {
  const d = parse(z.object({ segments: z.array(z.enum(Object.keys(SEGMENTS))).min(1, 'escolha pelo menos um ramo') }), req.body);
  const segs = [...new Set(d.segments)];
  const out = await tx(async (db) => {
    const r2 = await applyProfile(db, req.companyId, segs);
    await audit(db, req, { entity: 'settings', entityId: null, action: 'order_type',
      summary: `Ramo da oficina: ${segs.map((x) => SEGMENTS[x]).join(', ')} (${r2.shown} tipo(s) exibidos, ${r2.hidden} ocultados, ${r2.created} criados)` });
    return r2;
  });
  res.json(out);
});

async function checkType(db, companyId, id, { activeOnly = true } = {}) {
  if (!id) return null;
  const { rows: [t] } = await db.query(`select id, name from order_types where id = $1 and company_id = $2${activeOnly ? ' and active' : ''}`, [id, companyId]);
  if (!t) throw notFound('Tipo de OS não encontrado ou desativado');
  return t;
}
export { checkType };

/** Confere que os tipos existem na empresa e devolve os ids válidos (sem repetição). */
async function checkTypes(db, companyId, ids) {
  const list = [...new Set((ids || []).filter(Boolean))];
  if (!list.length) return [];
  const { rows } = await db.query('select id, name from order_types where company_id = $1 and id = any($2::uuid[])', [companyId, list]);
  if (rows.length !== list.length) throw notFound('Tipo de OS não encontrado');
  return rows;
}

/** Vincula os checklists ao tipo de OS (substitui a lista). */
r.put('/types/:id/checklists', need('settings', 'inspections'), async (req, res) => {
  const d = parse(z.object({ template_ids: z.array(z.string().uuid()).max(100) }), req.body);
  const out = await tx(async (db) => {
    const t = await checkType(db, req.companyId, req.params.id, { activeOnly: false });
    const ids = [...new Set(d.template_ids)];
    if (ids.length) {
      const { rows } = await db.query('select id from checklist_templates where company_id = $1 and id = any($2::uuid[])', [req.companyId, ids]);
      if (rows.length !== ids.length) throw notFound('Checklist não encontrado');
    }
    await db.query('delete from order_type_checklists where order_type_id = $1 and not (template_id = any($2::uuid[]))', [t.id, ids]);
    if (ids.length) {
      await db.query(
        `insert into order_type_checklists (company_id, order_type_id, template_id) select $1, $2, unnest($3::uuid[]) on conflict do nothing`,
        [req.companyId, t.id, ids]);
    }
    await audit(db, req, { entity: 'settings', entityId: t.id, action: 'order_type', summary: `Tipo de OS "${t.name}": ${ids.length} checklist(s) vinculado(s)` });
    return { id: t.id, checklist_ids: ids };
  });
  res.json(out);
});

/** Checklists obrigatórios de uma OS (do tipo dela e os gerais) que ainda não foram registrados. */
export async function missingChecklists(db, order, kinds) {
  const { rows } = await db.query(
    `select t.kind, t.name from checklist_templates t
      where t.company_id = $1 and t.active and t.required and t.kind = any($3::text[])
        and (not exists (select 1 from order_type_checklists x where x.template_id = t.id)
             or exists (select 1 from order_type_checklists x where x.template_id = t.id and x.order_type_id = $2))
        and not exists (select 1 from order_inspections i where i.order_id = $4 and i.kind = t.kind
                          and (i.result <> 'reprovado' or t.kind = 'recebimento'))
      order by t.kind, t.name`,
    [order.company_id, order.order_type_id || null, kinds, order.id]);
  return rows;
}

export async function assertChecklists(db, order, kinds, when) {
  if (order.kind !== 'os') return;
  const miss = await missingChecklists(db, order, kinds);
  if (!miss.length) return;
  const names = [...new Set(miss.map((m) => `${CHECK_KIND[m.kind]} ("${m.name}")`))].join(', ');
  throw bad(`Antes de ${when}, registre o checklist obrigatório: ${names}. Ele fica no quadro "Qualidade e checklists" da OS.`);
}

// ---------- modelos de checklist ----------
r.get('/templates', async (req, res) => {
  await catalogOnce(req.companyId);
  const params = [req.companyId];
  let where = req.query.all === '1' ? '' : ' and c.active';
  if (req.query.order_type_id) {
    if (!/^[0-9a-f-]{36}$/i.test(String(req.query.order_type_id))) throw bad('Tipo de OS inválido.');
    // para a OS: os checklists do tipo dela primeiro, depois os gerais
    params.push(req.query.order_type_id);
    where += ` and (l.ids is null or $${params.length}::uuid = any(l.ids))`;
  }
  const { rows } = await q(
    `select c.*, coalesce(l.ids, '{}') as order_type_ids, coalesce(l.names, '{}') as order_type_names,
            l.ids[1] as order_type_id, l.names[1] as order_type_name
       from checklist_templates c
       left join lateral (select array_agg(t.id order by lower(t.name)) as ids, array_agg(t.name order by lower(t.name)) as names
                            from order_type_checklists x join order_types t on t.id = x.order_type_id where x.template_id = c.id) l on true
      where c.company_id = $1${where}
      order by c.kind, (l.ids is null), lower(c.name)`, params);
  res.json(rows);
});

const tplSchema = z.object({
  name: z.string().trim().min(2, 'informe o nome'),
  kind: z.enum(Object.keys(CHECK_KIND)),
  items: z.array(z.string().trim().min(2)).min(1, 'inclua ao menos um item').max(60),
  active: z.boolean().default(true),
  order_type_id: z.string().uuid().nullable().optional(), // compatibilidade: um tipo só
  order_type_ids: z.array(z.string().uuid()).max(100).optional(), // vazio = geral (todas as OS)
  required: z.boolean().default(false),
});
const typeIdsOf = (d) => d.order_type_ids ?? (d.order_type_id ? [d.order_type_id] : []);

async function linkTemplate(db, companyId, templateId, types) {
  await db.query('delete from order_type_checklists where template_id = $1', [templateId]);
  if (types.length) {
    await db.query('insert into order_type_checklists (company_id, order_type_id, template_id) select $1, unnest($2::uuid[]), $3',
      [companyId, types.map((t) => t.id), templateId]);
  }
}
const typesLabel = (types) => (types.length ? ` para ${types.map((t) => `"${t.name}"`).join(', ')}` : ' (geral)');

r.post('/templates', need('settings', 'inspections'), async (req, res) => {
  const d = parse(tplSchema, req.body);
  const row = await tx(async (db) => {
    const types = await checkTypes(db, req.companyId, typeIdsOf(d));
    const { rows: [x] } = await db.query(
      `insert into checklist_templates (company_id, name, kind, items, active, required) values ($1,$2,$3,$4,$5,$6) returning *`,
      [req.companyId, d.name, d.kind, JSON.stringify(d.items), d.active, d.required]);
    await linkTemplate(db, req.companyId, x.id, types);
    await audit(db, req, { entity: 'settings', entityId: x.id, action: 'checklist', summary: `Checklist "${d.name}"${d.required ? ' (obrigatório)' : ''} criado${typesLabel(types)}` });
    return { ...x, order_type_ids: types.map((t) => t.id) };
  });
  res.status(201).json(row);
});

r.put('/templates/:id', need('settings', 'inspections'), async (req, res) => {
  const d = parse(tplSchema, req.body);
  const row = await tx(async (db) => {
    const types = await checkTypes(db, req.companyId, typeIdsOf(d));
    const { rows: [x] } = await db.query(
      `update checklist_templates set name=$3, kind=$4, items=$5, active=$6, required=$7 where id=$1 and company_id=$2 returning *`,
      [req.params.id, req.companyId, d.name, d.kind, JSON.stringify(d.items), d.active, d.required]);
    if (!x) throw notFound();
    await linkTemplate(db, req.companyId, x.id, types);
    await audit(db, req, { entity: 'settings', entityId: x.id, action: 'checklist', summary: `Checklist "${d.name}"${d.required ? ' (obrigatório)' : ''} alterado${typesLabel(types)}` });
    return { ...x, order_type_ids: types.map((t) => t.id) };
  });
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

// ---------- tipo da OS ----------
r.put('/orders/:id/type', async (req, res) => {
  if (!can(req, 'orders_edit') && !can(req, 'orders_create')) throw new HttpError(403, 'Seu perfil de acesso não permite esta ação.');
  const d = parse(z.object({ order_type_id: z.string().uuid().nullable() }), req.body);
  const out = await tx(async (db) => {
    const o = await visibleOrder(db, req, req.params.id, true);
    if (o.kind !== 'os') throw bad('Só ordens de serviço têm tipo.');
    if (['entregue', 'cancelada'].includes(o.status)) throw bad('OS entregue ou cancelada. Reabra para alterar.');
    if ((o.order_type_id || null) === (d.order_type_id || null)) return o;
    const t = await checkType(db, req.companyId, d.order_type_id);
    await db.query('update orders set order_type_id = $2, updated_at = now() where id = $1', [o.id, t?.id || null]);
    const msg = t ? `Tipo da OS: ${t.name}` : 'Tipo da OS removido';
    await logEvent(db, o.id, { type: 'nota', message: msg, isPublic: false, userId: req.user.id });
    await audit(db, req, { entity: 'order', entityId: o.id, action: 'order_type', summary: `OS nº ${o.number} — ${msg}` });
    return { ...o, order_type_id: t?.id || null };
  });
  res.json({ id: out.id, order_type_id: out.order_type_id });
});

export default r;
