// Unidades (filiais / oficinas) da empresa.
import { Router } from 'express';
import { z } from 'zod';
import { q, one, tx } from '../db.js';
import { need } from '../auth.js';
import { parse, notFound, bad } from '../util.js';
import { audit } from '../audit.js';

const r = Router();
const s = z.string().trim();
const opt = s.nullable().optional();
const schema = z.object({
  name: s.min(2, 'informe o nome da unidade'),
  phone: opt, cep: opt, street: opt, number: opt, complement: opt, district: opt, city: opt,
  uf: z.string().trim().max(2).nullable().optional(), city_code: opt,
  is_default: z.boolean().optional(), active: z.boolean().optional(),
});
const COLS = Object.keys(schema.shape).filter((k) => k !== 'is_default');

r.get('/', async (req, res) => {
  const { rows } = await q(
    `select u.*, (select count(*) from users x where x.unit_id = u.id)::int as users_count
       from units u where u.company_id = $1 order by u.is_default desc, lower(u.name)`, [req.companyId]);
  res.json(rows);
});

async function setDefault(db, companyId, id) {
  await db.query('update units set is_default = (id = $2) where company_id = $1', [companyId, id]);
}

r.post('/', need('units_manage'), async (req, res) => {
  const d = parse(schema, req.body);
  const u = await tx(async (db) => {
    const keys = COLS.filter((k) => d[k] !== undefined);
    const { rows: [row] } = await db.query(
      `insert into units (company_id, ${keys.join(',')}) values ($1, ${keys.map((_, i) => `$${i + 2}`).join(',')}) returning *`,
      [req.companyId, ...keys.map((k) => d[k])]);
    if (d.is_default) await setDefault(db, req.companyId, row.id);
    await audit(db, req, { entity: 'unit', entityId: row.id, action: 'create', summary: `Unidade ${row.name} criada` });
    return row;
  });
  res.status(201).json(u);
});

r.put('/:id', need('units_manage'), async (req, res) => {
  const d = parse(schema.partial(), req.body);
  const u = await tx(async (db) => {
    const { rows: [cur] } = await db.query('select * from units where id = $1 and company_id = $2 for update', [req.params.id, req.companyId]);
    if (!cur) throw notFound('Unidade não encontrada');
    if (cur.is_default && d.active === false) throw bad('A unidade principal não pode ser desativada. Defina outra como principal antes.');
    const keys = COLS.filter((k) => d[k] !== undefined);
    if (keys.length) {
      await db.query(`update units set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} where id = $1`, [cur.id, ...keys.map((k) => d[k])]);
    }
    if (d.is_default) await setDefault(db, req.companyId, cur.id);
    await audit(db, req, { entity: 'unit', entityId: cur.id, action: 'update', summary: `Unidade ${d.name || cur.name} alterada` });
    return (await db.query('select * from units where id = $1', [cur.id])).rows[0];
  });
  res.json(u);
});

r.delete('/:id', need('units_manage'), async (req, res) => {
  const cur = await one('select * from units where id = $1 and company_id = $2', [req.params.id, req.companyId]);
  if (!cur) throw notFound();
  if (cur.is_default) throw bad('A unidade principal não pode ser removida.');
  await q('update units set active = false where id = $1', [cur.id]);
  await audit(null, req, { entity: 'unit', entityId: cur.id, action: 'deactivate', summary: `Unidade ${cur.name} desativada` });
  res.status(204).end();
});

export default r;
