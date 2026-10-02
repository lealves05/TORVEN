import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { q, one } from '../db.js';
import { need } from '../auth.js';
import { parse, notFound, HttpError, ROLES } from '../util.js';
import { audit } from '../audit.js';
import { passwordSchema, setPassword } from '../security.js';

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

// F09: técnico e unidade precisam ser da mesma empresa da sessão (formato UUID não basta)
async function assertRefs(companyId, d) {
  if (d.technician_id) {
    const t = await one('select 1 from technicians where id = $1 and company_id = $2', [d.technician_id, companyId]);
    if (!t) throw new HttpError(400, 'Técnico inválido.');
  }
  if (d.unit_id) {
    const u = await one('select 1 from units where id = $1 and company_id = $2', [d.unit_id, companyId]);
    if (!u) throw new HttpError(400, 'Unidade inválida.');
  }
}

r.post('/', async (req, res) => {
  const d = parse(z.object({ ...base, password: passwordSchema }), req.body);
  await assertRefs(req.companyId, d);
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
    password: passwordSchema.optional().or(z.literal('')),
  }), req.body);
  const cur = await one('select * from users where id = $1 and company_id = $2', [req.params.id, req.companyId]);
  if (!cur) throw notFound();
  await assertRefs(req.companyId, d);
  if (cur.role === 'owner' && d.role !== 'owner') throw new HttpError(400, 'O proprietário não pode ter o papel alterado.');
  if (cur.role !== 'owner' && d.role === 'owner') throw new HttpError(400, 'Só pode haver um proprietário.');
  if (cur.id === req.user.id && d.active === false) throw new HttpError(400, 'Você não pode desativar a si mesmo.');
  const u = await one(
    `update users set name=$1, email=$2, role=$3, technician_id=$4, active=$5, unit_id=$6,
       auth_version = auth_version + case when $8::boolean then 1 else 0 end where id=$7 and company_id=$9 returning ${cols}`,
    [d.name, d.email, d.role, d.technician_id || null, d.active ?? cur.active, d.unit_id ?? cur.unit_id ?? null, cur.id,
      (d.active === false && cur.active) || cur.role !== d.role, req.companyId]);
  // senha redefinida pelo administrador: derruba as sessões do usuário (nenhuma sessão é criada em nome dele)
  if (d.password) await setPassword(null, cur.id, req.companyId, d.password);
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
