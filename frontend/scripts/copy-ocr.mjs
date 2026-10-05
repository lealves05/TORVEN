// Copia os arquivos do leitor de texto (OCR da placa) para public/ocr, servidos pelo próprio site (sem CDN externo).
// Roda antes do build/dev. public/ocr fica fora do Git (são arquivos das dependências).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const out = path.join(root, 'public', 'ocr');
fs.mkdirSync(out, { recursive: true });
const dir = (pkg) => path.dirname(require.resolve(`${pkg}/package.json`));
const files = [
  [path.join(dir('tesseract.js'), 'dist', 'worker.min.js'), 'worker.min.js'],
  ...['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'].map((f) => [path.join(dir('tesseract.js-core'), f), f]),
  [path.join(dir('@tesseract.js-data/eng'), '4.0.0_best_int', 'eng.traineddata.gz'), 'eng.traineddata.gz'],
];
for (const [from, name] of files) {
  const to = path.join(out, name);
  const a = fs.statSync(from);
  if (!fs.existsSync(to) || fs.statSync(to).size !== a.size) fs.copyFileSync(from, to);
}
console.log(`OCR: ${files.length} arquivos em public/ocr`);
