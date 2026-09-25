// Anexos: fotos autorizadas (reduzidas no navegador) e PDFs, vinculados a cliente, objeto, solicitação, orçamento ou OS.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, FileText, Trash2, Paperclip, X } from 'lucide-react';
import { api, apiBase, getToken } from '../lib/api';
import { useUI } from '../context/UIContext';
import { Modal, Spinner, useAction, FAIL, cx } from './ui';
import { fmt } from '../lib/format';

const MAX_SIDE = 1600;

/** Reduz a imagem para no máx. 1600 px e JPEG ~82% (fica bem abaixo do limite de 1,5 MB). */
function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Imagem inválida.')); };
    img.src = url;
  });
}
const readAsDataUrl = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
  r.readAsDataURL(file);
});

export default function Attachments({ entity, entityId, canEdit = true, title = 'Fotos e documentos', compact }) {
  const { confirm, toast } = useUI();
  const [run, busy] = useAction();
  const [list, setList] = useState(null);
  const [pending, setPending] = useState(null);
  const [view, setView] = useState(null);
  const input = useRef(null);
  const load = useCallback(() => api.get(`/attachments?entity=${entity}&entity_id=${entityId}`).then(setList).catch(() => setList([])), [entity, entityId]);
  useEffect(() => { if (entityId) load(); }, [entityId, load]);

  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const isImg = file.type.startsWith('image/');
      if (!isImg && file.type !== 'application/pdf') return toast('Use foto (JPG, PNG, WEBP) ou PDF.', 'error');
      if (!isImg && file.size > 1_500_000) return toast('PDF muito grande (máx. 1,5 MB).', 'error');
      const data = isImg ? await resizeImage(file) : await readAsDataUrl(file);
      setPending({ filename: isImg ? file.name.replace(/\.\w+$/, '.jpg') : file.name, mime: isImg ? 'image/jpeg' : file.type, data, caption: '', authorized: false, preview: isImg ? data : null });
    } catch (err) { toast(err.message, 'error'); }
  };
  const upload = async () => {
    const r = await run(() => api.post('/attachments', { entity, entity_id: entityId, ...pending, preview: undefined }), 'Anexo incluído');
    if (r !== FAIL) { setPending(null); load(); }
  };
  const open = async (a) => {
    if (a.mime === 'application/pdf') {
      const full = await api.get(`/attachments/${a.id}`);
      const bytes = Uint8Array.from(atob(full.data), (c) => c.charCodeAt(0));
      window.open(URL.createObjectURL(new Blob([bytes], { type: a.mime })), '_blank');
      return;
    }
    setView({ ...a, loading: true });
    const full = await api.get(`/attachments/${a.id}`).catch(() => null);
    setView(full ? { ...a, src: `data:${full.mime};base64,${full.data}` } : null);
  };
  const remove = async (a) => {
    if (!(await confirm({ title: 'Remover anexo?', message: a.filename, confirmText: 'Remover' }))) return;
    if ((await run(() => api.del(`/attachments/${a.id}`), 'Anexo removido')) !== FAIL) load();
  };

  return (
    <section className={cx(!compact && 'card p-5')}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold"><Paperclip className="h-4 w-4 text-ink-faint" />{title}</h2>
        {canEdit && (
          <>
            <button type="button" className="btn-outline h-8 text-xs" onClick={() => input.current?.click()}><Camera className="h-3.5 w-3.5" /> Adicionar</button>
            <input ref={input} type="file" accept="image/*,application/pdf" capture="environment" className="hidden" onChange={pick} />
          </>
        )}
      </div>
      {!list ? <Spinner /> : !list.length ? <p className="text-sm text-ink-faint">Nenhum anexo.</p> : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {list.map((a) => (
            <div key={a.id} className="group relative overflow-hidden rounded-app-sm border border-line">
              <button type="button" onClick={() => open(a)} className="flex aspect-square w-full flex-col items-center justify-center gap-1 bg-muted/50 p-2 text-center">
                {a.mime.startsWith('image/') ? <Thumb id={a.id} /> : <FileText className="h-6 w-6 text-ink-faint" />}
                <span className="absolute inset-x-0 bottom-0 truncate bg-black/50 px-1.5 py-0.5 text-[10px] text-white">{a.caption || a.filename}</span>
              </button>
              {canEdit && (
                <button type="button" onClick={() => remove(a)} aria-label="Remover anexo"
                  className="absolute right-1 top-1 hidden rounded-full bg-surface/90 p-1 text-red-600 shadow group-hover:block max-md:block">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {pending && (
        <Modal open onClose={() => setPending(null)} size="sm" title="Incluir anexo"
          footer={<><button className="btn-ghost" onClick={() => setPending(null)}>Cancelar</button><button className="btn-primary" disabled={busy || !pending.authorized} onClick={upload}>Salvar anexo</button></>}>
          <div className="space-y-3 text-sm">
            {pending.preview ? <img src={pending.preview} alt="" className="max-h-60 w-full rounded-app-sm object-contain" /> : <div className="flex items-center gap-2"><FileText className="h-5 w-5" />{pending.filename}</div>}
            <input className="input" placeholder="Legenda (opcional)" value={pending.caption} onChange={(e) => setPending({ ...pending, caption: e.target.value })} />
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-1" checked={pending.authorized} onChange={(e) => setPending({ ...pending, authorized: e.target.checked })} />
              <span>O cliente autorizou o registro desta foto/documento para fins do atendimento.</span>
            </label>
          </div>
        </Modal>
      )}
      {view && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-black/80 p-4 animate-fade" onClick={() => setView(null)}>
          <button className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white" aria-label="Fechar"><X className="h-5 w-5" /></button>
          {view.src ? <img src={view.src} alt={view.caption || ''} className="max-h-[85vh] max-w-full rounded-app-sm" /> : <Spinner className="h-8 w-8" />}
          <div className="absolute bottom-4 text-center text-xs text-white/80">{view.caption || view.filename} · {fmt(view.created_at)}</div>
        </div>
      )}
    </section>
  );
}

/** Miniatura carregada sob demanda (endpoint devolve o binário). */
function Thumb({ id }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let url;
    let alive = true;
    fetch(`${apiBase}/attachments/${id}?raw=1`, { headers: { Authorization: `Bearer ${getToken()}` } })
      .then((r) => (r.ok ? r.blob() : null)).then((b) => { if (b && alive) { url = URL.createObjectURL(b); setSrc(url); } }).catch(() => {});
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [id]);
  return src ? <img src={src} alt="" className="absolute inset-0 h-full w-full object-cover" /> : <Spinner className="h-4 w-4" />;
}
