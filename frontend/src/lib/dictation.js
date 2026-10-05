// Ditado por voz nos campos de texto: pontuação falada e junção com o texto que já está no campo.
// Conservador de propósito: "ponto" sozinho só vira "." no fim da fala, porque "ponto de solda" é termo do ofício.

const RULES = [
  [/\s*\b(?:ponto de interroga[cç][aã]o)\b/gi, '?'],
  [/\s*\b(?:ponto de exclama[cç][aã]o)\b/gi, '!'],
  [/\s*\bponto final\b/gi, '.'],
  [/\s*\bv[ií]rgula\b/gi, ','],
  [/\s*\b(?:nova linha|pr[oó]xima linha|novo par[aá]grafo|par[aá]grafo)\b\s*/gi, '\n'],
];

/** Texto reconhecido → texto com pontuação. */
export function punctuate(spoken) {
  let t = String(spoken || '').replace(/\s+/g, ' ').trim();
  for (const [re, out] of RULES) t = t.replace(re, out);
  t = t.replace(/\s*\b(?:dois pontos)$/i, ':').replace(/\s+\bponto$/i, '.');
  return t.replace(/ *\n */g, '\n').replace(/([,.;:!?])(?=[^\s\n,.;:!?])/g, '$1 ').trim();
}

const capFirst = (s) => s.replace(/^(\s*)(\p{Ll})/u, (_, sp, c) => sp + c.toUpperCase());

/** Junta a fala ao texto do campo: espaço quando precisa e maiúscula no começo de frase ou de linha. */
export function appendDictation(current, spoken) {
  const piece = punctuate(spoken);
  if (!piece) return current || '';
  const cur = String(current || '');
  const base = cur.replace(/[ \t]+$/, '');
  const newSentence = !base.trim() || /[.!?]$/.test(base) || /\n$/.test(base);
  let text = newSentence ? capFirst(piece) : piece;
  // depois de "vírgula" no fim do trecho anterior, continua em minúscula
  text = text.replace(/([.!?]\s+|\n)(\p{Ll})/gu, (_, sep, c) => sep + c.toUpperCase());
  const glue = !base || /\n$/.test(base) || /^[,.;:!?\n]/.test(text) ? '' : ' ';
  return base + glue + text;
}
