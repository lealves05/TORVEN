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

/** Reduz, passa para tons de cinza e aumenta o contraste (melhora a leitura e diminui o tempo). */
async function prepare(file, { invert = false } = {}) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1400 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) { const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; d[i] = g; sum += g; }
  const avg = sum / (d.length / 4);
  for (let i = 0; i < d.length; i += 4) {
    let v = d[i] > avg * 0.9 ? 255 : 0; // limiar simples (placas: letra escura em fundo claro)
    if (invert) v = 255 - v;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/**
 * Lê a(s) placa(s) da foto. Devolve { plates: string[], text } — a primeira é a mais provável.
 * O usuário sempre confere/corrige antes de buscar.
 */
export async function readPlateFromImage(file, onProgress) {
  onProgress?.('Preparando o leitor…');
  const w = await getWorker();
  onProgress?.('Lendo a placa…');
  let text = '';
  for (const invert of [false, true]) {
    const canvas = await prepare(file, { invert });
    const { data } = await w.recognize(canvas);
    text += `\n${data.text}`;
    const plates = extractPlates(text);
    if (plates.length) return { plates, text };
  }
  // última tentativa: imagem original, sem tratamento
  const { data } = await w.recognize(file);
  text += `\n${data.text}`;
  return { plates: extractPlates(text), text };
}
