// Fábrica de rotas CRUD simples (cadastros).
import { Router } from 'express';
import { q, one } from './db.js';
import { need } from './auth.js';
import { parse, notFound } from './util.js';

/**
 * @param {object} o
 * @param {string} o.table
 * @param {import('zod').ZodObject} o.schema
 * @param {string[]} o.write  permissões para criar/editar
 * @param {string[]} [o.read] permissões para listar (vazio = qualquer usuário logado)
 * @param {string[]} [o.search] colunas pesquisáveis
 * @param {string} [o.order]
 */
export function crud({ table, schema, write, read = [], search = ['name'], order = 'lower(name)', select = '*' }) {
  const r = Router();
  const cols = Object.keys(schema.shape);
  const readMw = read.length ? [need(...read, ...write)] : [];

  r.get('/', ...readMw, async (req, res) => {
    const params = [req.companyId];
    let where = 'company_id = $1';
    if (req.query.all !== '1') where += ' and active';
    if (req.query.search) {
      params.push(`%${String(req.query.search).toLowerCase()}%`);
      where += ` and (${search.map((c) => `lower(coalesce(${c}::text,'')) like $${params.length}`).join(' or ')})`;
    }
    const { rows } = await q(`select ${select} from ${table} where ${where} order by ${order} limit 1000`, params);
    res.json(rows);
  });

  r.get('/:id', ...readMw, async (req, res) => {
    const row = await one(`select ${select} from ${table} where id = $1 and company_id = $2`, [req.params.id, req.companyId]);
    if (!row) throw notFound();
    res.json(row);
  });

  r.post('/', need(...write), async (req, res) => {
    const d = parse(schema, req.body);
    const keys = cols.filter((c) => d[c] !== undefined);
    const row = await one(
      `insert into ${table} (company_id, ${keys.join(', ')}) values ($1, ${keys.map((_, i) => `$${i + 2}`).join(', ')}) returning *`,
      [req.companyId, ...keys.map((k) => d[k])]);
    res.status(201).json(row);
  });

  r.put('/:id', need(...write), async (req, res) => {
    const d = parse(schema.partial(), req.body);
    const keys = cols.filter((c) => d[c] !== undefined);
    if (!keys.length) throw notFound('Nada para alterar');
    const row = await one(
      `update ${table} set ${keys.map((k, i) => `${k} = $${i + 3}`).join(', ')} where id = $1 and company_id = $2 returning *`,
      [req.params.id, req.companyId, ...keys.map((k) => d[k])]);
    if (!row) throw notFound();
    res.json(row);
  });

  r.delete('/:id', need(...write), async (req, res) => {
    const row = await one(`update ${table} set active = false where id = $1 and company_id = $2 returning id`, [req.params.id, req.companyId]);
    if (!row) throw notFound();
    res.status(204).end();
  });

  return r;
}
