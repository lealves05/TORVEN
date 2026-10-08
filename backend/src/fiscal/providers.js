// Emissores de nota fiscal que a empresa pode escolher. Cada um recebe o documento neutro (document.js) e devolve
// o resultado padronizado: { external_id, status: processando|autorizada|erro|cancelada, number, series, access_key,
// verification_code, pdf_url, xml_url, message, request, response }.
// Regra: nada é dado como autorizado sem a resposta do emissor dizendo isso.
//
// Campos marcados "conferir" foram tirados da documentação pública de cada emissor, mas não testados contra a conta
// real; a tela de emissão mostra o envio completo para conferência antes, e o erro do emissor volta legível.
import { HttpError, onlyDigits, round2 } from '../util.js';
import { buildNfse, buildNfe } from '../fiscal.js';
import { httpsOnly } from '../integrations/plates.js';

const UF_CODE = { RO: 11, AC: 12, AM: 13, RR: 14, PA: 15, AP: 16, TO: 17, MA: 21, PI: 22, CE: 23, RN: 24, PB: 25, PE: 26, AL: 27, SE: 28, BA: 29,
  MG: 31, ES: 32, RJ: 33, SP: 35, PR: 41, SC: 42, RS: 43, MS: 50, MT: 51, GO: 52, DF: 53 };

// ---------------- HTTP ----------------
/** Endereço do emissor; FISCAL_URL_<EMISSOR>[_<CHAVE>] substitui (testes/homologação própria). */
const url = (provider, key, fallback) => process.env[`FISCAL_URL_${provider.toUpperCase()}_${key.toUpperCase()}`] || process.env[`FISCAL_URL_${provider.toUpperCase()}`] || fallback;

async function http(target, { method = 'GET', headers = {}, json, form, multipart, timeout = 30000, raw = false } = {}) {
  const init = { method, headers: { accept: 'application/json', ...headers }, signal: AbortSignal.timeout(timeout), redirect: 'error' };
  if (json !== undefined) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(json); }
  if (form) { init.headers['content-type'] = 'application/x-www-form-urlencoded'; init.body = new URLSearchParams(form).toString(); }
  if (multipart) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(multipart)) {
      if (v && typeof v === 'object' && v.buffer) fd.append(k, new Blob([v.buffer], { type: 'application/x-pkcs12' }), v.filename || 'certificado.pfx');
      else if (v != null) fd.append(k, String(v));
    }
    init.body = fd;
  }
  let res;
  try { res = await fetch(target, init); } catch (e) {
    throw new HttpError(502, `Não foi possível falar com o emissor (${e.name === 'TimeoutError' ? 'tempo esgotado' : 'conexão recusada'}).`);
  }
  if (raw) return { status: res.status, buffer: Buffer.from(await res.arrayBuffer()), type: res.headers.get('content-type') || '' };
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text.slice(0, 500) }; }
  return { status: res.status, data, headers: res.headers };
}

/** Mensagem legível de erro em formatos comuns ({errors:[{message}]}, {error:{message}}, [{mensagem}], {Message}, ...). */
export function readError(data) {
  if (!data) return null;
  if (Array.isArray(data)) return data.map((x) => x?.mensagem || x?.message || x?.descricao).filter(Boolean).join(' · ') || null;
  const list = data.errors || data.erros || data.mensagens || data.error?.errors;
  if (Array.isArray(list) && list.length) return list.map((x) => (typeof x === 'string' ? x : x.message || x.mensagem || x.descricao || x.codigo)).filter(Boolean).join(' · ');
  return data.error?.message || (typeof data.error === 'string' ? data.error : null) || data.message || data.Message || data.mensagem
    || data.mensagem_sefaz || data.motivoStatus || data.flowMessage || null;
}
const fail = (resp, prefix) => new HttpError(resp.status === 401 || resp.status === 403 ? 400 : 502,
  `${prefix}: ${readError(resp.data) || `o emissor respondeu ${resp.status}`}${resp.status === 401 || resp.status === 403 ? ' (confira a chave de acesso)' : ''}`);
const ok = (r) => r.status >= 200 && r.status < 300;
const need = (v, label) => { if (!v) throw new HttpError(400, `Informe ${label} do emissor.`); return v; };
const pfx = (cert) => ({ buffer: Buffer.from(cert.base64.replace(/^data:[^,]*,/, ''), 'base64'), filename: 'certificado.pfx' });
const get = (obj, path) => String(path || '').split('.').filter(Boolean).reduce((o, k) => (o == null ? undefined : o[k]), obj);
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');

// ---------------- Focus NFe ----------------
const focusBase = (env) => (env === 'producao' ? url('focus', 'producao', 'https://api.focusnfe.com.br') : url('focus', 'homologacao', 'https://homologacao.focusnfe.com.br'));
const focusAuth = (token) => ({ Authorization: `Basic ${Buffer.from(`${token}:`).toString('base64')}` });
const focusStatus = (s) => ({ autorizado: 'autorizada', cancelado: 'cancelada', erro_autorizacao: 'erro', denegado: 'erro', processando_autorizacao: 'processando' }[s] || null);
/** Emitente no formato "empresa" usado pelos montadores da Focus (fiscal.js). */
const asCompany = (em) => ({ name: em.razao_social, trade_name: em.nome_fantasia, document: em.cnpj, state_registration: em.ie, municipal_registration: em.im,
  city_code: em.city_code, uf: em.uf, city: em.city, street: em.street, number: em.number, district: em.district, cep: em.cep, email: em.email, phone: em.phone });
const asFiscal = (em, s) => ({ ...s, environment: em.environment, simplesNacional: em.regime !== 'normal', codigoOpcaoSimples: em.regime === 'mei' ? 2 : em.regime === 'normal' ? 1 : 3 });
const focusToken = (em, sec) => need(em.environment === 'producao' ? sec.token_producao : sec.token_homologacao, `o token de ${em.environment === 'producao' ? 'produção' : 'homologação'} da Focus`);
function focusDoc(data, env) {
  const abs = (p) => (!p ? null : /^https?:/.test(p) ? p : `${focusBase(env)}${p}`);
  return { number: data.numero ?? data.numero_nfse ?? null, series: data.serie ?? null, access_key: data.chave_nfe ?? data.chave_acesso ?? null,
    verification_code: data.codigo_verificacao ?? null, pdf_url: abs(data.url_danfse || data.caminho_danfe || data.url), xml_url: abs(data.caminho_xml_nota_fiscal) };
}

const focus = {
  name: 'Focus NFe', site: 'https://focusnfe.com.br', docs: ['nfse', 'nfe'],
  help: 'NFS-e (nacional ou da prefeitura) e NF-e. Os tokens de homologação e produção ficam em Empresas › sua empresa, no painel da Focus.',
  fields: [], secrets: [
    { key: 'token_homologacao', label: 'Token de homologação da empresa' }, { key: 'token_producao', label: 'Token de produção da empresa' },
    { key: 'account_token', label: 'Token principal da conta (só para cadastrar a empresa pelo TORVEN)', optional: true },
  ],
  async register({ em, sec, cert }) {
    if (!sec.account_token) return { message: 'Sem o token principal da conta: cadastre a empresa e o certificado no painel da Focus e cole aqui os tokens da empresa.' };
    const base = focusBase('producao');
    const auth = focusAuth(sec.account_token);
    const payload = JSON.parse(JSON.stringify({
      nome: em.razao_social, nome_fantasia: em.nome_fantasia || em.razao_social, cnpj: onlyDigits(em.cnpj), inscricao_estadual: onlyDigits(em.ie) || undefined,
      inscricao_municipal: onlyDigits(em.im) || undefined, regime_tributario: em.regime === 'normal' ? 3 : em.regime === 'mei' ? 4 : 1, email: em.email,
      telefone: onlyDigits(em.phone), logradouro: em.street, numero: em.number, complemento: em.complement || undefined, bairro: em.district, municipio: em.city,
      uf: em.uf, cep: onlyDigits(em.cep), habilita_nfe: !!em.docs?.nfe, habilita_nfse: !!em.docs?.nfse && em.settings?.nfseMode === 'municipal',
      habilita_nfsen_producao: !!em.docs?.nfse && em.settings?.nfseMode !== 'municipal', habilita_nfsen_homologacao: !!em.docs?.nfse && em.settings?.nfseMode !== 'municipal',
      ...(cert ? { arquivo_certificado_base64: cert.base64.replace(/^data:[^,]*,/, ''), senha_certificado: cert.password } : {}),
    }));
    const found = await http(`${base}/v2/empresas?cnpj=${onlyDigits(em.cnpj)}`, { headers: auth });
    if (found.status === 401) throw fail(found, 'Focus NFe');
    const existing = Array.isArray(found.data) ? found.data[0] : null;
    const r = existing ? await http(`${base}/v2/empresas/${existing.id}`, { method: 'PUT', headers: auth, json: payload })
      : await http(`${base}/v2/empresas`, { method: 'POST', headers: auth, json: payload });
    if (!ok(r)) throw fail(r, 'Focus NFe');
    return { provider_ref: { company_id: r.data.id }, secrets: { token_homologacao: r.data.token_homologacao, token_producao: r.data.token_producao },
      message: existing ? 'Empresa atualizada na Focus NFe.' : 'Empresa cadastrada na Focus NFe.' };
  },
  async test({ em, sec }) {
    const r = await http(`${focusBase(em.environment)}/v2/nfse/teste-de-conexao-torven`, { headers: focusAuth(focusToken(em, sec)) });
    if (r.status === 401 || r.status === 403) throw fail(r, 'Focus NFe');
    return { message: 'Token aceito pela Focus NFe.' };
  },
  preview({ em, raw, dps }) {
    const s = asFiscal(em, raw.settings);
    const b = raw.kind === 'nfe' ? buildNfe({ ...raw.ctx, company: asCompany(em), fiscal: s }) : buildNfse({ ...raw.ctx, company: asCompany(em), fiscal: s, dpsNumber: dps });
    return { endpoint: b.endpoint, payload: b.payload };
  },
  async issue({ em, sec, doc, raw, dps }) {
    const { endpoint, payload } = focus.preview({ em, raw, dps });
    const r = await http(`${focusBase(em.environment)}/v2/${endpoint}?ref=${doc.ref}`, { method: 'POST', headers: focusAuth(focusToken(em, sec)), json: payload });
    const st = ok(r) ? focusStatus(r.data.status) || 'processando' : 'erro';
    return { external_id: doc.ref, status: st, ...focusDoc(r.data, em.environment), message: ok(r) ? (st === 'autorizada' ? 'Autorizada' : 'Enviada para autorização') : readError(r.data) || `Erro ${r.status}`,
      request: { ...payload, _endpoint: endpoint }, response: r.data, uses_dps: endpoint === 'nfsen' };
  },
  async refresh({ em, sec, inv }) {
    const r = await http(`${focusBase(inv.environment)}/v2/${inv.request?._endpoint || inv.kind}/${inv.external_id || inv.ref}`, { headers: focusAuth(focusToken({ ...em, environment: inv.environment }, sec)) });
    if (!ok(r)) throw fail(r, 'Focus NFe');
    const st = focusStatus(r.data.status) || inv.status;
    return { status: st, ...focusDoc(r.data, inv.environment), message: st === 'autorizada' ? 'Autorizada' : st === 'processando' ? 'Processando na prefeitura/SEFAZ' : readError(r.data) || st, response: r.data };
  },
  async cancel({ em, sec, inv, reason }) {
    const r = await http(`${focusBase(inv.environment)}/v2/${inv.request?._endpoint || inv.kind}/${inv.external_id || inv.ref}`,
      { method: 'DELETE', headers: focusAuth(focusToken({ ...em, environment: inv.environment }, sec)), json: { justificativa: reason } });
    if (!ok(r) || (r.data?.status && r.data.status !== 'cancelado')) throw fail(r, 'Cancelamento recusado');
    return { status: 'cancelada' };
  },
};

// ---------------- NFE.io ----------------
const nfeioV1 = () => url('nfeio', 'v1', 'https://api.nfe.io/v1');
const nfeioV2 = () => url('nfeio', 'v2', 'https://api.nfse.io/v2');
const nfeioAuth = (sec) => ({ Authorization: need(sec.api_key, 'a chave de API (Chave de Nota Fiscal)') });
const nfeioStatus = (d) => {
  const s = norm(d.flowStatus || d.status);
  if (['issued', 'authorized'].includes(s)) return 'autorizada';
  if (s === 'cancelled') return 'cancelada';
  if (['issuefailed', 'error', 'rejected', 'denied'].includes(s)) return 'erro';
  return 'processando';
};
const nfeio = {
  name: 'NFE.io', site: 'https://nfe.io', docs: ['nfse', 'nfe'],
  help: 'Use a “Chave de Nota Fiscal” (painel › Assinatura › Chaves de acesso). Homologação ou produção é definida na inscrição municipal da empresa.',
  fields: [], secrets: [{ key: 'api_key', label: 'Chave de Nota Fiscal (API key)' }],
  async register({ em, sec, cert }) {
    const auth = nfeioAuth(sec);
    let id = em.provider_ref?.company_id;
    const regime = { simples: 'SimplesNacional', mei: 'MicroempreendedorIndividual', normal: 'LucroPresumido' }[em.regime];
    const body = { Company: { Name: em.razao_social, TradeName: em.nome_fantasia || undefined, FederalTaxNumber: Number(onlyDigits(em.cnpj)), Email: em.email || undefined, TaxRegime: regime,
      Address: { Country: 'BRA', State: em.uf, City: { Code: onlyDigits(em.city_code), Name: em.city }, District: em.district, Street: em.street, Number: em.number,
        AdditionalInformation: em.complement || undefined, PostalCode: onlyDigits(em.cep) } } };
    const r = id ? await http(`${nfeioV2()}/companies/${id}`, { method: 'PUT', headers: auth, json: body }) : await http(`${nfeioV2()}/companies`, { method: 'POST', headers: auth, json: body });
    if (!ok(r)) throw fail(r, 'NFE.io (empresa)');
    id = r.data?.Company?.Id || r.data?.company?.id || r.data?.id || id;
    if (em.docs?.nfse && em.im) {
      const m = await http(`${nfeioV2()}/companies/${id}/municipaltaxes`, { method: 'POST', headers: auth,
        json: { City: { Code: onlyDigits(em.city_code), Name: em.city, State: em.uf }, TaxNumber: em.im, Environment: em.environment === 'producao' ? 'Production' : 'Development', RpsSerialNumber: '1' } });
      if (!ok(m) && m.status !== 409) throw fail(m, 'NFE.io (inscrição municipal)');
    }
    if (cert) {
      const c = await http(`${nfeioV2()}/companies/${id}/certificates`, { method: 'POST', headers: auth, multipart: { File: pfx(cert), Password: cert.password } });
      if (!ok(c)) throw fail(c, 'NFE.io (certificado)');
    }
    return { provider_ref: { company_id: id }, message: 'Empresa, inscrição e certificado enviados à NFE.io.' };
  },
  async test({ sec }) {
    const r = await http(`${nfeioV2()}/companies?pageCount=1`, { headers: nfeioAuth(sec) });
    if (!ok(r)) throw fail(r, 'NFE.io');
    return { message: 'Chave aceita pela NFE.io.' };
  },
  preview({ doc }) {
    const c = doc.customer || {};
    if (doc.kind === 'nfse') {
      return { endpoint: 'serviceinvoices', payload: JSON.parse(JSON.stringify({
        borrower: { type: c.type === 'pj' ? 'LegalEntity' : 'NaturalPerson', name: c.name, federalTaxNumber: c.doc ? Number(c.doc) : undefined, email: c.email || undefined,
          address: c.address?.street ? { country: 'BRA', postalCode: c.address.cep, street: c.address.street, number: c.address.number, additionalInformation: c.address.complement || undefined,
            district: c.address.district, city: { code: c.address.city_code, name: c.address.city }, state: c.address.uf } : undefined },
        cityServiceCode: doc.service.municipal_code || onlyDigits(doc.service.lc116), cnaeCode: doc.service.cnae || undefined, // cnaeCode: conferir
        description: doc.description, servicesAmount: doc.amount, issRate: doc.service.iss_rate ? doc.service.iss_rate / 100 : undefined, // fração (0,02): conferir
        externalId: doc.ref,
      })) };
    }
    const simples = doc.nfe.crt !== 3;
    return { endpoint: 'productinvoices', payload: JSON.parse(JSON.stringify({
      operationType: 'Outgoing', purposeType: 'Normal', destination: doc.nfe.interstate ? 'Interstate_Operation' : 'Internal_Operation',
      consumerType: doc.nfe.final_consumer ? 'FinalConsumer' : 'Normal', presenceType: 'Presence', operationNature: doc.nfe.natureza,
      buyer: { name: c.name, federalTaxNumber: c.doc ? Number(c.doc) : undefined, type: c.type === 'pj' ? 'LegalEntity' : 'NaturalPerson', email: c.email || undefined,
        stateTaxNumberIndicator: c.ie ? 'TaxPayer' : 'NonTaxPayer', stateTaxNumber: c.ie || undefined,
        address: { country: 'BRA', postalCode: c.address?.cep, street: c.address?.street, number: c.address?.number, district: c.address?.district,
          city: { code: c.address?.city_code, name: c.address?.city }, state: c.address?.uf } },
      items: doc.items.map((i) => ({ code: i.code, description: i.description, ncm: i.ncm, cfop: Number(i.cfop), quantity: i.qty, unit: i.unit, unitAmount: i.unit_price,
        totalAmount: i.gross, discountAmount: i.discount || undefined, totalIndicator: true,
        tax: { icms: simples ? { origin: String(i.origin), csosn: i.icms } : { origin: String(i.origin), cst: i.icms }, // csosn: conferir
          pis: { cst: i.pis_cofins }, cofins: { cst: i.pis_cofins } } })),
      payment: [{ paymentDetail: [{ method: 'Others', amount: doc.amount }] }],
      externalId: doc.ref,
    })) };
  },
  async issue({ em, sec, doc }) {
    const id = need(em.provider_ref?.company_id, 'o cadastro da empresa (use “Enviar cadastro ao emissor”)');
    const { endpoint, payload } = nfeio.preview({ doc });
    const target = doc.kind === 'nfse' ? `${nfeioV1()}/companies/${id}/serviceinvoices` : `${nfeioV2()}/companies/${id}/productinvoices`;
    const r = await http(target, { method: 'POST', headers: nfeioAuth(sec), json: payload });
    if (!ok(r)) return { status: 'erro', message: readError(r.data) || `Erro ${r.status}`, request: { ...payload, _endpoint: endpoint }, response: r.data };
    const d = r.data || {};
    return { external_id: d.id || d.Id || (r.headers?.get('location') || '').split('/').pop() || null, status: nfeioStatus(d) === 'autorizada' ? 'autorizada' : 'processando',
      number: d.number ? String(d.number) : null, message: 'Enviada para a fila de emissão da NFE.io', request: { ...payload, _endpoint: endpoint }, response: d, proxy_files: true };
  },
  async refresh({ em, sec, inv }) {
    const id = em.provider_ref?.company_id;
    const target = inv.kind === 'nfse' ? `${nfeioV1()}/companies/${id}/serviceinvoices/${inv.external_id}` : `${nfeioV2()}/companies/${id}/productinvoices/${inv.external_id}`;
    const r = await http(target, { headers: nfeioAuth(sec) });
    if (!ok(r)) throw fail(r, 'NFE.io');
    const d = r.data || {};
    const st = nfeioStatus(d);
    const protocol = (d.lastEvents?.events || []).find((e) => e.protocolNumber)?.protocolNumber || null;
    return { status: st, number: d.number != null ? String(d.number) : null, access_key: d.authorization?.accessKey || null, verification_code: d.checkCode || protocol || null,
      pdf_url: d.pdf?.uri || null, xml_url: d.xml?.uri || null, message: st === 'erro' ? readError(d) || d.flowMessage || 'Rejeitada' : st === 'autorizada' ? 'Autorizada' : d.flowMessage || 'Processando', response: d };
  },
  async cancel({ em, sec, inv, reason }) {
    const id = em.provider_ref?.company_id;
    const target = inv.kind === 'nfse' ? `${nfeioV1()}/companies/${id}/serviceinvoices/${inv.external_id}` : `${nfeioV2()}/companies/${id}/productinvoices/${inv.external_id}?reason=${encodeURIComponent(reason)}`;
    const r = await http(target, { method: 'DELETE', headers: nfeioAuth(sec) });
    if (!ok(r)) throw fail(r, 'Cancelamento recusado');
    return { status: 'processando', message: 'Cancelamento enviado; atualize em instantes.' };
  },
  async download({ em, sec, inv, type }) {
    const id = em.provider_ref?.company_id;
    const base = inv.kind === 'nfse' ? `${nfeioV1()}/companies/${id}/serviceinvoices/${inv.external_id}` : `${nfeioV2()}/companies/${id}/productinvoices/${inv.external_id}`;
    return http(`${base}/${type}`, { headers: nfeioAuth(sec), raw: true });
  },
};

// ---------------- PlugNotas (TecnoSpeed) ----------------
const plugBase = (em) => (em.settings?.plugnotasSandbox ? url('plugnotas', 'sandbox', 'https://api.sandbox.plugnotas.com.br') : url('plugnotas', 'api', 'https://api.plugnotas.com.br'));
const plugAuth = (sec) => ({ 'x-api-key': need(sec.api_key, 'o token (x-api-key)') });
const plugStatus = (s) => { const n = norm(s); if (n === 'concluido' || n === 'autorizado' || n === 'autorizada') return 'autorizada'; if (n === 'cancelado' || n === 'cancelada') return 'cancelada'; if (['rejeitado', 'rejeitada', 'erro', 'denegado'].includes(n)) return 'erro'; return 'processando'; };
const plugnotas = {
  name: 'PlugNotas (TecnoSpeed)', site: 'https://plugnotas.com.br', docs: ['nfse', 'nfe'],
  help: 'Token do painel (avatar › Exibir token). O ambiente de testes (sandbox) simula as respostas e não envia nada à prefeitura/SEFAZ.',
  fields: [{ key: 'plugnotasSandbox', label: 'Usar o ambiente de testes (sandbox) da PlugNotas', type: 'boolean' }],
  secrets: [{ key: 'api_key', label: 'Token (x-api-key)' }],
  async register({ em, sec, cert }) {
    const auth = plugAuth(sec);
    let certId = em.provider_ref?.certificate_id;
    if (cert) {
      const c = certId ? await http(`${plugBase(em)}/certificado/${certId}`, { method: 'PUT', headers: auth, multipart: { arquivo: pfx(cert), senha: cert.password } })
        : await http(`${plugBase(em)}/certificado`, { method: 'POST', headers: auth, multipart: { arquivo: pfx(cert), senha: cert.password, email: em.email || undefined } });
      if (!ok(c)) throw fail(c, 'PlugNotas (certificado)');
      certId = c.data?.data?.id || certId;
    }
    const prod = em.environment === 'producao';
    const body = JSON.parse(JSON.stringify({
      cpfCnpj: onlyDigits(em.cnpj), razaoSocial: em.razao_social, nomeFantasia: em.nome_fantasia || undefined, inscricaoMunicipal: em.im || undefined,
      inscricaoEstadual: onlyDigits(em.ie) || undefined, simplesNacional: em.regime !== 'normal', regimeTributario: em.regime === 'normal' ? 3 : 1, // conferir códigos
      email: em.email || undefined, certificado: certId || undefined,
      endereco: { logradouro: em.street, numero: em.number, complemento: em.complement || undefined, bairro: em.district, codigoPais: '1058', descricaoPais: 'Brasil',
        codigoCidade: onlyDigits(em.city_code), descricaoCidade: em.city, estado: em.uf, cep: onlyDigits(em.cep) },
      nfse: { ativo: !!em.docs?.nfse, tipoContrato: 0, config: { producao: prod, nfseNacional: em.settings?.nfseMode !== 'municipal' } }, // nfseNacional: conferir
      nfe: { ativo: !!em.docs?.nfe, config: { producao: prod } },
    }));
    let r = await http(`${plugBase(em)}/empresa`, { method: 'POST', headers: auth, json: body });
    if (r.status === 409) r = await http(`${plugBase(em)}/empresa/${onlyDigits(em.cnpj)}`, { method: 'PATCH', headers: auth, json: body });
    if (!ok(r)) throw fail(r, 'PlugNotas (empresa)');
    return { provider_ref: { certificate_id: certId || null }, message: 'Certificado e empresa enviados à PlugNotas.' };
  },
  async test({ em, sec }) {
    const r = await http(`${plugBase(em)}/empresa/${onlyDigits(em.cnpj)}`, { headers: plugAuth(sec) });
    if (r.status === 401 || r.status === 403) throw fail(r, 'PlugNotas');
    return { message: r.status === 404 ? 'Token aceito. A empresa ainda não está cadastrada na PlugNotas.' : 'Token aceito pela PlugNotas.' };
  },
  preview({ doc }) {
    const c = doc.customer || {};
    const addr = c.address?.street ? { logradouro: c.address.street, numero: c.address.number, complemento: c.address.complement || undefined, bairro: c.address.district,
      codigoCidade: c.address.city_code, descricaoCidade: c.address.city, estado: c.address.uf, cep: c.address.cep } : undefined;
    if (doc.kind === 'nfse') {
      return { endpoint: 'nfse', payload: JSON.parse(JSON.stringify([{
        idIntegracao: doc.ref, prestador: { cpfCnpj: doc.emitter.cnpj },
        tomador: { cpfCnpj: c.doc || undefined, razaoSocial: c.name, email: c.email || undefined, endereco: addr },
        servico: [{ codigo: doc.service.lc116, codigoTributacao: doc.service.municipal_code || doc.service.lc116, cnae: doc.service.cnae || undefined,
          codigoTributacaoNacional: doc.service.mode === 'nacional' ? doc.service.national_code : undefined, // conferir
          discriminacao: doc.description, iss: { tipoTributacao: 7, exigibilidade: 1, aliquota: doc.service.iss_rate, retido: doc.service.iss_retained }, // tipoTributacao/retido: conferir
          valor: { servico: doc.amount } }],
      }])) };
    }
    return { endpoint: 'nfe', payload: JSON.parse(JSON.stringify([{
      idIntegracao: doc.ref, natureza: doc.nfe.natureza, emitente: { cpfCnpj: doc.emitter.cnpj },
      destinatario: { cpfCnpj: c.doc || undefined, razaoSocial: c.name, email: c.email || undefined, inscricaoEstadual: c.ie || undefined, endereco: addr },
      itens: doc.items.map((i) => ({ codigo: i.code, descricao: i.description, ncm: i.ncm, cfop: i.cfop, unidade: { comercial: i.unit, tributavel: i.unit },
        quantidade: { comercial: i.qty, tributavel: i.qty }, valorUnitario: { comercial: i.unit_price, tributavel: i.unit_price }, valor: i.gross, valorDesconto: i.discount || undefined,
        tributos: { icms: { origem: String(i.origin), cst: i.icms }, pis: { cst: i.pis_cofins }, cofins: { cst: i.pis_cofins } } })), // formato de unidade/quantidade: conferir
      pagamentos: [{ aVista: true, meio: '99', valor: doc.amount }],
    }])) };
  },
  async issue({ em, sec, doc }) {
    const { endpoint, payload } = plugnotas.preview({ doc });
    const r = await http(`${plugBase(em)}/${endpoint}`, { method: 'POST', headers: plugAuth(sec), json: payload });
    if (!ok(r)) return { status: 'erro', message: readError(r.data) || `Erro ${r.status}`, request: { _body: payload, _endpoint: endpoint }, response: r.data };
    const d = r.data?.documents?.[0] || {};
    return { external_id: d.id || r.data?.protocol || null, status: 'processando', message: 'Enviada à PlugNotas para autorização', request: { _body: payload, _endpoint: endpoint }, response: r.data, proxy_files: true };
  },
  async refresh({ em, sec, inv }) {
    const target = inv.kind === 'nfse' ? `${plugBase(em)}/nfse/${inv.external_id}` : `${plugBase(em)}/nfe/${inv.external_id}/resumo`;
    const r = await http(target, { headers: plugAuth(sec) });
    if (!ok(r)) throw fail(r, 'PlugNotas');
    const d = Array.isArray(r.data) ? r.data[0] || {} : r.data || {};
    const st = plugStatus(d.situacao || d.status);
    return { status: st, number: d.numeroNfse != null ? String(d.numeroNfse) : d.numero != null ? String(d.numero) : null, access_key: d.chave || null,
      verification_code: d.codigoVerificacao || d.protocolo || null, message: st === 'erro' ? d.mensagem || readError(d) || 'Rejeitada' : st === 'autorizada' ? 'Autorizada' : d.mensagem || 'Processando', response: d };
  },
  async cancel({ em, sec, inv, reason }) {
    const r = inv.kind === 'nfse' ? await http(`${plugBase(em)}/nfse/cancelar/${inv.external_id}`, { method: 'POST', headers: plugAuth(sec), json: { codigo: '1', motivo: reason } })
      : await http(`${plugBase(em)}/nfe/${inv.external_id}/cancelamento`, { method: 'POST', headers: plugAuth(sec), json: { justificativa: reason } });
    if (!ok(r)) throw fail(r, 'Cancelamento recusado');
    return { status: 'processando', message: 'Cancelamento enviado; atualize em instantes.' };
  },
  async download({ em, sec, inv, type }) {
    const target = inv.kind === 'nfse' ? `${plugBase(em)}/nfse/${type}/${inv.external_id}` : `${plugBase(em)}/nfe/${inv.external_id}/${type}`;
    return http(target, { headers: plugAuth(sec), raw: true });
  },
};

// ---------------- Nuvem Fiscal ----------------
const nuvemBase = (env) => (env === 'producao' ? url('nuvemfiscal', 'producao', 'https://api.nuvemfiscal.com.br') : url('nuvemfiscal', 'sandbox', 'https://api.sandbox.nuvemfiscal.com.br'));
const nuvemTokens = new Map(); // client_id → { token, exp }
async function nuvemAuth(sec) {
  need(sec.client_id, 'o client_id'); need(sec.client_secret, 'o client_secret');
  const hit = nuvemTokens.get(sec.client_id);
  if (hit && hit.exp > Date.now() + 60000 && hit.secret === sec.client_secret) return { Authorization: `Bearer ${hit.token}` };
  const r = await http(url('nuvemfiscal', 'auth', 'https://auth.nuvemfiscal.com.br/oauth/token'), { method: 'POST',
    form: { grant_type: 'client_credentials', client_id: sec.client_id, client_secret: sec.client_secret, scope: 'empresa nfse nfe' } });
  if (!ok(r) || !r.data.access_token) throw fail(r, 'Nuvem Fiscal (login)');
  nuvemTokens.set(sec.client_id, { token: r.data.access_token, exp: Date.now() + (Number(r.data.expires_in) || 3600) * 1000, secret: sec.client_secret });
  return { Authorization: `Bearer ${r.data.access_token}` };
}
const nuvemStatus = (s) => { const n = norm(s); if (n === 'autorizada' || n === 'autorizado') return 'autorizada'; if (n === 'cancelada' || n === 'cancelado') return 'cancelada'; if (['negada', 'erro', 'rejeitado', 'denegado'].includes(n)) return 'erro'; return 'processando'; };
const nuvemfiscal = {
  name: 'Nuvem Fiscal', site: 'https://nuvemfiscal.com.br', docs: ['nfse', 'nfe'],
  help: 'Crie as credenciais (client_id e client_secret) no console da Nuvem Fiscal. Homologação usa o ambiente sandbox.',
  fields: [], secrets: [{ key: 'client_id', label: 'Client ID' }, { key: 'client_secret', label: 'Client secret' }],
  async register({ em, sec, cert }) {
    const auth = await nuvemAuth(sec);
    const base = nuvemBase(em.environment);
    const cnpj = onlyDigits(em.cnpj);
    const body = JSON.parse(JSON.stringify({ cpf_cnpj: cnpj, nome_razao_social: em.razao_social, nome_fantasia: em.nome_fantasia || undefined, inscricao_estadual: onlyDigits(em.ie) || undefined,
      inscricao_municipal: em.im || undefined, email: em.email || 'contato@empresa.com.br', fone: onlyDigits(em.phone) || undefined,
      endereco: { logradouro: em.street, numero: em.number, complemento: em.complement || undefined, bairro: em.district, codigo_municipio: onlyDigits(em.city_code), cidade: em.city, uf: em.uf, cep: onlyDigits(em.cep), codigo_pais: '1058' } }));
    const exists = await http(`${base}/empresas/${cnpj}`, { headers: auth });
    const r = exists.status === 200 ? await http(`${base}/empresas/${cnpj}`, { method: 'PUT', headers: auth, json: body }) : await http(`${base}/empresas`, { method: 'POST', headers: auth, json: body });
    if (!ok(r)) throw fail(r, 'Nuvem Fiscal (empresa)');
    if (cert) {
      const c = await http(`${base}/empresas/${cnpj}/certificado`, { method: 'PUT', headers: auth, json: { certificado: cert.base64.replace(/^data:[^,]*,/, ''), password: cert.password } });
      if (!ok(c)) throw fail(c, 'Nuvem Fiscal (certificado)');
    }
    const ambiente = em.environment === 'producao' ? 'producao' : 'homologacao';
    if (em.docs?.nfse) {
      const n = await http(`${base}/empresas/${cnpj}/nfse`, { method: 'PUT', headers: auth, json: { ambiente, rps: { lote: 1, serie: String(em.settings?.serieDps || 1), numero: Number(em.next_dps_homologacao || 1) },
        regTrib: { opSimpNac: em.regime === 'normal' ? 1 : em.regime === 'mei' ? 2 : 3, regEspTrib: Number(em.settings?.regimeEspecial) || 0 } } });
      if (!ok(n)) throw fail(n, 'Nuvem Fiscal (configuração da NFS-e)');
    }
    if (em.docs?.nfe) {
      const n = await http(`${base}/empresas/${cnpj}/nfe`, { method: 'PUT', headers: auth, json: { ambiente, CRT: em.regime === 'normal' ? 3 : em.regime === 'mei' ? 4 : 1 } });
      if (!ok(n)) throw fail(n, 'Nuvem Fiscal (configuração da NF-e)');
    }
    return { message: 'Empresa, certificado e configurações enviados à Nuvem Fiscal.' };
  },
  async test({ em, sec }) {
    const auth = await nuvemAuth(sec);
    const r = await http(`${nuvemBase(em.environment)}/empresas/${onlyDigits(em.cnpj)}`, { headers: auth });
    return { message: r.status === 200 ? 'Credenciais aceitas; empresa encontrada na Nuvem Fiscal.' : 'Credenciais aceitas. A empresa ainda não está cadastrada na Nuvem Fiscal.' };
  },
  preview({ em, doc, nfeNumber }) {
    const c = doc.customer || {};
    const ambiente = em.environment === 'producao' ? 'producao' : 'homologacao';
    if (doc.kind === 'nfse') {
      return { endpoint: 'nfse/dps', payload: JSON.parse(JSON.stringify({
        provedor: doc.service.mode === 'nacional' ? 'nacional' : 'padrao', ambiente, referencia: doc.ref,
        infDPS: { dhEmi: doc.issued_at, prest: { CNPJ: doc.emitter.cnpj },
          toma: { ...(c.type === 'pj' ? { CNPJ: c.doc } : { CPF: c.doc || undefined }), xNome: c.name, fone: c.phone || undefined, email: c.email || undefined,
            end: c.address?.street ? { endNac: { cMun: c.address.city_code, CEP: c.address.cep }, xLgr: c.address.street, nro: c.address.number, xCpl: c.address.complement || undefined, xBairro: c.address.district } : undefined },
          serv: { cServ: { cTribNac: doc.service.national_code, cTribMun: doc.service.municipal_code || undefined, CNAE: doc.service.cnae || undefined, xDescServ: doc.description },
            locPrest: { cLocPrestacao: doc.emitter.city_code } },
          valores: { vServPrest: { vServ: doc.amount }, trib: { tribMun: { tribISSQN: 1, pAliq: doc.service.iss_rate || undefined, tpRetISSQN: doc.service.iss_retained ? 2 : 1 } } } },
      })) };
    }
    const simples = doc.nfe.crt !== 3;
    const cUF = UF_CODE[String(doc.emitter.uf || '').toUpperCase()] || Number(String(doc.emitter.city_code).slice(0, 2));
    const vProd = doc.nfe.gross;
    const vDesc = round2(doc.items.reduce((a, i) => a + (i.discount || 0), 0));
    return { endpoint: 'nfe', payload: JSON.parse(JSON.stringify({
      ambiente, referencia: doc.ref,
      infNFe: { versao: '4.00',
        ide: { cUF, natOp: doc.nfe.natureza, serie: doc.nfe.series, nNF: nfeNumber, dhEmi: doc.issued_at, tpNF: 1, idDest: doc.nfe.interstate ? 2 : 1, cMunFG: Number(doc.emitter.city_code),
          tpImp: 1, tpEmis: 1, finNFe: 1, indFinal: doc.nfe.final_consumer ? 1 : 0, indPres: 1, procEmi: 0, verProc: 'TORVEN' },
        emit: { CNPJ: doc.emitter.cnpj, IE: doc.emitter.ie || undefined, CRT: doc.nfe.crt },
        dest: { ...(c.type === 'pj' ? { CNPJ: c.doc } : { CPF: c.doc || undefined }), xNome: c.name, indIEDest: c.ie ? 1 : 9, IE: c.ie || undefined, email: c.email || undefined,
          enderDest: { xLgr: c.address?.street, nro: c.address?.number, xBairro: c.address?.district, cMun: Number(c.address?.city_code) || undefined, xMun: c.address?.city, UF: c.address?.uf, CEP: c.address?.cep, cPais: 1058, xPais: 'Brasil' } },
        det: doc.items.map((i) => ({ nItem: i.n,
          prod: { cProd: i.code, cEAN: 'SEM GTIN', xProd: i.description, NCM: i.ncm, CFOP: i.cfop, uCom: i.unit, qCom: i.qty, vUnCom: i.unit_price, vProd: i.gross,
            cEANTrib: 'SEM GTIN', uTrib: i.unit, qTrib: i.qty, vUnTrib: i.unit_price, vDesc: i.discount || undefined, indTot: 1 },
          imposto: { ICMS: simples ? { [`ICMSSN${i.icms}`]: { orig: i.origin, CSOSN: i.icms } } : { [`ICMS${i.icms}`]: { orig: i.origin, CST: i.icms } },
            PIS: { PISOutr: { CST: i.pis_cofins, vBC: 0, pPIS: 0, vPIS: 0 } }, COFINS: { COFINSOutr: { CST: i.pis_cofins, vBC: 0, pCOFINS: 0, vCOFINS: 0 } } } })),
        total: { ICMSTot: { vBC: 0, vICMS: 0, vICMSDeson: 0, vFCP: 0, vBCST: 0, vST: 0, vFCPST: 0, vFCPSTRet: 0, vProd, vFrete: 0, vSeg: 0, vDesc, vII: 0, vIPI: 0, vIPIDevol: 0, vPIS: 0, vCOFINS: 0, vOutro: 0, vNF: doc.amount } },
        transp: { modFrete: 9 }, pag: { detPag: [{ tPag: '99', xPag: 'Outros', vPag: doc.amount }] } },
    })) };
  },
  async issue({ em, sec, doc, nfeNumber }) {
    const auth = await nuvemAuth(sec);
    const { endpoint, payload } = nuvemfiscal.preview({ em, doc, nfeNumber });
    const r = await http(`${nuvemBase(em.environment)}/${endpoint}`, { method: 'POST', headers: auth, json: payload });
    if (!ok(r)) return { status: 'erro', message: readError(r.data) || `Erro ${r.status}`, request: { ...payload, _endpoint: endpoint }, response: r.data };
    const d = r.data || {};
    const st = nuvemStatus(d.status);
    return { external_id: d.id || null, status: st === 'erro' ? 'erro' : st, number: d.numero != null ? String(d.numero) : null, access_key: d.chave || null,
      message: st === 'erro' ? readError(d) || d.autorizacao?.motivo_status || 'Rejeitada' : st === 'autorizada' ? 'Autorizada' : 'Enviada para autorização',
      request: { ...payload, _endpoint: endpoint }, response: d, proxy_files: true, uses_nfe_number: doc.kind === 'nfe' };
  },
  async refresh({ em, sec, inv }) {
    const auth = await nuvemAuth(sec);
    const r = await http(`${nuvemBase(inv.environment)}/${inv.kind}/${inv.external_id}`, { headers: auth });
    if (!ok(r)) throw fail(r, 'Nuvem Fiscal');
    const d = r.data || {};
    const st = nuvemStatus(d.status);
    return { status: st, number: d.numero != null ? String(d.numero) : null, series: d.serie != null ? String(d.serie) : null, access_key: d.chave || null,
      verification_code: d.codigo_verificacao || d.autorizacao?.numero_protocolo || null, pdf_url: null,
      message: st === 'erro' ? readError(d) || d.autorizacao?.motivo_status || 'Rejeitada' : st === 'autorizada' ? 'Autorizada' : 'Processando', response: d };
  },
  async cancel({ sec, inv, reason }) {
    const auth = await nuvemAuth(sec);
    const r = await http(`${nuvemBase(inv.environment)}/${inv.kind}/${inv.external_id}/cancelamento`, { method: 'POST', headers: auth, json: inv.kind === 'nfse' ? { codigo: '1', motivo: reason } : { justificativa: reason } });
    if (!ok(r)) throw fail(r, 'Cancelamento recusado');
    const st = norm(r.data?.status);
    if (st === 'rejeitado' || st === 'erro') throw new HttpError(400, `Cancelamento recusado: ${readError(r.data) || r.data?.motivo_status || st}`);
    return { status: st === 'concluido' ? 'cancelada' : 'processando', message: st === 'concluido' ? 'Cancelada' : 'Cancelamento enviado; atualize em instantes.' };
  },
  async download({ sec, inv, type }) {
    const auth = await nuvemAuth(sec);
    return http(`${nuvemBase(inv.environment)}/${inv.kind}/${inv.external_id}/${type}`, { headers: auth, raw: true });
  },
};

// ---------------- eNotas (Nota Gateway) ----------------
const enotasBase = () => url('enotas', 'api', 'https://api.notagateway.com.br');
const enotasAuth = (sec) => ({ Authorization: `Basic ${need(sec.api_key, 'a chave de API')}` });
const enotasStatus = (s) => { const n = norm(s); if (n === 'autorizada') return 'autorizada'; if (n === 'cancelada') return 'cancelada'; if (n === 'negada') return 'erro'; return 'processando'; };
const enotas = {
  name: 'eNotas (Nota Gateway)', site: 'https://notagateway.com.br', docs: ['nfse', 'nfe'],
  help: 'Chave de API do painel do eNotas/Nota Gateway. Homologação depende de a prefeitura ter ambiente de testes.',
  fields: [], secrets: [{ key: 'api_key', label: 'Chave de API' }],
  async register({ em, sec, cert }) {
    const auth = enotasAuth(sec);
    const s = em.settings || {};
    const body = JSON.parse(JSON.stringify({ id: em.provider_ref?.empresa_id || undefined, cnpj: onlyDigits(em.cnpj), inscricaoMunicipal: em.im || undefined, inscricaoEstadual: onlyDigits(em.ie) || undefined,
      razaoSocial: em.razao_social, nomeFantasia: em.nome_fantasia || em.razao_social, optanteSimplesNacional: em.regime !== 'normal', email: em.email || undefined,
      telefoneComercial: onlyDigits(em.phone) || undefined, incentivadorCultural: false, regimeEspecialTributacao: String(Number(s.regimeEspecial) || 0),
      endereco: { uf: em.uf, cidade: em.city, logradouro: em.street, numero: em.number, complemento: em.complement || undefined, bairro: em.district, cep: onlyDigits(em.cep) },
      codigoServicoMunicipal: s.codigoTributarioMunicipio || undefined, itemListaServicoLC116: s.itemListaServico || undefined, cnae: onlyDigits(s.cnae) || undefined, aliquotaIss: Number(s.issRate) || undefined,
      descricaoServico: 'Serviços de manutenção e reparação' }));
    const r = await http(`${enotasBase()}/v1/empresas`, { method: 'POST', headers: auth, json: body });
    if (!ok(r)) throw fail(r, 'eNotas (empresa)');
    const id = r.data?.empresaId || em.provider_ref?.empresa_id;
    if (cert && id) {
      const c = await http(`${enotasBase()}/v1/empresas/${id}/certificadoDigital`, { method: 'POST', headers: auth, multipart: { arquivo: pfx(cert), senha: cert.password } });
      if (!ok(c)) throw fail(c, 'eNotas (certificado)');
    }
    return { provider_ref: { empresa_id: id }, message: 'Empresa e certificado enviados ao eNotas.' };
  },
  async test({ em, sec }) {
    const id = em.provider_ref?.empresa_id;
    const r = await http(`${enotasBase()}/v1/empresas${id ? `/${id}` : '?pageNumber=0&pageSize=1'}`, { headers: enotasAuth(sec) });
    if (!ok(r)) throw fail(r, 'eNotas');
    return { message: 'Chave aceita pelo eNotas.' };
  },
  preview({ em, doc }) {
    const c = doc.customer || {};
    const amb = em.environment === 'producao' ? 'Producao' : 'Homologacao';
    const cliente = { tipoPessoa: c.type === 'pj' ? 'J' : 'F', nome: c.name, email: c.email || undefined, cpfCnpj: c.doc || undefined, telefone: c.phone || undefined,
      inscricaoEstadual: c.ie || undefined, indicadorContribuinteICMS: c.ie ? 'Contribuinte' : 'NaoContribuinte',
      endereco: c.address?.street ? { pais: 'Brasil', uf: c.address.uf, cidade: c.address.city_code || c.address.city, logradouro: c.address.street, numero: c.address.number,
        complemento: c.address.complement || undefined, bairro: c.address.district, cep: c.address.cep } : undefined };
    if (doc.kind === 'nfse') {
      return { endpoint: 'nfes', payload: JSON.parse(JSON.stringify({ tipo: 'NFS-e', idExterno: doc.ref, ambienteEmissao: amb, enviarPorEmail: !!c.email, cliente,
        servico: { descricao: doc.description, codigoServicoMunicipio: doc.service.municipal_code || undefined, itemListaServicoLC116: doc.service.lc116, cnae: doc.service.cnae || undefined,
          aliquotaIss: doc.service.iss_rate || undefined, issRetidoFonte: doc.service.iss_retained, codigoTributacaoNacional: doc.service.mode === 'nacional' ? doc.service.national_code : undefined },
        valorTotal: doc.amount })) };
    }
    return { endpoint: 'nf-e', payload: JSON.parse(JSON.stringify({ id: doc.ref, ambienteEmissao: amb, naturezaOperacao: doc.nfe.natureza, finalidade: 'Normal', consumidorFinal: doc.nfe.final_consumer,
      indicadorPresencaConsumidor: 'OperacaoPresencial', enviarPorEmail: !!c.email, cliente,
      itens: doc.items.map((i) => ({ cfop: i.cfop, codigo: i.code, descricao: i.description, ncm: i.ncm, quantidade: i.qty, unidadeMedida: i.unit, valorUnitario: i.unit_price, descontos: i.discount || undefined,
        impostos: { icms: { situacaoTributaria: i.icms, origem: i.origin }, pis: { situacaoTributaria: i.pis_cofins }, cofins: { situacaoTributaria: i.pis_cofins } } })) })) };
  },
  async issue({ em, sec, doc }) {
    const id = need(em.provider_ref?.empresa_id, 'o cadastro da empresa (use “Enviar cadastro ao emissor”)');
    const { endpoint, payload } = enotas.preview({ em, doc });
    const ver = doc.kind === 'nfse' ? 'v1' : 'v2';
    const r = await http(`${enotasBase()}/${ver}/empresas/${id}/${endpoint}`, { method: 'POST', headers: enotasAuth(sec), json: payload });
    if (!ok(r)) return { status: 'erro', message: readError(r.data) || `Erro ${r.status}`, request: { ...payload, _endpoint: endpoint }, response: r.data };
    return { external_id: r.data?.nfeId || r.data?.id || doc.ref, status: 'processando', message: 'Enviada ao eNotas para autorização', request: { ...payload, _endpoint: endpoint }, response: r.data };
  },
  async refresh({ em, sec, inv }) {
    const id = em.provider_ref?.empresa_id;
    const target = inv.kind === 'nfse' ? `${enotasBase()}/v1/empresas/${id}/nfes/${inv.external_id}` : `${enotasBase()}/v2/empresas/${id}/nf-e/${inv.external_id}`;
    const r = await http(target, { headers: enotasAuth(sec) });
    if (!ok(r)) throw fail(r, 'eNotas');
    const d = r.data || {};
    const st = enotasStatus(d.status);
    return { status: st, number: d.numero != null ? String(d.numero) : null, access_key: d.chaveAcesso || null, verification_code: d.codigoVerificacao || null,
      pdf_url: d.linkDownloadPDF || null, xml_url: d.linkDownloadXML || null,
      message: st === 'erro' ? d.motivoStatus || 'Negada' : st === 'autorizada' ? 'Autorizada' : d.motivoStatus || 'Processando', response: d };
  },
  async cancel({ em, sec, inv }) {
    const id = em.provider_ref?.empresa_id;
    const target = inv.kind === 'nfse' ? `${enotasBase()}/v1/empresas/${id}/nfes/${inv.external_id}` : `${enotasBase()}/v2/empresas/${id}/nf-e/${inv.external_id}`;
    const r = await http(target, { method: 'DELETE', headers: enotasAuth(sec) });
    if (!ok(r)) throw fail(r, 'Cancelamento recusado');
    return { status: 'processando', message: 'Cancelamento solicitado; atualize em instantes.' };
  },
};

// ---------------- Outro emissor (API própria) ----------------
const genStatus = (s, cfg) => {
  const n = norm(s);
  const has = (list) => String(list || '').split(',').map(norm).filter(Boolean).includes(n);
  if (has(cfg.authorized_values || 'autorizada,autorizado,issued,authorized,concluido')) return 'autorizada';
  if (has(cfg.cancelled_values || 'cancelada,cancelado,cancelled')) return 'cancelada';
  if (has(cfg.error_values || 'erro,rejeitada,rejeitado,negada,denegada,error,failed')) return 'erro';
  return 'processando';
};
const genAuth = (cfg, sec) => (sec.token ? { [cfg.auth_header || 'Authorization']: `${cfg.auth_prefix ?? 'Bearer '}${sec.token}` } : {});
const fill = (path, id) => String(path || '').replaceAll('{id}', encodeURIComponent(id || ''));
const generico = {
  name: 'Outro emissor (API própria)', site: null, docs: ['nfse', 'nfe'],
  help: 'Para qualquer emissor com API HTTPS. O TORVEN envia o documento em JSON (formato TORVEN) e lê a resposta pelos campos que você indicar.',
  fields: [
    { key: 'base_url', label: 'Endereço da API (https://...)', required: true },
    { key: 'auth_header', label: 'Cabeçalho da chave', placeholder: 'Authorization' }, { key: 'auth_prefix', label: 'Prefixo da chave', placeholder: 'Bearer ' },
    { key: 'issue_path', label: 'Caminho para emitir (POST)', placeholder: '/notas' }, { key: 'status_path', label: 'Caminho para consultar (GET)', placeholder: '/notas/{id}' },
    { key: 'cancel_path', label: 'Caminho para cancelar (POST)', placeholder: '/notas/{id}/cancelamento' },
    { key: 'map_id', label: 'Campo do identificador na resposta', placeholder: 'id' }, { key: 'map_status', label: 'Campo da situação', placeholder: 'status' },
    { key: 'map_number', label: 'Campo do número', placeholder: 'numero' }, { key: 'map_key', label: 'Campo da chave de acesso', placeholder: 'chave' },
    { key: 'map_pdf', label: 'Campo do link do PDF', placeholder: 'pdf' }, { key: 'map_xml', label: 'Campo do link do XML', placeholder: 'xml' },
    { key: 'map_message', label: 'Campo da mensagem', placeholder: 'mensagem' },
    { key: 'authorized_values', label: 'Situações que significam AUTORIZADA (separe por vírgula)', placeholder: 'autorizada,autorizado' },
    { key: 'error_values', label: 'Situações que significam ERRO', placeholder: 'rejeitada,erro' }, { key: 'cancelled_values', label: 'Situações que significam CANCELADA', placeholder: 'cancelada' },
  ],
  secrets: [{ key: 'token', label: 'Chave/token de acesso', optional: true }],
  async test({ em, sec }) {
    const cfg = em.settings || {};
    const base = await httpsOnly(need(cfg.base_url, 'o endereço da API'));
    const r = await http(base, { headers: genAuth(cfg, sec) });
    if (r.status === 401 || r.status === 403) throw fail(r, 'Emissor');
    return { message: `O emissor respondeu (${r.status}).` };
  },
  preview({ doc }) { return { endpoint: 'emitir', payload: { torven: 1, ...doc, warnings: undefined } }; },
  async issue({ em, sec, doc }) {
    const cfg = em.settings || {};
    const base = (await httpsOnly(need(cfg.base_url, 'o endereço da API'))).replace(/\/+$/, '');
    const payload = { torven: 1, ambiente: em.environment, ...doc, warnings: undefined };
    const r = await http(`${base}${cfg.issue_path || '/notas'}`, { method: 'POST', headers: genAuth(cfg, sec), json: payload });
    if (!ok(r)) return { status: 'erro', message: readError(r.data) || `Erro ${r.status}`, request: payload, response: r.data };
    const d = r.data || {};
    return { external_id: String(get(d, cfg.map_id || 'id') ?? doc.ref), status: genStatus(get(d, cfg.map_status || 'status'), cfg) === 'autorizada' ? 'autorizada' : 'processando',
      number: get(d, cfg.map_number || 'numero') ?? null, access_key: get(d, cfg.map_key || 'chave') ?? null, pdf_url: get(d, cfg.map_pdf || 'pdf') ?? null, xml_url: get(d, cfg.map_xml || 'xml') ?? null,
      message: get(d, cfg.map_message || 'mensagem') || 'Enviada ao emissor', request: payload, response: d };
  },
  async refresh({ em, sec, inv }) {
    const cfg = em.settings || {};
    const base = (await httpsOnly(need(cfg.base_url, 'o endereço da API'))).replace(/\/+$/, '');
    const r = await http(`${base}${fill(cfg.status_path || '/notas/{id}', inv.external_id)}`, { headers: genAuth(cfg, sec) });
    if (!ok(r)) throw fail(r, 'Emissor');
    const d = r.data || {};
    const st = genStatus(get(d, cfg.map_status || 'status'), cfg);
    return { status: st, number: get(d, cfg.map_number || 'numero') ?? null, access_key: get(d, cfg.map_key || 'chave') ?? null, pdf_url: get(d, cfg.map_pdf || 'pdf') ?? null,
      xml_url: get(d, cfg.map_xml || 'xml') ?? null, message: get(d, cfg.map_message || 'mensagem') || (st === 'autorizada' ? 'Autorizada' : st), response: d };
  },
  async cancel({ em, sec, inv, reason }) {
    const cfg = em.settings || {};
    const base = (await httpsOnly(need(cfg.base_url, 'o endereço da API'))).replace(/\/+$/, '');
    const r = await http(`${base}${fill(cfg.cancel_path || '/notas/{id}/cancelamento', inv.external_id)}`, { method: 'POST', headers: genAuth(cfg, sec), json: { justificativa: reason } });
    if (!ok(r)) throw fail(r, 'Cancelamento recusado');
    const st = genStatus(get(r.data || {}, cfg.map_status || 'status'), cfg);
    return { status: st === 'cancelada' ? 'cancelada' : 'processando', message: st === 'cancelada' ? 'Cancelada' : 'Cancelamento enviado; atualize em instantes.' };
  },
};

// ---------------- Emissão fora do TORVEN (registro manual) ----------------
const manual = {
  name: 'Emitir no site da prefeitura/SEFAZ (registro manual)', site: null, docs: ['nfse', 'nfe'], manual: true,
  help: 'Sem integração: o TORVEN prepara os dados da nota para você copiar no emissor da prefeitura ou da SEFAZ. Depois, registre aqui o número da nota emitida.',
  fields: [], secrets: [],
};

export const PROVIDERS = { focus, nfeio, plugnotas, nuvemfiscal, enotas, generico, manual };

export function providerInfo(id) {
  const p = PROVIDERS[id];
  return { id, name: p.name, site: p.site, help: p.help, docs: p.docs, fields: p.fields, secrets: p.secrets, manual: !!p.manual, can_register: !!p.register, can_test: !!p.test };
}
