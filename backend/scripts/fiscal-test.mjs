// Teste dos emitentes fiscais e dos emissores de nota (Focus, NFE.io, PlugNotas, Nuvem Fiscal, eNotas, API própria,
// registro manual) contra emissores falsos locais.
// Uso: DATABASE_URL=postgres://.../torven_fiscal_test node scripts/fiscal-test.mjs   (APAGA o banco informado)
import assert from 'node:assert/strict';
import http from 'node:http';
import forge from 'node-forge';

if (!/test/.test(process.env.DATABASE_URL || '')) { console.error('Use um banco de teste (nome contendo "test")'); process.exit(1); }

// ---------- certificado A1 de teste ----------
function makePfx(cnpj, password, days = 365) {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey; cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 86400000); cert.validity.notAfter = new Date(Date.now() + days * 86400000);
  const attrs = [{ name: 'commonName', value: `OFICINA TESTE LTDA:${cnpj}` }, { name: 'countryName', value: 'BR' }];
  cert.setSubject(attrs); cert.setIssuer([{ name: 'commonName', value: 'AC TESTE' }]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, { algorithm: '3des' });
  return Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary').toString('base64');
}
const CNPJ = '12345678000195';
const CNPJ2 = '11222333000181';
const PFX = makePfx(CNPJ, 'senha123');

// ---------- emissores falsos ----------
const seen = { nfeioCert: 0, plugCert: 0, focus: [], nuvem: [], enotas: 0, auth: [] };
const nfeio = new Map();
const fake = http.createServer((req, res) => {
  const chunks = []; req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    const json = () => { try { return JSON.parse(body); } catch { return {}; } };
    const send = (st, obj) => { res.writeHead(st, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    seen.auth.push(req.headers.authorization || req.headers['x-api-key'] || '');
    // Focus
    if (p.startsWith('/focus/v2/')) {
      if (req.headers.authorization !== `Basic ${Buffer.from('focus-tok:').toString('base64')}`) return send(401, { mensagem: 'token inválido' });
      if (req.method === 'POST') { seen.focus.push(json()); return send(202, { status: 'processando_autorizacao', ref: u.searchParams.get('ref') }); }
      return send(200, { status: 'autorizado', numero: '900', codigo_verificacao: 'XYZ' });
    }
    // NFE.io
    if (p.startsWith('/nfeio/')) {
      if (req.headers.authorization !== 'nfeio-key') return send(401, { message: 'Unauthorized' });
      if (p === '/nfeio/companies' && req.method === 'POST') return send(201, { companies: { id: 'co1' }, id: 'co1' });
      if (p === '/nfeio/companies' && req.method === 'GET') return send(200, { companies: [] });
      if (p === '/nfeio/companies/co1/municipaltaxes') return send(201, {});
      if (p === '/nfeio/companies/co1/certificates') { if (/multipart\/form-data/.test(req.headers['content-type'] || '') && body.includes('senha123')) seen.nfeioCert += 1; return send(200, {}); }
      if (p === '/nfeio/companies/co1/serviceinvoices' && req.method === 'POST') { const id = `si${nfeio.size + 1}`; nfeio.set(id, { st: 'WaitingSend', body: json() }); return send(202, { id, flowStatus: 'WaitingSend' }); }
      let m = p.match(/^\/nfeio\/companies\/co1\/serviceinvoices\/(si\d+)(\/pdf|\/xml)?$/);
      if (m) {
        const inv = nfeio.get(m[1]); if (!inv) return send(404, { message: 'not found' });
        if (m[2] === '/pdf') { res.writeHead(200, { 'content-type': 'application/pdf' }); return res.end('%PDF-1.4 nota falsa'); }
        if (req.method === 'DELETE') { inv.st = 'Cancelled'; return send(200, { id: m[1], flowStatus: 'WaitingSendCancel' }); }
        if (inv.st === 'WaitingSend') { inv.st = 'Issued'; return send(200, { id: m[1], flowStatus: 'WaitingSend' }); }
        return send(200, { id: m[1], flowStatus: inv.st, number: 123, checkCode: 'ABC9' });
      }
      return send(404, {});
    }
    // PlugNotas
    if (p.startsWith('/plug/')) {
      if (req.headers['x-api-key'] !== 'plug-key') return send(401, { error: { message: 'Token inválido' } });
      if (p === '/plug/certificado') { if (body.includes('senha123')) seen.plugCert += 1; return send(201, { data: { id: 'cert1' } }); }
      if (p === '/plug/empresa') return send(201, { message: 'ok' });
      if (p === '/plug/nfse' && req.method === 'POST') { const b = json(); if (!Array.isArray(b)) return send(400, { error: { message: 'esperava lista' } }); return send(200, { documents: [{ id: 'pn1', idIntegracao: b[0].idIntegracao }], protocol: 'prot1' }); }
      if (p === '/plug/nfse/pn1') return send(200, [{ id: 'pn1', situacao: 'CONCLUIDO', numeroNfse: 77, codigoVerificacao: 'PLG' }]);
      return send(404, {});
    }
    // Nuvem Fiscal
    if (p === '/nuvem/oauth') { const f = new URLSearchParams(body); return f.get('client_secret') === 'nv-secret' ? send(200, { access_token: 'nv-access', expires_in: 3600 }) : send(401, { error: 'invalid_client' }); }
    if (p.startsWith('/nuvem/')) {
      if (req.headers.authorization !== 'Bearer nv-access') return send(401, { error: { message: 'token' } });
      if (p === '/nuvem/nfe' && req.method === 'POST') { const b = json(); seen.nuvem.push(b); return send(200, { id: `nv${seen.nuvem.length}`, status: 'autorizado', numero: b.infNFe.ide.nNF, chave: '3526'.padEnd(44, '1') }); }
      if (/^\/nuvem\/empresas\/\d+$/.test(p) && req.method === 'GET') return send(404, { error: { message: 'não encontrada' } });
      return send(200, {});
    }
    // eNotas
    if (p.startsWith('/enotas/')) {
      if (req.headers.authorization !== 'Basic en-key') return send(401, [{ codigo: '401', mensagem: 'Chave inválida' }]);
      if (p === '/enotas/v1/empresas' && req.method === 'POST') return send(200, { empresaId: 'en1' });
      if (p === '/enotas/v1/empresas/en1/certificadoDigital') return send(200, {});
      if (p === '/enotas/v1/empresas/en1/nfes' && req.method === 'POST') { seen.enotas += 1; return send(200, { nfeId: 'nf1' }); }
      if (p === '/enotas/v1/empresas/en1/nfes/nf1') return send(200, { status: 'Negada', motivoStatus: 'Código de serviço inexistente no município' });
      return send(404, {});
    }
    send(404, {});
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));
const FAKE = `http://127.0.0.1:${fake.address().port}`;
Object.assign(process.env, {
  FISCAL_URL_FOCUS: `${FAKE}/focus`, FISCAL_URL_NFEIO: `${FAKE}/nfeio`, FISCAL_URL_PLUGNOTAS: `${FAKE}/plug`,
  FISCAL_URL_NUVEMFISCAL: `${FAKE}/nuvem`, FISCAL_URL_NUVEMFISCAL_AUTH: `${FAKE}/nuvem/oauth`, FISCAL_URL_ENOTAS: `${FAKE}/enotas`,
});

const { pool } = await import('../src/db.js');
await pool.query('drop schema public cascade; create schema public;');
const { migrate } = await import('../src/migrate.js');
await migrate();
const { createApp } = await import('../src/app.js');
const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

let passed = 0; const fails = [];
const check = async (name, fn) => { try { await fn(); passed++; console.log('  ok ', name); } catch (e) { fails.push(name); console.log('  FALHOU', name, '—', e.message); } };
async function api(method, path, body, token, raw = false) {
  const r = await fetch(`${base}/api${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (raw) return { status: r.status, type: r.headers.get('content-type'), text: await r.text() };
  return { status: r.status, data: await r.json().catch(() => null) };
}

const T = (await api('POST', '/auth/register', { companyName: 'Oficina Fiscal', name: 'Dono', email: 'dono@fis.dev', password: 'Oficina2026xy', demo: false })).data.token;
const T2 = (await api('POST', '/auth/register', { companyName: 'Outra', name: 'Outro', email: 'outro@fis.dev', password: 'Oficina2026xy', demo: false })).data.token;

const addr = { cep: '13010-000', street: 'Rua A', number: '10', district: 'Centro', city: 'Campinas', uf: 'SP', city_code: '3509502' };
const emitterBody = (over = {}) => ({ name: 'Matriz', cnpj: CNPJ, razao_social: 'OFICINA TESTE LTDA', im: '12345', ie: '123456789', regime: 'simples',
  email: 'fiscal@oficina.dev', phone: '19999990000', ...addr, provider: 'nfeio', environment: 'homologacao', docs: { nfse: true, nfe: true }, settings: { issRate: 3 }, ...over });
const customer = (await api('POST', '/customers', { name: 'Cliente Nota', document: '52998224725', email: 'cli@x.dev', ...addr }, T)).data;
const newOrder = async (items) => (await api('POST', '/orders', { customer_id: customer.id, items }, T)).data;
const svc = [{ kind: 'servico', description: 'Solda no chassi', qty: 1, unit_price: 250 }];
const customer2 = (await api('POST', '/customers', { name: 'Cliente Outra', document: '52998224725', ...addr }, T2)).data;

await check('lista os 7 emissores com instruções', async () => {
  const r = await api('GET', '/fiscal/emitters/providers', null, T);
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.map((p) => p.id), ['focus', 'nfeio', 'plugnotas', 'nuvemfiscal', 'enotas', 'generico', 'manual']);
  assert.ok(r.data.every((p) => p.help));
});
await check('CNPJ inválido é recusado', async () => {
  assert.equal((await api('POST', '/fiscal/emitters', emitterBody({ cnpj: '12345678000100' }), T)).status, 400);
});
let em1;
await check('cria emitente: chave cifrada, nunca devolvida; o primeiro vira padrão', async () => {
  const r = await api('POST', '/fiscal/emitters', emitterBody({ secrets: { api_key: 'nfeio-key' } }), T);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.ok(!JSON.stringify(r.data).includes('nfeio-key')); assert.equal(r.data.secrets.api_key.set, true); assert.equal(r.data.is_default, true);
  em1 = r.data;
  const row = (await pool.query('select secret_enc from fiscal_emitters where id = $1', [em1.id])).rows[0];
  assert.ok(row.secret_enc.startsWith('v1.') && !row.secret_enc.includes('nfeio-key'));
});
await check('certificado com senha errada é recusado', async () => {
  const r = await api('POST', `/fiscal/emitters/${em1.id}/certificate`, { file_base64: PFX, password: 'errada' }, T);
  assert.equal(r.status, 400); assert.match(r.data.error, /Senha/);
});
await check('certificado de outro CNPJ é recusado', async () => {
  const r = await api('POST', `/fiscal/emitters/${em1.id}/certificate`, { file_base64: makePfx(CNPJ2, 'x1'), password: 'x1' }, T);
  assert.equal(r.status, 400); assert.match(r.data.error, /diferente do emitente/);
});
await check('certificado vencido é recusado', async () => {
  const r = await api('POST', `/fiscal/emitters/${em1.id}/certificate`, { file_base64: makePfx(CNPJ, 'x1', -2), password: 'x1' }, T);
  assert.equal(r.status, 400); assert.match(r.data.error, /vencido/);
});
await check('certificado certo: mostra titular, CNPJ e validade; arquivo guardado cifrado', async () => {
  const r = await api('POST', `/fiscal/emitters/${em1.id}/certificate`, { file_base64: PFX, password: 'senha123' }, T);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.certificate.cnpj, CNPJ); assert.ok(r.data.certificate.days_left >= 363); assert.equal(r.data.certificate.expiring, false);
  assert.ok(!JSON.stringify(r.data).includes('senha123') && !JSON.stringify(r.data).includes(PFX.slice(0, 40)));
  const row = (await pool.query('select cert_enc from fiscal_emitters where id = $1', [em1.id])).rows[0];
  assert.ok(row.cert_enc.startsWith('v1.') && !row.cert_enc.includes('senha123'));
});
await check('outra empresa não enxerga nem usa o emitente', async () => {
  assert.equal((await api('POST', `/fiscal/emitters/${em1.id}/register`, {}, T2)).status, 404);
  assert.equal((await api('GET', '/fiscal/emitters', null, T2)).data.emitters.length, 0);
});
await check('testar conexão NFE.io', async () => {
  const r = await api('POST', `/fiscal/emitters/${em1.id}/test`, {}, T);
  assert.equal(r.status, 200, JSON.stringify(r.data));
});
await check('enviar cadastro à NFE.io: empresa, inscrição e certificado (multipart)', async () => {
  const r = await api('POST', `/fiscal/emitters/${em1.id}/register`, {}, T);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.provider_ref.company_id, 'co1'); assert.equal(r.data.sync_status, 'ok'); assert.equal(seen.nfeioCert, 1);
});

let inv1;
const o1 = await newOrder(svc);
await check('prévia com o emitente padrão mostra o envio no formato da NFE.io', async () => {
  const r = await api('GET', `/invoices/preview?order_id=${o1.id}&kind=nfse`, null, T);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.emitter.id, em1.id); assert.equal(r.data.payload.servicesAmount, 250); assert.equal(r.data.payload.borrower.federalTaxNumber, 52998224725);
  assert.deepEqual(r.data.warnings, []);
});
await check('emite NFS-e pela NFE.io: fica processando (nunca autorizada sem resposta)', async () => {
  const r = await api('POST', '/invoices', { order_id: o1.id, kind: 'nfse' }, T);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.status, 'processando'); assert.equal(r.data.external_id, 'si1'); assert.equal(r.data.emitter_id, em1.id); assert.equal(r.data.number, null);
  inv1 = r.data;
});
await check('não emite duas vezes para a mesma OS', async () => {
  assert.equal((await api('POST', '/invoices', { order_id: o1.id, kind: 'nfse' }, T)).status, 400);
});
await check('consulta: ainda processando, depois autorizada com número', async () => {
  let r = await api('POST', `/invoices/${inv1.id}/refresh`, {}, T);
  assert.equal(r.data.status, 'processando');
  r = await api('POST', `/invoices/${inv1.id}/refresh`, {}, T);
  assert.equal(r.data.status, 'autorizada'); assert.equal(r.data.number, '123'); assert.equal(r.data.verification_code, 'ABC9');
});
await check('PDF baixado pelo TORVEN (a chave não vai ao navegador)', async () => {
  const list = await api('GET', '/invoices', null, T);
  assert.equal(list.data[0].files_proxy, true); assert.equal(list.data[0].emitter_name, 'Matriz');
  const f = await api('GET', `/invoices/${inv1.id}/file/pdf`, null, T, true);
  assert.equal(f.status, 200); assert.equal(f.type, 'application/pdf'); assert.ok(f.text.startsWith('%PDF'));
  assert.equal((await api('GET', `/invoices/${inv1.id}/file/exe`, null, T)).status, 400);
  assert.equal((await api('GET', `/invoices/${inv1.id}/file/pdf`, null, T2)).status, 404);
});
await check('cancelamento: pedido aceito mantém autorizada até a consulta confirmar', async () => {
  let r = await api('POST', `/invoices/${inv1.id}/cancel`, { reason: 'Serviço lançado em duplicidade' }, T);
  assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.status, 'autorizada'); assert.match(r.data.message, /Cancelamento/);
  r = await api('POST', `/invoices/${inv1.id}/refresh`, {}, T);
  assert.equal(r.data.status, 'cancelada'); assert.ok(r.data.cancelled_at);
});

// ---------- segundo CNPJ, PlugNotas ----------
let em2;
await check('segundo CNPJ com PlugNotas; escolher o emitente na hora de emitir', async () => {
  const c = await api('POST', '/fiscal/emitters', emitterBody({ name: 'Filial', cnpj: CNPJ2, razao_social: 'FILIAL TESTE LTDA', provider: 'plugnotas', secrets: { api_key: 'plug-key' } }), T);
  assert.equal(c.status, 201, JSON.stringify(c.data)); em2 = c.data; assert.equal(em2.is_default, false);
  const cert = await api('POST', `/fiscal/emitters/${em2.id}/certificate`, { file_base64: makePfx(CNPJ2, 'senha123'), password: 'senha123' }, T);
  assert.equal(cert.status, 200);
  const reg = await api('POST', `/fiscal/emitters/${em2.id}/register`, {}, T);
  assert.equal(reg.status, 200, JSON.stringify(reg.data)); assert.equal(reg.data.provider_ref.certificate_id, 'cert1'); assert.equal(seen.plugCert, 1);
  const opts = await api('GET', '/fiscal/emitters/options', null, T);
  assert.equal(opts.data.length, 2); assert.ok(!JSON.stringify(opts.data).includes('plug-key'));
  const o = await newOrder(svc);
  const pv = await api('GET', `/invoices/preview?order_id=${o.id}&kind=nfse&emitter_id=${em2.id}`, null, T);
  assert.ok(Array.isArray(pv.data.payload)); assert.equal(pv.data.payload[0].prestador.cpfCnpj, CNPJ2);
  const r = await api('POST', '/invoices', { order_id: o.id, kind: 'nfse', emitter_id: em2.id }, T);
  assert.equal(r.status, 201, JSON.stringify(r.data)); assert.equal(r.data.status, 'processando'); assert.equal(r.data.external_id, 'pn1');
  const rf = await api('POST', `/invoices/${r.data.id}/refresh`, {}, T);
  assert.equal(rf.data.status, 'autorizada'); assert.equal(rf.data.number, '77');
});
await check('trocar o emitente padrão', async () => {
  const r = await api('POST', `/fiscal/emitters/${em2.id}/default`, {}, T);
  assert.equal(r.data.is_default, true);
  const l = await api('GET', '/fiscal/emitters', null, T);
  assert.equal(l.data.emitters.filter((e) => e.is_default).length, 1);
});
await check('outra empresa não emite com emitente alheio', async () => {
  const o = (await api('POST', '/orders', { customer_id: customer2.id, items: svc }, T2)).data;
  assert.equal((await api('POST', '/invoices', { order_id: o.id, kind: 'nfse', emitter_id: em1.id }, T2)).status, 404);
});

// ---------- Focus (numeração da DPS) ----------
await check('Focus: usa o token do emitente e avança o número da DPS', async () => {
  const c = await api('POST', '/fiscal/emitters', emitterBody({ name: 'Focus', provider: 'focus', secrets: { token_homologacao: 'focus-tok' }, next_dps_homologacao: 41 }), T);
  assert.equal(c.status, 201, JSON.stringify(c.data));
  const o = await newOrder(svc);
  const r = await api('POST', '/invoices', { order_id: o.id, kind: 'nfse', emitter_id: c.data.id }, T);
  assert.equal(r.status, 201, JSON.stringify(r.data)); assert.equal(r.data.status, 'processando');
  assert.equal(Number(seen.focus.at(-1).numero_dps), 41);
  const e = (await pool.query('select next_dps_homologacao from fiscal_emitters where id = $1', [c.data.id])).rows[0];
  assert.equal(e.next_dps_homologacao, 42);
  const rf = await api('POST', `/invoices/${r.data.id}/refresh`, {}, T);
  assert.equal(rf.data.status, 'autorizada'); assert.equal(rf.data.number, '900');
});

// ---------- Nuvem Fiscal (NF-e numerada pelo TORVEN) ----------
await check('Nuvem Fiscal: NF-e com número sequencial do emitente', async () => {
  const c = await api('POST', '/fiscal/emitters', emitterBody({ name: 'Nuvem', provider: 'nuvemfiscal', secrets: { client_id: 'nv-id', client_secret: 'nv-secret' }, next_nfe_homologacao: 10 }), T);
  assert.equal(c.status, 201, JSON.stringify(c.data));
  const prod = (await api('POST', '/products', { name: 'Chapa de aço', price: 120, ncm: '72085100', unit: 'UN' }, T)).data;
  const o = await newOrder([{ kind: 'material', product_id: prod.id, description: 'Chapa de aço', qty: 2, unit_price: 120 }]);
  const r = await api('POST', '/invoices', { order_id: o.id, kind: 'nfe', emitter_id: c.data.id }, T);
  assert.equal(r.status, 201, JSON.stringify(r.data)); assert.equal(r.data.status, 'autorizada'); assert.equal(r.data.number, '10');
  assert.equal(seen.nuvem.at(-1).infNFe.det[0].prod.NCM, '72085100'); assert.equal(seen.nuvem.at(-1).infNFe.total.ICMSTot.vNF, 240);
  const e = (await pool.query('select next_nfe_homologacao from fiscal_emitters where id = $1', [c.data.id])).rows[0];
  assert.equal(e.next_nfe_homologacao, 11);
});
await check('Nuvem Fiscal: segredo errado aparece como erro legível', async () => {
  const c = await api('POST', '/fiscal/emitters', emitterBody({ name: 'Nuvem errada', provider: 'nuvemfiscal', secrets: { client_id: 'nv-id2', client_secret: 'errado' } }), T);
  const t = await api('POST', `/fiscal/emitters/${c.data.id}/test`, {}, T);
  assert.equal(t.status, 400); assert.match(t.data.error, /Nuvem Fiscal/);
});

// ---------- eNotas (rejeição) ----------
await check('eNotas: rejeição da prefeitura vira erro com o motivo', async () => {
  const c = await api('POST', '/fiscal/emitters', emitterBody({ name: 'eNotas', provider: 'enotas', secrets: { api_key: 'en-key' } }), T);
  assert.equal((await api('POST', `/fiscal/emitters/${c.data.id}/register`, {}, T)).status, 200);
  const o = await newOrder(svc);
  const r = await api('POST', '/invoices', { order_id: o.id, kind: 'nfse', emitter_id: c.data.id }, T);
  assert.equal(r.data.status, 'processando');
  const rf = await api('POST', `/invoices/${r.data.id}/refresh`, {}, T);
  assert.equal(rf.data.status, 'erro'); assert.match(rf.data.message, /inexistente/);
});

// ---------- API própria ----------
await check('API própria: endereço sem https é recusado', async () => {
  const c = await api('POST', '/fiscal/emitters', emitterBody({ name: 'Propria', provider: 'generico', settings: { base_url: 'http://127.0.0.1:9' }, secrets: { token: 'abc' } }), T);
  assert.equal(c.status, 201, JSON.stringify(c.data));
  const t = await api('POST', `/fiscal/emitters/${c.data.id}/test`, {}, T);
  assert.equal(t.status, 400);
});

// ---------- registro manual ----------
await check('registro manual: prepara, e só vira autorizada com o número informado', async () => {
  const c = await api('POST', '/fiscal/emitters', emitterBody({ name: 'Prefeitura', provider: 'manual' }), T);
  const o = await newOrder(svc);
  const r = await api('POST', '/invoices', { order_id: o.id, kind: 'nfse', emitter_id: c.data.id }, T);
  assert.equal(r.status, 201); assert.equal(r.data.status, 'preparada'); assert.equal(r.data.manual, true); assert.equal(r.data.number, null);
  assert.equal((await api('POST', `/invoices/${r.data.id}/manual`, { number: '', issued_at: '2026-10-01' }, T)).status, 400);
  assert.equal((await api('POST', `/invoices/${r.data.id}/manual`, { number: '55', issued_at: '2099-01-01' }, T)).status, 400);
  const m = await api('POST', `/invoices/${r.data.id}/manual`, { number: '55', issued_at: '2026-10-01', verification_code: 'AB12' }, T);
  assert.equal(m.status, 200, JSON.stringify(m.data)); assert.equal(m.data.status, 'autorizada'); assert.match(m.data.message, /manualmente/);
  assert.equal((await api('POST', `/invoices/${r.data.id}/manual`, { number: '56', issued_at: '2026-10-01' }, T)).status, 400);
  const audit = (await pool.query("select count(*)::int as n from audit_log where action = 'registrar_manual'")).rows[0];
  assert.equal(audit.n, 1);
});
await check('nota de emissor via API não aceita registro manual', async () => {
  assert.equal((await api('POST', `/invoices/${inv1.id}/manual`, { number: '1', issued_at: '2026-10-01' }, T)).status, 400);
});

// ---------- bloqueios ----------
await check('cliente sem CPF/CNPJ bloqueia a emissão (prepara para conferir)', async () => {
  const c2 = (await api('POST', '/customers', { name: 'Sem Doc' }, T)).data;
  const o = (await api('POST', '/orders', { customer_id: c2.id, items: svc }, T)).data;
  const r = await api('POST', '/invoices', { order_id: o.id, kind: 'nfse', emitter_id: em2.id }, T);
  assert.equal(r.status, 400); assert.match(r.data.error, /CPF\/CNPJ/);
  const p = await api('POST', '/invoices', { order_id: o.id, kind: 'nfse', emitter_id: em2.id, prepare_only: true }, T);
  assert.equal(p.data.status, 'preparada');
});
await check('emitente desativado não emite; excluir com notas só desativa', async () => {
  const del = await api('DELETE', `/fiscal/emitters/${em1.id}`, null, T);
  assert.equal(del.data.deactivated, true);
  const o = await newOrder(svc);
  assert.equal((await api('POST', '/invoices', { order_id: o.id, kind: 'nfse', emitter_id: em1.id }, T)).status, 400);
});
await check('sem emitentes: segue a configuração antiga (empresa 2)', async () => {
  const o = (await api('POST', '/orders', { customer_id: customer2.id, items: svc }, T2)).data;
  const r = await api('GET', `/invoices/preview?order_id=${o.id}&kind=nfse`, null, T2);
  assert.equal(r.status, 200); assert.equal(r.data.emitter, null);
});
await check('trazer a configuração antiga da Focus para um emitente', async () => {
  await pool.query(`update companies set document = $1, trade_name = 'Outra', fiscal = fiscal || '{"provider":"focus","token_homologacao":"tok-velho","nextDpsNumberHomologacao":7}'::jsonb
    where id = (select company_id from users where email = 'outro@fis.dev')`, [CNPJ2]);
  const r = await api('POST', '/fiscal/emitters/import-legacy', {}, T2);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.provider, 'focus'); assert.equal(r.data.secrets.token_homologacao.set, true); assert.equal(r.data.next_dps_homologacao, 7); assert.equal(r.data.is_default, true);
  assert.equal((await api('POST', '/fiscal/emitters/import-legacy', {}, T2)).status, 400);
});
await check('nenhuma chave aparece nas respostas de notas', async () => {
  const l = await api('GET', '/invoices', null, T);
  const s = JSON.stringify(l.data);
  for (const k of ['nfeio-key', 'plug-key', 'focus-tok', 'nv-secret', 'en-key']) assert.ok(!s.includes(k), k);
});

console.log(`\n${passed} verificações OK, ${fails.length} falhas`);
server.close(); fake.close(); await pool.end();
if (fails.length) { fails.forEach((f) => console.log(' -', f)); process.exit(1); }
