// Busca global e central de notificações (alertas calculados a partir dos dados).
import { Router } from 'express';
import { q, one } from '../db.js';
import { can } from '../auth.js';
import { onlyDigits } from '../util.js';
import { scopeWhere } from './orders.js';

const r = Router();

r.get('/search', async (req, res) => {
  const t = String(req.query.q || '').trim().toLowerCase();
  if (t.length < 2) return res.json([]);
  const like = `%${t}%`;
  const num = /^\d+$/.test(t) ? parseInt(t, 10) : null;
  const dig = onlyDigits(t);
  const out = [];
  const jobs = [];
  if (can(req, 'customers_view')) {
    jobs.push(q(
      `select id, name, trade_name, phone, city from customers
        where company_id = $1 and active and (lower(name) like $2 or lower(coalesce(trade_name,'')) like $2
          ${dig.length >= 4 ? "or regexp_replace(coalesce(phone,'')||coalesce(document,''), '\\D', '', 'g') like $3" : ''})
        order by lower(name) limit 6`, dig.length >= 4 ? [req.companyId, like, `%${dig}%`] : [req.companyId, like])
      .then(({ rows }) => rows.forEach((c) => out.push({
        type: 'customer', id: c.id, title: c.name, subtitle: [c.trade_name, can(req, 'customers_contact') ? c.phone : null, c.city].filter(Boolean).join(' · '), link: `/clientes/${c.id}`,
      }))));
    jobs.push(q(
      `select e.id, e.description, e.brand, e.model, e.serial, e.customer_id, c.name as customer_name from equipment e
         join customers c on c.id = e.customer_id
        where e.company_id = $1 and e.active and (lower(e.description) like $2 or lower(coalesce(e.serial,'')) like $2
          or lower(coalesce(e.asset_tag,'')) like $2 or lower(coalesce(e.plate,'')) like $2 or lower(coalesce(e.model,'')) like $2)
        limit 5`, [req.companyId, like])
      .then(({ rows }) => rows.forEach((e) => out.push({
        type: 'equipment', id: e.id, title: e.description, subtitle: [e.customer_name, e.brand, e.model, e.serial && `série ${e.serial}`].filter(Boolean).join(' · '), link: `/clientes/${e.customer_id}`,
      }))));
  }
  if (can(req, 'requests_view') || can(req, 'requests_manage')) {
    jobs.push(q(
      `select r.id, r.number, r.title, r.status, coalesce(c.name, r.contact_name) as customer_name from service_requests r
         left join customers c on c.id = r.customer_id
        where r.company_id = $1 and (lower(r.title) like $2 or lower(coalesce(c.name, r.contact_name, '')) like $2 ${num ? 'or r.number = $3' : ''})
        order by r.created_at desc limit 5`, num ? [req.companyId, like, num] : [req.companyId, like])
      .then(({ rows }) => rows.forEach((x) => out.push({
        type: 'request', id: x.id, number: x.number, title: `Solicitação ${x.number} — ${x.title}`, subtitle: x.customer_name, status: x.status, link: `/solicitacoes/${x.id}`,
      }))));
  }
  if (can(req, 'quotes_view') || can(req, 'quotes')) {
    jobs.push(q(
      `select qt.id, qt.number, qt.title, qt.status, c.name as customer_name from quotes qt left join customers c on c.id = qt.customer_id
        where qt.company_id = $1 and (lower(qt.title) like $2 or lower(coalesce(c.name,'')) like $2 ${num ? 'or qt.number = $3' : ''})
        order by qt.created_at desc limit 5`, num ? [req.companyId, like, num] : [req.companyId, like])
      .then(({ rows }) => rows.forEach((x) => out.push({
        type: 'quote', id: x.id, number: x.number, title: `Orçamento ${x.number} — ${x.title}`, subtitle: x.customer_name, status: x.status, link: `/orcamentos/${x.id}`,
      }))));
  }
  if (can(req, 'orders_view') || can(req, 'orders_create')) {
    const params = [req.companyId, like];
    if (num) params.push(num);
    const scope = scopeWhere(req, params);
    jobs.push(q(
      `select o.id, o.number, o.kind, o.status, o.problem, c.name as customer_name, e.description as equipment
         from orders o left join customers c on c.id = o.customer_id left join equipment e on e.id = o.equipment_id
        where o.company_id = $1 and (lower(coalesce(c.name,'')) like $2 or lower(coalesce(e.description,'')) like $2
          or lower(coalesce(o.problem,'')) like $2 or lower(coalesce(e.serial,'')) like $2 ${num ? 'or o.number = $3' : ''})${scope}
        order by o.created_at desc limit 6`, params)
      .then(({ rows }) => rows.forEach((o) => out.push({
        type: 'order', id: o.id, number: o.number, title: `${o.kind === 'venda' ? 'Venda' : 'OS'} ${o.number} — ${o.customer_name || 'Balcão'}`,
        subtitle: [o.equipment, o.problem?.split('\n')[0]].filter(Boolean).join(' · '), status: o.status, link: `/os/${o.id}`,
      }))));
  }
  if (can(req, 'materials_manage') || can(req, 'purchases') || can(req, 'orders_create')) {
    jobs.push(q(
      `select id, name, sku, stock, unit from products where company_id = $1 and active
          and (lower(name) like $2 or lower(coalesce(sku,'')) like $2 or lower(coalesce(barcode,'')) like $2) order by lower(name) limit 5`,
      [req.companyId, like])
      .then(({ rows }) => rows.forEach((p) => out.push({
        type: 'product', id: p.id, title: p.name, subtitle: [p.sku, `estoque ${p.stock} ${p.unit}`].filter(Boolean).join(' · '), link: `/estoque?busca=${encodeURIComponent(p.name)}`,
      }))));
  }
  await Promise.all(jobs);
  const rank = { order: 0, request: 1, quote: 2, customer: 3, equipment: 4, product: 5 };
  out.sort((a, b) => rank[a.type] - rank[b.type]);
  res.json(out);
});

r.get('/notifications', async (req, res) => {
  const cid = req.companyId;
  const items = [];
  const push = (n) => { if (n.count > 0) items.push(n); };
  const jobs = [];
  if (can(req, 'requests_view') || can(req, 'requests_manage')) {
    jobs.push(one(
      `select count(*) filter (where status = 'nova' and created_at < now() - interval '24 hours')::int as stale,
              count(*) filter (where status = 'visita_agendada' and (visit_at at time zone 'America/Sao_Paulo')::date = (now() at time zone 'America/Sao_Paulo')::date)::int as visits
         from service_requests where company_id = $1`, [cid]).then((x) => {
      push({ id: 'requests_stale', level: 'warning', title: 'Solicitações sem triagem', detail: 'Novas há mais de 24 horas', count: x.stale, link: '/solicitacoes?status=nova' });
      push({ id: 'visits_today', level: 'info', title: 'Visitas/triagens hoje', detail: 'Agendadas para hoje', count: x.visits, link: '/solicitacoes?status=visita_agendada' });
    }));
  }
  if (can(req, 'quotes_view') || can(req, 'quotes')) {
    jobs.push(one(
      `select count(*) filter (where status in ('enviado','aguardando_decisao') and sent_at < now() - interval '3 days')::int as waiting,
              count(*) filter (where status in ('aprovado','parcialmente_aprovado'))::int as approved,
              count(*) filter (where status in ('enviado','aguardando_decisao') and valid_until between current_date and current_date + 2)::int as expiring
         from quotes where company_id = $1`, [cid]).then((x) => {
      push({ id: 'quotes_waiting', level: 'info', title: 'Orçamentos sem resposta', detail: 'Enviados há mais de 3 dias — faça o follow-up', count: x.waiting, link: '/orcamentos?status=pendentes' });
      push({ id: 'quotes_approved', level: 'success', title: 'Orçamentos aprovados sem OS', detail: 'Gere a OS para programar a execução', count: x.approved, link: '/orcamentos?status=aprovados' });
      push({ id: 'quotes_expiring', level: 'warning', title: 'Orçamentos vencendo', detail: 'Validade termina em até 2 dias', count: x.expiring, link: '/orcamentos?status=pendentes' });
    }));
  }
  if (can(req, 'orders_view')) {
    const params = [cid];
    const scope = scopeWhere(req, params);
    jobs.push(one(
      `select count(*)::int as late from orders o where o.company_id = $1 and o.kind = 'os'
          and o.status not in ('entregue','cancelada','pronta') and o.promised_at < now()${scope}`, params).then((x) =>
      push({ id: 'orders_late', level: 'danger', title: 'OS atrasadas', detail: 'Prazo prometido já passou', count: x.late, link: '/os' })));
  }
  if (can(req, 'schedule_view') || can(req, 'schedule_manage')) {
    const own = !can(req, 'schedule_manage') && req.user.role !== 'owner' && req.ownTechnician;
    jobs.push(one(
      `select count(*) filter (where status = 'agendado' and (starts_at at time zone 'America/Sao_Paulo')::date = (now() at time zone 'America/Sao_Paulo')::date)::int as today,
              count(*) filter (where status = 'agendado' and ends_at < now() - interval '2 hours')::int as late
         from schedule_entries where company_id = $1 ${own ? 'and technician_id = $2' : ''}`, own ? [cid, req.ownTechnician] : [cid]).then((x) => {
      push({ id: 'schedule_today', level: 'info', title: 'Compromissos hoje', detail: 'Visitas, execuções e entregas agendadas', count: x.today, link: '/agenda' });
      push({ id: 'schedule_late', level: 'warning', title: 'Agenda sem baixa', detail: 'Compromissos passados ainda como "agendado"', count: x.late, link: '/agenda' });
    }));
  }
  if (can(req, 'time_log')) {
    jobs.push(one(`select count(*)::int as n from order_time_logs where company_id = $1 and ended_at is null and started_at < now() - interval '10 hours'`, [cid])
      .then((x) => push({ id: 'timers_long', level: 'warning', title: 'Cronômetros esquecidos', detail: 'Apontamentos abertos há mais de 10 horas', count: x.n, link: '/producao' })));
  }
  if (can(req, 'warranty_manage')) {
    jobs.push(one("select count(*)::int as n from warranty_claims where company_id = $1 and status in ('aberta','em_analise')", [cid])
      .then((x) => push({ id: 'warranty_open', level: 'warning', title: 'Garantias em aberto', detail: 'Aguardando análise', count: x.n, link: '/garantias' })));
  }
  if (can(req, 'materials_manage') || can(req, 'purchases')) {
    jobs.push(one('select count(*)::int as n from products where company_id = $1 and active and min_stock > 0 and stock <= min_stock', [cid])
      .then((x) => push({ id: 'stock_low', level: 'warning', title: 'Materiais no estoque mínimo', detail: 'Programe a reposição', count: x.n, link: '/estoque' })));
  }
  if (can(req, 'cash')) {
    jobs.push(one(
      `select count(*)::int as n from transactions where company_id = $1 and type = 'entrada' and paid_at is null and due_date < current_date`, [cid])
      .then((x) => push({ id: 'receivables_overdue', level: 'danger', title: 'Recebimentos em atraso', detail: 'Contas a receber vencidas', count: x.n, link: '/financeiro' })));
  }
  if (can(req, 'invoices_issue')) {
    jobs.push(one("select count(*)::int as n from invoices where company_id = $1 and status = 'erro'", [cid])
      .then((x) => push({ id: 'invoices_error', level: 'danger', title: 'Documentos fiscais com erro', detail: 'Corrija e reenvie', count: x.n, link: '/notas' })));
  }
  if (can(req, 'fiscal_settings')) {
    jobs.push(one(`select (fiscal->'certificate'->>'valid_until') as until from companies where id = $1`, [cid]).then((x) => {
      if (!x?.until) return;
      const days = Math.floor((new Date(x.until) - Date.now()) / 86400000);
      if (days <= 30) push({ id: 'cert_expiring', level: days < 0 ? 'danger' : 'warning', title: days < 0 ? 'Certificado digital vencido' : 'Certificado digital vencendo', detail: days < 0 ? 'Renove para emitir notas' : `Vence em ${days} dia(s)`, count: 1, link: '/configuracoes' });
    }));
  }
  await Promise.all(jobs);
  const order = { danger: 0, warning: 1, info: 2, success: 3 };
  items.sort((a, b) => order[a.level] - order[b.level]);
  res.json({ items, total: items.reduce((a, x) => a + x.count, 0) });
});

export default r;
