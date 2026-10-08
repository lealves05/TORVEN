// WhatsApp pela API oficial da Meta (WhatsApp Cloud API): envio de texto e conferência da assinatura do webhook.
// O token de acesso e o "App Secret" ficam cifrados em integration_configs (kind 'whatsapp', provider 'meta').
import crypto from 'node:crypto';
import { HttpError } from '../util.js';

export const GRAPH = process.env.WHATSAPP_GRAPH_URL || 'https://graph.facebook.com/v21.0';

export const WA_FIELDS = [
  { key: 'phone_number_id', label: 'Identificação do número de telefone (Phone number ID)', required: true },
  { key: 'waba_id', label: 'Identificação da conta do WhatsApp Business (WABA ID)' },
  { key: 'display_phone', label: 'Número do WhatsApp da empresa (só para mostrar)' },
];
export const WA_SECRETS = [
  { key: 'access_token', label: 'Token de acesso permanente (usuário do sistema)' },
  { key: 'app_secret', label: 'Chave secreta do app (App Secret)' },
];

/** Só dígitos; números brasileiros sem DDI ganham 55. */
export function normalizePhone(v) {
  let d = String(v || '').replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  return d;
}

/** Forma canônica para comparar: Brasil = 55 + DDD + últimos 8 dígitos (o 9º dígito do celular é opcional nos cadastros antigos). */
function canonical(v) {
  const d = normalizePhone(v);
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) {
    if (d.length === 13 && d[4] !== '9') return null; // 13 dígitos só com o 9 do celular
    return `55${d.slice(2, 4)}${d.slice(-8)}`;
  }
  return d.length >= 8 ? d : null;
}

/** Mesmo telefone? Igualdade exata (DDI + DDD + número), tolerando só o 9º dígito de celulares do Brasil. */
export function samePhone(a, b) {
  const x = canonical(a);
  const y = canonical(b);
  return !!x && x === y;
}

/** X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(corpo bruto, App Secret). */
export function validSignature(rawBody, header, appSecret) {
  if (!rawBody || !header || !appSecret) return false;
  const expected = `sha256=${crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(String(header));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Mensagens de texto (e respostas de botão/lista) recebidas num POST do webhook. */
export function inboundMessages(body) {
  const out = [];
  for (const entry of body?.entry || []) {
    for (const ch of entry.changes || []) {
      const v = ch.value || {};
      const phoneNumberId = v.metadata?.phone_number_id;
      const names = Object.fromEntries((v.contacts || []).map((c) => [c.wa_id, c.profile?.name]));
      for (const m of v.messages || []) {
        let text = null;
        if (m.type === 'text') text = m.text?.body;
        else if (m.type === 'button') text = m.button?.text;
        else if (m.type === 'interactive') text = m.interactive?.button_reply?.title || m.interactive?.list_reply?.title;
        else text = `[${m.type === 'image' ? 'foto' : m.type === 'audio' ? 'áudio' : m.type} recebido]`;
        out.push({ phoneNumberId, from: m.from, name: names[m.from] || null, id: m.id, text: String(text || '').slice(0, 4000), type: m.type });
      }
    }
  }
  return out;
}

/** Envia texto. Devolve o id da mensagem na Meta. */
export async function sendText(cfg, secrets, to, body) {
  if (!cfg?.phone_number_id || !secrets?.access_token) throw new HttpError(400, 'WhatsApp não configurado (falta o número ou o token).');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10000);
  try {
    const r = await fetch(`${GRAPH}/${encodeURIComponent(cfg.phone_number_id)}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secrets.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { preview_url: false, body: body.slice(0, 4096) } }),
      signal: ctl.signal,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = j?.error?.message || `HTTP ${r.status}`;
      throw new HttpError(502, `A Meta recusou o envio: ${msg.slice(0, 200)}`);
    }
    return j?.messages?.[0]?.id || null;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(502, e.name === 'AbortError' ? 'A Meta não respondeu a tempo.' : 'Falha de conexão com a Meta.');
  } finally { clearTimeout(timer); }
}
