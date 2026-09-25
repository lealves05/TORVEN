import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { q, one } from '../db.js';
import { need } from '../auth.js';
import { parse, notFound, HttpError, ROLES } from '../util.js';
import { audit } from '../audit.js';

const r = Router();
r.use(need('users'));

const cols = 'id, name, email, role, technician_id, unit_id, active, created_at';
const ROLE_KEYS = Object.keys(ROLES).filter((k) => k !== 'owner');

r.get('/', async (req, res) => {
  const { rows } = await q(`select ${cols} from users where company_id = $1 order by created_at`, [req.companyId]);
  res.json(rows);
});

const base = {
  name: z.string().trim().min(2, 'informe o nome'),
  email: z.string().trim().toLowerCase().email('e-mail inválido'),
  role: z.enum(ROLE_KEYS, { message: 'perfil inválido' }),
  technician_id: z.string().uuid().nullable().optional(),
  unit_id: z.string().uuid().nullable().optional(),
  active: z.boolean().optional(),
};

r.post('/', async (req, res) => {
  const d = parse(z.object({ ...base, password: z.string().min(6, 'senha mínima de 6 caracteres') }), req.body);
  const u = await one(
    `insert into users (company_id, name, email, password_hash, role, technician_id, unit_id)
     values ($1,$2,$3,$4,$5,$6,$7) returning ${cols}`,
    [req.companyId, d.name, d.email, await bcrypt.hash(d.password, 10), d.role, d.technician_id || null, d.unit_id || null]);
  await audit(null, req, { entity: 'user', entityId: u.id, action: 'create', summary: `Usuário ${u.name} criado (${ROLES[u.role]})` });
  res.status(201).json(u);
});

r.put('/:id', async (req, res) => {
  const d = parse(z.object({
    ...base,
    role: z.enum(Object.keys(ROLES)),
    password: z.string().min(6).optional().or(z.literal('')),
  }), req.body);
  const cur = await one('select * from users where id = $1 and company_id = $2', [req.params.id, req.companyId]);
  if (!cur) throw notFound();
  if (cur.role === 'owner' && d.role !== 'owner') throw new HttpError(400, 'O proprietário não pode ter o papel alterado.');
  if (cur.role !== 'owner' && d.role === 'owner') throw new HttpError(400, 'Só pode haver um proprietário.');
  if (cur.id === req.user.id && d.active === false) throw new HttpError(400, 'Você não pode desativar a si mesmo.');
  const u = await one(
    `update users set name=$1, email=$2, role=$3, technician_id=$4, active=$5, unit_id=$6 where id=$7 returning ${cols}`,
    [d.name, d.email, d.role, d.technician_id || null, d.active ?? cur.active, d.unit_id ?? cur.unit_id ?? null, cur.id]);
  if (d.password) await q('update users set password_hash = $1 where id = $2', [await bcrypt.hash(d.password, 10), cur.id]);
  const changes = [];
  if (cur.role !== d.role) changes.push(`perfil ${ROLES[cur.role]} → ${ROLES[d.role]}`);
  if (cur.active !== u.active) changes.push(u.active ? 'reativado' : 'desativado');
  if (d.password) changes.push('senha redefinida');
  await audit(null, req, { entity: 'user', entityId: u.id, action: 'update', summary: `Usuário ${u.name} alterado${changes.length ? `: ${changes.join(', ')}` : ''}` });
  res.json(u);
});

r.delete('/:id', async (req, res) => {
  const cur = await one('select * from users where id = $1 and company_id = $2', [req.params.id, req.companyId]);
  if (!cur) throw notFound();
  if (cur.role === 'owner' || cur.id === req.user.id) throw new HttpError(400, 'Este usuário não pode ser removido.');
  await q('delete from users where id = $1', [cur.id]);
  await audit(null, req, { entity: 'user', entityId: cur.id, action: 'delete', summary: `Usuário ${cur.name} removido` });
  res.status(204).end();
});

export default r;
