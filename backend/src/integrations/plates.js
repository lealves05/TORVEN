// Consulta de placa (serviço pago, cadastrado pela empresa em Configurações › Integrações).
// Devolve só dados do VEÍCULO (marca, modelo, ano, cor, município/UF). Dados do proprietário não são obtidos (LGPD):
// nome e telefone do cliente são digitados no cadastro simples.
import dns from 'node:dns';
import net from 'node:net';
import { HttpError } from '../util.js';

export const PLATE_RE = /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/;
/** "abc-1d23" → "ABC1D23"; inválida → null. */
export function normalizePlate(v) {
  const p = String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return PLATE_RE.test(p) ? p : null;
}
/** ABC1D23 → "ABC1D23"; ABC1234 → "ABC-1234" (formato antigo). */
export const formatPlate = (p) => (/^[A-Z]{3}\d{4}$/.test(p) ? `${p.slice(0, 3)}-${p.slice(3)}` : p);

const get = (obj, path) => String(path || '').split('.').filter(Boolean).reduce((o, k) => (o == null ? undefined : o[k]), obj);
const str = (v) => (v == null || v === '' ? null : String(v).trim().slice(0, 120));

/** Campos de cada provedor (a tela de Integrações monta o formulário a partir disto). */
export const PLATE_PROVIDERS = {
  apiplacas: {
    name: 'API Placas (wdapi2.com.br)',
    site: 'https://apiplacas.com.br',
    help: 'Contrate um plano em apiplacas.com.br e cole aqui o token. Cada consulta é cobrada pelo provedor.',
    fields: [],
    secrets: [{ key: 'token', label: 'Token da API' }],
  },
  personalizado: {
    name: 'Outro serviço (personalizado)',
    help: 'Para qualquer provedor com resposta em JSON. Use {placa} no endereço; o token pode ir no endereço ({token}) ou num cabeçalho.',
    fields: [
      { key: 'url', label: 'Endereço da consulta', placeholder: 'https://api.exemplo.com.br/placa/{placa}', required: true },
      { key: 'method', label: 'Método', type: 'select', options: ['GET', 'POST'], default: 'GET' },
      { key: 'header', label: 'Cabeçalho do token (vazio se o token vai no endereço)', placeholder: 'Authorization' },
      { key: 'header_prefix', label: 'Prefixo do token no cabeçalho', placeholder: 'Bearer ' },
      { key: 'body', label: 'Corpo (POST), com {placa} e {token}', placeholder: '{"placa":"{placa}","token":"{token}"}' },
      { key: 'map_brand', label: 'Campo da marca', placeholder: 'marca' },
      { key: 'map_model', label: 'Campo do modelo', placeholder: 'modelo' },
      { key: 'map_year', label: 'Campo do ano', placeholder: 'ano' },
      { key: 'map_model_year', label: 'Campo do ano do modelo', placeholder: 'anoModelo' },
      { key: 'map_color', label: 'Campo da cor', placeholder: 'cor' },
      { key: 'map_city', label: 'Campo do município', placeholder: 'municipio' },
      { key: 'map_uf', label: 'Campo da UF', placeholder: 'uf' },
    ],
    secrets: [{ key: 'token', label: 'Token / chave da API' }],
  },
};

/** Opções comuns a todos os provedores. */
export const PLATE_COMMON = [
  { key: 'monthly_limit', label: 'Limite de consultas por mês', type: 'number', default: 200, min: 0, max: 100000 },
  { key: 'cache_days', label: 'Reaproveitar consulta da mesma placa por (dias)', type: 'number', default: 180, min: 0, max: 3650 },
  { key: 'price', label: 'Preço por consulta (informativo, R$)', type: 'number', default: 0, min: 0, max: 100, step: 0.01 },
];

/** Endereço de rede interna/reservada (IPv4, IPv6 e IPv4 dentro de IPv6). */
export function privateIp(ip) {
  let a = String(ip || '').toLowerCase().replace(/^\[|\]$/g, '');
  const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) a = mapped[1];
  if (net.isIPv4(a)) {
    const [x, y] = a.split('.').map(Number);
    return x === 0 || x === 10 || x === 127 || (x === 100 && y >= 64 && y <= 127) || (x === 169 && y === 254) || (x === 172 && y >= 16 && y <= 31)
      || (x === 192 && y === 168) || (x === 192 && y === 0) || (x === 198 && (y === 18 || y === 19)) || x >= 224;
  }
  if (net.isIPv6(a)) return a === '::' || a === '::1' || /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(a) || a.startsWith('::ffff:') || a.startsWith('64:ff9b:');
  return false;
}

/** Só https e só destino público: confere o nome e os IPs para onde ele aponta (bloqueia acesso à rede interna). */
export async function httpsOnly(u) {
  let x;
  try { x = new URL(u); } catch { throw new HttpError(400, 'Endereço da consulta inválido.'); }
  if (x.protocol !== 'https:') throw new HttpError(400, 'Use um endereço https:// para a consulta de placa.');
  if (x.username || x.password) throw new HttpError(400, 'Endereço da consulta não permitido.');
  const host = x.hostname.replace(/^\[|\]$/g, '');
  const denied = () => new HttpError(400, 'Endereço da consulta não permitido.');
  if (/^(localhost)$/i.test(host) || /\.(internal|local|localhost)$/i.test(host) || privateIp(host)) throw denied();
  if (!net.isIP(host)) {
    let addrs = [];
    try { addrs = await dns.promises.lookup(host, { all: true }); } catch (e) {
      if (e?.code === 'ENOTFOUND' || e?.code === 'EAI_AGAIN') throw new HttpError(400, 'Endereço da consulta não encontrado.');
      addrs = []; // ambiente sem resolução de nomes: fica a conferência pelo nome
    }
    if (addrs.some((r0) => privateIp(r0.address))) throw denied();
  }
  return x.toString();
}

async function fetchJson(url, init, timeoutMs = 12000) {
  let res;
  try { res = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) }); } catch {
    throw new HttpError(503, 'O serviço de consulta de placa não respondeu. Tente de novo ou cadastre manualmente.');
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  return { status: res.status, data };
}

/** Resultado padronizado: { found, vehicle: { brand, model, year, model_year, color, city, uf }, message } */
function vehicleFrom(raw, map) {
  const v = {
    brand: str(get(raw, map.brand)), model: str(get(raw, map.model)), year: str(get(raw, map.year)),
    model_year: str(get(raw, map.model_year)), color: str(get(raw, map.color)), city: str(get(raw, map.city)), uf: str(get(raw, map.uf)),
  };
  return v.brand || v.model ? v : null;
}

export async function lookupPlate(provider, cfg, secrets, plate) {
  if (provider === 'apiplacas') {
    if (!secrets.token) throw new HttpError(400, 'Token da API Placas não cadastrado.');
    const { status, data } = await fetchJson(`${(process.env.APIPLACAS_URL || 'https://wdapi2.com.br').replace(/\/+$/, '')}/consulta/${plate}/${encodeURIComponent(secrets.token)}`, { headers: { accept: 'application/json' } });
    if (status === 406) return { found: false, message: 'Placa não encontrada no serviço de consulta.' };
    if (status === 402) throw new HttpError(400, 'Token da API Placas recusado. Confira em Configurações › Integrações.');
    if (status === 429) throw new HttpError(429, 'Limite diário de consultas do provedor atingido.');
    if (status !== 200 || !data) throw new HttpError(502, `O serviço de consulta respondeu com erro (${status}).`);
    const vehicle = vehicleFrom(data, { brand: 'MARCA', model: 'MODELO', year: 'ano', model_year: 'anoModelo', color: 'cor', city: 'municipio', uf: 'uf' })
      || vehicleFrom(data, { brand: 'marca', model: 'modelo', year: 'ano', model_year: 'anoModelo', color: 'cor', city: 'municipio', uf: 'uf' });
    return vehicle ? { found: true, vehicle } : { found: false, message: 'O serviço não trouxe marca/modelo para esta placa.' };
  }
  if (provider === 'personalizado') {
    const token = secrets.token || '';
    const fill = (t) => String(t || '').replaceAll('{placa}', plate).replaceAll('{token}', encodeURIComponent(token));
    const url = await httpsOnly(fill(cfg.url));
    const headers = { accept: 'application/json' };
    if (cfg.header && token) headers[String(cfg.header).trim()] = `${cfg.header_prefix || ''}${token}`;
    const init = { method: cfg.method === 'POST' ? 'POST' : 'GET', headers };
    if (init.method === 'POST') { headers['content-type'] = 'application/json'; init.body = String(cfg.body || '').replaceAll('{placa}', plate).replaceAll('{token}', token); }
    const { status, data } = await fetchJson(url, init);
    if (status === 404 || status === 406) return { found: false, message: 'Placa não encontrada no serviço de consulta.' };
    if (status === 401 || status === 403 || status === 402) throw new HttpError(400, 'Token recusado pelo serviço de consulta.');
    if (status === 429) throw new HttpError(429, 'Limite de consultas do provedor atingido.');
    if (status < 200 || status >= 300 || !data) throw new HttpError(502, `O serviço de consulta respondeu com erro (${status}).`);
    const vehicle = vehicleFrom(data, {
      brand: cfg.map_brand || 'marca', model: cfg.map_model || 'modelo', year: cfg.map_year || 'ano', model_year: cfg.map_model_year || 'anoModelo',
      color: cfg.map_color || 'cor', city: cfg.map_city || 'municipio', uf: cfg.map_uf || 'uf',
    });
    return vehicle ? { found: true, vehicle } : { found: false, message: 'Resposta sem marca/modelo (confira o mapeamento dos campos).' };
  }
  throw new HttpError(400, 'Provedor de consulta de placa desconhecido.');
}
