// Blocos da operação técnica dentro da OS: estados separados, execução (horas), qualidade, agenda e garantia.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Play, Square, Timer, Plus, Trash2, ClipboardCheck, CalendarPlus, ShieldAlert, CheckCircle2, XCircle, MinusCircle } from 'lucide-react';
import { api } from '../lib/api';
import { fmt, fmtDateTime, money, toLocalInput, docNumber } from '../lib/format';
import { useAuth, useSettings } from '../context/AuthContext';
import { useCatalog } from '../context/CatalogContext';
import { useUI } from '../context/UIContext';
import { Input, Textarea, Select, Modal, useAction, FAIL, cx } from './ui';
import { ACTIVITY, Elapsed, hm } from '../pages/Production';
import { SCHEDULE_KIND, SCHEDULE_STATUS, ScheduleModal } from '../pages/Agenda';
import { WarrantyBadge, WarrantyModal } from '../pages/Warranty';

export const INSPECTION_RESULT = {
  aprovado: { label: 'Aprovada', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  aprovado_ressalva: { label: 'Aprovada c/ ressalva', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
  reprovado: { label: 'Reprovada', cls: 'bg-red-500/10 text-red-700 dark:text-red-300' },
};
const CHECK_KIND = { recebimento: 'Recebimento', inspecao: 'Inspeção final', entrega: 'Entrega' };

/** Estados independentes: técnico, qualidade, entrega, financeiro e fiscal. */
export function StateChips({ o }) {
  const { can } = useAuth();
  const chip = (label, value, cls) => (
    <span className={cx('inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[11px]', cls)}>
      <span className="text-ink-faint">{label}:</span><b className="font-medium">{value}</b>
    </span>
  );
  const fin = o.total == null ? null : o.balance <= 0.009 ? ['Quitado', 'text-emerald-700'] : o.paid > 0 || o.receivable > 0 ? ['Parcial', 'text-amber-700'] : ['Em aberto', 'text-red-700'];
  const fiscal = o.invoices?.some((i) => i.status === 'autorizada') ? ['Autorizada', 'text-emerald-700']
    : o.invoices?.some((i) => i.status === 'processando') ? ['Processando', 'text-amber-700']
      : o.invoices?.some((i) => i.status === 'preparada') ? ['Preparada (sem emissão)', 'text-sky-700'] : ['Sem documento', 'text-ink-soft'];
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {o.kind === 'os' && chip('Qualidade', o.inspection_result ? INSPECTION_RESULT[o.inspection_result].label : 'Não inspecionada')}
      {chip('Entrega', o.delivered_at ? `Entregue ${fmt(o.delivered_at, 'dd/MM')}${o.delivered_to ? ` a ${o.delivered_to}` : ''}` : 'Pendente')}
      {can('orders_values') && fin && chip('Financeiro', fin[0], fin[1])}
      {can('orders_values') && chip('Fiscal', fiscal[0], fiscal[1])}
      {o.warranty_of && chip('Retrabalho da', `OS nº ${o.warranty_of_number}`, 'text-violet-700')}
    </div>
  );
}

export function ExecutionCard({ o, onChanged }) {
  const { can, user, scope } = useAuth();
  const { technicians } = useCatalog();
  const { confirm } = useUI();
  const [run, busy] = useAction();
  const [tech, setTech] = useState(user.technician_id || o.technician_id || '');
  const [activity, setActivity] = useState(o.status === 'aguardando_aprovacao' || o.status === 'diagnostico' ? 'diagnostico' : o.warranty_of ? 'retrabalho' : 'execucao');
  const [manual, setManual] = useState(false);
  const canLog = can('time_log');
  const scopeAll = scope('time_log') === 'all';
  const open = ['entregue', 'cancelada'].includes(o.status) === false;
  const start = async () => {
    const r = await run(() => api.post(`/production/orders/${o.id}/time/start`, { technician_id: tech || null, activity }), 'Cronômetro iniciado');
    if (r !== FAIL) onChanged();
  };
  const stop = async (l) => { if ((await run(() => api.post(`/production/time/${l.id}/stop`, {}), 'Apontamento encerrado')) !== FAIL) onChanged(); };
  const remove = async (l) => {
    if (!(await confirm({ title: 'Remover apontamento?', confirmText: 'Remover' }))) return;
    if ((await run(() => api.del(`/production/time/${l.id}`), 'Removido')) !== FAIL) onChanged();
  };
  const values = can('orders_values');
  return (
    <section className="card p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold"><Timer className="h-4 w-4 text-ink-faint" /> Execução e horas</h2>
        <span className="text-sm text-ink-soft">Total: <b className="tabular-nums">{hm(o.labor_minutes)}</b>{values && o.labor_cost > 0 && <> · custo real {money(o.labor_cost)}</>}</span>
      </div>
      {o.open_logs?.map((l) => (
        <div key={l.id} className="mb-3 flex flex-wrap items-center gap-2 rounded-app-sm bg-emerald-500/10 p-3 text-sm text-emerald-800 dark:text-emerald-200">
          <Timer className="h-4 w-4" /><b>{l.technician_name}</b> · {ACTIVITY[l.activity]} · <Elapsed since={l.started_at} />
          {canLog && <button className="btn-outline ml-auto h-8 bg-surface text-xs" disabled={busy} onClick={() => stop(l)}><Square className="h-3.5 w-3.5" /> Encerrar</button>}
        </div>
      ))}
      {canLog && open && (
        <div className="mb-3 flex flex-wrap items-end gap-2">
          {scopeAll && (
            <select className="input h-9 w-44" value={tech} onChange={(e) => setTech(e.target.value)} aria-label="Técnico">
              <option value="">Técnico…</option>{technicians.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
          <select className="input h-9 w-40" value={activity} onChange={(e) => setActivity(e.target.value)} aria-label="Atividade">
            {Object.entries(ACTIVITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <button className="btn-primary h-9" disabled={busy || (scopeAll && !tech)} onClick={start}><Play className="h-4 w-4" /> Iniciar</button>
          <button className="btn-ghost h-9 text-xs" onClick={() => setManual(true)}><Plus className="h-3.5 w-3.5" /> Lançar manual</button>
        </div>
      )}
      {!o.time_logs?.filter((l) => l.ended_at).length ? <p className="text-sm text-ink-faint">Nenhuma hora apontada.</p> : (
        <ul className="divide-y divide-line text-sm">
          {o.time_logs.filter((l) => l.ended_at).map((l) => (
            <li key={l.id} className="group flex items-center gap-2 py-2">
              <div className="min-w-0 flex-1">
                <div>{l.technician_name} · {ACTIVITY[l.activity]}{l.manual && <span className="ml-1 text-xs text-amber-600">manual</span>}</div>
                <div className="text-xs text-ink-faint">{fmt(l.started_at, 'dd/MM HH:mm')}–{fmt(l.ended_at, 'HH:mm')}{l.notes && ` · ${l.notes}`}</div>
              </div>
              <span className="tabular-nums">{hm(l.minutes)}</span>
              {values && l.cost != null && <span className="w-20 text-right tabular-nums text-ink-soft">{money(l.cost)}</span>}
              {canLog && <button className="btn-ghost btn-icon h-7 text-red-600 md:opacity-0 md:group-hover:opacity-100" aria-label="Remover" onClick={() => remove(l)}><Trash2 className="h-3.5 w-3.5" /></button>}
            </li>
          ))}
        </ul>
      )}
      {manual && <ManualTime o={o} scopeAll={scopeAll} onClose={() => setManual(false)} onDone={() => { setManual(false); onChanged(); }} />}
    </section>
  );
}

function ManualTime({ o, scopeAll, onClose, onDone }) {
  const { technicians } = useCatalog();
  const { user } = useAuth();
  const [run, busy] = useAction();
  const now = new Date();
  const [f, setF] = useState({ technician_id: user.technician_id || o.technician_id || '', activity: 'execucao', started_at: toLocalInput(new Date(now.getTime() - 3600000)), ended_at: toLocalInput(now), notes: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const go = async () => {
    const r = await run(() => api.post(`/production/orders/${o.id}/time`, { ...f, technician_id: f.technician_id || null, started_at: new Date(f.started_at).toISOString(), ended_at: new Date(f.ended_at).toISOString() }), 'Horas lançadas');
    if (r !== FAIL) onDone();
  };
  return (
    <Modal open onClose={onClose} size="sm" title="Lançar horas manualmente"
      footer={<><button className="btn-ghost" onClick={onClose}>Voltar</button><button className="btn-primary" disabled={busy || f.notes.trim().length < 3} onClick={go}>Lançar</button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        {scopeAll && <Select label="Técnico" value={f.technician_id} onChange={set('technician_id')}><option value="">Selecione…</option>{technicians.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>}
        <Select label="Atividade" value={f.activity} onChange={set('activity')}>{Object.entries(ACTIVITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
        <Input label="Início" type="datetime-local" value={f.started_at} onChange={set('started_at')} />
        <Input label="Fim" type="datetime-local" value={f.ended_at} onChange={set('ended_at')} />
        <Textarea label="Justificativa" rows={2} value={f.notes} onChange={set('notes')} className="sm:col-span-2" hint="Lançamentos manuais ficam registrados na auditoria." />
      </div>
    </Modal>
  );
}

export function QualityCard({ o, onChanged }) {
  const { can } = useAuth();
  const [modal, setModal] = useState(null);
  const canInspect = can('inspections');
  const kinds = [canInspect && 'inspecao', (can('orders_edit') || can('orders_create')) && 'recebimento', (can('orders_deliver') || canInspect) && 'entrega'].filter(Boolean);
  const closed = o.status === 'cancelada';
  return (
    <section className="card p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold"><ClipboardCheck className="h-4 w-4 text-ink-faint" /> Qualidade e checklists</h2>
        {!closed && kinds.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {kinds.map((k) => <button key={k} className="btn-outline h-8 text-xs" onClick={() => setModal(k)}><Plus className="h-3.5 w-3.5" /> {CHECK_KIND[k]}</button>)}
          </div>
        )}
      </div>
      {!o.inspections?.length ? <p className="text-sm text-ink-faint">Nenhum checklist registrado.</p> : (
        <ul className="space-y-2 text-sm">
          {o.inspections.map((i) => (
            <li key={i.id} className="rounded-app-sm border border-line p-3">
              <div className="flex flex-wrap items-center gap-2">
                <b>{CHECK_KIND[i.kind]}</b><span className={cx('chip', INSPECTION_RESULT[i.result]?.cls)}>{INSPECTION_RESULT[i.result]?.label}</span>
                <span className="ml-auto text-xs text-ink-faint">{fmtDateTime(i.created_at)}{i.inspector_name && ` · ${i.inspector_name}`}</span>
              </div>
              <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                {i.items.map((it, k) => (
                  <li key={k} className="flex items-start gap-1.5 text-xs">
                    {it.result === 'ok' ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" /> : it.result === 'nok' ? <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600" /> : <MinusCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint" />}
                    <span>{it.label}{it.note && <span className="text-ink-faint"> — {it.note}</span>}</span>
                  </li>
                ))}
              </ul>
              {i.notes && <p className="mt-2 text-xs text-ink-soft">{i.notes}</p>}
            </li>
          ))}
        </ul>
      )}
      {modal && <InspectionModal o={o} kind={modal} onClose={() => setModal(null)} onDone={() => { setModal(null); onChanged(); }} />}
    </section>
  );
}

function InspectionModal({ o, kind, onClose, onDone }) {
  const [run, busy] = useAction();
  const [templates, setTemplates] = useState([]);
  const [tpl, setTpl] = useState('');
  const [items, setItems] = useState([]);
  const [result, setResult] = useState('aprovado');
  const [notes, setNotes] = useState('');
  const [extra, setExtra] = useState('');
  useEffect(() => {
    api.get('/quality/templates').then((l) => {
      const mine = l.filter((t) => t.kind === kind);
      setTemplates(mine);
      if (mine[0]) { setTpl(mine[0].id); setItems(mine[0].items.map((label) => ({ label, result: 'ok', note: '' }))); }
    }).catch(() => {});
  }, [kind]);
  const pick = (id) => { setTpl(id); const t = templates.find((x) => x.id === id); setItems(t ? t.items.map((label) => ({ label, result: 'ok', note: '' })) : []); };
  const setIt = (k, patch) => setItems(items.map((x, i) => (i === k ? { ...x, ...patch } : x)));
  const noks = items.filter((i) => i.result === 'nok').length;
  useEffect(() => { if (noks && result === 'aprovado') setResult('aprovado_ressalva'); }, [noks]); // eslint-disable-line
  const go = async () => {
    const r = await run(() => api.post(`/quality/orders/${o.id}/inspections`, { kind, template_id: tpl || null, items: items.map((i) => ({ ...i, note: i.note || null })), result, notes: notes || null }), 'Checklist registrado');
    if (r !== FAIL) onDone();
  };
  return (
    <Modal open onClose={onClose} size="lg" title={CHECK_KIND[kind]} subtitle={`OS nº ${o.number}`}
      footer={<><button className="btn-ghost" onClick={onClose}>Voltar</button><button className={result === 'reprovado' ? 'btn-danger' : 'btn-primary'} disabled={busy || !items.length} onClick={go}>Registrar</button></>}>
      <div className="space-y-3 text-sm">
        {templates.length > 1 && <Select label="Modelo" value={tpl} onChange={(e) => pick(e.target.value)}>{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>}
        <div className="divide-y divide-line rounded-app-sm border border-line">
          {items.map((it, k) => (
            <div key={k} className="flex flex-wrap items-center gap-2 p-2">
              <span className="min-w-[180px] flex-1">{it.label}</span>
              <div className="flex gap-1">
                {[['ok', 'OK', 'border-emerald-500 bg-emerald-500/10 text-emerald-700'], ['nok', 'Não conforme', 'border-red-500 bg-red-500/10 text-red-700'], ['na', 'N/A', 'border-ink-faint bg-muted']].map(([v, l, cls]) => (
                  <button key={v} type="button" onClick={() => setIt(k, { result: v })} className={cx('rounded-app-sm border px-2 py-1 text-xs', it.result === v ? cls : 'border-line text-ink-soft')}>{l}</button>
                ))}
              </div>
              {it.result === 'nok' && <input className="input h-8 w-full text-xs" placeholder="O que foi encontrado" value={it.note} onChange={(e) => setIt(k, { note: e.target.value })} />}
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input className="input h-8 text-xs" placeholder="Adicionar item ao checklist" value={extra} onChange={(e) => setExtra(e.target.value)} />
          <button type="button" className="btn-outline h-8 text-xs" disabled={extra.trim().length < 2} onClick={() => { setItems([...items, { label: extra.trim(), result: 'ok', note: '' }]); setExtra(''); }}>Incluir</button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {Object.entries(INSPECTION_RESULT).map(([k, v]) => (
            <button key={k} type="button" disabled={k === 'aprovado' && noks > 0} onClick={() => setResult(k)}
              className={cx('rounded-app-sm border px-2 py-2 text-xs font-medium disabled:opacity-40', result === k ? v.cls + ' border-current' : 'border-line')}>{v.label}</button>
          ))}
        </div>
        <Textarea label="Observações" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        {kind === 'inspecao' && result === 'reprovado' && o.status === 'pronta' && <p className="text-xs text-red-600">A OS volta para “em execução”.</p>}
      </div>
    </Modal>
  );
}

export function ScheduleCard({ o, onChanged }) {
  const { can } = useAuth();
  const [edit, setEdit] = useState(null);
  const closed = ['entregue', 'cancelada'].includes(o.status);
  return (
    <section className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">Programação</h2>
        {can('schedule_manage') && !closed && <button className="btn-outline h-8 text-xs" onClick={() => setEdit({ kind: o.status === 'pronta' ? 'entrega' : 'execucao' })}><CalendarPlus className="h-3.5 w-3.5" /> Agendar</button>}
      </div>
      {!o.schedule?.length ? <p className="text-sm text-ink-faint">Nada agendado para esta OS.</p> : (
        <ul className="space-y-2 text-sm">
          {o.schedule.map((e) => (
            <li key={e.id} className={cx('flex items-start gap-2', ['cancelado', 'nao_realizado'].includes(e.status) && 'opacity-50 line-through')}>
              <span className={cx('chip shrink-0', SCHEDULE_KIND[e.kind]?.cls)}>{SCHEDULE_KIND[e.kind]?.label}</span>
              <div className="min-w-0 flex-1">
                <div className="tabular-nums">{fmt(e.starts_at, 'dd/MM HH:mm')}–{fmt(e.ends_at, 'HH:mm')}</div>
                <div className="text-xs text-ink-faint">{e.technician_name || 'Sem técnico'} · {SCHEDULE_STATUS[e.status]}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Link to="/agenda" className="mt-3 block text-xs text-primary">Abrir agenda</Link>
      {edit && <ScheduleModal entry={edit} order={o} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); onChanged(); }} />}
    </section>
  );
}

export function WarrantyCard({ o, onChanged }) {
  const settings = useSettings();
  const { can } = useAuth();
  const [run, busy] = useAction();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [view, setView] = useState(null);
  const within = o.warranty_until && new Date(`${o.warranty_until}T23:59:59`) >= new Date();
  const create = async () => {
    const r = await run(() => api.post('/warranty', { order_id: o.id, description: text }), 'Garantia aberta');
    if (r !== FAIL) { setOpen(false); setText(''); onChanged(); setView(r); }
  };
  if (o.status !== 'entregue' && !o.warranties?.length) return null;
  return (
    <section className="card p-5 text-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold"><ShieldAlert className="h-4 w-4 text-ink-faint" /> Garantia</h2>
        {can('warranty_manage') && o.status === 'entregue' && <button className="btn-outline h-8 text-xs" onClick={() => setOpen(true)}>Abrir garantia</button>}
      </div>
      <p className="text-ink-soft">{o.warranty_until ? `Garantia até ${fmt(o.warranty_until)} — ${within ? 'dentro do prazo' : 'vencida'}` : 'Sem garantia definida'}</p>
      {o.warranties?.map((w) => (
        <button key={w.id} onClick={() => setView(w)} className="mt-2 flex w-full items-center gap-2 rounded-app-sm border border-line p-2 text-left hover:bg-muted">
          <span className="font-medium">G-{String(w.number).padStart(4, '0')}</span><WarrantyBadge status={w.status} />
          <span className="min-w-0 flex-1 truncate text-xs text-ink-faint">{w.description}</span>
        </button>
      ))}
      {open && (
        <Modal open onClose={() => setOpen(false)} size="sm" title="Abrir garantia" subtitle={within ? 'Dentro do prazo de garantia' : 'Atenção: fora do prazo de garantia'}
          footer={<><button className="btn-ghost" onClick={() => setOpen(false)}>Voltar</button><button className="btn-primary" disabled={busy || text.trim().length < 5} onClick={create}>Abrir</button></>}>
          <Textarea label="O que o cliente relatou" rows={4} value={text} onChange={(e) => setText(e.target.value)} />
        </Modal>
      )}
      {view && <WarrantyModal claim={view} onClose={() => { setView(null); onChanged(); }} />}
      <Link to="/garantias" className="mt-3 block text-xs text-primary">{docNumber(settings, 'order', o.number)} · ver todas as garantias</Link>
    </section>
  );
}
