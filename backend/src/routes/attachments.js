// Anexos (fotos autorizadas e documentos) de clientes, objetos, solicitações, orçamentos e OS.
import { Router } from 'express';
import { z } from 'zod';
import { q, one } from '../db.js';
import { can } from '../auth.js';
import { parse, notFound, bad, HttpError } from '../util.js';
import { audit } from '../audit.js';

const r = Router();
const TABLE = { equipment: 'equipment', request: 'service_requests', quote: 'quotes', order: 'orders', customer: 'customers' };
const READ = { equipment: ['customers_view'], customer: ['customers_view'], request: ['requests_view'], quote: ['quotes_view', 'quotes'], order: ['orders_view'] };
const WRITE = { equipment: ['customers_edit', 'orders_edit'], customer: ['customers_edit'], request: ['requests_manage'], quote: ['quotes'], order: ['orders_edit', 'orders_create'] };
const MAX_BYTES = 1_500_000;
const MIMES = /^(image\/(jpeg|png|webp|gif)|application\/pdf)$/;

const allowed = (req, keys) => keys.some((k) => can(req, k));

async function checkParent(req, entity, id) {
  if (!TABLE[entity]) throw bad('Tipo de anexo inválido.');
  const row = await one(`select id from ${TABLE[entity]} where id = $1 and company_id = $2`, [id, req.companyId]);
  if (!row) throw notFound('Registro não encontrado');
}

r.get('/', async (req, res) => {
  const { entity, entity_id } = req.query;
  if (!TABLE[entity] || !entity_id) throw bad('Informe entity e entity_id.');
  if (!allowed(req, READ[entity])) throw new HttpError(403, 'Seu perfil de acesso não permite esta ação.');
  const { rows } = await q(
    `select a.id, a.entity, a.entity_id, a.filename, a.mime, a.size, a.caption, a.authorized, a.created_at, u.name as created_by_name
       from attachments a left join users u on u.id = a.created_by
      where a.company_id = $1 and a.entity = $2 and a.entity_id = $3 order by a.created_at`, [req.companyId, entity, entity_id]);
  res.json(rows);
});

r.get('/:id', async (req, res) => {
  const a = await one('select * from attachments where id = $1 and company_id = $2', [req.params.id, req.companyId]);
  if (!a) throw notFound();
  if (!allowed(req, READ[a.entity])) throw new HttpError(403, 'Seu perfil de acesso não permite esta ação.');
  if (req.query.raw === '1') {
    res.setHeader('Content-Type', a.mime);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return res.end(Buffer.from(a.data, 'base64'));
  }
  res.json(a);
});

const schema = z.object({
  entity: z.enum(Object.keys(TABLE)),
  entity_id: z.string().uuid(),
  filename: z.string().trim().min(1).max(200),
  mime: z.string().regex(MIMES, 'formato não permitido (use JPG, PNG, WEBP ou PDF)'),
  data: z.string().min(10),
  caption: z.string().trim().max(300).nullable().optional(),
  authorized: z.boolean().default(true),
});

r.post('/', async (req, res) => {
  const d = parse(schema, req.body);
  if (!allowed(req, WRITE[d.entity])) throw new HttpError(403, 'Seu perfil de acesso não permite esta ação.');
  if (!d.authorized) throw bad('Confirme que o cliente autorizou o registro desta foto/documento.');
  const data = d.data.replace(/^data:[^;]+;base64,/, '');
  if (!/^[A-Za-z0-9+/=\s]+$/.test(data)) throw bad('Arquivo inválido.');
  const size = Math.floor((data.replace(/\s/g, '').length * 3) / 4);
  if (size > MAX_BYTES) throw bad('Arquivo muito grande (máx. 1,5 MB). Fotos são reduzidas automaticamente no navegador.');
  await checkParent(req, d.entity, d.entity_id);
  const { rows: [{ n }] } = await q('select count(*)::int as n from attachments where company_id = $1 and entity = $2 and entity_id = $3',
    [req.companyId, d.entity, d.entity_id]);
  if (n >= 20) throw bad('Limite de 20 anexos por registro.');
  const a = await one(
    `insert into attachments (company_id, entity, entity_id, filename, mime, size, data, caption, authorized, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id, entity, entity_id, filename, mime, size, caption, authorized, created_at`,
    [req.companyId, d.entity, d.entity_id, d.filename, d.mime, size, data, d.caption || null, d.authorized, req.user.id]);
  await audit(null, req, { entity: 'attachment', entityId: a.id, action: 'create', summary: `Anexo "${a.filename}" incluído (${d.entity})`, data: { entity: d.entity, entity_id: d.entity_id } });
  res.status(201).json(a);
});

r.delete('/:id', async (req, res) => {
  const a = await one('select id, entity, entity_id, filename from attachments where id = $1 and company_id = $2', [req.params.id, req.companyId]);
  if (!a) throw notFound();
  if (!allowed(req, WRITE[a.entity])) throw new HttpError(403, 'Seu perfil de acesso não permite esta ação.');
  await q('delete from attachments where id = $1', [a.id]);
  await audit(null, req, { entity: 'attachment', entityId: a.id, action: 'delete', summary: `Anexo "${a.filename}" removido (${a.entity})`, data: { entity: a.entity, entity_id: a.entity_id } });
  res.status(204).end();
});

export default r;
