// Painel de produção: técnicos com cronômetro, fila de execução, agenda do dia e folha de horas.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Square, Timer, HardHat, ClipboardList, CalendarDays, Download, ShieldCheck } from 'lucide-react';
import { api, qs } from '../lib/api';
import { fmt, money, PRIORITY, docNumber, downloadCSV, ymd } from '../lib/format';
import { useAuth, useSettings } from '../context/AuthContext';
import { PageHeader, Tabs, Loading, Empty, Stat, useAction, FAIL, cx } from '../components/ui';
import { StatusBadge } from './Dashboard';
import { SCHEDULE_KIND } from './Agenda';

export const ACTIVITY = { diagnostico: 'Diagnóstico', execucao: 'Execução', retrabalho: 'Retrabalho', inspecao: 'Inspeção', deslocamento: 'Deslocamento', outro: 'Outro' };
export const hm = (min) => { const m = Math.round(Number(min) || 0); return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`; };

/** Tempo decorrido ao vivo desde "since". */
export function Elapsed({ since }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const s = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000));
  return <span className="tabular-nums">{String(Math.floor(s / 3600)).padStart(2, '0')}:{String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:{String(s % 60).padStart(2, '0')}</span>;
}

export default function Production() {
  const { can } = useAuth();
  const [tab, setTab] = useState('painel');
  return (
    <div>
      <PageHeader title="Produção" subtitle="Quem está trabalhando em quê, fila de execução e horas apontadas" />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'painel', label: 'Painel' }, ...(can('time_log', 'reports') ? [{ value: 'horas', label: 'Folha de horas' }] : [])]} />
      {tab === 'painel' ? <Board /> : <Timesheet />}
    </div>
  );
}

function Board() {
  const settings = useSettings();
  const { can } = useAuth();
  const [run] = useAction();
  const [data, setData] = useState(null);
  const load = useCallback(() => api.get('/production/board').then(setData).catch(() => setData({ technicians: [], queue: [], today: [] })), []);
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);
  if (!data) return <Loading />;
  const stop = async (t) => { if ((await run(() => api.post(`/production/time/${t.log_id}/stop`, {}), 'Apontamento encerrado')) !== FAIL) load(); };
  const busyN = data.technicians.filter((t) => t.log_id).length;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Técnicos trabalhando agora" value={`${busyN}/${data.technicians.length}`} icon={HardHat} />
        <Stat label="OS na fila" value={data.queue.length} icon={ClipboardList} />
        <Stat label="Compromissos hoje" value={data.today.length} icon={CalendarDays} />
        <Stat label="Prontas sem inspeção" value={data.queue.filter((o) => o.status === 'pronta' && !o.inspection_result).length} icon={ShieldCheck} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {data.technicians.map((t) => (
          <div key={t.id} className={cx('card p-4', t.log_id && 'ring-2 ring-emerald-500/40')}>
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full" style={{ background: t.color || '#94a3b8' }} />
              <span className="font-semibold">{t.name}</span>
              <span className="ml-auto text-xs text-ink-faint">hoje {hm(t.minutes_today)}</span>
            </div>
            {t.log_id ? (
              <div className="mt-3 space-y-1 text-sm">
                <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300"><Timer className="h-4 w-4" /><Elapsed since={t.log_started_at} /> · {ACTIVITY[t.log_activity]}</div>
                <Link to={`/os/${t.order_id}`} className="block truncate text-primary">{docNumber(settings, 'order', t.order_number)} · {t.customer_name}</Link>
                <div className="truncate text-xs text-ink-faint">{t.equipment_description}</div>
                {can('time_log') && <button className="btn-outline mt-2 h-8 text-xs" onClick={() => stop(t)}><Square className="h-3.5 w-3.5" /> Encerrar</button>}
              </div>
            ) : <div className="mt-3 text-sm text-ink-faint">Sem apontamento em andamento.</div>}
            <div className="mt-3 space-y-1 border-t border-line pt-2">
              {data.today.filter((e) => e.technician_id === t.id).map((e) => (
                <div key={e.id} className="flex items-center gap-2 text-xs">
                  <span className="tabular-nums text-ink-faint">{fmt(e.starts_at, 'HH:mm')}</span>
                  <span className={cx('chip', SCHEDULE_KIND[e.kind]?.cls)}>{SCHEDULE_KIND[e.kind]?.label}</span>
                  <span className="truncate">{e.title}</span>
                </div>
              ))}
              {!data.today.some((e) => e.technician_id === t.id) && <div className="text-xs text-ink-faint">Nada agendado hoje.</div>}
            </div>
          </div>
        ))}
        {!data.technicians.length && <div className="card sm:col-span-2 xl:col-span-3"><Empty icon={HardHat} title="Nenhum técnico" text="Cadastre os técnicos em Configurações › Técnicos." /></div>}
      </div>
      <div className="card overflow-hidden">
        <h2 className="border-b border-line px-5 py-3.5 font-semibold">Fila de execução</h2>
        {!data.queue.length ? <Empty icon={ClipboardList} title="Fila vazia" /> : (
          <div className="overflow-x-auto">
            <table className="table-clean">
              <thead><tr><th>OS</th><th>Cliente / objeto</th><th className="hidden md:table-cell">Técnico</th><th className="hidden md:table-cell">Prazo</th><th>Etapa</th><th className="text-right">Horas</th></tr></thead>
              <tbody>
                {data.queue.map((o) => (
                  <tr key={o.id}>
                    <td className="whitespace-nowrap font-medium"><Link to={`/os/${o.id}`} className="text-primary">{docNumber(settings, 'order', o.number)}</Link></td>
                    <td><div className="max-w-[280px] truncate">{o.customer_name}</div><div className="max-w-[280px] truncate text-xs text-ink-faint">{o.equipment_description}</div></td>
                    <td className="hidden md:table-cell">{o.technician_name || '—'}</td>
                    <td className={cx('hidden whitespace-nowrap md:table-cell', o.promised_at && new Date(o.promised_at) < new Date() && o.status !== 'pronta' && 'text-red-600')}>{fmt(o.promised_at, 'dd/MM HH:mm')}</td>
                    <td><StatusBadge status={o.status} />{o.priority !== 'normal' && <span className={cx('ml-1 text-xs', PRIORITY[o.priority].cls)}>{PRIORITY[o.priority].label}</span>}</td>
                    <td className="text-right tabular-nums">{hm(o.labor_minutes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Timesheet() {
  const settings = useSettings();
  const { can } = useAuth();
  const [p, setP] = useState({ from: ymd(new Date(Date.now() - 6 * 86400000)), to: ymd() });
  const [data, setData] = useState(null);
  useEffect(() => { setData(null); api.get(`/production/timesheet${qs(p)}`).then(setData).catch(() => setData({ rows: [], totals: [] })); }, [p]);
  const values = can('orders_values');
  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-end gap-3 p-3">
        <label className="text-sm"><span className="label">De</span><input type="date" className="input" value={p.from} onChange={(e) => setP({ ...p, from: e.target.value })} /></label>
        <label className="text-sm"><span className="label">Até</span><input type="date" className="input" value={p.to} onChange={(e) => setP({ ...p, to: e.target.value })} /></label>
        <button className="btn-outline ml-auto" disabled={!data?.rows?.length} onClick={() => downloadCSV('folha-de-horas.csv', data.rows.map((r) => ({
          Tecnico: r.technician_name, OS: r.order_number, Cliente: r.customer_name, Atividade: ACTIVITY[r.activity], Inicio: fmt(r.started_at, 'dd/MM/yyyy HH:mm'),
          Fim: fmt(r.ended_at, 'dd/MM/yyyy HH:mm'), Minutos: r.minutes, ...(values ? { Custo: r.cost } : {}), Manual: r.manual ? 'sim' : '', Obs: r.notes,
        })))}><Download className="h-4 w-4" /> CSV</button>
      </div>
      {!data ? <Loading /> : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {data.totals.map((t) => (
              <div key={t.technician_id} className="card p-4">
                <div className="text-xs text-ink-faint">{t.technician_name}</div>
                <div className="mt-1 text-xl font-semibold tabular-nums">{hm(t.minutes)}</div>
                <div className="text-xs text-ink-faint">{t.entries} apontamento(s){t.manual ? ` · ${t.manual} manual` : ''}{values && t.cost != null ? ` · ${money(t.cost)}` : ''}</div>
              </div>
            ))}
          </div>
          <div className="card overflow-hidden">
            {!data.rows.length ? <Empty icon={Timer} title="Nenhuma hora apontada no período" /> : (
              <div className="overflow-x-auto">
                <table className="table-clean">
                  <thead><tr><th>Técnico</th><th>OS</th><th>Atividade</th><th>Início</th><th className="text-right">Duração</th>{values && <th className="text-right">Custo</th>}</tr></thead>
                  <tbody>
                    {data.rows.map((r) => (
                      <tr key={r.id}>
                        <td>{r.technician_name}</td>
                        <td><Link to={`/os/${r.order_id}`} className="text-primary">{docNumber(settings, 'order', r.order_number)}</Link><div className="max-w-[200px] truncate text-xs text-ink-faint">{r.customer_name}</div></td>
                        <td>{ACTIVITY[r.activity]}{r.manual && <span className="ml-1 text-xs text-amber-600">manual</span>}</td>
                        <td className="whitespace-nowrap text-ink-soft">{fmt(r.started_at, 'dd/MM HH:mm')}–{fmt(r.ended_at, 'HH:mm')}</td>
                        <td className="text-right tabular-nums">{hm(r.minutes)}</td>
                        {values && <td className="text-right tabular-nums">{money(r.cost)}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
