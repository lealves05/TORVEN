import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { q, one, tx } from '../db.js';
import { signToken, requireAuth } from '../auth.js';
import { ensureCompanyDefaults } from '../domain.js';
import { parse, slugify, withDefaults, HttpError, DEFAULT_SETTINGS, DEFAULT_FISCAL, permissionsFor, PERMISSIONS, ROLES } from '../util.js';
import { seedDemo } from '../seed.js';

const r = Router();
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Muitas tentativas. Aguarde alguns minutos.' } });

export const COMPANY_COLS = `select id, name, trade_name, slug, document, state_registration, municipal_registration, phone, email,
  cep, street, number, complement, district, city, uf, city_code, logo_url, settings,
  (fiscal->>'provider') as fiscal_provider, (fiscal->>'environment') as fiscal_environment,
  (fiscal->'certificate'->>'valid_until') as fiscal_cert_until, is_demo, created_at
  from companies where id = $1`;

export async function loadSession(userId) {
  const user = await one(
    `select u.id, u.name, u.email, u.role, u.technician_id, u.preferences, u.company_id
       from users u where u.id = $1`, [userId]);
  const company = await one(COMPANY_COLS, [user.company_id]);
  company.settings = withDefaults(company.settings);
  return { user, company, permissions: permissionsFor(user.role, company.settings), permissionCatalog: PERMISSIONS, roles: ROLES };
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
    await ensureCompanyDefaults(db, company.id);
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

// ---------- Versão de demonstração ----------
const demoLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Muitas demonstrações criadas a partir deste endereço. Tente mais tarde.' } });

/** Cria uma empresa de demonstração com dados de exemplo e entra direto. */
r.post('/demo', demoLimiter, async (_req, res) => {
  // demonstrações abandonadas há mais de 7 dias são apagadas
  await q("delete from companies where is_demo and created_at < now() - interval '7 days'").catch(() => {});
  const rand = Math.random().toString(36).slice(2, 10);
  const email = `demo-${rand}@demo.torven.app`;
  const hash = await bcrypt.hash(`${rand}${Date.now()}`, 8);
  const userId = await tx(async (db) => {
    const { rows: [company] } = await db.query(
      `insert into companies (name, trade_name, slug, email, settings, fiscal, is_demo)
       values ('Oficina Demonstração', 'Oficina Demonstração', $1, null, $2, $3, true) returning id`,
      [`demo-${rand}`, DEFAULT_SETTINGS, DEFAULT_FISCAL]);
    await ensureCompanyDefaults(db, company.id);
    const { rows: [user] } = await db.query(
      `insert into users (company_id, name, email, password_hash, role) values ($1, 'Visitante', $2, $3, 'owner') returning id`,
      [company.id, email, hash]);
    await seedDemo(db, company.id, user.id);
    return user.id;
  });
  const session = await loadSession(userId);
  res.status(201).json({ token: signToken(session.user), ...session });
});

/** Converte a demonstração em uso normal: define empresa, login e senha (mantendo ou apagando os dados de exemplo). */
r.post('/activate', requireAuth, async (req, res) => {
  const d = parse(z.object({
    companyName: z.string().trim().min(2, 'informe o nome da empresa'),
    name: z.string().trim().min(2, 'informe seu nome'),
    email: z.string().trim().toLowerCase().email('e-mail inválido'),
    password: z.string().min(6, 'a senha deve ter ao menos 6 caracteres'),
    phone: z.string().trim().optional(),
    keepData: z.boolean().default(false),
  }), req.body);
  if (req.user.role !== 'owner') throw new HttpError(403, 'Só o proprietário pode ativar o sistema.');
  const c = await one('select is_demo from companies where id = $1', [req.companyId]);
  if (!c?.is_demo) throw new HttpError(400, 'Esta empresa já está em uso normal.');
  const taken = await one('select 1 from users where email = $1 and id <> $2', [d.email, req.user.id]);
  if (taken) throw new HttpError(409, 'Este e-mail já está cadastrado.');
  await tx(async (db) => {
    if (!d.keepData) {
      for (const t of ['attachments', 'audit_log', 'followups', 'statement_lines', 'bank_statements', 'purchase_orders', 'purchase_quotations', 'warranty_claims', 'schedule_entries', 'order_time_logs', 'order_inspections', 'service_requests', 'invoices', 'transactions', 'stock_movements', 'orders', 'quotes', 'purchases', 'cash_sessions',
        'equipment', 'customers', 'products', 'suppliers', 'services', 'technicians']) {
        await db.query(`delete from ${t} where company_id = $1`, [req.companyId]);
      }
      await db.query("update companies set street = null, number = null, district = null, city = null, uf = null, cep = null, city_code = null where id = $1", [req.companyId]);
    }
    let slug = slugify(d.companyName);
    const { rows: dup } = await db.query('select 1 from companies where slug = $1 and id <> $2', [slug, req.companyId]);
    if (dup.length) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
    await db.query(
      'update companies set name = $2, trade_name = $2, slug = $3, email = $4, phone = coalesce($5, phone), is_demo = false where id = $1',
      [req.companyId, d.companyName, slug, d.email, d.phone || null]);
    await db.query('update users set name = $2, email = $3, password_hash = $4 where id = $1',
      [req.user.id, d.name, d.email, await bcrypt.hash(d.password, 10)]);
  });
  const session = await loadSession(req.user.id);
  res.json({ token: signToken(session.user), ...session });
});

export default r;
