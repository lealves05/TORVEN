// Teste das integrações novas: placa (cadastro, consulta paga, cadastro simples) e cobrança na maquininha
// (Mercado Pago Point e InfinitePay contra provedores falsos locais).
// Uso: DATABASE_URL=postgres://.../torven_integracoes_test node scripts/integrations-test.mjs   (APAGA o banco informado)
import assert from 'node:assert/strict';
import http from 'node:http';

if (!/test/.test(process.env.DATABASE_URL || '')) { console.error('Use um banco de teste (nome contendo "test")'); process.exit(1); }

// ---------- provedores falsos ----------
const calls = { plate: 0, mpCreate: 0, mpGet: 0, ipLinks: 0, ipCheck: 0 };
const orders = new Map(); // id → { amount, status, gets, ref, pay }
const fake = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const send = (st, obj) => { res.writeHead(st, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    const u = new URL(req.url, 'http://x');
    // API Placas
    let m = u.pathname.match(/^\/consulta\/([A-Z0-9]+)\/(.+)$/);
    if (m) {
      calls.plate += 1;
      if (m[2] !== 'tok-placa') return send(402, { message: 'token inválido' });
      if (m[1] === 'ZZZ9Z99') return send(406, { message: 'sem resultado' });
      return send(200, { MARCA: 'FIAT', MODELO: 'STRADA FREEDOM', ano: '2021', anoModelo: '2022', cor: 'Branca', municipio: 'Campinas', uf: 'SP' });
    }
    // Mercado Pago Orders
    if (u.pathname === '/v1/orders' && req.method === 'POST') {
      calls.mpCreate += 1;
      if (req.headers.authorization !== 'Bearer mp-token') return send(401, { message: 'unauthorized' });
      const b = JSON.parse(body);
      const id = `ORD${calls.mpCreate}`;
      orders.set(id, { amount: b.transactions.payments[0].amount, status: 'created', gets: 0, ref: b.external_reference, pay: b.transactions.payments[0].amount });
      return send(201, { id, status: 'created', external_reference: b.external_reference });
    }
    m = u.pathname.match(/^\/v1\/orders\/([^/]+)(\/cancel)?$/);
    if (m) {
      const o = orders.get(m[1]); if (!o) return send(404, { message: 'not found' });
      if (m[2]) { o.status = 'canceled'; return send(200, { id: m[1], status: 'canceled' }); }
      calls.mpGet += 1; o.gets += 1;
      if (o.status === 'created' && o.gets >= 2) o.status = 'processed';
      return send(200, { id: m[1], status: o.status, status_detail: o.status === 'processed' ? 'accredited' : o.status,
        transactions: { payments: [{ id: 'PAY1', amount: o.amount, paid_amount: o.status === 'processed' ? o.pay : undefined, status: o.status, reference_id: 'NSU123', payment_method: { id: 'visa' } }] } });
    }
    // InfinitePay checkout
    if (u.pathname === '/links') { calls.ipLinks += 1; return send(200, { url: 'https://checkout.infinitepay.io/teste/abc' }); }
    if (u.pathname === '/payment_check') {
      calls.ipCheck += 1; const b = JSON.parse(body);
      return send(200, { success: true, paid: b.transaction_nsu === 'TX-OK', amount: 15000, capture_method: 'pix' });
    }
    send(404, {});
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));
const FAKE = `http://127.0.0.1:${fake.address().port}`;
process.env.APIPLACAS_URL = FAKE; process.env.MERCADOPAGO_API_URL = FAKE; process.env.INFINITEPAY_API_URL = FAKE;

const { pool } = await import('../src/db.js');
await pool.query('drop schema public cascade; create schema public;');
const { migrate } = await import('../src/migrate.js');
await migrate();
const { createApp } = await import('../src/app.js');
const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

let passed = 0; const fails = [];
const check = async (name, fn) => { try { await fn(); passed++; console.log('  ok ', name); } catch (e) { fails.push(name); console.log('  FALHOU', name, '—', e.message); } };
async function api(method, path, body, token, headers = {}) {
  const r = await fetch(`${base}/api${path}`, { method, headers: { 'content-type': 'application/json', ...headers, ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => null) };
}

const reg = await api('POST', '/auth/register', { companyName: 'Oficina Integracoes', name: 'Dono', email: 'dono@int.dev', password: 'Oficina2026xy', demo: false });
assert.equal(reg.status, 201, JSON.stringify(reg.data));
const T = reg.data.token;
const reg2 = await api('POST', '/auth/register', { companyName: 'Outra Oficina', name: 'Outro', email: 'outro@int.dev', password: 'Oficina2026xy', demo: false });
const T2 = reg2.data.token;

// ---------------- placa ----------------
await check('placa inválida é recusada', async () => {
  assert.equal((await api('GET', '/vehicles/plate/AB12', null, T)).status, 400);
});
await check('sem serviço configurado: não encontrada e sem consulta disponível', async () => {
  const r = await api('GET', '/vehicles/plate/abc1d23?consultar=1', null, T);
  assert.equal(r.status, 200); assert.equal(r.data.found, false); assert.equal(r.data.lookup_available, false);
});
await check('cadastro do serviço de placa: token não volta ao navegador', async () => {
  const r = await api('PUT', '/integrations/plates/apiplacas', { enabled: true, config: { monthly_limit: 3, cache_days: 180 }, secrets: { token: 'tok-placa' } }, T);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(!JSON.stringify(r.data).includes('tok-placa')); assert.equal(r.data.secrets.token.set, true);
  const g = await api('GET', '/integrations/plates', null, T);
  assert.ok(!JSON.stringify(g.data).includes('tok-placa')); assert.equal(g.data.active.provider, 'apiplacas');
});
await check('teste do serviço na tela de integrações', async () => {
  const r = await api('POST', '/integrations/plates/apiplacas/test', { plate: 'BRA2E19' }, T);
  assert.equal(r.status, 200); assert.equal(r.data.vehicle.brand, 'FIAT');
});
let vehicle;
await check('placa nova: consulta paga devolve marca, modelo, ano e cor (sem dados do dono)', async () => {
  const r = await api('GET', '/vehicles/plate/ABC1D23?consultar=1', null, T);
  assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.found, false);
  assert.equal(r.data.vehicle.model, 'STRADA FREEDOM'); assert.equal(r.data.vehicle.color, 'Branca');
  assert.ok(!('owner' in r.data.vehicle) && !('nome' in r.data.vehicle));
  vehicle = r.data.vehicle;
});
await check('mesma placa de novo: reaproveita (não paga outra consulta)', async () => {
  const before = calls.plate;
  const r = await api('GET', '/vehicles/plate/ABC1D23?consultar=1', null, T);
  assert.equal(r.data.source, 'cache'); assert.equal(calls.plate, before);
});
let quick;
await check('cadastro simples: cliente + veículo numa etapa', async () => {
  const r = await api('POST', '/vehicles/quick', { customer: { name: 'João da Silva', phone: '(19) 99999-0000' },
    vehicle: { plate: 'ABC1D23', brand: vehicle.brand, model: vehicle.model, year: vehicle.model_year, color: vehicle.color, data: vehicle } }, T);
  assert.equal(r.status, 201, JSON.stringify(r.data)); quick = r.data;
});
await check('placa cadastrada: encontra veículo e cliente (com ou sem hífen/minúsculas)', async () => {
  const r = await api('GET', '/vehicles/plate/abc-1d23', null, T);
  assert.equal(r.data.found, true); assert.equal(r.data.matches[0].customer_name, 'João da Silva'); assert.equal(r.data.matches[0].id, quick.equipment_id);
});
await check('placa já cadastrada não duplica (409 com o veículo existente)', async () => {
  const r = await api('POST', '/vehicles/quick', { customer: { name: 'Outro' }, vehicle: { plate: 'ABC1D23' } }, T);
  assert.equal(r.status, 409); assert.equal(r.data.equipment_id, quick.equipment_id);
});
await check('outra empresa não vê o veículo da primeira', async () => {
  const r = await api('GET', '/vehicles/plate/ABC1D23', null, T2);
  assert.equal(r.data.found, false);
});
await check('placa sem resultado no provedor: segue para cadastro manual', async () => {
  const r = await api('GET', '/vehicles/plate/ZZZ9Z99?consultar=1', null, T);
  assert.equal(r.status, 200); assert.equal(r.data.vehicle, null); assert.ok(r.data.message);
});
await check('limite mensal de consultas respeitado (429)', async () => {
  await api('GET', '/vehicles/plate/QWE1R23?consultar=1', null, T); // 3ª consulta paga (teste + ABC + ZZZ = 3 → esta passa do limite)
  const r = await api('GET', '/vehicles/plate/RTY4U56?consultar=1', null, T);
  assert.equal(r.status, 429);
});

// ---------------- veículos no cadastro do cliente (um cadastro por veículo, desligável) ----------------
let fleet;
await check('cliente novo com vários veículos (placa, marca, modelo, ano) num único cadastro', async () => {
  const r = await api('POST', '/customers', { kind: 'pj', name: 'Transportes Frota', vehicles: [
    { plate: 'frt1a23', brand: 'VW', model: 'Delivery', year: '2020', color: 'Branca' },
    { plate: 'FRT-4567', brand: 'Ford', model: 'Cargo', year: '2018' }] }, T);
  assert.equal(r.status, 201, JSON.stringify(r.data)); fleet = r.data;
  const eq = await api('GET', `/customers/${fleet.id}/equipment`, null, T);
  assert.deepEqual(eq.data.map((e) => e.plate).sort(), ['FRT-4567', 'FRT1A23']);
  assert.equal(eq.data.find((e) => e.plate === 'FRT1A23').description, 'VW Delivery');
});
await check('placa achada pela busca: traz veículo e proprietário (cliente)', async () => {
  const r = await api('GET', '/vehicles/plate/FRT1A23', null, T);
  assert.equal(r.data.found, true); assert.equal(r.data.matches[0].customer_name, 'Transportes Frota'); assert.equal(r.data.matches[0].model, 'Delivery');
});
await check('restrição ligada: mesma placa em outro cliente é recusada (cadastro, objeto e cadastro simples)', async () => {
  const a = await api('POST', '/customers', { name: 'Motorista', vehicles: [{ plate: 'FRT1A23', brand: 'VW' }] }, T);
  assert.equal(a.status, 409, JSON.stringify(a.data)); assert.match(a.data.error || a.data.message || '', /Transportes Frota/);
  assert.equal((await api('GET', '/customers?search=Motorista', null, T)).data.length, 0, 'cliente não pode ficar criado pela metade');
  const b = await api('POST', `/customers/${quick.customer_id}/equipment`, { description: 'Caminhão', plate: 'FRT-4567' }, T);
  assert.equal(b.status, 409);
  const c = await api('POST', '/vehicles/quick', { customer: { name: 'Outro' }, vehicle: { plate: 'FRT4567' } }, T);
  assert.equal(c.status, 409);
});
await check('placa repetida no mesmo formulário e placa inválida são recusadas', async () => {
  assert.equal((await api('POST', '/customers', { name: 'Dup', vehicles: [{ plate: 'DUP1A11' }, { plate: 'dup-1a11' }] }, T)).status, 400);
  assert.equal((await api('POST', '/customers', { name: 'Inv', vehicles: [{ plate: '12' }] }, T)).status, 400);
});
await check('edição do cliente: altera, inclui e remove veículos', async () => {
  const eq = (await api('GET', `/customers/${fleet.id}/equipment`, null, T)).data;
  const del = eq.find((e) => e.plate === 'FRT-4567'); const keep = eq.find((e) => e.plate === 'FRT1A23');
  const r = await api('PUT', `/customers/${fleet.id}`, { vehicles: [
    { id: keep.id, plate: 'FRT1A23', brand: 'VW', model: 'Delivery Express', year: '2021' },
    { id: del.id, plate: del.plate, remove: true }, { plate: 'NEW9B87', brand: 'Fiat', model: 'Fiorino', year: '2023' }] }, T);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const after = (await api('GET', `/customers/${fleet.id}/equipment`, null, T)).data;
  assert.deepEqual(after.map((e) => e.plate).sort(), ['FRT1A23', 'NEW9B87']);
  assert.equal(after.find((e) => e.plate === 'FRT1A23').model, 'Delivery Express');
});
await check('restrição desligada em Configurações: a mesma placa pode ter outro cadastro', async () => {
  const co = (await api('GET', '/company', null, T)).data;
  const off = await api('PUT', '/company', { settings: { orders: { ...co.settings.orders, uniqueVehicle: false } } }, T);
  assert.equal(off.status, 200); assert.equal(off.data.settings.orders.uniqueVehicle, false);
  const r = await api('POST', '/customers', { name: 'Motorista da frota', vehicles: [{ plate: 'FRT1A23', brand: 'VW' }] }, T);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const p = await api('GET', '/vehicles/plate/FRT1A23', null, T);
  assert.equal(p.data.matches.length, 2);
  await api('PUT', '/company', { settings: { orders: { ...co.settings.orders, uniqueVehicle: true } } }, T);
  assert.equal((await api('POST', '/customers', { name: 'Terceiro', vehicles: [{ plate: 'FRT1A23' }] }, T)).status, 409);
});
await check('liga/desliga a pesquisa por placa (configuração da empresa)', async () => {
  const co = (await api('GET', '/company', null, T)).data;
  assert.equal(co.settings.orders.plateOnOpen, true); assert.equal(co.settings.orders.plateAutoLookup, false);
  const r = await api('PUT', '/company', { settings: { orders: { ...co.settings.orders, plateOnOpen: false } } }, T);
  assert.equal(r.data.settings.orders.plateOnOpen, false);
  await api('PUT', '/company', { settings: { orders: { ...co.settings.orders, plateOnOpen: true } } }, T);
});

// ---------------- OS para cobrar ----------------
const os = await api('POST', '/orders', { customer_id: quick.customer_id, equipment_id: quick.equipment_id, problem: 'Solda no para-choque',
  items: [{ kind: 'servico', description: 'Solda', qty: 1, unit_price: 150 }] }, T);
assert.equal(os.status, 201, JSON.stringify(os.data));
const orderId = os.data.id;

// ---------------- maquininha: Mercado Pago Point ----------------
let device;
await check('configuração da maquininha (Mercado Pago) sem expor o token', async () => {
  const r = await api('PUT', '/integrations/terminals/mercadopago', { enabled: true, config: { print_on_terminal: 'no_ticket' }, secrets: { access_token: 'mp-token' } }, T);
  assert.equal(r.status, 200); assert.ok(!JSON.stringify(r.data).includes('mp-token'));
  const d = await api('POST', '/integrations/devices', { provider: 'mercadopago', name: 'Point do balcão', external_id: 'PAX_A910__SMARTPOS1', is_default: true }, T);
  assert.equal(d.status, 201); device = d.data;
});
await check('valor acima do saldo é recusado', async () => {
  const r = await api('POST', '/terminal-charges', { order_id: orderId, amount: 999, method: 'credito' }, T);
  assert.equal(r.status, 400);
});
let charge;
await check('fechar OS: envia o saldo (150,00) para a maquininha padrão', async () => {
  const r = await api('POST', '/terminal-charges', { order_id: orderId, method: 'credito', installments: 2 }, T);
  assert.equal(r.status, 201, JSON.stringify(r.data)); assert.equal(r.data.amount, 150); assert.equal(r.data.status, 'enviada'); charge = r.data;
});
await check('segunda cobrança com uma em andamento: recusada (409)', async () => {
  const r = await api('POST', '/terminal-charges', { order_id: orderId, method: 'debito' }, T);
  assert.equal(r.status, 409);
});
await check('consultas simultâneas: pago uma única vez no financeiro', async () => {
  const rs = await Promise.all([1, 2, 3].map(() => api('GET', `/terminal-charges/${charge.id}`, null, T)));
  const r = await api('GET', `/terminal-charges/${charge.id}`, null, T);
  assert.equal(r.data.status, 'paga', JSON.stringify(rs.map((x) => x.data?.status)));
  const o = await api('GET', `/orders/${orderId}`, null, T);
  const entradas = o.data.payments.filter((p) => p.type === 'entrada');
  assert.equal(entradas.length, 1); assert.equal(Number(entradas[0].amount), 150); assert.equal(entradas[0].method, 'credito');
  assert.equal(o.data.balance, 0);
});
await check('outra empresa não consulta a cobrança', async () => {
  assert.equal((await api('GET', `/terminal-charges/${charge.id}`, null, T2)).status, 404);
});
await check('webhook desconhecido é ignorado sem erro', async () => {
  const r = await fetch(`${base}/api/public/terminals/mercadopago/webhook?ref=NAOEXISTE`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 200);
});

// cobrança cancelada
const os2 = await api('POST', '/orders', { customer_id: quick.customer_id, items: [{ kind: 'servico', description: 'Corte', qty: 1, unit_price: 80 }] }, T);
await check('cancelar cobrança enviada (antes de pagar)', async () => {
  const c = await api('POST', '/terminal-charges', { order_id: os2.data.id, method: 'debito' }, T);
  assert.equal(c.status, 201);
  const x = await api('POST', `/terminal-charges/${c.data.id}/cancel`, {}, T);
  assert.equal(x.data.status, 'cancelada');
  const o = await api('GET', `/orders/${os2.data.id}`, null, T);
  assert.equal(o.data.payments.length, 0);
});

// ---------------- InfinitePay (link) ----------------
const os3 = await api('POST', '/orders', { customer_id: quick.customer_id, items: [{ kind: 'servico', description: 'Pintura', qty: 1, unit_price: 150 }] }, T);
await check('InfinitePay: gera link/QR e só lança depois da conferência (payment_check)', async () => {
  await api('PUT', '/integrations/terminals/infinitepay', { enabled: true, config: { handle: 'minhaoficina' } }, T);
  const d = await api('POST', '/integrations/devices', { provider: 'infinitepay', name: 'Link no balcão' }, T);
  const c = await api('POST', '/terminal-charges', { order_id: os3.data.id, terminal_id: d.data.id, method: 'pix' }, T,
    { 'x-edge-site': 'torven.lorler.com.br' });
  assert.equal(c.status, 201, JSON.stringify(c.data)); assert.ok(c.data.link_url.startsWith('https://'));
  // retorno com transação inválida: continua aguardando
  let r = await api('POST', `/terminal-charges/${c.data.id}/return`, { transaction_nsu: 'TX-NAO', slug: 'abc' }, T);
  assert.equal(r.data.status, 'enviada');
  // aviso (webhook) com transação paga: confere e lança
  const w = await fetch(`${base}/api/public/terminals/infinitepay/webhook`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ order_nsu: (await pool.query('select external_reference from terminal_charges where id = $1', [c.data.id])).rows[0].external_reference, transaction_nsu: 'TX-OK', invoice_slug: 'abc' }) });
  assert.equal(w.status, 200);
  r = await api('GET', `/terminal-charges/${c.data.id}`, null, T);
  assert.equal(r.data.status, 'paga'); assert.equal(r.data.method, 'pix');
});

// ---------------- provedores preparados e permissões ----------------
await check('PagBank/Getnet: estrutura pronta, envio recusado com mensagem clara (501)', async () => {
  await api('PUT', '/integrations/terminals/pagbank', { enabled: true, secrets: { token: 'x' } }, T);
  const d = await api('POST', '/integrations/devices', { provider: 'pagbank', name: 'PagBank Smart' }, T);
  const os4 = await api('POST', '/orders', { customer_id: quick.customer_id, items: [{ kind: 'servico', description: 'X', qty: 1, unit_price: 10 }] }, T);
  const c = await api('POST', '/terminal-charges', { order_id: os4.data.id, terminal_id: d.data.id, method: 'debito' }, T);
  assert.equal(c.status, 501);
  const list = await api('GET', `/terminal-charges?order_id=${os4.data.id}`, null, T);
  assert.equal(list.data[0].status, 'erro');
});
await check('lista de provedores informa quais estão prontos', async () => {
  const r = await api('GET', '/integrations/terminals', null, T);
  const by = Object.fromEntries(r.data.providers.map((p) => [p.id, p]));
  assert.equal(by.mercadopago.ready, true); assert.equal(by.pagbank.ready, false); assert.equal(by.infinitepay.mode, 'link');
  assert.ok(!JSON.stringify(r.data).includes('mp-token'));
});
await check('técnico não configura integrações nem cobra', async () => {
  const u = await api('POST', '/users', { name: 'Téc', email: 'tec@int.dev', role: 'technician', password: 'Tecnico2026xy' }, T);
  assert.equal(u.status, 201, JSON.stringify(u.data));
  const l = await api('POST', '/auth/login', { email: 'tec@int.dev', password: 'Tecnico2026xy' });
  const TT = l.data.token;
  assert.equal((await api('PUT', '/integrations/terminals/mercadopago', { enabled: false }, TT)).status, 403);
  assert.equal((await api('POST', '/terminal-charges', { order_id: orderId, method: 'debito' }, TT)).status, 403);
});

console.log(`\n${passed} verificações OK, ${fails.length} falhas`);
server.close(); fake.close(); await pool.end();
if (fails.length) { fails.forEach((f) => console.log(' -', f)); process.exit(1); }
