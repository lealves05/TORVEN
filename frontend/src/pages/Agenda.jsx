// Agenda / programação: semana por dia, filtro por técnico, conflitos e baixa dos compromissos.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { addDays, format, startOfWeek, isSameDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Plus, CalendarDays, MapPin, CheckCircle2, XCircle, Play, Pencil, Trash2 } from 'lucide-react';
import { api, qs } from '../lib/api';
import { fmt, toLocalInput, docNumber } from '../lib/format';
import { useAuth, useSettings } from '../context/AuthContext';
import { useCatalog } from '../context/CatalogContext';
import { useUI } from '../context/UIContext';
import { PageHeader, Input, Textarea, Select, Loading, Empty, Modal, useAction, FAIL, cx } from '../components/ui';

export const SCHEDULE_KIND = {
  visita: { label: 'Visita técnica', cls: 'bg-amber-500/15 text-amber-800 dark:text-amber-200' },
  execucao: { label: 'Execução', cls: 'bg-blue-500/15 text-blue-800 dark:text-blue-200' },
  entrega: { label: 'Entrega', cls: 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-200' },
  retirada: { label: 'Retirada', cls: 'bg-violet-500/15 text-violet-800 dark:text-violet-200' },
  outro: { label: 'Outro', cls: 'bg-muted text-ink-soft' },
};
export const SCHEDULE_STATUS = {
  agendado: 'Agendado', em_andamento: 'Em andamento', concluido: 'Concluído', cancelado: 'Cancelado', nao_realizado: 'Não realizado',
};

export default function Agenda() {
  const { can } = useAuth();
  const { technicians } = useCatalog();
  const [week, setWeek] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [tech, setTech] = useState('');
  const [list, setList] = useState(null);
  const [edit, setEdit] = useState(null);
  const [view, setView] = useState(null);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(week, i)), [week]);
  const load = useCallback(() => api.get(`/schedule${qs({ from: week.toISOString(), to: addDays(week, 7).toISOString(), technician_id: tech })}`)
    .then(setList).catch(() => setList([])), [week, tech]);
  useEffect(() => { load(); }, [load]);
  const manage = can('schedule_manage');
  const color = (id) => technicians.find((t) => t.id === id)?.color || '#94a3b8';

  return (
    <div>
      <PageHeader title="Agenda" subtitle="Visitas técnicas, execuções, entregas e retiradas por técnico"
        actions={manage && <button className="btn-primary" onClick={() => setEdit({ kind: 'execucao' })}><Plus className="h-4 w-4" /> Agendar</button>} />
      <div className="card mb-4 flex flex-wrap items-center gap-2 p-3">
        <button className="btn-outline btn-icon" aria-label="Semana anterior" onClick={() => setWeek(addDays(week, -7))}><ChevronLeft className="h-4 w-4" /></button>
        <button className="btn-outline" onClick={() => setWeek(startOfWeek(new Date(), { weekStartsOn: 1 }))}>Hoje</button>
        <button className="btn-outline btn-icon" aria-label="Próxima semana" onClick={() => setWeek(addDays(week, 7))}><ChevronRight className="h-4 w-4" /></button>
        <span className="px-2 text-sm font-medium">{format(week, "d 'de' MMM", { locale: ptBR })} – {format(addDays(week, 6), "d 'de' MMM yyyy", { locale: ptBR })}</span>
        {manage && (
          <select className="input ml-auto w-48" value={tech} onChange={(e) => setTech(e.target.value)} aria-label="Técnico">
            <option value="">Todos os técnicos</option>{technicians.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
      </div>
      {!list ? <Loading /> : (
        <div className="grid gap-2 md:grid-cols-7">
          {days.map((d) => {
            const items = list.filter((e) => isSameDay(new Date(e.starts_at), d) || (new Date(e.starts_at) < d && new Date(e.ends_at) > d));
            const today = isSameDay(d, new Date());
            return (
              <div key={d.toISOString()} className={cx('card p-2 md:min-h-[140px]', today && 'ring-2 ring-primary/40', !items.length && !today && 'max-md:hidden')}>
                <div className="mb-2 flex items-center justify-between px-1">
                  <span className={cx('text-xs font-semibold uppercase', today ? 'text-primary' : 'text-ink-faint')}>{format(d, 'EEE d', { locale: ptBR })}</span>
                  {manage && <button className="text-ink-faint hover:text-primary" aria-label="Agendar neste dia" onClick={() => { const s = new Date(d); s.setHours(8, 0, 0, 0); setEdit({ kind: 'execucao', starts_at: s.toISOString(), ends_at: new Date(s.getTime() + 2 * 3600000).toISOString() }); }}><Plus className="h-3.5 w-3.5" /></button>}
                </div>
                <div className="space-y-1.5">
                  {items.map((e) => (
                    <button key={e.id} onClick={() => setView(e)}
                      className={cx('w-full rounded-app-sm border-l-4 p-1.5 text-left text-xs', SCHEDULE_KIND[e.kind]?.cls, ['cancelado', 'nao_realizado'].includes(e.status) && 'line-through opacity-50', e.status === 'concluido' && 'opacity-60')}
                      style={{ borderLeftColor: color(e.technician_id) }}>
                      <div className="font-semibold tabular-nums">{fmt(e.starts_at, 'HH:mm')}–{fmt(e.ends_at, 'HH:mm')}</div>
                      <div className="line-clamp-2">{e.title}</div>
                      <div className="truncate opacity-80">{e.technician_name || 'Sem técnico'}{e.customer_name && ` · ${e.customer_name}`}</div>
                    </button>
                  ))}
                  {!items.length && <div className="px-1 text-[11px] text-ink-faint">—</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {list && !list.length && <div className="card mt-4"><Empty icon={CalendarDays} title="Nada agendado nesta semana" text="Visitas marcadas nas solicitações aparecem aqui automaticamente." /></div>}
      {view && <EntryModal entry={view} onClose={() => setView(null)} onEdit={() => { setEdit(view); setView(null); }} onChanged={() => { setView(null); load(); }} />}
      {edit && <ScheduleModal entry={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </div>
  );
}

function EntryModal({ entry: e, onClose, onEdit, onChanged }) {
  const settings = useSettings();
  const { can, user } = useAuth();
  const { confirm } = useUI();
  const [run, busy] = useAction();
  const [reason, setReason] = useState('');
  const manage = can('schedule_manage');
  const setStatus = async (status) => {
    if (['cancelado', 'nao_realizado'].includes(status) && reason.trim().length < 3) return;
    const r = await run(() => api.post(`/schedule/${e.id}/status`, { status, notes: reason || null }), SCHEDULE_STATUS[status]);
    if (r !== FAIL) onChanged();
  };
  const remove = async () => {
    if (!(await confirm({ title: 'Excluir compromisso?', confirmText: 'Excluir' }))) return;
    if ((await run(() => api.del(`/schedule/${e.id}`), 'Excluído')) !== FAIL) onChanged();
  };
  const own = user.technician_id && user.technician_id === e.technician_id;
  const open = ['agendado', 'em_andamento'].includes(e.status);
  return (
    <Modal open onClose={onClose} size="sm" title={e.title} subtitle={`${SCHEDULE_KIND[e.kind]?.label} · ${SCHEDULE_STATUS[e.status]}`}>
      <div className="space-y-3 text-sm">
        <div>{fmt(e.starts_at, "EEEE, dd/MM 'das' HH:mm")} às {fmt(e.ends_at, 'HH:mm')}</div>
        <div className="text-ink-soft">Técnico: {e.technician_name || 'a definir'}</div>
        {e.location && <div className="flex items-start gap-1 text-ink-soft"><MapPin className="mt-0.5 h-3.5 w-3.5" />{e.location}</div>}
        {e.order_id && <Link to={`/os/${e.order_id}`} className="block text-primary">{docNumber(settings, 'order', e.order_number)}{e.customer_name && ` · ${e.customer_name}`}</Link>}
        {e.request_id && <Link to={`/solicitacoes/${e.request_id}`} className="block text-primary">{docNumber(settings, 'request', e.request_number)}{e.customer_name && ` · ${e.customer_name}`}</Link>}
        {e.notes && <p className="whitespace-pre-line rounded-app-sm bg-muted/60 p-2 text-ink-soft">{e.notes}</p>}
        {open && (manage || own) && (
          <div className="space-y-2 border-t border-line pt-3">
            <div className="flex flex-wrap gap-2">
              {e.status === 'agendado' && <button className="btn-outline h-8 text-xs" disabled={busy} onClick={() => setStatus('em_andamento')}><Play className="h-3.5 w-3.5" /> Iniciar</button>}
              <button className="btn-outline h-8 text-xs text-emerald-700" disabled={busy} onClick={() => setStatus('concluido')}><CheckCircle2 className="h-3.5 w-3.5" /> Concluído</button>
              {manage && <button className="btn-outline h-8 text-xs" onClick={onEdit}><Pencil className="h-3.5 w-3.5" /> Reprogramar</button>}
            </div>
            <input className="input h-8 text-xs" placeholder="Motivo (para cancelar / não realizado)" value={reason} onChange={(ev) => setReason(ev.target.value)} />
            <div className="flex flex-wrap gap-2">
              <button className="btn-ghost h-8 text-xs text-red-600" disabled={busy || reason.trim().length < 3} onClick={() => setStatus('nao_realizado')}><XCircle className="h-3.5 w-3.5" /> Não realizado</button>
              {manage && <button className="btn-ghost h-8 text-xs text-red-600" disabled={busy || reason.trim().length < 3} onClick={() => setStatus('cancelado')}>Cancelar</button>}
              {manage && <button className="btn-ghost ml-auto h-8 text-xs text-red-600" onClick={remove}><Trash2 className="h-3.5 w-3.5" /></button>}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

/** Criar/reprogramar compromisso. Em conflito de horário, pede confirmação e reenvia com force. */
export function ScheduleModal({ entry, order, onClose, onSaved }) {
  const { technicians } = useCatalog();
  const { confirm } = useUI();
  const [run, busy] = useAction();
  const start0 = entry.starts_at ? new Date(entry.starts_at) : (() => { const d = new Date(Date.now() + 86400000); d.setHours(8, 0, 0, 0); return d; })();
  const [f, setF] = useState({
    kind: entry.kind || 'execucao', title: entry.title || (order ? `${entry.kind === 'entrega' ? 'Entrega' : 'Execução'} OS nº ${order.number}` : ''),
    order_id: entry.order_id || order?.id || null, request_id: entry.request_id || null,
    technician_id: entry.technician_id || order?.technician_id || '', starts_at: toLocalInput(start0),
    ends_at: toLocalInput(entry.ends_at || new Date(start0.getTime() + 2 * 3600000)),
    location: entry.location || (order?.service_location === 'externo' ? order.service_address : '') || '', notes: entry.notes || '',
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (force = false) => {
    const body = { ...f, technician_id: f.technician_id || null, starts_at: new Date(f.starts_at).toISOString(), ends_at: new Date(f.ends_at).toISOString(), force };
    const r = await run(() => (entry.id ? api.put(`/schedule/${entry.id}`, body) : api.post('/schedule', body)), 'Agenda salva', async (e) => {
      if (e.status === 409 && !force) {
        if (await confirm({ title: 'Conflito de horário', message: e.message, confirmText: 'Agendar mesmo assim', danger: false })) await save(true);
        return true;
      }
      return false;
    });
    if (r !== FAIL) onSaved(r);
  };
  return (
    <Modal open onClose={onClose} title={entry.id ? 'Reprogramar' : 'Agendar'}
      footer={<><button className="btn-ghost" onClick={onClose}>Voltar</button><button className="btn-primary" disabled={busy || f.title.trim().length < 2 || !f.starts_at || !f.ends_at} onClick={() => save()}>Salvar</button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label="Tipo" value={f.kind} onChange={set('kind')}>{Object.entries(SCHEDULE_KIND).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select>
        <Select label="Técnico" value={f.technician_id} onChange={set('technician_id')}>
          <option value="">A definir</option>{technicians.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>
        <Input label="Título" value={f.title} onChange={set('title')} className="sm:col-span-2" />
        <Input label="Início" type="datetime-local" value={f.starts_at} onChange={set('starts_at')} />
        <Input label="Término" type="datetime-local" value={f.ends_at} onChange={set('ends_at')} />
        <Input label="Local" value={f.location} onChange={set('location')} className="sm:col-span-2" />
        <Textarea label="Observações" rows={2} value={f.notes} onChange={set('notes')} className="sm:col-span-2" />
      </div>
    </Modal>
  );
}
