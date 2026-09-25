// Busca global (Ctrl+K), central de notificações e atalhos de teclado.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, Bell, Users, ClipboardList, FileText, Inbox, Package, Wrench, CornerDownLeft, AlertTriangle, Info, CheckCircle2, XCircle,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { cx, Spinner } from './ui';
import { ORDER_STATUS, QUOTE_STATUS, REQUEST_STATUS } from '../lib/format';

const openSearch = () => window.dispatchEvent(new Event('torven:search'));
const isTyping = (e) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target?.tagName) || e.target?.isContentEditable;

/** Atalhos: Ctrl/⌘+K busca · Alt+S solicitação · Alt+O OS · Alt+Q orçamento · "/" busca. */
export function useShortcuts() {
  const nav = useNavigate();
  const { can } = useAuth();
  useEffect(() => {
    const h = (e) => {
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'k') { e.preventDefault(); openSearch(); return; }
      if (k === '/' && !isTyping(e) && !e.ctrlKey && !e.metaKey) { e.preventDefault(); openSearch(); return; }
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        const code = e.code;
        if (code === 'KeyS' && can('requests_manage')) { e.preventDefault(); nav('/solicitacoes/nova'); }
        else if (code === 'KeyO' && can('orders_create')) { e.preventDefault(); nav('/os/nova'); }
        else if (code === 'KeyQ' && can('quotes')) { e.preventDefault(); nav('/orcamentos/novo'); }
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [nav, can]);
}

export function SearchButton({ light }) {
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <button onClick={openSearch} aria-label="Buscar"
      className={cx('flex h-9 items-center gap-2 rounded-app-sm border px-2.5 text-sm transition',
        light ? 'border-primary-fg/25 text-primary-fg/85 hover:bg-primary-fg/10' : 'border-line text-ink-faint hover:border-ink-faint/40 hover:text-ink')}>
      <Search className="h-4 w-4" />
      <span className="hidden md:inline">Buscar…</span>
      <kbd className={cx('hidden rounded px-1 text-[10px] md:inline', light ? 'bg-primary-fg/15' : 'bg-muted')}>{mac ? '⌘' : 'Ctrl'} K</kbd>
    </button>
  );
}

const TYPE = {
  order: { icon: ClipboardList, label: 'OS', status: ORDER_STATUS },
  request: { icon: Inbox, label: 'Solicitação', status: REQUEST_STATUS },
  quote: { icon: FileText, label: 'Orçamento', status: QUOTE_STATUS },
  customer: { icon: Users, label: 'Cliente' },
  equipment: { icon: Wrench, label: 'Objeto' },
  product: { icon: Package, label: 'Material' },
};

export function GlobalSearch() {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState(0);
  const input = useRef(null);
  const seq = useRef(0);

  useEffect(() => {
    const h = () => { setOpen(true); setTimeout(() => input.current?.focus(), 30); };
    window.addEventListener('torven:search', h);
    return () => window.removeEventListener('torven:search', h);
  }, []);

  useEffect(() => {
    const t = term.trim();
    if (t.length < 2) { setResults([]); return undefined; }
    const my = ++seq.current;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const r = await api.get(`/search?q=${encodeURIComponent(t)}`);
        if (my === seq.current) { setResults(r); setSel(0); }
      } catch { if (my === seq.current) setResults([]); } finally { if (my === seq.current) setLoading(false); }
    }, 220);
    return () => clearTimeout(timer);
  }, [term]);

  const close = useCallback(() => { setOpen(false); setTerm(''); setResults([]); }, []);
  const go = (r) => { if (!r) return; close(); nav(r.link); };

  if (!open) return null;
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); go(results[sel]); }
  };
  return (
    <div className="fixed inset-0 z-[75] bg-black/40 p-3 pt-[10vh] animate-fade sm:p-6 sm:pt-[12vh]" onClick={close}>
      <div className="card animate-pop mx-auto w-full max-w-xl overflow-hidden" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Busca global">
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search className="h-4 w-4 shrink-0 text-ink-faint" />
          <input ref={input} value={term} onChange={(e) => setTerm(e.target.value)} onKeyDown={onKey}
            placeholder="Buscar OS, orçamento, solicitação, cliente, objeto ou material…"
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-ink-faint" />
          {loading && <Spinner className="h-4 w-4" />}
          <kbd className="hidden rounded bg-muted px-1.5 text-[10px] text-ink-faint sm:inline">Esc</kbd>
        </div>
        <div className="max-h-[55vh] overflow-y-auto p-1.5">
          {term.trim().length < 2 ? (
            <div className="px-3 py-6 text-center text-sm text-ink-faint">Digite ao menos 2 letras ou o número do documento.</div>
          ) : !results.length && !loading ? (
            <div className="px-3 py-6 text-center text-sm text-ink-faint">Nada encontrado para “{term}”.</div>
          ) : results.map((r, i) => {
            const T = TYPE[r.type] || TYPE.customer;
            const st = r.status && T.status?.[r.status];
            return (
              <button key={`${r.type}-${r.id}`} onMouseEnter={() => setSel(i)} onClick={() => go(r)}
                className={cx('flex w-full items-center gap-3 rounded-app-sm px-3 py-2.5 text-left', i === sel ? 'bg-primary/10' : 'hover:bg-muted')}>
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-app-sm bg-muted text-ink-soft"><T.icon className="h-4 w-4" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{r.title}</span>
                  <span className="block truncate text-xs text-ink-faint">{T.label}{r.subtitle ? ` · ${r.subtitle}` : ''}</span>
                </span>
                {st && <span className={cx('chip hidden sm:inline-flex', st.cls)}>{st.label}</span>}
                {i === sel && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-ink-faint" />}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line px-4 py-2 text-[11px] text-ink-faint">
          <span>↑↓ navegar · Enter abrir</span>
          <span>Alt+S solicitação · Alt+O OS · Alt+Q orçamento</span>
        </div>
      </div>
    </div>
  );
}

const LEVEL = {
  danger: { icon: XCircle, cls: 'text-red-600' },
  warning: { icon: AlertTriangle, cls: 'text-amber-600' },
  info: { icon: Info, cls: 'text-sky-600' },
  success: { icon: CheckCircle2, cls: 'text-emerald-600' },
};

export function Notifications({ light }) {
  const nav = useNavigate();
  const [data, setData] = useState({ items: [], total: 0 });
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const load = useCallback(() => api.get('/notifications').then(setData).catch(() => {}), []);
  useEffect(() => {
    load();
    const t = setInterval(load, 120000);
    const h = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => { clearInterval(t); document.removeEventListener('mousedown', h); };
  }, [load]);
  const n = data.items.length;
  return (
    <div ref={ref} className="relative">
      <button onClick={() => { setOpen((o) => !o); if (!open) load(); }} aria-label={`Notificações${n ? ` (${n})` : ''}`}
        className={cx('relative grid h-9 w-9 place-items-center rounded-app-sm transition', light ? 'hover:bg-primary-fg/10' : 'text-ink-soft hover:bg-muted hover:text-ink')}>
        <Bell className="h-[18px] w-[18px]" />
        {n > 0 && <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">{n}</span>}
      </button>
      {open && (
        <div className="card animate-pop absolute right-0 top-full z-50 mt-2 w-[min(92vw,340px)] p-1.5 text-sm text-ink">
          <div className="px-3 pb-1.5 pt-1 text-xs font-semibold uppercase tracking-wider text-ink-faint">Alertas</div>
          {!n ? <div className="px-3 py-6 text-center text-ink-faint">Tudo em dia por aqui.</div> : data.items.map((x) => {
            const L = LEVEL[x.level] || LEVEL.info;
            return (
              <button key={x.id} onClick={() => { setOpen(false); nav(x.link); }} className="flex w-full items-start gap-3 rounded-app-sm px-3 py-2.5 text-left hover:bg-muted">
                <L.icon className={cx('mt-0.5 h-4 w-4 shrink-0', L.cls)} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2"><span className="font-medium">{x.title}</span><b className="tabular-nums">{x.count}</b></span>
                  <span className="block text-xs text-ink-faint">{x.detail}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
