// Tabela FIPE gratuita (marcas, modelos, anos e preço de referência) para preencher o veículo sem consulta paga.
// Fonte: API FIPE v2 (fipe.parallelum.com.br) — sem cadastro: 500 consultas/dia; com token gratuito (FIPE_TOKEN): 1.000/dia.
// Tudo fica guardado em fipe_cache (dados públicos, compartilhados entre as empresas): cada lista é buscada uma vez por mês.
// Importante: a FIPE não consulta pela placa — ela traz a lista de modelos para escolher; a placa vem da foto/digitação.
import { q } from '../db.js';
import { HttpError } from '../util.js';

export const FIPE_TYPES = { cars: 'Carro / utilitário', motorcycles: 'Moto', trucks: 'Caminhão / ônibus' };
const BASE = () => (process.env.FIPE_URL || 'https://fipe.parallelum.com.br/api/v2').replace(/\/+$/, '');
const DAY = 86400000;
const ttlOf = (key) => (/\/years\/[^/]+$/.test(key) ? 7 * DAY : 30 * DAY); // preço muda todo mês; listas quase nunca

const memo = new Map(); // cache rápido no processo (evita ir ao banco a cada tecla)

async function upstream(key) {
  const headers = { accept: 'application/json' };
  if (process.env.FIPE_TOKEN) headers['X-Subscription-Token'] = process.env.FIPE_TOKEN;
  let res;
  try { res = await fetch(`${BASE()}/${key}`, { headers, redirect: 'error', signal: AbortSignal.timeout(10000) }); } catch {
    throw new HttpError(503, 'A Tabela FIPE não respondeu agora. Preencha marca e modelo à mão ou tente de novo.');
  }
  if (res.status === 429) throw new HttpError(429, 'A Tabela FIPE atingiu o limite gratuito de hoje. Preencha à mão; amanhã volta a funcionar.');
  if (res.status === 404) throw new HttpError(404, 'Item não encontrado na Tabela FIPE.');
  if (!res.ok) throw new HttpError(502, `A Tabela FIPE respondeu com erro (${res.status}).`);
  return res.json();
}

/** Busca com cache: memória → banco (dentro da validade) → API; se a API falhar, usa a cópia antiga. */
export async function fipe(key) {
  const now = Date.now();
  const m = memo.get(key);
  if (m && now - m.at < ttlOf(key)) return m.data;
  const { rows: [row] } = await q('select data, fetched_at from fipe_cache where key = $1', [key]);
  if (row && now - new Date(row.fetched_at).getTime() < ttlOf(key)) {
    memo.set(key, { data: row.data, at: new Date(row.fetched_at).getTime() });
    return row.data;
  }
  try {
    const data = await upstream(key);
    await q(`insert into fipe_cache (key, data, fetched_at) values ($1, $2, now())
             on conflict (key) do update set data = excluded.data, fetched_at = now()`, [key, JSON.stringify(data)]);
    memo.set(key, { data, at: now });
    if (memo.size > 3000) memo.clear();
    return data;
  } catch (e) {
    if (row) return row.data; // cópia antiga é melhor que nada
    throw e;
  }
}

const list = (data) => (Array.isArray(data) ? data : []).map((x) => ({ code: String(x.code ?? x.codigo ?? ''), name: String(x.name ?? x.nome ?? '') }))
  .filter((x) => x.code && x.name);

export const fipeBrands = async (type) => list(await fipe(`${type}/brands`)).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
export const fipeModels = async (type, brand) => list(await fipe(`${type}/brands/${brand}/models`)).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
export const fipeYears = async (type, brand, model) => list(await fipe(`${type}/brands/${brand}/models/${model}/years`));

/** Ficha do veículo no formato do TORVEN. */
export async function fipeInfo(type, brand, model, year) {
  const d = await fipe(`${type}/brands/${brand}/models/${model}/years/${year}`);
  const modelYear = Number(d.modelYear) && Number(d.modelYear) < 32000 ? String(d.modelYear) : null; // 32000 = zero km na FIPE
  return {
    brand: d.brand || null, model: d.model || null, model_year: modelYear, year: modelYear, fuel: d.fuel || null,
    fipe_code: d.codeFipe || null, fipe_price: d.price || null, fipe_reference: d.referenceMonth || null, fipe_type: type, source: 'fipe',
  };
}
