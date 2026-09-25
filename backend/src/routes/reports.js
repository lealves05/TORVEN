import { Router } from 'express';
import { q } from '../db.js';
import { need, can } from '../auth.js';
import { round2, bad } from '../util.js';

const r = Router();

function range(req) {
  const { from, to } = req.query;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '')) throw bad('Informe o período (from/to).');
  return [from, to];
}

/** Financeiro: entradas × saídas, categorias, formas de pagamento, DRE simplificada. */
r.get('/finance', need('reports'), async (req, res) => {
  const [from, to] = range(req);
  const tz = req.settings.timezone;
  const P = [req.companyId, tz, from, to];
  const base = `from transactions where company_id = $1 and paid_at is not null and category <> 'Transferência entre contas'
                 and (paid_at at time zone $2)::date between $3::date and $4::date`;
  const [{ rows: byDay }, { rows: byCategory }, { rows: byMethod }, { rows: [cmv] }] = await Promise.all([
    q(`with d as (select generate_series($3::date, $4::date, '1 day')::date as day)
       select to_char(d.day,'YYYY-MM-DD') as day,
              coalesce(sum(t.amount) filter (where t.type='entrada'),0) as entradas,
              coalesce(sum(t.amount) filter (where t.type='saida'),0) as saidas
         from d left join transactions t on t.company_id = $1 and t.paid_at is not null and (t.paid_at at time zone $2)::date = d.day
        group by d.day order by d.day`, P),
    q(`select type, category, sum(amount) as total, count(*)::int as n ${base} group by type, category order by total desc`, P),
    q(`select coalesce(method,'—') as method, sum(amount) as total, count(*)::int as n ${base} and type='entrada' group by 1 order by 2 desc`, P),
    q(`select coalesce(sum(i.qty * i.unit_cost),0) as cmv
         from order_items i join orders o on o.id = i.order_id
        where o.company_id = $1 and o.status = 'entregue' and i.kind = 'material'
          and (o.delivered_at at time zone $2)::date between $3::date and $4::date`, P),
  ]);
  const income = round2(byCategory.filter((x) => x.type === 'entrada').reduce((a, x) => a + x.total, 0));
  const expense = round2(byCategory.filter((x) => x.type === 'saida').reduce((a, x) => a + x.total, 0));
  const purchases = round2(byCategory.filter((x) => x.type === 'saida' && x.category === 'Compra de materiais').reduce((a, x) => a + x.total, 0));
  res.json({
    byDay, byCategory, byMethod,
    totals: { income, expense, balance: round2(income - expense) },
    dre: {
      receita: income,
      cmv: round2(cmv.cmv),
      margem_bruta: round2(income - cmv.cmv),
      despesas_operacionais: round2(expense - purchases),
      resultado_competencia: round2(income - cmv.cmv - (expense - purchases)),
      compras_estoque: purchases,
    },
  });
});

/** Produção: OS entregues, serviços, materiais, técnicos, prazos. */
r.get('/production', need('reports'), async (req, res) => {
  const [from, to] = range(req);
  const tz = req.settings.timezone;
  const P = [req.companyId, tz, from, to];
  const delivered = `o.company_id = $1 and o.status = 'entregue' and (o.delivered_at at time zone $2)::date between $3::date and $4::date`;
  const [{ rows: [sum] }, { rows: services }, { rows: materials }, { rows: techs }, { rows: byCategory }, { rows: created }, { rows: customers }] = await Promise.all([
    q(`select count(*)::int as n, coalesce(sum(o.total),0) as total, coalesce(avg(o.total),0) as ticket,
              coalesce(sum(o.total) filter (where o.kind='os'),0) as os_total, count(*) filter (where o.kind='os')::int as os_n,
              coalesce(sum(o.total) filter (where o.kind='venda'),0) as sales_total, count(*) filter (where o.kind='venda')::int as sales_n,
              coalesce(avg(extract(epoch from (o.delivered_at - o.received_at))/86400) filter (where o.kind='os'),0) as avg_days,
              count(*) filter (where o.kind='os' and o.promised_at is not null and o.finished_at <= o.promised_at)::int as on_time,
              count(*) filter (where o.kind='os' and o.promised_at is not null)::int as with_deadline
         from orders o where ${delivered}`, P),
    q(`select i.description, s.category, sum(i.qty) as qty, sum(i.total) as total, count(distinct o.id)::int as orders
         from order_items i join orders o on o.id = i.order_id left join services s on s.id = i.service_id
        where ${delivered} and i.kind <> 'material' group by 1,2 order by total desc limit 30`, P),
    q(`select i.description, i.unit, sum(i.qty) as qty, sum(i.total) as revenue, sum(i.qty * i.unit_cost) as cost
         from order_items i join orders o on o.id = i.order_id where ${delivered} and i.kind = 'material'
        group by 1,2 order by revenue desc limit 30`, P),
    q(`select t.id, t.name, t.color, count(distinct o.id)::int as orders, coalesce(sum(i.total),0) as production,
              coalesce(sum(i.commission_value),0) as commission
         from order_items i join orders o on o.id = i.order_id join technicians t on t.id = i.technician_id
        where ${delivered} group by t.id order by production desc`, P),
    q(`select coalesce(s.category, 'Outros') as category, sum(i.total) as total
         from order_items i join orders o on o.id = i.order_id left join services s on s.id = i.service_id
        where ${delivered} and i.kind <> 'material' group by 1 order by 2 desc`, P),
    q(`select status, count(*)::int as n from orders o where o.company_id = $1 and o.kind = 'os'
          and (o.created_at at time zone $2)::date between $3::date and $4::date group by status`, P),
    q(`select c.name, count(*)::int as orders, sum(o.total) as total from orders o join customers c on c.id = o.customer_id
        where ${delivered} group by c.id, c.name order by total desc limit 15`, P),
  ]);
  res.json({ summary: sum, services, materials, technicians: techs, byCategory, created, customers });
});

/** Comissões por técnico (todas ou só as próprias). */
r.get('/commissions', need('commissions', 'reports'), async (req, res) => {
  const [from, to] = range(req);
  const tz = req.settings.timezone;
  const params = [req.companyId, tz, from, to];
  let extra = '';
  const all = req.user.role === 'owner' || req.perms.commissions === 'all' || can(req, 'reports');
  if (!all) { params.push(req.ownTechnician || '00000000-0000-0000-0000-000000000000'); extra = ` and i.technician_id = $${params.length}`; }
  const { rows } = await q(
    `select i.technician_id, t.name as technician_name, o.id as order_id, o.number, o.kind, o.delivered_at, c.name as customer_name,
            i.description, i.total, i.commission_rate, i.commission_value
       from order_items i join orders o on o.id = i.order_id join technicians t on t.id = i.technician_id
       left join customers c on c.id = o.customer_id
      where o.company_id = $1 and o.status = 'entregue' and i.commission_value > 0
        and (o.delivered_at at time zone $2)::date between $3::date and $4::date ${extra}
      order by t.name, o.delivered_at`, params);
  const { rows: paid } = await q(
    `select technician_id, sum(amount) as total from transactions where company_id = $1 and type='saida' and category='Comissões'
        and technician_id is not null and paid_at is not null and (paid_at at time zone $2)::date between $3::date and $4::date
      group by technician_id`, params.slice(0, 4));
  res.json({ items: rows, paid });
});

/** Estoque: posição valorizada e giro. */
r.get('/stock', need('reports', 'materials_manage'), async (req, res) => {
  const { rows } = await q(
    `select p.id, p.name, p.category, p.unit, p.stock, p.min_stock, p.cost, p.price, round(p.stock * p.cost, 2) as value,
            coalesce((select -sum(m.qty) from stock_movements m where m.product_id = p.id and m.qty < 0
                        and m.created_at > now() - interval '90 days'), 0) as out_90d
       from products p where p.company_id = $1 and p.active order by value desc`, [req.companyId]);
  res.json({ items: rows, total: round2(rows.reduce((a, x) => a + Math.max(0, Number(x.value)), 0)) });
});

/** Indicadores de gestão: funil comercial, prazos, margem real por OS, retrabalho e produtividade. */
r.get('/management', need('reports'), async (req, res) => {
  const [from, to] = range(req);
  const tz = req.settings.timezone;
  const P = [req.companyId, tz, from, to];
  const inP = (col) => `(${col} at time zone $2)::date between $3::date and $4::date`;
  const one1 = async (sql, p = P) => (await q(sql, p)).rows[0];
  const funnel = await one1(
    `select (select count(*) from service_requests where company_id = $1 and ${inP('created_at')})::int as requests,
            (select count(*) from service_requests where company_id = $1 and ${inP('created_at')} and quote_id is not null)::int as requests_quoted,
            (select count(*) from service_requests where company_id = $1 and ${inP('created_at')} and status = 'perdida')::int as requests_lost,
            (select count(*) from quotes where company_id = $1 and sent_at is not null and ${inP('sent_at')})::int as quotes_sent,
            (select count(*) from quotes where company_id = $1 and sent_at is not null and ${inP('sent_at')} and status in ('aprovado','parcialmente_aprovado','convertido'))::int as quotes_approved,
            (select count(*) from quotes where company_id = $1 and sent_at is not null and ${inP('sent_at')} and status = 'recusado')::int as quotes_refused,
            (select coalesce(sum(coalesce(approved_total, total)), 0) from quotes where company_id = $1 and sent_at is not null and ${inP('sent_at')} and status in ('aprovado','parcialmente_aprovado','convertido')) as quotes_approved_value,
            (select count(*) from orders where company_id = $1 and kind = 'os' and ${inP('created_at')})::int as orders_opened,
            (select count(*) from orders where company_id = $1 and kind = 'os' and status = 'entregue' and ${inP('delivered_at')})::int as orders_delivered`);
  const times = await one1(
    `select round(avg(extract(epoch from qt.sent_at - sr.created_at) / 86400)::numeric, 1) as request_to_quote_days,
            round(avg(extract(epoch from qt.approved_at - qt.sent_at) / 86400) filter (where qt.approved_at is not null)::numeric, 1) as quote_to_approval_days
       from quotes qt left join service_requests sr on sr.id = qt.request_id
      where qt.company_id = $1 and qt.sent_at is not null and ${inP('qt.sent_at')}`);
  const delivery = await one1(
    `select round(avg(extract(epoch from delivered_at - received_at) / 86400)::numeric, 1) as order_days,
            count(*) filter (where promised_at is not null)::int as with_promise,
            count(*) filter (where promised_at is not null and delivered_at <= promised_at + interval '2 hours')::int as on_time
       from orders where company_id = $1 and kind = 'os' and status = 'entregue' and ${inP('delivered_at')}`);
  const { rows: margins } = await q(
    `select o.id, o.number, c.name as customer_name, o.total, o.labor_cost, o.labor_minutes,
            coalesce((select sum(i.qty * i.unit_cost) from order_items i where i.order_id = o.id and i.kind in ('material','consumivel')), 0) as material_cost,
            coalesce((select sum(i.qty * i.unit_cost) from order_items i where i.order_id = o.id and i.kind in ('terceiro','deslocamento','outro')), 0) as other_cost,
            coalesce((select sum(i.commission_value) from order_items i where i.order_id = o.id), 0) as commissions
       from orders o left join customers c on c.id = o.customer_id
      where o.company_id = $1 and o.kind = 'os' and o.status = 'entregue' and ${inP('o.delivered_at')}
      order by o.delivered_at desc limit 500`, P);
  const withMargin = margins.map((m) => {
    const cost = round2(Number(m.material_cost) + Number(m.other_cost) + Number(m.labor_cost) + Number(m.commissions));
    const margin = round2(Number(m.total) - cost);
    return { ...m, cost, margin, margin_pct: Number(m.total) > 0 ? round2((margin / Number(m.total)) * 100) : null };
  });
  const revenue = round2(withMargin.reduce((a, m) => a + Number(m.total), 0));
  const totalCost = round2(withMargin.reduce((a, m) => a + m.cost, 0));
  const rework = await one1(
    `select count(*)::int as claims, count(*) filter (where status in ('procedente','concluida') and rework_order_id is not null)::int as reworks
       from warranty_claims where company_id = $1 and ${inP('opened_at')}`);
  const { rows: techs } = await q(
    `select t.id, t.name,
            coalesce((select sum(l.minutes) from order_time_logs l where l.technician_id = t.id and ${inP('l.started_at')} and l.ended_at is not null), 0) as minutes,
            coalesce((select sum(i.total) from order_items i join orders o on o.id = i.order_id
                       where i.technician_id = t.id and i.kind = 'servico' and o.status = 'entregue' and ${inP('o.delivered_at')}), 0) as service_revenue,
            (select count(distinct o.id) from orders o where o.technician_id = t.id and o.status = 'entregue' and ${inP('o.delivered_at')})::int as orders
       from technicians t where t.company_id = $1 and t.active order by t.name`, P);
  const pct = (a, b) => (b ? round2((a / b) * 100) : null);
  res.json({
    funnel: { ...funnel, request_to_quote_pct: pct(funnel.requests_quoted, funnel.requests), quote_approval_pct: pct(funnel.quotes_approved, funnel.quotes_approved + funnel.quotes_refused) },
    times: { ...times, order_days: delivery.order_days, on_time_pct: pct(delivery.on_time, delivery.with_promise) },
    margin: { revenue, cost: totalCost, margin: round2(revenue - totalCost), margin_pct: pct(revenue - totalCost, revenue), orders: withMargin.length,
      avg_ticket: withMargin.length ? round2(revenue / withMargin.length) : 0, lowest: [...withMargin].sort((a, b) => (a.margin_pct ?? 0) - (b.margin_pct ?? 0)).slice(0, 10) },
    rework: { ...rework, rate_pct: pct(rework.reworks, funnel.orders_delivered) },
    technicians: techs.map((t) => ({ ...t, hours: round2(Number(t.minutes) / 60), revenue_per_hour: Number(t.minutes) > 0 ? round2(Number(t.service_revenue) / (Number(t.minutes) / 60)) : null })),
    basis: 'Margem real = total da OS − materiais (custo médio) − terceiros/deslocamento − mão de obra apontada (custo/hora do técnico) − comissões.',
  });
});

/** Painel fiscal: documentos por situação e OS entregues ainda sem documento autorizado. */
r.get('/fiscal', need('invoices_issue', 'reports'), async (req, res) => {
  const [from, to] = range(req);
  const tz = req.settings.timezone;
  const { rows: byStatus } = await q(
    `select kind, status, count(*)::int as n, coalesce(sum(amount), 0) as total from invoices
      where company_id = $1 and coalesce(test, false) = false and (created_at at time zone $2)::date between $3::date and $4::date group by 1, 2`,
    [req.companyId, tz, from, to]);
  const { rows: pending } = await q(
    `select o.id, o.number, o.kind, o.total, o.delivered_at, c.name as customer_name, c.document as customer_document,
            coalesce((select sum(i.total) from order_items i where i.order_id = o.id and i.kind in ('material','consumivel') and i.product_id is not null), 0) as goods,
            (select string_agg(distinct iv.status, ',') from invoices iv where iv.order_id = o.id) as invoice_statuses
       from orders o left join customers c on c.id = o.customer_id
      where o.company_id = $1 and o.status = 'entregue' and o.total > 0 and (o.delivered_at at time zone $2)::date between $3::date and $4::date
        and not exists (select 1 from invoices iv where iv.order_id = o.id and iv.status in ('autorizada','processando'))
      order by o.delivered_at desc limit 500`, [req.companyId, tz, from, to]);
  res.json({
    by_status: byStatus,
    pending: pending.map((x) => ({ ...x, services: round2(Number(x.total) - Number(x.goods)) })),
    pending_total: round2(pending.reduce((a, x) => a + Number(x.total), 0)),
  });
});

export default r;
