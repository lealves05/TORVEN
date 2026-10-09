// Teste das integrações novas: placa (cadastro, consulta paga, cadastro simples) e cobrança na maquininha
// (Mercado Pago Point e InfinitePay contra provedores falsos locais).
// Uso: DATABASE_URL=postgres://.../torven_integracoes_test node scripts/integrations-test.mjs   (APAGA o banco informado)
import assert from 'node:assert/strict';
import http from 'node:http';

if (!/test/.test(process.env.DATABASE_URL || '')) { console.error('Use um banco de teste (nome contendo "test")'); process.exit(1); }

// ---------- provedores falsos ----------
const calls = { fipe: 0, fipeDown: false, plate: 0, mpCreate: 0, mpGet: 0, ipLinks: 0, ipCheck: 0, wa: [], ai: 0 };
const orders = new Map(); // id → { amount, status, gets, ref, pay }
const fake = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const send = (st, obj) => { res.writeHead(st, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    const u = new URL(req.url, 'http://x');
    // WhatsApp (Graph da Meta) e IA (Anthropic) falsos
    let w = u.pathname.match(/^\/graph\/(\d+)\/messages$/);
    if (w) {
      if (req.headers.authorization !== 'Bearer wa-token') return send(401, { error: { message: 'token' } });
      const b = JSON.parse(body); calls.wa.push({ to: b.to, text: b.text?.body });
      return send(200, { messages: [{ id: `wamid.${calls.wa.length}` }] });
    }
    if (u.pathname === '/anthropic') {
      calls.ai += 1;
      return send(200, { content: [{ type: 'text', text: JSON.stringify({ intent: 'status', plate: null, date: null, time: null, problem: null, name: null }) }] });
    }
    // Tabela FIPE (v2)
    if (u.pathname.startsWith('/fipe/')) {
      calls.fipe += 1;
      if (calls.fipeDown) return send(503, { error: 'fora' });
      const p = u.pathname.slice(6);
      if (p === 'cars/brands') return send(200, [{ code: '59', name: 'VW - VolksWagen' }, { code: '21', name: 'Fiat' }]);
      if (p === 'cars/brands/21/models') return send(200, [{ code: '4400', name: 'STRADA Working 1.4 Flex' }, { code: '4401', name: 'UNO Mille' }]);
      if (p === 'cars/brands/21/models/4400/years') return send(200, [{ code: '2021-1', name: '2021 Gasolina' }]);
      if (p === 'cars/brands/21/models/4400/years/2021-1') {
        return send(200, { brand: 'Fiat', model: 'STRADA Working 1.4 Flex', modelYear: 2021, fuel: 'Gasolina', codeFipe: '001234-5', price: 'R$ 80.000,00', referenceMonth: 'outubro de 2026' });
      }
      return send(404, { error: 'not found' });
    }
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
process.env.APIPLACAS_URL = FAKE; process.env.FIPE_URL = `${FAKE}/fipe`; process.env.MERCADOPAGO_API_URL = FAKE; process.env.INFINITEPAY_API_URL = FAKE;
process.env.WHATSAPP_GRAPH_URL = `${FAKE}/graph`; process.env.ANTHROPIC_URL = `${FAKE}/anthropic`;

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
await check('Tabela FIPE grátis: marca → modelo → ano preenche o veículo', async () => {
  const b = await api('GET', '/vehicles/fipe/cars/brands', null, T);
  assert.equal(b.status, 200, JSON.stringify(b.data)); assert.deepEqual(b.data.map((x) => x.name), ['Fiat', 'VW - VolksWagen']);
  const m = await api('GET', '/vehicles/fipe/cars/brands/21/models', null, T); assert.equal(m.data.length, 2);
  const y = await api('GET', '/vehicles/fipe/cars/brands/21/models/4400/years', null, T); assert.equal(y.data[0].code, '2021-1');
  const i = await api('GET', '/vehicles/fipe/cars/brands/21/models/4400/years/2021-1', null, T);
  assert.equal(i.data.brand, 'Fiat'); assert.equal(i.data.model_year, '2021'); assert.equal(i.data.fipe_code, '001234-5'); assert.equal(i.data.source, 'fipe');
});
await check('Tabela FIPE: guardada (não repete a busca) e funciona com a fonte fora do ar', async () => {
  const before = calls.fipe;
  await api('GET', '/vehicles/fipe/cars/brands', null, T2);
  assert.equal(calls.fipe, before);
  await pool.query("update fipe_cache set fetched_at = now() - interval '90 days' where key = 'cars/brands'");
  calls.fipeDown = true;
  const r = await api('GET', '/vehicles/fipe/cars/brands', null, T);
  calls.fipeDown = false;
  assert.equal(r.status, 200); assert.equal(r.data.length, 2);
});
await check('Tabela FIPE: parâmetros inválidos são recusados', async () => {
  assert.equal((await api('GET', '/vehicles/fipe/avioes/brands', null, T)).status, 400);
  assert.equal((await api('GET', '/vehicles/fipe/cars/brands/..%2F..%2Fx/models', null, T)).status, 400);
  assert.equal((await api('GET', '/vehicles/fipe/cars/brands/21/models/4400/years/2021;drop', null, T)).status, 400);
  assert.equal((await api('GET', '/vehicles/fipe/cars/brands')).status, 401);
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

// ---------------- logotipo e modelo dos documentos ----------------
await check('modelo dos documentos: padrões e gravação parcial (campos exibidos e títulos mesclados)', async () => {
  const co = (await api('GET', '/company', null, T)).data;
  assert.equal(co.settings.documents.paper, 'a4'); assert.equal(co.settings.documents.show.problem, true);
  assert.equal(co.settings.documents.titles.os, 'Ordem de serviço'); assert.equal(co.settings.brand.logoShape, 'square');
  const r = await api('PUT', '/company', { settings: { documents: { headerStyle: 'faixa', accentColor: '#1d4ed8', paper: 'cupom80', copies: 2,
    titles: { os: 'OS Técnica' }, show: { diagnosis: false }, footerNote: 'PIX: 12.345.678/0001-90' }, brand: { logoShape: 'wide', showName: false } } }, T);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const d = r.data.settings.documents;
  assert.equal(d.headerStyle, 'faixa'); assert.equal(d.copies, 2); assert.equal(d.titles.os, 'OS Técnica'); assert.equal(d.titles.quote, 'Orçamento');
  assert.equal(d.show.diagnosis, false); assert.equal(d.show.problem, true); assert.equal(r.data.settings.brand.logoShape, 'wide');
});
await check('logotipo: aceita PNG/JPG/WEBP e recusa outro conteúdo', async () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  const ok = await api('PUT', '/company', { logo_url: png }, T);
  assert.equal(ok.status, 200, JSON.stringify(ok.data)); assert.equal(ok.data.logo_url, png);
  for (const bad of ['javascript:alert(1)', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', 'https://exemplo.com/logo.png']) {
    assert.equal((await api('PUT', '/company', { logo_url: bad }, T)).status, 400, bad);
  }
  assert.equal((await api('PUT', '/company', { logo_url: null }, T)).data.logo_url, null);
});

// ---------------- OS para cobrar ----------------
const os = await api('POST', '/orders', { customer_id: quick.customer_id, equipment_id: quick.equipment_id, problem: 'Solda no para-choque',
  items: [{ kind: 'servico', description: 'Solda', qty: 1, unit_price: 150 }] }, T);
assert.equal(os.status, 201, JSON.stringify(os.data));
await check('OS traz placa, ano e cor do veículo para a impressão', async () => {
  const g = await api('GET', `/orders/${os.data.id}`, null, T);
  assert.equal(g.data.equipment_plate, 'ABC1D23'); assert.equal(g.data.equipment_color, 'Branca');
});
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

// ---------------- disputas (regressões do teste de carga) ----------------
await check('cobrança em andamento: receber e entregar são recusados (409)', async () => {
  const o = await api('POST', '/orders', { customer_id: quick.customer_id, items: [{ kind: 'servico', description: 'Solda', qty: 1, unit_price: 100 }] }, T);
  const c = await api('POST', '/terminal-charges', { order_id: o.data.id, terminal_id: device.id, method: 'debito' }, T);
  assert.equal(c.status, 201, JSON.stringify(c.data));
  const p = await api('POST', `/orders/${o.data.id}/payments`, { payments: [{ method: 'dinheiro', amount: 100 }] }, T);
  assert.equal(p.status, 409); assert.match(p.data.error, /maquininha em andamento/);
  const d = await api('POST', `/orders/${o.data.id}/deliver`, { payments: [{ method: 'dinheiro', amount: 100 }] }, T);
  assert.equal(d.status, 409);
  assert.equal((await api('GET', `/orders/${o.data.id}`, null, T)).data.payments.length, 0);
  await api('POST', `/terminal-charges/${c.data.id}/cancel`, {}, T);
});
await check('maquininha paga acima do saldo (OS já recebida): fica divergente, sem lançar o excedente', async () => {
  const o = await api('POST', '/orders', { customer_id: quick.customer_id, items: [{ kind: 'servico', description: 'Solda', qty: 1, unit_price: 100 }] }, T);
  const c = await api('POST', '/terminal-charges', { order_id: o.data.id, terminal_id: device.id, method: 'credito' }, T);
  assert.equal(c.status, 201);
  // recebimento por outro meio gravado no meio da cobrança (simula a disputa que existia antes da trava)
  const { rows: [co] } = await pool.query('select company_id from orders where id = $1', [o.data.id]);
  await pool.query(`insert into transactions (company_id, type, category, amount, method, due_date, paid_at, order_id) values ($1,'entrada','Ordens de serviço',100,'dinheiro',current_date,now(),$2)`, [co.company_id, o.data.id]);
  await api('GET', `/terminal-charges/${c.data.id}`, null, T);
  const r = await api('GET', `/terminal-charges/${c.data.id}`, null, T);
  assert.equal(r.data.status, 'divergente', JSON.stringify(r.data)); assert.match(r.data.message, /estorne/);
  const od = await api('GET', `/orders/${o.data.id}`, null, T);
  assert.equal(od.data.paid, 100); assert.equal(od.data.balance, 0);
});
await check('OS quitada: novo "receber" em dinheiro é recusado sem registrar evento', async () => {
  const o = await api('POST', '/orders', { customer_id: quick.customer_id, items: [{ kind: 'servico', description: 'Solda', qty: 1, unit_price: 50 }] }, T);
  const rs = await Promise.all([1, 2].map(() => api('POST', `/orders/${o.data.id}/payments`, { payments: [{ method: 'dinheiro', amount: 50 }] }, T)));
  assert.deepEqual(rs.map((x) => x.status).sort(), [200, 400]);
  const od = await api('GET', `/orders/${o.data.id}`, null, T);
  assert.equal(od.data.paid, 50);
  assert.equal(od.data.events.filter((e) => e.type === 'pagamento').length, 1);
});
await check('abrir caixa duas vezes ao mesmo tempo: um só caixa aberto (409 no segundo)', async () => {
  const rs = await Promise.all([1, 2].map(() => api('POST', '/cash/session/open', { opening_amount: 10 }, T)));
  assert.deepEqual(rs.map((x) => x.status).sort(), [201, 409]);
  const { rows: [n] } = await pool.query("select count(*)::int n from cash_sessions s join users u on u.company_id = s.company_id where u.email = 'dono@int.dev' and s.closed_at is null");
  assert.equal(n.n, 1);
});
await check('cronômetro iniciado em duas OS ao mesmo tempo pelo mesmo técnico: sem erro, um só aberto', async () => {
  const tech = await api('POST', '/technicians', { name: 'Técnico Disputa' }, T);
  const os = await Promise.all([1, 2].map(() => api('POST', '/orders', { customer_id: quick.customer_id, technician_id: tech.data.id, items: [] }, T)));
  const rs = await Promise.all(os.map((o) => api('POST', `/production/orders/${o.data.id}/time/start`, { technician_id: tech.data.id }, T)));
  assert.ok(rs.every((x) => x.status === 201 || x.status === 409), rs.map((x) => x.status).join(','));
  const { rows: [n] } = await pool.query('select count(*)::int n from order_time_logs where technician_id = $1 and ended_at is null', [tech.data.id]);
  assert.equal(n.n, 1);
});

// ---------- tipos de OS, checklists vinculados e várias fotos ----------
let otype;
await check('tipo de OS: cria, recusa nome repetido e checklist obrigatório vinculado', async () => {
  const t = await api('POST', '/quality/types', { name: 'Troca de óleo' }, T);
  assert.equal(t.status, 201, JSON.stringify(t.data)); otype = t.data;
  assert.equal((await api('POST', '/quality/types', { name: 'TROCA DE ÓLEO' }, T)).status, 400);
  const c = await api('POST', '/quality/templates', { name: 'Recebimento óleo', kind: 'recebimento', items: ['Nível de óleo', 'Vazamentos'], order_type_id: otype.id, required: true }, T);
  assert.equal(c.status, 201, JSON.stringify(c.data)); assert.deepEqual(c.data.order_type_ids, [otype.id]);
  const l = await api('GET', `/quality/templates?order_type_id=${otype.id}`, null, T);
  assert.ok(l.data.some((x) => x.id === c.data.id));
});
await check('outra empresa não vê nem usa o tipo de OS', async () => {
  assert.ok(!(await api('GET', '/quality/types', null, T2)).data.some((x) => x.id === otype.id));
  const pt = await api('PUT', `/quality/types/${otype.id}`, { name: 'X invadido' }, T2); assert.equal(pt.status, 404, JSON.stringify(pt.data));
  const pc = await api('POST', '/quality/templates', { name: 'Yy', kind: 'inspecao', items: ['abc'], order_type_id: otype.id }, T2); assert.equal(pc.status, 404, JSON.stringify(pc.data));
  const os2 = await api('POST', '/orders', { customer_id: null, kind: 'os', order_type_id: otype.id, items: [] }, T2);
  assert.ok([400, 404].includes(os2.status));
});
await check('OS do tipo só avança depois do checklist obrigatório de recebimento', async () => {
  const o = await api('POST', '/orders', { customer_id: quick.customer_id, order_type_id: otype.id, items: [] }, T);
  assert.equal(o.status, 201, JSON.stringify(o.data)); assert.equal(o.data.order_type_name, 'Troca de óleo');
  const blocked = await api('POST', `/orders/${o.data.id}/status`, { status: 'diagnostico' }, T);
  assert.equal(blocked.status, 400); assert.match(blocked.data.error, /Recebimento óleo/);
  const i = await api('POST', `/quality/orders/${o.data.id}/inspections`, { kind: 'recebimento', items: [{ label: 'Nível de óleo', result: 'ok' }], result: 'aprovado' }, T);
  assert.equal(i.status, 201);
  assert.equal((await api('POST', `/orders/${o.data.id}/status`, { status: 'diagnostico' }, T)).status, 200);
  // OS sem tipo não é afetada pelo checklist do tipo
  const free = await api('POST', '/orders', { customer_id: quick.customer_id, items: [] }, T);
  assert.equal((await api('POST', `/orders/${free.data.id}/status`, { status: 'diagnostico' }, T)).status, 200);
  // trocar o tipo da OS fica no histórico; tipo usado não pode ser excluído
  const ch = await api('PUT', `/quality/orders/${free.data.id}/type`, { order_type_id: otype.id }, T);
  assert.equal(ch.status, 200);
  assert.equal((await api('DELETE', `/quality/types/${otype.id}`, null, T)).status, 400);
});
await check('um checklist em vários tipos; vincular pelo tipo; geral vale para todos', async () => {
  const t2 = (await api('POST', '/quality/types', { name: 'Funilaria' }, T)).data;
  const t3 = (await api('POST', '/quality/types', { name: 'Solda' }, T)).data;
  const c = await api('POST', '/quality/templates', { name: 'Entrega lavada', kind: 'entrega', items: ['Veículo lavado'], order_type_ids: [t2.id, t3.id], required: true }, T);
  assert.equal(c.status, 201, JSON.stringify(c.data)); assert.equal(c.data.order_type_ids.length, 2);
  const forT2 = (await api('GET', `/quality/templates?order_type_id=${t2.id}`, null, T)).data;
  assert.ok(forT2.some((x) => x.id === c.data.id));
  assert.ok(!(await api('GET', `/quality/templates?order_type_id=${otype.id}`, null, T)).data.some((x) => x.id === c.data.id));
  // vincular a partir do tipo
  const g = await api('POST', '/quality/templates', { name: 'Inspeção geral', kind: 'inspecao', items: ['Aperto'] }, T);
  const link = await api('PUT', `/quality/types/${otype.id}/checklists`, { template_ids: [c.data.id] }, T);
  assert.equal(link.status, 200, JSON.stringify(link.data));
  const types = (await api('GET', '/quality/types?all=1', null, T)).data;
  assert.deepEqual(types.find((x) => x.id === otype.id).checklist_ids, [c.data.id]);
  assert.ok((await api('GET', `/quality/templates?order_type_id=${t3.id}`, null, T)).data.some((x) => x.id === g.data.id));
  // outra empresa não vincula
  assert.equal((await api('PUT', `/quality/types/${otype.id}/checklists`, { template_ids: [] }, T2)).status, 404);
  assert.equal((await api('PUT', `/quality/types/${t2.id}/checklists`, { template_ids: [g.data.id] }, T2)).status, 404);
  // excluir tipo: checklist usado também por outro tipo continua ativo
  assert.equal((await api('DELETE', `/quality/types/${t3.id}`, null, T)).status, 204);
  const after = (await api('GET', '/quality/templates?all=1', null, T)).data.find((x) => x.id === c.data.id);
  assert.equal(after.active, true); assert.equal(after.order_type_ids.length, 2);
});
await check('tipos de OS padrão por ramo chegam OCULTOS (com checklists desativados) e a oficina habilita o seu', async () => {
  const all = (await api('GET', '/quality/types?all=1', null, T)).data;
  const std = all.filter((t) => t.segment);
  assert.equal(std.length, 35, `padrão: ${std.length}`);
  for (const seg of ['mecanica', 'autoeletrica', 'motos', 'serralheria', 'soldas']) assert.ok(std.some((t) => t.segment === seg), seg);
  assert.ok(std.every((t) => t.checklist_ids.length === 3), 'cada tipo com recebimento, inspeção e entrega');
  assert.ok(std.every((t) => !t.active), 'tipos padrão chegam ocultos');
  assert.equal((await api('GET', '/quality/types', null, T)).data.filter((t) => t.segment).length, 0);
  const tplsAll = (await api('GET', '/quality/templates?all=1', null, T)).data;
  const catTpl = tplsAll.filter((c) => c.template_key);
  assert.ok(catTpl.length >= 45 && catTpl.every((c) => !c.active), 'checklists padrão chegam desativados');
  assert.ok(tplsAll.some((c) => !c.template_key && c.active), 'checklists gerais continuam ativos');
  // habilita o ramo mecânica: tipos e checklists dele
  const on = await api('POST', '/quality/types/segment-visible', { segment: 'mecanica', visible: true }, T);
  assert.equal(on.data.updated, 7);
  const oleo = std.find((t) => t.template_key === 'mec-oleo');
  const tpl = (await api('GET', `/quality/templates?order_type_id=${oleo.id}`, null, T)).data;
  assert.ok(tpl.some((c) => c.kind === 'recebimento') && tpl.some((c) => c.kind === 'inspecao' && c.name.includes('Troca de óleo')));
  const act = (await api('GET', '/quality/templates', null, T)).data.filter((c) => c.template_key);
  assert.equal(act.length, 7 + 2, 'só os checklists da mecânica ativos');
  // ocultar um tipo: some da abertura da OS e a inspeção dele desativa; recebimento/entrega do ramo continuam
  assert.equal((await api('POST', `/quality/types/${oleo.id}/visible`, { visible: false }, T)).status, 200);
  assert.ok(!(await api('GET', '/quality/types', null, T)).data.some((t) => t.id === oleo.id));
  assert.equal((await api('POST', '/orders', { customer_id: quick.customer_id, order_type_id: oleo.id, items: [] }, T)).status, 404);
  const act2 = (await api('GET', '/quality/templates', null, T)).data.filter((c) => c.template_key);
  assert.ok(!act2.some((c) => c.template_key === 'mec-oleo-inspecao') && act2.some((c) => c.template_key === 'mecanica-recebimento'));
  // exibir/ocultar um ramo inteiro
  assert.equal((await api('POST', '/quality/types/segment-visible', { segment: 'serralheria', visible: true }, T)).data.updated, 6);
  assert.equal((await api('POST', '/quality/types/segment-visible', { segment: 'serralheria', visible: false }, T)).data.updated, 6);
  assert.ok(!(await api('GET', '/quality/types', null, T)).data.some((t) => t.segment === 'serralheria'));
  assert.ok(!(await api('GET', '/quality/templates', null, T)).data.some((c) => c.template_key === 'serralheria-recebimento'));
  // tipo com OS em andamento: ocultar não desativa os checklists dele (a OS aberta continua com eles)
  const freio = std.find((t) => t.template_key === 'mec-freios');
  const of = await api('POST', '/orders', { customer_id: quick.customer_id, order_type_id: freio.id, items: [] }, T);
  assert.equal(of.status, 201, JSON.stringify(of.data));
  await api('POST', '/quality/types/segment-visible', { segment: 'mecanica', visible: false }, T);
  const act3 = (await api('GET', '/quality/templates', null, T)).data.filter((c) => c.template_key);
  assert.ok(act3.some((c) => c.template_key === 'mec-freios-inspecao') && act3.some((c) => c.template_key === 'mecanica-recebimento'));
  assert.ok(!act3.some((c) => c.template_key === 'mec-motor-inspecao'));
  // outra empresa não mexe
  assert.equal((await api('POST', `/quality/types/${oleo.id}/visible`, { visible: true }, T2)).status, 404);
  // restaurar o que foi apagado (sem duplicar) — restaurar exibe o ramo
  const sold = std.find((t) => t.template_key === 'sol-inox');
  assert.equal((await api('DELETE', `/quality/types/${sold.id}`, null, T)).status, 204);
  const cat = (await api('GET', '/quality/catalog', null, T)).data;
  assert.equal(cat.find((c) => c.segment === 'soldas').types.find((t) => t.key === 'sol-inox').installed, false);
  const rr = await api('POST', '/quality/catalog/install', { segments: ['soldas'] }, T);
  assert.equal(rr.data.created, 1);
  assert.equal((await api('GET', '/quality/types?all=1', null, T)).data.filter((t) => t.segment).length, 35);
  assert.equal((await api('GET', '/quality/types', null, T)).data.filter((t) => t.segment === 'soldas').length, 6);
  assert.ok((await api('GET', '/quality/templates', null, T)).data.some((c) => c.template_key === 'sol-inox-inspecao'));
});
await check('oficina de motos: ramo da oficina ajusta tipos, checklists, categorias e FIPE; empresa antiga sem ramo tem os não usados ocultos', async () => {
  const motos = (await api('GET', '/quality/types?all=1', null, T)).data.filter((t) => t.segment === 'motos');
  assert.equal(motos.length, 9);
  const rel = motos.find((t) => t.template_key === 'moto-relacao');
  const own = await api('POST', '/quality/types', { name: 'Lavagem da moto' }, T);
  assert.equal(own.status, 201, JSON.stringify(own.data));
  const p = await api('POST', '/quality/catalog/profile', { segments: ['motos'] }, T);
  assert.equal(p.status, 200, JSON.stringify(p.data));
  assert.equal(p.data.shown, 9);
  const tpl = (await api('GET', `/quality/templates?order_type_id=${rel.id}`, null, T)).data;
  assert.ok(tpl.some((c) => c.name === 'Recebimento da moto' && c.items.some((i) => /Capacete/.test(i))), 'recebimento da moto ativo');
  assert.ok(tpl.some((c) => c.kind === 'inspecao' && c.items.some((i) => /corrente/i.test(i))));
  const vis = (await api('GET', '/quality/types', null, T)).data;
  assert.equal(vis.filter((t) => t.segment).length, 9);
  assert.ok(vis.every((t) => !t.segment || t.segment === 'motos'));
  assert.ok(vis.some((t) => t.id === own.data.id), 'tipo próprio continua');
  const actTpl = (await api('GET', '/quality/templates', null, T)).data.filter((c) => c.template_key);
  assert.ok(actTpl.every((c) => c.template_key.startsWith('moto') || c.template_key.startsWith('mec-freios') || c.template_key.startsWith('mecanica')), 'só checklists de moto (e os da OS de freios em andamento)');
  const co = (await api('GET', '/company', null, T)).data;
  assert.deepEqual(co.settings.segments, ['motos']);
  assert.equal(co.settings.fipeDefaultType, 'motorcycles');
  assert.ok(co.settings.equipmentCategories.includes('Moto') && co.settings.materialCategories.includes('Kit relação'));
  await api('POST', '/quality/catalog/profile', { segments: ['motos', 'mecanica'] }, T);
  const co2 = (await api('GET', '/company', null, T)).data;
  assert.equal(co2.settings.equipmentCategories.filter((x) => x === 'Moto').length, 1);
  assert.equal(co2.settings.fipeDefaultType, 'cars');
  assert.equal((await api('GET', '/quality/types', null, T)).data.filter((t) => t.segment).length, 16);
  assert.equal((await api('POST', '/quality/catalog/profile', { segments: [] }, T)).status, 400);
  assert.equal((await api('POST', '/quality/catalog/profile', { segments: ['padaria'] }, T)).status, 400);
  assert.equal((await api('GET', '/quality/types', null, T2)).data.filter((t) => t.segment).length, 0, 'outra empresa intacta');
  // empresa que já tinha o catálogo antigo (v1, tudo exibido) e ainda não escolheu o ramo:
  // recebe motos oculto e os tipos padrão nunca usados ficam ocultos; o tipo já usado continua exibido
  const { rows: [c2] } = await pool.query("select company_id from users where email = 'outro@int.dev'");
  await pool.query("delete from order_types where company_id = $1 and segment = 'motos'", [c2.company_id]);
  await pool.query('update order_types set active = true where company_id = $1 and segment is not null', [c2.company_id]);
  await pool.query('update checklist_templates set active = true where company_id = $1', [c2.company_id]);
  const { rows: [used] } = await pool.query("select id from order_types where company_id = $1 and template_key = 'ser-portao'", [c2.company_id]);
  const c2cust = (await api('POST', '/customers', { name: 'Cliente Portão' }, T2)).data;
  assert.equal((await api('POST', '/orders', { customer_id: c2cust.id, order_type_id: used.id, items: [] }, T2)).status, 201);
  await pool.query("update companies set os_catalog_version = 1, settings = settings - 'segments' where id = $1", [c2.company_id]);
  const after = (await api('GET', '/quality/types?all=1', null, T2)).data.filter((t) => t.segment);
  assert.equal(after.length, 35);
  assert.deepEqual(after.filter((t) => t.active).map((t) => t.template_key), ['ser-portao']);
  const t2act = (await api('GET', '/quality/templates', null, T2)).data.filter((c) => c.template_key).map((c) => c.template_key).sort();
  assert.deepEqual(t2act, ['ser-portao-inspecao', 'serralheria-entrega', 'serralheria-recebimento']);
  await api('POST', '/quality/catalog/profile', { segments: ['mecanica', 'autoeletrica', 'serralheria', 'soldas'] }, T);
});
await check('várias fotos na OS: até 40 por OS, depois recusa', async () => {
  const o = await api('POST', '/orders', { customer_id: quick.customer_id, items: [] }, T);
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  for (let k = 0; k < 40; k += 1) {
    const r = await api('POST', '/attachments', { entity: 'order', entity_id: o.data.id, filename: `f${k}.png`, mime: 'image/png', data: png, authorized: true }, T);
    assert.equal(r.status, 201, JSON.stringify(r.data));
  }
  const over = await api('POST', '/attachments', { entity: 'order', entity_id: o.data.id, filename: 'x.png', mime: 'image/png', data: png, authorized: true }, T);
  assert.equal(over.status, 400); assert.match(over.data.error, /40/);
  assert.equal((await api('GET', `/attachments?entity=order&entity_id=${o.data.id}`, null, T2)).data.length || 0, 0);
});

// ---------- WhatsApp: agente, webhook assinado, privacidade, aprovação ----------
const crypto = await import('node:crypto');
const APP_SECRET = 'segredo-do-app-123';
const PID = '1234567890';
const hookBody = (from, text, id, pid = PID) => JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: {
  messaging_product: 'whatsapp', metadata: { phone_number_id: pid }, contacts: [{ wa_id: from, profile: { name: 'Cliente Zap' } }],
  messages: [{ from, id, type: 'text', text: { body: text } }] } }] }] });
const sig = (raw, secret = APP_SECRET) => `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;
let seq = 0;
const zap = async (from, text, opts = {}) => {
  const raw = hookBody(from, text, `wamid.in.${++seq}`, opts.pid);
  const r = await fetch(`${base}/api/webhooks/whatsapp`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': opts.sig ?? sig(raw) }, body: raw });
  return r.status;
};
const lastTo = (to) => calls.wa.filter((x) => x.to === to).map((x) => x.text);
let waCust;
await check('WhatsApp: ligar exige número, token e chave; mesmo número não serve a duas empresas', async () => {
  assert.equal((await api('PUT', '/whatsapp/config', { enabled: true, config: { phone_number_id: PID } }, T)).status, 400);
  const ok = await api('PUT', '/whatsapp/config', { enabled: true, config: { phone_number_id: PID, agent_enabled: true, hours_start: '00:00', hours_end: '23:59', work_days: '0,1,2,3,4,5,6' }, secrets: { access_token: 'wa-token', app_secret: APP_SECRET } }, T);
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.secrets.access_token.set, true); assert.ok(!JSON.stringify(ok.data).includes('wa-token'));
  assert.equal((await api('PUT', '/whatsapp/config', { enabled: false, config: { phone_number_id: PID } }, T2)).status, 409);
});
await check('WhatsApp: verificação do webhook só com o token da empresa', async () => {
  const cfg = await api('GET', '/whatsapp/config', null, T);
  const vt = cfg.data.whatsapp.config.verify_token;
  const good = await fetch(`${base}/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${vt}&hub.challenge=987654`);
  assert.equal(good.status, 200); assert.equal(await good.text(), '987654');
  assert.equal((await fetch(`${base}/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${'x'.repeat(24)}&hub.challenge=1`)).status, 403);
});
await check('WhatsApp: webhook sem assinatura válida é recusado e não grava nada', async () => {
  assert.equal(await zap('5519900000001', 'oi', { sig: 'sha256=00' }), 401);
  assert.equal(await zap('5519900000001', 'oi', { sig: sig(hookBody('5519900000001', 'outro', 'x'), 'errado') }), 401);
  const many = JSON.stringify({ entry: [{ changes: Array.from({ length: 8 }, (_, i) => ({ value: { metadata: { phone_number_id: String(100 + i) } } })) }] });
  assert.equal((await fetch(`${base}/api/webhooks/whatsapp`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig(many) }, body: many })).status, 400);
  const { rows: [n] } = await pool.query("select count(*)::int n from wa_conversations where phone = '5519900000001'");
  assert.equal(n.n, 0);
});
await check('WhatsApp: agente responde pelo número da empresa e mensagem repetida não duplica', async () => {
  const raw = hookBody('5519900000002', 'oi', 'wamid.dup.1');
  for (let i = 0; i < 2; i += 1) {
    const r = await fetch(`${base}/api/webhooks/whatsapp`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig(raw) }, body: raw });
    assert.equal(r.status, 200);
  }
  assert.equal(lastTo('5519900000002').length, 1); assert.match(lastTo('5519900000002')[0], /Digite o número da opção/);
});
await check('WhatsApp: status pela placa só com detalhes para o telefone do cliente', async () => {
  const c = await api('POST', '/customers', { name: 'Dono do Carro', phone: '(19) 98888-7777', vehicles: [{ plate: 'QWE1R23', brand: 'Fiat', model: 'Uno' }] }, T);
  assert.equal(c.status, 201, JSON.stringify(c.data)); waCust = c.data;
  const eq = (await api('GET', `/customers/${c.data.id}`, null, T)).data;
  const eqId = (eq.equipment || eq.vehicles || [])[0].id;
  const o = await api('POST', '/orders', { customer_id: c.data.id, equipment_id: eqId, items: [{ kind: 'servico', description: 'Solda', qty: 1, unit_price: 300 }] }, T);
  assert.equal(o.status, 201);
  await zap('5511977776666', 'status da placa QWE1R23');
  const other = lastTo('5511977776666').join('\n');
  assert.ok(!/OS nº/.test(other) && /Por segurança/.test(other), other);
  await zap('5519988887777', 'como está meu carro QWE-1R23?');
  assert.match(lastTo('5519988887777').join('\n'), new RegExp(`OS nº ${o.data.number}`));
  await zap('551988887777', 'status QWE1R23'); // cadastro antigo sem o 9: mesmo celular
  assert.match(lastTo('551988887777').join('\n'), /OS nº/);
});
let waReq;
await check('WhatsApp: pedido de horário vira pré-OS; aprovação abre OS, agenda e avisa o cliente', async () => {
  const p = '5511955554444';
  for (const t of ['2', 'BRA2E19', 'troca de óleo', '1', 'José Teste', '1']) assert.equal(await zap(p, t), 200);
  assert.match(lastTo(p).at(-1), /pedido nº/i);
  const list = await api('GET', '/whatsapp/requests', null, T);
  waReq = list.data.find((x) => x.contact_phone === `+${p}`);
  assert.ok(waReq?.requested_start, JSON.stringify(list.data));
  assert.equal((await api('GET', '/requests', null, T)).data.find((x) => x.id === waReq.id)?.status, 'nova');
  assert.equal((await api('POST', `/whatsapp/requests/${waReq.id}/approve`, {}, T2)).status, 404); // outra empresa
  const ap = await api('POST', `/whatsapp/requests/${waReq.id}/approve`, { starts_at: waReq.requested_start, notify: true }, T);
  assert.equal(ap.status, 201, JSON.stringify(ap.data)); assert.ok(ap.data.schedule_id); assert.equal(ap.data.notified.sent, true);
  assert.match(lastTo(p).at(-1), new RegExp(`OS nº ${ap.data.number}`));
  assert.equal((await api('POST', `/whatsapp/requests/${waReq.id}/approve`, {}, T)).status, 400); // já tratado
  const od = await api('GET', `/orders/${ap.data.order_id}`, null, T);
  assert.equal(od.data.equipment_plate, 'BRA2E19');
});
await check('WhatsApp: outra empresa não vê a conversa; resposta da equipe respeita a janela de 24 h', async () => {
  const convs = await api('GET', '/whatsapp/conversations', null, T);
  const cv = convs.data.find((x) => x.phone === '5511955554444');
  assert.equal((await api('GET', `/whatsapp/conversations/${cv.id}`, null, T2)).status, 404);
  assert.equal((await api('GET', '/whatsapp/conversations', null, T2)).data.length, 0);
  const ok = await api('POST', `/whatsapp/conversations/${cv.id}/reply`, { text: 'Olá, aqui é a equipe.' }, T);
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  await pool.query("update wa_conversations set last_inbound_at = now() - interval '25 hours' where id = $1", [cv.id]);
  assert.equal((await api('POST', `/whatsapp/conversations/${cv.id}/reply`, { text: 'oi' }, T)).status, 400);
  assert.equal((await api('DELETE', `/whatsapp/conversations/${cv.id}`, null, T)).status, 400); // conversa real não se apaga
});
await check('WhatsApp: teste do agente não envia nada e não captura conversa real', async () => {
  const before = calls.wa.length;
  const sim = await api('POST', '/whatsapp/simulate', { phone: '11933332222', text: 'oi' }, T);
  assert.equal(sim.status, 200); assert.equal(calls.wa.length, before);
  assert.equal((await api('POST', '/whatsapp/simulate', { phone: '11955554444', text: 'oi' }, T)).status, 400); // telefone com conversa real
  await zap('5511933332222', 'oi'); // cliente real escreve do mesmo número
  const { rows } = await pool.query("select simulated from wa_conversations where phone = '5511933332222'");
  assert.deepEqual(rows.map((r) => r.simulated), [false]);
  assert.equal(calls.wa.length, before + 1);
});
await check('WhatsApp: muitas mensagens seguidas passam para a equipe', async () => {
  const p = '5511944443333';
  for (let i = 0; i < 22; i += 1) await zap(p, `oi ${i}`);
  const { rows: [c] } = await pool.query('select mode from wa_conversations where phone = $1', [p]);
  assert.equal(c.mode, 'humano');
  assert.ok(lastTo(p).length <= 21);
});

// ---------- conferência do extrato com as OS ----------
await check('extrato: crédito com nome do cliente vira pagamento da OS; desfazer devolve o saldo', async () => {
  const accs = (await api('GET', '/finance/accounts', null, T)).data;
  const bank = accs.find((a) => a.kind === 'banco') || accs[0];
  const o = (await api('GET', '/orders?limit=50', null, T)).data;
  const list = o.items || o;
  const os = list.find((x) => x.customer_name === 'Dono do Carro');
  const before = (await api('GET', `/orders/${os.id}`, null, T)).data.balance;
  const csv = `Data;Histórico;Valor\n07/10/2026;PIX RECEBIDO DONO DO CARRO;${before.toFixed(2).replace('.', ',')}\n08/10/2026;TARIFA;-9,90\n`;
  const st = await api('POST', '/finance/statements', { account_id: bank.id, filename: 'x.csv', content: csv }, T);
  assert.equal(st.status, 201, JSON.stringify(st.data));
  const det = (await api('GET', `/finance/statements/${st.data.id}`, null, T)).data;
  const line = det.lines.find((l) => l.amount > 0);
  assert.equal(line.order_candidates[0]?.order_id, os.id, JSON.stringify(line.order_candidates));
  const chk = (await api('GET', `/finance/statements/${st.data.id}/orders-check`, null, T)).data;
  assert.equal(chk.suggested.length, 1);
  assert.equal((await api('POST', `/finance/lines/${line.id}/receive-order`, { order_id: os.id, method: 'dinheiro' }, T)).status, 400);
  assert.equal((await api('POST', `/finance/lines/${line.id}/receive-order`, { order_id: os.id, method: 'pix' }, T2)).status, 404);
  const rc = await api('POST', `/finance/lines/${line.id}/receive-order`, { order_id: os.id, method: 'pix' }, T);
  assert.equal(rc.status, 201, JSON.stringify(rc.data));
  assert.equal((await api('GET', `/orders/${os.id}`, null, T)).data.balance, 0);
  assert.equal((await api('GET', `/finance/statements/${st.data.id}/orders-check`, null, T)).data.linked.length, 1);
  assert.equal((await api('POST', `/finance/lines/${line.id}/undo`, {}, T)).status, 200);
  assert.equal((await api('GET', `/orders/${os.id}`, null, T)).data.balance, before);
});

// ---------- segurança de usuários ----------
await check('administrador não altera senha nem e-mail do proprietário', async () => {
  const adm = await api('POST', '/users', { name: 'Admin', email: 'admin@int.dev', password: 'Oficina2026xy', role: 'admin' }, T);
  assert.equal(adm.status, 201, JSON.stringify(adm.data));
  const lg = await api('POST', '/auth/login', { email: 'admin@int.dev', password: 'Oficina2026xy' });
  const TA = lg.data.token;
  const owner = (await api('GET', '/users', null, T)).data.find((u) => u.role === 'owner');
  const r = await api('PUT', `/users/${owner.id}`, { name: owner.name, email: 'atacante@x.dev', role: 'owner', password: 'Invasor2026xy' }, TA);
  assert.equal(r.status, 403);
  assert.equal((await api('POST', '/auth/login', { email: 'dono@int.dev', password: 'Oficina2026xy' })).status, 200);
  assert.equal((await api('POST', '/users', { name: 'Admin2', email: 'admin2@int.dev', password: 'Oficina2026xy', role: 'admin' }, TA)).status, 403);
});

// ---------- financeiro: caixas fechados, alertas, lembretes ----------
await check('financeiro: caixas fechados com detalhe, alertas de contas a pagar/receber e lembrete repetido', async () => {
  const d = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const open = await api('GET', '/cash/session', null, T);
  if (!open.data) await api('POST', '/cash/session/open', { opening_amount: 50 }, T);
  await api('POST', '/cash/transactions', { type: 'entrada', category: 'Suprimento', description: 'Reforço', amount: 20, method: 'dinheiro', paid: true }, T);
  const cl = await api('POST', '/cash/session/close', { closing_amount: 1 }, T);
  assert.equal(cl.status, 200, JSON.stringify(cl.data));
  const closed = (await api('GET', '/cash/sessions/closed', null, T)).data;
  assert.ok(closed.length >= 1 && closed[0].closed_at);
  assert.ok((await api('GET', '/cash/sessions/closed?diff=1', null, T)).data.some((x) => x.id === closed[0].id));
  const det = (await api('GET', `/cash/sessions/${closed[0].id}`, null, T)).data;
  assert.ok(det.movements.some((m) => m.description === 'Reforço'));
  assert.equal((await api('GET', `/cash/sessions/${closed[0].id}`, null, T2)).status, 404);
  // alertas: conta a pagar vencida e vencendo
  await api('POST', '/cash/transactions', { type: 'saida', category: 'Aluguel', description: 'Aluguel atrasado', amount: 900, due_date: d(-2), paid: false }, T);
  await api('POST', '/cash/transactions', { type: 'saida', category: 'Energia elétrica', description: 'Energia', amount: 350, due_date: d(1), paid: false }, T);
  const n = (await api('GET', '/notifications', null, T)).data.items;
  assert.ok(n.some((x) => x.id === 'payables_overdue'), JSON.stringify(n.map((x) => x.id)));
  assert.ok(n.some((x) => x.id === 'payables_due'));
  const al = (await api('GET', '/reminders/alerts', null, T)).data;
  assert.ok(al.pagar_vencidas >= 1 && al.pagar_vencendo >= 1);
  // lembrete mensal: concluir cria o próximo
  const rm = await api('POST', '/reminders', { title: 'Pagar contador', due_date: d(0), repeat: 'mensal', amount: 200 }, T);
  assert.equal(rm.status, 201, JSON.stringify(rm.data));
  assert.ok((await api('GET', '/notifications', null, T)).data.items.some((x) => x.id === 'reminders_due'));
  const done = await api('POST', `/reminders/${rm.data.id}/done`, {}, T);
  assert.ok(done.data.next?.due_date > d(0));
  assert.equal((await api('POST', `/reminders/${rm.data.id}/done`, {}, T2)).status, 404);
  assert.equal((await api('GET', '/reminders', null, T2)).data.length, 0, 'outra empresa não vê');
});

// ---------- assistente ----------
await check('assistente: consulta na hora, grava só depois de confirmar, respeita a liberação por usuário', async () => {
  const prof = (await api('GET', '/agent/profile', null, T)).data;
  assert.ok(prof.enabled && prof.actions.some((a) => a.key === 'lancar_conta'));
  const sum = (await api('POST', '/agent/ask', { text: 'resumo financeiro' }, T)).data;
  assert.equal(sum.kind, 'answer'); assert.match(sum.text, /A pagar/);
  const pay = (await api('POST', '/agent/ask', { text: 'contas a pagar vencidas' }, T)).data;
  assert.ok(pay.items?.some((x) => x.title === 'Aluguel atrasado'), JSON.stringify(pay));
  const before = (await api('GET', '/cash/transactions?status=pendente&search=Internet%20fibra', null, T)).data.items.length;
  const ask = (await api('POST', '/agent/ask', { text: 'lançar conta a pagar de 129,90 da internet fibra para dia 28' }, T)).data;
  assert.equal(ask.kind, 'confirm', JSON.stringify(ask));
  assert.equal(ask.params.amount, 129.9);
  assert.equal(ask.params.category, 'Água/Internet/Telefone');
  assert.equal((await api('GET', '/cash/transactions?status=pendente&search=Internet%20fibra', null, T)).data.items.length, before, 'nada gravado antes de confirmar');
  const ok = await api('POST', '/agent/confirm', { intent: ask.intent, params: ask.params }, T);
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal((await api('GET', '/cash/transactions?status=pendente&search=Internet%20fibra', null, T)).data.items.length, before + 1);
  // dar baixa
  const b = (await api('POST', '/agent/ask', { text: 'paguei a conta da internet fibra' }, T)).data;
  assert.equal(b.kind, 'confirm', JSON.stringify(b));
  assert.equal((await api('POST', '/agent/confirm', { intent: 'baixar_conta', params: b.params }, T)).status, 200);
  assert.equal((await api('POST', '/agent/confirm', { intent: 'baixar_conta', params: b.params }, T)).status, 400, 'não baixa duas vezes');
  // lembrete
  const l = (await api('POST', '/agent/ask', { text: 'me lembre de pagar o IPTU dia 20' }, T)).data;
  assert.equal(l.kind, 'confirm');
  assert.equal((await api('POST', '/agent/confirm', { intent: 'lembrete', params: l.params }, T)).status, 200);
  assert.ok((await api('GET', '/reminders', null, T)).data.some((x) => /IPTU/.test(x.title) && x.source === 'assistente'));
  // confirmação com dados forjados é validada de novo
  assert.equal((await api('POST', '/agent/confirm', { intent: 'lancar_conta', params: { type: 'saida', amount: -5, due_date: '2026-10-10', description: 'x', category: 'Aluguel' } }, T)).status, 400);
  // outra empresa não dá baixa em conta alheia
  const other = (await api('GET', '/cash/transactions?status=pendente', null, T)).data.items[0];
  assert.equal((await api('POST', '/agent/confirm', { intent: 'baixar_conta', params: { transaction_id: other.id } }, T2)).status, 400);
  // perfil por usuário: atendente só consulta OS; liberar e bloquear pelo administrador
  const at = await api('POST', '/users', { name: 'Atendente', email: 'atend@int.dev', password: 'Oficina2026xy', role: 'attendant' }, T);
  assert.equal(at.status, 201, JSON.stringify(at.data));
  const TA = (await api('POST', '/auth/login', { email: 'atend@int.dev', password: 'Oficina2026xy' })).data.token;
  assert.equal((await api('POST', '/agent/ask', { text: 'resumo financeiro' }, TA)).data.kind, 'denied');
  const ag = (await api('GET', `/users/${at.data.id}/agent`, null, T)).data;
  assert.equal(ag.enabled, true); assert.equal(ag.actions.consultar_financeiro, false);
  assert.equal(ag.catalog.find((c) => c.key === 'lancar_conta').blocked, false, 'atendente tem a permissão "cash" no perfil padrão');
  await api('PUT', `/users/${at.data.id}/agent`, { actions: { consultar_financeiro: true } }, T);
  assert.equal((await api('POST', '/agent/ask', { text: 'resumo financeiro' }, TA)).data.kind, 'answer');
  assert.equal((await api('POST', '/agent/confirm', { intent: 'lancar_conta', params: ask.params }, TA)).status, 403, 'lançar continua bloqueado');
  await api('PUT', `/users/${at.data.id}/agent`, { enabled: false }, T);
  assert.equal((await api('POST', '/agent/ask', { text: 'resumo financeiro' }, TA)).status, 403);
  assert.equal((await api('PUT', `/users/${at.data.id}/agent`, { enabled: true }, TA)).status, 403, 'atendente não muda o próprio perfil');
  assert.equal((await api('GET', `/users/${at.data.id}/agent`, null, T2)).status, 404);
  const logs = (await api('GET', '/agent/log?all=1', null, T)).data;
  assert.ok(logs.some((x) => x.outcome === 'confirmado') && logs.some((x) => x.outcome === 'negado'));
  const audits = await pool.query("select summary from audit_log where summary like 'Assistente de Atendente%'");
  assert.ok(audits.rows.length >= 2);
});

// ---------- importação de planilha ----------
await check('importar clientes: prévia não grava, linha com erro não derruba as outras, atualiza e desfaz', async () => {
  const rows = [
    { Nome: 'Importado Um', 'CPF/CNPJ': '529.982.247-25', Telefone: '(19) 98888-1111', Placa: 'IMP1A23', Marca: 'Fiat', Modelo: 'Uno' },
    { Nome: 'Importado Dois', Telefone: '(19) 97777-2222', Cidade: 'Campinas', UF: 'sp' },
    { Nome: 'Erro CPF', 'CPF/CNPJ': '123' },
    { Nome: '' },
  ];
  const before = (await pool.query("select count(*)::int n from customers where name like 'Importado%'")).rows[0].n;
  const pv = await api('POST', '/data/clientes/preview', { rows, filename: 'clientes.xlsx' }, T);
  assert.equal(pv.status, 200, JSON.stringify(pv.data));
  assert.equal(pv.data.created, 2); assert.equal(pv.data.errors, 2);
  assert.equal((await pool.query("select count(*)::int n from customers where name like 'Importado%'")).rows[0].n, before, 'prévia não grava');
  const im = await api('POST', '/data/clientes/import', { rows, filename: 'clientes.xlsx' }, T);
  assert.equal(im.status, 201, JSON.stringify(im.data));
  assert.equal(im.data.created, 2);
  assert.ok(im.data.rows.every((x) => x.status === 'erro'));
  const { rows: [c1] } = await pool.query("select c.*, e.plate from customers c join equipment e on e.customer_id = c.id where c.name = 'Importado Um'");
  assert.equal(c1.document, '529.982.247-25'); assert.equal(c1.plate, 'IMP1A23');
  // de novo: acha pelo CPF e atualiza o que mudou
  const again = await api('POST', '/data/clientes/import', { rows: [{ Nome: 'Importado Um', CPF: '52998224725', Email: 'um@x.dev' }] }, T);
  assert.equal(again.data.updated, 1); assert.equal(again.data.created, 0);
  // sem permissão
  const TA = (await api('POST', '/auth/login', { email: 'atend@int.dev', password: 'Oficina2026xy' })).data.token;
  assert.equal((await api('POST', '/data/clientes/import', { rows }, TA)).status, 403);
  // desfazer: remove o que foi criado
  const un = await api('POST', `/data/imports/${im.data.batch_id}/undo`, {}, T);
  assert.equal(un.data.customers, 2, JSON.stringify(un.data));
  assert.equal((await api('POST', `/data/imports/${im.data.batch_id}/undo`, {}, T)).status, 400);
  assert.equal((await api('POST', `/data/imports/${im.data.batch_id}/undo`, {}, T2)).status, 404);
});
await check('importar OS antigas: cria cliente, veículo e OS com nº antigo, não duplica e não mexe no financeiro', async () => {
  const rows = [
    { 'Número antigo': '1001', Data: '15/03/2025', Cliente: 'Cliente OS Antiga', Telefone: '(19) 96666-3333', Placa: 'OLD2B34', Problema: 'Barulho no freio', 'Serviço executado': 'Troca de pastilhas', Valor: '1.250,50', Situação: 'Entregue', 'Data entrega': '20/03/2025' },
    { 'Número antigo': '1002', Data: '2025-04-01', Cliente: 'Cliente OS Antiga', Telefone: '19966663333', Problema: 'Revisão', Valor: '300', Situação: 'aberta' },
    { 'Número antigo': '1003', Data: '31/02/2025', Cliente: 'Data ruim' },
  ];
  const txBefore = (await pool.query('select count(*)::int n from transactions')).rows[0].n;
  const im = await api('POST', '/data/os/import', { rows, filename: 'os.csv' }, T);
  assert.equal(im.status, 201, JSON.stringify(im.data));
  assert.equal(im.data.created, 2); assert.equal(im.data.errors, 1);
  const { rows: os } = await pool.query("select o.*, c.name from orders o join customers c on c.id = o.customer_id where o.legacy_number in ('1001','1002') order by legacy_number");
  assert.equal(os.length, 2);
  assert.equal(os[0].customer_id, os[1].customer_id, 'mesmo cliente pelo telefone');
  assert.equal(os[0].status, 'entregue'); assert.equal(Number(os[0].total), 1250.5);
  assert.equal(os[1].status, 'aberta');
  assert.equal((await pool.query('select count(*)::int n from transactions')).rows[0].n, txBefore, 'sem lançamentos');
  const again = await api('POST', '/data/os/import', { rows: rows.slice(0, 1) }, T);
  assert.equal(again.data.skipped, 1, 'não duplica a OS antiga');
  const un = await api('POST', `/data/imports/${im.data.batch_id}/undo`, {}, T);
  assert.equal(un.data.orders, 2); assert.equal(un.data.customers, 1);
});

await check('importar de outro sistema: código antigo, veículos, OS com itens e número antigo mantido', async () => {
  const cli = [
    { id_cliente: '900', nome: 'Cliente Legado', cpf: '390.533.447-05', celular: '(19) 95555-1000', pessoa: '1', obs: '', rg: '12.345', datanascimento: '01/02/1980' },
    { id_cliente: '901', nome: 'Cliente Legado', cpf: '39053344705', celular: '(19) 95555-1000', pessoa: '1' },
  ];
  const c = await api('POST', '/data/clientes/import', { rows: cli, update: false }, T2);
  assert.equal(c.status, 201, JSON.stringify(c.data)); assert.equal(c.data.created, 1);
  const { rows: [cc] } = await pool.query("select * from customers where name = 'Cliente Legado'");
  assert.equal(cc.legacy_code, '900,901'); assert.equal(cc.document, '390.533.447-05'); assert.match(cc.notes, /RG: 12.345/);
  const v = await api('POST', '/data/veiculos/import', { rows: [{ id_veiculo: '1', Placa: 'LEG1A00', Marca: 'FIAT', Modelo: 'UNO', ano: '14|15', id_cliente: '901' }, { Placa: 'LEG2B00', id_cliente: '999' }] }, T2);
  assert.equal(v.data.created, 1); assert.equal(v.data.errors, 1);
  const { rows: [eq] } = await pool.query("select * from equipment where plate = 'LEG1A00'");
  assert.equal(eq.customer_id, cc.id); assert.equal(eq.year, '2014/2015');
  const base = { 'Ordem de servico': '7001', 'Codigo Cliente': '900', Cliente: 'Cliente Legado', Placa: 'LEG1A00', 'Data Inclusao': '02/01/2025', Saida: '03/01/2025', Situacao: 'VEICULO ENTREGUE PARA O CLIENTE', Km: '1000' };
  const os = [
    { ...base, 'Descricao Produtos Servicos': 'FILTRO DE OLEO', Quantidade: '1', 'Valor Unitario': '50', Aprovado: 'Aprovado' },
    { ...base, 'Descricao Produtos Servicos': 'MAO DE OBRA', Quantidade: '1', 'Valor Unitario': '100', Aprovado: 'Aprovado' },
    { ...base, 'Descricao Produtos Servicos': 'PASTILHA', Quantidade: '1', 'Valor Unitario': '200', Aprovado: 'Negado' },
    { 'Ordem de servico': '7002', Cliente: '901 - CLIENTE LEGADO', 'Data Inclusao': '05/01/2025', Situacao: 'SERVICO SENDO FEITO PELA OFICINA', Total: 'R$ 1.234,50' },
  ];
  const o = await api('POST', '/data/os/import', { rows: os }, T2);
  assert.equal(o.status, 201, JSON.stringify(o.data)); assert.equal(o.data.created, 2);
  const { rows: [o1] } = await pool.query("select * from orders where legacy_number = '7001'");
  assert.equal(o1.number, 7001, 'mantém o número antigo'); assert.equal(Number(o1.total), 150); assert.equal(o1.status, 'entregue');
  assert.match(o1.internal_notes, /PASTILHA/); assert.equal(o1.equipment_id, eq.id);
  const { rows: items } = await pool.query('select kind from order_items where order_id = $1 order by position', [o1.id]);
  assert.deepEqual(items.map((x) => x.kind), ['material', 'servico']);
  const { rows: [o2] } = await pool.query("select * from orders where legacy_number = '7002'");
  assert.equal(o2.status, 'em_execucao'); assert.equal(Number(o2.total), 1234.5); assert.equal(o2.customer_id, cc.id);
});
await check('vários proprietários: só proprietário promove, a empresa nunca fica sem proprietário ativo', async () => {
  const users = (await api('GET', '/users', null, T)).data;
  const me = users.find((u) => u.email === 'dono@int.dev');
  const adm = users.find((u) => u.email === 'admin@int.dev');
  const TADM = (await api('POST', '/auth/login', { email: 'admin@int.dev', password: 'Oficina2026xy' })).data.token;
  const body = (u, role, extra = {}) => ({ name: u.name, email: u.email, role, active: true, ...extra });
  // administrador não cria nem promove proprietário
  assert.equal((await api('POST', '/users', { name: 'Sócio X', email: 'socio-x@int.dev', password: 'Oficina2026xy', role: 'owner' }, TADM)).status, 403);
  // o único proprietário não pode deixar de ser proprietário
  assert.equal((await api('PUT', `/users/${me.id}`, body(me, 'admin'), T)).status, 400);
  // proprietário cria um sócio proprietário
  const s1 = await api('POST', '/users', { name: 'Sócia', email: 'socia@int.dev', password: 'Oficina2026xy', role: 'owner' }, T);
  assert.equal(s1.status, 201, JSON.stringify(s1.data));
  const TS = (await api('POST', '/auth/login', { email: 'socia@int.dev', password: 'Oficina2026xy' })).data.token;
  assert.equal((await api('GET', '/users', null, TS)).status, 200, 'sócia tem acesso total');
  // e promove o administrador a proprietário
  assert.equal((await api('PUT', `/users/${adm.id}`, body(adm, 'owner'), T)).status, 200);
  assert.equal((await api('PUT', `/users/${adm.id}`, body(adm, 'admin'), TS)).status, 200, 'outro proprietário rebaixa');
  // administrador não mexe em proprietário
  assert.equal((await api('PUT', `/users/${s1.data.id}`, body(s1.data, 'manager'), TADM)).status, 401, 'token antigo do admin caiu ao mudar o perfil');
  const TADM2 = (await api('POST', '/auth/login', { email: 'admin@int.dev', password: 'Oficina2026xy' })).data.token;
  assert.equal((await api('PUT', `/users/${s1.data.id}`, body(s1.data, 'manager'), TADM2)).status, 403);
  assert.equal((await api('DELETE', `/users/${s1.data.id}`, null, TADM2)).status, 403);
  // com dois proprietários, o primeiro pode deixar de ser — e então a sócia vira a única e não pode sair
  assert.equal((await api('PUT', `/users/${me.id}`, body(me, 'admin'), T)).status, 200);
  assert.equal((await api('PUT', `/users/${s1.data.id}`, body(s1.data, 'owner', { active: false }), TS)).status, 400);
  const TME = (await api('POST', '/auth/login', { email: 'dono@int.dev', password: 'Oficina2026xy' })).data.token;
  assert.equal((await api('DELETE', `/users/${s1.data.id}`, null, TME)).status, 403, 'admin não remove proprietário');
  // devolve: a sócia promove o dono de novo e remove a si? não — remove pelo dono
  assert.equal((await api('PUT', `/users/${me.id}`, body(me, 'owner'), TS)).status, 200);
  const T3 = (await api('POST', '/auth/login', { email: 'dono@int.dev', password: 'Oficina2026xy' })).data.token;
  assert.equal((await api('DELETE', `/users/${s1.data.id}`, null, T3)).status, 204);
  const audits = await pool.query("select summary from audit_log where summary like '%Proprietário%'");
  assert.ok(audits.rows.length >= 3);
});

console.log(`\n${passed} verificações OK, ${fails.length} falhas`);
server.close(); fake.close(); await pool.end();
if (fails.length) { fails.forEach((f) => console.log(' -', f)); process.exit(1); }
