// Configurações › Integrações: serviço de consulta de placa e maquininhas de cartão (cadastro, teste e terminais).
import { Router } from 'express';
import { z } from 'zod';
import { q, tx } from '../db.js';
import { need } from '../auth.js';
import { parse, notFound, bad } from '../util.js';
import { audit } from '../audit.js';
import { listIntegrations, loadIntegration, saveIntegration, publicView } from '../integrations/store.js';
import { unseal } from '../secretbox.js';
import { PLATE_PROVIDERS, PLATE_COMMON, lookupPlate } from '../integrations/plates.js';
import { TERMINAL_PROVIDERS, describeProvider } from '../integrations/terminals.js';

const r = Router();
const s = z.string().trim();

const safeUnseal = (enc) => { try { return unseal(enc); } catch { return {}; } };
const viewRow = (row, secretFields) => publicView({ ...row, secrets: safeUnseal(row.secret_enc) }, secretFields);

// ---------------- Consulta de placa ----------------
r.get('/plates', need('integrations', 'customers_edit', 'orders_create'), async (req, res) => {
  const rows = await listIntegrations(req.companyId, 'placa');
  const active = rows.find((x) => x.enabled) || null;
  const { rows: [m] } = await q(`select count(*) filter (where ok)::int as ok, count(*)::int as total from plate_lookups
                                  where company_id = $1 and provider <> 'cache' and created_at >= date_trunc('month', now())`, [req.companyId]);
  res.json({
    providers: Object.entries(PLATE_PROVIDERS).map(([id, p]) => ({ id, name: p.name, help: p.help, site: p.site || null, fields: p.fields, secrets: p.secrets })),
    common: PLATE_COMMON,
    configs: rows.map((row) => viewRow(row, (PLATE_PROVIDERS[row.provider]?.secrets || []).map((x) => x.key))),
    active: active ? { provider: active.provider, name: PLATE_PROVIDERS[active.provider]?.name } : null,
    month: m,
  });
});

const configSchema = z.object({
  enabled: z.boolean().default(false),
  config: z.record(z.string().max(60), z.union([z.string().max(600), z.number(), z.boolean(), z.null()])).default({}),
  secrets: z.record(z.string().max(60), z.string().max(400).nullable()).default({}),
});

r.put('/plates/:provider', need('integrations'), async (req, res) => {
  const p = PLATE_PROVIDERS[req.params.provider];
  if (!p) throw notFound('Provedor desconhecido');
  const d = parse(configSchema, req.body);
  for (const f of p.fields) if (f.required && d.enabled && !String(d.config[f.key] || '').trim()) throw bad(`Preencha: ${f.label}.`);
  // só um serviço de placa ativo por empresa
  if (d.enabled) await q("update integration_configs set enabled = false where company_id = $1 and kind = 'placa' and provider <> $2", [req.companyId, req.params.provider]);
  const out = await saveIntegration(req.companyId, 'placa', req.params.provider, d, p.secrets.map((x) => x.key), req.user.id);
  await audit(null, req, { entity: 'integracao', entityId: req.companyId, action: 'update', summary: `Consulta de placa: ${p.name}${d.enabled ? ' (ativa)' : ''}` });
  res.json(out);
});

r.post('/plates/:provider/test', need('integrations'), async (req, res) => {
  const p = PLATE_PROVIDERS[req.params.provider];
  if (!p) throw notFound('Provedor desconhecido');
  const d = parse(z.object({ plate: s.min(7).max(8) }), req.body);
  const plate = d.plate.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const cfg = await loadIntegration(req.companyId, 'placa', req.params.provider);
  if (!cfg) throw bad('Salve a configuração antes de testar.');
  const out = await lookupPlate(req.params.provider, cfg.config || {}, cfg.secrets || {}, plate);
  await q('insert into plate_lookups (company_id, plate, provider, ok, data, message, user_id) values ($1,$2,$3,$4,$5,$6,$7)',
    [req.companyId, plate, req.params.provider, !!out.found, out.vehicle || null, out.message || 'teste', req.user.id]);
  res.json(out);
});

// ---------------- Maquininhas ----------------
r.get('/terminals', need('integrations', 'checkout'), async (req, res) => {
  const rows = await listIntegrations(req.companyId, 'maquininha');
  const { rows: devices } = await q('select * from payment_terminals where company_id = $1 and active order by is_default desc, lower(name)', [req.companyId]);
  res.json({
    providers: Object.keys(TERMINAL_PROVIDERS).map(describeProvider),
    configs: rows.map((row) => viewRow(row, (TERMINAL_PROVIDERS[row.provider]?.secrets || []).map((x) => x.key))),
    devices,
  });
});

r.put('/terminals/:provider', need('integrations'), async (req, res) => {
  const p = TERMINAL_PROVIDERS[req.params.provider];
  if (!p) throw notFound('Provedor desconhecido');
  const d = parse(configSchema, req.body);
  for (const f of p.fields) if (f.required && d.enabled && !String(d.config[f.key] || '').trim()) throw bad(`Preencha: ${f.label}.`);
  const out = await saveIntegration(req.companyId, 'maquininha', req.params.provider, d, p.secrets.map((x) => x.key), req.user.id);
  await audit(null, req, { entity: 'integracao', entityId: req.companyId, action: 'update', summary: `Maquininha: ${p.name}${d.enabled ? ' (ativa)' : ' (desligada)'}` });
  res.json(out);
});

/** Lista as maquininhas da conta no provedor (quando o provedor oferece). */
r.get('/terminals/:provider/devices', need('integrations'), async (req, res) => {
  const p = TERMINAL_PROVIDERS[req.params.provider];
  if (!p?.listDevices) throw bad('Este provedor não lista as maquininhas pela API. Informe a identificação manualmente.');
  const cfg = await loadIntegration(req.companyId, 'maquininha', req.params.provider);
  if (!cfg) throw bad('Salve as credenciais antes.');
  res.json(await p.listDevices({ config: cfg.config || {}, secrets: cfg.secrets || {} }));
});

const deviceSchema = z.object({
  provider: z.enum(Object.keys(TERMINAL_PROVIDERS)), name: s.min(2).max(80), external_id: s.max(120).nullable().optional(),
  is_default: z.boolean().default(false), active: z.boolean().default(true),
});

r.post('/devices', need('integrations'), async (req, res) => {
  const d = parse(deviceSchema, req.body);
  const row = await tx(async (db) => {
    if (d.is_default) await db.query('update payment_terminals set is_default = false where company_id = $1', [req.companyId]);
    const { rows: [x] } = await db.query(
      'insert into payment_terminals (company_id, provider, name, external_id, is_default, active) values ($1,$2,$3,$4,$5,$6) returning *',
      [req.companyId, d.provider, d.name, d.external_id || null, d.is_default, d.active]);
    return x;
  });
  await audit(null, req, { entity: 'maquininha', entityId: row.id, action: 'create', summary: `Maquininha cadastrada: ${d.name}` });
  res.status(201).json(row);
});

r.put('/devices/:id', need('integrations'), async (req, res) => {
  const d = parse(deviceSchema, req.body);
  const row = await tx(async (db) => {
    const { rows: [cur] } = await db.query('select id from payment_terminals where id = $1 and company_id = $2', [req.params.id, req.companyId]);
    if (!cur) throw notFound('Maquininha não encontrada');
    if (d.is_default) await db.query('update payment_terminals set is_default = false where company_id = $1 and id <> $2', [req.companyId, cur.id]);
    const { rows: [x] } = await db.query(
      'update payment_terminals set provider=$3, name=$4, external_id=$5, is_default=$6, active=$7 where id=$1 and company_id=$2 returning *',
      [cur.id, req.companyId, d.provider, d.name, d.external_id || null, d.is_default, d.active]);
    return x;
  });
  res.json(row);
});

r.delete('/devices/:id', need('integrations'), async (req, res) => {
  const { rowCount } = await q('update payment_terminals set active = false, is_default = false where id = $1 and company_id = $2', [req.params.id, req.companyId]);
  if (!rowCount) throw notFound('Maquininha não encontrada');
  res.json({ ok: true });
});

export default r;
