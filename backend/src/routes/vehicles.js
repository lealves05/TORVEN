// Placa do veículo: busca no cadastro (veículo + cliente), consulta paga quando não há cadastro e cadastro simples.
import { Router } from 'express';
import { z } from 'zod';
import { q, tx } from '../db.js';
import { need, can } from '../auth.js';
import { parse, bad, HttpError, validDocument, onlyDigits } from '../util.js';
import { listIntegrations, loadIntegration } from '../integrations/store.js';
import { normalizePlate, formatPlate, lookupPlate, PLATE_PROVIDERS } from '../integrations/plates.js';

const r = Router();
r.use(need('customers_edit', 'orders_create', 'customers_view'));
const s = z.string().trim();
const opt = s.max(160).nullable().optional();

const plateSql = "upper(replace(e.plate, '-', ''))";

async function findByPlate(companyId, plate) {
  const { rows } = await q(
    `select e.id, e.customer_id, e.description, e.brand, e.model, e.year, e.color, e.plate, e.category,
            c.name as customer_name, c.phone as customer_phone, c.document as customer_document, c.kind as customer_kind
       from equipment e join customers c on c.id = e.customer_id
      where e.company_id = $1 and e.active and ${plateSql} = $2
      order by e.created_at desc limit 5`, [companyId, plate]);
  return rows;
}

/**
 * GET /vehicles/plate/:plate?consultar=1
 * 1) cadastro da empresa; 2) consulta paga (se ativa, dentro do limite do mês, com reaproveitamento); 3) nada → cadastro manual.
 */
r.get('/plate/:plate', async (req, res) => {
  const plate = normalizePlate(req.params.plate);
  if (!plate) throw bad('Placa inválida. Use o formato ABC1D23 (Mercosul) ou ABC-1234.');
  const found = await findByPlate(req.companyId, plate);
  const hideContact = !can(req, 'customers_contact');
  if (found.length) {
    return res.json({ plate: formatPlate(plate), found: true,
      matches: found.map((m) => (hideContact ? { ...m, customer_phone: null, customer_document: null } : m)) });
  }
  const active = (await listIntegrations(req.companyId, 'placa')).find((x) => x.enabled);
  const base = { plate: formatPlate(plate), found: false, lookup_available: !!active, provider: active ? PLATE_PROVIDERS[active.provider]?.name : null };
  if (!active || req.query.consultar !== '1') return res.json(base);

  const cfg = await loadIntegration(req.companyId, 'placa', active.provider);
  const cacheDays = Number(cfg.config?.cache_days ?? 180);
  if (cacheDays > 0) {
    const { rows: [hit] } = await q(`select data from plate_lookups where company_id = $1 and plate = $2 and ok and data is not null
                                       and created_at > now() - make_interval(days => $3) order by created_at desc limit 1`, [req.companyId, plate, cacheDays]);
    if (hit) {
      await q("insert into plate_lookups (company_id, plate, provider, ok, data, message, user_id) values ($1,$2,'cache',true,$3,'reaproveitada',$4)",
        [req.companyId, plate, hit.data, req.user.id]);
      return res.json({ ...base, vehicle: hit.data, source: 'cache' });
    }
  }
  const limit = Number(cfg.config?.monthly_limit ?? 200);
  const { rows: [m] } = await q(`select count(*)::int as n from plate_lookups where company_id = $1 and provider <> 'cache'
                                   and created_at >= date_trunc('month', now())`, [req.companyId]);
  if (limit >= 0 && m.n >= limit) {
    throw new HttpError(429, `Limite de ${limit} consultas de placa neste mês atingido. Cadastre o veículo manualmente ou aumente o limite em Configurações › Integrações.`);
  }
  let out;
  try {
    out = await lookupPlate(active.provider, cfg.config || {}, cfg.secrets || {}, plate);
  } catch (e) {
    await q('insert into plate_lookups (company_id, plate, provider, ok, message, user_id) values ($1,$2,$3,false,$4,$5)',
      [req.companyId, plate, active.provider, String(e.message).slice(0, 200), req.user.id]);
    throw e;
  }
  await q('insert into plate_lookups (company_id, plate, provider, ok, data, message, user_id) values ($1,$2,$3,$4,$5,$6,$7)',
    [req.companyId, plate, active.provider, !!out.found, out.vehicle || null, out.message || null, req.user.id]);
  res.json({ ...base, vehicle: out.vehicle || null, message: out.message || null, source: active.provider });
});

/** Cadastro simples: cliente (existente ou novo) + veículo, numa transação. */
const quickSchema = z.object({
  customer_id: z.string().uuid().nullable().optional(),
  customer: z.object({
    name: s.min(2, 'informe o nome do cliente').max(160), phone: opt, document: opt, email: s.email('e-mail inválido').max(160).nullable().optional().or(z.literal('')),
  }).nullable().optional(),
  vehicle: z.object({
    plate: s.min(7).max(8), brand: opt, model: opt, year: s.max(20).nullable().optional(), color: s.max(40).nullable().optional(),
    description: opt, notes: s.max(500).nullable().optional(), data: z.record(z.string(), z.any()).nullable().optional(),
  }),
});

r.post('/quick', need('customers_edit', 'orders_create'), async (req, res) => {
  const d = parse(quickSchema, req.body);
  const plate = normalizePlate(d.vehicle.plate);
  if (!plate) throw bad('Placa inválida.');
  if (!d.customer_id && !d.customer) throw bad('Escolha o cliente ou preencha o cadastro simples.');
  const doc = d.customer?.document ? onlyDigits(d.customer.document) : '';
  if (doc && !validDocument(doc)) throw bad('CPF/CNPJ inválido.');
  const out = await tx(async (db) => {
    const { rows: [dup] } = await db.query(`select e.id from equipment e where e.company_id = $1 and e.active and ${plateSql} = $2 limit 1`, [req.companyId, plate]);
    if (dup) throw new HttpError(409, 'Esta placa já está cadastrada. Use o veículo existente.', { equipment_id: dup.id });
    let customerId = d.customer_id || null;
    if (customerId) {
      const { rows: [c] } = await db.query('select id from customers where id = $1 and company_id = $2', [customerId, req.companyId]);
      if (!c) throw bad('Cliente não encontrado.');
    } else {
      const { rows: [c] } = await db.query(
        `insert into customers (company_id, kind, name, phone, document, email, notes) values ($1,$2,$3,$4,$5,$6,'Cadastro simples pela placa') returning id`,
        [req.companyId, doc.length === 14 ? 'pj' : 'pf', d.customer.name, d.customer.phone || null, doc || null, d.customer.email || null]);
      customerId = c.id;
    }
    const v = d.vehicle;
    const description = (v.description || [v.brand, v.model].filter(Boolean).join(' ') || `Veículo ${formatPlate(plate)}`).slice(0, 160);
    const { rows: [e] } = await db.query(
      `insert into equipment (company_id, customer_id, category, description, brand, model, year, plate, color, notes, vehicle_data)
       values ($1,$2,'Veículo',$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
      [req.companyId, customerId, description, v.brand || null, v.model || null, v.year || null, formatPlate(plate), v.color || null, v.notes || null,
        v.data ? JSON.stringify(v.data) : null]);
    return { customer_id: customerId, equipment_id: e.id };
  });
  res.status(201).json(out);
});

export default r;
