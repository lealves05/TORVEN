// Medição de desempenho das principais telas com volume grande (empresa com milhares de OS, clientes e lançamentos).
// Uso: DATABASE_URL=postgres://.../torven_perf_test node scripts/perf.mjs [multiplicador=60]   (APAGA o banco informado)
import { performance } from 'node:perf_hooks';

if (!/test/.test(process.env.DATABASE_URL || '')) { console.error('Use um banco de teste (nome contendo "test")'); process.exit(1); }
const MULT = Number(process.argv[2] || 60);
const REUSE = process.env.PERF_REUSE === '1'; // mede de novo sem recriar o volume
const { pool } = await import('../src/db.js');
if (!REUSE) await pool.query('drop schema public cascade; create schema public;');
const { migrate } = await import('../src/migrate.js');
await migrate();
const { createApp } = await import('../src/app.js');
const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const api = async (method, path, body, token) => {
  const r = await fetch(`${base}/api${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => null), bytes: Number(r.headers.get('content-length') || 0) };
};
const reg = REUSE ? await api('POST', '/auth/login', { email: 'dono@perf.dev', password: 'Oficina2026xy' })
  : await api('POST', '/auth/register', { companyName: 'Oficina Grande', name: 'Dono', email: 'dono@perf.dev', password: 'Oficina2026xy', demo: true });
const T = reg.data.token;
const { rows: [{ id: cid }] } = await pool.query("select id from companies where name = 'Oficina Grande'");

// multiplica os dados da demonstração (clientes, veículos, OS, itens, eventos, lançamentos)
const t0 = performance.now();
if (!REUSE) {
console.log(`gerando volume ×${MULT}…`);
const c = await pool.connect();
await c.query('begin');
await c.query(`create temp table mc on commit drop as select k, id as old, gen_random_uuid() as new from customers, generate_series(1, ${MULT}) k where company_id = '${cid}'`);
await c.query(`create temp table me on commit drop as select k, id as old, gen_random_uuid() as new from equipment, generate_series(1, ${MULT}) k where company_id = '${cid}'`);
await c.query(`create temp table mo on commit drop as select k, id as old, gen_random_uuid() as new from orders, generate_series(1, ${MULT}) k where company_id = '${cid}'`);
await c.query('create index on mc(old, k); create index on me(old, k); create index on mo(old, k); analyze mc; analyze me; analyze mo;');
await c.query(`insert into customers select (jsonb_populate_record(x, jsonb_build_object('id', m.new, 'name', x.name || ' ' || m.k))).* from customers x join mc m on m.old = x.id`);
await c.query(`insert into equipment select (jsonb_populate_record(e, jsonb_build_object('id', me.new, 'customer_id', mc.new, 'plate', null))).*
  from equipment e join me on me.old = e.id left join mc on mc.old = e.customer_id and mc.k = me.k`);
await c.query(`insert into orders select (jsonb_populate_record(o, jsonb_build_object('id', mo.new, 'number', o.number + mo.k * 1000,
    'public_token', md5(random()::text), 'customer_id', mc.new, 'equipment_id', me.new, 'quote_id', null, 'request_id', null, 'warranty_of', null,
    'created_at', o.created_at - ((mo.k % 400) || ' days')::interval))).*
  from orders o join mo on mo.old = o.id left join mc on mc.old = o.customer_id and mc.k = mo.k left join me on me.old = o.equipment_id and me.k = mo.k`);
await c.query(`insert into order_items select (jsonb_populate_record(i, jsonb_build_object('id', gen_random_uuid(), 'order_id', mo.new))).* from order_items i join mo on mo.old = i.order_id`);
await c.query(`insert into order_events select (jsonb_populate_record(e, jsonb_build_object('id', gen_random_uuid(), 'order_id', mo.new))).* from order_events e join mo on mo.old = e.order_id`);
await c.query(`insert into transactions select (jsonb_populate_record(t, jsonb_build_object('id', gen_random_uuid(), 'order_id', mo.new, 'customer_id', mc.new,
    'cash_session_id', null, 'due_date', t.due_date - (mo.k % 400), 'paid_at', t.paid_at - ((mo.k % 400) || ' days')::interval))).*
  from transactions t join mo on mo.old = t.order_id left join mc on mc.old = t.customer_id and mc.k = mo.k`);
await c.query('commit'); c.release();
}
await pool.query('analyze');
const counts = (await pool.query(`select (select count(*) from orders where company_id = $1) o, (select count(*) from customers where company_id = $1) c,
  (select count(*) from order_items) i, (select count(*) from transactions where company_id = $1) t`, [cid])).rows[0];
console.log(`volume: ${counts.o} OS, ${counts.c} clientes, ${counts.i} itens, ${counts.t} lançamentos (${((performance.now() - t0) / 1000).toFixed(1)}s)`);

const month = new Date().toISOString().slice(0, 7);
const from = `${month}-01`; const to = `${month}-28`;
const ENDPOINTS = [
  '/auth/me', '/company', '/dashboard', '/orders', '/orders?search=silva', '/orders?status=aberta', '/orders?search=ABC1D23', '/customers', '/customers?search=ana',
  '/products', '/quotes', '/requests', `/schedule?from=${from}&to=${to}`, '/production/board', '/invoices', '/finance/accounts', `/finance/cashflow?from=${from}&to=${to}`,
  `/finance/dre?from=${from}&to=${to}`, `/reports/management?from=${from}&to=${to}`, `/reports/finance?from=${from}&to=${to}`, `/reports/production?from=${from}&to=${to}`,
  `/reports/fiscal?from=${from}&to=${to}`, `/reports/commissions?from=${from}&to=${to}`, '/reports/stock', '/relationship/followups', '/relationship/summary',
  '/cash/session', '/cash/transactions', '/warranty', '/quality/types', '/quality/templates', '/notifications', '/search?q=silva',
];
const results = [];
for (const path of ENDPOINTS) {
  const times = [];
  let st = 0; let bytes = 0;
  for (let i = 0; i < 5; i++) {
    const a = performance.now();
    const r = await api('GET', path, null, T);
    times.push(performance.now() - a); st = r.status; bytes = JSON.stringify(r.data || '').length;
  }
  times.sort((x, y) => x - y);
  results.push({ path, status: st, median_ms: Math.round(times[2]), max_ms: Math.round(times[4]), kb: Math.round(bytes / 1024) });
}
console.table(results);
const slow = results.filter((r) => r.median_ms > 300 && r.status === 200);
console.log(slow.length ? `LENTOS (>300 ms): ${slow.map((s) => s.path).join(', ')}` : 'Nenhuma tela acima de 300 ms.');
server.close(); await pool.end();
