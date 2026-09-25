// Relacionamento: follow-ups de pós-venda, orçamento sem resposta, garantia vencendo, manutenção e cobrança.
// O TORVEN não envia mensagens: gera a lista de retornos e registra o contato feito pelo usuário.
import { Router } from 'express';
import { z } from 'zod';
import { q, one, tx } from '../db.js';
import { need, can } from '../auth.js';
import { parse, notFound, bad } from '../util.js';
import { audit } from '../audit.js';

const r = Router();
r.use(need('followups'));

export const FOLLOWUP_KIND = {
  pos_venda: 'Pós-venda', orcamento: 'Orçamento sem resposta', garantia_vencendo: 'Garantia vencendo',
  manutencao: 'Manutenção preventiva', cobranca: 'Cobrança', outro: 'Outro',
};

/** Cria (uma única vez, pela chave) os retornos devidos a partir dos dados. */
export async function generateFollowups(db, companyId, settings) {
  const cfg = settings.relationship || {};
  const tz = settings.timezone || 'America/Sao_Paulo';
  const runs = [
    [`insert into followups (company_id, customer_id, order_id, kind, title, due_date, auto_key)
      select o.company_id, o.customer_id, o.id, 'pos_venda', 'Pós-venda da OS nº ' || o.number, (o.delivered_at at time zone $2)::date + $3::int, 'pos:' || o.id
        from orders o where o.company_id = $1 and o.kind = 'os' and o.status = 'entregue' and o.customer_id is not null
         and o.delivered_at > now() - interval '60 days' and o.warranty_of is null
      on conflict (company_id, auto_key) where auto_key is not null do nothing`, [companyId, tz, cfg.postSaleDays ?? 7]],
    [`insert into followups (company_id, customer_id, quote_id, kind, title, due_date, auto_key)
      select qt.company_id, qt.customer_id, qt.id, 'orcamento', 'Retorno do orçamento nº ' || qt.number || ' (rev. ' || qt.revision || ')',
             (qt.sent_at at time zone $2)::date + $3::int, 'orc:' || qt.id || ':' || qt.revision
        from quotes qt where qt.company_id = $1 and qt.status in ('enviado','aguardando_decisao') and qt.sent_at is not null
      on conflict (company_id, auto_key) where auto_key is not null do nothing`, [companyId, tz, cfg.quoteFollowupDays ?? 3]],
    [`insert into followups (company_id, customer_id, order_id, kind, title, due_date, auto_key)
      select o.company_id, o.customer_id, o.id, 'garantia_vencendo', 'Garantia da OS nº ' || o.number || ' vence em ' || to_char(o.warranty_until, 'DD/MM/YYYY'),
             greatest(current_date, o.warranty_until - $2::int), 'gar:' || o.id
        from orders o where o.company_id = $1 and o.status = 'entregue' and o.customer_id is not null
         and o.warranty_until between current_date and current_date + $2::int
      on conflict (company_id, auto_key) where auto_key is not null do nothing`, [companyId, cfg.warrantyNoticeDays ?? 15]],
    [`insert into followups (company_id, customer_id, kind, title, due_date, auto_key)
      select t.company_id, t.customer_id, 'cobranca', 'Cobrança: ' || coalesce(t.description, t.category) || ' — venceu ' || to_char(t.due_date, 'DD/MM'),
             t.due_date + $2::int, 'cob:' || t.id
        from transactions t where t.company_id = $1 and t.type = 'entrada' and t.paid_at is null and t.customer_id is not null
         and t.due_date + $2::int <= current_date
      on conflict (company_id, auto_key) where auto_key is not null do nothing`, [companyId, cfg.collectionDays ?? 3]],
  ];
  if (Number(cfg.maintenanceDays) > 0) {
    runs.push([`insert into followups (company_id, customer_id, order_id, kind, title, due_date, auto_key)
      select o.company_id, o.customer_id, o.id, 'manutencao', 'Oferecer manutenção: ' || coalesce(e.description, 'OS nº ' || o.number),
             (o.delivered_at at time zone 'America/Sao_Paulo')::date + $2::int, 'man:' || o.id
        from orders o left join equipment e on e.id = o.equipment_id
       where o.company_id = $1 and o.status = 'entregue' and o.customer_id is not null and o.equipment_id is not null
         and o.delivered_at < now() - ($2::int || ' days')::interval + interval '7 days'
         and not exists (select 1 from orders n where n.equipment_id = o.equipment_id and n.created_at > o.delivered_at)
      on conflict (company_id, auto_key) where auto_key is not null do nothing`, [companyId, Number(cfg.maintenanceDays)]]);
  }
  let created = 0;
  for (const [sql, p] of runs) created += (await db.query(sql, p)).rowCount;
  // retornos que perderam o motivo (orçamento respondido, conta paga) são encerrados automaticamente
  await db.query(
    `update followups f set status = 'cancelado', result = 'Encerrado automaticamente: ' ||
            case f.kind when 'orcamento' then 'o cliente já respondeu o orçamento' else 'a conta foi paga' end, done_at = now()
      where f.company_id = $1 and f.status = 'pendente' and (
        (f.kind = 'orcamento' and exists (select 1 from quotes qt where qt.id = f.quote_id and qt.status not in ('enviado','aguardando_decisao')))
        or (f.kind = 'cobranca' and exists (select 1 from transactions t where 'cob:' || t.id = f.auto_key and t.paid_at is not null)))`, [companyId]);
  return created;
}

r.get('/followups', async (req, res) => {
  await generateFollowups({ query: q }, req.companyId, req.settings);
  const params = [req.companyId];
  let where = 'f.company_id = $1';
  const { status = 'pendente', kind } = req.query;
  if (status === 'atrasados') where += " and f.status = 'pendente' and f.due_date < current_date";
  else if (status === 'hoje') where += " and f.status = 'pendente' and f.due_date <= current_date";
  else if (status) { params.push(status); where += ` and f.status = $${params.length}`; }
  if (kind) { params.push(kind); where += ` and f.kind = $${params.length}`; }
  const { rows } = await q(
    `select f.*, c.name as customer_name, c.phone as customer_phone, c.email as customer_email, o.number as order_number,
            qt.number as quote_number, u.name as done_by_name
       from followups f left join customers c on c.id = f.customer_id left join orders o on o.id = f.order_id
       left join quotes qt on qt.id = f.quote_id left join users u on u.id = f.done_by
      where ${where} order by case when f.status = 'pendente' then 0 else 1 end, f.due_date, f.created_at limit 1000`, params);
  const showContact = can(req, 'customers_contact');
  res.json(showContact ? rows : rows.map((x) => ({ ...x, customer_phone: null, customer_email: null })));
});

r.get('/summary', async (req, res) => {
  await generateFollowups({ query: q }, req.companyId, req.settings);
  const { rows } = await q(
    `select kind, count(*) filter (where due_date <= current_date)::int as due, count(*)::int as pending
       from followups where company_id = $1 and status = 'pendente' group by kind`, [req.companyId]);
  const { rows: [nps] } = await q(
    `select count(*)::int as answers, count(*) filter (where rating >= 9)::int as promoters, count(*) filter (where rating <= 6)::int as detractors
       from followups where company_id = $1 and rating is not null and done_at > now() - interval '180 days'`, [req.companyId]);
  const score = nps.answers ? Math.round(((nps.promoters - nps.detractors) / nps.answers) * 100) : null;
  res.json({ by_kind: rows, nps: { ...nps, score } });
});

r.post('/followups', async (req, res) => {
  const d = parse(z.object({
    customer_id: z.string().uuid(), kind: z.enum(Object.keys(FOLLOWUP_KIND)).default('outro'), title: z.string().trim().min(3),
    due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), order_id: z.string().uuid().nullable().optional(),
  }), req.body);
  const c = await one('select id from customers where id = $1 and company_id = $2', [d.customer_id, req.companyId]);
  if (!c) throw notFound('Cliente não encontrado');
  if (d.order_id && !(await one('select id from orders where id = $1 and company_id = $2', [d.order_id, req.companyId]))) throw notFound('OS não encontrada');
  const f = await one(
    `insert into followups (company_id, customer_id, order_id, kind, title, due_date, created_by) values ($1,$2,$3,$4,$5,$6,$7) returning *`,
    [req.companyId, d.customer_id, d.order_id || null, d.kind, d.title, d.due_date, req.user.id]);
  res.status(201).json(f);
});

const lockF = async (db, req) => {
  const { rows: [f] } = await db.query('select * from followups where id = $1 and company_id = $2 for update', [req.params.id, req.companyId]);
  if (!f) throw notFound('Retorno não encontrado');
  if (f.status !== 'pendente') throw bad('Retorno já encerrado.');
  return f;
};

r.post('/followups/:id/done', async (req, res) => {
  const d = parse(z.object({
    result: z.string().trim().min(3, 'descreva o que foi conversado'), channel: z.enum(['whatsapp', 'telefone', 'email', 'presencial', 'outro']),
    rating: z.coerce.number().int().min(0).max(10).nullable().optional(), next_due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  }), req.body);
  const out = await tx(async (db) => {
    const f = await lockF(db, req);
    const { rows: [x] } = await db.query(
      `update followups set status = 'feito', result = $2, channel = $3, rating = $4, done_by = $5, done_at = now() where id = $1 returning *`,
      [f.id, d.result, d.channel, d.rating ?? null, req.user.id]);
    if (d.next_due_date) {
      await db.query(
        `insert into followups (company_id, customer_id, order_id, quote_id, kind, title, due_date, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [req.companyId, f.customer_id, f.order_id, f.quote_id, f.kind, `Novo contato: ${f.title}`, d.next_due_date, req.user.id]);
    }
    if (f.order_id) {
      await db.query(`insert into order_events (order_id, type, message, public, user_id) values ($1,'nota',$2,false,$3)`,
        [f.order_id, `Contato de ${f.kind.replace('_', ' ')} (${d.channel}): ${d.result}${d.rating != null ? ` — nota ${d.rating}` : ''}`, req.user.id]);
    }
    return x;
  });
  res.json(out);
});

r.post('/followups/:id/reschedule', async (req, res) => {
  const d = parse(z.object({ due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }), req.body);
  const f = await tx(async (db) => { const x = await lockF(db, req); return (await db.query('update followups set due_date = $2 where id = $1 returning *', [x.id, d.due_date])).rows[0]; });
  res.json(f);
});

r.post('/followups/:id/cancel', async (req, res) => {
  const d = parse(z.object({ reason: z.string().trim().min(3, 'informe o motivo') }), req.body);
  const f = await tx(async (db) => {
    const x = await lockF(db, req);
    return (await db.query(`update followups set status = 'cancelado', result = $2, done_by = $3, done_at = now() where id = $1 returning *`, [x.id, d.reason, req.user.id])).rows[0];
  });
  await audit(null, req, { entity: 'customer', entityId: f.customer_id, action: 'followup_cancel', summary: `Retorno cancelado: ${f.title} — ${d.reason}` });
  res.json(f);
});

export default r;
