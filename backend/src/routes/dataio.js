// Importação de planilhas (clientes, veículos e OS antigas). A tela lê o arquivo (CSV ou Excel) e manda as linhas já como objetos.
// "Prévia" roda exatamente a mesma importação dentro de uma transação e desfaz no fim: o que a prévia mostra é o que acontece.
// Cada linha (ou cada OS, quando a OS tem várias linhas de itens) roda num SAVEPOINT: um erro não derruba o resto.
// Tudo fica num lote que pode ser desfeito. Arquivos grandes vão em partes (a tela manda batch_id para continuar o lote).
// Aceita o modelo do TORVEN e também os nomes de coluna dos relatórios de outros sistemas (id_cliente, razaosocial,
// Ordem de servico, Codigo Cliente, Descricao Produtos Servicos, Localizacao...).
import { Router } from 'express';
import { z } from 'zod';
import { q, pool } from '../db.js';
import { need } from '../auth.js';
import { parse, notFound, bad, round2, onlyDigits, publicToken } from '../util.js';
import { audit } from '../audit.js';
import { nextNumber, logEvent } from '../domain.js';
import { normalizePlate, formatPlate } from '../integrations/plates.js';
import { uniqueVehicleOn } from '../vehicleRules.js';

const r = Router();
r.use(need('data_import'));

const MAX_ROWS = 5000;
const KINDS = ['clientes', 'veiculos', 'os'];
const LABEL = { clientes: 'clientes', veiculos: 'veículos', os: 'OS' };
const key = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

// nomes de coluna aceitos (o primeiro é o oficial do modelo do TORVEN)
const ALIASES = {
  codigo_antigo: ['codigo_antigo', 'codigo_cliente', 'id_cliente', 'cod_cliente', 'codigo_do_cliente'],
  nome: ['nome', 'cliente', 'nome_cliente', 'razao_social', 'razaosocial', 'nome_razao_social', 'nomefantasia'],
  tipo: ['tipo', 'pessoa', 'tipo_pessoa'],
  cpf_cnpj: ['cpf_cnpj', 'cpf', 'cnpj', 'documento', 'cpf_ou_cnpj'],
  nome_fantasia: ['nome_fantasia', 'fantasia', 'nomefantasia'],
  telefone: ['telefone', 'celular', 'fone', 'whatsapp', 'telefone_1', 'tel1', 'telefonecomercial', 'telefoneresidencial'],
  telefone2: ['telefone2', 'telefone_2', 'outro_telefone', 'fone2', 'tel2', 'telefoneresidencial', 'tel3'],
  email: ['email', 'e_mail'],
  cep: ['cep'],
  rua: ['rua', 'endereco', 'logradouro'],
  numero: ['numero', 'n', 'no'],
  complemento: ['complemento'],
  bairro: ['bairro'],
  cidade: ['cidade', 'municipio'],
  uf: ['uf', 'estado'],
  observacoes: ['observacoes', 'obs', 'observacao', 'notas'],
  ie: ['inscricao_estadual', 'ie', 'insc'],
  im: ['inscricao_municipal', 'im'],
  rg: ['rg'],
  nascimento: ['data_nascimento', 'datanascimento', 'nascimento'],
  cod_municipio: ['codigo_municipio', 'cmun', 'cod_municipio', 'ibge'],
  placa: ['placa'],
  marca: ['marca'],
  modelo: ['modelo'],
  versao: ['versao'],
  ano: ['ano', 'ano_modelo'],
  cor: ['cor'],
  chassi: ['chassi', 'chassis', 'serie', 'numero_de_serie'],
  // OS
  numero_antigo: ['numero_antigo', 'ordem_de_servico', 'numero_os', 'os', 'n_os', 'numero_da_os', 'ordem'],
  data_abertura: ['data_abertura', 'data_inclusao', 'data', 'abertura', 'entrada', 'data_entrada'],
  equipamento: ['equipamento', 'veiculo', 'objeto', 'item', 'aparelho'],
  problema: ['problema', 'defeito', 'relato', 'reclamacao', 'servico_solicitado'],
  diagnostico: ['diagnostico', 'laudo'],
  servico_executado: ['servico_executado', 'servicos', 'solucao', 'servico', 'descricao_servico'],
  valor_total: ['valor_total', 'valor', 'total', 'preco'],
  desconto: ['desconto', 'desconto_os'],
  situacao: ['situacao', 'status'],
  localizacao: ['localizacao', 'etapa'],
  data_entrega: ['data_entrega', 'entrega', 'entregue_em', 'data_saida', 'saida'],
  km: ['km', 'quilometragem', 'odometro'],
  tecnico: ['tecnico', 'funcionario', 'mecanico', 'responsavel'],
  // itens da OS (uma linha por item; as linhas da mesma OS repetem o número antigo)
  item_descricao: ['item_descricao', 'descricao_produtos_servicos', 'descricao_item', 'produto_servico', 'item_nome'],
  item_tipo: ['item_tipo', 'tipo_item'],
  item_quantidade: ['item_quantidade', 'quantidade', 'qtd', 'qtde'],
  item_valor_unitario: ['item_valor_unitario', 'valor_unitario', 'preco_unitario'],
  item_desconto: ['item_desconto', 'desconto_produtos_servicos', 'desconto_item'],
  item_aprovado: ['item_aprovado', 'aprovado'],
};
function pick(row) {
  const k = Object.fromEntries(Object.entries(row || {}).map(([a, b]) => [key(a), b]));
  const out = {};
  for (const [field, names] of Object.entries(ALIASES)) {
    for (const n of names) {
      const v = k[n];
      if (v != null && String(v).trim() !== '') { out[field] = String(v).trim(); break; }
    }
  }
  // "754 - SABINI MOTORS": código do cliente junto do nome (relatórios de outros sistemas)
  const m = out.nome?.match(/^(\d{1,9})\s*-\s*(.+)$/);
  if (m) { out.codigo_antigo = out.codigo_antigo || m[1]; out.nome = m[2].trim(); }
  if (out.ano?.includes('|')) out.ano = out.ano.split('|').map((y) => (y.length === 2 ? `20${y}` : y)).join('/');
  return out;
}

/** Data: 31/12/2025, 31-12-25, 2025-12-31 ou número de série do Excel. */
export function parseDateCell(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) {
    let y = +m[3]; if (y < 100) y += 2000;
    const d = new Date(Date.UTC(y, +m[2] - 1, +m[1]));
    if (d.getUTCDate() === +m[1] && d.getUTCMonth() === +m[2] - 1) return d.toISOString().slice(0, 10);
    return undefined;
  }
  if (/^\d{5}(\.\d+)?$/.test(s)) return new Date(Date.UTC(1899, 11, 30) + Math.floor(+s) * 86400000).toISOString().slice(0, 10);
  return undefined; // inválida
}
/** Valor: 1.234,56 · 1234,56 · 1234.56 · R$ 50 */
export function parseMoneyCell(v) {
  if (v == null || v === '') return null;
  let s = String(v).replace(/[R$\s]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? round2(n) : undefined;
}
const STATUS_MAP = [
  [/cancel/, 'cancelada'], [/pront/, 'pronta'], [/entreg|finaliz|conclu|fechad|pago|retirad/, 'entregue'],
  [/falta de pe|aguardando.*(pe[cç]a|material)|parado/, 'aguardando_material'],
  [/aguardando.*aprova|orcamento/, 'aguardando_aprovacao'], [/diagn/, 'diagnostico'],
  [/execu|andamento|fazendo|sendo feito|manuten|realizando|teste|supervis/, 'em_execucao'],
  [/abert|nova|estacion|elevador|aguardando|contato|^$/, 'aberta'],
];
const mapStatus = (s, delivered) => {
  const t = key(s).replace(/_/g, ' ');
  if (!t) return delivered ? 'entregue' : 'aberta';
  for (const [re, st] of STATUS_MAP) if (re.test(t)) return st;
  return null;
};
// item de OS: mão de obra/serviço ou peça (sem cadastro de material)
const itemKind = (f) => {
  const t = key(f.item_tipo || '');
  if (/serv|mao|m_o|mo$/.test(t)) return 'servico';
  if (/pe(c|ç)a|mat|prod/.test(t)) return 'material';
  return /^(mao_de_obra|m_o|mo|servico|serv|retifica|alinhamento|balanceamento|diagnostico|revisao|instala|regulag|limpeza|higieniza|funilaria|pintura|solda|terceir)/.test(key(f.item_descricao)) ? 'servico' : 'material';
};
const approvedItem = (v) => !v || /^(aprovado|sim|s|1|ok)$/i.test(String(v).trim());

class RowError extends Error {}
const fail = (m) => { throw new RowError(m); };

/** Acha o cliente pela ordem: código do sistema antigo, CPF/CNPJ, telefone, nome igual. */
async function findCustomer(db, companyId, f) {
  if (f.codigo_antigo) {
    const { rows: [c] } = await db.query(
      "select * from customers where company_id = $1 and $2 = any(string_to_array(legacy_code, ',')) order by active desc limit 1", [companyId, f.codigo_antigo]);
    if (c) return c;
  }
  const doc = onlyDigits(f.cpf_cnpj);
  if (doc.length >= 11) {
    const { rows: [c] } = await db.query("select * from customers where company_id = $1 and regexp_replace(coalesce(document,''),'\\D','','g') = $2 order by active desc limit 1", [companyId, doc]);
    if (c) return c;
  }
  const ph = onlyDigits(f.telefone);
  if (ph.length >= 10) {
    const { rows: [c] } = await db.query(
      "select * from customers where company_id = $1 and right(regexp_replace(coalesce(phone,''),'\\D','','g'), 10) = right($2, 10) and lower(name) = lower($3) order by active desc limit 1",
      [companyId, ph, f.nome || '']);
    if (c) return c;
  }
  if (!doc && f.nome) {
    const { rows: [c] } = await db.query('select * from customers where company_id = $1 and lower(name) = lower($2) order by active desc limit 1', [companyId, f.nome]);
    if (c) return c;
  }
  return null;
}

function customerValues(f) {
  const doc = onlyDigits(f.cpf_cnpj);
  if (f.cpf_cnpj && ![11, 14].includes(doc.length)) fail(`CPF/CNPJ "${f.cpf_cnpj}" inválido (precisa ter 11 ou 14 números)`);
  if (f.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) fail(`e-mail "${f.email}" inválido`);
  const tipo = key(f.tipo);
  const kind = tipo === '2' || tipo.startsWith('pj') || tipo.includes('juridica') || doc.length === 14 ? 'pj' : 'pf';
  const uf = f.uf ? f.uf.toUpperCase().slice(0, 2) : null;
  const fmtDoc = doc.length === 11 ? doc.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
    : doc.length === 14 ? doc.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5') : null;
  const birth = parseDateCell(f.nascimento);
  const notes = [f.observacoes, f.rg ? `RG: ${f.rg}` : null, birth ? `Nascimento: ${birth.split('-').reverse().join('/')}` : null].filter(Boolean).join(' · ') || null;
  const ie = f.ie && !/^isento$/i.test(f.ie) ? f.ie : (f.ie ? 'ISENTO' : null);
  return { kind, name: f.nome?.slice(0, 160), trade_name: f.nome_fantasia && f.nome_fantasia !== f.nome ? f.nome_fantasia : null, document: fmtDoc,
    state_registration: kind === 'pj' ? ie : null, municipal_registration: f.im || null, city_code: /^\d{7}$/.test(f.cod_municipio || '') ? f.cod_municipio : null,
    phone: f.telefone || null, phone2: f.telefone2 && f.telefone2 !== f.telefone ? f.telefone2 : null,
    email: f.email?.toLowerCase() || null, cep: f.cep || null, street: f.rua || null, number: f.numero || null, complement: f.complemento || null,
    district: f.bairro || null, city: f.cidade || null, uf, notes, legacy_code: f.codigo_antigo || null };
}

async function upsertCustomer(db, ctx, f, { update }) {
  if (!f.nome || f.nome.length < 2) fail('falta o nome do cliente');
  const vals = customerValues(f);
  const cur = await findCustomer(db, ctx.companyId, f);
  if (cur) {
    if (!update) {
      if (vals.legacy_code && !(cur.legacy_code || '').split(',').includes(vals.legacy_code)) {
        await db.query('update customers set legacy_code = $3 where id = $1 and company_id = $2', [cur.id, ctx.companyId, cur.legacy_code ? `${cur.legacy_code},${vals.legacy_code}` : vals.legacy_code]);
      }
      return { customer: cur, action: 'existente' };
    }
    // mesmo cliente com dois códigos no sistema antigo (cadastro repetido): guarda os dois para ligar veículos e OS
    if (vals.legacy_code && cur.legacy_code && !cur.legacy_code.split(',').includes(vals.legacy_code)) vals.legacy_code = `${cur.legacy_code},${vals.legacy_code}`;
    // dados que já existem não são apagados nem trocados por outros do cadastro repetido; só completa o que falta
    if (vals.legacy_code && cur.legacy_code && vals.legacy_code !== cur.legacy_code) for (const k of Object.keys(vals)) if (k !== 'legacy_code' && cur[k]) vals[k] = null;
    const keys = Object.keys(vals).filter((k) => vals[k] != null && k !== 'kind' && String(vals[k]) !== String(cur[k] ?? ''));
    if (keys.length) {
      await db.query(`update customers set ${keys.map((k, i) => `${k} = $${i + 3}`).join(', ')} where id = $1 and company_id = $2`, [cur.id, ctx.companyId, ...keys.map((k) => vals[k])]);
      return { customer: { ...cur, ...Object.fromEntries(keys.map((k) => [k, vals[k]])) }, action: 'atualizado' };
    }
    return { customer: cur, action: 'sem_mudanca' };
  }
  const cols = Object.keys(vals);
  const { rows: [c] } = await db.query(
    `insert into customers (company_id, import_batch_id, ${cols.join(',')}) values ($1, $2, ${cols.map((_, i) => `$${i + 3}`).join(',')}) returning *`,
    [ctx.companyId, ctx.batchId, ...cols.map((k) => vals[k])]);
  return { customer: c, action: 'criado' };
}

/**
 * Veículo/objeto do cliente: placa (com a regra de placa única) ou descrição.
 * soft: placa já em outro cadastro não é erro — devolve { conflict } (usado nas OS antigas: o carro pode ter sido vendido).
 */
async function ensureEquipment(db, ctx, customerId, f, { soft = false } = {}) {
  const model = [f.modelo, f.versao].filter(Boolean).join(' ');
  const desc = f.equipamento || [f.marca, model].filter(Boolean).join(' ');
  if (!f.placa && !desc) return null;
  let plate = null;
  if (f.placa) {
    const n = normalizePlate(f.placa);
    if (!n) fail(`placa "${f.placa}" inválida`);
    plate = formatPlate(n);
    const { rows: [mine] } = await db.query(
      "select id from equipment where company_id = $1 and customer_id = $2 and active and upper(regexp_replace(coalesce(plate,''),'[^A-Za-z0-9]','','g')) = $3 limit 1", [ctx.companyId, customerId, n]);
    if (mine) return { id: mine.id, created: false };
    if (ctx.uniqueVehicle) {
      const { rows: [other] } = await db.query(
        `select c.name from equipment e join customers c on c.id = e.customer_id where e.company_id = $1 and e.active
           and upper(regexp_replace(coalesce(e.plate,''),'[^A-Za-z0-9]','','g')) = $2 limit 1`, [ctx.companyId, n]);
      if (other && soft) return { id: null, conflict: `placa ${plate} está no cadastro de ${other.name}` };
      if (other) fail(`a placa ${plate} já está no cadastro de ${other.name}`);
    }
  } else {
    const { rows: [same] } = await db.query('select id from equipment where company_id = $1 and customer_id = $2 and active and lower(description) = lower($3) limit 1', [ctx.companyId, customerId, desc]);
    if (same) return { id: same.id, created: false };
  }
  const { rows: [e] } = await db.query(
    `insert into equipment (company_id, customer_id, category, description, brand, model, year, plate, color, serial, import_batch_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
    [ctx.companyId, customerId, plate || f.marca || f.modelo ? 'Veículo' : 'Outros', (desc || `Veículo ${plate}`).slice(0, 160), f.marca || null, model || null,
      f.ano || null, plate, f.cor || null, f.chassi && !/^\*+/.test(f.chassi) ? f.chassi : null, ctx.batchId]);
  return { id: e.id, created: true };
}

async function importCustomerRow(db, ctx, f, opts) {
  const { customer, action } = await upsertCustomer(db, ctx, f, opts);
  if (action === 'existente') return { status: 'ignorado', message: 'cliente já cadastrado', name: customer.name };
  const eq = await ensureEquipment(db, ctx, customer.id, f);
  return { status: action === 'criado' ? 'criado' : action === 'atualizado' || eq?.created ? 'atualizado' : 'sem_mudanca', name: customer.name,
    message: [action === 'criado' ? 'cliente novo' : action === 'atualizado' ? 'dados atualizados' : 'já existia', eq?.created ? 'veículo/objeto incluído' : null].filter(Boolean).join(' · ') };
}

/** Veículos: precisam achar o cliente (pelo código antigo, CPF/CNPJ ou nome). Não cria cliente. */
async function importVehicleRow(db, ctx, f) {
  if (!f.placa && !f.modelo && !f.marca && !f.equipamento) fail('linha sem placa, marca ou modelo');
  const cust = await findCustomer(db, ctx.companyId, f);
  if (!cust) fail(`cliente ${f.codigo_antigo ? `de código ${f.codigo_antigo} ` : ''}não encontrado — importe os clientes antes`);
  const eq = await ensureEquipment(db, ctx, cust.id, f);
  return eq?.created ? { status: 'criado', name: cust.name, message: `veículo ${[f.placa, f.marca, f.modelo].filter(Boolean).join(' ')} incluído` }
    : { status: 'sem_mudanca', name: cust.name, message: 'veículo já cadastrado' };
}

/** Uma OS (com uma ou mais linhas de itens). */
async function importOrderRow(db, ctx, group) {
  const f = group[0];
  if (!f.nome && !f.codigo_antigo) fail('falta o cliente');
  const opened = parseDateCell(f.data_abertura);
  if (opened === undefined) fail(`data de abertura "${f.data_abertura}" inválida (use dd/mm/aaaa)`);
  const delivered = parseDateCell(f.data_entrega);
  if (delivered === undefined) fail(`data de entrega "${f.data_entrega}" inválida (use dd/mm/aaaa)`);
  // a situação manda; sem situação, a data de saída indica entregue e, sem ela, vale a localização/etapa
  const status = f.situacao ? mapStatus(f.situacao, !!delivered) : delivered ? 'entregue' : mapStatus(f.localizacao, false);
  if (!status) fail(`situação "${f.situacao || f.localizacao}" não reconhecida (use aberta, em execução, pronta, entregue ou cancelada)`);
  if (f.numero_antigo) {
    const { rows: [dup] } = await db.query('select number from orders where company_id = $1 and legacy_number = $2 limit 1', [ctx.companyId, f.numero_antigo]);
    if (dup) return { status: 'ignorado', name: f.nome, message: `OS antiga ${f.numero_antigo} já importada (OS ${dup.number})` };
  }
  // itens: linhas com descrição; só os aprovados entram no valor (os recusados ficam anotados)
  const items = []; const declined = [];
  for (const it of group.filter((x) => x.item_descricao)) {
    const qty = parseMoneyCell(it.item_quantidade) ?? 1;
    const unit = parseMoneyCell(it.item_valor_unitario) ?? parseMoneyCell(it.valor_total);
    const disc = parseMoneyCell(it.item_desconto) || 0;
    if (unit === undefined || qty === undefined || !(qty > 0)) fail(`item "${it.item_descricao}" com quantidade ou valor inválido`);
    if (!approvedItem(it.item_aprovado)) { declined.push(`${it.item_descricao} (${it.item_aprovado})`); continue; }
    items.push({ kind: itemKind(it), description: it.item_descricao.slice(0, 300), qty, unit_price: unit || 0, discount: disc, total: round2(qty * (unit || 0) - disc) });
  }
  let total; const discount = parseMoneyCell(f.desconto) || 0;
  if (items.length) total = round2(items.reduce((a, x) => a + x.total, 0) - discount);
  else {
    total = parseMoneyCell(f.valor_total);
    if (total === undefined) fail(`valor "${f.valor_total}" inválido`);
    total = total || 0;
    if (total > 0) items.push({ kind: 'servico', description: (f.servico_executado || f.problema || 'Serviços e peças (total do sistema anterior)').slice(0, 300), qty: 1, unit_price: round2(total + discount), discount: 0, total: round2(total + discount) });
  }
  if (total < 0) fail('desconto maior que o valor da OS');
  const subtotal = round2(total + discount);
  if (!f.nome) {
    const { rows: [c] } = await db.query("select name from customers where company_id = $1 and $2 = any(string_to_array(legacy_code, ',')) limit 1", [ctx.companyId, f.codigo_antigo]);
    if (!c) fail(`cliente de código ${f.codigo_antigo} não encontrado — importe os clientes antes`);
    f.nome = c.name;
  }
  const { customer, action } = await upsertCustomer(db, ctx, f, { update: false });
  const eq = await ensureEquipment(db, ctx, customer.id, f, { soft: true });
  let technicianId = null;
  if (f.tecnico) {
    const name = f.tecnico.replace(/^\d+\s*-\s*/, '').trim();
    const { rows: [t] } = await db.query('select id from technicians where company_id = $1 and lower(name) = lower($2) limit 1', [ctx.companyId, name]);
    technicianId = t?.id || null;
  }
  // mantém o número da OS do sistema antigo quando estiver livre (a numeração continua de onde parou)
  let number = null;
  if (/^\d{1,9}$/.test(f.numero_antigo || '')) {
    await db.query('select id from companies where id = $1 for no key update', [ctx.companyId]);
    const { rows: [used] } = await db.query('select 1 from orders where company_id = $1 and number = $2', [ctx.companyId, +f.numero_antigo]);
    if (!used) number = +f.numero_antigo;
  }
  if (number == null) number = await nextNumber(db, 'orders', ctx.companyId);
  const received = opened || delivered || new Date().toISOString().slice(0, 10);
  const doneAt = ['entregue', 'pronta'].includes(status) ? (delivered || received) : null;
  const vehicleText = [f.placa && `Placa ${f.placa}`, [f.marca, f.modelo, f.versao].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
  const condition = [f.km && /\d/.test(f.km) ? `KM ${f.km}` : null, eq?.conflict ? `Veículo da OS: ${vehicleText} (${eq.conflict})` : null].filter(Boolean).join(' · ') || null;
  const internal = [`OS importada de planilha${f.numero_antigo ? ` (nº no sistema antigo: ${f.numero_antigo})` : ''}. Não gera lançamentos no financeiro.`,
    f.tecnico && !technicianId ? `Responsável no sistema antigo: ${f.tecnico.replace(/^\d+\s*-\s*/, '')}.` : null,
    f.situacao && f.localizacao ? `Situação no sistema antigo: ${f.situacao} / ${f.localizacao}.` : null,
    declined.length ? `Itens não aprovados no sistema antigo: ${declined.join('; ')}.` : null].filter(Boolean).join('\n');
  const { rows: [o] } = await db.query(
    `insert into orders (company_id, number, kind, customer_id, equipment_id, technician_id, status, received_at, finished_at, delivered_at, cancelled_at,
            problem, diagnosis, solution, condition, subtotal, discount, total, notes, internal_notes, public_token, created_by, legacy_number, import_batch_id)
     values ($1,$2,'os',$3,$4,$5,$6,$7::date + time '12:00',$8::date + time '12:00',$9::date + time '12:00',$10::date + time '12:00',
             $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23) returning id, number`,
    [ctx.companyId, number, customer.id, eq?.id || null, technicianId, status, received, doneAt, status === 'entregue' ? doneAt : null, status === 'cancelada' ? received : null,
      f.problema || null, f.diagnostico || null, f.servico_executado || null, condition, subtotal, discount, total, f.observacoes || null, internal,
      publicToken(), ctx.userId, f.numero_antigo || null, ctx.batchId]);
  for (let i = 0; i < items.length; i += 1) {
    const it = items[i];
    await db.query(
      'insert into order_items (order_id, position, kind, description, qty, unit_price, discount, total, technician_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [o.id, i, it.kind, it.description, it.qty, it.unit_price, it.discount, it.total, technicianId]);
  }
  await logEvent(db, o.id, { type: 'nota', message: `OS importada de planilha${f.numero_antigo ? ` (nº antigo ${f.numero_antigo})` : ''}`, userId: ctx.userId });
  return { status: 'criado', name: customer.name,
    message: `OS ${o.number}${f.numero_antigo ? ` (antiga ${f.numero_antigo})` : ''} · ${items.length} item(ns)${action === 'criado' ? ' · cliente novo' : ''}${eq?.created ? ' · veículo novo' : ''}${eq?.conflict ? ' · placa em outro cadastro (anotada na OS)' : ''}` };
}

const bodySchema = z.object({
  rows: z.array(z.record(z.any())).min(1, 'a planilha está vazia').max(MAX_ROWS, `no máximo ${MAX_ROWS} linhas por vez`),
  filename: z.string().max(200).optional(),
  update: z.boolean().default(true), // clientes já cadastrados: atualizar com os dados da planilha
  batch_id: z.string().uuid().optional(), // continuar o mesmo lote (arquivo enviado em partes)
  first_line: z.number().int().min(2).default(2), // número da 1ª linha desta parte na planilha
  total: z.number().int().min(1).optional(), // total de linhas do arquivo inteiro
});

/** OS: linhas seguidas com o mesmo número antigo formam uma OS (cabeçalho + itens). */
function groupRows(kind, rows) {
  const picked = rows.map((x, i) => ({ f: pick(x), i }));
  if (kind !== 'os') return picked.map((x) => ({ fs: [x.f], i: x.i }));
  const out = [];
  for (const x of picked) {
    const last = out[out.length - 1];
    if (last && x.f.numero_antigo && last.fs[0].numero_antigo === x.f.numero_antigo) last.fs.push(x.f);
    else out.push({ fs: [x.f], i: x.i });
  }
  return out;
}

async function runImport(req, kind, d, { commit }) {
  const client = await pool.connect();
  const out = { total: d.rows.length, created: 0, updated: 0, skipped: 0, unchanged: 0, errors: 0, rows: [] };
  try {
    await client.query('begin');
    let batchId;
    if (d.batch_id && commit) {
      const { rows: [b] } = await client.query('select id from import_batches where id = $1 and company_id = $2 and kind = $3 and undone_at is null for update', [d.batch_id, req.companyId, kind]);
      if (!b) throw notFound('Lote de importação não encontrado');
      batchId = b.id;
    } else {
      const { rows: [b] } = await client.query(
        'insert into import_batches (company_id, kind, filename, total, created_by) values ($1,$2,$3,$4,$5) returning id', [req.companyId, kind, d.filename || null, d.total || d.rows.length, req.user.id]);
      batchId = b.id;
    }
    const ctx = { companyId: req.companyId, userId: req.user.id, batchId, uniqueVehicle: uniqueVehicleOn(req.settings) };
    for (const g of groupRows(kind, d.rows)) {
      const line = d.first_line + g.i;
      await client.query('savepoint linha');
      try {
        const res = kind === 'clientes' ? await importCustomerRow(client, ctx, g.fs[0], { update: d.update })
          : kind === 'veiculos' ? await importVehicleRow(client, ctx, g.fs[0]) : await importOrderRow(client, ctx, g.fs);
        await client.query('release savepoint linha');
        if (res.status === 'criado') out.created += 1; else if (res.status === 'atualizado') out.updated += 1;
        else if (res.status === 'ignorado') out.skipped += 1; else out.unchanged += 1;
        out.rows.push({ line, ...res });
      } catch (e) {
        await client.query('rollback to savepoint linha');
        if (!(e instanceof RowError) && !e.status && !e.code) throw e;
        out.errors += 1;
        out.rows.push({ line, status: 'erro', name: g.fs[0].nome || g.fs[0].placa || '', message: e instanceof RowError ? e.message : (e.code === '23505' ? 'registro repetido' : e.message || 'erro nesta linha') });
      }
    }
    const errs = JSON.stringify(out.rows.filter((x) => x.status === 'erro').slice(0, 200));
    await client.query(
      `update import_batches set created = created + $2, updated = updated + $3, skipped = skipped + $4,
              errors = (case when jsonb_array_length(errors) < 500 then errors else '[]'::jsonb end) || $5::jsonb where id = $1`,
      [batchId, out.created, out.updated, out.skipped + out.unchanged, errs]);
    if (commit) {
      await client.query('commit');
      out.batch_id = batchId;
    } else await client.query('rollback');
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally { client.release(); }
  return out;
}

for (const kind of KINDS) {
  if (kind === 'os') r.use(`/${kind}`, need('orders_create'));
  r.post(`/${kind}/preview`, async (req, res) => {
    const d = parse(bodySchema, req.body);
    const out = await runImport(req, kind, d, { commit: false });
    res.json({ ...out, rows: out.rows.slice(0, 1000) });
  });
  r.post(`/${kind}/import`, async (req, res) => {
    const d = parse(bodySchema, req.body);
    const out = await runImport(req, kind, d, { commit: true });
    await audit(null, req, { entity: 'import', entityId: out.batch_id, action: 'create',
      summary: `Importação de ${LABEL[kind]} (${d.filename || 'planilha'}${d.batch_id ? ', continuação' : ''}): ${out.created} criados, ${out.updated} atualizados, ${out.skipped + out.unchanged} sem mudança, ${out.errors} com erro` });
    res.status(201).json({ ...out, rows: out.rows.filter((x) => x.status === 'erro').slice(0, 1000) });
  });
}

r.get('/imports', async (req, res) => {
  const { rows } = await q(
    `select b.id, b.kind, b.filename, b.total, b.created, b.updated, b.skipped, jsonb_array_length(b.errors) as errors, b.created_at, b.undone_at, u.name as user_name
       from import_batches b left join users u on u.id = b.created_by where b.company_id = $1 order by b.created_at desc limit 50`, [req.companyId]);
  res.json(rows);
});

/** Desfazer: apaga o que o lote CRIOU e ainda não foi usado (OS sem pagamento, clientes sem outras OS/orçamentos). */
r.post('/imports/:id/undo', async (req, res) => {
  const client = await pool.connect();
  let out;
  try {
    await client.query('begin');
    const { rows: [b] } = await client.query('select * from import_batches where id = $1 and company_id = $2 for update', [req.params.id, req.companyId]);
    if (!b) throw notFound('Importação não encontrada');
    if (b.undone_at) throw bad('Esta importação já foi desfeita.');
    const { rowCount: orders } = await client.query(
      `delete from orders o where o.import_batch_id = $1 and o.company_id = $2
          and not exists (select 1 from transactions t where t.order_id = o.id)
          and not exists (select 1 from invoices i where i.order_id = o.id)`, [b.id, req.companyId]);
    const { rowCount: equipment } = await client.query(
      'delete from equipment e where e.import_batch_id = $1 and e.company_id = $2 and not exists (select 1 from orders o where o.equipment_id = e.id)', [b.id, req.companyId]);
    const { rowCount: customers } = await client.query(
      `delete from customers c where c.import_batch_id = $1 and c.company_id = $2
          and not exists (select 1 from orders o where o.customer_id = c.id)
          and not exists (select 1 from quotes x where x.customer_id = c.id)
          and not exists (select 1 from transactions t where t.customer_id = c.id)
          and not exists (select 1 from equipment e where e.customer_id = c.id and (e.import_batch_id is distinct from $1))`, [b.id, req.companyId]);
    await client.query('update import_batches set undone_at = now() where id = $1', [b.id]);
    await client.query('commit');
    out = { orders, equipment, customers };
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally { client.release(); }
  await audit(null, req, { entity: 'import', entityId: req.params.id, action: 'undo',
    summary: `Importação desfeita: ${out.orders} OS, ${out.customers} cliente(s) e ${out.equipment} veículo(s)/objeto(s) removidos` });
  res.json(out);
});

export default r;
