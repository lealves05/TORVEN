// Consulta da trilha de auditoria.
import { Router } from 'express';
import { q } from '../db.js';
import { need } from '../auth.js';

const r = Router();
r.use(need('audit_view'));

export const AUDIT_ENTITIES = {
  request: 'Solicitação', quote: 'Orçamento', order: 'Ordem de serviço', customer: 'Cliente', invoice: 'Documento fiscal',
  user: 'Usuário', unit: 'Unidade', settings: 'Configurações', permissions: 'Perfis de acesso', fiscal: 'Integração fiscal',
  stock: 'Estoque', cash: 'Caixa', payment: 'Pagamento', price: 'Preço', attachment: 'Anexo', schedule: 'Agenda', time: 'Apontamento de horas', inspection: 'Inspeção', warranty: 'Garantia',
};

r.get('/', async (req, res) => {
  const params = [req.companyId];
  let where = 'company_id = $1';
  const { entity, entity_id, user_id, from, to, search } = req.query;
  if (entity) { params.push(String(entity).split(',')); where += ` and entity = any($${params.length})`; }
  if (entity_id) { params.push(String(entity_id)); where += ` and entity_id = $${params.length}`; }
  if (user_id) { params.push(user_id); where += ` and user_id = $${params.length}`; }
  if (from) { params.push(from); where += ` and created_at >= $${params.length}::date`; }
  if (to) { params.push(to); where += ` and created_at < $${params.length}::date + 1`; }
  if (search) { params.push(`%${String(search).toLowerCase()}%`); where += ` and (lower(coalesce(summary,'')) like $${params.length} or lower(coalesce(user_name,'')) like $${params.length})`; }
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const { rows } = await q(
    `select id, user_id, user_name, entity, entity_id, action, summary, data, ip, created_at
       from audit_log where ${where} order by created_at desc, id desc limit ${limit} offset ${offset}`, params);
  const { rows: [{ total }] } = await q(`select count(*)::int as total from audit_log where ${where}`, params);
  res.json({ rows, total, entities: AUDIT_ENTITIES });
});

export default r;
