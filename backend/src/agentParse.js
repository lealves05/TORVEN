// Assistente: entende pedidos em português (texto ou voz) por regras simples e previsíveis.
// Não usa IA: o que ele entende é sempre o mesmo para a mesma frase, e nada é gravado sem a pessoa confirmar.

export const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/\s+/g, ' ').trim();

const WEEKDAYS = { domingo: 0, segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6 };
const MONTHS = { janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12 };

const pad = (n) => String(n).padStart(2, '0');
export const ymdOf = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
/** "Hoje" no fuso da empresa, como data UTC à meia-noite (só a parte da data importa). */
export function todayIn(tz = 'America/Sao_Paulo', now = new Date()) {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
const validDate = (y, m, d) => { const x = new Date(Date.UTC(y, m - 1, d)); return x.getUTCMonth() === m - 1 && x.getUTCDate() === d ? x : null; };

/** Encontra uma data no texto. Devolve { date: 'YYYY-MM-DD', text } ou null. */
export function parseDate(text, today) {
  const t = norm(text);
  let m;
  if (/\bdepois de amanha\b/.test(t)) return { date: ymdOf(addDays(today, 2)), text: 'depois de amanhã' };
  if (/\bamanha\b/.test(t)) return { date: ymdOf(addDays(today, 1)), text: 'amanhã' };
  if (/\bhoje\b/.test(t)) return { date: ymdOf(today), text: 'hoje' };
  if ((m = t.match(/\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/))) {
    const d = +m[1]; const mo = +m[2];
    let y = m[3] ? +m[3] : today.getUTCFullYear();
    if (y < 100) y += 2000;
    let x = validDate(y, mo, d);
    if (x && !m[3] && x < today) x = validDate(y + 1, mo, d);
    if (x) return { date: ymdOf(x), text: m[0] };
  }
  if ((m = t.match(/\bdia (\d{1,2})(?: de ([a-z]+))?\b/))) {
    const d = +m[1];
    const mo = m[2] && MONTHS[m[2]];
    let y = today.getUTCFullYear();
    let month = mo || today.getUTCMonth() + 1;
    let x = validDate(y, month, d);
    if (x && x < today) {
      if (mo) { y += 1; } else { month += 1; if (month > 12) { month = 1; y += 1; } }
      x = validDate(y, month, d);
    }
    if (x) return { date: ymdOf(x), text: m[0] };
  }
  if ((m = t.match(/\b(?:na |no |proxima |proximo )?(domingo|segunda|terca|quarta|quinta|sexta|sabado)(?:-feira| feira)?\b/))) {
    const wd = WEEKDAYS[m[1]];
    let n = (wd - today.getUTCDay() + 7) % 7;
    if (n === 0) n = 7;
    return { date: ymdOf(addDays(today, n)), text: m[0] };
  }
  if ((m = t.match(/\b(?:daqui a|em) (\d{1,3}) dias?\b/))) return { date: ymdOf(addDays(today, +m[1])), text: m[0] };
  if (/\bsemana que vem\b|\bproxima semana\b/.test(t)) return { date: ymdOf(addDays(today, 7)), text: 'semana que vem' };
  return null;
}

/** Período para consultas: hoje, amanhã, esta semana, este mês, vencidas. */
export function parsePeriod(text, today) {
  const t = norm(text);
  if (/vencid|atrasad|em atraso/.test(t)) return { key: 'vencidas', label: 'vencidas', to: ymdOf(addDays(today, -1)) };
  if (/\bhoje\b/.test(t)) return { key: 'hoje', label: 'de hoje', from: ymdOf(today), to: ymdOf(today) };
  if (/\bamanha\b/.test(t)) { const d = ymdOf(addDays(today, 1)); return { key: 'amanha', label: 'de amanhã', from: d, to: d }; }
  if (/(esta|essa|nesta|nessa|da) semana|7 dias|sete dias/.test(t)) return { key: 'semana', label: 'dos próximos 7 dias', from: ymdOf(today), to: ymdOf(addDays(today, 7)) };
  if (/(este|esse|neste|nesse|do) mes|30 dias|trinta dias/.test(t)) {
    const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));
    return { key: 'mes', label: 'deste mês', from: ymdOf(today), to: ymdOf(end) };
  }
  return { key: 'abertas', label: 'em aberto', to: null };
}

const NUM_WORDS = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, cem: 100, cento: 100, duzentos: 200, trezentos: 300, quatrocentos: 400, quinhentos: 500, seiscentos: 600, setecentos: 700, oitocentos: 800, novecentos: 900, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90 };

/** Valor em reais: "R$ 1.250,50", "350 reais", "1250", "mil e duzentos reais", "2 mil". */
export function parseAmount(text) {
  const raw = String(text || '');
  const t = norm(raw);
  let m = t.match(/\b(\d+(?:,\d+)?)\s*mil\b(?:\s*reais)?/);
  if (m) return { amount: Number(m[1].replace(',', '.')) * 1000, text: m[0] };
  m = raw.match(/r\$\s*([\d.]+(?:,\d{1,2})?|\d+(?:\.\d{1,2})?)/i)
    || t.match(/([\d.]+(?:,\d{1,2})?)\s*(?:reais|real|conto)/)
    || t.match(/\b(?:de|valor|valor de|no valor de)\s+([\d.]+(?:,\d{1,2})?)\b/);
  if (m) {
    let v = m[1];
    if (v.includes(',')) v = v.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(v)) v = v.replace(/\./g, '');
    const n = Number(v);
    if (n > 0) return { amount: Math.round(n * 100) / 100, text: m[0] };
  }
  // por extenso, simples: "mil e duzentos", "trezentos e cinquenta reais"
  m = t.match(/\b((?:mil|cem|cento|duzentos|trezentos|quatrocentos|quinhentos|seiscentos|setecentos|oitocentos|novecentos|vinte|trinta|quarenta|cinquenta|sessenta|setenta|oitenta|noventa|dez|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove)(?:\s+e\s+|\s+)?)+(?=\s*reais)/);
  if (m) {
    let total = 0; let cur = 0;
    for (const w of m[0].split(/\s+e\s+|\s+/).filter(Boolean)) {
      if (w === 'mil') { total += (cur || 1) * 1000; cur = 0; } else if (NUM_WORDS[w]) cur += NUM_WORDS[w];
    }
    total += cur;
    if (total > 0) return { amount: total, text: `${m[0].trim()} reais` };
  }
  return null;
}

// palavras → categoria (só usada se a empresa tiver a categoria cadastrada)
const CATEGORY_HINTS = [
  [/energia|luz|cpfl|enel|cemig|copel|eletric/, 'Energia elétrica'],
  [/aluguel/, 'Aluguel'],
  [/agua|sabesp|internet|telefone|celular/, 'Água/Internet/Telefone'],
  [/salari|folha|funcionari/, 'Salários'],
  [/comiss/, 'Comissões'],
  [/imposto|das\b|simples|iss\b|icms|darf|inss|fgts/, 'Impostos'],
  [/oxigenio|argonio|gas|eletrodo|arame|consumive/, 'Gases e consumíveis'],
  [/combustiv|gasolina|diesel|etanol|deslocament/, 'Combustível/Deslocamento'],
  [/ferrament|epi\b|luva|mascara/, 'Ferramentas e EPI'],
  [/manutencao d[ae] (maquina|equipament)/, 'Manutenção de máquinas'],
  [/material|chapa|tubo|perfil|peca|compra/, 'Compra de materiais'],
  [/terceir/, 'Terceirização'],
  [/tarifa|banco/, 'Tarifas bancárias'],
];
export function guessCategory(text, type, settings) {
  const list = (type === 'entrada' ? settings.incomeCategories : settings.expenseCategories) || [];
  const t = norm(text);
  if (type === 'saida') {
    for (const [re, cat] of CATEGORY_HINTS) if (re.test(t) && list.includes(cat)) return cat;
    return list.includes('Outras despesas') ? 'Outras despesas' : list[0] || 'Outras despesas';
  }
  if (/\bos\b|ordem de servico|servico/.test(t) && list.includes('Ordens de serviço')) return 'Ordens de serviço';
  return list.includes('Outras receitas') ? 'Outras receitas' : list[0] || 'Outras receitas';
}

/** Descrição a partir do que sobrou da frase ("da energia", "do aluguel", "para o João"). */
function cleanDescription(text, removes) {
  let t = String(text || '');
  for (const r of removes.filter(Boolean)) t = t.replace(new RegExp(r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), ' ');
  t = t.replace(/\b(lan[cç]ar|lan[cç]a|incluir|inclua|cadastrar|cadastre|registrar|registre|criar|crie|adicionar|adicione|nova|novo|uma|um)\b/gi, ' ')
    .replace(/\bconta(s)? a (pagar|receber)\b/gi, ' ').replace(/\b(despesa|receita|pagamento|recebimento)\b/gi, ' ')
    .replace(/\b(com )?vencimento\b|\bvence(ndo)?\b|\bpara\b(?= *$)|\bpro\b(?= *$)/gi, ' ')
    .replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 4; i += 1) {
    t = t.replace(/^(de|da|do|das|dos|referente a|referente ao|ref\.?|com|no|na|pra|para|o|a)\s+/i, '')
      .replace(/\s+(de|da|do|para|pra|no|na|com|e|reais)$/i, '').trim();
  }
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
}

/**
 * Entende o pedido. Devolve { intent, params, missing? }.
 * intents: ajuda, resumo, caixa, listar_contas, lancar_conta, baixar_conta, lembrete, listar_lembretes, consultar_os, desconhecido
 */
export function understand(text, { today, settings }) {
  const t = norm(text);
  if (!t) return { intent: 'desconhecido', params: {} };
  if (/^(ajuda|o que (voce|vc) (faz|sabe)|comandos|exemplos|como (te )?uso)/.test(t)) return { intent: 'ajuda', params: {} };

  const osm = t.match(/\b(?:os|o\.s\.?|ordem de servico|ordem)\s*(?:n(?:umero|o|º)?\.?\s*)?#?(\d{1,7})\b/);
  if (osm && !/conta|lancar|pagar|receber/.test(t)) return { intent: 'consultar_os', params: { number: +osm[1] } };

  if (/^(lembrete|lembre|me lembr|lembrar|anot(e|a) (um )?lembrete|criar lembrete|crie um lembrete)/.test(t) || /\bme lembr(e|a|ar)\b/.test(t)) {
    const d = parseDate(text, today);
    const a = parseAmount(text);
    const title = cleanDescription(text.replace(/^(.*?)(me lembr[ea]r?|lembrete:?|lembrar|lembre)\s*(de|que|para)?/i, ''), [d?.text, a?.text])
      .replace(/^(de|que|para)\s+/i, '');
    return { intent: 'lembrete', params: { title: title || 'Lembrete', due_date: d?.date || ymdOf(today), amount: a?.amount || null, has_date: !!d } };
  }
  if (/(meus |os |quais |ver |listar )?lembretes/.test(t) && !/criar|crie|novo/.test(t)) return { intent: 'listar_lembretes', params: {} };

  const isPay = /\bpagar\b|\bpagas?\b|despesa|saida/.test(t);
  const isRec = /receber|recebiment|receita|entrada/.test(t);

  // dar baixa: "paguei a conta de energia", "dar baixa na conta do aluguel", "recebi do João"
  if (/\b(paguei|pagamos|quitei|quitar|dar baixa|de baixa|baixar|recebi|recebemos)\b/.test(t)) {
    const type = /\b(recebi|recebemos)\b/.test(t) || (isRec && !isPay) ? 'entrada' : 'saida';
    const a = parseAmount(text);
    const term = cleanDescription(text.replace(/\b(paguei|pagamos|quitei|quitar|dar baixa|de baixa|baixar|recebi|recebemos)\b/gi, ' ')
      .replace(/\b(na|a|da|do|o)\s+conta\b/gi, ' ').replace(/\bconta\b/gi, ' '), [a?.text]);
    return { intent: 'baixar_conta', params: { type, amount: a?.amount || null, term } };
  }

  // incluir conta: "lançar conta a pagar de 350 reais da energia dia 10"
  if (/\b(lancar|lanca|incluir|inclua|cadastrar|cadastre|registrar|registre|criar|crie|adicionar|adicione|nova|novo)\b/.test(t) && (isPay || isRec || /\bconta\b/.test(t))) {
    const type = isRec && !/a pagar|despesa/.test(t) ? 'entrada' : 'saida';
    const a = parseAmount(text);
    const d = parseDate(text, today);
    const description = cleanDescription(text, [a?.text, d?.text]);
    const params = { type, amount: a?.amount || null, due_date: d?.date || ymdOf(today), description: description || (type === 'saida' ? 'Conta a pagar' : 'Conta a receber'),
      category: guessCategory(`${description} ${text}`, type, settings), has_date: !!d };
    const missing = [];
    if (!params.amount) missing.push('o valor (ex.: 350 reais)');
    return { intent: 'lancar_conta', params, missing };
  }

  if (/\bcaixa\b/.test(t) && !/caixas fechados/.test(t)) return { intent: 'caixa', params: {} };

  if (isPay || isRec || /\bcontas?\b|vencid|vencendo|vence\b/.test(t)) {
    const type = isPay && !isRec ? 'saida' : isRec && !isPay ? 'entrada' : null;
    return { intent: 'listar_contas', params: { type, period: parsePeriod(text, today) } };
  }

  if (/resumo|saldo|financeiro|como (esta|estamos|anda)|quanto (tenho|temos)/.test(t)) return { intent: 'resumo', params: {} };
  return { intent: 'desconhecido', params: {} };
}
