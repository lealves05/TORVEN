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

const reg = await api('POST', '/auth/register', { companyName: 'Oficina Teste', name: 'Dono', email: 'dono@teste.dev', password: 'Senha123x', demo: false });
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
  const r = await api('POST', '/auth/register', { companyName: 'Oficina Dois', name: 'Outro', email: 'dois@teste.dev', password: 'Senha123x', demo: false });
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
  assert.equal((await api('POST', '/auth/register', { companyName: 'Fechada', name: 'Xavier', email: 'x@teste.dev', password: 'Senha123x' })).status, 403);
  assert.equal((await api('POST', '/auth/demo')).status, 403);
  await central('PUT', '/settings', { values: { signup_enabled: true, demo_enabled: true, notice_text: '' } });
  assert.equal((await api('POST', '/auth/demo')).status, 201);
});

server.close(); hub.close(); await pool.end();
console.log(`\n${passed} verificações OK, ${fails.length} falhas`);
if (fails.length) process.exit(1);
