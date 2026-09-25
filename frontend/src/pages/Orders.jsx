import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Search, LayoutGrid, List, Clock, Download, ClipboardList, ShoppingCart, MapPin } from 'lucide-react';
import { api, qs } from '../lib/api';
import { money, fmt, ORDER_STATUS, OPEN_STATUSES, PRIORITY, downloadCSV } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import { useCatalog } from '../context/CatalogContext';
import { PageHeader, Loading, Empty, useAction, FAIL, cx } from '../components/ui';
import { StatusBadge } from './Dashboard';

export default function Orders() {
  const [params, setParams] = useSearchParams();
  const view = params.get('view') || 'quadro';
  const { can } = useAuth();
  const { technicians } = useCatalog();
  const [f, setF] = useState({
    search: '', technician_id: '', kind: params.get('kind') || '',
    status: params.get('status') || (view === 'quadro' ? 'abertas' : ''), overdue: params.get('overdue') || '',
  });
  const [list, setList] = useState(null);
  const [run] = useAction();

  const load = useCallback(() => {
    const query = view === 'quadro' ? { ...f, status: 'abertas', kind: 'os', overdue: '' } : f;
    return api.get(`/orders${qs(query)}`).then(setList);
  }, [f, view]);
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);

  const setView = (v) => { const p = new URLSearchParams(params); p.set('view', v); setParams(p); };

  const move = async (o, status) => {
    if (o.status === status) return;
    setList((l) => l.map((x) => (x.id === o.id ? { ...x, status } : x)));
    const r = await run(() => api.post(`/orders/${o.id}/status`, { status }), `OS #${o.number}: ${ORDER_STATUS[status].label}`);
    if (r === FAIL) load();
  };

  return (
    <div>
      <PageHeader title="Ordens de serviço" subtitle="Acompanhe cada serviço do recebimento à entrega"
        actions={<>
          <div className="flex rounded-app-sm bg-muted p-1">
            {[['quadro', 'Quadro', LayoutGrid], ['lista', 'Lista', List]].map(([k, l, I]) => (
              <button key={k} onClick={() => setView(k)} className={cx('flex items-center gap-1.5 rounded-[calc(var(--radius)*0.45)] px-3 py-1.5 text-sm font-medium', view === k ? 'bg-surface shadow-soft' : 'text-ink-soft')}>
                <I className="h-4 w-4" />{l}
              </button>
            ))}
          </div>
          {can('orders_create') && <Link to="/os/nova" className="btn-primary"><Plus className="h-4 w-4" /> Nova OS</Link>}
        </>} />

      <div className="card mb-4 flex flex-wrap items-end gap-3 p-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <input className="input pl-9" placeholder="Nº, cliente, equipamento, nº de série…" value={f.search} onChange={(e) => setF({ ...f, search: e.target.value })} />
        </div>
        <select className="input w-44" value={f.technician_id} onChange={(e) => setF({ ...f, technician_id: e.target.value })}>
          <option value="">Todos os técnicos</option>
          {technicians.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        {view === 'lista' && (
          <>
            <select className="input w-48" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
              <option value="">Todas as situações</option>
              <option value="abertas">Em aberto</option>
              {Object.entries(ORDER_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <select className="input w-36" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
              <option value="">OS e vendas</option><option value="os">Só OS</option><option value="venda">Só vendas</option>
            </select>
            <label className="flex h-[var(--row)] items-center gap-2 text-sm"><input type="checkbox" checked={!!f.overdue} onChange={(e) => setF({ ...f, overdue: e.target.checked ? '1' : '' })} /> Atrasadas</label>
            {can('orders_values') && (
              <button className="btn-outline" disabled={!list?.length} title="Exportar CSV" onClick={() => downloadCSV('ordens-de-servico.csv', list.map((o) => ({
                Numero: o.number, Tipo: o.kind === 'venda' ? 'Venda' : 'OS', Situacao: ORDER_STATUS[o.status].label, Cliente: o.customer_name,
                Equipamento: o.equipment_description, Tecnico: o.technician_name, Entrada: fmt(o.received_at), Prazo: fmt(o.promised_at),
                Entrega: fmt(o.delivered_at), Total: o.total, Recebido: o.paid, AReceber: o.receivable,
              })))}><Download className="h-4 w-4" /></button>
            )}
          </>
        )}
      </div>

      {!list ? <Loading /> : view === 'quadro' ? <Board list={list} onMove={move} canMove={can('orders_edit')} /> : <OrdersTable list={list} />}
    </div>
  );
}

function OrderCard({ o, draggable }) {
  const nav = useNavigate();
  const late = o.promised_at && new Date(o.promised_at) < new Date();
  return (
    <div draggable={draggable} onDragStart={(e) => e.dataTransfer.setData('text/plain', o.id)} onClick={() => nav(`/os/${o.id}`)}
      className="card cursor-pointer select-none p-3 transition hover:border-primary/40 active:scale-[.99]">
      <div className="flex items-center gap-2 text-xs">
        <span className="font-semibold tabular-nums">#{o.number}</span>
        {o.priority !== 'normal' && <span className={PRIORITY[o.priority].cls}>{PRIORITY[o.priority].label}</span>}
        {o.service_location === 'externo' && <MapPin className="h-3.5 w-3.5 text-ink-faint" title="Serviço externo" />}
        {o.technician_name && <span className="ml-auto flex items-center gap-1 truncate text-ink-faint"><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: o.technician_color }} />{o.technician_name.split(' ')[0]}</span>}
      </div>
      <div className="mt-1.5 truncate text-sm font-medium">{o.customer_name || 'Sem cliente'}</div>
      <div className="truncate text-xs text-ink-soft">{[o.equipment_description, o.equipment_brand].filter(Boolean).join(' · ') || o.problem || '—'}</div>
      <div className="mt-2 flex items-center justify-between text-xs">
        <span className={cx('flex items-center gap-1', late ? 'font-medium text-red-600' : 'text-ink-faint')}>
          <Clock className="h-3.5 w-3.5" />{o.promised_at ? fmt(o.promised_at, 'dd/MM HH:mm') : 'sem prazo'}
        </span>
        {o.total != null && <span className="font-medium tabular-nums">{money(o.total)}</span>}
      </div>
    </div>
  );
}

function Board({ list, onMove, canMove }) {
  const [over, setOver] = useState(null);
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-4 sm:mx-0 sm:px-0">
      <div className="flex min-w-max gap-3">
        {OPEN_STATUSES.map((s) => {
          const items = list.filter((o) => o.status === s);
          return (
            <div key={s} className={cx('flex w-[250px] shrink-0 flex-col rounded-app bg-muted/60 p-2 transition', over === s && 'ring-2 ring-primary/40')}
              onDragOver={(e) => { if (canMove) { e.preventDefault(); setOver(s); } }} onDragLeave={() => setOver(null)}
              onDrop={(e) => { e.preventDefault(); setOver(null); const o = list.find((x) => x.id === e.dataTransfer.getData('text/plain')); if (o) onMove(o, s); }}>
              <div className="flex items-center gap-2 px-1.5 pb-2 pt-1 text-sm font-medium">
                <span className={cx('h-2 w-2 rounded-full', ORDER_STATUS[s].dot)} />{ORDER_STATUS[s].label}
                <span className="ml-auto rounded-full bg-surface px-2 text-xs tabular-nums text-ink-soft">{items.length}</span>
              </div>
              <div className="flex min-h-[120px] flex-col gap-2">
                {items.map((o) => <OrderCard key={o.id} o={o} draggable={canMove} />)}
              </div>
            </div>
          );
        })}
      </div>
      {canMove && <p className="mt-3 text-xs text-ink-faint">Arraste os cartões entre as colunas para mudar a etapa. Entrega e cancelamento são feitos dentro da OS.</p>}
    </div>
  );
}

export function OrdersTable({ list, compact }) {
  const nav = useNavigate();
  if (!list.length) return <div className="card"><Empty icon={ClipboardList} title="Nenhuma OS encontrada" /></div>;
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="table-clean">
          <thead><tr><th>Nº</th><th>Cliente / equipamento</th>{!compact && <th className="hidden lg:table-cell">Técnico</th>}<th>Situação</th><th className="hidden md:table-cell">Entrada</th><th className="hidden md:table-cell">Prazo</th><th className="text-right">Total</th></tr></thead>
          <tbody>
            {list.map((o) => {
              const late = o.promised_at && !['entregue', 'cancelada'].includes(o.status) && new Date(o.promised_at) < new Date();
              return (
                <tr key={o.id} className={cx('cursor-pointer', o.status === 'cancelada' && 'opacity-60')} onClick={() => nav(`/os/${o.id}`)}>
                  <td className="whitespace-nowrap font-medium tabular-nums">
                    {o.kind === 'venda' && <ShoppingCart className="mr-1 inline h-3.5 w-3.5 text-ink-faint" />}#{o.number}
                  </td>
                  <td>
                    <div className="max-w-[280px] truncate">{o.customer_name || <span className="text-ink-faint">Consumidor</span>}</div>
                    <div className="max-w-[280px] truncate text-xs text-ink-faint">{o.kind === 'venda' ? 'Venda de balcão' : o.equipment_description || o.problem}</div>
                  </td>
                  {!compact && <td className="hidden text-ink-soft lg:table-cell">{o.technician_name || '—'}</td>}
                  <td><StatusBadge status={o.status} /></td>
                  <td className="hidden whitespace-nowrap text-ink-soft md:table-cell">{fmt(o.received_at, 'dd/MM/yy')}</td>
                  <td className={cx('hidden whitespace-nowrap md:table-cell', late ? 'font-medium text-red-600' : 'text-ink-soft')}>{o.delivered_at ? `entregue ${fmt(o.delivered_at, 'dd/MM')}` : o.promised_at ? fmt(o.promised_at, 'dd/MM HH:mm') : '—'}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">
                    {o.total != null ? <>
                      <div className="font-medium">{money(o.total)}</div>
                      {o.balance > 0.009 && o.status !== 'cancelada' && <div className="text-xs text-amber-600">falta {money(o.balance)}</div>}
                    </> : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
