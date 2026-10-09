// Leitura da nota fiscal do fornecedor para a entrada de materiais.
// XML da NF-e: lido aqui mesmo, campo a campo (sem IA, sem enviar nada para fora).
// PDF (DANFE) ou foto: só com a IA ligada pela empresa — o arquivo vai para a Anthropic e volta como rascunho para conferir.
// Nada é lançado automaticamente: o resultado só preenche a tela; a pessoa confere e clica em "Dar entrada".
import { AI_URL } from './ai.js';
import { HttpError } from '../util.js';

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s) => String(s ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e] ?? m))
  .trim();
const re = (name) => new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, 'g');
/** Primeiro <name> dentro do trecho. */
const tag = (xml, name) => { const m = re(name).exec(xml || ''); return m ? decode(m[1]) : null; };
const block = (xml, name) => { const m = re(name).exec(xml || ''); return m ? m[1] : ''; };
const blocks = (xml, name) => [...String(xml || '').matchAll(re(name))].map((m) => m[1]);
const num = (v) => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const digits = (s) => String(s || '').replace(/\D/g, '');

/** Chave de acesso de 44 dígitos com dígito verificador (módulo 11) correto. */
export function validKey(k) {
  const d = digits(k);
  if (d.length !== 44) return false;
  let sum = 0; let w = 2;
  for (let i = 42; i >= 0; i -= 1) { sum += Number(d[i]) * w; w = w === 9 ? 2 : w + 1; }
  const dv = sum % 11 < 2 ? 0 : 11 - (sum % 11);
  return dv === Number(d[43]);
}
const gtin = (s) => { const d = digits(s); return d.length >= 8 && d.length <= 14 && !/^0+$/.test(d) ? d : null; };

/**
 * XML da NF-e (ou nfeProc) → dados da nota no formato comum.
 * @returns {{ supplier, recipient_document, invoice_number, invoice_series, issue_date, invoice_key, items, totals, installments, authorized }}
 */
export function parseNfeXml(xml) {
  const src = String(xml || '');
  if (!/<(?:[\w-]+:)?infNFe[\s>]/.test(src)) {
    if (/<(?:[\w-]+:)?(?:CompNfse|Nfse|infNFSe)[\s>]/i.test(src)) throw new HttpError(400, 'Este XML é de nota de SERVIÇO (NFS-e). Para entrada de materiais use o XML da NF-e de produtos.');
    if (/<(?:[\w-]+:)?(?:procEventoNFe|infEvento)[\s>]/.test(src)) throw new HttpError(400, 'Este XML é de um evento (cancelamento ou carta de correção), não da nota. Peça ao fornecedor o XML da NF-e.');
    throw new HttpError(400, 'Este arquivo não parece ser o XML de uma NF-e. Abra o e-mail do fornecedor e escolha o anexo que termina em .xml.');
  }
  const inf = block(src, 'infNFe');
  const idKey = digits((src.match(/<(?:[\w-]+:)?infNFe[^>]*\bId="NFe(\d{44})"/) || [])[1]);
  const ide = block(inf, 'ide');
  const emit = block(inf, 'emit');
  const end = block(emit, 'enderEmit');
  const tot = block(block(inf, 'total'), 'ICMSTot');
  const items = blocks(inf, 'det').map((det) => {
    const p = block(det, 'prod');
    const imp = block(det, 'imposto');
    const qty = num(tag(p, 'qCom'));
    const total = num(tag(p, 'vProd'));
    return {
      code: tag(p, 'cProd'), description: tag(p, 'xProd'), ncm: digits(tag(p, 'NCM')) || null, cfop: digits(tag(p, 'CFOP')) || null,
      barcode: gtin(tag(p, 'cEAN')) || gtin(tag(p, 'cEANTrib')), unit: tag(p, 'uCom'), qty,
      unit_price: num(tag(p, 'vUnCom')) || (qty ? total / qty : 0), total,
      ipi: num(tag(block(imp, 'IPITrib'), 'vIPI')), st: num(tag(imp, 'vICMSST')),
    };
  });
  const dups = blocks(block(inf, 'cobr'), 'dup').map((d) => ({ number: tag(d, 'nDup'), due_date: (tag(d, 'dVenc') || '').slice(0, 10), amount: num(tag(d, 'vDup')) }));
  const prot = block(src, 'infProt');
  const addr = [tag(end, 'xLgr'), tag(end, 'nro'), tag(end, 'xCpl'), tag(end, 'xBairro'), [tag(end, 'xMun'), tag(end, 'UF')].filter(Boolean).join('/'),
    tag(end, 'CEP') && `CEP ${tag(end, 'CEP')}`].filter(Boolean).join(', ');
  return {
    supplier: { document: digits(tag(emit, 'CNPJ') || tag(emit, 'CPF')), name: tag(emit, 'xNome'), trade_name: tag(emit, 'xFant'), ie: tag(emit, 'IE'),
      phone: tag(end, 'fone'), address: addr || null },
    recipient_document: digits(tag(block(inf, 'dest'), 'CNPJ') || tag(block(inf, 'dest'), 'CPF')) || null,
    model: tag(ide, 'mod'),
    invoice_number: tag(ide, 'nNF'), invoice_series: tag(ide, 'serie'),
    issue_date: (tag(ide, 'dhEmi') || tag(ide, 'dEmi') || '').slice(0, 10) || null,
    invoice_key: idKey || digits(tag(prot, 'chNFe')) || null,
    is_entry_note: tag(ide, 'tpNF') === '0',
    authorized: prot ? ['100', '150'].includes(tag(prot, 'cStat')) : null,
    items,
    totals: {
      products: num(tag(tot, 'vProd')), freight: num(tag(tot, 'vFrete')), insurance: num(tag(tot, 'vSeg')), discount: num(tag(tot, 'vDesc')),
      ipi: num(tag(tot, 'vIPI')), st: num(tag(tot, 'vST')) + num(tag(tot, 'vFCPST')), other: num(tag(tot, 'vOutro')),
      icms_relief: num(tag(tot, 'vICMSDeson')), invoice_total: num(tag(tot, 'vNF')),
    },
    installments: dups.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.due_date) && d.amount > 0),
  };
}

const AI_PROMPT = `Você vai ler uma nota fiscal de compra de mercadorias (DANFE de NF-e, cupom ou nota de fornecedor) de uma oficina.
Copie EXATAMENTE o que está impresso. Se não conseguir ler um campo com segurança, use null. Nunca invente valores, itens ou datas.
Responda SOMENTE um JSON, sem texto fora dele, neste formato:
{"legible": true|false,
 "supplier": {"document": "CNPJ ou CPF do EMITENTE, só números", "name": "razão social do emitente", "ie": "inscrição estadual ou null", "phone": null, "address": "endereço do emitente ou null"},
 "recipient_document": "CNPJ/CPF do DESTINATÁRIO, só números, ou null",
 "invoice_number": "número da nota sem zeros à esquerda", "invoice_series": "série", "issue_date": "AAAA-MM-DD",
 "invoice_key": "chave de acesso de 44 dígitos, só números, ou null",
 "items": [{"code": "código do produto no fornecedor", "description": "descrição", "ncm": "8 dígitos ou null", "cfop": "4 dígitos ou null", "barcode": null,
            "unit": "unidade comercial (UN, PC, JG, L, KG...)", "qty": 0, "unit_price": 0, "total": 0}],
 "totals": {"products": 0, "freight": 0, "insurance": 0, "discount": 0, "ipi": 0, "st": 0, "other": 0, "invoice_total": 0},
 "installments": [{"number": "001", "due_date": "AAAA-MM-DD", "amount": 0}],
 "notes": "o que não deu para ler, ou null"}
Números no JSON com ponto decimal (1234.56), sem separador de milhar. "items" na ordem da nota, um por linha de produto (inclua todas as páginas).
"installments" são as duplicatas/faturas (vencimentos) impressas; se não houver, use [].
Se a imagem não for uma nota fiscal ou estiver ilegível, responda {"legible": false, "notes": "motivo"}.`;

/**
 * Lê PDF ou foto com a IA da empresa. Devolve os dados no formato comum (ou lança erro com mensagem para a pessoa).
 * @param {{ api_key: string }} secrets
 * @param {{ mime: string, data: string }} file  data em base64
 */
export async function readWithAi(secrets, file, { model = 'claude-sonnet-4-5', timeoutMs = 120000 } = {}) {
  const isPdf = file.mime === 'application/pdf';
  const media = isPdf ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: file.data } }
    : { type: 'image', source: { type: 'base64', media_type: file.mime, data: file.data } };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let r;
  try {
    r = await fetch(AI_URL, {
      method: 'POST',
      headers: { 'x-api-key': secrets.api_key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 16000, messages: [{ role: 'user', content: [media, { type: 'text', text: AI_PROMPT }] }] }),
      signal: ctl.signal,
    });
  } catch {
    throw new HttpError(502, 'A IA demorou demais ou não respondeu. Tente de novo ou use o arquivo XML da nota.');
  } finally { clearTimeout(timer); }
  if (r.status === 401 || r.status === 403) throw new HttpError(400, 'A chave da IA foi recusada pela Anthropic. Confira a chave em Configurações › Integrações › IA.');
  if (r.status === 429) throw new HttpError(429, 'Limite de uso da IA atingido no momento. Aguarde alguns minutos ou use o XML da nota.');
  if (!r.ok) throw new HttpError(502, 'A IA não conseguiu ler o arquivo agora. Tente de novo ou use o XML da nota.');
  const j = await r.json().catch(() => ({}));
  const raw = (j.content || []).map((c) => c.text || '').join('');
  const m = raw.match(/\{[\s\S]*\}/);
  let x;
  try { x = JSON.parse(m?.[0] || ''); } catch { x = null; }
  if (!x || x.legible === false || !Array.isArray(x.items)) {
    throw new HttpError(422, `Não foi possível ler esta nota${x?.notes ? `: ${String(x.notes).slice(0, 200)}` : ''}. Tire outra foto, de frente, com boa luz e a nota inteira aparecendo — ou use o XML.`);
  }
  const str = (v, n = 200) => (v == null || v === '' ? null : String(v).trim().slice(0, n));
  const date = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
  const t = x.totals || {};
  return {
    supplier: { document: digits(x.supplier?.document) || null, name: str(x.supplier?.name, 160), ie: str(x.supplier?.ie, 30), phone: str(x.supplier?.phone, 30), address: str(x.supplier?.address, 300) },
    recipient_document: digits(x.recipient_document) || null,
    invoice_number: str(x.invoice_number, 20)?.replace(/^0+(?=\d)/, '') || null, invoice_series: str(x.invoice_series, 5),
    issue_date: date(x.issue_date), invoice_key: digits(x.invoice_key).length === 44 ? digits(x.invoice_key) : null,
    authorized: null,
    items: x.items.slice(0, 300).map((i) => ({
      code: str(i.code, 60), description: str(i.description, 200) || 'Item sem descrição', ncm: digits(i.ncm).length === 8 ? digits(i.ncm) : null,
      cfop: digits(i.cfop).length === 4 ? digits(i.cfop) : null, barcode: gtin(i.barcode), unit: str(i.unit, 10),
      qty: Math.max(0, num(i.qty)), unit_price: Math.max(0, num(i.unit_price)), total: Math.max(0, num(i.total)), ipi: 0, st: 0,
    })),
    totals: { products: num(t.products), freight: num(t.freight), insurance: num(t.insurance), discount: num(t.discount), ipi: num(t.ipi), st: num(t.st), other: num(t.other), icms_relief: 0, invoice_total: num(t.invoice_total) },
    installments: (Array.isArray(x.installments) ? x.installments : []).map((d) => ({ number: str(d.number, 10), due_date: date(d.due_date), amount: num(d.amount) }))
      .filter((d) => d.due_date && d.amount > 0),
  };
}

/** Confere as contas da nota e monta os avisos para a pessoa (valores que não batem, chave inválida etc.). */
export function checkInvoice(n, { source }) {
  const warnings = [];
  const ai = source !== 'xml';
  for (const [k, i] of n.items.entries()) {
    if (!i.qty) warnings.push(`Item ${k + 1} (${i.description}): quantidade não lida — preencha.`);
    else if (!i.unit_price && i.total) i.unit_price = i.total / i.qty;
    if (i.qty && i.unit_price && i.total && Math.abs(i.qty * i.unit_price - i.total) > Math.max(0.05, i.total * 0.005)) {
      warnings.push(`Item ${k + 1} (${i.description}): quantidade × valor unitário (${r2(i.qty * i.unit_price)}) não bate com o total do item (${r2(i.total)}).`);
    }
  }
  const sumItems = r2(n.items.reduce((a, i) => a + (i.total || i.qty * i.unit_price), 0));
  const t = n.totals;
  if (t.products && Math.abs(sumItems - t.products) > 0.05) warnings.push(`A soma dos itens (R$ ${sumItems.toFixed(2)}) é diferente do total de produtos da nota (R$ ${t.products.toFixed(2)})${ai ? ' — pode faltar algum item.' : '.'}`);
  if (n.invoice_key && !validKey(n.invoice_key)) { warnings.push('A chave de acesso lida não é válida (dígito verificador). Confira os 44 números.'); }
  if (ai && !n.invoice_key) warnings.push('A chave de acesso não foi lida. Se quiser, digite os 44 números que ficam embaixo do código de barras.');
  if (n.authorized === false) warnings.push('Este XML não traz a autorização da SEFAZ (nota pode estar rejeitada ou cancelada). Confira com o fornecedor.');
  // despesas: o que a nota cobra além dos produtos, para o total da entrada bater com o total da nota
  const base = r2((t.products || sumItems) + t.freight - t.discount);
  let other = r2(t.ipi + t.st + t.insurance + t.other - (t.icms_relief || 0));
  let discount = r2(t.discount);
  if (t.invoice_total) {
    const diff = r2(t.invoice_total - base);
    if (diff >= 0) other = diff; else { other = 0; discount = r2(discount - diff); }
  }
  const total = r2((t.products || sumItems) + t.freight + other - discount);
  if (n.installments.length) {
    const s = r2(n.installments.reduce((a, d) => a + d.amount, 0));
    if (Math.abs(s - total) > 0.05) warnings.push(`As duplicatas somam R$ ${s.toFixed(2)}, mas o total da nota é R$ ${total.toFixed(2)}. Confira o pagamento.`);
  }
  return { warnings, freight: r2(t.freight), other, discount, total, sum_items: sumItems,
    other_detail: [['IPI', t.ipi], ['ST', t.st], ['seguro', t.insurance], ['outras', t.other]].filter(([, v]) => v > 0).map(([l, v]) => `${l} R$ ${v.toFixed(2).replace('.', ',')}`).join(' · ') };
}
