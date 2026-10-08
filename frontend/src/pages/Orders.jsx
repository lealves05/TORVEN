import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Search, LayoutGrid, List, Clock, Download, ClipboardList, ShoppingCart, MapPin, ChevronRight, PackageCheck, Printer, FileText } from 'lucide-react';
import { api, qs, appPath } from '../lib/api';
import { money, fmt, ORDER_STATUS, OPEN_STATUSES, PRIORITY, NEXT_STEP, STATUS_HINT, orderNo, downloadCSV } from '../lib/format';
import { useAuth, useSettings } from '../context/AuthContext';
import { useCatalog } from '../context/CatalogContext';
import { PageHeader, Loading, Empty, Hint, Stat, useAction, FAIL, cx } from '../components/ui';
import { PeriodPicker, monthRange } from '../components/period';
import { StatusBadge } from '../components/StatusBadge';

export default function Orders() {
  const [params, setParams] = useSearchParams();
  const view = params.get('view') || 'quadro';
  const { can } = useAuth();
  const settings = useSettings();
  const { technicians } = useCatalog();
  const [f, setF] = useState({
    search: '', technician_id: '', kind: params.get('kind') || '',
    status: params.get('status') || (view === 'quadro' ? 'abertas' : ''), overdue: params.get('overdue') || '',
  });
  const [list, setList] = useState(null);
  const [run] = useAction();

  const load = useCallback(() => {
    if (view === 'entregues') return Promise.resolve();
    const query = view === 'quadro' ? { ...f, status: 'abertas', kind: 'os', overdue: '' } : f;
    return api.get(`/orders${qs(query)}`).then(setList);
  }, [f, view]);
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);

  const setView = (v) => { const p = new URLSearchParams(params); p.set('view', v); setParams(p); };

  const move = async (o, status) => {
    if (o.status === status) return;
    setList((l) => l.map((x) => (x.id === o.id ? { ...x, status } : x)));
    const r = await run(() => api.post(`/orders/${o.id}/status`, { status }), `${orderNo(settings, o)}: ${ORDER_STATUS[status].label}`);
    if (r === FAIL) load();
  };

  return (
    <div>
      <PageHeader title="Ordens de serviço" subtitle="Acompanhe cada serviço do recebimento à entrega"
        actions={<>
          <div className="flex rounded-app-sm bg-muted p-1">
            {[['quadro', 'Quadro', LayoutGrid], ['lista', 'Lista', List], ['entregues', 'Entregues', PackageCheck]].map(([k, l, I]) => (
              <button key={k} onClick={() => setView(k)} className={cx('flex items-center gap-1.5 rounded-[calc(var(--radius)*0.45)] px-3 py-1.5 text-sm font-medium', view === k ? 'bg-surface shadow-soft' : 'text-ink-soft')}>
                <I className="h-4 w-4" />{l}
              </button>
            ))}
          </div>
          {can('orders_create') && <Link to="/os/nova" className="btn-primary"><Plus className="h-4 w-4" /> Nova OS</Link>}
        </>} />

      {view === 'entregues' ? <Delivered /> : (<>
      <div className="card mb-4 flex flex-wrap items-end gap-3 p-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <input className="input pl-9" placeholder="Nº da OS, cliente, placa, equipamento ou nº de série…" aria-label="Buscar OS" value={f.search} onChange={(e) => setF({ ...f, search: e.target.value })} />
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
      </>)}
    </div>
  );
}

/** Aba "Entregues": consulta das OS já entregues, por período, com impressão da OS completa. */
function Delivered() {
  const nav = useNavigate();
  const { can } = useAuth();
  const settings = useSettings();
  const { technicians } = useCatalog();
  const [period, setPeriod] = useState(monthRange());
  const [f, setF] = useState({ search: '', technician_id: '' });
  const [list, setList] = useState(null);
  const [shown, setShown] = useState(100);
  useEffect(() => {
    setList(null);
    const t = setTimeout(() => api.get(`/orders${qs({ status: 'entregue', kind: 'os', delivered_from: period.from, delivered_to: period.to, ...f, limit: 2000 })}`)
      .then(setList).catch(() => setList([])), 250);
    return () => clearTimeout(t);
  }, [period, f]);
  const values = can('orders_values');
  const total = (k) => (list || []).reduce((a, o) => a + (Number(o[k]) || 0), 0);
  return (
    <div className="space-y-4">
      <div className="card space-y-3 p-3">
        <PeriodPicker value={period} onChange={setPeriod} />
        <div className="flex flex-wrap items-end gap-3">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
            <input className="input pl-9" placeholder="Nº da OS, cliente, placa ou equipamento…" aria-label="Buscar OS entregue" value={f.search} onChange={(e) => setF({ ...f, search: e.target.value })} />
          </div>
          <select className="input w-44" value={f.technician_id} onChange={(e) => setF({ ...f, technician_id: e.target.value })} aria-label="Técnico">
            <option value="">Todos os técnicos</option>
            {technicians.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          {values && (
            <button className="btn-outline" disabled={!list?.length} title="Exportar CSV" onClick={() => downloadCSV('os-entregues.csv', list.map((o) => ({
              Numero: o.number, Cliente: o.customer_name, Equipamento: o.equipment_description, Placa: o.equipment_plate, Tecnico: o.technician_name,
              Entrada: fmt(o.received_at), Entrega: fmt(o.delivered_at), Total: o.total, Recebido: o.paid, AReceber: o.receivable,
            })))}><Download className="h-4 w-4" /> CSV</button>
          )}
        </div>
      </div>
      {list && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="OS entregues" value={list.length} icon={PackageCheck} />
          {values && <Stat label="Valor das OS" value={money(total('total'))} />}
          {values && <Stat label="Recebido" value={money(total('paid'))} />}
          {values && <Stat label="A receber" value={money(total('receivable'))} tone="text-amber-500" />}
        </div>
      )}
      {!list ? <Loading /> : !list.length ? (
        <div className="card"><Empty icon={PackageCheck} title="Nenhuma OS entregue no período" text="Mude o período ou a busca." /></div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-clean">
              <thead><tr><th>Nº</th><th>Cliente / veículo</th><th className="hidden lg:table-cell">Técnico</th><th>Entregue em</th>{values && <th className="text-right">Total</th>}<th /></tr></thead>
              <tbody>
                {list.slice(0, shown).map((o) => (
                  <tr key={o.id} className="cursor-pointer" onClick={() => nav(`/os/${o.id}`)}>
                    <td className="whitespace-nowrap font-medium tabular-nums">{orderNo(settings, o)}</td>
                    <td>
                      <div className="max-w-[280px] truncate">{o.customer_name || 'Consumidor'}</div>
                      <div className="max-w-[280px] truncate text-xs text-ink-faint">{[o.equipment_plate, o.equipment_description].filter(Boolean).join(' · ') || o.problem}</div>
                    </td>
                    <td className="hidden text-ink-soft lg:table-cell">{o.technician_name || '—'}</td>
                    <td className="whitespace-nowrap">{fmt(o.delivered_at, 'dd/MM/yy HH:mm')}</td>
                    {values && (
                      <td className="whitespace-nowrap text-right tabular-nums">
                        <div className="font-medium">{money(o.total)}</div>
                        {o.balance > 0.009 && <div className="text-xs text-amber-600">falta {money(o.balance)}</div>}
                      </td>
                    )}
                    <td className="whitespace-nowrap text-right" onClick={(e) => e.stopPropagation()}>
                      <a className="btn-outline h-8 px-2 text-xs" href={appPath(`/imprimir/os/${o.id}/completa`)} target="_blank" rel="noreferrer" title="Imprimir a OS completa, com materiais, horas e checklists">
                        <FileText className="h-3.5 w-3.5" /> OS completa
                      </a>
                      <a className="btn-ghost btn-icon h-8" href={appPath(`/imprimir/os/${o.id}`)} target="_blank" rel="noreferrer" title="Imprimir a OS (modelo resumido)" aria-label="Imprimir OS resumida"><Printer className="h-4 w-4" /></a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {list.length > shown && (
            <div className="border-t border-line p-3 text-center"><button className="btn-outline h-9 text-sm" onClick={() => setShown(shown + 200)}>Mostrar mais ({list.length - shown} restantes)</button></div>
          )}
        </div>
      )}
    </div>
  );
}

function OrderCard({ o, draggable, onMove }) {
  const settings = useSettings();
  const late = o.promised_at && o.status !== 'pronta' && new Date(o.promised_at) < new Date();
  const next = NEXT_STEP[o.status];
  return (
    <div draggable={draggable} onDragStart={(e) => e.dataTransfer.setData('text/plain', o.id)}
      className="card group relative select-none p-3 transition focus-within:border-primary/60 hover:border-primary/40">
      <div className="flex items-center gap-2 text-xs">
        <span className="whitespace-nowrap font-semibold tabular-nums">{orderNo(settings, o)}</span>
        {o.priority !== 'normal' && <span className={PRIORITY[o.priority].cls}>{PRIORITY[o.priority].label}</span>}
        {o.service_location === 'externo' && <MapPin className="h-3.5 w-3.5 text-ink-faint" aria-label="Serviço externo" />}
        {o.technician_name && <span className="ml-auto flex items-center gap-1 truncate text-ink-faint"><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: o.technician_color }} />{o.technician_name.split(' ')[0]}</span>}
      </div>
      {/* link "esticado": o cartão inteiro abre a OS e funciona com teclado e leitor de tela */}
      <Link to={`/os/${o.id}`} draggable={false} className="mt-1.5 block truncate text-sm font-medium outline-none after:absolute after:inset-0 after:rounded-app after:content-[''] focus-visible:underline">
        {o.customer_name || 'Sem cliente'}
      </Link>
      <div className="truncate text-xs text-ink-faint">{[o.equipment_description, o.equipment_brand].filter(Boolean).join(' · ') || o.problem || '—'}</div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-xs">
        <span className={cx('flex items-center gap-1', late ? 'font-medium text-red-600' : 'text-ink-faint')}>
          <Clock className="h-3.5 w-3.5 shrink-0" /><span className="whitespace-nowrap">{o.promised_at ? fmt(o.promised_at, 'dd/MM HH:mm') : 'sem prazo'}</span>
        </span>
        {o.total != null && <span className={cx('whitespace-nowrap tabular-nums', Number(o.total) > 0 ? 'font-medium' : 'text-ink-faint')}>{Number(o.total) > 0 ? money(o.total) : 'sem valor'}</span>}
      </div>
      {onMove && (
        <div className="relative z-10 mt-2.5 space-y-1 border-t border-line/70 pt-2.5">
          {next && (
            <button type="button" onClick={() => onMove(o, next.to)} className="btn-outline h-9 w-full min-w-0 px-2 text-xs" title={`Mover para "${ORDER_STATUS[next.to].label}"`}>
              <span className="truncate">{next.label}</span> <ChevronRight className="h-3.5 w-3.5 shrink-0" />
            </button>
          )}
          <select value="" onChange={(e) => e.target.value && onMove(o, e.target.value)} aria-label={`Mover ${orderNo(settings, o)} para outra etapa`}
            className="h-8 w-full cursor-pointer rounded-app-sm bg-transparent px-1 text-xs text-ink-soft outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary/30">
            <option value="">Mover para…</option>
            {OPEN_STATUSES.filter((s) => s !== o.status).map((s) => <option key={s} value={s}>{ORDER_STATUS[s].label}</option>)}
          </select>
        </div>
      )}
    </div>
  );
}

function Board({ list, onMove, canMove }) {
  const [over, setOver] = useState(null);
  const [params, setParams] = useSearchParams();
  const counts = Object.fromEntries(OPEN_STATUSES.map((s) => [s, list.filter((o) => o.status === s).length]));
  const firstFull = OPEN_STATUSES.find((s) => counts[s]) || OPEN_STATUSES[0];
  const tab = OPEN_STATUSES.includes(params.get('etapa')) ? params.get('etapa') : firstFull;
  const setTab = (s) => { const p = new URLSearchParams(params); p.set('etapa', s); setParams(p, { replace: true }); };
  const tabRef = useRef(null);
  useEffect(() => { tabRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center' }); }, [tab]);
  const drop = (s) => ({
    onDragOver: (e) => { if (canMove) { e.preventDefault(); setOver(s); } },
    onDragLeave: () => setOver(null),
    onDrop: (e) => { e.preventDefault(); setOver(null); const o = list.find((x) => x.id === e.dataTransfer.getData('text/plain')); if (o) onMove(o, s); },
  });
  return (
    <>
      {/* celular: uma etapa por vez, com abas e contadores */}
      <div className="md:hidden">
        <div ref={tabRef} role="tablist" aria-label="Etapas" className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1">
          {OPEN_STATUSES.map((s) => (
            <button key={s} role="tab" aria-selected={tab === s} onClick={() => setTab(s)}
              className={cx('flex h-11 shrink-0 items-center gap-2 rounded-full border px-3.5 text-sm font-medium', tab === s ? 'border-primary bg-primary/10 text-primary' : 'border-line bg-surface text-ink-soft')}>
              <span className={cx('h-2 w-2 rounded-full', ORDER_STATUS[s].dot)} />{ORDER_STATUS[s].label}
              <span className={cx('rounded-full px-1.5 text-xs tabular-nums', counts[s] ? 'bg-ink/10 text-ink' : 'text-ink-faint')}>{counts[s]}</span>
            </button>
          ))}
        </div>
        <p className="mb-3 text-xs text-ink-faint">{STATUS_HINT[tab]}</p>
        <div className="flex flex-col gap-2.5">
          {list.filter((o) => o.status === tab).map((o) => <OrderCard key={o.id} o={o} onMove={canMove ? onMove : null} />)}
          {!counts[tab] && <div className="card"><Empty icon={ClipboardList} title={`Nenhuma OS em "${ORDER_STATUS[tab].label}"`} text="Toque em outra etapa acima para ver as demais." /></div>}
        </div>
      </div>

      {/* computador/tablet: quadro com todas as etapas; colunas vazias ficam estreitas para caber tudo na tela */}
      <div className="hidden gap-2 overflow-x-auto pb-2 md:flex">
        {OPEN_STATUSES.map((s) => {
          const items = list.filter((o) => o.status === s);
          const empty = !items.length;
          return (
            <div key={s} {...drop(s)} title={empty ? `${ORDER_STATUS[s].label}: nenhuma OS` : undefined}
              className={cx('flex flex-col rounded-app bg-muted/60 p-2 transition', empty ? 'w-12 shrink-0 items-center' : 'min-w-[200px] max-w-[320px] flex-1', over === s && 'ring-2 ring-primary/40')}>
              {empty ? (
                <div className="flex flex-col items-center gap-2 pt-1 text-xs font-medium text-ink-soft">
                  <span className="rounded-full bg-surface px-2 tabular-nums">0</span>
                  <span className={cx('h-2 w-2 rounded-full', ORDER_STATUS[s].dot)} />
                  <span className="whitespace-nowrap [writing-mode:vertical-rl]">{ORDER_STATUS[s].label}</span>
                </div>
              ) : (
                <>
                  <div className="flex items-start gap-2 px-1.5 pb-2 pt-1 text-sm font-medium [&>span:first-child]:mt-1.5">
                    <span className={cx('h-2 w-2 shrink-0 rounded-full', ORDER_STATUS[s].dot)} /><span className="leading-tight">{ORDER_STATUS[s].label}</span>
                    <Hint text={STATUS_HINT[s]} className="shrink-0" />
                    <span className="ml-auto rounded-full bg-surface px-2 text-xs tabular-nums text-ink-soft">{items.length}</span>
                  </div>
                  <div className="flex min-h-[120px] flex-col gap-2">
                    {items.map((o) => <OrderCard key={o.id} o={o} draggable={canMove} onMove={canMove ? onMove : null} />)}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
      {canMove && <p className="mt-3 hidden text-xs text-ink-faint md:block">Use o botão do cartão (ou arraste o cartão para outra coluna) para mudar a etapa. Entrega e cancelamento são feitos dentro da OS.</p>}
    </>
  );
}

export function OrdersTable({ list, compact }) {
  const nav = useNavigate();
  const settings = useSettings();
  const [shown, setShown] = useState(150); // desenha aos poucos: listas grandes ficam leves no celular
  if (!list.length) return <div className="card"><Empty icon={ClipboardList} title="Nenhuma OS encontrada" /></div>;
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="table-clean">
          <thead><tr><th>Nº</th><th>Cliente / equipamento</th>{!compact && <th className="hidden lg:table-cell">Técnico</th>}<th>Situação</th><th className="hidden md:table-cell">Entrada</th><th className="hidden md:table-cell">Prazo</th><th className="text-right">Total</th></tr></thead>
          <tbody>
            {list.slice(0, shown).map((o) => {
              const late = o.promised_at && !['entregue', 'cancelada'].includes(o.status) && new Date(o.promised_at) < new Date();
              return (
                <tr key={o.id} className={cx('cursor-pointer', o.status === 'cancelada' && 'opacity-60')} onClick={() => nav(`/os/${o.id}`)}>
                  <td className="whitespace-nowrap font-medium tabular-nums">
                    {o.kind === 'venda' && <ShoppingCart className="mr-1 inline h-3.5 w-3.5 text-ink-faint" />}<Link to={`/os/${o.id}`} onClick={(e) => e.stopPropagation()} className="hover:underline">{orderNo(settings, o)}</Link>
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
      {list.length > shown && (
        <div className="border-t border-line p-3 text-center">
          <button className="btn-outline h-9 text-sm" onClick={() => setShown(shown + 300)}>Mostrar mais ({list.length - shown} restantes)</button>
        </div>
      )}
    </div>
  );
}
