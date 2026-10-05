// Leitura da placa pela foto, no próprio navegador (nenhuma imagem sai do aparelho).
// Usa o Tesseract (OCR) servido pelo site em /ocr e procura no texto o formato de placa brasileira.
import { extractPlates } from './plate.js';

let workerPromise = null;
const base = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/ocr`;

async function getWorker() {
  workerPromise ||= (async () => {
    const { createWorker, PSM } = await import('tesseract.js');
    const w = await createWorker('eng', 1, {
      workerPath: `${base}/worker.min.js`, corePath: base, langPath: base, gzip: true, workerBlobURL: false, cacheMethod: 'none',
    });
    await w.setParameters({ tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789- ', tessedit_pageseg_mode: PSM.SPARSE_TEXT });
    return w;
  })().catch((e) => { workerPromise = null; throw e; });
  return workerPromise;
}

/** Reduz e, opcionalmente, recorta o centro, passa para tons de cinza e aplica limiar (placas: letra escura em fundo claro). */
async function prepare(file, { threshold = false, invert = false, crop = 1 } = {}) {
  const bmp = await createImageBitmap(file);
  const sw = bmp.width * crop; const sh = bmp.height * crop;
  const sx = (bmp.width - sw) / 2; const sy = (bmp.height - sh) / 2;
  const scale = Math.min(1, 1400 / Math.max(sw, sh));
  const c = document.createElement('canvas');
  c.width = Math.round(sw * scale); c.height = Math.round(sh * scale);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, c.width, c.height);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) { const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; d[i] = g; sum += g; }
  const avg = sum / (d.length / 4);
  for (let i = 0; i < d.length; i += 4) {
    let v = threshold ? (d[i] > avg * 0.9 ? 255 : 0) : d[i];
    if (invert) v = 255 - v;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/**
 * Lê a(s) placa(s) da foto. Devolve { plates: string[], text } — a primeira é a mais provável.
 * Tenta alguns jeitos de ler (placa ocupando a foto, placa pequena no meio, contraste alto) e para no primeiro que achar.
 * O usuário sempre confere/corrige antes de buscar.
 */
export async function readPlateFromImage(file, onProgress) {
  onProgress?.('Preparando o leitor…');
  const { PSM } = await import('tesseract.js');
  const w = await getWorker();
  onProgress?.('Lendo a placa…');
  const passes = [
    [{}, PSM.SINGLE_BLOCK],
    [{ crop: 0.6 }, PSM.SINGLE_BLOCK],
    [{}, PSM.SPARSE_TEXT],
    [{ threshold: true }, PSM.SPARSE_TEXT],
    [{ crop: 0.6 }, PSM.SINGLE_LINE],
    [{ threshold: true, invert: true }, PSM.SPARSE_TEXT],
  ];
  let text = '';
  for (const [opt, psm] of passes) {
    await w.setParameters({ tessedit_pageseg_mode: psm });
    const { data } = await w.recognize(await prepare(file, opt));
    text += `\n${data.text}`;
    const plates = extractPlates(text);
    if (plates.length) return { plates, text };
  }
  return { plates: [], text };
}
