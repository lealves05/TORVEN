// Notas fiscais (NFS-e de serviços e NF-e de materiais). Emissão pelo emitente escolhido (cada CNPJ com seu emissor:
// Focus, NFE.io, PlugNotas, Nuvem Fiscal, eNotas, API própria ou registro manual). Sem emitente cadastrado, segue a
// configuração antiga (Focus NFe na própria empresa). Nada é dado como autorizado sem a resposta do emissor.
import { Router } from 'express';
import { z } from 'zod';
import { q, one, tx } from '../db.js';
import { need } from '../auth.js';
import { parse, notFound, bad, fiscalWithDefaults, dpsKey } from '../util.js';
import { buildNfse, buildNfe, focusRequest, mapStatus, errorMessage, extractDoc } from '../fiscal.js';
import { logEvent } from '../domain.js';
import { audit } from '../audit.js';
import { unseal } from '../secretbox.js';
import { PROVIDERS } from '../fiscal/providers.js';
import { buildDocument, emitterSettings } from '../fiscal/document.js';

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
const safeUnseal = (enc) => { try { return unseal(enc); } catch { return {}; } };
const docLabel = (kind) => (kind === 'nfe' ? 'NF-e' : 'NFS-e');

/** Emitente escolhido (ou o padrão). null = sem emitentes cadastrados → configuração antiga. */
async function resolveEmitter(companyId, emitterId, db = { query: q }, lock = false) {
  if (emitterId) {
    const { rows: [em] } = await db.query(`select * from fiscal_emitters where id = $1 and company_id = $2${lock ? ' for update' : ''}`, [emitterId, companyId]);
    if (!em) throw notFound('Emitente não encontrado');
    if (!em.active) throw bad('Este emitente está desativado.');
    return em;
  }
  const { rows: [em] } = await db.query(
    `select * from fiscal_emitters where company_id = $1 and active order by is_default desc, created_at limit 1${lock ? ' for update' : ''}`, [companyId]);
  return em || null;
}

/** Documento neutro + envio no formato do emissor do emitente. */
function emitterBuild(kind, ctx, em) {
  const env = em.environment;
  const doc = buildDocument({ kind, em, order: ctx.order, customer: ctx.customer, items: ctx.items, ref: ctx.ref || '(prévia)' });
  const raw = { kind, ctx: { customer: ctx.customer, order: ctx.order, items: ctx.items }, settings: emitterSettings(em) };
  const dps = em[`next_dps_${env}`];
  const nfeNumber = em[`next_nfe_${env}`];
  const p = PROVIDERS[em.provider];
  if (!em.docs?.[kind]) doc.warnings.unshift(`O emitente "${em.name}" não está habilitado para ${docLabel(kind)}.`);
  const out = p.manual ? { endpoint: 'manual', payload: null } : p.preview({ em, doc, raw, dps, nfeNumber });
  return { doc, raw, dps, nfeNumber, p, ...out };
}

const itemsSnapshot = (doc) => JSON.stringify(doc.items.map((i) => ({ description: i.description, qty: i.qty, unit: i.unit, unit_price: i.unit_price, total: i.total })));
const emitterView = (em) => (em ? { id: em.id, name: em.name, cnpj: em.cnpj, razao_social: em.razao_social, provider: em.provider,
  provider_name: PROVIDERS[em.provider]?.name, environment: em.environment, manual: !!PROVIDERS[em.provider]?.manual } : null);

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
            i.customer->>'name' as customer_name, i.emitter_id, i.external_id, i.manual, fe.name as emitter_name, fe.cnpj as emitter_cnpj
       from invoices i left join orders o on o.id = i.order_id left join fiscal_emitters fe on fe.id = i.emitter_id
      where ${where} order by i.created_at desc limit 1000`, params);
  res.json(rows.map((x) => ({ ...x, files_proxy: !!(x.emitter_id && x.external_id && PROVIDERS[x.provider]?.download) })));
});

r.get('/preview', need('invoices_issue'), async (req, res) => {
  const d = parse(z.object({ order_id: z.string().uuid(), kind: z.enum(['nfse', 'nfe']), emitter_id: z.string().uuid().optional() }), req.query);
  const ctx = await context(req.companyId, d.order_id);
  const { rows: existing } = await q(
    "select id, status, number from invoices where order_id = $1 and kind = $2 and status in ('processando','autorizada')", [d.order_id, d.kind]);
  const em = await resolveEmitter(req.companyId, d.emitter_id);
  if (em) {
    const b = emitterBuild(d.kind, ctx, em);
    return res.json({
      kind: d.kind, provider: em.provider, environment: em.environment, endpoint: b.endpoint, emitter: emitterView(em), manual: !!b.p.manual,
      amount: b.doc.amount, warnings: b.doc.warnings, description: b.doc.description, payload: b.payload, existing, document: b.doc,
      items: b.doc.items.map((i) => ({ ...i, net: i.total })),
      customer: ctx.customer ? { name: ctx.customer.name, document: ctx.customer.document, city: ctx.customer.city, uf: ctx.customer.uf } : null,
    });
  }
  const b = build(d.kind, ctx, ctx.fiscal[dpsKey(ctx.fiscal.environment)]);
  res.json({ emitter: null,
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
  const d = parse(z.object({ order_id: z.string().uuid(), kind: z.enum(['nfse', 'nfe']), prepare_only: z.boolean().default(false),
    emitter_id: z.string().uuid().optional() }), req.body);
  const inv = await tx(async (db) => {
    await db.query('select id from companies where id = $1 for no key update', [req.companyId]);
    const ctx = await context(req.companyId, d.order_id);
    const { rows: dup } = await db.query(
      "select id, status from invoices where order_id = $1 and kind = $2 and status in ('processando','autorizada')", [d.order_id, d.kind]);
    if (dup.length) throw bad(`Já existe ${d.kind === 'nfe' ? 'NF-e' : 'NFS-e'} ${dup[0].status === 'autorizada' ? 'autorizada' : 'em processamento'} para esta OS. Cancele-a antes de emitir outra.`);
    // um único documento em preparação por OS/tipo
    await db.query("delete from invoices where order_id = $1 and kind = $2 and status in ('preparada','erro')", [d.order_id, d.kind]);
    const em = await resolveEmitter(req.companyId, d.emitter_id, db, true);
    if (em) return issueWithEmitter(db, req, d, { ...ctx, ref: `tv${d.kind}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` }, em);
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

async function issueWithEmitter(db, req, d, ctx, em) {
  const b = emitterBuild(d.kind, ctx, em);
  const { doc, p } = b;
  const label = docLabel(d.kind);
  if (doc.amount <= 0) throw bad(d.kind === 'nfe' ? 'Não há materiais com valor para a NF-e.' : 'Não há serviços com valor para a NFS-e.');
  if (!em.docs?.[d.kind]) throw bad(`O emitente "${em.name}" não está habilitado para ${label}. Ajuste em Configurações › Fiscal.`);
  const snapshotCustomer = ctx.customer ? { name: ctx.customer.name, document: ctx.customer.document, email: ctx.customer.email,
    city: ctx.customer.city, uf: ctx.customer.uf } : { name: 'Consumidor' };
  const base = [req.companyId, d.order_id, ctx.order.customer_id, d.kind, em.provider, em.environment, ctx.ref, doc.amount, doc.description, snapshotCustomer,
    itemsSnapshot(doc), em.id];

  if (p.manual || d.prepare_only) {
    const msg = p.manual ? 'Preparada para emitir no site da prefeitura/SEFAZ. Depois de emitir lá, registre aqui o número da nota.'
      : `Preparada para conferência — ainda não enviada a ${p.name}.`;
    const { rows: [row] } = await db.query(
      `insert into invoices (company_id, order_id, customer_id, kind, provider, environment, ref, amount, description, customer, items, emitter_id,
                             status, message, request, manual, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,'preparada',$13,$14,$15,$16) returning *`,
      [...base, msg, { _endpoint: b.endpoint, _body: b.payload, _document: doc, _warnings: doc.warnings }, !!p.manual, req.user.id]);
    await logEvent(db, d.order_id, { type: 'nota', message: `${label} preparada (${em.name}) — sem emissão`, userId: req.user.id });
    await audit(db, req, { entity: 'invoice', entityId: row.id, action: 'preparar', summary: `${label} preparada · emitente ${em.name} · ${doc.amount}` });
    return row;
  }

  if (doc.warnings.length) throw bad(`Corrija antes de emitir: ${doc.warnings.join(' · ')}`);
  const sec = safeUnseal(em.secret_enc);
  const out = await p.issue({ em, sec, doc, raw: b.raw, dps: b.dps, nfeNumber: b.nfeNumber });
  const env = em.environment;
  if (out.uses_dps) await db.query(`update fiscal_emitters set next_dps_${env === 'producao' ? 'producao' : 'homologacao'} = next_dps_${env === 'producao' ? 'producao' : 'homologacao'} + 1 where id = $1`, [em.id]);
  if (out.uses_nfe_number) await db.query(`update fiscal_emitters set next_nfe_${env === 'producao' ? 'producao' : 'homologacao'} = next_nfe_${env === 'producao' ? 'producao' : 'homologacao'} + 1 where id = $1`, [em.id]);
  const status = ['processando', 'autorizada', 'erro'].includes(out.status) ? out.status : 'processando';
  const { rows: [row] } = await db.query(
    `insert into invoices (company_id, order_id, customer_id, kind, provider, environment, ref, amount, description, customer, items, emitter_id,
                           status, external_id, number, series, access_key, verification_code, pdf_url, xml_url, message, request, response, issued_at, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,
             case when $13 = 'autorizada' then now() end, $24) returning *`,
    [...base, status, out.external_id || null, out.number ?? null, out.series ?? null, out.access_key ?? null, out.verification_code ?? null,
      out.pdf_url ?? null, out.xml_url ?? null, String(out.message || status).slice(0, 1000), out.request || null, out.response ?? null, req.user.id]);
  await logEvent(db, d.order_id, { type: 'nota', message: `${label} enviada a ${p.name} pelo emitente ${em.name} (${status})`, userId: req.user.id });
  await audit(db, req, { entity: 'invoice', entityId: row.id, action: 'emitir',
    summary: `${label} enviada a ${p.name} (${env}) · emitente ${em.name} ${em.cnpj} · ${doc.amount} · situação ${status}` });
  return row;
}

async function invoiceEmitter(inv) {
  const em = await one('select * from fiscal_emitters where id = $1 and company_id = $2', [inv.emitter_id, inv.company_id]);
  if (!em) throw bad('O emitente desta nota foi excluído; consulte a nota direto no emissor.');
  return { em, p: PROVIDERS[inv.provider] || PROVIDERS[em.provider], sec: safeUnseal(em.secret_enc) };
}

async function applyRefresh(inv, out) {
  const status = ['processando', 'autorizada', 'erro', 'cancelada'].includes(out.status) ? out.status : inv.status;
  return one(
    `update invoices set status = $2, number = coalesce($3, number), series = coalesce($4, series), access_key = coalesce($5, access_key),
            verification_code = coalesce($6, verification_code), pdf_url = coalesce($7, pdf_url), xml_url = coalesce($8, xml_url),
            message = $9, response = $10, issued_at = case when $2 = 'autorizada' then coalesce(issued_at, now()) else issued_at end,
            cancelled_at = case when $2 = 'cancelada' then coalesce(cancelled_at, now()) else cancelled_at end
      where id = $1 returning *`,
    [inv.id, status, out.number ?? null, out.series ?? null, out.access_key ?? null, out.verification_code ?? null, out.pdf_url ?? null, out.xml_url ?? null,
      String(out.message || status).slice(0, 1000), out.response ?? null]);
}

/** Consulta a situação no emissor e atualiza a nota. */
r.post('/:id/refresh', need('invoices_issue', 'invoices_cancel'), async (req, res) => {
  const inv = await one('select * from invoices where id = $1 and company_id = $2', [req.params.id, req.companyId]);
  if (!inv) throw notFound();
  if (inv.emitter_id) {
    if (inv.manual || inv.status === 'preparada' || !inv.external_id) return res.json(inv);
    const { em, p, sec } = await invoiceEmitter(inv);
    const out = await p.refresh({ em, sec, inv });
    const row = await applyRefresh(inv, out);
    if (row.status !== inv.status && inv.order_id) {
      await logEvent({ query: q }, inv.order_id, { type: 'nota', message: `${docLabel(inv.kind)} ${row.number || ''} agora está ${row.status} (${p.name})`, userId: req.user.id });
    }
    return res.json(row);
  }
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
  if (inv.emitter_id && !inv.manual) {
    if (inv.status !== 'autorizada') throw bad('Só notas autorizadas podem ser canceladas no emissor.');
    const { em, p, sec } = await invoiceEmitter(inv);
    const out = await p.cancel({ em, sec, inv, reason: d.reason });
    if (out.status !== 'cancelada') {
      // pedido aceito, mas a prefeitura/SEFAZ ainda vai confirmar: continua autorizada até a consulta dizer "cancelada"
      const row = await one('update invoices set cancel_reason = $2, message = $3 where id = $1 returning *', [inv.id, d.reason, out.message || 'Cancelamento solicitado']);
      if (inv.order_id) await logEvent({ query: q }, inv.order_id, { type: 'nota', message: `Cancelamento da nota ${inv.number || ''} solicitado a ${p.name}: ${d.reason}`, userId: req.user.id });
      await audit(null, req, { entity: 'invoice', entityId: inv.id, action: 'cancelar', summary: `Cancelamento de ${inv.kind.toUpperCase()} ${inv.number || ''} solicitado a ${p.name}: ${d.reason}` });
      return res.json(row);
    }
  } else if (inv.provider === 'focus') {
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

/** Registra o número de uma nota emitida fora do TORVEN (site da prefeitura/SEFAZ). Fica marcada como "registrada manualmente". */
r.post('/:id/manual', need('invoices_issue'), async (req, res) => {
  const d = parse(z.object({
    number: z.string().trim().min(1, 'Informe o número da nota emitida').max(30),
    series: z.string().trim().max(10).optional().nullable(),
    access_key: z.string().trim().max(60).optional().nullable().transform((v) => (v ? v.replace(/\s/g, '') : null)),
    verification_code: z.string().trim().max(60).optional().nullable(),
    issued_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida'),
    pdf_url: z.string().trim().url('Link inválido').max(500).refine((v) => v.startsWith('https://'), 'Use um link https').optional().nullable().or(z.literal('').transform(() => null)),
  }), req.body);
  const inv = await one('select * from invoices where id = $1 and company_id = $2', [req.params.id, req.companyId]);
  if (!inv) throw notFound();
  if (!inv.manual || inv.status !== 'preparada') throw bad('Só documentos preparados para emissão manual podem ser registrados.');
  if (new Date(`${d.issued_at}T12:00:00Z`) > new Date(Date.now() + 86400000)) throw bad('A data de emissão não pode estar no futuro.');
  const row = await one(
    `update invoices set status = 'autorizada', number = $2, series = $3, access_key = $4, verification_code = $5, pdf_url = $6,
            issued_at = ($7::date + time '12:00') at time zone 'America/Sao_Paulo', message = $8 where id = $1 returning *`,
    [inv.id, d.number, d.series || null, d.access_key || null, d.verification_code || null, d.pdf_url || null, d.issued_at,
      `Emitida fora do TORVEN e registrada manualmente por ${req.user.name || 'usuário'}`]);
  if (inv.order_id) await logEvent({ query: q }, inv.order_id, { type: 'nota', message: `${docLabel(inv.kind)} nº ${d.number} registrada manualmente (emitida fora do TORVEN)`, userId: req.user.id });
  await audit(null, req, { entity: 'invoice', entityId: inv.id, action: 'registrar_manual', summary: `${inv.kind.toUpperCase()} nº ${d.number} registrada manualmente · ${inv.amount}` });
  res.json(row);
});

/** PDF/XML de emissores que exigem a chave para baixar: o TORVEN busca e repassa (a chave nunca vai para o navegador). */
r.get('/:id/file/:type', need('invoices_issue', 'invoices_cancel', 'cash'), async (req, res) => {
  const type = req.params.type;
  if (!['pdf', 'xml'].includes(type)) throw bad('Tipo de arquivo inválido.');
  const inv = await one('select * from invoices where id = $1 and company_id = $2', [req.params.id, req.companyId]);
  if (!inv) throw notFound();
  if (!inv.emitter_id || !inv.external_id || !['autorizada', 'cancelada'].includes(inv.status)) throw bad('Arquivo ainda não disponível para esta nota.');
  const { em, p, sec } = await invoiceEmitter(inv);
  if (!p.download) throw bad('Este emissor envia o link do arquivo direto na nota.');
  const out = await p.download({ em, sec, inv, type });
  if (out.status >= 400 || !out.buffer?.length) throw bad(`O emissor não devolveu o ${type.toUpperCase()} (${out.status}). Tente de novo em instantes.`);
  if (out.buffer.length > 15 * 1024 * 1024) throw bad('Arquivo grande demais.');
  const ctype = type === 'pdf' ? 'application/pdf' : 'application/xml';
  res.set('Content-Type', ctype);
  res.set('Content-Disposition', `attachment; filename="${inv.kind}-${(inv.number || inv.ref).replace(/[^\w.-]/g, '')}.${type}"`);
  res.set('Cache-Control', 'private, no-store');
  res.set('X-Content-Type-Options', 'nosniff');
  res.send(out.buffer);
});

/** Descarta documento preparado ou com erro (nunca autorizado), liberando nova emissão. */
r.delete('/:id', need('invoices_issue'), async (req, res) => {
  const row = await one("delete from invoices where id = $1 and company_id = $2 and status in ('erro','preparada') returning id, kind, status, amount", [req.params.id, req.companyId]);
  if (!row) throw bad('Só documentos preparados ou com erro podem ser descartados.');
  await audit(null, req, { entity: 'invoice', entityId: row.id, action: 'descartar', summary: `${row.kind.toUpperCase()} ${row.status} descartada · ${row.amount}` });
  res.status(204).end();
});

export default r;
