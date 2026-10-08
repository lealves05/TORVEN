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
  // todas as consultas do painel saem juntas (antes eram feitas uma depois da outra)
  const one1 = (p) => p.then((r) => r.rows[0]);
  const all = (p) => p.then((r) => r.rows);
  const jobs = {
    byStatus: all(q(
      `select status, count(*)::int as n, coalesce(sum(total),0) as total from orders o
        where company_id = $1 and kind = 'os' and status = any($${params.length + 1}) ${scope} group by status`, [...params, OPEN_STATUSES])),
    upcoming: all(q(
      `select o.id, o.number, o.status, o.priority, o.promised_at, o.total, c.name as customer_name, e.description as equipment_description,
              t.name as technician_name, t.color as technician_color, c.phone as customer_phone, o.public_token
         from orders o left join customers c on c.id = o.customer_id left join equipment e on e.id = o.equipment_id
         left join technicians t on t.id = o.technician_id
        where o.company_id = $1 and o.kind = 'os' and o.status = any($${params.length + 1}) ${scope}
        order by (o.promised_at is null), o.promised_at, o.created_at limit 12`, [...params, OPEN_STATUSES])),
    overdueAll: one1(q(
      `select count(*)::int as n from orders o where company_id = $1 and kind='os' and status = any($${params.length + 1})
          and promised_at < now() ${scope}`, [...params, OPEN_STATUSES])).then((x) => x?.n),
  };
  if (can(req, 'quotes') || can(req, 'quotes_approve')) {
    jobs.quotes = one1(q(
      `select count(*)::int as n, coalesce(sum(total),0) as total from quotes where company_id = $1 and status in ('rascunho','enviado','aguardando_decisao')
          and (valid_until is null or valid_until >= (now() at time zone $2)::date)`, [cid, tz]));
  }
  const fin = can(req, 'cash') || can(req, 'reports');
  if (fin) {
    jobs.m = one1(q(
      `select coalesce(sum(amount) filter (where type='entrada'),0) as income, coalesce(sum(amount) filter (where type='saida'),0) as expense
         from transactions where company_id = $1 and paid_at is not null and category <> 'Transferência entre contas'
          and paid_at >= date_trunc('month', now() at time zone $2) at time zone $2`, [cid, tz]));
    jobs.p = one1(q(
      `select coalesce(sum(amount) filter (where type='entrada'),0) as receivable,
              coalesce(sum(amount) filter (where type='entrada' and due_date < (now() at time zone $2)::date),0) as receivable_overdue,
              coalesce(sum(amount) filter (where type='saida'),0) as payable,
              coalesce(sum(amount) filter (where type='saida' and due_date <= (now() at time zone $2)::date + 7),0) as payable_week
         from transactions where company_id = $1 and paid_at is null`, [cid, tz]));
    jobs.series = all(q(
      `with d as (select generate_series((now() at time zone $2)::date - 29, (now() at time zone $2)::date, '1 day')::date as day),
            t as (select (paid_at at time zone $2)::date as day, sum(amount) filter (where type='entrada') as entradas, sum(amount) filter (where type='saida') as saidas
                    from transactions where company_id = $1 and paid_at >= ((now() at time zone $2)::date - 29)::timestamp at time zone $2 group by 1)
       select to_char(d.day, 'YYYY-MM-DD') as day, coalesce(t.entradas,0) as entradas, coalesce(t.saidas,0) as saidas
         from d left join t on t.day = d.day order by d.day`, [cid, tz]));
    jobs.delivered = one1(q(
      `select count(*)::int as n, coalesce(sum(total),0) as total from orders where company_id = $1 and status = 'entregue'
          and delivered_at >= date_trunc('month', now() at time zone $2) at time zone $2`, [cid, tz]));
  }
  if (can(req, 'materials_manage') || can(req, 'purchases')) {
    jobs.lowStock = all(q(
      `select id, name, unit, stock, min_stock from products where company_id = $1 and active and min_stock > 0 and stock <= min_stock
        order by (stock / nullif(min_stock,0)) nulls first limit 8`, [cid]));
  }
  // primeiros passos da conta (só para quem configura a empresa)
  if (can(req, 'settings')) {
    jobs.setup = one1(q(
      `select (c.phone is not null and c.phone <> '' and c.document is not null and c.document <> '') as company,
              exists (select 1 from technicians where company_id = $1 and active) as technicians,
              exists (select 1 from services where company_id = $1) as services,
              exists (select 1 from customers where company_id = $1) as customers,
              exists (select 1 from orders where company_id = $1 and kind = 'os') as orders,
              exists (select 1 from quotes where company_id = $1 and status <> 'rascunho') as quotes
         from companies c where c.id = $1`, [cid]));
  }
  const keys = Object.keys(jobs);
  const vals = await Promise.all(keys.map((k) => jobs[k]));
  const d = Object.fromEntries(keys.map((k, i) => [k, vals[i]]));
  const { byStatus, upcoming } = d;
  const overdue = upcoming.filter((o) => o.promised_at && new Date(o.promised_at) < new Date()).length;
  const out = {
    byStatus, upcoming, overdue: d.overdueAll ?? overdue,
    ready: byStatus.find((x) => x.status === 'pronta')?.n || 0,
    open: byStatus.reduce((a, x) => a + x.n, 0),
  };
  if ('quotes' in d) out.quotes = d.quotes;
  if (fin) out.finance = { month: { ...d.m, balance: round2(d.m.income - d.m.expense) }, pending: d.p, series: d.series, delivered: d.delivered };
  if ('lowStock' in d) out.lowStock = d.lowStock;
  if ('setup' in d) out.setup = d.setup || null;
  if (!can(req, 'customers_view')) out.upcoming = out.upcoming.map((o) => ({ ...o, customer_phone: null }));
  if (!can(req, 'orders_values')) out.upcoming = out.upcoming.map((o) => ({ ...o, total: null }));
  res.json(out);
});

export default r;
