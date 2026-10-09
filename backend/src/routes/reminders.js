// Lembretes financeiros (Financeiro › Alertas e lembretes). Aparecem no sino no dia (ou antes, conforme a configuração).
import { Router } from 'express';
import { z } from 'zod';
import { q, one, tx } from '../db.js';
import { need } from '../auth.js';
import { parse, notFound } from '../util.js';
import { audit } from '../audit.js';

const r = Router();
r.use(need('cash'));

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data inválida');
const schema = z.object({
  title: z.string().trim().min(2, 'escreva o lembrete').max(200),
  note: z.string().trim().max(1000).nullable().optional(),
  due_date: ymd,
  amount: z.coerce.number().positive().max(10_000_000).nullable().optional(),
  repeat: z.enum(['nao', 'semanal', 'mensal', 'anual']).default('nao'),
  assigned_to: z.string().uuid().nullable().optional(),
  transaction_id: z.string().uuid().nullable().optional(),
});

async function checkRefs(companyId, d) {
  if (d.assigned_to && !(await one('select 1 from users where id = $1 and company_id = $2', [d.assigned_to, companyId]))) throw notFound('Usuário não encontrado');
  if (d.transaction_id && !(await one('select 1 from transactions where id = $1 and company_id = $2', [d.transaction_id, companyId]))) throw notFound('Lançamento não encontrado');
}

r.get('/', async (req, res) => {
  const status = req.query.status === 'feitos' ? 'feitos' : 'pendentes';
  const { rows } = await q(
    `select fr.*, fr.due_date::text as due_date, fr.amount::float8 as amount, u.name as assigned_name, cb.name as created_by_name, t.description as transaction_description
       from finance_reminders fr left join users u on u.id = fr.assigned_to left join users cb on cb.id = fr.created_by
       left join transactions t on t.id = fr.transaction_id
      where fr.company_id = $1 and ${status === 'feitos' ? 'fr.done_at is not null' : 'fr.done_at is null'}
      order by ${status === 'feitos' ? 'fr.done_at desc' : 'fr.due_date'} limit 300`, [req.companyId]);
  res.json(rows);
});

r.post('/', async (req, res) => {
  const d = parse(schema, req.body);
  await checkRefs(req.companyId, d);
  const x = await one(
    `insert into finance_reminders (company_id, title, note, due_date, amount, repeat, assigned_to, transaction_id, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
    [req.companyId, d.title, d.note || null, d.due_date, d.amount || null, d.repeat, d.assigned_to || null, d.transaction_id || null, req.user.id]);
  await audit(null, req, { entity: 'reminder', entityId: x.id, action: 'create', summary: `Lembrete "${d.title}" para ${d.due_date}` });
  res.status(201).json(x);
});

r.put('/:id', async (req, res) => {
  const d = parse(schema, req.body);
  await checkRefs(req.companyId, d);
  const x = await one(
    `update finance_reminders set title=$3, note=$4, due_date=$5, amount=$6, repeat=$7, assigned_to=$8, transaction_id=$9
      where id = $1 and company_id = $2 and done_at is null returning id`,
    [req.params.id, req.companyId, d.title, d.note || null, d.due_date, d.amount || null, d.repeat, d.assigned_to || null, d.transaction_id || null]);
  if (!x) throw notFound('Lembrete não encontrado ou já concluído');
  res.json(x);
});

/** Concluir: se repete, cria o próximo automaticamente. */
r.post('/:id/done', async (req, res) => {
  const out = await tx(async (db) => {
    const { rows: [x] } = await db.query(
      'update finance_reminders set done_at = now(), done_by = $3 where id = $1 and company_id = $2 and done_at is null returning *', [req.params.id, req.companyId, req.user.id]);
    if (!x) throw notFound('Lembrete não encontrado ou já concluído');
    let next = null;
    if (x.repeat !== 'nao') {
      const step = { semanal: '7 days', mensal: '1 month', anual: '1 year' }[x.repeat];
      ({ rows: [next] } = await db.query(
        `insert into finance_reminders (company_id, title, note, due_date, amount, repeat, assigned_to, created_by, source)
         values ($1,$2,$3,($4::date + $5::interval)::date,$6,$7,$8,$9,$10) returning id, due_date::text`,
        [x.company_id, x.title, x.note, x.due_date, step, x.amount, x.repeat, x.assigned_to, x.created_by, x.source]));
    }
    return { next };
  });
  await audit(null, req, { entity: 'reminder', entityId: req.params.id, action: 'done', summary: `Lembrete concluído${out.next ? ` (próximo em ${out.next.due_date})` : ''}` });
  res.json(out);
});

r.delete('/:id', async (req, res) => {
  const x = await one('delete from finance_reminders where id = $1 and company_id = $2 returning title', [req.params.id, req.companyId]);
  if (!x) throw notFound('Lembrete não encontrado');
  await audit(null, req, { entity: 'reminder', entityId: req.params.id, action: 'delete', summary: `Lembrete "${x.title}" excluído` });
  res.status(204).end();
});

/** Painel de alertas do financeiro: o que vence, o que venceu, caixa aberto há muito tempo. */
r.get('/alerts', async (req, res) => {
  const a = req.settings.financeAlerts;
  const t = await one(
    `select
       count(*) filter (where type='saida' and due_date < current_date)::int as pagar_vencidas,
       coalesce(sum(amount) filter (where type='saida' and due_date < current_date),0)::float8 as pagar_vencidas_valor,
       count(*) filter (where type='saida' and due_date between current_date and current_date + $2::int)::int as pagar_vencendo,
       coalesce(sum(amount) filter (where type='saida' and due_date between current_date and current_date + $2::int),0)::float8 as pagar_vencendo_valor,
       count(*) filter (where type='entrada' and due_date < current_date)::int as receber_vencidas,
       coalesce(sum(amount) filter (where type='entrada' and due_date < current_date),0)::float8 as receber_vencidas_valor,
       count(*) filter (where type='entrada' and due_date between current_date and current_date + $3::int)::int as receber_vencendo,
       coalesce(sum(amount) filter (where type='entrada' and due_date between current_date and current_date + $3::int),0)::float8 as receber_vencendo_valor
      from transactions where company_id = $1 and paid_at is null and category <> 'Transferência entre contas'`,
    [req.companyId, a.payDaysBefore, a.receiveDaysBefore]);
  const cash = await one(
    `select opened_at, round(extract(epoch from now() - opened_at) / 3600)::int as hours from cash_sessions
      where company_id = $1 and closed_at is null limit 1`, [req.companyId]);
  const { rows: [rem] } = await q(
    `select count(*)::int as n from finance_reminders where company_id = $1 and done_at is null and due_date <= current_date + $2::int
       and (assigned_to is null or assigned_to = $3)`, [req.companyId, a.remindersDaysBefore, req.user.id]);
  res.json({ settings: a, ...t, cash_open_hours: cash?.hours ?? null, cash_open_long: !!cash && cash.hours >= a.cashOpenHours, reminders_due: rem.n });
});

export default r;
