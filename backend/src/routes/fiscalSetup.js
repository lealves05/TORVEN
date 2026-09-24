// Configuração fiscal: cadastro da empresa na Focus NFe, certificado, tokens, checklist e notas de teste.
import { Router } from 'express';
import { z } from 'zod';
import { q, one } from '../db.js';
import { need } from '../auth.js';
import { parse, bad, onlyDigits, validDocument, fiscalWithDefaults, dpsKey, round2 } from '../util.js';
import { focusAccount, focusCall, focusRequest, errorMessage, mapStatus, extractDoc, buildNfse, buildNfe } from '../fiscal.js';

const r = Router();

// ---------- helpers ----------
const mask = (t) => (t ? `${'•'.repeat(Math.max(0, Math.min(t.length - 4, 20)))}${t.slice(-4)}` : '');
export const publicFiscal = (raw) => {
  const x = fiscalWithDefaults(raw);
  return {
    ...x,
    token_homologacao: mask(x.token_homologacao), token_producao: mask(x.token_producao), account_token: mask(x.account_token),
    has_token_homologacao: !!x.token_homologacao, has_token_producao: !!x.token_producao, has_account_token: !!x.account_token,
  };
};
const loadFiscal = async (companyId) => fiscalWithDefaults((await one('select fiscal from companies where id = $1', [companyId])).fiscal);
const saveFiscal = async (companyId, f) => (await one('update companies set fiscal = $1 where id = $2 returning fiscal', [f, companyId])).fiscal;

const regimeFocus = (f) => (!f.simplesNacional ? 3 : f.codigoOpcaoSimples === 2 ? 4 : 1); // 1 Simples · 3 Normal · 4 MEI

/** Dados que a Focus exige para cadastrar a empresa, com as pendências. */
function companyProblems(c, f) {
  const p = [];
  const doc = onlyDigits(c.document);
  if (!c.name) p.push({ field: 'name', msg: 'Razão social' });
  if (doc.length !== 14) p.push({ field: 'document', msg: 'CNPJ da empresa' });
  else if (!validDocument(doc)) p.push({ field: 'document', msg: 'CNPJ inválido (dígito verificador)' });
  if (f.docs.nfse && !c.municipal_registration) p.push({ field: 'municipal_registration', msg: 'Inscrição municipal (NFS-e)' });
  if (f.docs.nfe && !c.state_registration) p.push({ field: 'state_registration', msg: 'Inscrição estadual (NF-e)' });
  if (!c.email) p.push({ field: 'email', msg: 'E-mail' });
  if (!c.phone) p.push({ field: 'phone', msg: 'Telefone' });
  if (!c.street || !c.number || !c.district) p.push({ field: 'street', msg: 'Endereço completo (rua, número, bairro)' });
  if (!c.city || !c.uf) p.push({ field: 'city', msg: 'Cidade e UF' });
  if (onlyDigits(c.cep).length !== 8) p.push({ field: 'cep', msg: 'CEP' });
  if (onlyDigits(c.city_code).length !== 7) p.push({ field: 'city_code', msg: 'Código IBGE do município (7 dígitos)' });
  return p;
}

function empresaPayload(c, f, extra = {}) {
  const payload = {
    nome: c.name,
    nome_fantasia: c.trade_name || c.name,
    cnpj: onlyDigits(c.document),
    inscricao_estadual: onlyDigits(c.state_registration) || undefined,
    inscricao_municipal: onlyDigits(c.municipal_registration) || undefined,
    regime_tributario: regimeFocus(f),
    email: c.email,
    telefone: onlyDigits(c.phone),
    logradouro: c.street,
    numero: c.number,
    complemento: c.complement || undefined,
    bairro: c.district,
    municipio: c.city,
    uf: c.uf,
    cep: onlyDigits(c.cep),
    cpf_cnpj_contabilidade: onlyDigits(f.cpfCnpjContabilidade) || undefined,
    habilita_nfe: !!f.docs.nfe,
    habilita_nfse: !!f.docs.nfse && f.nfseMode === 'municipal',
    habilita_nfsen_producao: !!f.docs.nfse && f.nfseMode === 'nacional',
    habilita_nfsen_homologacao: !!f.docs.nfse && f.nfseMode === 'nacional',
    enviar_email_destinatario: true,
    serie_nfe_producao: String(f.serieNfe || 1),
    serie_nfsen_producao: String(f.serieDps || 1),
    ...extra,
  };
  return JSON.parse(JSON.stringify(payload));
}

function applyEmpresa(f, e) {
  const next = { ...f, focus_company_id: e.id ?? f.focus_company_id, synced_at: new Date().toISOString() };
  if (e.token_producao) next.token_producao = e.token_producao;
  if (e.token_homologacao) next.token_homologacao = e.token_homologacao;
  if (e.certificado_valido_ate || e.certificado_cnpj) {
    next.certificate = { valid_from: e.certificado_valido_de || null, valid_until: e.certificado_valido_ate || null, cnpj: e.certificado_cnpj || null };
  }
  next.focus_flags = {
    nfe: !!e.habilita_nfe, nfse: !!e.habilita_nfse, nfsen_producao: !!e.habilita_nfsen_producao, nfsen_homologacao: !!e.habilita_nfsen_homologacao,
  };
  return next;
}

const accountError = (resp) => {
  if (resp.status === 401) return 'Token principal recusado pela Focus NFe (acesso negado). Confira o token em Minha conta › Token da API e se o seu plano libera a API de empresas.';
  if (resp.status === 404) return 'Empresa não encontrada na Focus NFe.';
  return errorMessage(resp.data) || `Focus NFe respondeu ${resp.status}`;
};

async function findEmpresa(f, cnpj) {
  if (f.focus_company_id) {
    const r1 = await focusAccount(f, 'GET', `/empresas/${f.focus_company_id}`);
    if (r1.status === 200) return r1.data;
    if (r1.status === 401) throw bad(accountError(r1));
  }
  const r2 = await focusAccount(f, 'GET', `/empresas?cnpj=${cnpj}`);
  if (r2.status !== 200) throw bad(accountError(r2));
  return Array.isArray(r2.data) ? r2.data[0] || null : null;
}

// ---------- leitura / configuração ----------
r.get('/', need('fiscal_settings', 'invoices_issue'), async (req, res) => res.json(publicFiscal(await loadFiscal(req.companyId))));

r.put('/', need('fiscal_settings'), async (req, res) => {
  const d = parse(z.object({
    provider: z.enum(['focus', 'none']).optional(),
    environment: z.enum(['homologacao', 'producao']).optional(),
    token_homologacao: z.string().trim().optional(),
    token_producao: z.string().trim().optional(),
    account_token: z.string().trim().optional(),
    nfseMode: z.enum(['nacional', 'municipal']).optional(),
    simplesNacional: z.boolean().optional(),
    codigoOpcaoSimples: z.coerce.number().int().min(1).max(3).optional(),
    regimeEspecial: z.coerce.number().int().min(0).max(9).optional(),
    issRate: z.coerce.number().min(0).max(10).optional(),
    issRetido: z.boolean().optional(),
    itemListaServico: z.string().trim().optional(),
    codigoTributacaoNacional: z.string().trim().optional(),
    codigoTributarioMunicipio: z.string().trim().optional(),
    cnae: z.string().trim().optional(),
    naturezaOperacao: z.string().trim().optional(),
    cfopDentro: z.string().trim().optional(),
    cfopFora: z.string().trim().optional(),
    icmsSituacao: z.string().trim().optional(),
    pisCofinsSituacao: z.string().trim().optional(),
    serieNfe: z.coerce.number().int().min(0).optional(),
    serieDps: z.coerce.number().int().min(0).optional(),
    nextDpsNumber: z.coerce.number().int().min(1).optional(),
    nextDpsNumberHomologacao: z.coerce.number().int().min(1).optional(),
    docs: z.object({ nfe: z.boolean(), nfse: z.boolean() }).optional(),
    cpfCnpjContabilidade: z.string().trim().optional(),
  }), req.body);
  const cur = await loadFiscal(req.companyId);
  const next = { ...cur, ...d };
  // campo mascarado = mantém o valor salvo; vazio = apaga
  for (const k of ['token_homologacao', 'token_producao', 'account_token']) {
    if (d[k] === undefined || d[k].includes('•')) next[k] = cur[k];
  }
  if (d.environment === 'producao' && !next.token_producao && next.provider === 'focus') {
    throw bad('Não há token de produção. Cadastre a empresa na Focus (etapa 3) ou cole o token de produção.');
  }
  res.json(publicFiscal(await saveFiscal(req.companyId, next)));
});

// ---------- checklist ----------
r.get('/status', need('fiscal_settings', 'invoices_issue'), async (req, res) => {
  const c = await one('select * from companies where id = $1', [req.companyId]);
  const f = fiscalWithDefaults(c.fiscal);
  const problems = companyProblems(c, f);
  const [{ rows: [mat] }, { rows: [svc] }, { rows: tests }] = await Promise.all([
    q(`select count(*) filter (where coalesce(ncm,'') = '')::int as missing, count(*)::int as total
         from products where company_id = $1 and active`, [req.companyId]),
    q(`select count(*) filter (where coalesce(service_code,'') = '')::int as missing, count(*)::int as total
         from services where company_id = $1 and active`, [req.companyId]),
    q(`select kind, max(issued_at) as at from invoices where company_id = $1 and provider = 'focus'
          and environment = 'homologacao' and status in ('autorizada','cancelada') group by kind`, [req.companyId]),
  ]);
  const tested = Object.fromEntries(tests.map((t) => [t.kind, t.at]));
  const until = f.certificate?.valid_until ? new Date(f.certificate.valid_until) : null;
  const daysLeft = until ? Math.floor((until - Date.now()) / 86400000) : null;
  const certOk = daysLeft !== null && daysLeft >= 0;
  const certMatches = !f.certificate?.cnpj || onlyDigits(f.certificate.cnpj) === onlyDigits(c.document);
  const tokensOk = !!f.token_homologacao && !!f.token_producao;
  const taxOk = (!f.docs.nfse || (!!f.itemListaServico && (f.nfseMode !== 'nacional' || onlyDigits(f.codigoTributacaoNacional).length === 6)))
    && (!f.docs.nfe || (!!f.cfopDentro && !!f.icmsSituacao));
  const testOk = (!f.docs.nfse || !!tested.nfse) && (!f.docs.nfe || !!tested.nfe);

  const steps = [
    { key: 'empresa', label: 'Dados fiscais da empresa', ok: problems.length === 0, detail: problems.map((p) => p.msg) },
    { key: 'conta', label: 'Conta Focus NFe conectada', ok: !!f.account_token || tokensOk, detail: f.account_token ? [] : tokensOk ? ['Tokens informados manualmente'] : ['Informe o token principal da conta'] },
    { key: 'certificado', label: 'Empresa e certificado A1 cadastrados na Focus', ok: tokensOk && (certOk || !f.account_token) && certMatches,
      detail: [
        !tokensOk && 'Cadastre a empresa para receber os tokens',
        f.account_token && !f.certificate && 'Envie o certificado digital A1',
        daysLeft !== null && daysLeft < 0 && 'Certificado vencido',
        !certMatches && 'Certificado de outro CNPJ',
      ].filter(Boolean) },
    { key: 'tributacao', label: 'Tributação e códigos', ok: taxOk,
      detail: [
        f.docs.nfse && f.nfseMode === 'nacional' && onlyDigits(f.codigoTributacaoNacional).length !== 6 && 'Código de tributação nacional (6 dígitos)',
        f.docs.nfe && mat.missing > 0 && `${mat.missing} de ${mat.total} materiais sem NCM`,
        f.docs.nfse && svc.missing > 0 && `${svc.missing} serviços sem item da LC 116 (usa o padrão)`,
      ].filter(Boolean) },
    { key: 'teste', label: 'Nota de teste autorizada em homologação', ok: testOk,
      detail: [f.docs.nfse && !tested.nfse && 'NFS-e de teste', f.docs.nfe && !tested.nfe && 'NF-e de teste'].filter(Boolean) },
    { key: 'producao', label: 'Emitindo em produção', ok: f.provider === 'focus' && f.environment === 'producao', detail: [] },
  ];
  res.json({
    steps, problems, provider: f.provider, environment: f.environment,
    certificate: f.certificate ? { ...f.certificate, days_left: daysLeft, matches: certMatches } : null,
    focus_company_id: f.focus_company_id, focus_flags: f.focus_flags || null, synced_at: f.synced_at, tested,
    materials: mat, services: svc,
    ready_for_production: steps.slice(0, 5).every((s) => s.ok),
  });
});

// ---------- conta Focus (token principal) ----------
r.post('/account', need('fiscal_settings'), async (req, res) => {
  const d = parse(z.object({ account_token: z.string().trim().min(10, 'token muito curto') }), req.body);
  const c = await one('select * from companies where id = $1', [req.companyId]);
  const f = await loadFiscal(req.companyId);
  const token = d.account_token.includes('•') ? f.account_token : d.account_token;
  const probe = await focusCall({ env: 'producao', token }, 'GET', `/empresas?cnpj=${onlyDigits(c.document) || '00000000000000'}`);
  if (probe.status !== 200) throw bad(accountError(probe));
  let next = { ...f, account_token: token, provider: 'focus' };
  const found = Array.isArray(probe.data) ? probe.data[0] : null;
  if (found) next = applyEmpresa(next, found);
  const saved = await saveFiscal(req.companyId, next);
  res.json({ fiscal: publicFiscal(saved), found: !!found, message: found ? 'Conta conectada. A empresa já estava cadastrada na Focus e os tokens foram importados.' : 'Conta conectada. Agora cadastre a empresa e o certificado.' });
});

// ---------- cadastro / atualização da empresa + certificado ----------
r.post('/register', need('fiscal_settings'), async (req, res) => {
  const d = parse(z.object({
    certificate_base64: z.string().max(200000, 'arquivo de certificado muito grande').optional(),
    certificate_password: z.string().optional(),
    municipal_login: z.string().trim().optional(),
    municipal_password: z.string().optional(),
    responsible_name: z.string().trim().optional(),
    responsible_cpf: z.string().trim().optional(),
    next_nfe_number: z.coerce.number().int().min(1).optional(),
    next_dps_number: z.coerce.number().int().min(1).optional(),
    dry_run: z.boolean().default(false),
  }), req.body);
  const c = await one('select * from companies where id = $1', [req.companyId]);
  const f = await loadFiscal(req.companyId);
  const problems = companyProblems(c, f);
  if (problems.length) throw bad(`Complete os dados da empresa: ${problems.map((p) => p.msg).join(', ')}.`);
  if (d.certificate_base64 && !d.certificate_password) throw bad('Informe a senha do certificado.');

  const existing = await findEmpresa(f, onlyDigits(c.document));
  if (!existing && !d.certificate_base64) throw bad('Envie o arquivo do certificado A1 (.pfx) para o primeiro cadastro.');

  const extra = {
    ...(d.certificate_base64 ? { arquivo_certificado_base64: d.certificate_base64.replace(/^data:[^,]*,/, ''), senha_certificado: d.certificate_password } : {}),
    ...(d.municipal_login ? { login_responsavel: d.municipal_login } : {}),
    ...(d.municipal_password ? { senha_responsavel: d.municipal_password } : {}),
    ...(d.responsible_name ? { nome_responsavel: d.responsible_name } : {}),
    ...(d.responsible_cpf ? { cpf_responsavel: onlyDigits(d.responsible_cpf) } : {}),
    ...(d.next_nfe_number ? { proximo_numero_nfe_producao: String(d.next_nfe_number) } : {}),
    ...(d.next_dps_number ? { proximo_numero_nfsen_producao: String(d.next_dps_number) } : {}),
  };
  if (c.logo_url?.startsWith('data:image/png')) extra.arquivo_logo_base64 = c.logo_url.replace(/^data:[^,]*,/, '');
  const payload = empresaPayload(c, f, extra);
  const path = existing ? `/empresas/${existing.id}` : '/empresas';
  const resp = await focusAccount(f, existing ? 'PUT' : 'POST', `${path}${d.dry_run ? '?dry_run=1' : ''}`, payload);
  if (resp.status >= 400) {
    const detail = Array.isArray(resp.data?.erros) ? resp.data.erros.map((e) => (e.campo ? `${e.campo}: ${e.mensagem}` : e.mensagem)).join(' · ') : null;
    throw bad(detail || accountError(resp));
  }
  if (d.dry_run) return res.json({ ok: true, dry_run: true, action: existing ? 'atualizar' : 'criar', message: 'Validação OK: a Focus aceitou os dados (nada foi gravado).' });

  let next = applyEmpresa({ ...f, provider: 'focus', registered_at: f.registered_at || new Date().toISOString() }, resp.data);
  if (d.next_dps_number) next.nextDpsNumber = d.next_dps_number;
  const saved = await saveFiscal(req.companyId, next);
  res.json({ ok: true, action: existing ? 'atualizada' : 'criada', fiscal: publicFiscal(saved),
    message: existing ? 'Cadastro da empresa atualizado na Focus NFe.' : 'Empresa cadastrada na Focus NFe. Tokens de homologação e produção importados.' });
});

/** Busca de novo os dados da empresa na Focus (validade do certificado, tokens, documentos habilitados). */
r.post('/sync', need('fiscal_settings'), async (req, res) => {
  const c = await one('select * from companies where id = $1', [req.companyId]);
  const f = await loadFiscal(req.companyId);
  const e = await findEmpresa(f, onlyDigits(c.document));
  if (!e) throw bad('Empresa ainda não cadastrada na Focus NFe.');
  const saved = await saveFiscal(req.companyId, applyEmpresa(f, e));
  res.json({ fiscal: publicFiscal(saved) });
});

/** Testa os tokens da empresa nos dois ambientes (uma consulta de nota inexistente deve voltar 404). */
r.post('/test-connection', need('fiscal_settings'), async (req, res) => {
  const f = await loadFiscal(req.companyId);
  const out = {};
  for (const env of ['homologacao', 'producao']) {
    const token = env === 'producao' ? f.token_producao : f.token_homologacao;
    if (!token) { out[env] = { ok: false, message: 'Sem token' }; continue; }
    try {
      const r1 = await focusCall({ env, token }, 'GET', '/nfe/torven-teste-conexao');
      out[env] = r1.status === 401 || r1.status === 403
        ? { ok: false, message: 'Token recusado' }
        : { ok: true, message: 'Conectado' };
    } catch (e) { out[env] = { ok: false, message: e.message }; }
  }
  res.json(out);
});

/** Emite uma nota de teste em homologação (R$ 1,00 / 1 material) para validar a configuração. */
r.post('/test-invoice', need('fiscal_settings'), async (req, res) => {
  const d = parse(z.object({
    kind: z.enum(['nfse', 'nfe']),
    customer_id: z.string().uuid({ message: 'selecione o cliente (tomador/destinatário) do teste' }),
    product_id: z.string().uuid().optional(),
  }), req.body);
  const company = await one('select * from companies where id = $1', [req.companyId]);
  const f = { ...fiscalWithDefaults(company.fiscal), environment: 'homologacao' };
  if (!f.token_homologacao) throw bad('Sem token de homologação. Conclua o cadastro na Focus (etapa 3).');
  const customer = await one('select * from customers where id = $1 and company_id = $2', [d.customer_id, req.companyId]);
  if (!customer) throw bad('Cliente não encontrado.');
  const order = { number: 'TESTE', discount: 0 };
  let b;
  if (d.kind === 'nfse') {
    b = buildNfse({ company, customer, order, fiscal: f, dpsNumber: f.nextDpsNumberHomologacao,
      items: [{ kind: 'servico', description: 'Nota emitida em caráter de TESTE — sem valor fiscal', qty: 1, unit: 'serv', unit_price: 1, total: 1, discount: 0 }] });
  } else {
    const p = d.product_id
      ? await one('select * from products where id = $1 and company_id = $2', [d.product_id, req.companyId])
      : await one("select * from products where company_id = $1 and active and coalesce(ncm,'') <> '' order by name limit 1", [req.companyId]);
    if (!p) throw bad('Cadastre ao menos um material com NCM para testar a NF-e.');
    b = buildNfe({ company, customer, order, fiscal: f,
      items: [{ kind: 'material', product_id: p.id, sku: p.sku, description: `${p.name} — TESTE`, qty: 1, unit: p.unit, unit_price: 1, total: 1, discount: 0, ncm: p.ncm, cfop: p.cfop, origin: p.origin }] });
  }
  if (b.warnings.length) throw bad(`Corrija antes do teste: ${b.warnings.join(' · ')}`);
  const ref = `tvteste${d.kind}${Date.now().toString(36)}`;
  if (b.endpoint === 'nfsen') {
    await q("update companies set fiscal = jsonb_set(fiscal, '{nextDpsNumberHomologacao}', to_jsonb($2::int)) where id = $1",
      [req.companyId, f.nextDpsNumberHomologacao + 1]);
  }
  const resp = await focusRequest(f, 'POST', `/${b.endpoint}?ref=${ref}`, b.payload);
  const ok = resp.status >= 200 && resp.status < 300;
  const status = ok ? (mapStatus(resp.data.status) || 'processando') : 'erro';
  const doc = extractDoc(resp.data, 'homologacao');
  const inv = await one(
    `insert into invoices (company_id, customer_id, kind, provider, environment, ref, amount, description, customer, items, status,
                           number, series, access_key, verification_code, pdf_url, xml_url, message, request, response, issued_at, test, created_by)
     values ($1,$2,$3,'focus','homologacao',$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
             case when $9 = 'autorizada' then now() end, true, $19) returning *`,
    [req.companyId, customer.id, d.kind, ref, round2(b.amount), b.description, { name: customer.name, document: customer.document },
      JSON.stringify(b.items.map((i) => ({ description: i.description, qty: i.qty, unit: i.unit, unit_price: i.unit_price, total: i.net }))),
      status, doc.number, doc.series, doc.access_key, doc.verification_code, doc.pdf_url, doc.xml_url,
      ok ? 'Nota de teste enviada' : errorMessage(resp.data) || `Erro ${resp.status}`, { ...b.payload, _endpoint: b.endpoint }, resp.data, req.user.id]);
  res.status(201).json(inv);
});

export { dpsKey };
export default r;
