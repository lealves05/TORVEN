import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { z } from 'zod';
import { q, one, tx } from '../db.js';
import { signToken, requireAuth } from '../auth.js';
import { ensureCompanyDefaults } from '../domain.js';
import { parse, slugify, withDefaults, HttpError, DEFAULT_SETTINGS, DEFAULT_FISCAL, permissionsFor, PERMISSIONS, ROLES, AGENT_ACTIONS, agentAllowed } from '../util.js';
import { seedDemo } from '../seed.js';
import { accessFor, registerCompany, hubCall } from '../platform.js';
import { audit } from '../audit.js';
import { passwordSchema, setPassword, limitByIp, limitByKey, clearHits } from '../security.js';
import { getSystemParams, systemNotice, newCompanySettings } from '../params.js';

const r = Router();
const DUMMY_HASH = '$2a$10$CwTycUXWue0Thq9StjUM0uJ8.0bYqK2Q0Yy9y8l1wq3J7wJ0eJ6a2'; // compara mesmo sem usuário (tempo parecido)
// limites compartilhados no Postgres (F07): por IP e, no login e na recuperação, também por e-mail
const loginLimiter = limitByIp('login', 30, 15 * 60);
const signupLimiter = limitByIp('signup', 10, 60 * 60, 'Muitos cadastros a partir deste endereço. Tente mais tarde.');
const resetLimiter = limitByIp('reset', 30, 60 * 60);
const activateLimiter = limitByIp('activate', 10, 60 * 60);

export const COMPANY_COLS = `select id, name, trade_name, slug, document, state_registration, municipal_registration, phone, email,
  cep, street, number, complement, district, city, uf, city_code, logo_url, settings,
  (fiscal->>'provider') as fiscal_provider, (fiscal->>'environment') as fiscal_environment,
  (fiscal->'certificate'->>'valid_until') as fiscal_cert_until, is_demo, created_at
  from companies where id = $1`;

export async function loadSession(userId) {
  const user = await one(
    `select u.id, u.name, u.email, u.role, u.technician_id, u.preferences, u.company_id, u.auth_version, u.agent_permissions
       from users u where u.id = $1`, [userId]);
  const company = await one(COMPANY_COLS, [user.company_id]);
  company.settings = withDefaults(company.settings);
  // situação da assinatura definida pela central da plataforma (null = sem central ou demonstração)
  const access = await accessFor(company.id).catch(() => null);
  const notice = await systemNotice().catch(() => null);
  const { auth_version: _av, agent_permissions: _ap, ...pub } = user;
  const permissions = permissionsFor(user.role, company.settings);
  // assistente: ações liberadas para esta pessoa (perfil do assistente + permissão normal)
  const agent = AGENT_ACTIONS.filter((a) => agentAllowed(user, permissions, a.key)).map((a) => a.key);
  return { user: pub, company, access, notice, permissions, agent, permissionCatalog: PERMISSIONS, roles: ROLES, _av };
}
// sessão + token (o token leva a versão de autenticação atual; ela não vai para o navegador)
async function sessionWithToken(userId) {
  const { _av, ...session } = await loadSession(userId);
  return { token: signToken({ id: session.user.id, company_id: session.user.company_id, auth_version: _av }), ...session };
}

const registerSchema = z.object({
  companyName: z.string().trim().min(2, 'informe o nome da empresa'),
  name: z.string().trim().min(2, 'informe seu nome'),
  email: z.string().trim().toLowerCase().email('e-mail inválido'),
  password: passwordSchema,
  phone: z.string().trim().optional(),
  demo: z.boolean().optional().default(true),
});

const signupClosed = () => new HttpError(403, 'Novos cadastros estão temporariamente fechados.');

r.post('/register', signupLimiter, async (req, res) => {
  const d = parse(registerSchema, req.body);
  const sys = await getSystemParams();
  if (sys.signup_enabled === false) throw signupClosed();
  const settings = await newCompanySettings(DEFAULT_SETTINGS);
  const exists = await one('select 1 from users where email = $1', [d.email]);
  if (exists) throw new HttpError(409, 'Este e-mail já está cadastrado.');

  const hash = await bcrypt.hash(d.password, 10);
  const userId = await tx(async (db) => {
    let slug = slugify(d.companyName);
    const { rows: taken } = await db.query('select slug from companies where slug like $1', [`${slug}%`]);
    if (taken.some((t) => t.slug === slug)) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
    const { rows: [company] } = await db.query(
      'insert into companies (name, trade_name, slug, phone, email, settings, fiscal) values ($1,$1,$2,$3,$4,$5,$6) returning id',
      [d.companyName, slug, d.phone || null, d.email, settings, DEFAULT_FISCAL]);
    await ensureCompanyDefaults(db, company.id);
    const { rows: [user] } = await db.query(
      `insert into users (company_id, name, email, password_hash, role)
       values ($1,$2,$3,$4,'owner') returning id`,
      [company.id, d.name, d.email, hash]);
    if (d.demo) await seedDemo(db, company.id, user.id);
    return user.id;
  });
  // cadastro na central da plataforma (período de teste e assinatura); falha aqui não impede o uso — a central sincroniza depois
  const u = await one('select company_id from users where id=$1', [userId]);
  await registerCompany(u.company_id).catch((e) => console.warn('[plataforma] cadastro na central adiado:', e.message));

  res.status(201).json(await sessionWithToken(userId));
});

r.post('/login', loginLimiter, async (req, res) => {
  const d = parse(z.object({
    email: z.string().trim().toLowerCase().email('e-mail inválido'),
    password: z.string().min(1, 'informe a senha'),
  }), req.body);
  // limite por conta + endereço (quem erra a senha não bloqueia o dono da conta em outro lugar) e um teto geral por conta
  await limitByKey('login', `${d.email}|${req.ip}`, 10, 15 * 60, res, 'Muitas tentativas para esta conta. Aguarde 15 minutos ou use "Esqueci minha senha".');
  await limitByKey('login-acct', d.email, 60, 15 * 60, res, 'Muitas tentativas para esta conta. Aguarde 15 minutos ou use "Esqueci minha senha".');
  const user = await one('select id, company_id, password_hash, active from users where email = $1', [d.email]);
  if (!(await bcrypt.compare(d.password, user?.password_hash || DUMMY_HASH)) || !user) {
    throw new HttpError(401, 'E-mail ou senha incorretos.');
  }
  if (!user.active) throw new HttpError(403, 'Usuário desativado. Fale com o administrador.');
  await clearHits(`login:id:${d.email}|${req.ip}`.toLowerCase());
  await q('update users set last_login_at=now() where id=$1', [user.id]);
  res.json(await sessionWithToken(user.id));
});

// ---- Esqueci minha senha: link de uso único (60 min) enviado pela central, com o remetente da plataforma ----
const RESET_MIN = 60;
const GENERIC_FORGOT = { ok: true, message: 'Se o e-mail estiver cadastrado, você vai receber um link para criar uma nova senha em alguns minutos.' };
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const forgotLimiter = limitByIp('forgot', 20, 60 * 60, 'Muitos pedidos. Aguarde e tente de novo.');
let mailCache = { at: 0, v: false };
async function resetAvailable() {
  if (Date.now() - mailCache.at < 60000) return mailCache.v;
  let v = false;
  try { v = !!(await hubCall('GET', '/mail/status', undefined, 5000)).available; } catch { v = false; }
  mailCache = { at: Date.now(), v };
  return v;
}
r.get('/reset-options', async (_req, res) => res.json({ available: await resetAvailable() }));

r.post('/forgot', forgotLimiter, async (req, res) => {
  const d = parse(z.object({ email: z.string().trim().toLowerCase().email('e-mail inválido').max(200) }), req.body);
  if (!(await resetAvailable())) throw new HttpError(503, 'A recuperação de senha por e-mail ainda não está ativa. Peça ao administrador da empresa para definir uma nova senha em Usuários, ou fale com o suporte.', { code: 'RESET_UNAVAILABLE' });
  try { await limitByKey('forgot', d.email, 3, 60 * 60); } catch { return res.json(GENERIC_FORGOT); }
  const u = await one(`select u.id, u.name, u.email, u.company_id, c.name as company_name, c.is_demo from users u join companies c on c.id = u.company_id
     where u.email = $1 and u.active`, [d.email]);
  // demonstrações antigas (login gerado, sem e-mail real) não recebem link; as novas têm e-mail próprio
  if (!u || (u.is_demo && /@demo\.torven\.app$/i.test(u.email))) return res.json(GENERIC_FORGOT);
  const token = crypto.randomBytes(32).toString('hex');
  await q('update password_resets set used_at = now() where user_id = $1 and used_at is null', [u.id]);
  await q(`insert into password_resets (user_id, token_hash, expires_at, ip) values ($1,$2, now() + make_interval(mins => $3), $4)`,
    [u.id, sha(token), RESET_MIN, String(req.ip || '').slice(0, 64)]);
  try {
    await hubCall('POST', '/mail/password-reset', { to: u.email, name: u.name, company: u.company_name, path: `/redefinir-senha?token=${token}`, minutes: RESET_MIN }, 20000);
  } catch (e) {
    await q('update password_resets set used_at = now() where token_hash = $1', [sha(token)]);
    throw new HttpError(e.status === 429 ? 429 : 502, e.status === 429 ? e.message : 'Não foi possível enviar o e-mail agora. Tente novamente em alguns minutos.');
  }
  await audit(null, { companyId: u.company_id, user: { id: u.id, name: u.name } }, { entity: 'user', entityId: u.id, action: 'senha_redefinicao_pedida', summary: 'Pediu o link de nova senha por e-mail' });
  res.json(GENERIC_FORGOT);
});

r.post('/reset', resetLimiter, async (req, res) => {
  const d = parse(z.object({ token: z.string().regex(/^[0-9a-f]{64}$/, 'link inválido'), new_password: passwordSchema }), req.body);
  const row = await one(`update password_resets set used_at = now() where token_hash = $1 and used_at is null and expires_at > now() returning user_id`, [sha(d.token)]);
  if (!row) throw new HttpError(400, 'Este link expirou ou já foi usado. Peça um novo em “Esqueci minha senha”.', { code: 'RESET_INVALID' });
  const u = await one('select id, name, company_id from users where id = $1 and active', [row.user_id]);
  if (!u) throw new HttpError(400, 'Conta indisponível.');
  await setPassword(null, u.id, u.company_id, d.new_password);
  await audit(null, { companyId: u.company_id, user: { id: u.id, name: u.name } }, { entity: 'user', entityId: u.id, action: 'senha_redefinida_email', summary: 'Senha redefinida pelo link do e-mail' });
  res.json({ ok: true });
});

r.get('/me', requireAuth, async (req, res) => {
  const { _av, ...session } = await loadSession(req.user.id);
  res.json(session);
});

r.put('/me', requireAuth, async (req, res) => {
  const d = parse(z.object({
    name: z.string().trim().min(2).optional(),
    preferences: z.record(z.any()).optional(),
    currentPassword: z.string().optional(),
    newPassword: passwordSchema.optional(),
  }), req.body);
  if (d.newPassword) {
    await limitByKey('me-password', req.user.id, 10, 15 * 60, res);
    const u = await one('select password_hash from users where id = $1', [req.user.id]);
    if (!d.currentPassword || !(await bcrypt.compare(d.currentPassword, u.password_hash))) {
      throw new HttpError(400, 'Senha atual incorreta.');
    }
    // troca própria: as outras sessões caem; esta recebe um token novo
    await setPassword(null, req.user.id, req.companyId, d.newPassword);
    await audit(null, req, { entity: 'user', entityId: req.user.id, action: 'password_change', summary: 'Trocou a própria senha (outras sessões encerradas)' });
  }
  if (d.name) await q('update users set name = $1 where id = $2', [d.name, req.user.id]);
  if (d.preferences) {
    await q('update users set preferences = preferences || $1::jsonb where id = $2', [d.preferences, req.user.id]);
  }
  if (d.newPassword) return res.json(await sessionWithToken(req.user.id));
  const { _av, ...session } = await loadSession(req.user.id);
  res.json(session);
});

// ---------- Versão de demonstração ----------
const demoLimiter = limitByIp('demo', 10, 60 * 60, 'Muitas demonstrações criadas a partir deste endereço. Tente mais tarde.');

const demoSchema = z.object({
  name: z.string().trim().min(2, 'informe seu nome').max(120),
  email: z.string().trim().toLowerCase().email('e-mail inválido').max(200),
  password: passwordSchema,
  companyName: z.string().trim().max(120).optional(),
});

/**
 * Cria uma empresa de demonstração com dados de exemplo para quem se identificou com e-mail e senha.
 * O login é de verdade (volta a entrar com o mesmo e-mail e senha); a empresa continua marcada como demonstração
 * até "Ativar uso normal". Sem e-mail + senha válidos nada é criado.
 */
r.post('/demo', demoLimiter, async (req, res) => {
  const sys = await getSystemParams();
  if (sys.demo_enabled === false) throw new HttpError(403, 'A demonstração está desativada no momento.');
  const d = parse(demoSchema, req.body || {});
  // demonstrações abandonadas são apagadas (prazo definido pela central)
  await q('delete from companies where is_demo and created_at < now() - make_interval(days => $1)', [Number(sys.demo_days) || 7]).catch(() => {});
  const exists = await one('select 1 from users where email = $1', [d.email]);
  if (exists) throw new HttpError(409, 'Este e-mail já está cadastrado. Entre com ele ou use "Esqueci minha senha".');
  const rand = Math.random().toString(36).slice(2, 10);
  const hash = await bcrypt.hash(d.password, 10);
  const companyName = d.companyName || 'Oficina Demonstração';
  const userId = await tx(async (db) => {
    const { rows: [company] } = await db.query(
      `insert into companies (name, trade_name, slug, email, settings, fiscal, is_demo)
       values ($1, $1, $2, $3, $4, $5, true) returning id`,
      [companyName, `demo-${rand}`, d.email, DEFAULT_SETTINGS, DEFAULT_FISCAL]);
    await ensureCompanyDefaults(db, company.id);
    const { rows: [user] } = await db.query(
      `insert into users (company_id, name, email, password_hash, role) values ($1, $2, $3, $4, 'owner') returning id`,
      [company.id, d.name, d.email, hash]);
    await seedDemo(db, company.id, user.id);
    return user.id;
  });
  res.status(201).json(await sessionWithToken(userId));
});

/** Converte a demonstração em uso normal: define empresa, login e senha (mantendo ou apagando os dados de exemplo). */
r.post('/activate', activateLimiter, requireAuth, async (req, res) => {
  const d = parse(z.object({
    companyName: z.string().trim().min(2, 'informe o nome da empresa'),
    name: z.string().trim().min(2, 'informe seu nome'),
    email: z.string().trim().toLowerCase().email('e-mail inválido'),
    // demonstração criada com e-mail e senha: a senha atual pode ser mantida
    password: passwordSchema.optional().or(z.literal('').transform(() => undefined)),
    phone: z.string().trim().optional(),
    keepData: z.boolean().default(false),
  }), req.body);
  // demonstrações antigas (anônimas, login gerado) precisam definir uma senha ao ativar
  if (!d.password && /@demo\.torven\.app$/i.test(req.user.email || '')) throw new HttpError(400, 'Defina uma senha para o seu login.');
  if ((await getSystemParams()).signup_enabled === false) throw signupClosed();
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
    await db.query('update users set name = $2, email = $3 where id = $1', [req.user.id, d.name, d.email]);
    if (d.password) await setPassword(db, req.user.id, req.companyId, d.password);
  });
  // demonstração virou empresa de verdade: entra na central da plataforma (período de teste e assinatura)
  await registerCompany(req.companyId).catch((e) => console.warn('[plataforma] cadastro na central adiado:', e.message));
  res.json(await sessionWithToken(req.user.id));
});

export default r;
