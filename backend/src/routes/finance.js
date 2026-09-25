// Financeiro gerencial: contas, transferências, conciliação bancária (OFX/CSV), fluxo de caixa projetado e DRE.
import { Router } from 'express';
import { z } from 'zod';
import { q, one, tx } from '../db.js';
import { need } from '../auth.js';
import { parse, notFound, bad, round2 } from '../util.js';
import { audit } from '../audit.js';

const r = Router();
r.use(need('cash', 'reports'));

export const TRANSFER_CATEGORY = 'Transferência entre contas';
const s = z.string().trim();
const opt = s.nullable().optional();
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// ---------- Contas ----------
const balances = (companyId) => q(
  `select a.*, a.opening_balance
            + coalesce(sum(case when t.type = 'entrada' then t.amount else -t.amount end) filter (where t.paid_at is not null), 0) as balance,
          count(t.id) filter (where t.paid_at is not null and t.reconciled_at is null)::int as unreconciled
     from financial_accounts a left join transactions t on t.account_id = a.id
    where a.company_id = $1 group by a.id order by a.active desc, a.is_default_cash desc, a.is_default_bank desc, lower(a.name)`, [companyId]);

r.get('/accounts', async (req, res) => res.json((await balances(req.companyId)).rows));

const accSchema = z.object({
  name: s.min(2, 'informe o nome'), kind: z.enum(['caixa', 'banco', 'cartao', 'aplicacao', 'outro']),
  bank_name: opt, agency: opt, account_number: opt, opening_balance: z.coerce.number().default(0),
  is_default_cash: z.boolean().optional(), is_default_bank: z.boolean().optional(), active: z.boolean().default(true),
});

async function saveAccount(db, req, d, id = null) {
  if (d.is_default_cash) await db.query('update financial_accounts set is_default_cash = false where company_id = $1', [req.companyId]);
  if (d.is_default_bank) await db.query('update financial_accounts set is_default_bank = false where company_id = $1', [req.companyId]);
  const vals = [d.name, d.kind, d.bank_name || null, d.agency || null, d.account_number || null, d.opening_balance, !!d.is_default_cash, !!d.is_default_bank, d.active];
  if (id) {
    const { rows: [a] } = await db.query(
      `update financial_accounts set name=$3, kind=$4, bank_name=$5, agency=$6, account_number=$7, opening_balance=$8, is_default_cash=$9,
              is_default_bank=$10, active=$11 where id=$1 and company_id=$2 returning *`, [id, req.companyId, ...vals]);
    if (!a) throw notFound('Conta não encontrada');
    return a;
  }
  const { rows: [a] } = await db.query(
    `insert into financial_accounts (company_id, name, kind, bank_name, agency, account_number, opening_balance, is_default_cash, is_default_bank, active)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`, [req.companyId, ...vals]);
  return a;
}

r.post('/accounts', need('cash'), async (req, res) => {
  const d = parse(accSchema, req.body);
  const a = await tx((db) => saveAccount(db, req, d));
  await audit(null, req, { entity: 'cash', entityId: a.id, action: 'account_create', summary: `Conta financeira "${a.name}" criada (saldo inicial ${a.opening_balance})` });
  res.status(201).json(a);
});

r.put('/accounts/:id', need('cash'), async (req, res) => {
  const d = parse(accSchema, req.body);
  const cur = await one('select * from financial_accounts where id = $1 and company_id = $2', [req.params.id, req.companyId]);
  if (!cur) throw notFound();
  if (!d.active && (d.is_default_cash || d.is_default_bank)) throw bad('A conta padrão não pode ser desativada.');
  const a = await tx((db) => saveAccount(db, req, d, cur.id));
  const { rows: [chk] } = await q(
    'select bool_or(is_default_cash) as c, bool_or(is_default_bank) as b from financial_accounts where company_id = $1 and active', [req.companyId]);
  if (!chk.c || !chk.b) {
    await saveAccount({ query: q }, req, { ...cur, active: cur.active, is_default_cash: cur.is_default_cash, is_default_bank: cur.is_default_bank, opening_balance: Number(cur.opening_balance) }, cur.id);
    throw bad('Mantenha uma conta padrão para dinheiro e outra para as demais formas de pagamento.');
  }
  await audit(null, req, { entity: 'cash', entityId: a.id, action: 'account_update', summary: `Conta financeira "${a.name}" alterada`,
    data: Number(cur.opening_balance) !== Number(a.opening_balance) ? { opening_balance: { before: Number(cur.opening_balance), after: Number(a.opening_balance) } } : null });
  res.json(a);
});

// ---------- Transferências ----------
r.post('/transfers', need('cash'), async (req, res) => {
  const d = parse(z.object({ from_id: z.string().uuid(), to_id: z.string().uuid(), amount: z.coerce.number().positive(), date: ymd.optional(), description: opt }), req.body);
  if (d.from_id === d.to_id) throw bad('Escolha contas diferentes.');
  const out = await tx(async (db) => {
    const { rows } = await db.query('select id, name from financial_accounts where company_id = $1 and id = any($2) and active', [req.companyId, [d.from_id, d.to_id]]);
    if (rows.length !== 2) throw notFound('Conta não encontrada');
    const name = (id) => rows.find((x) => x.id === id).name;
    const { rows: [{ id: transferId }] } = await db.query('select gen_random_uuid() as id');
    const when = d.date ? `${d.date}T12:00:00-03:00` : new Date().toISOString();
    for (const [type, acc, other] of [['saida', d.from_id, d.to_id], ['entrada', d.to_id, d.from_id]]) {
      await db.query(
        `insert into transactions (company_id, type, category, description, amount, method, due_date, paid_at, account_id, transfer_id, auto, created_by)
         values ($1,$2,$3,$4,$5,'transferencia',$6::timestamptz::date,$6::timestamptz,$7,$8,true,$9)`,
        [req.companyId, type, TRANSFER_CATEGORY, d.description || `${type === 'saida' ? 'Para' : 'De'} ${name(other)}`, d.amount, when, acc, transferId, req.user.id]);
    }
    await audit(db, req, { entity: 'cash', entityId: transferId, action: 'transfer', summary: `Transferência de ${d.amount} de "${name(d.from_id)}" para "${name(d.to_id)}"` });
    return transferId;
  });
  res.status(201).json({ transfer_id: out, accounts: (await balances(req.companyId)).rows });
});

// ---------- Extratos (OFX/CSV) ----------
const brNumber = (v) => {
  const t = String(v).trim().replace(/[R$\s]/g, '');
  if (/^-?\d{1,3}(\.\d{3})*,\d+$/.test(t) || /^-?\d+,\d+$/.test(t)) return Number(t.replace(/\./g, '').replace(',', '.'));
  return Number(t.replace(/,/g, ''));
};
const toYmd = (v) => {
  const t = String(v).trim();
  let m = t.match(/^(\d{4})(\d{2})(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
};

/** Lê OFX (SGML ou XML) — STMTTRN com DTPOSTED, TRNAMT, FITID, MEMO/NAME. */
export function parseOfx(text) {
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  const tag = (b, t) => { const m = b.match(new RegExp(`<${t}>([^<\\r\\n]*)`, 'i')); return m ? m[1].trim() : null; };
  return blocks.map((b) => ({
    posted_on: toYmd(tag(b, 'DTPOSTED') || ''), amount: brNumber(tag(b, 'TRNAMT') || 'NaN'), fitid: tag(b, 'FITID'),
    description: [tag(b, 'NAME'), tag(b, 'MEMO')].filter(Boolean).join(' — ') || null,
  }));
}

/** CSV: data;descrição;valor (aceita ; ou , como separador, cabeçalho opcional, valor em formato brasileiro). */
export function parseCsv(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const sep = (lines[0] || '').split(';').length >= 3 ? ';' : ',';
  const out = [];
  for (const l of lines) {
    const cols = l.split(sep).map((c) => c.replace(/^"|"$/g, '').trim());
    const date = toYmd(cols[0]);
    if (!date) continue; // cabeçalho
    const amount = brNumber(cols[cols.length - 1]);
    out.push({ posted_on: date, amount, description: cols.slice(1, -1).join(' ') || null, fitid: null });
  }
  return out;
}

r.post('/statements', need('cash'), async (req, res) => {
  const d = parse(z.object({ account_id: z.string().uuid(), filename: opt, content: s.min(10, 'arquivo vazio').max(3_000_000) }), req.body);
  const acc = await one('select id, name from financial_accounts where id = $1 and company_id = $2', [d.account_id, req.companyId]);
  if (!acc) throw notFound('Conta não encontrada');
  const isOfx = /<OFX>|<STMTTRN>/i.test(d.content);
  const lines = (isOfx ? parseOfx(d.content) : parseCsv(d.content)).filter((l) => l.posted_on && Number.isFinite(l.amount) && l.amount !== 0);
  if (!lines.length) throw bad('Nenhum lançamento reconhecido. Use OFX do banco ou CSV com colunas data;descrição;valor.');
  const out = await tx(async (db) => {
    const dates = lines.map((l) => l.posted_on).sort();
    const { rows: [st] } = await db.query(
      `insert into bank_statements (company_id, account_id, filename, format, period_start, period_end, imported_by)
       values ($1,$2,$3,$4,$5,$6,$7) returning *`, [req.companyId, acc.id, d.filename || null, isOfx ? 'ofx' : 'csv', dates[0], dates.at(-1), req.user.id]);
    let added = 0;
    let dup = 0;
    for (const l of lines) {
      if (!l.fitid) {
        const { rows: [ex] } = await db.query(
          'select 1 from statement_lines where account_id = $1 and fitid is null and posted_on = $2 and amount = $3 and coalesce(description,\'\') = coalesce($4,\'\') limit 1',
          [acc.id, l.posted_on, round2(l.amount), l.description]);
        if (ex) { dup += 1; continue; }
      }
      const { rowCount } = await db.query(
        `insert into statement_lines (company_id, statement_id, account_id, posted_on, amount, description, fitid) values ($1,$2,$3,$4,$5,$6,$7)
         on conflict (account_id, fitid) where fitid is not null do nothing`,
        [req.companyId, st.id, acc.id, l.posted_on, round2(l.amount), l.description, l.fitid]);
      if (rowCount) added += 1; else dup += 1;
    }
    await db.query('update bank_statements set lines_count = $2 where id = $1', [st.id, added]);
    await audit(db, req, { entity: 'cash', entityId: st.id, action: 'statement_import', summary: `Extrato importado em "${acc.name}": ${added} lançamento(s)${dup ? `, ${dup} já importado(s)` : ''}` });
    return { ...st, lines_count: added, duplicates: dup };
  });
  res.status(201).json(out);
});

r.get('/statements', async (req, res) => {
  const { rows } = await q(
    `select b.*, a.name as account_name,
            (select count(*) from statement_lines l where l.statement_id = b.id and l.status = 'pendente')::int as pending
       from bank_statements b join financial_accounts a on a.id = b.account_id where b.company_id = $1 order by b.imported_at desc limit 200`, [req.companyId]);
  res.json(rows);
});

/** Candidatos: mesmo valor e sentido, não conciliados, data de pagamento/vencimento até 5 dias de diferença. */
async function candidates(db, line) {
  const { rows } = await db.query(
    `select t.id, t.type, t.category, t.description, t.amount, t.method, t.due_date, t.paid_at, t.account_id,
            c.name as customer_name, s.name as supplier_name, o.number as order_number,
            abs(coalesce(t.paid_at::date, t.due_date) - $4::date) as days
       from transactions t left join customers c on c.id = t.customer_id left join suppliers s on s.id = t.supplier_id
       left join orders o on o.id = t.order_id
      where t.company_id = $1 and t.reconciled_at is null and t.amount = $2 and t.type = $3
        and (t.account_id = $5 or t.account_id is null or t.paid_at is null)
        and abs(coalesce(t.paid_at::date, t.due_date, current_date) - $4::date) <= 5
      order by days, t.paid_at nulls last limit 5`,
    [line.company_id, Math.abs(Number(line.amount)), Number(line.amount) > 0 ? 'entrada' : 'saida', line.posted_on, line.account_id]);
  return rows;
}

r.get('/statements/:id', async (req, res) => {
  const st = await one(
    'select b.*, a.name as account_name from bank_statements b join financial_accounts a on a.id = b.account_id where b.id = $1 and b.company_id = $2',
    [req.params.id, req.companyId]);
  if (!st) throw notFound('Extrato não encontrado');
  const { rows: lines } = await q(
    `select l.*, t.description as tx_description, t.category as tx_category from statement_lines l left join transactions t on t.id = l.transaction_id
      where l.statement_id = $1 order by l.posted_on, l.amount`, [st.id]);
  for (const l of lines) l.candidates = l.status === 'pendente' ? await candidates({ query: q }, l) : [];
  res.json({ ...st, lines });
});

async function lockLine(db, req) {
  const { rows: [l] } = await db.query('select * from statement_lines where id = $1 and company_id = $2 for update', [req.params.id, req.companyId]);
  if (!l) throw notFound('Lançamento do extrato não encontrado');
  return l;
}

async function reconcile(db, req, line, t) {
  const at = `${line.posted_on}T12:00:00-03:00`;
  await db.query(
    `update transactions set paid_at = coalesce(paid_at, $2::timestamptz), account_id = $3, reconciled_at = now(), statement_line_id = $4 where id = $1`,
    [t.id, at, line.account_id, line.id]);
  await db.query(`update statement_lines set status = 'conciliado', transaction_id = $2, reconciled_by = $3, reconciled_at = now() where id = $1`, [line.id, t.id, req.user.id]);
}

r.post('/lines/:id/match', need('cash'), async (req, res) => {
  const d = parse(z.object({ transaction_id: z.string().uuid() }), req.body);
  await tx(async (db) => {
    const line = await lockLine(db, req);
    if (line.status !== 'pendente') throw bad('Lançamento já tratado.');
    const { rows: [t] } = await db.query('select * from transactions where id = $1 and company_id = $2 for update', [d.transaction_id, req.companyId]);
    if (!t) throw notFound('Lançamento financeiro não encontrado');
    if (t.reconciled_at) throw bad('Este lançamento já foi conciliado.');
    if (Math.abs(Number(t.amount) - Math.abs(Number(line.amount))) > 0.009 || (t.type === 'entrada') !== (Number(line.amount) > 0)) {
      throw bad('Valor ou sentido (entrada/saída) não confere com o extrato.');
    }
    await reconcile(db, req, line, t);
    await audit(db, req, { entity: 'payment', entityId: t.id, action: 'reconcile', summary: `Conciliado com o extrato: ${t.description || t.category} ${t.amount}${t.paid_at ? '' : ' (baixa pela data do banco)'}` });
  });
  res.json({ ok: true });
});

r.post('/lines/:id/create', need('cash'), async (req, res) => {
  const d = parse(z.object({ category: s.min(1, 'informe a categoria'), description: opt, customer_id: z.string().uuid().nullable().optional(), supplier_id: z.string().uuid().nullable().optional() }), req.body);
  await tx(async (db) => {
    const line = await lockLine(db, req);
    if (line.status !== 'pendente') throw bad('Lançamento já tratado.');
    const { rows: [t] } = await db.query(
      `insert into transactions (company_id, type, category, description, amount, method, due_date, paid_at, account_id, customer_id, supplier_id, created_by)
       values ($1,$2,$3,$4,$5,'transferencia',$6,$7::timestamptz,$8,$9,$10,$11) returning *`,
      [req.companyId, Number(line.amount) > 0 ? 'entrada' : 'saida', d.category, d.description || line.description, Math.abs(Number(line.amount)),
        line.posted_on, `${line.posted_on}T12:00:00-03:00`, line.account_id, d.customer_id || null, d.supplier_id || null, req.user.id]);
    await reconcile(db, req, line, t);
    await audit(db, req, { entity: 'cash', entityId: t.id, action: 'reconcile_create', summary: `Lançamento criado a partir do extrato: ${d.category} ${t.amount}` });
  });
  res.status(201).json({ ok: true });
});

r.post('/lines/:id/ignore', need('cash'), async (req, res) => {
  const d = parse(z.object({ reason: s.min(3, 'informe o motivo') }), req.body);
  await tx(async (db) => {
    const line = await lockLine(db, req);
    if (line.status !== 'pendente') throw bad('Lançamento já tratado.');
    await db.query(`update statement_lines set status = 'ignorado', description = concat_ws(' — ', description, $2::text), reconciled_by = $3, reconciled_at = now() where id = $1`, [line.id, `Ignorado: ${d.reason}`, req.user.id]);
  });
  res.json({ ok: true });
});

r.post('/lines/:id/undo', need('cash'), async (req, res) => {
  await tx(async (db) => {
    const line = await lockLine(db, req);
    if (line.status === 'pendente') throw bad('Nada a desfazer.');
    if (line.transaction_id) await db.query('update transactions set reconciled_at = null, statement_line_id = null where id = $1', [line.transaction_id]);
    await db.query(`update statement_lines set status = 'pendente', transaction_id = null, reconciled_by = null, reconciled_at = null where id = $1`, [line.id]);
    await audit(db, req, { entity: 'payment', entityId: line.transaction_id, action: 'reconcile_undo', summary: `Conciliação desfeita (${line.amount} em ${line.posted_on})` });
  });
  res.json({ ok: true });
});

/** Concilia automaticamente as linhas com um único candidato já pago na mesma conta, com até 2 dias de diferença. */
r.post('/statements/:id/auto', need('cash'), async (req, res) => {
  const done = await tx(async (db) => {
    const { rows: lines } = await db.query("select * from statement_lines where statement_id = $1 and company_id = $2 and status = 'pendente' for update", [req.params.id, req.companyId]);
    let n = 0;
    const used = new Set();
    for (const l of lines) {
      const c = (await candidates(db, l)).filter((x) => x.paid_at && x.account_id === l.account_id && Number(x.days) <= 2 && !used.has(x.id));
      if (c.length === 1) { used.add(c[0].id); await reconcile(db, req, l, c[0]); n += 1; }
    }
    if (n) await audit(db, req, { entity: 'payment', entityId: req.params.id, action: 'reconcile_auto', summary: `Conciliação automática: ${n} lançamento(s)` });
    return n;
  });
  res.json({ reconciled: done });
});

// ---------- Fluxo de caixa projetado ----------
r.get('/cashflow', async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 90, 7), 365);
  const { rows: accs } = await balances(req.companyId);
  const current = round2(accs.filter((a) => a.active).reduce((a, x) => a + Number(x.balance), 0));
  const { rows: [od] } = await q(
    `select coalesce(sum(amount) filter (where type = 'entrada'), 0) as receivable, coalesce(sum(amount) filter (where type = 'saida'), 0) as payable
       from transactions where company_id = $1 and paid_at is null and due_date < current_date`, [req.companyId]);
  const { rows } = await q(
    `select date_trunc('week', due_date)::date as week,
            coalesce(sum(amount) filter (where type = 'entrada'), 0) as inflow, coalesce(sum(amount) filter (where type = 'saida'), 0) as outflow
       from transactions where company_id = $1 and paid_at is null and due_date >= current_date and due_date < current_date + $2::int
      group by 1 order by 1`, [req.companyId, days]);
  let bal = current;
  const weeks = rows.map((w) => { bal = round2(bal + Number(w.inflow) - Number(w.outflow)); return { ...w, balance: bal }; });
  res.json({ current, overdue: od, weeks, projected: bal, accounts: accs.filter((a) => a.active) });
});

// ---------- DRE gerencial ----------
const DEDUCTIONS = ['Taxas de cartão', 'Impostos', 'Estornos'];
r.get('/dre', need('reports'), async (req, res) => {
  const year = Number(req.query.year) || new Date().getFullYear();
  const tz = req.settings.timezone || 'America/Sao_Paulo';
  const { rows: tx0 } = await q(
    `select extract(month from (paid_at at time zone $3))::int as m, type, category, sum(amount) as total
       from transactions where company_id = $1 and paid_at is not null and extract(year from (paid_at at time zone $3)) = $2
        and category <> $4 group by 1,2,3`, [req.companyId, year, tz, TRANSFER_CATEGORY]);
  const { rows: cmv } = await q(
    `select extract(month from (o.delivered_at at time zone $3))::int as m, sum(i.qty * i.unit_cost) as cmv, sum(distinct o.labor_cost) as labor
       from orders o join order_items i on i.order_id = o.id
      where o.company_id = $1 and o.status = 'entregue' and extract(year from (o.delivered_at at time zone $3)) = $2
        and i.kind in ('material','consumivel') group by 1`, [req.companyId, year, tz]);
  const { rows: labor } = await q(
    `select extract(month from (delivered_at at time zone $3))::int as m, sum(labor_cost) as labor from orders
      where company_id = $1 and status = 'entregue' and extract(year from (delivered_at at time zone $3)) = $2 group by 1`, [req.companyId, year, tz]);
  const months = Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
    const rows = tx0.filter((x) => x.m === m);
    const sum = (f) => round2(rows.filter(f).reduce((a, x) => a + Number(x.total), 0));
    const receita = sum((x) => x.type === 'entrada');
    const deducoes = sum((x) => x.type === 'saida' && DEDUCTIONS.includes(x.category));
    const compras = sum((x) => x.type === 'saida' && x.category === 'Compra de materiais');
    const comissoes = sum((x) => x.type === 'saida' && x.category === 'Comissões');
    const despesas = sum((x) => x.type === 'saida' && !DEDUCTIONS.includes(x.category) && !['Compra de materiais', 'Comissões'].includes(x.category));
    const custo = round2(Number(cmv.find((x) => x.m === m)?.cmv || 0));
    const liquida = round2(receita - deducoes);
    const bruto = round2(liquida - custo - comissoes);
    const byCat = {};
    rows.filter((x) => x.type === 'saida' && !DEDUCTIONS.includes(x.category) && !['Compra de materiais', 'Comissões'].includes(x.category))
      .forEach((x) => { byCat[x.category] = round2((byCat[x.category] || 0) + Number(x.total)); });
    return {
      month: m, receita, deducoes, receita_liquida: liquida, cmv: custo, comissoes, lucro_bruto: bruto, despesas, despesas_por_categoria: byCat,
      resultado: round2(bruto - despesas), compras_materiais: compras, mao_de_obra_apontada: round2(Number(labor.find((x) => x.m === m)?.labor || 0)),
    };
  });
  const total = Object.fromEntries(['receita', 'deducoes', 'receita_liquida', 'cmv', 'comissoes', 'lucro_bruto', 'despesas', 'resultado', 'compras_materiais', 'mao_de_obra_apontada']
    .map((k) => [k, round2(months.reduce((a, x) => a + x[k], 0))]));
  res.json({ year, months, total, basis: 'Regime de caixa para receitas e despesas; CMV pelo custo dos materiais das OS entregues no mês. Compras de materiais vão para o estoque e não entram como despesa.' });
});

export default r;
