// Financeiro › Alertas e lembretes: o que vence, o que venceu, caixa aberto há muito tempo, lembretes e quando avisar.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, BellRing, CalendarClock, Check, Lock, Plus, Repeat, Trash2, Pencil, Bot, Settings2 } from 'lucide-react';
import { api, qs } from '../lib/api';
import { money, fmt, ymd } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import { Input, Select, MoneyInput, Modal, Textarea, Empty, Loading, useAction, FAIL, cx } from './ui';

const REPEAT = { nao: 'Não repete', semanal: 'Toda semana', mensal: 'Todo mês', anual: 'Todo ano' };

function AlertCard({ tone, icon: Icon, title, count, value, detail, to }) {
  const off = !count;
  return (
    <Link to={to} className={cx('card flex items-start gap-3 p-4 transition hover:shadow-md', off && 'opacity-60')}>
      <span className={cx('grid h-10 w-10 shrink-0 place-items-center rounded-full', off ? 'bg-muted text-ink-faint' : tone)}><Icon className="h-5 w-5" /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-xs text-ink-faint">{detail}</span>
        <span className="mt-1 block text-sm"><b>{count}</b>{value != null && <> · <b className="tabular-nums">{money(value)}</b></>}</span>
      </span>
    </Link>
  );
}

export default function FinanceAlerts() {
  const { can, company, setCompany, agent } = useAuth();
  const { confirm } = useUI();
  const [run, busy] = useAction();
  const [alerts, setAlerts] = useState(null);
  const [list, setList] = useState(null);
  const [status, setStatus] = useState('pendentes');
  const [edit, setEdit] = useState(null);
  const [cfg, setCfg] = useState(false);
  const load = useCallback(() => {
    api.get('/reminders/alerts').then(setAlerts).catch(() => setAlerts(null));
    api.get(`/reminders${qs({ status })}`).then(setList).catch(() => setList([]));
  }, [status]);
  useEffect(() => { load(); }, [load]);

  const done = async (r) => {
    const x = await run(() => api.post(`/reminders/${r.id}/done`), 'Lembrete concluído');
    if (x !== FAIL) load();
  };
  const remove = async (r) => {
    if (!(await confirm({ title: 'Excluir lembrete?', message: r.title, confirmText: 'Excluir' }))) return;
    if ((await run(() => api.del(`/reminders/${r.id}`), 'Lembrete excluído')) !== FAIL) load();
  };
  const save = async () => {
    const body = { title: edit.title, note: edit.note || null, due_date: edit.due_date, amount: edit.amount || null, repeat: edit.repeat || 'nao' };
    const x = await run(() => (edit.id ? api.put(`/reminders/${edit.id}`, body) : api.post('/reminders', body)), 'Lembrete salvo');
    if (x !== FAIL) { setEdit(null); load(); }
  };
  const today = ymd();
  const a = alerts;
  const s = a?.settings;

  return (
    <div className="space-y-5" id="alertas-financeiro">
      <section className="space-y-3" aria-label="Alertas">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold">Alertas</h3>
          <span className="text-xs text-ink-faint">Também aparecem no sino, no alto da tela.</span>
          {can('settings') && <button className="btn-ghost ml-auto h-8 text-xs" onClick={() => setCfg(true)}><Settings2 className="h-3.5 w-3.5" /> Quando avisar</button>}
        </div>
        {!a ? <Loading /> : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <AlertCard tone="bg-red-500/10 text-red-600" icon={AlertTriangle} title="Contas a pagar vencidas" detail="Pague ou renegocie para evitar juros" count={a.pagar_vencidas} value={a.pagar_vencidas_valor} to="/financeiro/pagar?situacao=vencido" />
            <AlertCard tone="bg-amber-500/10 text-amber-600" icon={CalendarClock} title="Contas a pagar vencendo" detail={s.payDaysBefore ? `Hoje e nos próximos ${s.payDaysBefore} dia(s)` : 'Vencem hoje'} count={a.pagar_vencendo} value={a.pagar_vencendo_valor} to="/financeiro/pagar" />
            <AlertCard tone="bg-red-500/10 text-red-600" icon={AlertTriangle} title="Contas a receber vencidas" detail="Cobre o cliente" count={a.receber_vencidas} value={a.receber_vencidas_valor} to="/financeiro/receber?situacao=vencido" />
            <AlertCard tone="bg-sky-500/10 text-sky-600" icon={CalendarClock} title="Contas a receber vencendo" detail={s.receiveDaysBefore ? `Hoje e nos próximos ${s.receiveDaysBefore} dia(s)` : 'Vencem hoje'} count={a.receber_vencendo} value={a.receber_vencendo_valor} to="/financeiro/receber" />
            <AlertCard tone="bg-amber-500/10 text-amber-600" icon={Lock} title="Caixa aberto há muito tempo" detail={a.cash_open_hours == null ? 'O caixa está fechado' : `Aberto há ${a.cash_open_hours} hora(s) (aviso a partir de ${s.cashOpenHours} h)`} count={a.cash_open_long ? 1 : 0} to="/financeiro/caixa" />
            <AlertCard tone="bg-violet-500/10 text-violet-600" icon={BellRing} title="Lembretes para hoje" detail="Os seus e os sem responsável" count={a.reminders_due} to="/financeiro/alertas" />
          </div>
        )}
      </section>

      <section className="card space-y-3 p-4" aria-label="Lembretes">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold">Lembretes</h3>
          {[['pendentes', 'Pendentes'], ['feitos', 'Concluídos']].map(([k, l]) => (
            <button key={k} onClick={() => setStatus(k)} className={cx('chip border', status === k ? 'border-primary bg-primary/10 text-primary' : 'border-line')}>{l}</button>
          ))}
          <button className="btn-primary ml-auto h-9 text-sm" onClick={() => setEdit({ title: '', due_date: today, repeat: 'nao', amount: 0 })}><Plus className="h-4 w-4" /> Novo lembrete</button>
        </div>
        {agent?.includes('lembretes') && <p className="flex items-center gap-1.5 text-xs text-ink-faint"><Bot className="h-3.5 w-3.5" /> Dica: peça ao Assistente — “me lembre de pagar o aluguel dia 5”.</p>}
        {!list ? <Loading /> : !list.length ? <Empty icon={BellRing} title={status === 'feitos' ? 'Nenhum lembrete concluído' : 'Nenhum lembrete pendente'} /> : (
          <div className="divide-y divide-line">
            {list.map((r) => {
              const late = !r.done_at && r.due_date < today;
              const isToday = r.due_date === today;
              return (
                <div key={r.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm" aria-label={`Lembrete ${r.title}`}>
                  <span className={cx('w-24 shrink-0 tabular-nums', late ? 'font-medium text-red-600' : isToday ? 'font-medium text-amber-600' : 'text-ink-soft')}>
                    {fmt(r.due_date)}<span className="block text-[11px]">{late ? 'atrasado' : isToday ? 'hoje' : ''}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{r.title}</span>
                    <span className="block text-xs text-ink-faint">
                      {[r.amount ? money(r.amount) : null, r.repeat !== 'nao' ? REPEAT[r.repeat] : null, r.source === 'assistente' ? 'criado pelo Assistente' : null, r.assigned_name ? `para ${r.assigned_name}` : null, r.note].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  {r.repeat !== 'nao' && <Repeat className="h-4 w-4 text-ink-faint" aria-hidden />}
                  {!r.done_at ? (
                    <span className="flex gap-1">
                      <button className="btn-outline h-8 text-xs" disabled={busy} onClick={() => done(r)}><Check className="h-3.5 w-3.5 text-emerald-600" /> Feito</button>
                      <button className="btn-ghost btn-icon h-8" title="Editar" onClick={() => setEdit({ ...r })}><Pencil className="h-4 w-4" /></button>
                      <button className="btn-ghost btn-icon h-8 text-red-600" title="Excluir" onClick={() => remove(r)}><Trash2 className="h-4 w-4" /></button>
                    </span>
                  ) : <span className="text-xs text-ink-faint">feito em {fmt(r.done_at)}</span>}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {edit && (
        <Modal open onClose={() => setEdit(null)} size="sm" title={edit.id ? 'Editar lembrete' : 'Novo lembrete'}
          footer={<><button className="btn-ghost" onClick={() => setEdit(null)}>Cancelar</button><button className="btn-primary" disabled={busy || (edit.title || '').trim().length < 2 || !edit.due_date} onClick={save}>Salvar</button></>}>
          <div className="space-y-3">
            <Input label="O que lembrar" placeholder="Ex.: Pagar o contador" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} autoFocus />
            <div className="grid grid-cols-2 gap-3">
              <Input label="Data" type="date" value={edit.due_date} onChange={(e) => setEdit({ ...edit, due_date: e.target.value })} />
              <Select label="Repetir" value={edit.repeat || 'nao'} onChange={(e) => setEdit({ ...edit, repeat: e.target.value })}>
                {Object.entries(REPEAT).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </Select>
            </div>
            <MoneyInput label="Valor (opcional)" value={edit.amount || 0} onChange={(v) => setEdit({ ...edit, amount: v })} />
            <Textarea label="Observação (opcional)" rows={2} value={edit.note || ''} onChange={(e) => setEdit({ ...edit, note: e.target.value })} />
            {edit.repeat && edit.repeat !== 'nao' && <p className="text-xs text-ink-faint">Quando você marcar como feito, o próximo é criado sozinho.</p>}
          </div>
        </Modal>
      )}
      {cfg && <AlertSettings company={company} setCompany={setCompany} onClose={() => { setCfg(false); load(); }} />}
    </div>
  );
}

function AlertSettings({ company, setCompany, onClose }) {
  const [run, busy] = useAction();
  const [f, setF] = useState({ ...company.settings.financeAlerts });
  const num = (k, min, max) => (e) => setF({ ...f, [k]: Math.max(min, Math.min(max, Number(e.target.value) || 0)) });
  const save = async () => {
    const r = await run(() => api.put('/company', { settings: { financeAlerts: f } }), 'Alertas ajustados');
    if (r !== FAIL) { setCompany(r); onClose(); }
  };
  return (
    <Modal open onClose={onClose} size="sm" title="Quando avisar"
      footer={<><button className="btn-ghost" onClick={onClose}>Cancelar</button><button className="btn-primary" disabled={busy} onClick={save}>Salvar</button></>}>
      <div className="space-y-3">
        <Input label="Avisar contas a pagar quantos dias antes" type="number" min={0} max={30} value={f.payDaysBefore} onChange={num('payDaysBefore', 0, 30)} hint="0 = só no dia do vencimento" />
        <Input label="Avisar contas a receber quantos dias antes" type="number" min={0} max={30} value={f.receiveDaysBefore} onChange={num('receiveDaysBefore', 0, 30)} />
        <Input label="Avisar caixa aberto depois de quantas horas" type="number" min={1} max={168} value={f.cashOpenHours} onChange={num('cashOpenHours', 1, 168)} />
        <Input label="Mostrar lembretes quantos dias antes" type="number" min={0} max={30} value={f.remindersDaysBefore} onChange={num('remindersDaysBefore', 0, 30)} />
      </div>
    </Modal>
  );
}
