// Atendimento › WhatsApp: pedidos que o agente registrou (aprovar vira OS e horário na agenda) e as conversas com os clientes.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { MessageCircle, Check, X, Bot, UserRound, Send, CalendarClock, Car, ArrowLeft, Settings2 } from 'lucide-react';
import { api } from '../lib/api';
import { fmt, fmtDateTime, toLocalInput } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import { useCatalog } from '../context/CatalogContext';
import { PageHeader, Tabs, Input, Select, Toggle, Modal, Loading, Empty, useAction, FAIL, cx } from '../components/ui';
import CustomerPicker from '../components/CustomerPicker';

const phoneText = (p) => {
  const d = String(p || '').replace(/\D/g, '');
  return d.length >= 12 ? `(${d.slice(2, 4)}) ${d.slice(4, -4)}-${d.slice(-4)}` : p;
};
const bold = (t) => String(t || '').split(/(\*[^*]+\*)/g).map((x, i) => (/^\*[^*]+\*$/.test(x) ? <b key={i}>{x.slice(1, -1)}</b> : x));

export default function WhatsApp() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('aba') || 'pedidos';
  const [requests, setRequests] = useState(null);
  const [approve, setApprove] = useState(null);
  const [reject, setReject] = useState(null);
  const loadReq = useCallback(() => api.get('/whatsapp/requests').then(setRequests).catch(() => setRequests([])), []);
  useEffect(() => { loadReq(); const t = setInterval(loadReq, 20000); return () => clearInterval(t); }, [loadReq]);
  const openConv = (id) => setParams({ aba: 'conversas', c: id });
  return (
    <div>
      <PageHeader title="Atendimento pelo WhatsApp" subtitle="Pedidos que o agente registrou e as conversas com os clientes" />
      <Tabs value={tab} onChange={(t) => setParams({ aba: t })} tabs={[
        { value: 'pedidos', label: `Pedidos para aprovar${requests?.length ? ` (${requests.length})` : ''}` },
        { value: 'conversas', label: 'Conversas' },
      ]} />
      {tab === 'pedidos' && <Requests list={requests} onApprove={setApprove} onReject={setReject} onOpen={openConv} />}
      {tab === 'conversas' && <Conversations selected={params.get('c')} onSelect={openConv} onApprove={setApprove} onReject={setReject} />}
      {approve && <ApproveModal req={approve} onClose={() => setApprove(null)} onDone={() => { setApprove(null); loadReq(); }} />}
      {reject && <RejectModal req={reject} onClose={() => setReject(null)} onDone={() => { setReject(null); loadReq(); }} />}
    </div>
  );
}

function SetupHint() {
  const { can } = useAuth();
  return (
    <p className="mb-4 rounded-app-sm border border-line bg-muted/50 p-3 text-sm text-ink-soft">
      Os pedidos chegam aqui quando o WhatsApp está ligado.{' '}
      {can('integrations') ? <Link className="inline-flex items-center gap-1 text-primary" to="/configuracoes?tab=integracoes"><Settings2 className="h-3.5 w-3.5" /> Configurar o WhatsApp e testar o agente</Link>
        : 'Peça ao administrador para ligar em Configurações › Integrações.'}
    </p>
  );
}

function RequestCard({ r, onApprove, onReject, onOpen }) {
  return (
    <li className="card p-4" aria-label={`Pedido nº ${r.number}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="chip bg-emerald-500/10 text-emerald-700"><MessageCircle className="h-3 w-3" /> Pedido nº {r.number}</span>
        {r.requested_start ? <span className="chip bg-primary/10 text-primary"><CalendarClock className="h-3 w-3" /> {fmt(r.requested_start, "EEE dd/MM 'às' HH:mm")}</span>
          : <span className="chip bg-muted text-ink-soft">Sem horário</span>}
        <span className="ml-auto text-xs text-ink-faint">{fmtDateTime(r.created_at)}</span>
      </div>
      <div className="mt-2 font-medium">{r.customer_name || r.contact_name || 'Cliente sem nome'} <span className="text-sm font-normal text-ink-faint">· {r.contact_phone}</span></div>
      {!r.customer_id && <div className="text-xs text-amber-700">Cliente novo: o cadastro é feito ao aprovar.</div>}
      {r.plate && <div className="mt-1 inline-flex items-center gap-1 text-sm"><Car className="h-3.5 w-3.5 text-ink-faint" /> {r.plate}</div>}
      <p className="mt-1 whitespace-pre-wrap text-sm text-ink-soft">{(r.description || r.title).split('\n')[0].replace(/^Relato do cliente: /, '')}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button className="btn-primary h-9" onClick={() => onApprove(r)}><Check className="h-4 w-4" /> Aprovar</button>
        <button className="btn-outline h-9" onClick={() => onReject(r)}><X className="h-4 w-4" /> Recusar</button>
        {onOpen && <button className="btn-ghost h-9" onClick={() => onOpen(r.conversation_id)}>Ver conversa</button>}
      </div>
    </li>
  );
}

function Requests({ list, onApprove, onReject, onOpen }) {
  if (!list) return <Loading />;
  return (
    <div>
      {!list.length && <SetupHint />}
      {!list.length ? <div className="card"><Empty icon={MessageCircle} title="Nenhum pedido esperando" text="Quando um cliente pedir serviço ou horário pelo WhatsApp, o pedido aparece aqui para você aprovar." /></div> : (
        <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {list.map((r) => <RequestCard key={r.id} r={r} onApprove={onApprove} onReject={onReject} onOpen={onOpen} />)}
        </ul>
      )}
    </div>
  );
}

function ApproveModal({ req, onClose, onDone }) {
  const [run, busy] = useAction();
  const { toast } = useUI();
  const { can } = useAuth();
  const { technicians } = useCatalog();
  const [customer, setCustomer] = useState(null);
  const [f, setF] = useState({
    schedule: !!req.requested_start && can('schedule_manage'), starts_at: toLocalInput(req.requested_start || new Date(Date.now() + 86400000)),
    minutes: 60, technician_id: '', notify: true,
  });
  const go = async (force = false) => {
    const body = {
      customer_id: customer?.id || null, technician_id: f.technician_id || null, notify: f.notify, force,
      starts_at: f.schedule && f.starts_at ? new Date(f.starts_at).toISOString() : null, minutes: Number(f.minutes) || 60,
    };
    const r = await run(() => api.post(`/whatsapp/requests/${req.id}/approve`, body), null);
    if (r === FAIL) return;
    toast(`OS nº ${r.number} aberta${r.schedule_id ? ' e horário marcado na agenda' : ''}.`);
    if (r.notified && !r.notified.sent) toast(`O cliente não foi avisado: ${r.notified.error}`, 'error');
    onDone(r);
  };
  return (
    <Modal open onClose={onClose} size="lg" title={`Aprovar pedido nº ${req.number}`} subtitle={`${req.customer_name || req.contact_name || ''} · ${req.contact_phone}`}
      footer={<><button className="btn-ghost" onClick={onClose}>Voltar</button><button className="btn-primary" disabled={busy} onClick={() => go()}><Check className="h-4 w-4" /> Aprovar e abrir OS</button></>}>
      <div className="space-y-4 text-sm">
        <p className="rounded-app-sm bg-muted/60 p-3 text-ink-soft">Ao aprovar, o sistema abre a <b>OS</b>{req.plate ? <> do veículo <b>{req.plate}</b></> : ''}{f.schedule ? ', marca o horário na agenda' : ''} e{f.notify ? ' avisa o cliente pelo WhatsApp' : ' não avisa o cliente'}.</p>
        {!req.customer_id && (
          <div>
            <CustomerPicker value={customer} onChange={setCustomer} label="Cliente já cadastrado?" optional />
            {!customer && <p className="mt-1 text-xs text-ink-faint">Se deixar em branco, cadastramos “{req.contact_name || 'Cliente do WhatsApp'}” com o telefone {req.contact_phone}.</p>}
          </div>
        )}
        <Select label="Técnico responsável (opcional)" value={f.technician_id} onChange={(e) => setF({ ...f, technician_id: e.target.value })}>
          <option value="">A definir</option>
          {technicians.filter((t) => t.active !== false).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>
        {can('schedule_manage') && (
          <div className="space-y-2 rounded-app-sm border border-line p-3">
            <Toggle checked={f.schedule} onChange={(v) => setF({ ...f, schedule: v })} label="Marcar o horário na agenda" />
            {f.schedule && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Input label="Dia e hora" type="datetime-local" value={f.starts_at} onChange={(e) => setF({ ...f, starts_at: e.target.value })} />
                <Select label="Duração" value={String(f.minutes)} onChange={(e) => setF({ ...f, minutes: e.target.value })}>
                  {[30, 60, 90, 120, 180, 240, 480].map((m) => <option key={m} value={m}>{m < 60 ? `${m} min` : `${m / 60} h`}</option>)}
                </Select>
              </div>
            )}
          </div>
        )}
        <Toggle checked={f.notify} onChange={(v) => setF({ ...f, notify: v })} label="Avisar o cliente pelo WhatsApp" hint="Manda a confirmação com o número da OS e o horário." />
      </div>
    </Modal>
  );
}

function RejectModal({ req, onClose, onDone }) {
  const [run, busy] = useAction();
  const [reason, setReason] = useState('Infelizmente não conseguimos atender esse pedido no momento.');
  const [notify, setNotify] = useState(true);
  const go = async () => { const r = await run(() => api.post(`/whatsapp/requests/${req.id}/reject`, { reason, notify }), 'Pedido recusado'); if (r !== FAIL) onDone(); };
  return (
    <Modal open onClose={onClose} title={`Recusar pedido nº ${req.number}`}
      footer={<><button className="btn-ghost" onClick={onClose}>Voltar</button><button className="btn-danger" disabled={busy || reason.trim().length < 3} onClick={go}>Recusar</button></>}>
      <div className="space-y-3">
        <Input label="Motivo (vai para o cliente se avisar)" value={reason} onChange={(e) => setReason(e.target.value)} />
        <Toggle checked={notify} onChange={setNotify} label="Avisar o cliente pelo WhatsApp" />
      </div>
    </Modal>
  );
}

function Conversations({ selected, onSelect, onApprove, onReject }) {
  const [list, setList] = useState(null);
  const [filter, setFilter] = useState('');
  const [search, setSearch] = useState('');
  const load = useCallback(() => api.get(`/whatsapp/conversations?filter=${filter}&search=${encodeURIComponent(search)}`).then(setList).catch(() => setList([])), [filter, search]);
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);
  if (!list) return <Loading />;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
      <div className={cx('card self-start overflow-hidden', selected && 'max-lg:hidden')}>
        <div className="space-y-2 border-b border-line p-3">
          <input className="input h-9" placeholder="Buscar nome ou telefone" aria-label="Buscar conversa" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="flex gap-1.5">
            {[['', 'Todas'], ['humano', 'Com a equipe'], ['nao_lidas', 'Não lidas']].map(([k, l]) => (
              <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}
                className={cx('rounded-full border px-3 py-1 text-xs', filter === k ? 'border-primary bg-primary/10 text-primary' : 'border-line text-ink-soft')}>{l}</button>
            ))}
          </div>
        </div>
        {!list.length ? <><div className="p-3"><SetupHint /></div><Empty icon={MessageCircle} title="Nenhuma conversa" /></> : (
          <ul className="max-h-[70vh] divide-y divide-line overflow-y-auto">
            {list.map((c) => (
              <li key={c.id}>
                <button onClick={() => onSelect(c.id)} className={cx('block w-full p-3 text-left hover:bg-muted', selected === c.id && 'bg-primary/10')}>
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate font-medium">{c.customer_name || c.name || phoneText(c.phone)}</span>
                    {c.simulated && <span className="chip bg-muted text-[10px] text-ink-faint">teste</span>}
                    {c.mode === 'humano' && <span className="chip bg-amber-500/15 text-[10px] text-amber-800">equipe</span>}
                    {c.unread > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-emerald-600 px-1 text-[11px] font-bold text-white">{c.unread}</span>}
                  </div>
                  <div className="truncate text-xs text-ink-faint">{String(c.last_body || '').replace(/\*/g, '')}</div>
                  <div className="text-[11px] text-ink-faint">{fmtDateTime(c.last_message_at)}{c.pending_requests > 0 && <b className="text-primary"> · {c.pending_requests} pedido(s)</b>}</div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {selected ? <Chat id={selected} onBack={() => onSelect('')} onChanged={load} onApprove={onApprove} onReject={onReject} />
        : <div className="card max-lg:hidden"><Empty icon={MessageCircle} title="Escolha uma conversa" /></div>}
    </div>
  );
}

function Chat({ id, onBack, onChanged, onApprove, onReject }) {
  const [run, busy] = useAction();
  const { can } = useAuth();
  const [c, setC] = useState(null);
  const [text, setText] = useState('');
  const box = useRef(null);
  const load = useCallback(() => api.get(`/whatsapp/conversations/${id}`).then(setC).catch(() => setC(false)), [id]);
  useEffect(() => { setC(null); load().then(onChanged); const t = setInterval(load, 10000); return () => clearInterval(t); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { box.current?.scrollTo({ top: box.current.scrollHeight }); }, [c?.messages?.length]);
  if (c === null) return <div className="card"><Loading /></div>;
  if (c === false) return <div className="card"><Empty title="Conversa não encontrada" /></div>;
  const send = async () => {
    const r = await run(() => api.post(`/whatsapp/conversations/${id}/reply`, { text }), null);
    if (r !== FAIL) { setText(''); load(); onChanged(); }
  };
  const mode = async (m) => { const r = await run(() => api.post(`/whatsapp/conversations/${id}/mode`, { mode: m }), m === 'humano' ? 'Você assumiu a conversa' : 'O agente voltou a responder'); if (r !== FAIL) { load(); onChanged(); } };
  const pending = c.requests.filter((r) => r.status === 'nova');
  return (
    <div className="card flex min-h-[60vh] min-w-0 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <button className="btn-ghost h-8 w-8 p-0 lg:hidden" onClick={onBack} aria-label="Voltar para a lista"><ArrowLeft className="h-4 w-4" /></button>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{c.customer_name || c.name || phoneText(c.phone)}</div>
          <div className="text-xs text-ink-faint">{phoneText(c.phone)}{c.customer_name ? ' · cliente cadastrado' : ' · não cadastrado'}{c.simulated && ' · conversa de teste'}</div>
        </div>
        {c.mode === 'agente'
          ? <button className="btn-outline h-8 text-xs" disabled={busy} onClick={() => mode('humano')}><UserRound className="h-3.5 w-3.5" /> Assumir conversa</button>
          : <button className="btn-outline h-8 text-xs" disabled={busy} onClick={() => mode('agente')}><Bot className="h-3.5 w-3.5" /> Devolver ao agente</button>}
      </div>
      <div className={cx('px-4 py-1.5 text-xs', c.mode === 'humano' ? 'bg-amber-500/10 text-amber-800' : 'bg-emerald-500/10 text-emerald-800')}>
        {c.mode === 'humano' ? 'A equipe está atendendo: o agente não responde nesta conversa.' : 'O agente automático está respondendo esta conversa.'}
      </div>
      {pending.map((r) => (
        <div key={r.id} className="flex flex-wrap items-center gap-2 border-b border-line bg-primary/5 px-4 py-2 text-sm">
          <span className="min-w-0 flex-1">Pedido nº <b>{r.number}</b>{r.requested_start && <> para <b>{fmt(r.requested_start, "dd/MM 'às' HH:mm")}</b></>} aguardando aprovação</span>
          <button className="btn-primary h-8 text-xs" onClick={() => onApprove({ ...r, contact_phone: phoneText(c.phone), contact_name: c.name, customer_id: c.customer_id, customer_name: c.customer_name })}>Aprovar</button>
          <button className="btn-ghost h-8 text-xs" onClick={() => onReject(r)}>Recusar</button>
        </div>
      ))}
      <div ref={box} className="flex-1 space-y-2 overflow-y-auto bg-[#efeae2] p-4 dark:bg-zinc-900" style={{ maxHeight: '60vh' }}>
        {c.messages.map((m) => (
          <div key={m.id} className={cx('max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm shadow-sm', m.direction === 'in' ? 'bg-white text-zinc-900' : 'ml-auto bg-[#d9fdd3] text-zinc-900')}>
            {m.direction === 'out' && <div className="mb-0.5 text-[10px] font-semibold text-emerald-800">{m.author === 'agente' ? 'Agente automático' : m.user_name || 'Equipe'}</div>}
            {bold(m.body)}
            <div className="mt-0.5 text-right text-[10px] text-zinc-500">{fmt(m.created_at, 'dd/MM HH:mm')}{m.status === 'falhou' && <span className="text-red-600"> · não enviada</span>}{m.status === 'simulado' && ' · teste'}</div>
          </div>
        ))}
      </div>
      {can('requests_manage') && (
        c.window_open ? (
          <div className="flex gap-2 border-t border-line p-3">
            <textarea className="input min-h-[44px] min-w-0 flex-1 resize-none" rows={2} placeholder="Escreva a resposta" aria-label="Resposta" value={text}
              onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (text.trim()) send(); } }} />
            <button className="btn-primary self-end" disabled={busy || !text.trim()} onClick={send} aria-label="Enviar resposta"><Send className="h-4 w-4" /></button>
          </div>
        ) : <p className="border-t border-line p-3 text-xs text-ink-faint">Passaram mais de 24 horas desde a última mensagem do cliente. Pela regra do WhatsApp, só dá para responder quando ele escrever de novo.</p>
      )}
    </div>
  );
}
