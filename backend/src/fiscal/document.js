// Documento fiscal neutro montado a partir da OS e do emitente escolhido. Cada emissor (Focus, NFE.io, PlugNotas,
// Nuvem Fiscal, eNotas, API própria) converte este objeto para o formato dele.
import { onlyDigits, round2, validDocument } from '../util.js';
import { splitItems } from '../fiscal.js';

/** Parâmetros fiscais do emitente (com padrões). */
export const EMITTER_DEFAULTS = {
  nfseMode: 'nacional',          // nacional (NFS-e Nacional / DPS) | municipal (padrão da prefeitura)
  issRate: 2,
  issRetido: false,
  itemListaServico: '14.01',     // item da LC 116
  codigoTributacaoNacional: '140101',
  codigoTributarioMunicipio: '',
  cnae: '',
  regimeEspecial: 0,
  naturezaOperacao: 'Venda de mercadoria',
  cfopDentro: '5102',
  cfopFora: '6102',
  icmsSituacao: '102',           // CSOSN (Simples) ou CST
  pisCofinsSituacao: '07',
  serieNfe: 1,
  serieDps: 1,
};
export const emitterSettings = (em) => ({ ...EMITTER_DEFAULTS, ...(em?.settings || {}) });

const tzNow = () => {
  const local = new Date(Date.now() - 3 * 3600000);
  return `${local.toISOString().slice(0, 19)}-03:00`;
};

/** Problemas do cadastro do emitente para emitir (lista de textos). */
export function emitterProblems(em, kind) {
  const p = [];
  if (onlyDigits(em.cnpj).length !== 14 || !validDocument(em.cnpj)) p.push('CNPJ do emitente inválido');
  if (!em.razao_social) p.push('Razão social do emitente');
  if (onlyDigits(em.city_code).length !== 7) p.push('Código IBGE do município do emitente');
  if (!em.uf) p.push('UF do emitente');
  if (kind === 'nfse' && emitterSettings(em).nfseMode === 'municipal' && !em.im) p.push('Inscrição municipal (NFS-e)');
  if (kind === 'nfe' && !em.ie) p.push('Inscrição estadual (NF-e)');
  return p;
}

/**
 * Monta o documento neutro. `kind`: nfse | nfe.
 * @returns {{ kind, ref, issued_at, emitter, customer, amount, description, service?, nfe?, items, warnings }}
 */
export function buildDocument({ kind, em, order, customer, items, ref }) {
  const s = emitterSettings(em);
  const warnings = emitterProblems(em, kind);
  const split = splitItems(order, items);
  const doc = onlyDigits(customer?.document);
  if (doc && !validDocument(doc)) warnings.push('CPF/CNPJ do cliente inválido');
  const cust = customer ? {
    doc, type: doc.length === 14 ? 'pj' : 'pf', name: customer.name, email: customer.email || null, phone: onlyDigits(customer.phone) || null,
    ie: onlyDigits(customer.state_registration) || null, im: customer.municipal_registration || null,
    address: {
      street: customer.street || null, number: customer.number || 'S/N', complement: customer.complement || null, district: customer.district || null,
      city: customer.city || null, city_code: onlyDigits(customer.city_code) || null, uf: customer.uf || null, cep: onlyDigits(customer.cep) || null,
    },
  } : null;
  const emitter = {
    cnpj: onlyDigits(em.cnpj), razao_social: em.razao_social, nome_fantasia: em.nome_fantasia || em.razao_social, ie: onlyDigits(em.ie) || null,
    im: em.im || null, regime: em.regime, email: em.email || null, phone: onlyDigits(em.phone) || null, city_code: onlyDigits(em.city_code),
    city: em.city, uf: em.uf, cep: onlyDigits(em.cep), street: em.street, number: em.number, district: em.district, complement: em.complement || null,
  };
  const equip = [order.equipment_description, order.equipment_brand, order.equipment_model].filter(Boolean).join(' ');

  if (kind === 'nfse') {
    const services = split.filter((i) => !(['material', 'consumivel'].includes(i.kind) && i.product_id));
    const amount = round2(services.reduce((a, i) => a + i.net, 0));
    if (!services.length) warnings.push('A OS não tem serviços para a NFS-e.');
    if (!doc) warnings.push('CPF/CNPJ do cliente não informado.');
    const lines = services.map((i) => `${Number(i.qty) !== 1 ? `${Number(i.qty)} ${i.unit || ''} ` : ''}${i.description}`.trim());
    const description = [`OS nº ${order.number}${equip ? ` — ${equip}` : ''}`, ...lines].join('\n').slice(0, 2000);
    const lc116 = services.find((i) => i.service_code)?.service_code || s.itemListaServico;
    return {
      kind, ref, issued_at: tzNow(), emitter, customer: cust, amount, description, warnings,
      items: services.map((i) => ({ description: i.description, qty: Number(i.qty), unit: i.unit, unit_price: Number(i.unit_price), total: i.net })),
      service: {
        mode: s.nfseMode, lc116, national_code: String(s.codigoTributacaoNacional || onlyDigits(lc116).padEnd(6, '0')).slice(0, 6),
        municipal_code: s.codigoTributarioMunicipio || null, cnae: onlyDigits(s.cnae) || null, iss_rate: Number(s.issRate) || 0,
        iss_retained: !!s.issRetido, special_regime: Number(s.regimeEspecial) || 0, series_dps: Number(s.serieDps) || 1,
      },
    };
  }

  const mats = split.filter((i) => ['material', 'consumivel'].includes(i.kind) && i.product_id);
  if (!mats.length) warnings.push('A OS/venda não tem materiais para a NF-e.');
  if (!cust) warnings.push('NF-e exige cliente identificado.');
  if (cust && (!cust.address.street || !cust.address.city || !cust.address.uf || !cust.address.cep)) warnings.push('Endereço completo do cliente é obrigatório na NF-e.');
  const interstate = !!(cust?.address.uf && em.uf && cust.address.uf.toUpperCase() !== em.uf.toUpperCase());
  const cfop = interstate ? s.cfopFora : s.cfopDentro;
  const nfeItems = mats.map((i, k) => {
    if (!i.ncm) warnings.push(`Material "${i.description}" sem NCM.`);
    const qty = Number(i.qty);
    return {
      n: k + 1, code: i.sku || String(i.product_id || k + 1).slice(0, 60), description: i.description.slice(0, 120),
      ncm: onlyDigits(i.ncm) || '00000000', cfop: i.cfop || cfop, unit: (i.unit || 'UN').toUpperCase().slice(0, 6), qty,
      unit_price: Number(i.unit_price), gross: round2(qty * Number(i.unit_price)), discount: i.share_discount > 0 ? i.share_discount : 0,
      total: i.net, origin: Number(i.origin || 0), icms: String(s.icmsSituacao), pis_cofins: String(s.pisCofinsSituacao),
    };
  });
  const amount = round2(mats.reduce((a, i) => a + i.net, 0));
  return {
    kind, ref, issued_at: tzNow(), emitter, customer: cust, amount, description: `Venda/OS nº ${order.number}`, warnings, items: nfeItems,
    nfe: {
      natureza: s.naturezaOperacao, series: Number(s.serieNfe) || 1, interstate, gross: round2(nfeItems.reduce((a, i) => a + i.gross, 0)),
      crt: em.regime === 'normal' ? 3 : em.regime === 'mei' ? 4 : 1, final_consumer: !cust?.ie,
    },
  };
}
