// Consultas públicas para preencher cadastros. CNPJ: dados abertos da Receita Federal via BrasilAPI (gratuito, sem chave).
// Só o número do CNPJ sai do sistema; nada é gravado sem a pessoa salvar o cadastro.
import { Router } from 'express';
import { bad, HttpError } from '../util.js';
import { hit } from '../security.js';

const r = Router();
const URL_CNPJ = () => (process.env.CNPJ_API_URL || 'https://brasilapi.com.br/api/cnpj/v1').replace(/\/$/, '');

/** CNPJ válido (dígitos verificadores). */
export function validCnpj(v) {
  const d = String(v || '').replace(/\D/g, '');
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const calc = (n) => {
    let s = 0; let w = n - 7;
    for (let i = 0; i < n; i += 1) { s += Number(d[i]) * w; w = w === 2 ? 9 : w - 1; }
    const r2 = s % 11;
    return r2 < 2 ? 0 : 11 - r2;
  };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}
const title = (s) => String(s || '').toLowerCase().replace(/(^|\s|\/|-)(\S)/g, (m, a, b) => a + b.toUpperCase()).replace(/\b(De|Da|Do|Das|Dos|E)\b/g, (m) => m.toLowerCase());

r.get('/cnpj/:cnpj', async (req, res) => {
  const d = String(req.params.cnpj || '').replace(/\D/g, '');
  if (!validCnpj(d)) throw bad('CNPJ inválido. Confira os 14 números.');
  if ((await hit(`cnpj:${req.companyId}`, 300, 86400)).blocked) throw new HttpError(429, 'Limite diário de consultas de CNPJ atingido.');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10000);
  let j;
  try {
    const resp = await fetch(`${URL_CNPJ()}/${d}`, { signal: ctl.signal, headers: { accept: 'application/json' } });
    if (resp.status === 404) throw new HttpError(404, 'CNPJ não encontrado na Receita Federal.');
    if (!resp.ok) throw new HttpError(502, 'A consulta de CNPJ está fora do ar agora. Preencha manualmente ou tente mais tarde.');
    j = await resp.json();
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(502, 'A consulta de CNPJ não respondeu. Preencha manualmente ou tente mais tarde.');
  } finally { clearTimeout(timer); }
  const phone = String(j.ddd_telefone_1 || '').replace(/\D/g, '');
  const cep = String(j.cep || '').replace(/\D/g, '');
  res.json({
    document: d, name: j.razao_social || null, trade_name: j.nome_fantasia || null,
    situation: j.descricao_situacao_cadastral || null, active: String(j.descricao_situacao_cadastral || '').toUpperCase() === 'ATIVA',
    opened_at: j.data_inicio_atividade || null, activity: j.cnae_fiscal_descricao || null,
    email: j.email ? String(j.email).toLowerCase() : null, phone: phone.length >= 10 ? phone : null,
    cep: cep.length === 8 ? `${cep.slice(0, 5)}-${cep.slice(5)}` : null,
    street: [j.descricao_tipo_de_logradouro, j.logradouro].filter(Boolean).map(title).join(' ') || null, number: j.numero || null,
    complement: j.complemento ? title(j.complemento) : null, district: j.bairro ? title(j.bairro) : null,
    city: j.municipio ? title(j.municipio) : null, uf: j.uf || null, city_code: j.codigo_municipio_ibge ? String(j.codigo_municipio_ibge) : null,
  });
});

export default r;
