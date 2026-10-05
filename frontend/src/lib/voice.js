// Comandos de voz das ordens de serviço: transforma a frase reconhecida em uma ação para o usuário confirmar.
// Nada é gravado só pela fala — a tela mostra o que entendeu e pede confirmação.
import { plateFromSpeech } from './plate.js';

const norm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

const UNITS = { zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
  onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19 };
const TENS = { vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90 };
const HUNDREDS = { cem: 100, cento: 100, duzentos: 200, trezentos: 300, quatrocentos: 400, quinhentos: 500, seiscentos: 600,
  setecentos: 700, oitocentos: 800, novecentos: 900 };

/** "cento e vinte e três" → 123; "meia" (hora) → 0,5 tratado à parte. Devolve null se não for número. */
export function wordsToNumber(text) {
  const t = norm(text).replace(',', '.');
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  let total = 0; let any = false;
  for (const w of t.split(' ')) {
    if (w === 'e') continue;
    if (w === 'mil') { total = (total || 1) * 1000; any = true; continue; }
    const v = UNITS[w] ?? TENS[w] ?? HUNDREDS[w];
    if (v === undefined) return null;
    total += v; any = true;
  }
  return any ? total : null;
}

/**
 * Converte números por extenso ("os cento e dois" → "os 102") mantendo duas versões alinhadas palavra a palavra:
 * a normalizada (sem acentos, para as regras) e a original (com acentos, para nomes e textos devolvidos).
 */
function digitize(raw) {
  const rawWords = String(raw).replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const normWords = rawWords.map((w) => norm(w));
  const isNum = (x) => x in UNITS || x in TENS || x in HUNDREDS || x === 'mil';
  const outN = []; const outR = [];
  for (let i = 0; i < normWords.length; i += 1) {
    const w = normWords[i].replace(/[,.;:]+$/, '');
    if (isNum(w) && !(w === 'um' && /^(a|o)$/.test(outN[outN.length - 1] || ''))) {
      const seq = [w]; let j = i;
      while (j + 2 < normWords.length && normWords[j + 1] === 'e' && isNum(normWords[j + 2].replace(/[,.;:]+$/, ''))) { seq.push('e', normWords[j + 2].replace(/[,.;:]+$/, '')); j += 2; }
      const n = wordsToNumber(seq.join(' '));
      const tail = normWords[j].match(/[,.;:]+$/)?.[0] || '';
      if (n != null && !(seq.length === 1 && (w === 'e' || w === 'um' || w === 'uma'))) { outN.push(String(n) + tail); outR.push(String(n) + tail); i = j; continue; }
    }
    outN.push(normWords[i]); outR.push(rawWords[i]);
  }
  return { t: outN.join(' '), r: outR.join(' ') };
}

const OS_NUM = /\b(?:os|o\.s\.?|ordem(?: de servico)?|servico)\s*(?:numero|n|no|nº)?\s*(\d{1,7})\b/;
const STATUS_WORDS = [
  [/em execucao|executando|em andamento/, 'em_execucao'], [/pronta|pronto|finalizada|concluida/, 'pronta'],
  [/diagnostico/, 'diagnostico'], [/aguardando aprovacao/, 'aguardando_aprovacao'], [/aguardando (o )?material|aguardando peca/, 'aguardando_material'],
  [/aprovada|aprovado/, 'aprovada'], [/recebida|aberta/, 'aberta'],
];
const STATUS_LABEL = { aberta: 'Recebida', diagnostico: 'Em diagnóstico', aguardando_aprovacao: 'Aguardando aprovação', aprovada: 'Aprovada',
  aguardando_material: 'Aguardando material', em_execucao: 'Em execução', pronta: 'Pronta' };

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
/** Trecho da frase original (com acentos) correspondente às palavras [start, end) do texto normalizado. */
function original(rawAligned, normText, start, end) {
  const rawWords = rawAligned.split(' ');
  const before = normText.slice(0, start).split(' ').filter(Boolean).length - (start > 0 && normText[start - 1] !== ' ' ? 1 : 0);
  const len = normText.slice(start, end).trim().split(' ').filter(Boolean).length;
  return rawWords.slice(before, before + len).join(' ').replace(/^[,.;:]+|[,.;:]+$/g, '');
}

/**
 * @returns {{intent: string, order_number?: number, customer?: string, plate?: string, problem?: string, priority?: string,
 *   minutes?: number, activity?: string, note?: string, status?: string, summary: string} | {intent: 'desconhecido', summary: string}}
 */
export function parseCommand(text) {
  const { t, r: raw } = digitize(String(text || '').trim());
  const num = t.match(OS_NUM)?.[1];
  const orderNumber = num ? Number(num) : undefined;

  // ---- parar apontamento ----
  if (/\b(par(ar|e|a)|encerr(ar|e|a)|finaliz(ar|e|a)|paus(ar|e|a)|termin(ar|e|a))\b.*\b(apontamento|cronometro|relogio|trabalho|servico)\b/.test(t)) {
    return { intent: 'parar_apontamento', order_number: orderNumber,
      summary: `Encerrar o apontamento em andamento${orderNumber ? ` da OS ${orderNumber}` : ''}` };
  }
  // ---- iniciar apontamento ----
  if (/\b(inici(ar|e|a)|comec(ar|e|a)|abr(ir|a|e)|ligar|ligue)\b.*\b(apontamento|cronometro|relogio)\b/.test(t)
    || /\b(inici(ar|e|a)|comec(ar|e|a))\b.*\b(trabalho|servico|execucao)\b.*\b(os|ordem)\b/.test(t)) {
    const act = t.match(/\b(?:atividade|fazendo|para|de)\s+(.+)$/);
    const activity = act && !OS_NUM.test(act[0]) ? cap(original(raw, t, act.index + act[0].indexOf(act[1]), t.length)) : undefined;
    return { intent: 'iniciar_apontamento', order_number: orderNumber, activity,
      summary: `Iniciar o cronômetro${orderNumber ? ` na OS ${orderNumber}` : ''}${activity ? ` (${activity})` : ''}` };
  }
  // ---- apontar horas (lançamento manual) ----
  const hm = t.match(/\bapont(?:ar|e|a)\s+(\d+(?:[.,]\d+)?|meia)\s*(horas?|h|minutos?|min)(?:\s+e\s+(meia|\d+)\s*(?:minutos?|min)?)?/);
  if (hm) {
    const qty = hm[1] === 'meia' ? 0.5 : Number(hm[1].replace(',', '.'));
    let minutes = /^h/.test(hm[2]) ? qty * 60 : qty;
    if (hm[3]) minutes += hm[3] === 'meia' ? 30 : Number(hm[3]);
    const act = t.match(/\b(?:atividade|fazendo|referente a|de)\s+([a-z].+)$/);
    const activity = act && !/^\d/.test(act[1]) ? cap(original(raw, t, act.index + act[0].indexOf(act[1]), t.length).replace(/\b(na|da)?\s*(os|ordem.*)$/i, '').trim()) : undefined;
    return { intent: 'apontar_horas', order_number: orderNumber, minutes: Math.round(minutes), activity,
      summary: `Apontar ${Math.floor(minutes / 60) ? `${Math.floor(minutes / 60)} h ` : ''}${Math.round(minutes % 60) ? `${Math.round(minutes % 60)} min` : ''}${orderNumber ? ` na OS ${orderNumber}` : ''}`.replace(/\s+/g, ' ').trim() };
  }
  // ---- anotação na OS ----
  const note = t.match(/\b(?:anot(?:ar|e|a)|registr(?:ar|e|a)|observacao|nota)\b(?:\s+(?:na|da|no))?\s+(?:os|ordem(?: de servico)?)\s*(?:numero\s*)?(\d+)\s*[:,-]?\s*(?:que\s+)?(.+)$/);
  if (note) {
    const text2 = original(raw, t, t.length - note[2].length, t.length);
    return { intent: 'anotar', order_number: Number(note[1]), note: cap(text2), summary: `Anotar na OS ${note[1]}: “${cap(text2)}”` };
  }
  // ---- mudar etapa ----
  if (orderNumber && /\b(mud(ar|e|a)|passar|passe|colocar|coloque|marcar|marque|deixar)\b/.test(t)) {
    const after = t.slice(t.search(OS_NUM));
    const st = STATUS_WORDS.find(([re]) => re.test(after));
    if (st) return { intent: 'status', order_number: orderNumber, status: st[1], summary: `Mudar a OS ${orderNumber} para “${STATUS_LABEL[st[1]]}”` };
  }
  // ---- abrir uma OS existente ----
  if (orderNumber && /\b(abr(ir|a|e)|mostr(ar|e|a)|ver|consultar|consulte)\b/.test(t) && !/\b(nova|para o cliente|para a cliente|cliente)\b/.test(t)) {
    return { intent: 'abrir_existente', order_number: orderNumber, summary: `Abrir a OS ${orderNumber}` };
  }
  // ---- abrir nova OS ----
  if (/\b(abr(ir|a|e)|nova|criar|crie|cadastrar|cadastre|lancar|lance)\b.*\b(os|ordem(?: de servico)?|servico)\b/.test(t) || /^nova (os|ordem)/.test(t)) {
    // o que vem depois de "abrir ordem de serviço" (o próprio comando não entra no nome nem no problema)
    const head = t.match(/^.*?\b(?:ordem de servico|ordem|os|servico)\b/);
    const off = head ? head[0].length : 0;
    const rest = t.slice(off);
    const KEYS = '(?:placa|problema|defeito|relato|reclamacao|servico de|prioridade|urgente|com prioridade|para fazer|precisa)';
    const cm0 = rest.match(new RegExp(`^\\s*,?\\s*(?:para|pra|do|da|de|cliente)\\s+(?:o\\s+|a\\s+)?(?:cliente\\s+)?(.+?)(?=\\s*,|\\s+${KEYS}\\b|$)`));
    const cm = cm0 ? { 1: cm0[1], index: off + cm0.index } : null;
    let customer;
    if (cm && !/^(os|ordem|servico|uma|nova)\b/.test(cm[1])) {
      const s0 = t.indexOf(cm[1], cm.index);
      customer = cap(original(raw, t, s0, s0 + cm[1].length)).replace(/^(o|a)\s+/i, '');
    }
    const plate = /\bplaca\b/.test(t) ? plateFromSpeech(t) || undefined : undefined;
    const pm = rest.match(/\b(?:problema|defeito|relato|reclamacao|servico de|para fazer|precisa(?: de)?)\s*(?:e|:)?\s+(.+)$/);
    let problem;
    if (pm) {
      const s0 = t.length - pm[1].length;
      problem = cap(original(raw, t, s0, t.length).replace(/[,;]?\s*(com\s+)?prioridade\s+\w+$/i, '').replace(/[,;]?\s*urgente$/i, '').trim());
    }
    const priority = /\burgente\b/.test(t) ? 'urgente' : /prioridade alta|\balta prioridade/.test(t) ? 'alta' : /prioridade baixa/.test(t) ? 'baixa' : undefined;
    return { intent: 'abrir_os', customer, plate, problem, priority,
      summary: ['Abrir nova OS', customer && `cliente ${customer}`, plate && `placa ${plate}`, problem && `problema: ${problem}`, priority && `prioridade ${priority}`].filter(Boolean).join(' · ') };
  }
  return { intent: 'desconhecido', summary: 'Não entendi o comando.' };
}

export const VOICE_EXAMPLES = [
  'Abrir ordem de serviço para João Silva, placa ABC 1D23, problema solda no para-choque',
  'Iniciar apontamento na OS 120',
  'Parar apontamento',
  'Apontar 2 horas e 30 minutos na OS 120',
  'Anotar na OS 120 que o cliente autorizou a troca da dobradiça',
  'Mudar a OS 120 para pronta',
  'Abrir a OS 120',
];
