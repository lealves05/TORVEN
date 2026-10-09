// Importação de planilhas (clientes e OS antigas). A tela lê o arquivo (CSV ou Excel) e manda as linhas já como objetos.
// "Prévia" roda exatamente a mesma importação dentro de uma transação e desfaz no fim: o que a prévia mostra é o que acontece.
// Cada linha roda num SAVEPOINT: uma linha com erro não derruba as outras. Tudo fica num lote que pode ser desfeito.
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
const key = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

// nomes de coluna aceitos (o primeiro é o oficial do modelo)
const ALIASES = {
  nome: ['nome', 'cliente', 'nome_cliente', 'razao_social', 'nome_razao_social'],
  tipo: ['tipo', 'pessoa', 'tipo_pessoa'],
  cpf_cnpj: ['cpf_cnpj', 'cpf', 'cnpj', 'documento', 'cpf_ou_cnpj'],
  nome_fantasia: ['nome_fantasia', 'fantasia'],
  telefone: ['telefone', 'celular', 'fone', 'whatsapp', 'telefone_1'],
  telefone2: ['telefone2', 'telefone_2', 'outro_telefone', 'fone2'],
  email: ['email', 'e_mail'],
  cep: ['cep'],
  rua: ['rua', 'endereco', 'logradouro'],
  numero: ['numero', 'n', 'no'],
  complemento: ['complemento'],
  bairro: ['bairro'],
  cidade: ['cidade', 'municipio'],
  uf: ['uf', 'estado'],
  observacoes: ['observacoes', 'obs', 'observacao', 'notas'],
  placa: ['placa'],
  marca: ['marca'],
  modelo: ['modelo'],
  ano: ['ano', 'ano_modelo'],
  cor: ['cor'],
  // OS
  numero_antigo: ['numero_antigo', 'numero_os', 'os', 'n_os', 'numero_da_os', 'ordem'],
  data_abertura: ['data_abertura', 'data', 'abertura', 'entrada', 'data_entrada'],
  equipamento: ['equipamento', 'veiculo', 'objeto', 'item', 'aparelho'],
  problema: ['problema', 'defeito', 'relato', 'reclamacao', 'servico_solicitado'],
  diagnostico: ['diagnostico', 'laudo'],
  servico_executado: ['servico_executado', 'servicos', 'solucao', 'servico', 'descricao_servico'],
  valor_total: ['valor_total', 'valor', 'total', 'preco'],
  situacao: ['situacao', 'status'],
  data_entrega: ['data_entrega', 'entrega', 'entregue_em', 'data_saida'],
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
  [/entreg|finaliz|conclu|fechad|pago|retirad/, 'entregue'], [/cancel/, 'cancelada'], [/pront/, 'pronta'],
  [/execu|andamento|fazendo/, 'em_execucao'], [/aguardando.*(pe[cç]a|material)/, 'aguardando_material'],
  [/aguardando.*aprova|orcamento/, 'aguardando_aprovacao'], [/diagn/, 'diagnostico'], [/abert|nova|^$/, 'aberta'],
];
const mapStatus = (s, delivered) => {
  const t = key(s).replace(/_/g, ' ');
  if (!t) return delivered ? 'entregue' : 'aberta';
  for (const [re, st] of STATUS_MAP) if (re.test(t)) return st;
  return null;
};

class RowError extends Error {}
const fail = (m) => { throw new RowError(m); };

/** Acha o cliente pela ordem: CPF/CNPJ, telefone, nome igual. */
async function findCustomer(db, companyId, f) {
  const doc = onlyDigits(f.cpf_cnpj);
  if (doc.length >= 11) {
    const { rows: [c] } = await db.query("select * from customers where company_id = $1 and regexp_replace(coalesce(document,''),'\\D','','g') = $2 order by active desc limit 1", [companyId, doc]);
    if (c) return c;
  }
  const ph = onlyDigits(f.telefone);
  if (ph.length >= 10) {
    const { rows: [c] } = await db.query(
      "select * from customers where company_id = $1 and right(regexp_replace(coalesce(phone,''),'\\D','','g'), 10) = right($2, 10) order by active desc limit 1", [companyId, ph]);
    if (c) return c;
  }
  if (!doc && !ph && f.nome) {
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
  const kind = tipo.startsWith('pj') || tipo.includes('juridica') || doc.length === 14 ? 'pj' : 'pf';
  const uf = f.uf ? f.uf.toUpperCase().slice(0, 2) : null;
  return { kind, name: f.nome?.slice(0, 160), trade_name: f.nome_fantasia || null, document: doc || null, phone: f.telefone || null, phone2: f.telefone2 || null,
    email: f.email?.toLowerCase() || null, cep: f.cep || null, street: f.rua || null, number: f.numero || null, complement: f.complemento || null,
    district: f.bairro || null, city: f.cidade || null, uf, notes: f.observacoes || null };
}

async function upsertCustomer(db, ctx, f, { update }) {
  if (!f.nome || f.nome.length < 2) fail('falta o nome do cliente');
  const vals = customerValues(f);
  const cur = await findCustomer(db, ctx.companyId, f);
  if (cur) {
    if (!update) return { customer: cur, action: 'existente' };
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

/** Veículo/objeto do cliente: placa (com a regra de placa única) ou descrição. */
async function ensureEquipment(db, ctx, customerId, f) {
  const desc = f.equipamento || [f.marca, f.modelo].filter(Boolean).join(' ');
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
      if (other) fail(`a placa ${plate} já está no cadastro de ${other.name}`);
    }
  } else {
    const { rows: [same] } = await db.query('select id from equipment where company_id = $1 and customer_id = $2 and active and lower(description) = lower($3) limit 1', [ctx.companyId, customerId, desc]);
    if (same) return { id: same.id, created: false };
  }
  const { rows: [e] } = await db.query(
    `insert into equipment (company_id, customer_id, category, description, brand, model, year, plate, color, import_batch_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
    [ctx.companyId, customerId, plate ? 'Veículo' : 'Outros', (desc || `Veículo ${plate}`).slice(0, 160), f.marca || null, f.modelo || null, f.ano || null, plate, f.cor || null, ctx.batchId]);
  return { id: e.id, created: true };
}

async function importCustomerRow(db, ctx, f, opts) {
  const { customer, action } = await upsertCustomer(db, ctx, f, opts);
  if (action === 'existente') return { status: 'ignorado', message: 'cliente já cadastrado', name: customer.name };
  const eq = await ensureEquipment(db, ctx, customer.id, f);
  return { status: action === 'criado' ? 'criado' : action === 'atualizado' || eq?.created ? 'atualizado' : 'sem_mudanca', name: customer.name,
    message: [action === 'criado' ? 'cliente novo' : action === 'atualizado' ? 'dados atualizados' : 'já existia', eq?.created ? 'veículo/objeto incluído' : null].filter(Boolean).join(' · ') };
}

async function importOrderRow(db, ctx, f, opts) {
  if (!f.nome) fail('falta o nome do cliente');
  const opened = parseDateCell(f.data_abertura);
  if (opened === undefined) fail(`data de abertura "${f.data_abertura}" inválida (use dd/mm/aaaa)`);
  const delivered = parseDateCell(f.data_entrega);
  if (delivered === undefined) fail(`data de entrega "${f.data_entrega}" inválida (use dd/mm/aaaa)`);
  const total = parseMoneyCell(f.valor_total);
  if (total === undefined) fail(`valor "${f.valor_total}" inválido`);
  const status = mapStatus(f.situacao, !!delivered);
  if (!status) fail(`situação "${f.situacao}" não reconhecida (use aberta, em execução, pronta, entregue ou cancelada)`);
  if (f.numero_antigo) {
    const { rows: [dup] } = await db.query('select number from orders where company_id = $1 and legacy_number = $2 limit 1', [ctx.companyId, f.numero_antigo]);
    if (dup) return { status: 'ignorado', name: f.nome, message: `OS antiga ${f.numero_antigo} já importada (OS ${dup.number})` };
  }
  const { customer, action } = await upsertCustomer(db, ctx, f, { update: false });
  const eq = await ensureEquipment(db, ctx, customer.id, f);
  const number = await nextNumber(db, 'orders', ctx.companyId);
  const received = opened || delivered || new Date().toISOString().slice(0, 10);
  const doneAt = ['entregue', 'pronta'].includes(status) ? (delivered || received) : null;
  const { rows: [o] } = await db.query(
    `insert into orders (company_id, number, kind, customer_id, equipment_id, status, received_at, finished_at, delivered_at, cancelled_at,
            problem, diagnosis, solution, subtotal, total, notes, internal_notes, public_token, created_by, legacy_number, import_batch_id)
     values ($1,$2,'os',$3,$4,$5,$6::date + time '12:00',$7::date + time '12:00',$8::date + time '12:00',$9::date + time '12:00',
             $10,$11,$12,$13,$13,$14,$15,$16,$17,$18,$19) returning id, number`,
    [ctx.companyId, number, customer.id, eq?.id || null, status, received, doneAt, status === 'entregue' ? doneAt : null, status === 'cancelada' ? received : null,
      f.problema || null, f.diagnostico || null, f.servico_executado || null, total || 0, f.observacoes || null,
      `OS importada de planilha${f.numero_antigo ? ` (nº no sistema antigo: ${f.numero_antigo})` : ''}. Não gera lançamentos no financeiro.`,
      publicToken(), ctx.userId, f.numero_antigo || null, ctx.batchId]);
  if (total) {
    await db.query(
      `insert into order_items (order_id, position, kind, description, qty, unit_price, total) values ($1, 0, 'servico', $2, 1, $3, $3)`,
      [o.id, (f.servico_executado || f.problema || 'Serviço (importado)').slice(0, 300), total]);
  }
  await logEvent(db, o.id, { type: 'nota', message: `OS importada de planilha${f.numero_antigo ? ` (nº antigo ${f.numero_antigo})` : ''}`, userId: ctx.userId });
  return { status: 'criado', name: customer.name, message: `OS ${o.number}${f.numero_antigo ? ` (antiga ${f.numero_antigo})` : ''}${action === 'criado' ? ' · cliente novo' : ''}${eq?.created ? ' · veículo/objeto novo' : ''}` };
}

const bodySchema = z.object({
  rows: z.array(z.record(z.any())).min(1, 'a planilha está vazia').max(MAX_ROWS, `no máximo ${MAX_ROWS} linhas por vez`),
  filename: z.string().max(200).optional(),
  update: z.boolean().default(true), // clientes já cadastrados: atualizar com os dados da planilha
});

async function runImport(req, kind, d, { commit }) {
  const client = await pool.connect();
  const out = { total: d.rows.length, created: 0, updated: 0, skipped: 0, unchanged: 0, errors: 0, rows: [] };
  try {
    await client.query('begin');
    const { rows: [b] } = await client.query(
      'insert into import_batches (company_id, kind, filename, total, created_by) values ($1,$2,$3,$4,$5) returning id', [req.companyId, kind, d.filename || null, d.rows.length, req.user.id]);
    const ctx = { companyId: req.companyId, userId: req.user.id, batchId: b.id, uniqueVehicle: uniqueVehicleOn(req.settings) };
    for (let i = 0; i < d.rows.length; i += 1) {
      const f = pick(d.rows[i]);
      await client.query('savepoint linha');
      try {
        const res = kind === 'clientes' ? await importCustomerRow(client, ctx, f, { update: d.update }) : await importOrderRow(client, ctx, f, { update: d.update });
        await client.query('release savepoint linha');
        if (res.status === 'criado') out.created += 1; else if (res.status === 'atualizado') out.updated += 1;
        else if (res.status === 'ignorado') out.skipped += 1; else out.unchanged += 1;
        out.rows.push({ line: i + 2, ...res });
      } catch (e) {
        await client.query('rollback to savepoint linha');
        if (!(e instanceof RowError) && !e.status && !e.code) throw e;
        out.errors += 1;
        out.rows.push({ line: i + 2, status: 'erro', name: f.nome || '', message: e instanceof RowError ? e.message : (e.code === '23505' ? 'registro repetido' : e.message || 'erro nesta linha') });
      }
    }
    await client.query('update import_batches set created = $2, updated = $3, skipped = $4, errors = $5 where id = $1',
      [b.id, out.created, out.updated, out.skipped + out.unchanged, JSON.stringify(out.rows.filter((x) => x.status === 'erro').slice(0, 200))]);
    if (commit) {
      await client.query('commit');
      out.batch_id = b.id;
    } else await client.query('rollback');
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally { client.release(); }
  return out;
}

for (const kind of ['clientes', 'os']) {
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
      summary: `Importação de ${kind === 'os' ? 'OS' : 'clientes'} (${d.filename || 'planilha'}): ${out.created} criados, ${out.updated} atualizados, ${out.skipped + out.unchanged} sem mudança, ${out.errors} com erro` });
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
          and not exists (select 1 from transactions t where t.customer_id = c.id)`, [b.id, req.companyId]);
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
