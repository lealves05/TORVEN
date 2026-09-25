// Garantias: chamados de clientes sobre serviços entregues, análise e retrabalho.
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, ShieldAlert, Wrench } from 'lucide-react';
import { api, qs } from '../lib/api';
import { fmt, fmtDateTime, docNumber } from '../lib/format';
import { useAuth, useSettings } from '../context/AuthContext';
import { PageHeader, Textarea, Loading, Empty, Modal, useAction, FAIL, cx } from '../components/ui';
import { useTable, SortTh, Pager } from '../components/Table';
import Attachments from '../components/Attachments';

export const WARRANTY_STATUS = {
  aberta: { label: 'Aberta', cls: 'bg-sky-500/10 text-sky-700 dark:text-sky-300' },
  em_analise: { label: 'Em análise', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
  procedente: { label: 'Procedente', cls: 'bg-violet-500/10 text-violet-700 dark:text-violet-300' },
  improcedente: { label: 'Improcedente', cls: 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-300' },
  concluida: { label: 'Concluída', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
};
export const WarrantyBadge = ({ status }) => <span className={cx('chip whitespace-nowrap', WARRANTY_STATUS[status]?.cls)}>{WARRANTY_STATUS[status]?.label}</span>;

export default function Warranty() {
  const settings = useSettings();
  const [f, setF] = useState({ search: '', status: 'abertas' });
  const [list, setList] = useState(null);
  const [view, setView] = useState(null);
  const load = useCallback(() => api.get(`/warranty${qs(f)}`).then(setList).catch(() => setList([])), [f]);
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);
  const t = useTable(list, { get: { customer: (w) => w.customer_name } });
  return (
    <div>
      <PageHeader title="Garantias" subtitle="Abertas a partir da OS entregue; retrabalho procedente vira uma OS sem custo ao cliente" />
      <div className="card mb-4 flex flex-wrap items-end gap-3 p-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <input className="input pl-9" placeholder="Nº, OS ou cliente…" value={f.search} onChange={(e) => setF({ ...f, search: e.target.value })} />
        </div>
        <select className="input w-48" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} aria-label="Situação">
          <option value="abertas">Em andamento</option><option value="">Todas</option>
          {Object.entries(WARRANTY_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>
      <div className="card overflow-hidden">
        {!list ? <Loading /> : !list.length ? <Empty icon={ShieldAlert} title="Nenhuma garantia" text="Para abrir, vá à OS entregue e use “Abrir garantia”." /> : (
          <>
            <div className="overflow-x-auto">
              <table className="table-clean">
                <thead><tr><SortTh t={t} k="number">Nº</SortTh><SortTh t={t} k="customer">Cliente / relato</SortTh><SortTh t={t} k="order_number" className="hidden md:table-cell">OS</SortTh><SortTh t={t} k="opened_at" className="hidden md:table-cell">Abertura</SortTh><SortTh t={t} k="status">Situação</SortTh></tr></thead>
                <tbody>
                  {t.rows.map((w) => (
                    <tr key={w.id} className="cursor-pointer" onClick={() => setView(w)}>
                      <td className="font-medium tabular-nums">G-{String(w.number).padStart(4, '0')}</td>
                      <td><div className="max-w-[320px] truncate">{w.customer_name}</div><div className="max-w-[320px] truncate text-xs text-ink-faint">{w.description}</div></td>
                      <td className="hidden md:table-cell">{docNumber(settings, 'order', w.order_number)}</td>
                      <td className="hidden whitespace-nowrap text-ink-soft md:table-cell">{fmt(w.opened_at, 'dd/MM/yy')}</td>
                      <td><WarrantyBadge status={w.status} />{!w.within_warranty && <div className="mt-0.5 text-xs text-amber-600">fora do prazo</div>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager t={t} />
          </>
        )}
      </div>
      {view && <WarrantyModal claim={view} onClose={() => setView(null)} onChanged={(w) => { setView(w); load(); }} />}
    </div>
  );
}

export function WarrantyModal({ claim, onClose, onChanged }) {
  const settings = useSettings();
  const { can } = useAuth();
  const nav = useNavigate();
  const [run, busy] = useAction();
  const [w, setW] = useState(claim);
  const [analysis, setAnalysis] = useState(claim.analysis || '');
  const [resolution, setResolution] = useState(claim.resolution || '');
  useEffect(() => { api.get(`/warranty/${claim.id}`).then((x) => { setW(x); setAnalysis(x.analysis || ''); setResolution(x.resolution || ''); }).catch(() => {}); }, [claim.id]);
  const manage = can('warranty_manage');
  const status = async (s) => {
    const r = await run(() => api.post(`/warranty/${w.id}/status`, { status: s, analysis: analysis || null, resolution: resolution || null }), WARRANTY_STATUS[s].label);
    if (r !== FAIL) { setW(r); onChanged?.(r); }
  };
  const rework = async () => {
    const r = await run(() => api.post(`/warranty/${w.id}/rework`), 'OS de retrabalho aberta');
    if (r !== FAIL) nav(`/os/${r.order_id}`);
  };
  const NEXT = { aberta: ['em_analise', 'procedente', 'improcedente'], em_analise: ['procedente', 'improcedente'], procedente: ['concluida'], improcedente: ['concluida', 'em_analise'], concluida: [] };
  return (
    <Modal open onClose={onClose} size="lg" title={`Garantia G-${String(w.number).padStart(4, '0')}`} subtitle={`${w.customer_name || ''} · aberta ${fmtDateTime(w.opened_at)}${w.opened_by_name ? ` por ${w.opened_by_name}` : ''}`}>
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <WarrantyBadge status={w.status} />
          <span className={cx('chip', w.within_warranty ? 'bg-emerald-500/10 text-emerald-700' : 'bg-amber-500/15 text-amber-700')}>{w.within_warranty ? 'Dentro do prazo' : 'Fora do prazo'}</span>
          <Link to={`/os/${w.order_id}`} className="text-primary">{docNumber(settings, 'order', w.order_number)}</Link>
          {w.warranty_until && <span className="text-xs text-ink-faint">garantia até {fmt(w.warranty_until)}</span>}
        </div>
        <div><div className="label">Relato do cliente</div><p className="whitespace-pre-line">{w.description}</p></div>
        <Textarea label="Análise técnica" rows={3} value={analysis} onChange={(e) => setAnalysis(e.target.value)} disabled={!manage || w.status === 'concluida'} />
        <Textarea label="Solução dada ao cliente" rows={2} value={resolution} onChange={(e) => setResolution(e.target.value)} disabled={!manage || w.status === 'concluida'} />
        {w.rework_order_id && <Link to={`/os/${w.rework_order_id}`} className="flex items-center gap-1 text-primary"><Wrench className="h-4 w-4" /> Retrabalho: {docNumber(settings, 'order', w.rework_number)}</Link>}
        {manage && (
          <div className="flex flex-wrap gap-2 border-t border-line pt-3">
            {NEXT[w.status].map((s) => <button key={s} className={s === 'improcedente' ? 'btn-outline text-red-600' : 'btn-outline'} disabled={busy} onClick={() => status(s)}>{WARRANTY_STATUS[s].label}</button>)}
            {!w.rework_order_id && ['aberta', 'em_analise', 'procedente'].includes(w.status) && can('orders_create') && (
              <button className="btn-primary ml-auto" disabled={busy} onClick={rework}><Wrench className="h-4 w-4" /> Abrir OS de retrabalho</button>
            )}
          </div>
        )}
        <Attachments entity="warranty" entityId={w.id} canEdit={manage} compact title="Fotos e evidências" />
      </div>
    </Modal>
  );
}
