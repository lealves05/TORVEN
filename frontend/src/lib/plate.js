// Placas brasileiras: normalização e extração a partir do texto lido (foto da placa ou fala).
// Mercosul: LLL N L NN (ABC1D23) · antiga: LLL NNNN (ABC-1234). Na 5ª posição pode haver letra (Mercosul) ou número (antiga).

export const PLATE_RE = /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/;

/** "abc-1d23" → "ABC1D23"; inválida → null. */
export function normalizePlate(v) {
  const p = String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return PLATE_RE.test(p) ? p : null;
}

/** ABC1234 → "ABC-1234"; Mercosul fica sem hífen. */
export const formatPlate = (p) => (/^[A-Z]{3}\d{4}$/.test(p) ? `${p.slice(0, 3)}-${p.slice(3)}` : p);

// trocas comuns do reconhecimento de texto (OCR), aplicadas conforme a posição exigir letra ou número
const TO_LETTER = { 0: 'O', 1: 'I', 2: 'Z', 4: 'A', 5: 'S', 6: 'G', 7: 'T', 8: 'B' };
const TO_DIGIT = { O: '0', Q: '0', D: '0', U: '0', I: '1', L: '1', J: '1', Z: '2', S: '5', G: '6', T: '7', B: '8', A: '4' };

/** Corrige uma janela de 7 caracteres para o formato de placa, ou null se não der. */
function fixWindow(w) {
  const c = w.split('');
  for (const i of [0, 1, 2]) c[i] = /[A-Z]/.test(c[i]) ? c[i] : TO_LETTER[c[i]];
  for (const i of [3, 5, 6]) c[i] = /[0-9]/.test(c[i]) ? c[i] : TO_DIGIT[c[i]];
  if (c.some((x) => !x)) return null;
  const p = c.join('');
  return PLATE_RE.test(p) ? p : null;
}

/**
 * Candidatos de placa dentro de um texto (OCR). Ignora "BRASIL"/"BR" da faixa Mercosul.
 * Devolve em ordem de confiança: leitura exata primeiro, depois as corrigidas.
 */
export function extractPlates(text) {
  const clean = String(text || '').toUpperCase().replace(/BRASIL|MERCOSUL|MERCOSUR/g, ' ');
  const exact = new Set(); const fixed = new Set();
  for (const line of clean.split(/[\n\r]+/)) {
    const tokens = line.split(/[^A-Z0-9]+/).filter(Boolean);
    const cands = [];
    for (let i = 0; i < tokens.length; i += 1) {
      // a placa aparece como uma palavra ou dividida em 2–3 pedaços ("ABC 1D23", "ABC-1234")
      let joined = '';
      for (let j = i; j < Math.min(tokens.length, i + 3); j += 1) {
        joined += tokens[j];
        if (joined.length === 7) cands.push(joined);
        if (joined.length >= 7) break;
      }
      // palavra com 1–2 caracteres a mais (sujeira do OCR nas bordas)
      if (tokens[i].length === 8 || tokens[i].length === 9) for (let k = 0; k + 7 <= tokens[i].length; k += 1) cands.push(tokens[i].slice(k, k + 7));
    }
    for (const w of cands) {
      if (PLATE_RE.test(w)) exact.add(w);
      else { const f = fixWindow(w); if (f) fixed.add(f); }
    }
  }
  return [...exact, ...[...fixed].filter((p) => !exact.has(p))];
}

// ---------------- placa falada ----------------
const SPOKEN_DIGITS = {
  zero: '0', um: '1', uma: '1', dois: '2', duas: '2', 'três': '3', tres: '3', quatro: '4', cinco: '5', seis: '6', meia: '6',
  sete: '7', oito: '8', nove: '9',
};
// nomes das letras como costumam sair no reconhecimento de voz em português
const SPOKEN_LETTERS = {
  a: 'A', 'á': 'A', be: 'B', 'bê': 'B', ce: 'C', 'cê': 'C', de: 'D', 'dê': 'D', e: 'E', 'é': 'E', 'ê': 'E', efe: 'F', 'gê': 'G', ge: 'G',
  aga: 'H', i: 'I', jota: 'J', ka: 'K', 'cá': 'K', ele: 'L', eme: 'M', ene: 'N', o: 'O', 'ó': 'O', 'ô': 'O', pe: 'P', 'pê': 'P',
  que: 'Q', 'quê': 'Q', erre: 'R', esse: 'S', te: 'T', 'tê': 'T', u: 'U', ve: 'V', 'vê': 'V', dablio: 'W', 'dáblio': 'W',
  xis: 'X', 'ípsilon': 'Y', ipsilon: 'Y', ze: 'Z', 'zê': 'Z',
};

/** "placa a be ce um de dois três" / "ABC 1D23" → "ABC1D23" (ou null). */
export function plateFromSpeech(text) {
  const words = String(text || '').toLowerCase().replace(/[,.;:]/g, ' ').split(/\s+/).filter(Boolean);
  const start = words.findIndex((w) => w === 'placa');
  const seq = (start >= 0 ? words.slice(start + 1) : words);
  let out = '';
  for (const w of seq) {
    if (out.length >= 7) break;
    if (/^[a-z0-9]+$/i.test(w) && w.length > 1 && !(w in SPOKEN_DIGITS) && !(w in SPOKEN_LETTERS)) { out += w.toUpperCase(); continue; }
    if (w in SPOKEN_DIGITS) { out += SPOKEN_DIGITS[w]; continue; }
    if (w in SPOKEN_LETTERS) { out += SPOKEN_LETTERS[w]; continue; }
    if (/^[a-z0-9]$/i.test(w)) { out += w.toUpperCase(); continue; }
    if (out.length) break; // palavra que não faz parte da placa encerra a leitura
  }
  const direct = normalizePlate(out.slice(0, 7));
  if (direct) return direct;
  return extractPlates(out)[0] || null;
}
