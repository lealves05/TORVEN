// Importar a nota do fornecedor na entrada de materiais: arquivo XML (lido direto), PDF (DANFE) ou foto (lidos pela IA da empresa).
// O resultado só preenche a tela — a pessoa confere e depois clica em "Dar entrada no estoque".
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileCode2, FileText, Camera, Loader2, ScanLine } from 'lucide-react';
import { api } from '../lib/api';
import { useUI } from '../context/UIContext';

const toBase64 = (buf) => {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

/** Foto do celular: reduz para no máximo 2000 px (JPEG) — lê melhor e envia rápido. */
async function shrinkImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => fail(new Error('Não foi possível abrir esta imagem. Use uma foto JPG ou PNG.')); i.src = url; });
    const scale = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.88));
    return { mime: 'image/jpeg', data: toBase64(await blob.arrayBuffer()) };
  } finally { URL.revokeObjectURL(url); }
}

export default function InvoiceReader({ onRead, compact }) {
  const { toast } = useUI();
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState(null);
  const refs = { xml: useRef(null), pdf: useRef(null), foto: useRef(null) };

  const read = async (kind, file) => {
    if (!file) return;
    setErr(null);
    const name = file.name.toLowerCase();
    try {
      let body;
      if (kind === 'xml') {
        if (!name.endsWith('.xml')) throw new Error('Escolha o arquivo que termina em .xml (vem junto com o PDF no e-mail do fornecedor).');
        if (file.size > 3_000_000) throw new Error('Arquivo XML grande demais para uma nota.');
        body = { mime: 'text/xml', data: toBase64(await file.arrayBuffer()) };
      } else if (kind === 'pdf') {
        if (!name.endsWith('.pdf')) throw new Error('Escolha o PDF da nota (DANFE).');
        if (file.size > 8_000_000) throw new Error('PDF grande demais (máximo 8 MB).');
        body = { mime: 'application/pdf', data: toBase64(await file.arrayBuffer()) };
      } else {
        body = await shrinkImage(file);
      }
      setBusy(kind);
      const r = await api.post('/purchases/read-invoice', { ...body, filename: file.name });
      onRead(r);
      toast(r.source === 'xml' ? `Nota lida: ${r.items.length} item(ns)` : `Nota lida pela IA: ${r.items.length} item(ns) — confira antes de dar entrada`);
    } catch (e) {
      setErr({ message: e.message, ia: e.data?.code === 'ia_off' });
    } finally {
      setBusy('');
      Object.values(refs).forEach((x) => { if (x.current) x.current.value = ''; });
    }
  };

  const Btn = ({ kind, icon: I, label, hint }) => (
    <button type="button" className="btn-outline h-auto flex-1 flex-col items-start gap-0.5 py-2.5 text-left" disabled={!!busy} onClick={() => refs[kind].current?.click()}>
      <span className="flex items-center gap-2 font-medium">{busy === kind ? <Loader2 className="h-4 w-4 animate-spin" /> : <I className="h-4 w-4 text-primary" />}{label}</span>
      {!compact && <span className="text-xs font-normal text-ink-faint">{hint}</span>}
    </button>
  );

  return (
    <section className="card space-y-3 p-5" aria-label="Importar nota do fornecedor">
      <div className="flex items-start gap-3">
        <ScanLine className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div>
          <h2 className="font-semibold">Importar a nota do fornecedor</h2>
          <p className="text-sm text-ink-faint">Preenche fornecedor, número, itens, valores e parcelas. Você confere tudo antes de dar entrada.</p>
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Btn kind="xml" icon={FileCode2} label="Arquivo XML" hint="O mais preciso. Vem no e-mail do fornecedor." />
        <Btn kind="pdf" icon={FileText} label="PDF da nota" hint="DANFE em PDF. Lido pela IA." />
        <Btn kind="foto" icon={Camera} label="Foto da nota" hint="Tire a foto de frente, com boa luz. Lida pela IA." />
      </div>
      <input ref={refs.xml} type="file" className="sr-only" accept=".xml,text/xml,application/xml" data-testid="nota-xml" onChange={(e) => read('xml', e.target.files?.[0])} />
      <input ref={refs.pdf} type="file" className="sr-only" accept=".pdf,application/pdf" data-testid="nota-pdf" onChange={(e) => read('pdf', e.target.files?.[0])} />
      <input ref={refs.foto} type="file" className="sr-only" accept="image/jpeg,image/png,image/webp" data-testid="nota-foto" onChange={(e) => read('foto', e.target.files?.[0])} />
      {busy && busy !== 'xml' && <p className="text-sm text-ink-soft">A IA está lendo a nota… pode levar até um minuto.</p>}
      {err && (
        <div className="rounded-app-sm bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
          {err.message}
          {err.ia && <Link to="/configuracoes?tab=integracoes#ia" className="mt-2 block font-medium underline">Abrir a configuração da IA</Link>}
        </div>
      )}
    </section>
  );
}
