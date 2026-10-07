// Anexos: fotos autorizadas (reduzidas no navegador) e PDFs, vinculados a cliente, objeto, solicitação, orçamento ou OS.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, FileText, Trash2, Paperclip, X, Images, Plus, ChevronLeft, ChevronRight } from 'lucide-react';
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

// Limites por registro (iguais aos do servidor) e por envio.
const MAX_FILES = { order: 40, inspection: 30 };
const BATCH = 20;
const isTouch = () => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

async function prepare(file) {
  const isImg = file.type.startsWith('image/');
  if (!isImg && file.type !== 'application/pdf') throw new Error(`${file.name}: use foto (JPG, PNG, WEBP) ou PDF.`);
  if (!isImg && file.size > 1_500_000) throw new Error(`${file.name}: PDF muito grande (máx. 1,5 MB).`);
  const data = isImg ? await resizeImage(file) : await readAsDataUrl(file);
  return {
    key: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 8)}`,
    filename: isImg ? file.name.replace(/\.\w+$/, '') + '.jpg' : file.name, mime: isImg ? 'image/jpeg' : file.type,
    data, caption: '', preview: isImg ? data : null, error: null,
  };
}

export default function Attachments({ entity, entityId, canEdit = true, title = 'Fotos e documentos', compact }) {
  const { confirm, toast } = useUI();
  const [run] = useAction();
  const [list, setList] = useState(null);
  const [pending, setPending] = useState(null); // { files: [], authorized, sending, done }
  const [preparing, setPreparing] = useState(0);
  const [view, setView] = useState(null);
  const [drag, setDrag] = useState(false);
  const many = useRef(null);
  const camera = useRef(null);
  const max = MAX_FILES[entity] || 20;
  const load = useCallback(() => api.get(`/attachments?entity=${entity}&entity_id=${entityId}`).then(setList).catch(() => setList([])), [entity, entityId]);
  useEffect(() => { if (entityId) load(); }, [entityId, load]);
  const used = (list?.length || 0) + (pending?.files.length || 0);

  const addFiles = async (fileList) => {
    let files = [...(fileList || [])];
    if (!files.length) return;
    const room = Math.min(max - used, BATCH - (pending?.files.length || 0));
    if (room <= 0) return toast(used >= max ? `Esta ficha já tem o máximo de ${max} anexos. Apague algum para incluir outro.` : `Envie no máximo ${BATCH} arquivos por vez.`, 'error');
    if (files.length > room) { toast(`Foram escolhidos ${files.length} arquivos; cabem mais ${room}. Os primeiros ${room} foram separados.`, 'info'); files = files.slice(0, room); }
    setPreparing(files.length);
    const ready = [];
    for (const f of files) {
      try { ready.push(await prepare(f)); } catch (err) { toast(err.message, 'error'); }
      setPreparing((n) => n - 1);
    }
    setPreparing(0);
    if (ready.length) setPending((p) => ({ authorized: false, sending: false, done: 0, ...p, files: [...(p?.files || []), ...ready] }));
  };
  const pick = (e) => { const fl = e.target.files; addFiles(fl).finally(() => { e.target.value = ''; }); };
  const setFile = (key, patch) => setPending((p) => ({ ...p, files: p.files.map((f) => (f.key === key ? { ...f, ...patch } : f)) }));
  const dropFile = (key) => setPending((p) => (p.files.length > 1 ? { ...p, files: p.files.filter((f) => f.key !== key) } : null));

  const upload = async () => {
    const files = pending.files;
    setPending((p) => ({ ...p, sending: true, done: 0 }));
    const failed = [];
    let ok = 0;
    for (const f of files) {
      try {
        await api.post('/attachments', { entity, entity_id: entityId, filename: f.filename, mime: f.mime, data: f.data, caption: f.caption || null, authorized: pending.authorized });
        ok += 1;
      } catch (err) { failed.push({ ...f, error: err.message }); }
      setPending((p) => ({ ...p, done: p.done + 1 }));
    }
    load();
    if (ok) toast(ok === 1 ? 'Anexo incluído' : `${ok} anexos incluídos`, 'success');
    if (failed.length) {
      toast(`${failed.length} não foram enviados. Veja o motivo em cada um.`, 'error');
      setPending((p) => ({ ...p, files: failed, sending: false, done: 0 }));
    } else setPending(null);
  };

  const images = (list || []).filter((a) => a.mime.startsWith('image/'));
  const open = async (a) => {
    if (a.mime === 'application/pdf') {
      const full = await api.get(`/attachments/${a.id}`);
      const bytes = Uint8Array.from(atob(full.data), (c) => c.charCodeAt(0));
      window.open(URL.createObjectURL(new Blob([bytes], { type: a.mime })), '_blank');
      return;
    }
    setView({ ...a, loading: true });
    const full = await api.get(`/attachments/${a.id}`).catch(() => null);
    setView((v) => (v?.id !== a.id ? v : full ? { ...a, src: `data:${full.mime};base64,${full.data}` } : null));
  };
  const step = (d) => {
    const i = images.findIndex((x) => x.id === view?.id);
    if (i < 0 || images.length < 2) return;
    open(images[(i + d + images.length) % images.length]);
  };
  useEffect(() => {
    if (!view) return undefined;
    const k = (e) => { if (e.key === 'ArrowRight') step(1); else if (e.key === 'ArrowLeft') step(-1); else if (e.key === 'Escape') setView(null); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  const touchX = useRef(null);
  const remove = async (a) => {
    if (!(await confirm({ title: 'Remover anexo?', message: a.caption || a.filename, confirmText: 'Remover' }))) return;
    if ((await run(() => api.del(`/attachments/${a.id}`), 'Anexo removido')) !== FAIL) load();
  };

  const dropZone = canEdit ? {
    onDragOver: (e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); setDrag(true); } },
    onDragLeave: (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDrag(false); },
    onDrop: (e) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); },
  } : {};
  const viewIdx = images.findIndex((x) => x.id === view?.id);

  return (
    <section className={cx(!compact && 'card p-5', 'relative', drag && 'ring-2 ring-primary')} {...dropZone}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold"><Paperclip className="h-4 w-4 text-ink-faint" />{title}
          {list?.length > 0 && <span className="whitespace-nowrap text-xs font-normal text-ink-faint">{list.length} de {max}</span>}</h2>
        {canEdit && (
          <div className="flex flex-wrap gap-1.5">
            {isTouch() && <button type="button" className="btn-outline h-8 text-xs" disabled={!!preparing} onClick={() => camera.current?.click()}><Camera className="h-3.5 w-3.5" /> Tirar foto</button>}
            <button type="button" className="btn-outline h-8 text-xs" disabled={!!preparing} onClick={() => many.current?.click()}><Images className="h-3.5 w-3.5" /> {isTouch() ? 'Da galeria' : 'Adicionar fotos'}</button>
            <input ref={many} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={pick} aria-label="Escolher fotos ou PDFs" data-testid="anexos-varios" />
            <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={pick} aria-label="Tirar foto" />
          </div>
        )}
      </div>
      {preparing > 0 && <p className="mb-2 flex items-center gap-2 text-xs text-ink-faint"><Spinner className="h-3.5 w-3.5" /> Preparando {preparing} arquivo(s)…</p>}
      {!list ? <Spinner /> : !list.length ? (
        <p className="text-sm text-ink-faint">Nenhum anexo.{canEdit && !isTouch() && ' Você pode escolher várias fotos de uma vez ou arrastar os arquivos para cá.'}</p>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {list.map((a) => (
            <div key={a.id} className="group relative overflow-hidden rounded-app-sm border border-line">
              <button type="button" onClick={() => open(a)} aria-label={`Abrir ${a.caption || a.filename}`} className="flex aspect-square w-full flex-col items-center justify-center gap-1 bg-muted/50 p-2 text-center">
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
      {drag && <div className="pointer-events-none absolute inset-0 grid place-items-center rounded-app bg-primary/10 text-sm font-medium text-primary">Solte os arquivos para anexar</div>}

      {pending && (
        <Modal open onClose={() => !pending.sending && setPending(null)} size="lg" dirty
          title={pending.files.length === 1 ? 'Incluir anexo' : `Incluir ${pending.files.length} anexos`}
          subtitle="Confira as fotos, escreva uma legenda se quiser e confirme a autorização do cliente."
          footer={<>
            <button className="btn-ghost" disabled={pending.sending} onClick={() => setPending(null)}>Cancelar</button>
            <button className="btn-primary" disabled={pending.sending || !pending.authorized} onClick={upload}>
              {pending.sending ? `Enviando ${Math.min(pending.done + 1, pending.files.length)} de ${pending.files.length}…`
                : pending.files.length === 1 ? 'Salvar anexo' : `Salvar ${pending.files.length} anexos`}
            </button>
          </>}>
          <div className="space-y-3 text-sm">
            {pending.sending && (
              <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={pending.files.length} aria-valuenow={pending.done}>
                <div className="h-full bg-primary transition-all" style={{ width: `${(pending.done / pending.files.length) * 100}%` }} />
              </div>
            )}
            <ul className="grid grid-cols-2 gap-2 sm:gap-3">
              {pending.files.map((f, i) => (
                <li key={f.key} className={cx('relative min-w-0 rounded-app-sm border p-2', f.error ? 'border-red-500' : 'border-line')}>
                  {f.preview ? <img src={f.preview} alt={`Foto ${i + 1}`} className="h-28 w-full rounded-app-sm bg-muted object-contain sm:h-36" />
                    : <div className="flex h-28 items-center sm:h-36 justify-center gap-2 rounded-app-sm bg-muted"><FileText className="h-5 w-5" /><span className="truncate">{f.filename}</span></div>}
                  {!pending.sending && (
                    <button type="button" onClick={() => dropFile(f.key)} aria-label={`Tirar foto ${i + 1} da lista`}
                      className="absolute right-3 top-3 rounded-full bg-surface/90 p-1 text-red-600 shadow"><X className="h-4 w-4" /></button>
                  )}
                  <input className="input mt-2 h-9" placeholder="Legenda (opcional)" aria-label={`Legenda da foto ${i + 1}`} value={f.caption} disabled={pending.sending}
                    onChange={(e) => setFile(f.key, { caption: e.target.value })} />
                  {f.error && <p className="mt-1 text-xs text-red-600">{f.error}</p>}
                </li>
              ))}
            </ul>
            {!pending.sending && pending.files.length < BATCH && used < max && (
              <div className="flex flex-wrap gap-2">
                {isTouch() && <button type="button" className="btn-outline h-9 text-xs" onClick={() => camera.current?.click()}><Camera className="h-3.5 w-3.5" /> Tirar mais uma</button>}
                <button type="button" className="btn-outline h-9 text-xs" onClick={() => many.current?.click()}><Plus className="h-3.5 w-3.5" /> Adicionar mais fotos</button>
              </div>
            )}
            <label className="flex items-start gap-2 rounded-app-sm bg-muted/50 p-2">
              <input type="checkbox" className="mt-1" checked={pending.authorized} disabled={pending.sending} onChange={(e) => setPending({ ...pending, authorized: e.target.checked })} />
              <span>O cliente autorizou o registro {pending.files.length === 1 ? 'desta foto/documento' : `destas ${pending.files.length} fotos/documentos`} para fins do atendimento.</span>
            </label>
          </div>
        </Modal>
      )}
      {view && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-black/85 p-4 animate-fade" onClick={() => setView(null)} role="dialog" aria-label="Foto ampliada"
          onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
          onTouchEnd={(e) => { const dx = e.changedTouches[0].clientX - (touchX.current ?? 0); if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1); }}>
          <button className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white" aria-label="Fechar"><X className="h-5 w-5" /></button>
          {view.src ? <img src={view.src} alt={view.caption || ''} className="max-h-[80vh] max-w-full rounded-app-sm" onClick={(e) => e.stopPropagation()} /> : <Spinner className="h-8 w-8" />}
          {images.length > 1 && viewIdx >= 0 && (
            <>
              <button className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/15 p-3 text-white" aria-label="Foto anterior" onClick={(e) => { e.stopPropagation(); step(-1); }}><ChevronLeft className="h-6 w-6" /></button>
              <button className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-white/15 p-3 text-white" aria-label="Próxima foto" onClick={(e) => { e.stopPropagation(); step(1); }}><ChevronRight className="h-6 w-6" /></button>
            </>
          )}
          <div className="absolute bottom-4 px-4 text-center text-xs text-white/85">
            {images.length > 1 && viewIdx >= 0 && <b>{viewIdx + 1} de {images.length} · </b>}{view.caption || view.filename} · {fmt(view.created_at)}
          </div>
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
