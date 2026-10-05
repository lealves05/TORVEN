/**
 * Parâmetros editáveis pelo MASTER da central (contrato v1.1 — "settings" no manifesto).
 * Sistema: valem para todas as empresas (tabela system_settings). Empresa: companies.settings de cada empresa.
 * Campo: { key, label, type: boolean|number|text|textarea|select, group, help?, options?, min?, max?, step?, unit? }
 */
import { q, one } from './db.js';
import { HttpError, withDefaults } from './util.js';

const TIMEZONES = ['America/Sao_Paulo', 'America/Manaus', 'America/Cuiaba', 'America/Belem', 'America/Fortaleza', 'America/Recife',
  'America/Bahia', 'America/Porto_Velho', 'America/Rio_Branco', 'America/Noronha'].map((v) => ({ value: v, label: v.replace('America/', '').replace('_', ' ') }));

export const SYSTEM_FIELDS = [
  { key: 'signup_enabled', label: 'Novos cadastros abertos', type: 'boolean', group: 'Cadastro e demonstração', default: true,
    help: 'Desligado, a tela de cadastro e a ativação de demonstrações ficam fechadas (empresas existentes seguem normalmente).' },
  { key: 'demo_enabled', label: 'Botão "Experimentar demonstração"', type: 'boolean', group: 'Cadastro e demonstração', default: true },
  { key: 'demo_days', label: 'Dias até apagar demonstrações não ativadas', type: 'number', group: 'Cadastro e demonstração', min: 1, max: 30, step: 1, unit: 'dias', default: 7 },
  { key: 'default_warranty_days', label: 'Garantia padrão das OS', type: 'number', group: 'Padrões de empresas novas', min: 0, max: 3650, step: 1, unit: 'dias', default: 90 },
  { key: 'default_promise_days', label: 'Prazo de entrega padrão', type: 'number', group: 'Padrões de empresas novas', min: 0, max: 90, step: 1, unit: 'dias', default: 3 },
  { key: 'default_quote_validity_days', label: 'Validade padrão dos orçamentos', type: 'number', group: 'Padrões de empresas novas', min: 1, max: 180, step: 1, unit: 'dias', default: 15 },
  { key: 'notice_text', label: 'Aviso para todos os usuários', type: 'textarea', group: 'Comunicação', max: 300, default: '',
    help: 'Exibido no topo do TORVEN para todas as empresas. Deixe vazio para não mostrar.' },
  { key: 'notice_level', label: 'Tipo do aviso', type: 'select', group: 'Comunicação', default: 'info',
    options: [{ value: 'info', label: 'Informativo' }, { value: 'warn', label: 'Atenção' }] },
];

export const TENANT_FIELDS = [
  { key: 'trade_name', label: 'Nome fantasia', type: 'text', group: 'Empresa', max: 160 },
  { key: 'timezone', label: 'Fuso horário', type: 'select', group: 'Empresa', options: TIMEZONES },
  { key: 'orders_defaultWarrantyDays', label: 'Garantia padrão', type: 'number', group: 'Ordens de serviço', min: 0, max: 3650, step: 1, unit: 'dias' },
  { key: 'orders_defaultPromiseDays', label: 'Prazo de entrega padrão', type: 'number', group: 'Ordens de serviço', min: 0, max: 90, step: 1, unit: 'dias' },
  { key: 'orders_quoteValidityDays', label: 'Validade dos orçamentos', type: 'number', group: 'Ordens de serviço', min: 1, max: 180, step: 1, unit: 'dias' },
  { key: 'orders_requireInspection', label: 'Exigir inspeção de qualidade antes da entrega', type: 'boolean', group: 'Ordens de serviço' },
  { key: 'orders_requirePaymentToDeliver', label: 'Exigir pagamento para entregar', type: 'boolean', group: 'Ordens de serviço' },
  { key: 'orders_requireReceiver', label: 'Exigir nome de quem retirou', type: 'boolean', group: 'Ordens de serviço' },
  { key: 'orders_allowNegativeStock', label: 'Permitir estoque negativo', type: 'boolean', group: 'Estoque e financeiro' },
  { key: 'requireOpenCash', label: 'Exigir caixa aberto para receber', type: 'boolean', group: 'Estoque e financeiro' },
  { key: 'cardFeesAsExpense', label: 'Lançar taxas de cartão como despesa', type: 'boolean', group: 'Estoque e financeiro' },
  { key: 'quotes_taxRate', label: 'Impostos sobre orçamentos', type: 'number', group: 'Estoque e financeiro', min: 0, max: 50, step: 0.01, unit: '%' },
  { key: 'modules_publicLinks', label: 'Links públicos de acompanhamento', type: 'boolean', group: 'Recursos' },
  { key: 'modules_commissions', label: 'Comissões de técnicos', type: 'boolean', group: 'Recursos' },
];

const strip = ({ default: _d, ...f }) => f;
export const settingsManifest = () => ({ system: SYSTEM_FIELDS.map(strip), tenant: TENANT_FIELDS });
const bad = (m) => new HttpError(400, m);

function coerce(field, v) {
  if (v === null || v === undefined) return undefined;
  if (field.type === 'boolean') { if (typeof v !== 'boolean') throw bad(`${field.label}: valor inválido`); return v; }
  if (field.type === 'number') {
    const n = Number(v);
    if (!Number.isFinite(n) || (field.min != null && n < field.min) || (field.max != null && n > field.max)) throw bad(`${field.label}: use um valor entre ${field.min} e ${field.max}`);
    return n;
  }
  if (field.type === 'select') { if (!field.options.some((o) => o.value === v)) throw bad(`${field.label}: opção inválida`); return v; }
  const s = String(v).trim();
  if (field.max && s.length > field.max) throw bad(`${field.label}: máximo de ${field.max} caracteres`);
  return s;
}
function pick(fields, values) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw bad('Envie os parâmetros em "values".');
  const out = {};
  for (const [k, v] of Object.entries(values)) {
    const f = fields.find((x) => x.key === k);
    if (!f) throw bad(`Parâmetro desconhecido: ${k}`);
    const c = coerce(f, v);
    if (c !== undefined) out[k] = c;
  }
  return out;
}

let sysCache = { at: 0, v: null };
export async function getSystemParams() {
  if (sysCache.v && Date.now() - sysCache.at < 30000) return sysCache.v;
  const base = Object.fromEntries(SYSTEM_FIELDS.map((f) => [f.key, f.default]));
  try {
    const { rows } = await q('select key, value from system_settings');
    for (const r of rows) if (r.key in base) base[r.key] = r.value;
  } catch { /* tabela ainda não criada */ }
  sysCache = { at: Date.now(), v: base };
  return base;
}
export async function setSystemParams(values) {
  const clean = pick(SYSTEM_FIELDS, values);
  for (const [k, v] of Object.entries(clean)) {
    await q(`insert into system_settings (key, value, updated_at) values ($1, $2::jsonb, now())
             on conflict (key) do update set value = excluded.value, updated_at = now()`, [k, JSON.stringify(v)]);
  }
  sysCache.at = 0;
  return getSystemParams();
}

/** Aviso geral exibido a todas as empresas (ou null). */
export async function systemNotice() {
  const p = await getSystemParams();
  return p.notice_text ? { text: p.notice_text, level: p.notice_level === 'warn' ? 'warn' : 'info' } : null;
}

/** Configuração inicial de uma empresa nova conforme os padrões do sistema. */
export async function newCompanySettings(base) {
  const p = await getSystemParams();
  return { ...base, orders: { ...base.orders, defaultWarrantyDays: p.default_warranty_days, defaultPromiseDays: p.default_promise_days,
    quoteValidityDays: p.default_quote_validity_days } };
}

// caminho dentro de companies.settings para cada campo da empresa
const PATHS = Object.fromEntries(TENANT_FIELDS.filter((f) => !['trade_name'].includes(f.key)).map((f) => [f.key, f.key.split('_')]));

export async function getTenantParams(companyId) {
  const c = await one('select name, trade_name, settings from companies where id = $1', [companyId]);
  if (!c) return null;
  const s = withDefaults(c.settings);
  const out = { trade_name: c.trade_name || c.name };
  for (const [k, path] of Object.entries(PATHS)) out[k] = path.reduce((o, p) => (o == null ? o : o[p]), s) ?? null;
  return out;
}
export async function setTenantParams(db, companyId, values) {
  const clean = pick(TENANT_FIELDS, values);
  if (clean.trade_name != null && clean.trade_name.length < 2) throw bad('Nome fantasia muito curto.');
  const { rows: [c] } = await db.query('select settings from companies where id = $1 for no key update', [companyId]);
  const s = c?.settings && typeof c.settings === 'object' ? JSON.parse(JSON.stringify(c.settings)) : {};
  for (const [k, path] of Object.entries(PATHS)) {
    if (!(k in clean)) continue;
    if (path.length === 1) s[path[0]] = clean[k];
    else { s[path[0]] = { ...(s[path[0]] || {}), [path[1]]: clean[k] }; }
  }
  await db.query('update companies set settings = $2, trade_name = coalesce($3, trade_name) where id = $1', [companyId, s, clean.trade_name ?? null]);
  return clean;
}
