// Notas fiscais (NFS-e de serviços e NF-e de materiais) — Focus NFe ou documento interno.
import { Router } from 'express';
import { z } from 'zod';
import { q, one, tx } from '../db.js';
import { need } from '../auth.js';
import { parse, notFound, bad, fiscalWithDefaults, dpsKey } from '../util.js';
import { buildNfse, buildNfe, focusRequest, mapStatus, errorMessage, extractDoc } from '../fiscal.js';
import { logEvent } from '../domain.js';
import { audit } from '../audit.js';

const r = Router();

async function context(companyId, orderId) {
  const company = await one('select * from companies where id = $1', [companyId]);
  const order = await one(
    `select o.*, e.description as equipment_description, e.brand as equipment_brand, e.model as equipment_model
       from orders o left join equipment e on e.id = o.equipment_id where o.id = $1 and o.company_id = $2`, [orderId, companyId]);
  if (!order) throw notFound('OS/venda não encontrada');
  if (order.status === 'cancelada') throw bad('OS/venda cancelada.');
  const customer = order.customer_id ? await one('select * from customers where id = $1', [order.customer_id]) : null;
  const { rows: items } = await q(
    `select i.*, p.ncm, p.cfop, p.origin, p.sku, s.service_code
       from order_items i left join products p on p.id = i.product_id left join services s on s.id = i.service_id
      where i.order_id = $1 order by i.position`, [orderId]);
  return { company, order, customer, items, fiscal: fiscalWithDefaults(company.fiscal) };
}

const build = (kind, ctx, dpsNumber) => (kind === 'nfe' ? buildNfe(ctx) : buildNfse({ ...ctx, dpsNumber }));

r.get('/', need('invoices_issue', 'invoices_cancel', 'cash'), async (req, res) => {
  const params = [req.companyId];
  let where = 'i.company_id = $1';
  const { status, kind, from, to, search } = req.query;
  if (status) { params.push(status); where += ` and i.status = $${params.length}`; }
  if (kind) { params.push(kind); where += ` and i.kind = $${params.length}`; }
  if (from) { params.push(from); where += ` and i.created_at >= $${params.length}::date`; }
  if (to) { params.push(to); where += ` and i.created_at < $${params.length}::date + 1`; }
  if (search) { params.push(`%${String(search).toLowerCase()}%`); where += ` and (lower(coalesce(i.customer->>'name','')) like $${params.length} or i.number like $${params.length})`; }
  const { rows } = await q(
    `select i.id, i.kind, i.provider, i.environment, i.status, i.number, i.series, i.access_key, i.amount, i.pdf_url, i.xml_url,
            i.message, i.issued_at, i.created_at, i.cancelled_at, i.order_id, i.test, o.number as order_number, o.kind as order_kind,
            i.customer->>'name' as customer_name
       from invoices i left join orders o on o.id = i.order_id where ${where} order by i.created_at desc limit 1000`, params);
  res.json(rows);
});

r.get('/preview', need('invoices_issue'), async (req, res) => {
  const d = parse(z.object({ order_id: z.string().uuid(), kind: z.enum(['nfse', 'nfe']) }), req.query);
  const ctx = await context(req.companyId, d.order_id);
  const b = build(d.kind, ctx, ctx.fiscal[dpsKey(ctx.fiscal.environment)]);
  const { rows: existing } = await q(
    "select id, status, number from invoices where order_id = $1 and kind = $2 and status in ('processando','autorizada')", [d.order_id, d.kind]);
  res.json({
    kind: d.kind, provider: ctx.fiscal.provider, environment: ctx.fiscal.environment, endpoint: b.endpoint,
    amount: b.amount, warnings: b.warnings, items: b.items, description: b.description, payload: b.payload, existing,
    customer: ctx.customer ? { name: ctx.customer.name, document: ctx.customer.document, city: ctx.customer.city, uf: ctx.customer.uf } : null,
  });
});

r.get('/:id', need('invoices_issue', 'invoices_cancel', 'cash'), async (req, res) => {
  const i = await one(
    `select i.*, o.number as order_number from invoices i left join orders o on o.id = i.order_id where i.id = $1 and i.company_id = $2`,
    [req.params.id, req.companyId]);
  if (!i) throw notFound();
  res.json(i);
});

r.post('/', need('invoices_issue'), async (req, res) => {
  const d = parse(z.object({ order_id: z.string().uuid(), kind: z.enum(['nfse', 'nfe']), prepare_only: z.boolean().default(false) }), req.body);
  const inv = await tx(async (db) => {
    await db.query('select id from companies where id = $1 for update', [req.companyId]);
    const ctx = await context(req.companyId, d.order_id);
    const { rows: dup } = await db.query(
      "select id, status from invoices where order_id = $1 and kind = $2 and status in ('processando','autorizada')", [d.order_id, d.kind]);
    if (dup.length) throw bad(`Já existe ${d.kind === 'nfe' ? 'NF-e' : 'NFS-e'} ${dup[0].status === 'autorizada' ? 'autorizada' : 'em processamento'} para esta OS. Cancele-a antes de emitir outra.`);
    // um único documento em preparação por OS/tipo
    await db.query("delete from invoices where order_id = $1 and kind = $2 and status in ('preparada','erro')", [d.order_id, d.kind]);
    const f = ctx.fiscal;
    const useFocus = f.provider === 'focus';
    const b = build(d.kind, ctx, f[dpsKey(f.environment)]);
    if (b.amount <= 0) throw bad(d.kind === 'nfe' ? 'Não há materiais com valor para a NF-e.' : 'Não há serviços com valor para a NFS-e.');
    if (useFocus && b.warnings.length) throw bad(`Corrija antes de emitir: ${b.warnings.join(' · ')}`);
    const ref = `tv${d.kind}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const snapshotCustomer = ctx.customer ? { name: ctx.customer.name, document: ctx.customer.document, email: ctx.customer.email,
      city: ctx.customer.city, uf: ctx.customer.uf } : { name: 'Consumidor' };
    const base = [req.companyId, d.order_id, ctx.order.customer_id, d.kind, useFocus ? 'focus' : 'interno', useFocus ? f.environment : null,
      ref, b.amount, b.description, snapshotCustomer, JSON.stringify(b.items.map((i) => ({ description: i.description, qty: i.qty, unit: i.unit, unit_price: i.unit_price, total: i.net })))];

    if (!useFocus || d.prepare_only) {
      const { rows: [row] } = await db.query(
        `insert into invoices (company_id, order_id, customer_id, kind, provider, environment, ref, amount, description, customer, items,
                               status, message, request, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,'preparada',$12,$13,$14) returning *`,
        [...base, useFocus ? 'Preparada para conferência — ainda não enviada ao provedor.' : 'Emissão indisponível: integração fiscal não configurada.',
          { ...b.payload, _endpoint: b.endpoint, _warnings: b.warnings }, req.user.id]);
      await logEvent(db, d.order_id, { type: 'nota', message: `${d.kind === 'nfe' ? 'NF-e' : 'NFS-e'} preparada para conferência (sem emissão)`, userId: req.user.id });
      await audit(db, req, { entity: 'invoice', entityId: row.id, action: 'preparar', summary: `${d.kind.toUpperCase()} preparada · ${b.amount}` });
      return row;
    }

    if (b.endpoint === 'nfsen') {
      await db.query("update companies set fiscal = jsonb_set(fiscal, $3::text[], to_jsonb($2::int)) where id = $1",
        [req.companyId, f[dpsKey(f.environment)] + 1, [dpsKey(f.environment)]]);
    }
    const resp = await focusRequest(f, 'POST', `/${b.endpoint}?ref=${ref}`, b.payload);
    const ok = resp.status >= 200 && resp.status < 300;
    const status = ok ? (mapStatus(resp.data.status) || 'processando') : 'erro';
    const doc = extractDoc(resp.data, f.environment);
    const { rows: [row] } = await db.query(
      `insert into invoices (company_id, order_id, customer_id, kind, provider, environment, ref, amount, description, customer, items,
                             status, number, series, access_key, verification_code, pdf_url, xml_url, message, request, response,
                             issued_at, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,
               case when $12 = 'autorizada' then now() end, $22) returning *`,
      [...base, status, doc.number, doc.series, doc.access_key, doc.verification_code, doc.pdf_url, doc.xml_url,
        ok ? (status === 'autorizada' ? 'Autorizada' : 'Enviada para autorização') : errorMessage(resp.data) || `Erro ${resp.status}`,
        { ...b.payload, _endpoint: b.endpoint }, resp.data, req.user.id]);
    await logEvent(db, d.order_id, { type: 'nota', message: `${d.kind === 'nfe' ? 'NF-e' : 'NFS-e'} enviada à Focus NFe (${status})`, userId: req.user.id });
    await audit(db, req, { entity: 'invoice', entityId: row.id, action: 'emitir', summary: `${d.kind.toUpperCase()} enviada à Focus NFe (${f.environment}) · ${b.amount} · situação ${status}` });
    return row;
  });
  res.status(201).json(inv);
});

/** Consulta a situação na Focus NFe e atualiza a nota. */
r.post('/:id/refresh', need('invoices_issue', 'invoices_cancel'), async (req, res) => {
  const inv = await one('select * from invoices where id = $1 and company_id = $2', [req.params.id, req.companyId]);
  if (!inv) throw notFound();
  if (inv.provider !== 'focus') return res.json(inv);
  const company = await one('select fiscal from companies where id = $1', [req.companyId]);
  const f = { ...fiscalWithDefaults(company.fiscal), environment: inv.environment };
  const endpoint = inv.request?._endpoint || inv.kind;
  const resp = await focusRequest(f, 'GET', `/${endpoint}/${inv.ref}`);
  if (resp.status >= 400) throw bad(errorMessage(resp.data) || `Focus NFe respondeu ${resp.status}`);
  const status = mapStatus(resp.data.status) || inv.status;
  const doc = extractDoc(resp.data, inv.environment);
  const row = await one(
    `update invoices set status = $2, number = coalesce($3, number), series = coalesce($4, series), access_key = coalesce($5, access_key),
            verification_code = coalesce($6, verification_code), pdf_url = coalesce($7, pdf_url), xml_url = coalesce($8, xml_url),
            message = $9, response = $10, issued_at = case when $2 = 'autorizada' then coalesce(issued_at, now()) else issued_at end
      where id = $1 returning *`,
    [inv.id, status, doc.number, doc.series, doc.access_key, doc.verification_code, doc.pdf_url, doc.xml_url,
      status === 'autorizada' ? 'Autorizada' : status === 'processando' ? 'Processando na prefeitura/SEFAZ' : errorMessage(resp.data) || status,
      resp.data]);
  res.json(row);
});

r.post('/:id/cancel', need('invoices_cancel'), async (req, res) => {
  const d = parse(z.object({ reason: z.string().trim().min(15, 'a justificativa deve ter ao menos 15 caracteres').max(255) }), req.body);
  const inv = await one('select * from invoices where id = $1 and company_id = $2', [req.params.id, req.companyId]);
  if (!inv) throw notFound();
  if (inv.status === 'cancelada') throw bad('Nota já cancelada.');
  if (inv.status === 'preparada') throw bad('Documento apenas preparado (sem emissão): descarte-o em vez de cancelar.');
  if (inv.provider === 'focus') {
    if (inv.status !== 'autorizada') throw bad('Só notas autorizadas podem ser canceladas na Focus NFe.');
    const company = await one('select fiscal from companies where id = $1', [req.companyId]);
    const f = { ...fiscalWithDefaults(company.fiscal), environment: inv.environment };
    const resp = await focusRequest(f, 'DELETE', `/${inv.request?._endpoint || inv.kind}/${inv.ref}`, { justificativa: d.reason });
    const st = resp.data?.status;
    if (resp.status >= 400 || (st && st !== 'cancelado')) throw bad(errorMessage(resp.data) || `Cancelamento recusado (${st || resp.status}).`);
  }
  const row = await one(
    "update invoices set status = 'cancelada', cancelled_at = now(), cancel_reason = $2, message = 'Cancelada' where id = $1 returning *",
    [inv.id, d.reason]);
  if (inv.order_id) await logEvent({ query: q }, inv.order_id, { type: 'nota', message: `Nota ${inv.number || ''} cancelada: ${d.reason}`, userId: req.user.id });
  await audit(null, req, { entity: 'invoice', entityId: inv.id, action: 'cancelar', summary: `${inv.kind.toUpperCase()} ${inv.number || ''} cancelada: ${d.reason}` });
  res.json(row);
});

/** Descarta documento preparado ou com erro (nunca autorizado), liberando nova emissão. */
r.delete('/:id', need('invoices_issue'), async (req, res) => {
  const row = await one("delete from invoices where id = $1 and company_id = $2 and status in ('erro','preparada') returning id, kind, status, amount", [req.params.id, req.companyId]);
  if (!row) throw bad('Só documentos preparados ou com erro podem ser descartados.');
  await audit(null, req, { entity: 'invoice', entityId: row.id, action: 'descartar', summary: `${row.kind.toUpperCase()} ${row.status} descartada · ${row.amount}` });
  res.status(204).end();
});

export default r;
