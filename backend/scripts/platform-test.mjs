// Teste do contrato com a central da plataforma (v1 + parâmetros v1.1) contra uma central falsa.
// Uso: DATABASE_URL=postgres://.../torven_platform_test node scripts/platform-test.mjs   (APAGA o banco informado)
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';

if (!/test/.test(process.env.DATABASE_URL || '')) { console.error('Use um banco de teste (nome contendo "test")'); process.exit(1); }
const SECRET = 'pk_teste-torven-0123456789abcdef';
const sha = (s) => crypto.createHash('sha256').update(s || '').digest('hex');
const sign = (ts, method, route, body) => crypto.createHmac('sha256', SECRET).update(`${ts}\n${method}\n${route}\n${sha(body)}`).digest('hex');

// central falsa: aceita o cadastro e devolve a situação de teste
const hubCalls = [];
const hub = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const route = req.url.replace(/^\/api\/hub\/v1/, '');
    const ok = req.headers['x-platform-signature'] === sign(req.headers['x-platform-timestamp'], req.method, route, body);
    res.writeHead(ok ? 200 : 401, { 'content-type': 'application/json' });
    if (!ok) return res.end('{}');
    hubCalls.push({ method: req.method, route, body: body ? JSON.parse(body) : null });
    if (route === '/mail/status') return res.end(JSON.stringify({ available: true }));
    res.end(JSON.stringify({ access: { status: 'TRIAL', blocked: false, features: {}, notices: [] } }));
  });
});
await new Promise((r) => hub.listen(0, '127.0.0.1', r));
process.env.PLATFORM_HUB_URL = `http://127.0.0.1:${hub.address().port}`;
process.env.PLATFORM_SECRET = SECRET;

const { pool } = await import('../src/db.js');
await pool.query('drop schema public cascade; create schema public;');
const { migrate } = await import('../src/migrate.js');
await migrate();
process.env.CORS_ORIGIN = 'https://torven-ebon.vercel.app';
const { createApp } = await import('../src/app.js');
const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

let passed = 0; const fails = [];
const check = async (name, fn) => { try { await fn(); passed++; console.log('  ok ', name); } catch (e) { fails.push(name); console.log('  FALHOU', name, e.message); } };
async function api(method, path, body, token) {
  const r = await fetch(`${base}/api${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => null) };
}
async function central(method, route, payload) {
  const body = payload === undefined ? '' : JSON.stringify(payload);
  const ts = Math.floor(Date.now() / 1000);
  const r = await fetch(`${base}/api/platform/v1${route}`, { method, body: body || undefined, headers: { 'content-type': 'application/json',
    'x-platform-product': 'torven', 'x-platform-timestamp': String(ts), 'x-platform-signature': sign(ts, method, route, body) } });
  return { status: r.status, data: await r.json().catch(() => null) };
}

const reg = await api('POST', '/auth/register', { companyName: 'Oficina Teste', name: 'Dono', email: 'dono@teste.dev', password: 'Oficina2026xy', demo: false });
assert.equal(reg.status, 201, JSON.stringify(reg.data));
const token = reg.data.token; const cid = reg.data.company.id;

await check('manifesto publica os parâmetros do sistema e da empresa', async () => {
  const m = await central('GET', '/manifest');
  assert.equal(m.status, 200); assert.equal(m.data.contract_minor, 1);
  assert.ok(m.data.settings.system.some((f) => f.key === 'signup_enabled'));
  assert.ok(m.data.settings.tenant.some((f) => f.key === 'orders_defaultWarrantyDays'));
});
await check('central altera e lê parâmetros do sistema (com validação)', async () => {
  const r = await central('PUT', '/settings', { values: { default_warranty_days: 180, notice_text: 'Atualização hoje às 22h', notice_level: 'warn' } });
  assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.values.default_warranty_days, 180);
  assert.equal((await central('PUT', '/settings', { values: { default_warranty_days: -1 } })).status, 400);
  assert.equal((await central('PUT', '/settings', { values: { nada: true } })).status, 400);
  const me = await api('GET', '/auth/me', null, token);
  assert.equal(me.data.notice.text, 'Atualização hoje às 22h');
});
await check('empresa nova herda os padrões do sistema', async () => {
  const r = await api('POST', '/auth/register', { companyName: 'Oficina Dois', name: 'Outro', email: 'dois@teste.dev', password: 'Oficina2026xy', demo: false });
  assert.equal(r.status, 201);
  assert.equal(r.data.company.settings.orders.defaultWarrantyDays, 180);
});
await check('central lê e altera parâmetros de uma empresa, com auditoria', async () => {
  const g = await central('GET', `/tenants/${cid}/settings`);
  assert.equal(g.status, 200); assert.equal(g.data.values.orders_defaultWarrantyDays, 90);
  const p = await central('PUT', `/tenants/${cid}/settings`, { values: { orders_defaultWarrantyDays: 120, requireOpenCash: true, trade_name: 'Oficina Nova' }, reason: 'pedido do cliente' });
  assert.equal(p.status, 200, JSON.stringify(p.data));
  assert.equal(p.data.values.orders_defaultWarrantyDays, 120); assert.equal(p.data.values.requireOpenCash, true);
  const me = await api('GET', '/auth/me', null, token);
  assert.equal(me.data.company.settings.orders.defaultWarrantyDays, 120); assert.equal(me.data.company.trade_name, 'Oficina Nova');
  const { rows } = await pool.query("select 1 from audit_log where company_id = $1 and action = 'platform.settings'", [cid]);
  assert.equal(rows.length, 1);
  assert.equal((await central('PUT', `/tenants/${cid}/settings`, { values: { orders_defaultPromiseDays: 999 } })).status, 400);
});
await check('assinatura inválida é recusada', async () => {
  const r = await fetch(`${base}/api/platform/v1/settings`, { headers: { 'x-platform-product': 'torven', 'x-platform-timestamp': String(Math.floor(Date.now() / 1000)), 'x-platform-signature': 'f'.repeat(64) } });
  assert.equal(r.status, 401);
});
await check('parâmetro fecha cadastros e demonstração', async () => {
  await central('PUT', '/settings', { values: { signup_enabled: false, demo_enabled: false } });
  assert.equal((await api('POST', '/auth/register', { companyName: 'Fechada', name: 'Xavier', email: 'x@teste.dev', password: 'Oficina2026xy' })).status, 403);
  assert.equal((await api('POST', '/auth/demo')).status, 403);
  await central('PUT', '/settings', { values: { signup_enabled: true, demo_enabled: true, notice_text: '' } });
  assert.equal((await api('POST', '/auth/demo')).status, 201);
});

await check('esqueci minha senha: link pela central, uso único, derruba a sessão antiga', async () => {
  const reg = await api('POST', '/auth/register', { companyName: 'Oficina Senha', name: 'Rita Lima', email: 'rita@teste.dev', password: 'Oficina2026xy', demo: false });
  assert.equal(reg.status, 201, JSON.stringify(reg.data));
  const oldToken = reg.data.token;
  assert.equal((await api('GET', '/auth/reset-options')).data.available, true);
  const n = hubCalls.length;
  assert.equal((await api('POST', '/auth/forgot', { email: 'ninguem@teste.dev' })).status, 200);
  assert.equal(hubCalls.filter((c) => c.route === '/mail/password-reset').length, hubCalls.slice(0, n).filter((c) => c.route === '/mail/password-reset').length);
  assert.equal((await api('POST', '/auth/forgot', { email: 'rita@teste.dev' })).status, 200);
  const mail = hubCalls.filter((c) => c.route === '/mail/password-reset').at(-1).body;
  assert.equal(mail.to, 'rita@teste.dev'); assert.equal(mail.company, 'Oficina Senha');
  const token = new URL(`http://x${mail.path}`).searchParams.get('token');
  await new Promise((r) => setTimeout(r, 1100));
  assert.equal((await api('POST', '/auth/reset', { token, new_password: 'curta' })).status, 400);
  assert.equal((await api('POST', '/auth/reset', { token, new_password: 'NovaSenha2026' })).status, 200);
  assert.equal((await api('POST', '/auth/reset', { token, new_password: 'NovaSenha2027' })).status, 400);
  assert.equal((await api('POST', '/auth/login', { email: 'rita@teste.dev', password: 'Oficina2026xy' })).status, 401);
  assert.equal((await api('POST', '/auth/login', { email: 'rita@teste.dev', password: 'NovaSenha2026' })).status, 200);
  assert.equal((await api('GET', '/auth/me', null, oldToken)).status, 401);
});

await check('F02: troca de senha (própria e pelo administrador) derruba tokens antigos', async () => {
  const reg = await api('POST', '/auth/register', { companyName: 'Oficina Sessao', name: 'Dona', email: 'dona@teste.dev', password: 'Oficina2026xy', demo: false });
  const ownerA = reg.data.token;
  const ownerB = (await api('POST', '/auth/login', { email: 'dona@teste.dev', password: 'Oficina2026xy' })).data.token;
  // própria: a outra sessão cai; a atual recebe token novo
  const ch = await api('PUT', '/auth/me', { currentPassword: 'Oficina2026xy', newPassword: 'NovaFrase2026ok' }, ownerA);
  assert.equal(ch.status, 200); assert.ok(ch.data.token);
  assert.equal((await api('GET', '/auth/me', null, ownerB)).status, 401);
  assert.equal((await api('GET', '/auth/me', null, ownerA)).status, 401);
  assert.equal((await api('GET', '/auth/me', null, ch.data.token)).status, 200);
  const owner = ch.data.token;
  // pelo administrador: o usuário perde as sessões; nenhum token é emitido em nome dele
  const u = await api('POST', '/users', { name: 'Atendente', email: 'at@teste.dev', password: 'Atende2026xyz', role: 'attendant' }, owner);
  assert.equal(u.status, 201, JSON.stringify(u.data));
  const t1 = (await api('POST', '/auth/login', { email: 'at@teste.dev', password: 'Atende2026xyz' })).data.token;
  const up = await api('PUT', `/users/${u.data.id}`, { name: 'Atendente', email: 'at@teste.dev', role: 'attendant', password: 'Outra2026xyzw' }, owner);
  assert.equal(up.status, 200); assert.equal(up.data.token, undefined);
  assert.equal((await api('GET', '/auth/me', null, t1)).status, 401);
  // dois tokens emitidos no mesmo segundo: a versão decide, não o relógio
  const t2 = (await api('POST', '/auth/login', { email: 'at@teste.dev', password: 'Outra2026xyzw' })).data.token;
  await api('PUT', `/users/${u.data.id}`, { name: 'Atendente', email: 'at@teste.dev', role: 'attendant', password: 'Mais2026xyzwq' }, owner);
  assert.equal((await api('GET', '/auth/me', null, t2)).status, 401);
});
await check('F08: a mesma senha fraca é recusada em todos os fluxos; frase longa e acentos aceitos', async () => {
  const owner = (await api('POST', '/auth/login', { email: 'dona@teste.dev', password: 'NovaFrase2026ok' })).data.token;
  for (const pw of ['123456', 'Senha12345', 'abcdefghij', 'a'.repeat(30) + '1']) {
    assert.equal((await api('POST', '/auth/register', { companyName: 'X Oficina', name: 'Xavier', email: `x${Math.random()}@teste.dev`, password: pw })).status, 400, pw);
    assert.equal((await api('POST', '/users', { name: 'Xavier', email: `y${Math.random()}@teste.dev`, password: pw, role: 'attendant' }, owner)).status, 400, pw);
    assert.equal((await api('PUT', '/auth/me', { currentPassword: 'NovaFrase2026ok', newPassword: pw }, owner)).status, 400, pw);
  }
  assert.equal((await api('POST', '/auth/register', { companyName: 'X Oficina', name: 'Xavier', email: 'longa@teste.dev', password: 'ção'.repeat(25) + '1' })).status, 400, 'acima de 72 bytes recusada');
  assert.equal((await api('POST', '/users', { name: 'Zé', email: 'ze@teste.dev', password: 'cação de lá 2026 é boa', role: 'attendant' }, owner)).status, 201);
  assert.equal((await api('POST', '/auth/login', { email: 'ze@teste.dev', password: 'cação de lá 2026 é boa' })).status, 200);
});
await check('F09: técnico/unidade de outra empresa recusados sem alteração parcial', async () => {
  const owner = (await api('POST', '/auth/login', { email: 'dona@teste.dev', password: 'NovaFrase2026ok' })).data.token;
  const other = await pool.query("select t.id from technicians t join companies c on c.id = t.company_id where c.name <> 'Oficina Sessao' limit 1");
  const otherTech = other.rows[0]?.id || (await pool.query("insert into technicians (company_id, name) select id, 'Tec B' from companies where name = 'Oficina Teste' returning id")).rows[0].id;
  const r = await api('POST', '/users', { name: 'Intruso', email: 'intr@teste.dev', password: 'Intruso2026xy', role: 'technician', technician_id: otherTech }, owner);
  assert.equal(r.status, 400);
  assert.equal((await pool.query("select 1 from users where email = 'intr@teste.dev'")).rows.length, 0);
  const otherUnit = (await pool.query("select u.id from units u join companies c on c.id = u.company_id where c.name <> 'Oficina Sessao' limit 1")).rows[0];
  if (otherUnit) {
    const me = (await api('GET', '/users', null, owner)).data.find((x) => x.email === 'ze@teste.dev');
    assert.equal((await api('PUT', `/users/${me.id}`, { name: 'Zé', email: 'ze@teste.dev', role: 'attendant', unit_id: otherUnit.id }, owner)).status, 400);
  }
});
await check('F07: limite de login compartilhado entre instâncias (Postgres), com Retry-After', async () => {
  const s2 = createApp().listen(0);
  const base2 = `http://127.0.0.1:${s2.address().port}`;
  try {
    let last;
    for (let i = 0; i < 12; i++) {
      const b = i % 2 ? base2 : base;
      last = await fetch(`${b}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'limite@teste.dev', password: 'errada1234' }) });
    }
    assert.equal(last.status, 429); assert.ok(Number(last.headers.get('retry-after')) > 0);
  } finally { s2.close(); }
});
await check('F06/F11: CORS só para origem aprovada; API sem cache', async () => {
  const ok = await fetch(`${base}/api/health`, { headers: { origin: 'http://localhost:5173' } });
  const evil = await fetch(`${base}/api/health`, { headers: { origin: 'https://evil.example' } });
  assert.equal(evil.headers.get('access-control-allow-origin'), null);
  assert.equal(ok.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  assert.match(ok.headers.get('cache-control') || '', /no-store/);
});
await check('F01: segredo do JWT fraco é recusado em produção', async () => {
  const { secretProblem } = await import('../src/auth.js');
  for (const v of [undefined, '', 'x', 'torven-dev-secret-troque-em-producao', 'a'.repeat(64)]) assert.ok(secretProblem(v), String(v));
  assert.equal(secretProblem(crypto.randomBytes(48).toString('hex')), null);
});

server.close(); hub.close(); await pool.end();
console.log(`\n${passed} verificações OK, ${fails.length} falhas`);
if (fails.length) process.exit(1);
