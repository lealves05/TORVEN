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
  const base = `from transactions where company_id = $1 and paid_at is not null
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

export default r;
