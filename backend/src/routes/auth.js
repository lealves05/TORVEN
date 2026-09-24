import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { q, one, tx } from '../db.js';
import { signToken, requireAuth } from '../auth.js';
import { parse, slugify, withDefaults, HttpError, DEFAULT_SETTINGS, DEFAULT_FISCAL, permissionsFor, PERMISSIONS } from '../util.js';
import { seedDemo } from '../seed.js';

const r = Router();
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Muitas tentativas. Aguarde alguns minutos.' } });

export const COMPANY_COLS = `select id, name, trade_name, slug, document, state_registration, municipal_registration, phone, email,
  cep, street, number, complement, district, city, uf, city_code, logo_url, settings,
  (fiscal->>'provider') as fiscal_provider, (fiscal->>'environment') as fiscal_environment,
  (fiscal->'certificate'->>'valid_until') as fiscal_cert_until
  from companies where id = $1`;

export async function loadSession(userId) {
  const user = await one(
    `select u.id, u.name, u.email, u.role, u.technician_id, u.preferences, u.company_id
       from users u where u.id = $1`, [userId]);
  const company = await one(COMPANY_COLS, [user.company_id]);
  company.settings = withDefaults(company.settings);
  return { user, company, permissions: permissionsFor(user.role, company.settings), permissionCatalog: PERMISSIONS };
}

const registerSchema = z.object({
  companyName: z.string().trim().min(2, 'informe o nome da empresa'),
  name: z.string().trim().min(2, 'informe seu nome'),
  email: z.string().trim().toLowerCase().email('e-mail inválido'),
  password: z.string().min(6, 'a senha deve ter ao menos 6 caracteres'),
  phone: z.string().trim().optional(),
  demo: z.boolean().optional().default(true),
});

r.post('/register', limiter, async (req, res) => {
  const d = parse(registerSchema, req.body);
  const exists = await one('select 1 from users where email = $1', [d.email]);
  if (exists) throw new HttpError(409, 'Este e-mail já está cadastrado.');

  const hash = await bcrypt.hash(d.password, 10);
  const userId = await tx(async (db) => {
    let slug = slugify(d.companyName);
    const { rows: taken } = await db.query('select slug from companies where slug like $1', [`${slug}%`]);
    if (taken.some((t) => t.slug === slug)) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
    const { rows: [company] } = await db.query(
      'insert into companies (name, trade_name, slug, phone, email, settings, fiscal) values ($1,$1,$2,$3,$4,$5,$6) returning id',
      [d.companyName, slug, d.phone || null, d.email, DEFAULT_SETTINGS, DEFAULT_FISCAL]);
    const { rows: [user] } = await db.query(
      `insert into users (company_id, name, email, password_hash, role)
       values ($1,$2,$3,$4,'owner') returning id`,
      [company.id, d.name, d.email, hash]);
    if (d.demo) await seedDemo(db, company.id, user.id);
    return user.id;
  });

  const session = await loadSession(userId);
  res.status(201).json({ token: signToken(session.user), ...session });
});

r.post('/login', limiter, async (req, res) => {
  const d = parse(z.object({
    email: z.string().trim().toLowerCase().email('e-mail inválido'),
    password: z.string().min(1, 'informe a senha'),
  }), req.body);
  const user = await one('select id, company_id, password_hash, active from users where email = $1', [d.email]);
  if (!user || !(await bcrypt.compare(d.password, user.password_hash))) {
    throw new HttpError(401, 'E-mail ou senha incorretos.');
  }
  if (!user.active) throw new HttpError(403, 'Usuário desativado. Fale com o administrador.');
  const session = await loadSession(user.id);
  res.json({ token: signToken(user), ...session });
});

r.get('/me', requireAuth, async (req, res) => {
  res.json(await loadSession(req.user.id));
});

r.put('/me', requireAuth, async (req, res) => {
  const d = parse(z.object({
    name: z.string().trim().min(2).optional(),
    preferences: z.record(z.any()).optional(),
    currentPassword: z.string().optional(),
    newPassword: z.string().min(6, 'a nova senha deve ter ao menos 6 caracteres').optional(),
  }), req.body);
  if (d.newPassword) {
    const u = await one('select password_hash from users where id = $1', [req.user.id]);
    if (!d.currentPassword || !(await bcrypt.compare(d.currentPassword, u.password_hash))) {
      throw new HttpError(400, 'Senha atual incorreta.');
    }
    await q('update users set password_hash = $1 where id = $2', [await bcrypt.hash(d.newPassword, 10), req.user.id]);
  }
  if (d.name) await q('update users set name = $1 where id = $2', [d.name, req.user.id]);
  if (d.preferences) {
    await q('update users set preferences = preferences || $1::jsonb where id = $2', [d.preferences, req.user.id]);
  }
  res.json(await loadSession(req.user.id));
});

export default r;
