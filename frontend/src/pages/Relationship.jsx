// Relacionamento: retornos de pós-venda, orçamentos sem resposta, garantias vencendo, manutenção e cobrança.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Phone, MessageCircle, CheckCircle2, CalendarClock, XCircle, HeartHandshake, Star } from 'lucide-react';
import { addDays, format } from 'date-fns';
import { api, qs } from '../lib/api';
import { fmt, fmtDateTime, waLink, docNumber } from '../lib/format';
import { useAuth, useSettings } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import { PageHeader, Tabs, Input, Textarea, Select, Loading, Empty, Modal, useAction, FAIL, cx } from '../components/ui';
import CustomerPicker from '../components/CustomerPicker';

export const FOLLOWUP_KIND = {
  pos_venda: { label: 'Pós-venda', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  orcamento: { label: 'Orçamento', cls: 'bg-sky-500/10 text-sky-700 dark:text-sky-300' },
  garantia_vencendo: { label: 'Garantia vencendo', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
  manutencao: { label: 'Manutenção', cls: 'bg-violet-500/10 text-violet-700 dark:text-violet-300' },
  cobranca: { label: 'Cobrança', cls: 'bg-red-500/10 text-red-700 dark:text-red-300' },
  outro: { label: 'Outro', cls: 'bg-muted text-ink-soft' },
};
const CHANNEL = { telefone: 'Telefone', whatsapp: 'WhatsApp', email: 'E-mail', presencial: 'Presencial', outro: 'Outro' };

export default function Relationship() {
  const settings = useSettings();
  const { company } = useAuth();
  const { confirm } = useUI();
  const [tab, setTab] = useState('hoje');
  const [kind, setKind] = useState('');
  const [list, setList] = useState(null);
  const [summary, setSummary] = useState(null);
  const [done, setDone] = useState(null);
  const [resched, setResched] = useState(null);
  const [cancel, setCancel] = useState(null);
  const [create, setCreate] = useState(false);
  const load = useCallback(() => {
    setList(null);
    api.get(`/relationship/followups${qs({ status: tab === 'todos' ? 'pendente' : tab, kind })}`).then(setList).catch(() => setList([]));
    api.get('/relationship/summary').then(setSummary).catch(() => {});
  }, [tab, kind]);
  useEffect(() => { load(); }, [load]);
  const whatsapp = async (f) => {
    const url = waLink(f.customer_phone, `Olá ${f.customer_name?.split(' ')[0] || ''}! Aqui é da ${company.trade_name || company.name}. `);
    if (!url) return;
    if (await confirm({ title: 'Abrir o WhatsApp?', danger: false, confirmText: 'Abrir', message: 'A conversa abre no seu WhatsApp; o TORVEN não envia mensagens sozinho. Depois registre o resultado do contato.' })) {
      window.open(url, '_blank', 'noopener');
    }
  };
  const today = format(new Date(), 'yyyy-MM-dd');
  return (
    <div>
      <PageHeader title="Relacionamento" subtitle="Retornos gerados a partir das OS, orçamentos, garantias e contas a receber — você faz o contato e registra o resultado"
        actions={<button className="btn-primary" onClick={() => setCreate(true)}><Plus className="h-4 w-4" /> Novo retorno</button>} />
      {summary && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-6">
          {Object.entries(FOLLOWUP_KIND).filter(([k]) => k !== 'outro').map(([k, v]) => {
            const x = summary.by_kind.find((y) => y.kind === k);
            return (
              <button key={k} onClick={() => { setKind(kind === k ? '' : k); setTab('todos'); }} className={cx('card p-3 text-left', kind === k && 'ring-2 ring-primary/40')}>
                <div className="text-[11px] text-ink-faint">{v.label}</div>
                <div className="mt-1 text-lg font-semibold tabular-nums">{x?.due || 0}<span className="text-xs font-normal text-ink-faint"> / {x?.pending || 0}</span></div>
              </button>
            );
          })}
          <div className="card p-3">
            <div className="flex items-center gap-1 text-[11px] text-ink-faint"><Star className="h-3 w-3" /> NPS (180 dias)</div>
            <div className="mt-1 text-lg font-semibold tabular-nums">{summary.nps.score ?? '—'}<span className="text-xs font-normal text-ink-faint"> · {summary.nps.answers} resp.</span></div>
          </div>
        </div>
      )}
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'hoje', label: 'Para hoje' }, { value: 'atrasados', label: 'Atrasados' }, { value: 'todos', label: 'Todos pendentes' },
        { value: 'feito', label: 'Feitos' }, { value: 'cancelado', label: 'Cancelados' },
      ]} />
      <div className="card overflow-hidden">
        {!list ? <Loading /> : !list.length ? <Empty icon={HeartHandshake} title="Nenhum retorno aqui" text="Os retornos são criados automaticamente após entregas, envios de orçamento, garantias perto do fim e contas vencidas." /> : (
          <ul className="divide-y divide-line">
            {list.map((f) => (
              <li key={f.id} className="flex flex-wrap items-start gap-3 p-4 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cx('chip', FOLLOWUP_KIND[f.kind]?.cls)}>{FOLLOWUP_KIND[f.kind]?.label}</span>
                    <b>{f.customer_name || '—'}</b>
                    <span className={cx('text-xs', f.status === 'pendente' && f.due_date < today ? 'text-red-600' : 'text-ink-faint')}>{f.status === 'pendente' ? `para ${fmt(f.due_date)}` : fmtDateTime(f.done_at)}</span>
                  </div>
                  <div className="mt-0.5">{f.title}
                    {f.order_id && <> · <Link to={`/os/${f.order_id}`} className="text-primary">{docNumber(settings, 'order', f.order_number)}</Link></>}
                    {f.quote_id && <> · <Link to={`/orcamentos/${f.quote_id}`} className="text-primary">{docNumber(settings, 'quote', f.quote_number)}</Link></>}
                  </div>
                  {f.result && <div className="mt-1 text-xs text-ink-soft">{f.channel && `${CHANNEL[f.channel]}: `}{f.result}{f.rating != null && ` · nota ${f.rating}`}{f.done_by_name && ` — ${f.done_by_name}`}</div>}
                  {f.customer_phone && f.status === 'pendente' && <div className="mt-1 flex items-center gap-1 text-xs text-ink-faint"><Phone className="h-3 w-3" />{f.customer_phone}</div>}
                </div>
                {f.status === 'pendente' && (
                  <div className="flex flex-wrap gap-1.5">
                    {f.customer_phone && <button className="btn-outline h-8 text-xs" onClick={() => whatsapp(f)}><MessageCircle className="h-3.5 w-3.5 text-emerald-600" /> WhatsApp</button>}
                    <button className="btn-primary h-8 text-xs" onClick={() => setDone(f)}><CheckCircle2 className="h-3.5 w-3.5" /> Registrar contato</button>
                    <button className="btn-ghost btn-icon h-8" title="Reagendar" aria-label="Reagendar" onClick={() => setResched({ ...f, date: format(addDays(new Date(), 3), 'yyyy-MM-dd') })}><CalendarClock className="h-4 w-4" /></button>
                    <button className="btn-ghost btn-icon h-8 text-red-600" title="Cancelar" aria-label="Cancelar" onClick={() => setCancel({ ...f, reason: '' })}><XCircle className="h-4 w-4" /></button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {done && <DoneModal f={done} onClose={() => setDone(null)} onDone={() => { setDone(null); load(); }} />}
      {resched && <SimpleAction title="Reagendar retorno" f={resched} onClose={() => setResched(null)} onDone={load}
        body={(x, setX) => <Input label="Nova data" type="date" value={x.date} onChange={(e) => setX({ ...x, date: e.target.value })} />}
        call={(x) => api.post(`/relationship/followups/${x.id}/reschedule`, { due_date: x.date })} valid={(x) => !!x.date} />}
      {cancel && <SimpleAction title="Cancelar retorno" f={cancel} onClose={() => setCancel(null)} onDone={load} danger
        body={(x, setX) => <Input label="Motivo" value={x.reason} onChange={(e) => setX({ ...x, reason: e.target.value })} />}
        call={(x) => api.post(`/relationship/followups/${x.id}/cancel`, { reason: x.reason })} valid={(x) => x.reason.trim().length >= 3} />}
      {create && <CreateModal onClose={() => setCreate(false)} onDone={() => { setCreate(false); load(); }} />}
    </div>
  );
}

function SimpleAction({ title, f, body, call, valid, onClose, onDone, danger }) {
  const [run, busy] = useAction();
  const [x, setX] = useState(f);
  const go = async () => { if ((await run(() => call(x), 'Pronto')) !== FAIL) { onClose(); onDone(); } };
  return (
    <Modal open onClose={onClose} size="sm" title={title} subtitle={f.title}
      footer={<><button className="btn-ghost" onClick={onClose}>Voltar</button><button className={danger ? 'btn-danger' : 'btn-primary'} disabled={busy || !valid(x)} onClick={go}>Confirmar</button></>}>
      {body(x, setX)}
    </Modal>
  );
}

function DoneModal({ f, onClose, onDone }) {
  const [run, busy] = useAction();
  const [d, setD] = useState({ channel: 'telefone', result: '', rating: '', next_due_date: '' });
  const go = async () => {
    const r = await run(() => api.post(`/relationship/followups/${f.id}/done`, { ...d, rating: d.rating === '' ? null : Number(d.rating), next_due_date: d.next_due_date || null }), 'Contato registrado');
    if (r !== FAIL) onDone();
  };
  return (
    <Modal open onClose={onClose} title="Registrar contato" subtitle={`${f.customer_name || ''} · ${f.title}`}
      footer={<><button className="btn-ghost" onClick={onClose}>Voltar</button><button className="btn-primary" disabled={busy || d.result.trim().length < 3} onClick={go}>Salvar</button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label="Como foi o contato" value={d.channel} onChange={(e) => setD({ ...d, channel: e.target.value })}>{Object.entries(CHANNEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
        {f.kind === 'pos_venda' ? (
          <Select label="Nota do cliente (0 a 10)" value={d.rating} onChange={(e) => setD({ ...d, rating: e.target.value })}>
            <option value="">Não perguntou</option>{Array.from({ length: 11 }, (_, i) => <option key={i} value={i}>{i}</option>)}
          </Select>
        ) : <div />}
        <Textarea label="O que foi conversado" rows={3} value={d.result} onChange={(e) => setD({ ...d, result: e.target.value })} className="sm:col-span-2" />
        <Input label="Novo retorno em (opcional)" type="date" value={d.next_due_date} onChange={(e) => setD({ ...d, next_due_date: e.target.value })} />
      </div>
    </Modal>
  );
}

function CreateModal({ onClose, onDone }) {
  const [run, busy] = useAction();
  const [d, setD] = useState({ customer: null, kind: 'outro', title: '', due_date: format(addDays(new Date(), 1), 'yyyy-MM-dd') });
  const go = async () => {
    const r = await run(() => api.post('/relationship/followups', { customer_id: d.customer.id, kind: d.kind, title: d.title, due_date: d.due_date }), 'Retorno agendado');
    if (r !== FAIL) onDone();
  };
  return (
    <Modal open onClose={onClose} title="Novo retorno"
      footer={<><button className="btn-ghost" onClick={onClose}>Voltar</button><button className="btn-primary" disabled={busy || !d.customer || d.title.trim().length < 3} onClick={go}>Agendar</button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><CustomerPicker value={d.customer} onChange={(c) => setD({ ...d, customer: c })} /></div>
        <Select label="Tipo" value={d.kind} onChange={(e) => setD({ ...d, kind: e.target.value })}>{Object.entries(FOLLOWUP_KIND).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select>
        <Input label="Data" type="date" value={d.due_date} onChange={(e) => setD({ ...d, due_date: e.target.value })} />
        <Input label="Assunto" value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} className="sm:col-span-2" />
      </div>
    </Modal>
  );
}
