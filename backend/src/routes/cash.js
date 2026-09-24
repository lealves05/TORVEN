import { Router } from 'express';
import { z } from 'zod';
import { q, one, tx } from '../db.js';
import { need } from '../auth.js';
import { parse, notFound, bad, round2, withDefaults } from '../util.js';

const r = Router();
r.use(need('cash'));

export async function companyTz(companyId) {
  const s = await one('select settings from companies where id=$1', [companyId]);
  return withDefaults(s.settings).timezone;
}

async function sessionSummary(session) {
  const { rows } = await q(
    `select type, coalesce(method,'—') as method, category, sum(amount) as total, count(*) as n
       from transactions where cash_session_id = $1 and paid_at is not null group by 1,2,3`, [session.id]);
  const cashIn = rows.filter((x) => x.type === 'entrada' && x.method === 'dinheiro').reduce((a, x) => a + x.total, 0);
  const cashOut = rows.filter((x) => x.type === 'saida' && x.method === 'dinheiro').reduce((a, x) => a + x.total, 0);
  const byMethod = {};
  for (const x of rows.filter((y) => y.type === 'entrada')) byMethod[x.method] = round2((byMethod[x.method] || 0) + x.total);
  const { rows: [{ n }] } = await q("select count(distinct order_id)::int as n from transactions where cash_session_id=$1 and order_id is not null and type='entrada'", [session.id]);
  return {
    ...session,
    entries: round2(rows.filter((x) => x.type === 'entrada').reduce((a, x) => a + x.total, 0)),
    exits: round2(rows.filter((x) => x.type === 'saida').reduce((a, x) => a + x.total, 0)),
    by_method: byMethod,
    sales_count: n,
    expected_cash: round2(Number(session.opening_amount) + cashIn - cashOut),
  };
}

r.get('/session', async (req, res) => {
  const s = await one(
    `select cs.*, u.name as opened_by_name from cash_sessions cs left join users u on u.id = cs.opened_by
      where cs.company_id=$1 and cs.closed_at is null order by opened_at desc limit 1`, [req.companyId]);
  res.json(s ? await sessionSummary(s) : null);
});

r.get('/sessions', async (req, res) => {
  const { rows } = await q(
    `select cs.*, uo.name as opened_by_name, uc.name as closed_by_name from cash_sessions cs
       left join users uo on uo.id = cs.opened_by left join users uc on uc.id = cs.closed_by
      where cs.company_id=$1 order by opened_at desc limit 60`, [req.companyId]);
  res.json(rows);
});

r.post('/session/open', async (req, res) => {
  const d = parse(z.object({ opening_amount: z.coerce.number().min(0).default(0) }), req.body);
  const open = await one('select id from cash_sessions where company_id=$1 and closed_at is null', [req.companyId]);
  if (open) throw bad('Já existe um caixa aberto.');
  const s = await one('insert into cash_sessions (company_id, opened_by, opening_amount) values ($1,$2,$3) returning *',
    [req.companyId, req.user.id, d.opening_amount]);
  res.status(201).json(await sessionSummary(s));
});

r.post('/session/close', async (req, res) => {
  const d = parse(z.object({ closing_amount: z.coerce.number().min(0), notes: z.string().optional().nullable() }), req.body);
  const s = await one('select * from cash_sessions where company_id=$1 and closed_at is null', [req.companyId]);
  if (!s) throw bad('Não há caixa aberto.');
  const sum = await sessionSummary(s);
  const closed = await one(
    `update cash_sessions set closed_at=now(), closed_by=$1, closing_amount=$2, expected_amount=$3, notes=$4
      where id=$5 returning *`, [req.user.id, d.closing_amount, sum.expected_cash, d.notes || null, s.id]);
  res.json({ ...sum, ...closed, difference: round2(d.closing_amount - sum.expected_cash) });
});

// ---------------- Lançamentos (fluxo de caixa / contas) ----------------
r.get('/transactions', async (req, res) => {
  const tz = await companyTz(req.companyId);
  const { from, to, type, status, category, search } = req.query;
  const params = [req.companyId, tz];
  let where = 't.company_id = $1';
  const ref = `coalesce((t.paid_at at time zone $2)::date, t.due_date, (t.created_at at time zone $2)::date)`;
  if (from) { params.push(from); where += ` and ${ref} >= $${params.length}`; }
  if (to) { params.push(to); where += ` and ${ref} <= $${params.length}`; }
  if (type) { params.push(type); where += ` and t.type = $${params.length}`; }
  if (category) { params.push(category); where += ` and t.category = $${params.length}`; }
  if (status === 'pago') where += ' and t.paid_at is not null';
  if (status === 'pendente') where += ' and t.paid_at is null';
  if (status === 'vencido') where += ` and t.paid_at is null and t.due_date < (now() at time zone $2)::date`;
  if (search) { params.push(`%${String(search).toLowerCase()}%`); where += ` and (lower(coalesce(t.description,'')) like $${params.length} or lower(coalesce(t.document,'')) like $${params.length})`; }
  if (req.query.customer_id) { params.push(req.query.customer_id); where += ` and t.customer_id = $${params.length}`; }
  if (req.query.supplier_id) { params.push(req.query.supplier_id); where += ` and t.supplier_id = $${params.length}`; }
  const { rows } = await q(
    `select t.*, ${ref} as ref_date, c.name as customer_name, sp.name as supplier_name, te.name as technician_name,
            o.number as order_number, o.kind as order_kind, pu.number as purchase_number
       from transactions t left join customers c on c.id = t.customer_id left join suppliers sp on sp.id = t.supplier_id
       left join technicians te on te.id = t.technician_id left join orders o on o.id = t.order_id
       left join purchases pu on pu.id = t.purchase_id
      where ${where} order by ${ref} desc, t.created_at desc limit 2000`, params);
  const sum = (f) => round2(rows.filter(f).reduce((a, x) => a + x.amount, 0));
  res.json({
    items: rows,
    totals: {
      entradas: sum((x) => x.type === 'entrada' && x.paid_at),
      saidas: sum((x) => x.type === 'saida' && x.paid_at),
      a_receber: sum((x) => x.type === 'entrada' && !x.paid_at),
      a_pagar: sum((x) => x.type === 'saida' && !x.paid_at),
    },
  });
});

const txSchema = z.object({
  type: z.enum(['entrada', 'saida']),
  category: z.string().trim().min(1, 'informe a categoria'),
  description: z.string().trim().nullable().optional(),
  amount: z.coerce.number().positive('valor deve ser maior que zero'),
  method: z.string().nullable().optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  paid: z.boolean().default(true),
  technician_id: z.string().uuid().nullable().optional(),
  customer_id: z.string().uuid().nullable().optional(),
  supplier_id: z.string().uuid().nullable().optional(),
  document: z.string().trim().nullable().optional(),
  repeat: z.coerce.number().int().min(1).max(36).default(1),
});

r.post('/transactions', async (req, res) => {
  const d = parse(txSchema, req.body);
  const out = await tx(async (db) => {
    const { rows: [session] } = await db.query(
      'select id from cash_sessions where company_id=$1 and closed_at is null limit 1', [req.companyId]);
    const created = [];
    for (let i = 0; i < d.repeat; i++) {
      const paidNow = d.paid && i === 0;
      const { rows: [t] } = await db.query(
        `insert into transactions (company_id, type, category, description, amount, method, due_date, paid_at,
                                   cash_session_id, technician_id, customer_id, created_by, supplier_id, document)
         values ($1,$2,$3,$4,$5,$6, coalesce($7::date, current_date) + ($8::text || ' month')::interval,
                 case when $9 then now() end, $10, $11, $12, $13, $14, $15) returning *`,
        [req.companyId, d.type, d.category,
          d.repeat > 1 ? `${d.description || d.category} (${i + 1}/${d.repeat})` : d.description || null,
          d.amount, d.method || null, d.due_date || null, String(i), paidNow, paidNow ? session?.id || null : null,
          d.technician_id || null, d.customer_id || null, req.user.id, d.supplier_id || null, d.document || null]);
      created.push(t);
    }
    return created;
  });
  res.status(201).json(out);
});

r.put('/transactions/:id', async (req, res) => {
  const d = parse(txSchema.omit({ repeat: true }), req.body);
  const cur = await one('select * from transactions where id=$1 and company_id=$2', [req.params.id, req.companyId]);
  if (!cur) throw notFound();
  if (cur.auto && (cur.order_id || cur.purchase_id) && cur.paid_at) throw bad('Lançamento gerado por OS/entrada já baixado. Estorne pela própria OS.');
  if (cur.auto && (cur.order_id || cur.purchase_id) && (d.amount !== Number(cur.amount) || d.type !== cur.type)) throw bad('Valor e tipo de lançamentos gerados por OS/entrada não podem ser alterados.');
  const t = await one(
    `update transactions set type=$1, category=$2, description=$3, amount=$4, method=$5, due_date=$6,
            paid_at = case when $7 then coalesce(paid_at, now()) else null end, technician_id=$8, customer_id=$9,
            supplier_id=$11, document=$12
      where id=$10 returning *`,
    [d.type, d.category, d.description || null, d.amount, d.method || null, d.due_date || null, d.paid,
      d.technician_id || cur.technician_id, d.customer_id || cur.customer_id, cur.id, d.supplier_id || cur.supplier_id, d.document ?? cur.document]);
  res.json(t);
});

/** Dar baixa (receber/pagar) em um lançamento pendente. */
r.post('/transactions/:id/pay', async (req, res) => {
  const d = parse(z.object({ method: z.string().optional().nullable() }), req.body);
  const session = await one('select id from cash_sessions where company_id=$1 and closed_at is null limit 1', [req.companyId]);
  const t = await one(
    `update transactions set paid_at=now(), method=coalesce($1, case when method='fiado' then null else method end),
            cash_session_id=$2
      where id=$3 and company_id=$4 and paid_at is null returning *`,
    [d.method || null, session?.id || null, req.params.id, req.companyId]);
  if (!t) throw bad('Lançamento não encontrado ou já baixado.');
  res.json(t);
});

/** Desfaz a baixa (volta a pendente). */
r.post('/transactions/:id/unpay', async (req, res) => {
  const t = await one(
    `update transactions set paid_at = null, cash_session_id = null
      where id = $1 and company_id = $2 and paid_at is not null and due_date is not null and not (auto and order_id is not null and category <> 'Ordens de serviço' and category <> 'Venda de materiais')
      returning *`, [req.params.id, req.companyId]);
  if (!t) throw bad('Não foi possível desfazer a baixa deste lançamento.');
  res.json(t);
});

r.delete('/transactions/:id', async (req, res) => {
  const cur = await one('select * from transactions where id=$1 and company_id=$2', [req.params.id, req.companyId]);
  if (!cur) throw notFound();
  if (cur.order_id && cur.paid_at) throw bad('Este lançamento pertence a uma OS/venda. Estorne pela própria OS.');
  if (cur.purchase_id && cur.paid_at) throw bad('Parcela já paga de uma entrada de materiais. Desfaça a baixa antes.');
  await q('delete from transactions where id=$1', [cur.id]);
  res.status(204).end();
});

export default r;
