// Atendimento pelo WhatsApp: configuração (Meta + IA), conversas, resposta da equipe, teste do agente
// e aprovação dos pedidos (pré-OS) que o agente registrou. O webhook público da Meta fica em `webhook` (sem login).
import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { q, one, tx } from '../db.js';
import { need, can } from '../auth.js';
import { parse, notFound, bad, HttpError, withDefaults, utcToZoned } from '../util.js';
import { audit } from '../audit.js';
import { listIntegrations, loadIntegration, saveIntegration, publicView } from '../integrations/store.js';
import { unseal } from '../secretbox.js';
import { WA_FIELDS, WA_SECRETS, sendText, validSignature, inboundMessages, normalizePhone } from '../integrations/whatsapp.js';
import { AI_MODELS } from '../integrations/ai.js';
import { handleInbound, AGENT_DEFAULTS, saveMessage } from '../whatsappAgent.js';
import { createOrderFromRequest, addEvent, OPEN_REQUEST } from './requests.js';
import { conflicts } from './schedule.js';
import { checkVehiclePlate } from '../vehicleRules.js';
import { normalizePlate, formatPlate } from '../integrations/plates.js';
import { limitByIp, hit } from '../security.js';
import { accessFor } from '../platform.js';

const r = Router();
const s = z.string().trim();
const safeUnseal = (enc) => { try { return unseal(enc); } catch { return {}; } };
const WINDOW_MS = 24 * 3600 * 1000;

/** Função de envio da empresa (API da Meta). Conversa de teste nunca envia nada. */
export async function senderFor(companyId, preloaded = null) {
  const wa = preloaded || await loadIntegration(companyId, 'whatsapp', 'meta').catch(() => null);
  return async (conv, text) => {
    if (conv.simulated) return { status: 'simulado' };
    if (!wa?.enabled) throw new HttpError(400, 'WhatsApp desligado em Configurações › Integrações.');
    return { status: 'enviado', waId: await sendText(wa.config, wa.secrets, conv.phone, text) };
  };
}

// ================= configuração =================
r.get('/config', need('integrations'), async (req, res) => {
  const [wa] = await listIntegrations(req.companyId, 'whatsapp');
  const [ai] = await listIntegrations(req.companyId, 'ia');
  const base = process.env.PUBLIC_API_URL ? process.env.PUBLIC_API_URL.replace(/\/$/, '') : null; // a tela usa o endereço do site quando não há
  res.json({
    fields: WA_FIELDS, secrets: WA_SECRETS, defaults: AGENT_DEFAULTS, models: AI_MODELS,
    whatsapp: wa ? publicView({ ...wa, secrets: safeUnseal(wa.secret_enc) }, WA_SECRETS.map((x) => x.key)) : null,
    ai: ai ? publicView({ ...ai, secrets: safeUnseal(ai.secret_enc) }, ['api_key']) : null,
    webhook_url: base ? `${base}/webhooks/whatsapp` : null,
  });
});

const hhmm = s.regex(/^\d{2}:\d{2}$/, 'use HH:MM');
const waSchema = z.object({
  enabled: z.boolean().default(false),
  config: z.object({
    phone_number_id: s.max(40).regex(/^\d*$/, 'só números').optional().default(''),
    waba_id: s.max(40).optional().default(''),
    display_phone: s.max(30).optional().default(''),
    agent_enabled: z.boolean().default(true),
    ai_enabled: z.boolean().default(false),
    hours_start: hhmm.default('08:00'), hours_end: hhmm.default('18:00'),
    work_days: s.regex(/^[0-6](,[0-6])*$/, 'dias inválidos').default('1,2,3,4,5'),
    slot_minutes: z.coerce.number().int().min(15).max(480).default(60),
    greeting: s.max(500).optional().default(''),
    site_url: s.max(200).regex(/^(https:\/\/[^\s<>"]+|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)?$/, 'o endereço deve começar com https://').optional().default(''),
  }),
  secrets: z.record(z.enum(['access_token', 'app_secret']), z.string().max(600).nullable()).default({}),
});

r.put('/config', need('integrations'), async (req, res) => {
  const d = parse(waSchema, req.body);
  if (d.config.hours_end <= d.config.hours_start) throw bad('O horário final deve ser depois do inicial.');
  const cur = await loadIntegration(req.companyId, 'whatsapp', 'meta').catch(() => null);
  // token de verificação do webhook: gerado pelo sistema, um por empresa
  const verify = cur?.config?.verify_token || crypto.randomBytes(18).toString('base64url');
  const secrets = { ...(cur?.secrets || {}) };
  for (const k of ['access_token', 'app_secret']) if (d.secrets[k] === null) delete secrets[k]; else if (d.secrets[k]) secrets[k] = d.secrets[k];
  if (d.enabled && (!d.config.phone_number_id || !secrets.access_token || !secrets.app_secret)) {
    throw bad('Para ligar, preencha o Phone number ID, o token de acesso e a chave secreta do app.');
  }
  if (d.config.phone_number_id) {
    const { rows: [other] } = await q(
      "select company_id from integration_configs where kind = 'whatsapp' and config->>'phone_number_id' = $1 and company_id <> $2",
      [d.config.phone_number_id, req.companyId]);
    if (other) throw new HttpError(409, 'Este número de WhatsApp já está ligado a outra empresa.');
  }
  const out = await saveIntegration(req.companyId, 'whatsapp', 'meta', { enabled: d.enabled, config: { ...d.config, verify_token: verify }, secrets: d.secrets },
    WA_SECRETS.map((x) => x.key), req.user.id);
  await audit(null, req, { entity: 'integracao', entityId: req.companyId, action: 'update', summary: `WhatsApp (Meta): ${d.enabled ? 'ligado' : 'desligado'}, agente ${d.config.agent_enabled ? 'ligado' : 'desligado'}` });
  res.json(out);
});

r.put('/ai', need('integrations'), async (req, res) => {
  const d = parse(z.object({
    enabled: z.boolean().default(false),
    config: z.object({ model: z.enum(AI_MODELS.map((m) => m.id)).default(AI_MODELS[0].id) }).default({}),
    secrets: z.object({ api_key: z.string().max(300).nullable().optional() }).default({}),
  }), req.body);
  if (d.secrets.api_key && !/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(d.secrets.api_key.trim())) throw bad('A chave da Anthropic começa com "sk-ant-".');
  const cur = await loadIntegration(req.companyId, 'ia', 'anthropic').catch(() => null);
  if (d.enabled && !d.secrets.api_key && !cur?.secrets?.api_key) throw bad('Informe a chave da IA para ligar.');
  const out = await saveIntegration(req.companyId, 'ia', 'anthropic', d, ['api_key'], req.user.id);
  await audit(null, req, { entity: 'integracao', entityId: req.companyId, action: 'update', summary: `IA do agente: ${d.enabled ? 'ligada' : 'desligada'}` });
  res.json(out);
});

/** Teste do agente na própria tela (conversa simulada: nada é enviado). */
r.post('/simulate', need('integrations'), async (req, res) => {
  if (!can(req, 'requests_manage')) throw new HttpError(403, 'Seu perfil de acesso não permite esta ação.');
  const d = parse(z.object({ phone: s.min(10).max(20), name: s.max(80).nullable().optional(), text: s.min(1).max(1000) }), req.body);
  const phone = normalizePhone(d.phone);
  const { rows: [real] } = await q('select id from wa_conversations where company_id = $1 and phone = $2 and not simulated', [req.companyId, phone]);
  if (real) throw bad('Este telefone tem uma conversa real. Use outro número para testar.');
  await q(`insert into wa_conversations (company_id, phone, name, simulated) values ($1,$2,$3,true)
           on conflict (company_id, phone) do nothing`, [req.companyId, phone, d.name || null]);
  const wa = await loadIntegration(req.companyId, 'whatsapp', 'meta').catch(() => null);
  const out = await handleInbound(req.companyId, { from: phone, name: d.name || null, text: d.text, id: null }, async () => ({ status: 'simulado' }),
    { cfg: { ...(wa?.config || {}), agent_enabled: true }, simulated: true });
  res.json({ conversation_id: out.conversation?.id, replies: (out.replies || []).map((m) => m.body), request_id: out.requestId || null });
});

// ================= conversas =================
const convSelect = `select c.*, cu.name as customer_name,
  (select body from wa_messages m where m.conversation_id = c.id order by created_at desc limit 1) as last_body,
  (select count(*)::int from service_requests sr where sr.conversation_id = c.id and sr.status = 'nova') as pending_requests
  from wa_conversations c left join customers cu on cu.id = c.customer_id`;

r.get('/conversations', need('requests_manage'), async (req, res) => {
  const params = [req.companyId];
  let where = 'c.company_id = $1';
  if (req.query.filter === 'humano') where += " and c.mode = 'humano'";
  if (req.query.filter === 'nao_lidas') where += ' and c.unread > 0';
  if (req.query.search) {
    params.push(`%${String(req.query.search).toLowerCase().slice(0, 60)}%`);
    where += ` and (lower(coalesce(c.name,'')) like $2 or c.phone like $2 or lower(coalesce(cu.name,'')) like $2)`;
  }
  const { rows } = await q(`${convSelect} where ${where} order by c.last_message_at desc limit 200`, params);
  res.json(rows);
});

async function loadConv(db, req, lock = false) {
  const { rows: [c] } = await db.query(`select * from wa_conversations where id = $1 and company_id = $2${lock ? ' for update' : ''}`, [req.params.id, req.companyId]);
  if (!c) throw notFound('Conversa não encontrada');
  return c;
}

r.get('/conversations/:id', need('requests_manage'), async (req, res) => {
  const c = await loadConv({ query: q }, req);
  await q('update wa_conversations set unread = 0 where id = $1', [c.id]);
  const { rows: [full] } = await q(`${convSelect} where c.id = $1`, [c.id]);
  const { rows: messages } = await q(
    `select m.id, m.direction, m.author, m.body, m.status, m.error, m.created_at, u.name as user_name
       from wa_messages m left join users u on u.id = m.user_id where m.conversation_id = $1 order by m.created_at desc limit 300`, [c.id]);
  const { rows: requests } = await q(
    `select sr.id, sr.number, sr.title, sr.status, sr.requested_start, sr.plate, sr.order_id, o.number as order_number
       from service_requests sr left join orders o on o.id = sr.order_id where sr.conversation_id = $1 order by sr.created_at desc limit 20`, [c.id]);
  const open = !!c.last_inbound_at && Date.now() - new Date(c.last_inbound_at).getTime() < WINDOW_MS;
  res.json({ ...full, unread: 0, messages: messages.reverse(), requests, window_open: c.simulated || open });
});

r.post('/conversations/:id/reply', need('requests_manage'), async (req, res) => {
  const d = parse(z.object({ text: s.min(1, 'escreva a mensagem').max(4000) }), req.body);
  const c = await loadConv({ query: q }, req);
  if (!c.simulated && (!c.last_inbound_at || Date.now() - new Date(c.last_inbound_at).getTime() >= WINDOW_MS)) {
    throw bad('Passaram mais de 24 horas desde a última mensagem do cliente. Pela regra do WhatsApp, só dá para responder depois que ele escrever de novo.');
  }
  const send = await senderFor(req.companyId);
  const out = await send(c, d.text); // erro de envio volta para a tela e nada é gravado como enviado
  const m = await saveMessage(c, { direction: 'out', author: 'equipe', body: d.text, waId: out.waId || null, status: out.status, userId: req.user.id });
  await q("update wa_conversations set mode = 'humano', last_message_at = now() where id = $1", [c.id]);
  await audit(null, req, { entity: 'whatsapp', entityId: c.id, action: 'reply', summary: `Resposta da equipe no WhatsApp (+${c.phone.slice(0, 4)}…${c.phone.slice(-2)})` });
  res.status(201).json(m);
});

r.post('/conversations/:id/mode', need('requests_manage'), async (req, res) => {
  const d = parse(z.object({ mode: z.enum(['agente', 'humano']) }), req.body);
  const c = await loadConv({ query: q }, req);
  await q("update wa_conversations set mode = $2, state = 'inicio', context = '{}' where id = $1", [c.id, d.mode]);
  res.json({ ok: true, mode: d.mode });
});

r.delete('/conversations/:id', need('integrations'), async (req, res) => {
  const c = await loadConv({ query: q }, req);
  const { rows: [real] } = await q('select 1 from wa_messages where conversation_id = $1 and wa_message_id is not null limit 1', [c.id]);
  if (!c.simulated || real) throw bad('Só conversas de teste podem ser apagadas.');
  await q('delete from wa_conversations where id = $1', [c.id]);
  res.status(204).end();
});

// ================= pedidos (pré-OS) =================
r.get('/requests', need('requests_manage'), async (req, res) => {
  const { rows } = await q(
    `select sr.id, sr.number, sr.title, sr.description, sr.status, sr.requested_start, sr.plate, sr.contact_name, sr.contact_phone,
            sr.customer_id, cu.name as customer_name, sr.conversation_id, sr.created_at
       from service_requests sr left join customers cu on cu.id = sr.customer_id
      where sr.company_id = $1 and sr.channel = 'whatsapp' and sr.conversation_id is not null and sr.status = 'nova'
      order by coalesce(sr.requested_start, sr.created_at) limit 200`, [req.companyId]);
  res.json(rows);
});

async function lockWaRequest(db, req) {
  const { rows: [cur] } = await db.query('select * from service_requests where id = $1 and company_id = $2 for update', [req.params.id, req.companyId]);
  if (!cur || !cur.conversation_id) throw notFound('Pedido do WhatsApp não encontrado');
  if (!OPEN_REQUEST.includes(cur.status) || cur.order_id) throw bad('Este pedido já foi tratado.');
  return cur;
}

async function notify(req, conversationId, text) {
  const c = await one('select * from wa_conversations where id = $1 and company_id = $2', [conversationId, req.companyId]);
  if (!c) return { sent: false, error: 'conversa não encontrada' };
  if (!c.simulated && (!c.last_inbound_at || Date.now() - new Date(c.last_inbound_at).getTime() >= WINDOW_MS)) {
    return { sent: false, error: 'passaram mais de 24 h desde a última mensagem do cliente; avise por telefone' };
  }
  try {
    const out = await (await senderFor(req.companyId))(c, text);
    await saveMessage(c, { direction: 'out', author: 'equipe', body: text, waId: out.waId || null, status: out.status, userId: req.user.id });
    await q('update wa_conversations set last_message_at = now() where id = $1', [c.id]);
    return { sent: true };
  } catch (e) {
    await saveMessage(c, { direction: 'out', author: 'equipe', body: text, status: 'falhou', error: e.message, userId: req.user.id });
    return { sent: false, error: e.message };
  }
}

r.post('/requests/:id/approve', need('orders_create'), async (req, res) => {
  const d = parse(z.object({
    customer_id: z.string().uuid().nullable().optional(),
    technician_id: z.string().uuid().nullable().optional(),
    starts_at: z.string().datetime({ offset: true }).nullable().optional(),
    minutes: z.coerce.number().int().min(15).max(24 * 60).default(60),
    notify: z.boolean().default(true),
    force: z.boolean().default(false),
  }), req.body);
  if (d.starts_at && !can(req, 'schedule_manage')) throw new HttpError(403, 'Seu perfil não permite marcar horários na agenda.');
  const out = await tx(async (db) => {
    const cur = await lockWaRequest(db, req);
    // 1) cliente: o escolhido, o já vinculado ou um cadastro simples com nome e telefone da conversa
    let customerId = d.customer_id || cur.customer_id;
    if (customerId) {
      const { rows: [c] } = await db.query('select id from customers where id = $1 and company_id = $2', [customerId, req.companyId]);
      if (!c) throw notFound('Cliente não encontrado');
    } else {
      const { rows: [c] } = await db.query(
        "insert into customers (company_id, kind, name, phone, notes) values ($1,'pf',$2,$3,'Cadastro simples pelo WhatsApp') returning id",
        [req.companyId, cur.contact_name || 'Cliente do WhatsApp', cur.contact_phone]);
      customerId = c.id;
    }
    // 2) veículo pela placa
    let equipmentId = cur.equipment_id;
    const plate = normalizePlate(cur.plate);
    if (!equipmentId && plate) {
      const { rows: [mine] } = await db.query(
        `select id from equipment where company_id = $1 and customer_id = $2 and active is not false
            and upper(regexp_replace(coalesce(plate,''), '[^A-Za-z0-9]', '', 'g')) = $3 limit 1`, [req.companyId, customerId, plate]);
      if (mine) equipmentId = mine.id;
      else {
        const formatted = await checkVehiclePlate(db, { companyId: req.companyId, settings: req.settings }, plate);
        const { rows: [e] } = await db.query(
          "insert into equipment (company_id, customer_id, category, description, plate) values ($1,$2,'Veículo',$3,$4) returning id",
          [req.companyId, customerId, `Veículo ${formatPlate(plate)}`, formatted]);
        equipmentId = e.id;
      }
    }
    await db.query('update service_requests set customer_id = $2, equipment_id = $3, visit_technician_id = coalesce($4, visit_technician_id) where id = $1',
      [cur.id, customerId, equipmentId, d.technician_id || null]);
    await db.query('update wa_conversations set customer_id = coalesce(customer_id, $2) where id = $1', [cur.conversation_id, customerId]);
    if (d.technician_id) {
      const { rows: [t] } = await db.query('select id from technicians where id = $1 and company_id = $2', [d.technician_id, req.companyId]);
      if (!t) throw notFound('Técnico não encontrado');
    }
    // 3) OS
    const o = await createOrderFromRequest(db, req, { ...cur, customer_id: customerId, equipment_id: equipmentId, visit_technician_id: d.technician_id || cur.visit_technician_id });
    // 4) agenda
    let entry = null;
    if (d.starts_at) {
      const start = new Date(d.starts_at);
      const end = new Date(start.getTime() + d.minutes * 60000);
      if (d.technician_id && !d.force) {
        const c = await conflicts(db, req.companyId, d.technician_id, start.toISOString(), end.toISOString());
        if (c.length) throw new HttpError(409, `O técnico já tem compromisso nesse horário (${c[0].title}).`, { conflicts: c });
      }
      const { rows: [{ name }] } = await db.query('select name from customers where id = $1', [customerId]);
      const { rows: [e] } = await db.query(
        `insert into schedule_entries (company_id, unit_id, kind, title, order_id, request_id, technician_id, starts_at, ends_at, notes, created_by)
         values ($1,$2,'execucao',$3,$4,$5,$6,$7,$8,$9,$10) returning id, starts_at`,
        [req.companyId, cur.unit_id, `OS nº ${o.number} — ${name}${plate ? ` (${formatPlate(plate)})` : ''}`, o.id, cur.id, d.technician_id || null,
          start, end, 'Horário confirmado a partir do pedido do WhatsApp', req.user.id]);
      entry = e;
    }
    await addEvent(db, cur.id, req.user.id, { message: `Pedido do WhatsApp aprovado${entry ? ' e agendado' : ''}` });
    await audit(db, req, { entity: 'request', entityId: cur.id, action: 'approve', summary: `Pedido do WhatsApp nº ${cur.number} aprovado: OS nº ${o.number}${entry ? ' com horário na agenda' : ''}` });
    return { order: o, entry, conversationId: cur.conversation_id };
  });
  let notified = null;
  if (d.notify) {
    const tz = withDefaults(req.settings).timezone;
    const when = out.entry ? (() => { const z0 = utcToZoned(new Date(out.entry.starts_at), tz); return ` Esperamos você em *${z0.date.slice(8, 10)}/${z0.date.slice(5, 7)} às ${z0.time}*.`; })() : '';
    notified = await notify(req, out.conversationId, `Seu pedido foi confirmado! ✅ Abrimos a *OS nº ${out.order.number}*.${when}\nPara saber como está o serviço, é só mandar a placa por aqui.`);
  }
  res.status(201).json({ order_id: out.order.id, number: out.order.number, schedule_id: out.entry?.id || null, notified });
});

r.post('/requests/:id/reject', need('requests_manage'), async (req, res) => {
  const d = parse(z.object({ reason: s.min(3, 'informe o motivo').max(500), notify: z.boolean().default(true) }), req.body);
  const cur = await tx(async (db) => {
    const x = await lockWaRequest(db, req);
    await db.query("update service_requests set status = 'cancelada', lost_reason = $2, updated_at = now() where id = $1", [x.id, d.reason]);
    await addEvent(db, x.id, req.user.id, { from: x.status, to: 'cancelada', message: `Pedido do WhatsApp recusado: ${d.reason}` });
    await audit(db, req, { entity: 'request', entityId: x.id, action: 'reject', summary: `Pedido do WhatsApp nº ${x.number} recusado` });
    return x;
  });
  const notified = d.notify ? await notify(req, cur.conversation_id, `Sobre o seu pedido nº ${cur.number}: ${d.reason}\nSe quiser, responda por aqui que a equipe ajuda.`) : null;
  res.json({ ok: true, notified });
});

export default r;

// ================= webhook da Meta (sem login) =================
export const webhook = Router();
webhook.use(limitByIp('wa-webhook', 300, 60, 'Muitas chamadas.'));

webhook.get('/', async (req, res) => {
  const token = String(req.query['hub.verify_token'] || '');
  if (req.query['hub.mode'] !== 'subscribe' || token.length < 16 || token.length > 100) return res.sendStatus(403);
  if ((await hit(`wa-verify:ip:${req.ip}`, 30, 600)).blocked) return res.sendStatus(429);
  const { rows: [found] } = await q("select company_id from integration_configs where kind = 'whatsapp' and config->>'verify_token' = $1", [token]);
  if (!found) return res.sendStatus(403);
  res.type('text/plain').send(String(req.query['hub.challenge'] || '').replace(/[^\w-]/g, '').slice(0, 200));
});

/** Pode o agente responder? Empresa bloqueada pela assinatura ou módulo fora do plano: só guarda a mensagem. */
async function agentAllowed(companyId) {
  const access = await accessFor(companyId).catch(() => null);
  return !(access && (access.blocked || access.features?.whatsapp === false));
}

webhook.post('/', async (req, res) => {
  const entries = Array.isArray(req.body?.entry) ? req.body.entry : [];
  const phoneIds = [...new Set(entries.flatMap((e) => (Array.isArray(e?.changes) ? e.changes : []).map((c) => c?.value?.metadata?.phone_number_id))
    .filter((x) => typeof x === 'string' || typeof x === 'number').map(String))];
  if (!phoneIds.length || phoneIds.length > 5 || !req.rawBody) return res.sendStatus(400);
  const { rows: cfgs } = await q(
    "select company_id, config->>'phone_number_id' as pid from integration_configs where kind = 'whatsapp' and provider = 'meta' and enabled and config->>'phone_number_id' = any($1::text[])",
    [phoneIds]);
  const valid = [];
  for (const row of cfgs) {
    const wa = await loadIntegration(row.company_id, 'whatsapp', 'meta').catch(() => null);
    if (wa && validSignature(req.rawBody, req.get('x-hub-signature-256'), wa.secrets?.app_secret)) valid.push({ ...row, wa });
  }
  if (!valid.length) {
    // assinatura errada: conta à parte e bem mais curto (tentativas de abuso não gastam o banco)
    if ((await hit(`wa-badsig:ip:${req.ip}`, 30, 60)).blocked) return res.sendStatus(429);
    return res.sendStatus(401);
  }
  const msgs = inboundMessages(req.body);
  for (const v of valid) {
    const send = await senderFor(v.company_id, v.wa);
    const agentOff = !(await agentAllowed(v.company_id));
    for (const m of msgs.filter((x) => String(x.phoneNumberId) === v.pid).slice(0, 50)) {
      try { await handleInbound(v.company_id, m, send, { cfg: v.wa.config, agentOff }); } catch (e) { console.error('[whatsapp] webhook', e.message); }
    }
  }
  return res.sendStatus(200);
});
