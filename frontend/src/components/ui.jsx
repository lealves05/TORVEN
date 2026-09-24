import { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, Inbox } from 'lucide-react';
import { useUI } from '../context/UIContext';

export const cx = (...c) => c.filter(Boolean).join(' ');

export function Field({ label, hint, children, className }) {
  return (
    <label className={cx('block', className)}>
      {label && <span className="label">{label}</span>}
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-faint">{hint}</span>}
    </label>
  );
}

// evita alternar entre campo controlado/não controlado quando o valor ainda não carregou
const ctl = (p) => ('value' in p ? { ...p, value: p.value ?? '' } : p);

export const Input = ({ label, hint, className, ...p }) => (
  <Field label={label} hint={hint} className={className}><input className="input" {...ctl(p)} /></Field>
);

export const Textarea = ({ label, hint, className, rows = 3, ...p }) => (
  <Field label={label} hint={hint} className={className}><textarea className="input" rows={rows} {...ctl(p)} /></Field>
);

export const Select = ({ label, hint, className, children, ...p }) => (
  <Field label={label} hint={hint} className={className}><select className="input pr-8" {...p}>{children}</select></Field>
);

/** Campo monetário que aceita vírgula. */
export function MoneyInput({ label, value, onChange, className, ...p }) {
  const [text, setText] = useState(value === '' || value == null ? '' : String(value).replace('.', ','));
  useEffect(() => {
    const cur = parseFloat(text.replace(/\./g, '').replace(',', '.'));
    if (Number(value) !== cur) setText(value === '' || value == null ? '' : String(value).replace('.', ','));
  }, [value]); // eslint-disable-line
  return (
    <Field label={label} className={className}>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-ink-faint">R$</span>
        <input className="input pl-9 tabular-nums" inputMode="decimal" value={text} {...p}
          onChange={(e) => {
            const t = e.target.value.replace(/[^\d,.]/g, '');
            setText(t);
            const n = parseFloat(t.replace(/\./g, '').replace(',', '.'));
            onChange(Number.isFinite(n) ? n : 0);
          }} />
      </div>
    </Field>
  );
}

export function Toggle({ checked, onChange, label, hint }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-1">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs text-ink-faint">{hint}</span>}
      </span>
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className={cx('relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition', checked ? 'bg-primary' : 'bg-line')}>
        <span className={cx('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition', checked ? 'left-[22px]' : 'left-0.5')} />
      </button>
    </label>
  );
}

export function Modal({ open, onClose, title, subtitle, children, footer, size = 'md' }) {
  useEffect(() => {
    if (!open) return;
    const h = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  const w = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' }[size];
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4 animate-fade" onMouseDown={onClose}>
      <div className={cx('card animate-pop flex max-h-[94vh] w-full flex-col rounded-b-none sm:rounded-b-app', w)}
        onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-base font-semibold">{title}</h2>
            {subtitle && <p className="text-xs text-ink-faint mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="btn-ghost btn-icon -mr-2 -mt-1" aria-label="Fechar"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export const Spinner = ({ className = 'h-5 w-5' }) => <Loader2 className={cx('animate-spin text-ink-faint', className)} />;

export const Loading = () => <div className="grid place-items-center py-20"><Spinner className="h-6 w-6" /></div>;

export function Empty({ icon: Icon = Inbox, title, text, action }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 grid h-12 w-12 place-items-center rounded-full bg-muted text-ink-faint"><Icon className="h-5 w-5" /></div>
      <p className="font-medium">{title}</p>
      {text && <p className="mt-1 max-w-sm text-sm text-ink-faint">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-ink-faint">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="mb-5 flex gap-1 overflow-x-auto rounded-app-sm bg-muted p-1 w-fit max-w-full">
      {tabs.map((t) => (
        <button key={t.value} onClick={() => onChange(t.value)}
          className={cx('whitespace-nowrap rounded-[calc(var(--radius)*0.45)] px-3 py-1.5 text-sm font-medium transition',
            value === t.value ? 'bg-surface text-ink shadow-soft' : 'text-ink-soft hover:text-ink')}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Stat({ label, value, hint, icon: Icon, tone }) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-ink-faint">{label}</span>
        {Icon && <Icon className={cx('h-4 w-4', tone || 'text-ink-faint')} />}
      </div>
      <div className="mt-2 text-xl font-semibold tabular-nums tracking-tight">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-ink-faint">{hint}</div>}
    </div>
  );
}

export function Avatar({ name, color, size = 'h-8 w-8', src }) {
  if (src) return <img src={src} alt="" className={cx(size, 'rounded-full object-cover')} />;
  const ini = (name || '?').split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
  return (
    <span className={cx(size, 'inline-grid shrink-0 place-items-center rounded-full text-[11px] font-semibold text-white')}
      style={{ background: color || 'rgb(var(--primary))' }}>{ini}</span>
  );
}

/** Carrega dados com estado de loading/erro e toast automático. */
export function useFetch(fn, deps = []) {
  const { toast } = useUI();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    setLoading(true);
    try { setData(await fn()); } catch (e) { toast(e.message, 'error'); } finally { setLoading(false); }
  }, deps); // eslint-disable-line
  useEffect(() => { reload(); }, [reload]);
  return { data, setData, loading, reload };
}

export const FAIL = Symbol('fail');

/**
 * Executa ação assíncrona com toast. Retorna o resultado ou FAIL.
 * onError(e) pode retornar true para suprimir o toast de erro.
 */
export function useAction() {
  const { toast } = useUI();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn, success, onError) => {
    setBusy(true);
    try {
      const r = await fn();
      if (success) toast(success);
      return r;
    } catch (e) {
      const handled = onError ? await onError(e) : false;
      if (!handled) toast(e.message, 'error');
      return FAIL;
    } finally { setBusy(false); }
  }, [toast]);
  return [run, busy];
}
