// Integração com a Focus NFe (https://focusnfe.com.br) — NFS-e (nacional ou municipal) e NF-e.
// Documentação: https://doc.focusnfe.com.br  ·  Autenticação: HTTP Basic, token como usuário e senha vazia.
import { onlyDigits, round2, fiscalWithDefaults } from './util.js';

const BASE = {
  homologacao: process.env.FOCUS_URL_HOMOLOGACAO || 'https://homologacao.focusnfe.com.br',
  producao: process.env.FOCUS_URL_PRODUCAO || 'https://api.focusnfe.com.br',
};

export const focusBase = (env) => BASE[env] || BASE.homologacao;

/** Chamada HTTP genérica à Focus NFe (Basic auth: token como usuário, senha vazia). */
export async function focusCall({ env, token }, method, path, body) {
  const res = await fetch(`${focusBase(env)}/v2${path}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${token}:`).toString('base64')}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  }).catch((e) => { throw Object.assign(new Error(`Falha ao conectar na Focus NFe: ${e.message}`), { status: 502 }); });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { mensagem: text.slice(0, 500) }; }
  return { status: res.status, data, headers: res.headers };
}

/** Chamada com o token da empresa no ambiente configurado (emissão/consulta/cancelamento). */
export async function focusRequest(fiscal, method, path, body) {
  const f = fiscalWithDefaults(fiscal);
  const token = f.environment === 'producao' ? f.token_producao : f.token_homologacao;
  if (!token) throw Object.assign(new Error(`Token da Focus NFe (${f.environment === 'producao' ? 'produção' : 'homologação'}) não configurado.`), { status: 400 });
  return focusCall({ env: f.environment, token }, method, path, body);
}

/** API de empresas: sempre no ambiente de produção, com o token principal da conta. */
export async function focusAccount(fiscal, method, path, body) {
  const f = fiscalWithDefaults(fiscal);
  if (!f.account_token) throw Object.assign(new Error('Informe o token principal da conta Focus NFe.'), { status: 400 });
  return focusCall({ env: 'producao', token: f.account_token }, method, path, body);
}

/** Converte o status da Focus para o status interno. */
export function mapStatus(s) {
  if (s === 'autorizado') return 'autorizada';
  if (s === 'cancelado') return 'cancelada';
  if (['erro_autorizacao', 'denegado', 'erro_cancelamento'].includes(s)) return s === 'erro_cancelamento' ? null : 'erro';
  if (s === 'processando_autorizacao') return 'processando';
  return null;
}

export function errorMessage(data) {
  if (!data) return null;
  if (Array.isArray(data.erros) && data.erros.length) return data.erros.map((e) => e.mensagem || e.codigo).join(' · ');
  return data.mensagem_sefaz || data.mensagem || data.codigo || null;
}

/** Extrai número, chave e links da resposta de consulta. */
export function extractDoc(data, env) {
  const abs = (p) => (!p ? null : /^https?:/.test(p) ? p : `${focusBase(env)}${p}`);
  return {
    number: data.numero ?? data.numero_nfse ?? null,
    series: data.serie ?? null,
    access_key: data.chave_nfe ?? data.chave_acesso ?? null,
    verification_code: data.codigo_verificacao ?? null,
    pdf_url: abs(data.url_danfse || data.caminho_danfe || data.url),
    xml_url: abs(data.caminho_xml_nota_fiscal),
  };
}

const tzDate = (d = new Date()) => {
  // ISO com offset -03:00 (horário de Brasília)
  const local = new Date(d.getTime() - 3 * 3600000);
  return `${local.toISOString().slice(0, 19)}-03:00`;
};

// ---------------------------------------------------------------------------
// Montagem das notas a partir da OS
// ---------------------------------------------------------------------------

/** Rateia o desconto geral da OS proporcionalmente entre os itens. */
export function splitItems(order, items) {
  const gross = items.reduce((a, i) => a + Number(i.total), 0);
  const factor = gross > 0 ? Number(order.discount || 0) / gross : 0;
  return items.map((i) => ({ ...i, net: round2(Number(i.total) * (1 - factor)), share_discount: round2(Number(i.total) * factor + Number(i.discount || 0)) }));
}

export function buildNfse({ company, customer, order, items, fiscal, dpsNumber }) {
  const f = fiscalWithDefaults(fiscal);
  const services = splitItems(order, items).filter((i) => !(['material', 'consumivel'].includes(i.kind) && i.product_id));
  const amount = round2(services.reduce((a, i) => a + i.net, 0));
  const warnings = [];
  if (!services.length) warnings.push('A OS não tem serviços para a NFS-e.');
  if (!onlyDigits(company.document) || onlyDigits(company.document).length !== 14) warnings.push('CNPJ da empresa não cadastrado (Configurações › Empresa).');
  if (!company.city_code) warnings.push('Código IBGE do município da empresa não informado.');
  if (f.nfseMode === 'municipal' && !company.municipal_registration) warnings.push('Inscrição municipal da empresa não informada.');
  const doc = onlyDigits(customer?.document);
  if (!doc) warnings.push('CPF/CNPJ do cliente não informado.');
  const lines = services.map((i) => `${Number(i.qty) !== 1 ? `${Number(i.qty)} ${i.unit || ''} ` : ''}${i.description}`.trim());
  const equip = [order.equipment_description, order.equipment_brand, order.equipment_model].filter(Boolean).join(' ');
  const descricao = [`OS nº ${order.number}${equip ? ` — ${equip}` : ''}`, ...lines].join('\n').slice(0, 2000);
  const code = services.find((i) => i.service_code)?.service_code || f.itemListaServico;

  let payload;
  let endpoint;
  if (f.nfseMode === 'nacional') {
    endpoint = 'nfsen';
    payload = {
      data_emissao: tzDate(),
      data_competencia: tzDate().slice(0, 10),
      serie_dps: f.serieDps,
      numero_dps: dpsNumber,
      emitente_dps: 1,
      codigo_municipio_emissora: Number(company.city_code) || undefined,
      cnpj_prestador: onlyDigits(company.document),
      inscricao_municipal_prestador: company.municipal_registration || undefined,
      codigo_opcao_simples_nacional: f.simplesNacional ? f.codigoOpcaoSimples : 1,
      regime_especial_tributacao: f.regimeEspecial,
      ...(doc.length === 14 ? { cnpj_tomador: doc } : doc ? { cpf_tomador: doc } : {}),
      razao_social_tomador: customer?.name,
      email_tomador: customer?.email || undefined,
      telefone_tomador: onlyDigits(customer?.phone) || undefined,
      cep_tomador: onlyDigits(customer?.cep) || undefined,
      codigo_municipio_tomador: customer?.city_code ? Number(customer.city_code) : undefined,
      logradouro_tomador: customer?.street || undefined,
      numero_tomador: customer?.number || undefined,
      complemento_tomador: customer?.complement || undefined,
      bairro_tomador: customer?.district || undefined,
      codigo_municipio_prestacao: Number(company.city_code) || undefined,
      codigo_tributacao_nacional_iss: (f.codigoTributacaoNacional || onlyDigits(code).padEnd(6, '0')).slice(0, 6),
      codigo_tributacao_municipal_iss: f.codigoTributarioMunicipio || undefined,
      descricao_servico: descricao,
      valor_servico: amount,
      tributacao_iss: 1,
      tipo_retencao_iss: f.issRetido ? 2 : 1,
      ...(f.simplesNacional ? {} : { percentual_aliquota_relativa_municipio: f.issRate }),
    };
  } else {
    endpoint = 'nfse';
    payload = {
      data_emissao: tzDate(),
      natureza_operacao: '1',
      optante_simples_nacional: !!f.simplesNacional,
      prestador: {
        cnpj: onlyDigits(company.document),
        inscricao_municipal: company.municipal_registration,
        codigo_municipio: company.city_code,
      },
      tomador: {
        ...(doc.length === 14 ? { cnpj: doc } : { cpf: doc }),
        razao_social: customer?.name,
        email: customer?.email || undefined,
        telefone: onlyDigits(customer?.phone) || undefined,
        endereco: customer?.street ? {
          logradouro: customer.street, numero: customer.number || 'S/N', complemento: customer.complement || undefined,
          bairro: customer.district, codigo_municipio: customer.city_code, uf: customer.uf, cep: onlyDigits(customer.cep),
        } : undefined,
      },
      servico: {
        valor_servicos: amount,
        iss_retido: !!f.issRetido,
        aliquota: f.issRate,
        item_lista_servico: code,
        codigo_tributario_municipio: f.codigoTributarioMunicipio || undefined,
        codigo_cnae: f.cnae || undefined,
        discriminacao: descricao,
        codigo_municipio: company.city_code,
      },
    };
  }
  return { endpoint, payload: JSON.parse(JSON.stringify(payload)), amount, warnings, items: services, description: descricao };
}

export function buildNfe({ company, customer, order, items, fiscal }) {
  const f = fiscalWithDefaults(fiscal);
  const mats = splitItems(order, items).filter((i) => ['material', 'consumivel'].includes(i.kind) && i.product_id);
  const warnings = [];
  if (!mats.length) warnings.push('A OS/venda não tem materiais para a NF-e.');
  if (onlyDigits(company.document).length !== 14) warnings.push('CNPJ da empresa não cadastrado.');
  const doc = onlyDigits(customer?.document);
  if (!customer) warnings.push('NF-e exige cliente identificado.');
  if (customer && (!customer.street || !customer.city || !customer.uf || !customer.cep)) warnings.push('Endereço completo do cliente é obrigatório na NF-e.');
  const interstate = customer?.uf && company.uf && customer.uf.toUpperCase() !== company.uf.toUpperCase();
  const cfop = interstate ? f.cfopFora : f.cfopDentro;
  const ie = onlyDigits(customer?.state_registration);
  const nfeItems = mats.map((i, k) => {
    if (!i.ncm) warnings.push(`Material "${i.description}" sem NCM.`);
    const qty = Number(i.qty);
    return {
      numero_item: k + 1,
      codigo_produto: i.sku || String(i.product_id || k + 1).slice(0, 60),
      descricao: i.description.slice(0, 120),
      cfop: i.cfop || cfop,
      codigo_ncm: onlyDigits(i.ncm) || '00000000',
      unidade_comercial: (i.unit || 'UN').toUpperCase().slice(0, 6),
      quantidade_comercial: qty,
      valor_unitario_comercial: Number(i.unit_price),
      valor_bruto: round2(qty * Number(i.unit_price)),
      unidade_tributavel: (i.unit || 'UN').toUpperCase().slice(0, 6),
      quantidade_tributavel: qty,
      valor_unitario_tributavel: Number(i.unit_price),
      valor_desconto: i.share_discount > 0 ? i.share_discount : undefined,
      icms_origem: Number(i.origin || 0),
      icms_situacao_tributaria: f.icmsSituacao,
      pis_situacao_tributaria: f.pisCofinsSituacao,
      cofins_situacao_tributaria: f.pisCofinsSituacao,
    };
  });
  const amount = round2(mats.reduce((a, i) => a + i.net, 0));
  const gross = round2(nfeItems.reduce((a, i) => a + i.valor_bruto, 0));
  const payload = {
    natureza_operacao: f.naturezaOperacao,
    data_emissao: tzDate(),
    data_entrada_saida: tzDate(),
    tipo_documento: 1,
    finalidade_emissao: 1,
    local_destino: interstate ? 2 : 1,
    consumidor_final: ie ? 0 : 1,
    presenca_comprador: 1,
    cnpj_emitente: onlyDigits(company.document),
    inscricao_estadual_emitente: onlyDigits(company.state_registration) || undefined,
    nome_destinatario: customer?.name,
    ...(doc.length === 14 ? { cnpj_destinatario: doc } : doc ? { cpf_destinatario: doc } : {}),
    inscricao_estadual_destinatario: ie || undefined,
    indicador_inscricao_estadual_destinatario: ie ? 1 : 9,
    logradouro_destinatario: customer?.street,
    numero_destinatario: customer?.number || 'S/N',
    complemento_destinatario: customer?.complement || undefined,
    bairro_destinatario: customer?.district,
    municipio_destinatario: customer?.city,
    uf_destinatario: customer?.uf,
    cep_destinatario: onlyDigits(customer?.cep),
    telefone_destinatario: onlyDigits(customer?.phone) || undefined,
    email_destinatario: customer?.email || undefined,
    valor_produtos: gross,
    valor_desconto: round2(gross - amount) || undefined,
    valor_total: amount,
    modalidade_frete: 9,
    items: nfeItems,
    formas_pagamento: [{ forma_pagamento: '99', valor_pagamento: amount }],
  };
  return { endpoint: 'nfe', payload: JSON.parse(JSON.stringify(payload)), amount, warnings, items: mats, description: `Venda/OS nº ${order.number}` };
}
