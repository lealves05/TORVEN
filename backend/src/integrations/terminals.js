// Maquininhas de cartão: um adaptador por provedor, mesma interface.
//   create(ctx, charge) → { external_id, status, link_url?, raw }      (envia o valor à maquininha / gera o link)
//   status(ctx, charge) → { status, paid_amount?, nsu?, card_brand?, method?, raw }   (consulta autoritativa no provedor)
//   cancel(ctx, charge) → { status, raw }
// ctx = { config, secrets, terminal, appUrl, webhookUrl }. Valores em reais (numeric) dentro do TORVEN.
// Status internos: pendente → enviada → paga | recusada | cancelada | expirada | erro.
// Nenhum pagamento é lançado sem consultar o provedor (webhooks só disparam a consulta).
import crypto from 'node:crypto';
import { HttpError } from '../util.js';

const cents = (v) => Math.round(Number(v) * 100);
const money = (v) => Number(v).toFixed(2);

async function http(provider, url, { method = 'GET', headers = {}, body, timeoutMs = 15000 } = {}) {
  let res;
  try {
    res = await fetch(url, { method, headers: { accept: 'application/json', ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new HttpError(503, `${provider} não respondeu. Tente de novo ou receba de outra forma.`);
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 300) }; }
  if (!res.ok) {
    const msg = data?.message || data?.error || data?.errors?.[0]?.message || data?.errors?.[0]?.details || data?.cause?.[0]?.description || `erro ${res.status}`;
    throw new HttpError(res.status === 401 || res.status === 403 ? 400 : 502, `${provider} recusou: ${String(msg).slice(0, 180)}`, { provider_status: res.status });
  }
  return data;
}

// ---------------------------------------------------------------------------------------------
// Mercado Pago Point — API de Orders (POST /v1/orders, type "point"). Docs: mercadopago.com.br/developers (Point).
// ---------------------------------------------------------------------------------------------
// endereço base substituível só para testes/sandbox local (MERCADOPAGO_API_URL)
const MPB = () => (process.env.MERCADOPAGO_API_URL || 'https://api.mercadopago.com').replace(/\/+$/, '');
const mpHeaders = (ctx, idem) => ({ authorization: `Bearer ${ctx.secrets.access_token}`, ...(idem ? { 'x-idempotency-key': idem } : {}) });
function mpStatus(o) {
  const st = String(o?.status || '').toLowerCase();
  const det = String(o?.status_detail || '').toLowerCase();
  const pay = o?.transactions?.payments?.[0] || {};
  if (st === 'processed' || det === 'accredited' || String(pay.status).toLowerCase() === 'processed') return 'paga';
  if (['canceled', 'cancelled'].includes(st)) return 'cancelada';
  if (st === 'expired') return 'expirada';
  if (['failed', 'rejected'].includes(st) || ['failed', 'rejected'].includes(String(pay.status).toLowerCase())) return 'recusada';
  if (['refunded', 'charged_back'].includes(st)) return 'cancelada';
  return 'enviada';
}
const mercadopago = {
  name: 'Mercado Pago Point',
  mode: 'push',
  ready: true,
  help: 'Maquininha Point ligada no "modo integrado" (PDV). Access Token de produção em mercadopago.com.br › Suas integrações › Credenciais. O ID do terminal aparece em "Listar maquininhas".',
  fields: [{ key: 'print_on_terminal', label: 'Imprimir comprovante na maquininha', type: 'select', options: ['no_ticket', 'ticket'], default: 'no_ticket' },
    { key: 'installments_cost', label: 'Juros do parcelado', type: 'select', options: ['seller', 'buyer'], default: 'seller' }],
  secrets: [{ key: 'access_token', label: 'Access Token' }],
  terminalLabel: 'ID do terminal (ex.: NEWLAND_N950__N950NCB123456789)',
  methods: ['credito', 'debito'],
  async create(ctx, c) {
    if (!ctx.secrets.access_token) throw new HttpError(400, 'Access Token do Mercado Pago não cadastrado.');
    if (!ctx.terminal?.external_id) throw new HttpError(400, 'Informe o ID do terminal Point desta maquininha.');
    const body = {
      type: 'point', external_reference: c.external_reference, expiration_time: 'PT15M',
      description: c.description.slice(0, 150),
      transactions: { payments: [{ amount: money(c.amount) }] },
      config: {
        point: { terminal_id: ctx.terminal.external_id, print_on_terminal: ctx.config.print_on_terminal || 'no_ticket' },
        payment_method: c.method === 'credito'
          ? { default_type: 'credit_card', default_installments: c.installments, ...(c.installments > 1 ? { installments_cost: ctx.config.installments_cost || 'seller' } : {}) }
          : { default_type: 'debit_card' },
      },
    };
    const o = await http('Mercado Pago', `${MPB()}/v1/orders`, { method: 'POST', headers: mpHeaders(ctx, c.external_reference), body });
    return { external_id: String(o.id), status: 'enviada', raw: o };
  },
  async status(ctx, c) {
    const o = await http('Mercado Pago', `${MPB()}/v1/orders/${encodeURIComponent(c.external_id)}`, { headers: mpHeaders(ctx) });
    const pay = o?.transactions?.payments?.[0] || {};
    return { status: mpStatus(o), paid_amount: pay.paid_amount != null ? Number(pay.paid_amount) : (mpStatus(o) === 'paga' ? Number(pay.amount) : null),
      nsu: pay.reference_id || pay.id || null, card_brand: pay.payment_method?.id || null, raw: o };
  },
  async cancel(ctx, c) {
    const o = await http('Mercado Pago', `${MPB()}/v1/orders/${encodeURIComponent(c.external_id)}/cancel`, { method: 'POST', headers: mpHeaders(ctx, `${c.external_reference}-cancel`) });
    return { status: mpStatus(o), raw: o };
  },
  async listDevices(ctx) {
    const d = await http('Mercado Pago', `${MPB()}/terminals/v1/list?limit=50`, { headers: mpHeaders(ctx) });
    const list = d?.data?.terminals || d?.terminals || [];
    return list.map((t) => ({ external_id: t.id, name: t.id, mode: t.operating_mode || null }));
  },
};

// ---------------------------------------------------------------------------------------------
// Stone Connect 2.0 (Pagar.me core v5) — pedido com poi_payment_settings enviado ao número de série da POS.
// Requer credenciamento na Stone (ServiceRefererName e chave secreta da conta Pagar.me).
// ---------------------------------------------------------------------------------------------
const PAGARME = 'https://api.pagar.me/core/v5';
const stoneHeaders = (ctx) => ({
  authorization: `Basic ${Buffer.from(`${ctx.secrets.secret_key}:`).toString('base64')}`,
  ServiceRefererName: ctx.secrets.service_referer || ctx.config.service_referer || '',
});
function stoneStatus(o) {
  const st = String(o?.status || '').toLowerCase();
  if (st === 'paid') return 'paga';
  if (st === 'canceled') return 'cancelada';
  if (st === 'failed') return 'recusada';
  return 'enviada';
}
const stone = {
  name: 'Stone (Stone Connect)',
  mode: 'push',
  ready: true,
  homologation: true,
  help: 'Exige credenciamento no Stone Connect 2.0: chave secreta (sk_) da conta Pagar.me e o ServiceRefererName fornecido pela Stone. A maquininha precisa estar no modo Connect.',
  fields: [{ key: 'installment_type', label: 'Juros do parcelado', type: 'select', options: ['merchant', 'issuer'], default: 'merchant' }],
  secrets: [{ key: 'secret_key', label: 'Chave secreta (sk_...)' }, { key: 'service_referer', label: 'ServiceRefererName' }],
  terminalLabel: 'Número de série da maquininha',
  methods: ['credito', 'debito', 'pix'],
  async create(ctx, c) {
    if (!ctx.secrets.secret_key || !ctx.secrets.service_referer) throw new HttpError(400, 'Chave secreta e ServiceRefererName da Stone não cadastrados.');
    if (!ctx.terminal?.external_id) throw new HttpError(400, 'Informe o número de série da maquininha Stone.');
    const type = c.method === 'credito' ? 'Credit' : c.method === 'debito' ? 'Debit' : 'Pix';
    const body = {
      closed: false, code: c.external_reference,
      customer: { name: c.customer_name || 'Cliente', type: 'individual' },
      items: [{ amount: cents(c.amount), description: c.description.slice(0, 120), quantity: 1, code: c.external_reference }],
      poi_payment_settings: {
        visible: true, devices_serial_number: [ctx.terminal.external_id],
        payment_setup: { type, installments: c.method === 'credito' ? c.installments : 1, installment_type: ctx.config.installment_type || 'merchant' },
        display_name: c.description.slice(0, 40),
      },
    };
    const o = await http('Stone', `${PAGARME}/orders/`, { method: 'POST', headers: stoneHeaders(ctx), body });
    return { external_id: String(o.id), status: 'enviada', raw: o };
  },
  async status(ctx, c) {
    const o = await http('Stone', `${PAGARME}/orders/${encodeURIComponent(c.external_id)}`, { headers: stoneHeaders(ctx) });
    const charge = (o.charges || []).find((x) => x.status === 'paid') || o.charges?.[0] || {};
    return { status: stoneStatus(o), paid_amount: charge.paid_amount != null ? charge.paid_amount / 100 : null,
      nsu: charge.last_transaction?.acquirer_nsu || charge.id || null, card_brand: charge.last_transaction?.card?.brand || null, raw: o };
  },
  async cancel(ctx, c) {
    const o = await http('Stone', `${PAGARME}/orders/${encodeURIComponent(c.external_id)}/closed`, { method: 'PATCH', headers: stoneHeaders(ctx), body: { status: 'canceled' } });
    return { status: stoneStatus(o), raw: o };
  },
};

// ---------------------------------------------------------------------------------------------
// Cielo LIO — integração remota (Order Manager): cria o pedido, adiciona o item e libera (PLACE) para a LIO.
// ---------------------------------------------------------------------------------------------
const lioBase = (ctx) => (ctx.config.environment === 'producao'
  ? 'https://api.cielo.com.br/order-management/v1' : 'https://api.cielo.com.br/sandbox-lio/order-management/v1');
const lioHeaders = (ctx) => ({ 'client-id': ctx.secrets.client_id, 'access-token': ctx.secrets.access_token, 'merchant-id': ctx.secrets.merchant_id });
function lioStatus(o) {
  const st = String(o?.status || '').toUpperCase();
  if (['PAID', 'APPROVED'].includes(st)) return 'paga';
  if (st === 'CANCELED') return 'cancelada';
  if (st === 'REJECTED') return 'recusada';
  return 'enviada';
}
const cielo = {
  name: 'Cielo LIO',
  mode: 'push',
  ready: true,
  homologation: true,
  help: 'Integração remota da Cielo LIO: client-id, access-token e merchant-id do portal de desenvolvedores Cielo. O pedido aparece na LIO para o operador cobrar.',
  fields: [{ key: 'environment', label: 'Ambiente', type: 'select', options: ['sandbox', 'producao'], default: 'sandbox' }],
  secrets: [{ key: 'client_id', label: 'Client-Id' }, { key: 'access_token', label: 'Access-Token' }, { key: 'merchant_id', label: 'Merchant-Id' }],
  terminalLabel: 'Identificação da LIO (opcional)',
  methods: ['credito', 'debito', 'pix'],
  async create(ctx, c) {
    if (!ctx.secrets.client_id || !ctx.secrets.access_token || !ctx.secrets.merchant_id) throw new HttpError(400, 'Credenciais da Cielo LIO incompletas.');
    const base = lioBase(ctx);
    const o = await http('Cielo', `${base}/orders`, { method: 'POST', headers: lioHeaders(ctx),
      body: { number: c.external_reference, reference: c.description.slice(0, 60), status: 'DRAFT', price: cents(c.amount),
        items: [{ sku: 'OS', name: c.description.slice(0, 60), unit_price: cents(c.amount), quantity: 1, unit_of_measure: 'UNIDADE' }] } });
    const id = o?.id || o?.order_id;
    if (!id) throw new HttpError(502, 'A Cielo não devolveu o número do pedido.');
    await http('Cielo', `${base}/orders/${encodeURIComponent(id)}?operation=PLACE`, { method: 'PUT', headers: lioHeaders(ctx) });
    return { external_id: String(id), status: 'enviada', raw: o };
  },
  async status(ctx, c) {
    const o = await http('Cielo', `${lioBase(ctx)}/orders/${encodeURIComponent(c.external_id)}`, { headers: lioHeaders(ctx) });
    const t = (o.transactions || [])[0] || {};
    return { status: lioStatus(o), paid_amount: o.paid_amount != null ? o.paid_amount / 100 : (lioStatus(o) === 'paga' ? Number(c.amount) : null),
      nsu: t.external_id || t.id || null, card_brand: t.card?.brand || null, raw: o };
  },
  async cancel(ctx, c) {
    await http('Cielo', `${lioBase(ctx)}/orders/${encodeURIComponent(c.external_id)}?operation=CANCEL`, { method: 'PUT', headers: lioHeaders(ctx) });
    return { status: 'cancelada', raw: null };
  },
};

// ---------------------------------------------------------------------------------------------
// InfinitePay — não há API pública para enviar o valor à maquininha física. A cobrança vai por link/QR do Checkout
// (Pix ou cartão no celular do cliente) e é conferida na InfinitePay (payment_check) antes de lançar.
// ---------------------------------------------------------------------------------------------
const IP = () => (process.env.INFINITEPAY_API_URL || 'https://api.checkout.infinitepay.io').replace(/\/+$/, '');
const infinitepay = {
  name: 'InfinitePay (link / QR)',
  mode: 'link',
  ready: true,
  help: 'A InfinitePay não oferece API para enviar o valor à maquininha física: o TORVEN gera um link/QR do Checkout (Pix ou cartão em até 12x) com o valor da OS. Informe sua InfiniteTag (sem o $).',
  fields: [{ key: 'handle', label: 'InfiniteTag (sem o $)', required: true, placeholder: 'minhaempresa' }],
  secrets: [],
  terminalLabel: 'Descrição (ex.: Link no balcão)',
  methods: ['credito', 'pix'],
  async create(ctx, c) {
    const handle = String(ctx.config.handle || '').trim().replace(/^\$/, '').toLowerCase();
    if (!handle) throw new HttpError(400, 'Informe a InfiniteTag em Configurações › Integrações › InfinitePay.');
    const body = { handle, items: [{ quantity: 1, price: cents(c.amount), description: c.description.slice(0, 120) }], order_nsu: c.external_reference };
    if (ctx.webhookUrl) body.webhook_url = ctx.webhookUrl;
    if (ctx.redirectUrl) body.redirect_url = ctx.redirectUrl;
    const raw = await http('InfinitePay', `${IP()}/links`, { method: 'POST', body });
    const url = raw?.url || raw?.link || raw?.checkout_url || raw?.data?.url;
    if (!url || !/^https:\/\//.test(url)) throw new HttpError(502, 'A InfinitePay não devolveu o link de pagamento.');
    return { external_id: null, status: 'enviada', link_url: url, raw };
  },
  async status(ctx, c) {
    const tnsu = c.raw?.transaction_nsu || c.nsu; const slug = c.raw?.invoice_slug || c.raw?.slug;
    if (!tnsu || !slug) return { status: c.status, raw: c.raw }; // ainda sem retorno do pagamento (webhook/redirecionamento)
    const handle = String(ctx.config.handle || '').trim().replace(/^\$/, '').toLowerCase();
    const chk = await http('InfinitePay', `${IP()}/payment_check`, { method: 'POST', body: { handle, order_nsu: c.external_reference, transaction_nsu: tnsu, slug } });
    if (!chk?.success || !chk?.paid) return { status: 'enviada', raw: { ...c.raw, check: chk } };
    return { status: 'paga', paid_amount: chk.amount != null ? Number(chk.amount) / 100 : null, nsu: tnsu,
      method: chk.capture_method === 'pix' ? 'pix' : 'credito', raw: { ...c.raw, check: chk } };
  },
  async cancel() { return { status: 'cancelada', raw: null }; }, // link expira sozinho; a cobrança é encerrada aqui
};

// ---------------------------------------------------------------------------------------------
// Preparados (estrutura e configuração prontas; envio ativado quando houver contrato e documentação do provedor).
// ---------------------------------------------------------------------------------------------
const prepared = (name, help, secrets, terminalLabel) => ({
  name, mode: 'push', ready: false, help, fields: [], secrets, terminalLabel, methods: ['credito', 'debito', 'pix'],
  async create() { throw new HttpError(501, `${name}: integração preparada, aguardando credenciamento/homologação com o provedor. Receba pela maquininha e lance o pagamento manualmente.`); },
  async status(_ctx, c) { return { status: c.status, raw: c.raw }; },
  async cancel() { return { status: 'cancelada', raw: null }; },
});
const pagbank = prepared('PagBank', 'Estrutura pronta. A ativação depende do credenciamento como parceiro PagBank para envio de cobranças à maquininha (Smart).',
  [{ key: 'token', label: 'Token PagBank' }], 'Número de série da maquininha');
const getnet = prepared('Getnet', 'Estrutura pronta. A ativação depende do contrato de integração Getnet (POS Digital) e das credenciais fornecidas pela Getnet.',
  [{ key: 'client_id', label: 'Client ID' }, { key: 'client_secret', label: 'Client Secret' }], 'Número lógico / série do terminal');

export const TERMINAL_PROVIDERS = { mercadopago, stone, cielo, infinitepay, pagbank, getnet };

export const newReference = () => `TV${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`.toUpperCase();

/** Descrição pública do provedor para a tela (sem funções). */
export const describeProvider = (id) => {
  const p = TERMINAL_PROVIDERS[id];
  return { id, name: p.name, mode: p.mode, ready: p.ready, homologation: !!p.homologation, help: p.help, fields: p.fields,
    secrets: p.secrets, terminalLabel: p.terminalLabel, methods: p.methods, can_list_devices: typeof p.listDevices === 'function' };
};
