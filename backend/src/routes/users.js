import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { q, one, tx } from '../db.js';
import { need } from '../auth.js';
import { parse, notFound, HttpError, ROLES, AGENT_ACTIONS, agentProfile, permissionsFor } from '../util.js';
import { audit } from '../audit.js';
import { passwordSchema, setPassword } from '../security.js';

const r = Router();
r.use(need('users'));

const cols = 'id, name, email, role, technician_id, unit_id, active, created_at';
const ROLE_KEYS = Object.keys(ROLES);

// Vários proprietários: só um proprietário dá ou tira o perfil de proprietário, e a empresa nunca fica sem nenhum ativo.
const isOwner = (req) => req.user.role === 'owner';
async function otherActiveOwners(db, companyId, exceptId) {
  await db.query('select id from companies where id = $1 for no key update', [companyId]); // serializa mudanças de proprietário
  const { rows: [x] } = await db.query("select count(*)::int as n from users where company_id = $1 and role = 'owner' and active and id <> $2", [companyId, exceptId]);
  return x.n;
}

r.get('/', async (req, res) => {
  const { rows } = await q(`select ${cols}, agent_permissions from users where company_id = $1 order by created_at`, [req.companyId]);
  res.json(rows.map(({ agent_permissions, ...u }) => ({ ...u, agent_enabled: agentProfile({ ...u, agent_permissions }).enabled })));
});

// ---------- Assistente: liberação por usuário ----------
/** O que o assistente pode fazer para este usuário; "blocked" = o perfil de acesso dele não tem a permissão normal. */
r.get('/:id/agent', async (req, res) => {
  const u = await one('select id, name, role, agent_permissions from users where id = $1 and company_id = $2', [req.params.id, req.companyId]);
  if (!u) throw notFound();
  const perms = permissionsFor(u.role, req.settings);
  const has = (k) => perms[k] === true || perms[k] === 'all' || perms[k] === 'own';
  res.json({ user: { id: u.id, name: u.name, role: u.role }, ...agentProfile(u),
    catalog: AGENT_ACTIONS.map((a) => ({ key: a.key, label: a.label, blocked: !a.needs.every(has) })) });
});

r.put('/:id/agent', async (req, res) => {
  const d = parse(z.object({
    reset: z.boolean().optional(),
    enabled: z.boolean().optional(),
    actions: z.record(z.enum(AGENT_ACTIONS.map((a) => a.key)), z.boolean()).optional(),
  }), req.body);
  const cur = await one('select id, name, role, agent_permissions from users where id = $1 and company_id = $2', [req.params.id, req.companyId]);
  if (!cur) throw notFound();
  if (cur.role === 'owner' && req.user.role !== 'owner') throw new HttpError(403, 'Só um proprietário altera o assistente de um proprietário.');
  if (cur.role === 'admin' && cur.id !== req.user.id && req.user.role !== 'owner') throw new HttpError(403, 'Só o proprietário pode alterar outro administrador.');
  const before = agentProfile(cur);
  const next = d.reset ? null : { enabled: d.enabled ?? before.enabled, actions: { ...before.actions, ...(d.actions || {}) } };
  await q('update users set agent_permissions = $3 where id = $1 and company_id = $2', [cur.id, req.companyId, next]);
  const after = agentProfile({ ...cur, agent_permissions: next });
  const label = (k) => AGENT_ACTIONS.find((a) => a.key === k)?.label || k;
  const changes = [];
  if (before.enabled !== after.enabled) changes.push(after.enabled ? 'assistente liberado' : 'assistente bloqueado');
  for (const a of AGENT_ACTIONS) if (before.actions[a.key] !== after.actions[a.key]) changes.push(`${after.actions[a.key] ? '+' : '−'} ${label(a.key)}`);
  await audit(null, req, { entity: 'user', entityId: cur.id, action: 'agent',
    summary: `Assistente de ${cur.name}: ${d.reset ? 'voltou ao padrão do perfil' : changes.join('; ') || 'sem mudança'}` });
  res.json(after);
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
  if (d.role === 'admin' && !isOwner(req)) throw new HttpError(403, 'Só o proprietário pode criar um administrador.');
  if (d.role === 'owner' && !isOwner(req)) throw new HttpError(403, 'Só um proprietário pode criar outro proprietário.');
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
  // cadastro de proprietário: só proprietário altera; administrador só é alterado pelo proprietário ou por ele mesmo
  if (cur.role === 'owner' && !isOwner(req)) throw new HttpError(403, 'Só um proprietário pode alterar o cadastro de um proprietário.');
  if (cur.role === 'admin' && cur.id !== req.user.id && !isOwner(req)) throw new HttpError(403, 'Só o proprietário pode alterar outro administrador.');
  if (d.role === 'admin' && cur.role !== 'admin' && !isOwner(req)) throw new HttpError(403, 'Só o proprietário pode tornar alguém administrador.');
  if (cur.role !== 'owner' && d.role === 'owner' && !isOwner(req)) throw new HttpError(403, 'Só um proprietário pode tornar alguém proprietário.');
  if (cur.id === req.user.id && d.active === false) throw new HttpError(400, 'Você não pode desativar a si mesmo.');
  const losesOwner = cur.role === 'owner' && (d.role !== 'owner' || d.active === false);
  const u = await tx(async (db) => {
    if (losesOwner && (await otherActiveOwners(db, req.companyId, cur.id)) === 0) {
      throw new HttpError(400, 'A empresa precisa ter pelo menos um proprietário ativo. Torne outra pessoa proprietária antes.');
    }
    const { rows: [x] } = await db.query(
      `update users set name=$1, email=$2, role=$3, technician_id=$4, active=$5, unit_id=$6,
         auth_version = auth_version + case when $8::boolean then 1 else 0 end where id=$7 and company_id=$9 returning ${cols}`,
      [d.name, d.email, d.role, d.technician_id || null, d.active ?? cur.active, d.unit_id ?? cur.unit_id ?? null, cur.id,
        (d.active === false && cur.active) || cur.role !== d.role || String(cur.email).toLowerCase() !== String(d.email).toLowerCase(), req.companyId]);
    return x;
  });
  // senha redefinida pelo administrador: derruba as sessões do usuário (nenhuma sessão é criada em nome dele)
  if (d.password) await setPassword(null, cur.id, req.companyId, d.password);
  const changes = [];
  if (cur.role !== d.role) changes.push(`perfil ${ROLES[cur.role]} → ${ROLES[d.role]}`);
  if (cur.active !== u.active) changes.push(u.active ? 'reativado' : 'desativado');
  if (d.password) changes.push('senha redefinida');
  if (String(cur.email).toLowerCase() !== String(u.email).toLowerCase()) changes.push(`e-mail ${cur.email} → ${u.email}`);
  await audit(null, req, { entity: 'user', entityId: u.id, action: 'update', summary: `Usuário ${u.name} alterado${changes.length ? `: ${changes.join(', ')}` : ''}` });
  res.json(u);
});

r.delete('/:id', async (req, res) => {
  const cur = await one('select * from users where id = $1 and company_id = $2', [req.params.id, req.companyId]);
  if (!cur) throw notFound();
  if (cur.id === req.user.id) throw new HttpError(400, 'Você não pode remover o seu próprio acesso.');
  if (cur.role === 'owner' && !isOwner(req)) throw new HttpError(403, 'Só um proprietário pode remover outro proprietário.');
  if (cur.role === 'admin' && !isOwner(req)) throw new HttpError(403, 'Só o proprietário pode remover um administrador.');
  await tx(async (db) => {
    if (cur.role === 'owner' && (await otherActiveOwners(db, req.companyId, cur.id)) === 0) throw new HttpError(400, 'A empresa precisa ter pelo menos um proprietário ativo.');
    await db.query('delete from users where id = $1 and company_id = $2', [cur.id, req.companyId]);
  });
  await audit(null, req, { entity: 'user', entityId: cur.id, action: 'delete', summary: `Usuário ${cur.name} removido` });
  res.status(204).end();
});

export default r;
