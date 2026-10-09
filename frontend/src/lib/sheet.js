// Leitura de planilhas no navegador: Excel (.xlsx) ou CSV (separado por ; , ou tab, UTF-8 ou o padrão do Excel no Windows).
// Devolve { headers, rows } com cada linha como objeto { 'Nome da coluna': valor }.

/** CSV simples com aspas ("a;b";"c""d"). Descobre o separador pela primeira linha. */
export function parseCSV(text) {
  const src = String(text || '').replace(/^﻿/, '');
  const first = src.split(/\r?\n/, 1)[0] || '';
  const count = (ch) => (first.match(new RegExp(ch === '\t' ? '\\t' : `\\${ch}`, 'g')) || []).length;
  const sep = [';', ',', '\t'].sort((a, b) => count(b) - count(a))[0];
  const out = [];
  let row = []; let cell = ''; let q = false;
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (q) {
      if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i += 1; } else q = false; } else cell += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i += 1;
      row.push(cell); out.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); out.push(row); }
  return out.filter((r) => r.some((x) => String(x).trim() !== ''));
}

const ymd = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

/** Lê o arquivo escolhido. */
export async function readTable(file) {
  const name = (file?.name || '').toLowerCase();
  let grid;
  if (name.endsWith('.xlsx')) {
    const { readSheet } = await import('read-excel-file/universal');
    grid = await readSheet(await file.arrayBuffer());
  } else if (name.endsWith('.csv') || name.endsWith('.txt')) {
    let buf = new Uint8Array(await file.arrayBuffer());
    // marca de UTF-8 no começo (alguns sistemas a colocam mesmo gravando o resto no padrão do Windows)
    if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) buf = buf.subarray(3);
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { text = new TextDecoder('windows-1252').decode(buf); }
    grid = parseCSV(text);
  } else if (name.endsWith('.xls')) {
    throw new Error('Arquivo .xls (Excel antigo): abra no Excel e use "Salvar como" › "Pasta de trabalho do Excel (.xlsx)" ou "CSV".');
  } else {
    throw new Error('Escolha uma planilha do Excel (.xlsx) ou um arquivo CSV.');
  }
  const cellText = (v) => (v instanceof Date ? ymd(v) : v == null ? '' : typeof v === 'number' ? String(v) : String(v).trim());
  let [head = [], ...body] = grid;
  // cabeçalho terminado em ";" (coluna vazia no fim) não vira coluna
  while (head.length && cellText(head[head.length - 1]) === '' && body.every((r) => r.length <= head.length && cellText(r[head.length - 1]) === '')) head = head.slice(0, -1);
  const headers = head.map((h, i) => cellText(h) || `Coluna ${i + 1}`);
  // linha com ";" solto dentro de um texto (ex.: "M;O") tem colunas a mais: junta o excesso na coluna de descrição
  const desc = headers.findIndex((h) => /descri/i.test(h));
  body = body.map((r) => {
    const extra = r.length - headers.length - (r.length > headers.length && cellText(r[r.length - 1]) === '' && grid[0].length > headers.length ? 1 : 0);
    if (extra <= 0 || desc < 0) return r;
    return [...r.slice(0, desc), r.slice(desc, desc + extra + 1).join(';'), ...r.slice(desc + extra + 1)];
  });
  const rows = body
    .map((r) => Object.fromEntries(headers.map((h, i) => [h, cellText(r[i])])))
    .filter((o) => Object.values(o).some((v) => v !== ''));
  return { headers, rows };
}
