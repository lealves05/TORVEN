// Consulta de CNPJ (dados abertos da Receita via servidor) para preencher cadastros.
import { api } from './api';

const only = (v) => String(v || '').replace(/\D/g, '');

/** Devolve os dados do CNPJ ou { error }. Só chama com 14 dígitos. */
export async function lookupCnpj(doc) {
  const d = only(doc);
  if (d.length !== 14) return null;
  try { return await api.get(`/lookup/cnpj/${d}`); } catch (e) { return { error: e.message }; }
}

/** Preenche só os campos vazios do formulário (não apaga o que a pessoa digitou). */
export function fillEmpty(form, data, map) {
  const out = { ...form };
  for (const [to, from] of Object.entries(map)) {
    const v = typeof from === 'function' ? from(data) : data[from];
    if (v && !String(out[to] || '').trim()) out[to] = v;
  }
  return out;
}

/** Texto curto para mostrar embaixo do campo CNPJ. */
export const cnpjHint = (r) => (!r ? undefined : r.error ? r.error
  : `Receita Federal: ${r.situation || 'situação não informada'}${r.active ? '' : ' — atenção, CNPJ não está ativo'}${r.activity ? ` · ${r.activity}` : ''}`);
