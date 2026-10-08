// Financeiro gerencial: contas, transferências, conciliação bancária (OFX/CSV), fluxo de caixa projetado e DRE.
import { Router } from 'express';
import { z } from 'zod';
import { q, one, tx } from '../db.js';
import { need } from '../auth.js';
import { parse, notFound, bad, round2 } from '../util.js';
import { audit } from '../audit.js';
import { logEvent, orderFinance, assertNoOpenCharge } from '../domain.js';

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
    description: ([tag(b, 'NAME'), tag(b, 'MEMO')].filter(Boolean).join(' — ') || '').slice(0, 300) || null,
  }));
}

/** Divide uma linha de CSV respeitando aspas. */
function splitCsv(line, sep) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') { if (quoted && line[i + 1] === '"') { cur += '"'; i += 1; } else quoted = !quoted; } else if (ch === sep && !quoted) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}
const plain = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * CSV de extrato. Reconhece o cabeçalho dos bancos mais comuns (Data / Descrição ou Histórico / Valor, ou Crédito e Débito,
 * Identificador). Sem cabeçalho: data;descrição;valor. Aceita ; , ou tabulação e valores no formato brasileiro.
 */
export function parseCsv(text) {
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const first = lines.find((l) => /[;,\t]/.test(l)) || '';
  const sep = ['\t', ';', ','].map((c) => [c, first.split(c).length]).sort((x, y) => y[1] - x[1])[0][0];
  let col = null;
  const out = [];
  for (const l of lines) {
    const cols = splitCsv(l, sep).map((c) => c.replace(/^"|"$/g, ''));
    if (!col) {
      const h = cols.map(plain);
      const find = (re) => h.findIndex((x) => re.test(x));
      const date = find(/^data|^dt\b|date/);
      if (date >= 0 && !toYmd(cols[date])) {
        col = {
          date, desc: find(/descri|histor|lancamento|memo|titulo|detalhe/), value: find(/^valor|^amount|quantia/),
          credit: find(/credito|entrada/), debit: find(/debito|saida/), id: find(/identificador|documento|^id$|fitid/),
        };
        continue;
      }
    }
    if (col) {
      const date = toYmd(cols[col.date] || '');
      if (!date) continue;
      let amount;
      if (col.value >= 0) amount = brNumber(cols[col.value]);
      else {
        const cr = col.credit >= 0 && cols[col.credit] ? Math.abs(brNumber(cols[col.credit])) : 0;
        const db = col.debit >= 0 && cols[col.debit] ? Math.abs(brNumber(cols[col.debit])) : 0;
        amount = round2((Number.isFinite(cr) ? cr : 0) - (Number.isFinite(db) ? db : 0));
      }
      const desc = col.desc >= 0 ? cols[col.desc] : cols.filter((_, i) => ![col.date, col.value, col.credit, col.debit, col.id].includes(i)).join(' ');
      out.push({ posted_on: date, amount, description: String(desc || '').slice(0, 300) || null, fitid: col.id >= 0 && cols[col.id] ? `csv:${String(cols[col.id]).slice(0, 80)}` : null });
      continue;
    }
    const date = toYmd(cols[0]);
    if (!date) continue; // cabeçalho sem coluna de data reconhecível
    const amount = brNumber(cols[cols.length - 1]);
    out.push({ posted_on: date, amount, description: cols.slice(1, -1).join(' ').slice(0, 300) || null, fitid: null });
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
    `select l.*, t.description as tx_description, t.category as tx_category, o.number as order_number, o.kind as order_kind
       from statement_lines l left join transactions t on t.id = l.transaction_id left join orders o on o.id = l.order_id
      where l.statement_id = $1 order by l.posted_on, l.amount`, [st.id]);
  const open = await openOrders({ query: q }, req.companyId);
  for (const l of lines) {
    l.candidates = l.status === 'pendente' ? await candidates({ query: q }, l) : [];
    l.order_candidates = l.status === 'pendente' ? orderCandidates(l, open) : [];
  }
  res.json({ ...st, lines });
});

// ---------- Conferência com as OS ----------
/** OS e vendas com saldo a receber (para reconhecer créditos do extrato). */
async function openOrders(db, companyId) {
  const { rows } = await db.query(
    `select o.id, o.number, o.kind, o.status, o.total, o.customer_id, c.name as customer_name, o.created_at,
            round(o.total - coalesce(f.paid, 0) + coalesce(f.refunded, 0) - coalesce(f.receivable, 0), 2) as balance
       from orders o left join customers c on c.id = o.customer_id
       left join lateral (
         select sum(amount) filter (where type='entrada' and paid_at is not null and category <> 'Taxas de cartão') as paid,
                sum(amount) filter (where type='entrada' and paid_at is null) as receivable,
                sum(amount) filter (where type='saida' and category = 'Estornos') as refunded
           from transactions t where t.order_id = o.id) f on true
      where o.company_id = $1 and o.status <> 'cancelada' and o.created_at > now() - interval '18 months'
      order by o.created_at desc limit 2000`, [companyId]);
  return rows.filter((o) => Number(o.balance) > 0.009);
}

const nameTokens = (n) => plain(n).split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !['ltda', 'eireli', 'me', 'dos', 'das', 'com'].includes(t));

/**
 * Sugere a OS de um crédito do extrato. Pontos: nº da OS escrito na descrição (forte), nome do cliente
 * na descrição (comum em PIX/TED), valor igual ao saldo da OS.
 */
export function orderCandidates(line, open) {
  const amount = Number(line.amount);
  if (!(amount > 0)) return [];
  const desc = plain(String(line.description || '').slice(0, 300));
  const nums = new Set([...desc.matchAll(/\b(?:os|ordem|o\.s\.?|no|nº|n°)[\s\-:#nº°.]{0,6}0*(\d{1,6})\b/g)].map((m) => Number(m[1])));
  const out = [];
  for (const o of open) {
    const bal = Number(o.balance);
    let score = 0;
    const why = [];
    if (nums.has(o.number)) { score += 100; why.push(`nº ${o.number} na descrição`); }
    o.tokens ??= nameTokens(o.customer_name);
    const toks = o.tokens;
    const hit = toks.filter((t) => desc.includes(t)).length;
    if (toks.length && (hit >= 2 || (hit === 1 && toks.length === 1))) { score += 40; why.push('nome do cliente'); }
    if (Math.abs(bal - amount) < 0.01) { score += 30; why.push('valor igual ao saldo'); } else if (amount < bal) { score += 5; why.push('pagamento parcial'); } else if (!score) continue;
    if (amount > bal + 0.009) continue; // não cabe no saldo da OS
    if (score >= 30) out.push({ order_id: o.id, number: o.number, kind: o.kind, customer_name: o.customer_name, balance: bal, score, why });
  }
  return out.sort((a, b) => b.score - a.score || b.balance - a.balance).slice(0, 4);
}

r.post('/lines/:id/receive-order', need('cash'), async (req, res) => {
  const d = parse(z.object({ order_id: z.string().uuid(), method: s.min(2).max(40).default('pix') }), req.body);
  if (d.method === 'dinheiro') throw bad('Crédito no banco não é pagamento em dinheiro. Escolha PIX, transferência, cartão ou boleto.');
  if (!(req.settings.paymentMethods || []).some((m) => m.id === d.method)) throw bad('Forma de pagamento desconhecida.');
  const out = await tx(async (db) => {
    const line = await lockLine(db, req);
    if (line.status !== 'pendente') throw bad('Lançamento já tratado.');
    if (!(Number(line.amount) > 0)) throw bad('Só créditos (entradas) podem ser recebidos numa OS.');
    const { rows: [o] } = await db.query("select * from orders where id = $1 and company_id = $2 and status <> 'cancelada' for update", [d.order_id, req.companyId]);
    if (!o) throw notFound('OS não encontrada');
    await assertNoOpenCharge(db, o.id);
    const fin = await orderFinance(db, o.id);
    const balance = round2(Number(o.total) - (Number(fin.paid) - Number(fin.refunded)) - Number(fin.receivable));
    const amount = round2(Number(line.amount));
    if (amount > balance + 0.009) throw bad(`O crédito (${amount.toFixed(2)}) é maior que o saldo da OS nº ${o.number} (${balance.toFixed(2)}).`);
    const label = o.kind === 'venda' ? `Venda nº ${o.number}` : `OS nº ${o.number}`;
    const { rows: [t] } = await db.query(
      `insert into transactions (company_id, type, category, description, amount, method, due_date, paid_at, account_id, order_id, customer_id, auto, created_by, origin)
       values ($1,'entrada',$2,$3,$4,$5,$6,$7::timestamptz,$8,$9,$10,true,$11,'extrato_os') returning *`,
      [req.companyId, o.kind === 'venda' ? 'Venda de materiais' : 'Ordens de serviço', `${label} — identificado no extrato`, amount, d.method,
        line.posted_on, `${line.posted_on}T12:00:00-03:00`, line.account_id, o.id, o.customer_id, req.user.id]);
    await reconcile(db, req, line, t);
    await logEvent(db, o.id, { type: 'pagamento', message: `Pagamento de R$ ${amount.toFixed(2).replace('.', ',')} identificado no extrato do banco (${line.posted_on.split('-').reverse().join('/')})`, userId: req.user.id });
    await audit(db, req, { entity: 'payment', entityId: t.id, action: 'reconcile_order', summary: `Crédito do extrato recebido na ${label}: ${amount.toFixed(2)}` });
    return { transaction_id: t.id, order_number: o.number, balance: round2(balance - amount) };
  });
  res.status(201).json(out);
});

/** Resumo da conferência do extrato com as OS: o que entrou e é de OS, o que tem sugestão, e o que foi lançado e não apareceu no banco. */
r.get('/statements/:id/orders-check', async (req, res) => {
  const st = await one('select * from bank_statements where id = $1 and company_id = $2', [req.params.id, req.companyId]);
  if (!st) throw notFound('Extrato não encontrado');
  const { rows: lines } = await q(
    `select l.*, o.number as order_number, o.kind as order_kind, t.order_id as tx_order_id from statement_lines l
       left join transactions t on t.id = l.transaction_id left join orders o on o.id = coalesce(l.order_id, t.order_id)
      where l.statement_id = $1 and l.amount > 0 order by l.posted_on`, [st.id]);
  const open = await openOrders({ query: q }, req.companyId);
  const linked = [];
  const suggested = [];
  const unknown = [];
  for (const l of lines) {
    if (l.order_number) linked.push({ id: l.id, posted_on: l.posted_on, amount: Number(l.amount), description: l.description, order_number: l.order_number, order_kind: l.order_kind });
    else if (l.status === 'pendente') {
      const c = orderCandidates(l, open);
      if (c[0]?.score >= 60) suggested.push({ id: l.id, posted_on: l.posted_on, amount: Number(l.amount), description: l.description, best: c[0] });
      else unknown.push({ id: l.id, posted_on: l.posted_on, amount: Number(l.amount), description: l.description });
    }
  }
  // recebimentos de OS fora do dinheiro, no período do extrato, que não foram encontrados no banco
  const { rows: missing } = await q(
    `select t.id, t.amount, t.method, t.paid_at, o.number as order_number, o.kind as order_kind, c.name as customer_name
       from transactions t join orders o on o.id = t.order_id left join customers c on c.id = o.customer_id
      where t.company_id = $1 and t.type = 'entrada' and t.paid_at is not null and t.reconciled_at is null
        and coalesce(t.method, '') not in ('dinheiro', '') and t.category <> 'Taxas de cartão'
        and (t.account_id = $2 or t.account_id is null)
        and t.paid_at::date between $3::date - 1 and $4::date + 1
      order by t.paid_at limit 500`, [req.companyId, st.account_id, st.period_start, st.period_end]);
  const sum = (l) => round2(l.reduce((a, x) => a + Number(x.amount), 0));
  res.json({
    period: { start: st.period_start, end: st.period_end },
    totals: { credits: sum(lines), linked: sum(linked), suggested: sum(suggested), unknown: sum(unknown), missing: sum(missing) },
    linked, suggested, unknown, missing: missing.map((m) => ({ ...m, amount: Number(m.amount) })),
  });
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
  await db.query(`update statement_lines set status = 'conciliado', transaction_id = $2, order_id = coalesce($4, order_id), reconciled_by = $3, reconciled_at = now() where id = $1`,
    [line.id, t.id, req.user.id, t.order_id || null]);
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
    for (const [table, key] of [['customers', 'customer_id'], ['suppliers', 'supplier_id']]) {
      if (d[key] && !(await db.query(`select 1 from ${table} where id = $1 and company_id = $2`, [d[key], req.companyId])).rows[0]) throw notFound('Cadastro não encontrado');
    }
    const { rows: [t] } = await db.query(
      `insert into transactions (company_id, type, category, description, amount, method, due_date, paid_at, account_id, customer_id, supplier_id, created_by, origin)
       values ($1,$2,$3,$4,$5,'transferencia',$6,$7::timestamptz,$8,$9,$10,$11,'extrato') returning *`,
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
    if (line.transaction_id) {
      const { rows: [t] } = await db.query('select * from transactions where id = $1 and company_id = $2 for update', [line.transaction_id, req.companyId]);
      if (t?.origin) {
        // lançamento que nasceu do extrato: desfazer apaga o lançamento (e o pagamento da OS), senão ficaria em dobro
        await db.query('update statement_lines set transaction_id = null where id = $1', [line.id]);
        await db.query('delete from transactions where id = $1', [t.id]);
        if (t.order_id) await logEvent(db, t.order_id, { type: 'pagamento', message: `Pagamento de R$ ${Number(t.amount).toFixed(2).replace('.', ',')} identificado no extrato foi desfeito`, userId: req.user.id });
      } else if (t) await db.query('update transactions set reconciled_at = null, statement_line_id = null where id = $1', [t.id]);
    }
    await db.query(`update statement_lines set status = 'pendente', transaction_id = null, order_id = null, reconciled_by = null, reconciled_at = null where id = $1`, [line.id]);
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
  // faixa de datas do ano no fuso da empresa (usa os índices por data em vez de calcular o ano linha a linha)
  const yr = (col) => `${col} >= make_date($2::int, 1, 1)::timestamp at time zone $3 and ${col} < make_date($2::int + 1, 1, 1)::timestamp at time zone $3`;
  const [{ rows: tx0 }, { rows: cmv }, { rows: labor }] = await Promise.all([
    q(`select extract(month from (paid_at at time zone $3))::int as m, type, category, sum(amount) as total
         from transactions where company_id = $1 and paid_at is not null and ${yr('paid_at')}
          and category <> $4 group by 1,2,3`, [req.companyId, year, tz, TRANSFER_CATEGORY]),
    q(`select extract(month from (o.delivered_at at time zone $3))::int as m, sum(i.qty * i.unit_cost) as cmv
         from orders o join order_items i on i.order_id = o.id
        where o.company_id = $1 and o.status = 'entregue' and ${yr('o.delivered_at')}
          and i.kind in ('material','consumivel') group by 1`, [req.companyId, year, tz]),
    q(`select extract(month from (delivered_at at time zone $3))::int as m, sum(labor_cost) as labor from orders
        where company_id = $1 and status = 'entregue' and ${yr('delivered_at')} group by 1`, [req.companyId, year, tz]),
  ]);
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
