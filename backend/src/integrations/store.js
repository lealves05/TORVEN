// Configuração das integrações da empresa (consulta de placa, maquininhas). Segredos cifrados; nunca vão ao navegador.
import { q } from '../db.js';
import { seal, unseal, mask } from '../secretbox.js';

export async function getIntegration(companyId, kind, provider) {
  const { rows: [r] } = await q('select * from integration_configs where company_id = $1 and kind = $2 and provider = $3', [companyId, kind, provider]);
  return r || null;
}

/** Configuração + segredos já decifrados (uso interno do servidor). */
export async function loadIntegration(companyId, kind, provider) {
  const r = await getIntegration(companyId, kind, provider);
  if (!r) return null;
  return { ...r, secrets: unseal(r.secret_enc) };
}

export async function listIntegrations(companyId, kind) {
  const { rows } = await q('select * from integration_configs where company_id = $1 and kind = $2', [companyId, kind]);
  return rows;
}

/**
 * Salva configuração. Segredos vazios mantêm o valor atual; `null` explícito apaga.
 * @param {string[]} secretFields nomes dos campos secretos do provedor
 */
export async function saveIntegration(companyId, kind, provider, { enabled, config, secrets }, secretFields, userId) {
  const cur = await loadIntegration(companyId, kind, provider).catch(() => null);
  const merged = { ...(cur?.secrets || {}) };
  for (const f of secretFields) {
    const v = secrets?.[f];
    if (v === null) delete merged[f];
    else if (typeof v === 'string' && v.trim()) merged[f] = v.trim();
  }
  await q(`insert into integration_configs (company_id, kind, provider, enabled, config, secret_enc, updated_by, updated_at)
           values ($1,$2,$3,$4,$5,$6,$7, now())
           on conflict (company_id, kind, provider) do update set enabled = excluded.enabled, config = excluded.config,
             secret_enc = excluded.secret_enc, updated_by = excluded.updated_by, updated_at = now()`,
  [companyId, kind, provider, !!enabled, config || {}, Object.keys(merged).length ? seal(merged) : null, userId]);
  return publicView({ provider, enabled: !!enabled, config: config || {}, secrets: merged, updated_at: new Date() }, secretFields);
}

/** O que a tela recebe: configuração e, dos segredos, só se existem e o final mascarado. */
export function publicView(r, secretFields) {
  const secrets = r.secrets || {};
  return {
    provider: r.provider, enabled: !!r.enabled, config: r.config || {}, updated_at: r.updated_at || null,
    secrets: Object.fromEntries(secretFields.map((f) => [f, { set: !!secrets[f], hint: mask(secrets[f]) }])),
  };
}
