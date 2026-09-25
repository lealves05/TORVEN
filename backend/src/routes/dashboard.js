import { Router } from 'express';
import { q } from '../db.js';
import { can } from '../auth.js';
import { OPEN_STATUSES, round2 } from '../util.js';

const r = Router();

r.get('/', async (req, res) => {
  const tz = req.settings.timezone;
  const cid = req.companyId;
  const params = [cid];
  let scope = '';
  if (!(req.user.role === 'owner' || req.perms.orders_view === 'all')) {
    params.push(req.ownTechnician || '00000000-0000-0000-0000-000000000000');
    scope = ` and (o.technician_id = $2 or exists (select 1 from order_items oi where oi.order_id = o.id and oi.technician_id = $2))`;
  }
  const { rows: byStatus } = await q(
    `select status, count(*)::int as n, coalesce(sum(total),0) as total from orders o
      where company_id = $1 and kind = 'os' and status <> all(array['entregue','cancelada']) ${scope} group by status`, params);
  const { rows: upcoming } = await q(
    `select o.id, o.number, o.status, o.priority, o.promised_at, o.total, c.name as customer_name, e.description as equipment_description,
            t.name as technician_name, t.color as technician_color
       from orders o left join customers c on c.id = o.customer_id left join equipment e on e.id = o.equipment_id
       left join technicians t on t.id = o.technician_id
      where o.company_id = $1 and o.kind = 'os' and o.status = any($${params.length + 1}) ${scope}
      order by (o.promised_at is null), o.promised_at, o.created_at limit 12`, [...params, OPEN_STATUSES]);
  const overdue = upcoming.filter((o) => o.promised_at && new Date(o.promised_at) < new Date()).length;
  const { rows: [{ n: overdueAll }] } = await q(
    `select count(*)::int as n from orders o where company_id = $1 and kind='os' and status = any($${params.length + 1})
        and promised_at < now() ${scope}`, [...params, OPEN_STATUSES]);

  const out = {
    byStatus, upcoming, overdue: overdueAll ?? overdue,
    ready: byStatus.find((s) => s.status === 'pronta')?.n || 0,
    open: byStatus.reduce((a, s) => a + s.n, 0),
  };

  if (can(req, 'quotes') || can(req, 'quotes_approve')) {
    const { rows: [qt] } = await q(
      `select count(*)::int as n, coalesce(sum(total),0) as total from quotes where company_id = $1 and status in ('rascunho','enviado','aguardando_decisao')
          and (valid_until is null or valid_until >= (now() at time zone $2)::date)`, [cid, tz]);
    out.quotes = qt;
  }

  if (can(req, 'cash') || can(req, 'reports')) {
    const { rows: [m] } = await q(
      `select coalesce(sum(amount) filter (where type='entrada'),0) as income, coalesce(sum(amount) filter (where type='saida'),0) as expense
         from transactions where company_id = $1 and paid_at is not null and category <> 'Transferência entre contas'
          and date_trunc('month', paid_at at time zone $2) = date_trunc('month', now() at time zone $2)`, [cid, tz]);
    const { rows: [p] } = await q(
      `select coalesce(sum(amount) filter (where type='entrada'),0) as receivable,
              coalesce(sum(amount) filter (where type='entrada' and due_date < (now() at time zone $2)::date),0) as receivable_overdue,
              coalesce(sum(amount) filter (where type='saida'),0) as payable,
              coalesce(sum(amount) filter (where type='saida' and due_date <= (now() at time zone $2)::date + 7),0) as payable_week
         from transactions where company_id = $1 and paid_at is null`, [cid, tz]);
    const { rows: series } = await q(
      `with d as (select generate_series((now() at time zone $2)::date - 29, (now() at time zone $2)::date, '1 day')::date as day)
       select to_char(d.day, 'YYYY-MM-DD') as day,
              coalesce(sum(t.amount) filter (where t.type='entrada'),0) as entradas,
              coalesce(sum(t.amount) filter (where t.type='saida'),0) as saidas
         from d left join transactions t on t.company_id = $1 and t.paid_at is not null and (t.paid_at at time zone $2)::date = d.day
        group by d.day order by d.day`, [cid, tz]);
    const { rows: [delivered] } = await q(
      `select count(*)::int as n, coalesce(sum(total),0) as total from orders where company_id = $1 and status = 'entregue'
          and date_trunc('month', delivered_at at time zone $2) = date_trunc('month', now() at time zone $2)`, [cid, tz]);
    out.finance = { month: { ...m, balance: round2(m.income - m.expense) }, pending: p, series, delivered };
  }

  if (can(req, 'materials_manage') || can(req, 'purchases')) {
    const { rows: low } = await q(
      `select id, name, unit, stock, min_stock from products where company_id = $1 and active and min_stock > 0 and stock <= min_stock
        order by (stock / nullif(min_stock,0)) nulls first limit 8`, [cid]);
    out.lowStock = low;
  }
  if (!can(req, 'orders_values')) out.upcoming = out.upcoming.map((o) => ({ ...o, total: null }));
  res.json(out);
});

export default r;
