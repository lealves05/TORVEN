// Emitentes fiscais: cada CNPJ da empresa com o emissor de notas escolhido (Focus, NFE.io, PlugNotas, Nuvem Fiscal,
// eNotas, API própria ou registro manual), suas credenciais e o certificado A1 — tudo guardado cifrado.
import { Router } from 'express';
import { z } from 'zod';
import { q, one, tx } from '../db.js';
import { need } from '../auth.js';
import { parse, bad, notFound, onlyDigits, validDocument, fiscalWithDefaults } from '../util.js';
import { seal, unseal, mask } from '../secretbox.js';
import { audit } from '../audit.js';
import { PROVIDERS, providerInfo } from '../fiscal/providers.js';
import { EMITTER_DEFAULTS, emitterProblems } from '../fiscal/document.js';
import { readCertificate, certDaysLeft } from '../fiscal/certificate.js';

const r = Router();
const PROVIDER_IDS = Object.keys(PROVIDERS);
const safeUnseal = (enc) => { try { return unseal(enc); } catch { return {}; } };

/** Visão pública: nunca devolve segredo nem certificado, só o final mascarado e a validade. */
export function publicEmitter(em) {
  const p = PROVIDERS[em.provider];
  const sec = safeUnseal(em.secret_enc);
  const secrets = {};
  for (const s of p?.secrets || []) secrets[s.key] = { set: !!sec[s.key], hint: mask(sec[s.key]) };
  const days = certDaysLeft(em.cert_info);
  return {
    id: em.id, name: em.name, cnpj: em.cnpj, razao_social: em.razao_social, nome_fantasia: em.nome_fantasia, ie: em.ie, im: em.im, regime: em.regime,
    email: em.email, phone: em.phone, cep: em.cep, street: em.street, number: em.number, complement: em.complement, district: em.district,
    city: em.city, uf: em.uf, city_code: em.city_code, provider: em.provider, provider_name: p?.name || em.provider, environment: em.environment,
    docs: em.docs, settings: { ...EMITTER_DEFAULTS, ...(em.settings || {}) }, provider_ref: em.provider_ref, secrets,
    certificate: em.cert_enc ? { ...(em.cert_info || {}), days_left: days, expired: days != null && days < 0, expiring: days != null && days >= 0 && days <= 30 } : null,
    sync_status: em.sync_status, sync_message: em.sync_message, synced_at: em.synced_at,
    next_dps_homologacao: em.next_dps_homologacao, next_dps_producao: em.next_dps_producao,
    next_nfe_homologacao: em.next_nfe_homologacao, next_nfe_producao: em.next_nfe_producao,
    is_default: em.is_default, active: em.active, problems: [...(em.docs?.nfse ? emitterProblems(em, 'nfse') : []), ...(em.docs?.nfe ? emitterProblems(em, 'nfe') : [])].filter((x, i, a) => a.indexOf(x) === i),
    created_at: em.created_at, updated_at: em.updated_at,
  };
}

export async function loadEmitter(companyId, id, db = { query: q }) {
  const { rows: [em] } = await db.query('select * from fiscal_emitters where id = $1 and company_id = $2', [id, companyId]);
  if (!em) throw notFound('Emitente não encontrado');
  return em;
}

const str = (max = 200) => z.string().trim().max(max).nullable().optional().transform((v) => (v === '' ? null : v));
const emitterSchema = z.object({
  name: z.string().trim().min(2, 'Dê um nome curto ao emitente (ex.: Matriz)').max(60),
  cnpj: z.string().trim().refine((v) => onlyDigits(v).length === 14 && validDocument(v), 'CNPJ inválido').transform(onlyDigits),
  razao_social: z.string().trim().min(2, 'Informe a razão social').max(150),
  nome_fantasia: str(150), ie: str(30), im: str(30),
  regime: z.enum(['simples', 'mei', 'normal']).default('simples'),
  email: z.string().trim().email('E-mail inválido').max(150).nullable().optional().or(z.literal('').transform(() => null)),
  phone: str(30), cep: str(10), street: str(150), number: str(20), complement: str(80), district: str(80), city: str(80),
  uf: z.string().trim().length(2, 'UF com 2 letras').toUpperCase().nullable().optional().or(z.literal('').transform(() => null)),
  city_code: str(7),
  provider: z.enum(PROVIDER_IDS),
  environment: z.enum(['homologacao', 'producao']).default('homologacao'),
  docs: z.object({ nfse: z.boolean(), nfe: z.boolean() }).default({ nfse: true, nfe: false }),
  settings: z.record(z.string().max(60), z.union([z.string().max(500), z.number(), z.boolean(), z.null()])).default({}),
  // credenciais: texto preenchido substitui; vazio mantém; null apaga
  secrets: z.record(z.string().max(60), z.string().max(4000).nullable()).optional(),
  next_dps_homologacao: z.number().int().min(1).max(999999999).optional(),
  next_dps_producao: z.number().int().min(1).max(999999999).optional(),
  next_nfe_homologacao: z.number().int().min(1).max(999999999).optional(),
  next_nfe_producao: z.number().int().min(1).max(999999999).optional(),
});

function mergeSecrets(provider, current, incoming) {
  const allowed = new Set((PROVIDERS[provider]?.secrets || []).map((s) => s.key));
  const next = {};
  for (const k of allowed) if (current[k]) next[k] = current[k];
  for (const [k, v] of Object.entries(incoming || {})) {
    if (!allowed.has(k)) continue;
    if (v === null) delete next[k];
    else if (v.trim()) next[k] = v.trim();
  }
  return next;
}

/** Só os campos de configuração que o emissor declara + parâmetros fiscais conhecidos. */
function cleanSettings(provider, s) {
  const allowed = new Set([...Object.keys(EMITTER_DEFAULTS), ...(PROVIDERS[provider]?.fields || []).map((f) => f.key)]);
  return Object.fromEntries(Object.entries(s || {}).filter(([k]) => allowed.has(k)));
}

// ---------- leitura ----------
r.get('/providers', need('fiscal_settings', 'invoices_issue'), (req, res) => res.json(PROVIDER_IDS.map(providerInfo)));

r.get('/', need('fiscal_settings'), async (req, res) => {
  const { rows } = await q('select * from fiscal_emitters where company_id = $1 order by is_default desc, active desc, name', [req.companyId]);
  const company = await one('select fiscal from companies where id = $1', [req.companyId]);
  const legacy = fiscalWithDefaults(company.fiscal);
  res.json({ emitters: rows.map(publicEmitter), providers: PROVIDER_IDS.map(providerInfo), defaults: EMITTER_DEFAULTS, legacy_focus: legacy.provider === 'focus' && !rows.length });
});

/** Lista curta para escolher na hora de emitir (sem dados sensíveis). */
r.get('/options', need('invoices_issue', 'fiscal_settings'), async (req, res) => {
  const { rows } = await q('select * from fiscal_emitters where company_id = $1 and active order by is_default desc, name', [req.companyId]);
  res.json(rows.map((em) => {
    const days = certDaysLeft(em.cert_info);
    return { id: em.id, name: em.name, cnpj: em.cnpj, razao_social: em.razao_social, provider: em.provider, provider_name: PROVIDERS[em.provider]?.name,
      environment: em.environment, docs: em.docs, is_default: em.is_default, manual: !!PROVIDERS[em.provider]?.manual,
      cert_days_left: em.cert_enc ? days : null, has_certificate: !!em.cert_enc };
  }));
});

// ---------- cadastro ----------
r.post('/', need('fiscal_settings'), async (req, res) => {
  const d = parse(emitterSchema, req.body);
  const row = await tx(async (db) => {
    const { rows: [{ n }] } = await db.query('select count(*)::int as n from fiscal_emitters where company_id = $1', [req.companyId]);
    if (n >= 50) throw bad('Limite de 50 emitentes por empresa.');
    const dup = await db.query('select 1 from fiscal_emitters where company_id = $1 and lower(name) = lower($2)', [req.companyId, d.name]);
    if (dup.rows.length) throw bad('Já existe um emitente com esse nome.');
    const secrets = mergeSecrets(d.provider, {}, d.secrets);
    const { rows: [em] } = await db.query(
      `insert into fiscal_emitters (company_id, name, cnpj, razao_social, nome_fantasia, ie, im, regime, email, phone, cep, street, number, complement,
         district, city, uf, city_code, provider, environment, docs, settings, secret_enc, is_default, sync_status,
         next_dps_homologacao, next_dps_producao, next_nfe_homologacao, next_nfe_producao)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,'pendente',$25,$26,$27,$28) returning *`,
      [req.companyId, d.name, d.cnpj, d.razao_social, d.nome_fantasia, d.ie, d.im, d.regime, d.email, d.phone, onlyDigits(d.cep) || null, d.street, d.number,
        d.complement, d.district, d.city, d.uf, onlyDigits(d.city_code) || null, d.provider, d.environment, d.docs, cleanSettings(d.provider, d.settings),
        Object.keys(secrets).length ? seal(secrets) : null, n === 0,
        d.next_dps_homologacao || 1, d.next_dps_producao || 1, d.next_nfe_homologacao || 1, d.next_nfe_producao || 1]);
    await audit(db, req, { entity: 'fiscal_emitter', entityId: em.id, action: 'criar', summary: `Emitente ${em.name} (${em.cnpj}) · ${PROVIDERS[em.provider].name} · ${em.environment}` });
    return em;
  });
  res.status(201).json(publicEmitter(row));
});

r.put('/:id', need('fiscal_settings'), async (req, res) => {
  const d = parse(emitterSchema, req.body);
  const row = await tx(async (db) => {
    const em = await loadEmitter(req.companyId, req.params.id, db);
    const dup = await db.query('select 1 from fiscal_emitters where company_id = $1 and lower(name) = lower($2) and id <> $3', [req.companyId, d.name, em.id]);
    if (dup.rows.length) throw bad('Já existe um emitente com esse nome.');
    const changedProvider = em.provider !== d.provider;
    const secrets = mergeSecrets(d.provider, changedProvider ? {} : safeUnseal(em.secret_enc), d.secrets);
    const { rows: [up] } = await db.query(
      `update fiscal_emitters set name=$2, cnpj=$3, razao_social=$4, nome_fantasia=$5, ie=$6, im=$7, regime=$8, email=$9, phone=$10, cep=$11, street=$12,
         number=$13, complement=$14, district=$15, city=$16, uf=$17, city_code=$18, provider=$19, environment=$20, docs=$21, settings=$22, secret_enc=$23,
         provider_ref = case when $24 then '{}'::jsonb else provider_ref end, sync_status = case when $24 then 'pendente' else sync_status end,
         next_dps_homologacao = coalesce($25, next_dps_homologacao), next_dps_producao = coalesce($26, next_dps_producao),
         next_nfe_homologacao = coalesce($27, next_nfe_homologacao), next_nfe_producao = coalesce($28, next_nfe_producao), updated_at = now()
       where id = $1 returning *`,
      [em.id, d.name, d.cnpj, d.razao_social, d.nome_fantasia, d.ie, d.im, d.regime, d.email, d.phone, onlyDigits(d.cep) || null, d.street, d.number,
        d.complement, d.district, d.city, d.uf, onlyDigits(d.city_code) || null, d.provider, d.environment, d.docs, cleanSettings(d.provider, d.settings),
        Object.keys(secrets).length ? seal(secrets) : null, changedProvider,
        d.next_dps_homologacao ?? null, d.next_dps_producao ?? null, d.next_nfe_homologacao ?? null, d.next_nfe_producao ?? null]);
    const what = [changedProvider && `emissor ${PROVIDERS[em.provider]?.name} → ${PROVIDERS[d.provider].name}`, em.environment !== d.environment && `ambiente ${d.environment}`,
      d.secrets && Object.keys(d.secrets).length && 'credenciais alteradas'].filter(Boolean).join(' · ');
    await audit(db, req, { entity: 'fiscal_emitter', entityId: em.id, action: 'editar', summary: `Emitente ${up.name}${what ? ` · ${what}` : ''}` });
    return up;
  });
  res.json(publicEmitter(row));
});

r.post('/:id/default', need('fiscal_settings'), async (req, res) => {
  const row = await tx(async (db) => {
    const em = await loadEmitter(req.companyId, req.params.id, db);
    if (!em.active) throw bad('Reative o emitente antes de torná-lo padrão.');
    await db.query('update fiscal_emitters set is_default = false where company_id = $1 and is_default', [req.companyId]);
    const { rows: [up] } = await db.query('update fiscal_emitters set is_default = true, updated_at = now() where id = $1 returning *', [em.id]);
    await audit(db, req, { entity: 'fiscal_emitter', entityId: em.id, action: 'padrao', summary: `Emitente ${em.name} virou o padrão das notas` });
    return up;
  });
  res.json(publicEmitter(row));
});

r.post('/:id/active', need('fiscal_settings'), async (req, res) => {
  const d = parse(z.object({ active: z.boolean() }), req.body);
  const em = await loadEmitter(req.companyId, req.params.id);
  const row = await one('update fiscal_emitters set active = $2, is_default = case when $2 then is_default else false end, updated_at = now() where id = $1 returning *', [em.id, d.active]);
  await audit(null, req, { entity: 'fiscal_emitter', entityId: em.id, action: d.active ? 'ativar' : 'desativar', summary: `Emitente ${em.name} ${d.active ? 'ativado' : 'desativado'}` });
  res.json(publicEmitter(row));
});

/** Exclui; se já houver notas ligadas, só desativa (as notas guardam o histórico). */
r.delete('/:id', need('fiscal_settings'), async (req, res) => {
  const em = await loadEmitter(req.companyId, req.params.id);
  const used = await one('select count(*)::int as n from invoices where emitter_id = $1', [em.id]);
  if (used.n) {
    await q('update fiscal_emitters set active = false, is_default = false, updated_at = now() where id = $1', [em.id]);
    await audit(null, req, { entity: 'fiscal_emitter', entityId: em.id, action: 'desativar', summary: `Emitente ${em.name} desativado (tem ${used.n} nota(s))` });
    return res.json({ deactivated: true });
  }
  await q('delete from fiscal_emitters where id = $1', [em.id]);
  await audit(null, req, { entity: 'fiscal_emitter', entityId: em.id, action: 'excluir', summary: `Emitente ${em.name} (${em.cnpj}) excluído com o certificado guardado` });
  res.status(204).end();
});

// ---------- certificado A1 ----------
r.post('/:id/certificate', need('fiscal_settings'), async (req, res) => {
  const d = parse(z.object({ file_base64: z.string().min(100).max(90_000), password: z.string().min(1, 'Informe a senha do certificado').max(200) }), req.body);
  const em = await loadEmitter(req.companyId, req.params.id);
  const info = readCertificate(d.file_base64, d.password);
  if (info.cnpj && info.cnpj !== onlyDigits(em.cnpj)) {
    throw bad(`Este certificado é do CNPJ ${info.cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')}, diferente do emitente (${em.cnpj}). Envie o certificado da empresa certa.`);
  }
  if (new Date(info.valid_until) < new Date()) throw bad(`Certificado vencido em ${new Date(info.valid_until).toLocaleDateString('pt-BR')}. Renove com a certificadora.`);
  const cert = { base64: d.file_base64.replace(/^data:[^,]*,/, '').replace(/\s/g, ''), password: d.password };
  const row = await one(
    `update fiscal_emitters set cert_enc = $2, cert_info = $3, sync_status = 'pendente', sync_message = 'Certificado novo: envie o cadastro ao emissor.', updated_at = now()
      where id = $1 returning *`, [em.id, seal(cert), info]);
  await audit(null, req, { entity: 'fiscal_emitter', entityId: em.id, action: 'certificado',
    summary: `Certificado A1 de ${em.name} salvo · titular ${info.name || '-'} · válido até ${info.valid_until.slice(0, 10)} · ${info.fingerprint.slice(0, 12)}` });
  res.json(publicEmitter(row));
});

r.delete('/:id/certificate', need('fiscal_settings'), async (req, res) => {
  const em = await loadEmitter(req.companyId, req.params.id);
  const row = await one('update fiscal_emitters set cert_enc = null, cert_info = null, updated_at = now() where id = $1 returning *', [em.id]);
  await audit(null, req, { entity: 'fiscal_emitter', entityId: em.id, action: 'remover_certificado', summary: `Certificado de ${em.name} apagado do TORVEN` });
  res.json(publicEmitter(row));
});

// ---------- emissor ----------
/** Envia empresa (e certificado, se houver) ao emissor escolhido. */
r.post('/:id/register', need('fiscal_settings'), async (req, res) => {
  const em = await loadEmitter(req.companyId, req.params.id);
  const p = PROVIDERS[em.provider];
  if (!p.register) throw bad(p.manual ? 'No registro manual não há cadastro a enviar.' : 'Este emissor não recebe cadastro pela API: cadastre a empresa no painel dele.');
  const problems = emitterProblems(em, em.docs?.nfe && !em.docs?.nfse ? 'nfe' : 'nfse');
  if (problems.length) throw bad(`Complete o cadastro antes de enviar: ${problems.join(' · ')}`);
  const sec = safeUnseal(em.secret_enc);
  const cert = em.cert_enc ? safeUnseal(em.cert_enc) : null;
  let out;
  try {
    out = await p.register({ em, sec, cert: cert?.base64 ? cert : null });
  } catch (e) {
    await q("update fiscal_emitters set sync_status = 'erro', sync_message = $2, updated_at = now() where id = $1", [em.id, String(e.message).slice(0, 500)]);
    await audit(null, req, { entity: 'fiscal_emitter', entityId: em.id, action: 'enviar_cadastro', summary: `Cadastro de ${em.name} recusado por ${p.name}: ${String(e.message).slice(0, 200)}` });
    throw e;
  }
  const merged = { ...sec, ...Object.fromEntries(Object.entries(out.secrets || {}).filter(([, v]) => v)) };
  const row = await one(
    `update fiscal_emitters set provider_ref = provider_ref || $2::jsonb, secret_enc = $3, sync_status = 'ok', sync_message = $4, synced_at = now(), updated_at = now()
      where id = $1 returning *`,
    [em.id, JSON.stringify(out.provider_ref || {}), Object.keys(merged).length ? seal(merged) : null, out.message || 'Cadastro enviado.']);
  await audit(null, req, { entity: 'fiscal_emitter', entityId: em.id, action: 'enviar_cadastro', summary: `Cadastro de ${em.name} enviado a ${p.name}${cert ? ' com certificado' : ''}` });
  res.json({ ...publicEmitter(row), message: out.message });
});

r.post('/:id/test', need('fiscal_settings'), async (req, res) => {
  const em = await loadEmitter(req.companyId, req.params.id);
  const p = PROVIDERS[em.provider];
  if (!p.test) return res.json({ ok: true, message: 'Registro manual: não há conexão a testar.' });
  const out = await p.test({ em, sec: safeUnseal(em.secret_enc) });
  await audit(null, req, { entity: 'fiscal_emitter', entityId: em.id, action: 'testar', summary: `Conexão de ${em.name} com ${p.name}: ok` });
  res.json({ ok: true, message: out.message });
});

/** Cria um emitente a partir da configuração antiga (Focus NFe na própria empresa). */
r.post('/import-legacy', need('fiscal_settings'), async (req, res) => {
  const c = await one('select * from companies where id = $1', [req.companyId]);
  const f = fiscalWithDefaults(c.fiscal);
  if (f.provider !== 'focus') throw bad('Não há configuração antiga da Focus NFe para trazer.');
  const exists = await one('select count(*)::int as n from fiscal_emitters where company_id = $1', [req.companyId]);
  if (exists.n) throw bad('Já existem emitentes cadastrados.');
  const cnpj = onlyDigits(c.document);
  if (cnpj.length !== 14) throw bad('O CNPJ da empresa não está preenchido nos dados da empresa.');
  const settings = Object.fromEntries(Object.keys(EMITTER_DEFAULTS).filter((k) => f[k] !== undefined).map((k) => [k, f[k]]));
  const secrets = Object.fromEntries(['token_homologacao', 'token_producao', 'account_token'].filter((k) => f[k]).map((k) => [k, f[k]]));
  const regime = !f.simplesNacional ? 'normal' : f.codigoOpcaoSimples === 2 ? 'mei' : 'simples';
  const em = await one(
    `insert into fiscal_emitters (company_id, name, cnpj, razao_social, nome_fantasia, ie, im, regime, email, phone, cep, street, number, complement, district,
       city, uf, city_code, provider, environment, docs, settings, secret_enc, provider_ref, is_default, sync_status, sync_message, next_dps_homologacao, next_dps_producao)
     values ($1,'Principal',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'focus',$18,$19,$20,$21,$22,true,'ok','Trazido da configuração anterior da Focus NFe',$23,$24) returning *`,
    [req.companyId, cnpj, c.name, c.trade_name, c.state_registration, c.municipal_registration, regime, c.email, c.phone, onlyDigits(c.cep) || null, c.street, c.number,
      c.complement, c.district, c.city, c.uf, onlyDigits(c.city_code) || null, f.environment, f.docs, settings, Object.keys(secrets).length ? seal(secrets) : null,
      f.focus_company_id ? { company_id: f.focus_company_id } : {}, f.nextDpsNumberHomologacao || 1, f.nextDpsNumber || 1]);
  await audit(null, req, { entity: 'fiscal_emitter', entityId: em.id, action: 'importar', summary: 'Configuração antiga da Focus NFe transformada no emitente "Principal"' });
  res.status(201).json(publicEmitter(em));
});

export default r;
