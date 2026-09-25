// Solicitações: entrada do atendimento → triagem/visita → diagnóstico → orçamento ou OS.
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Plus, Search, Inbox, CalendarClock, Stethoscope, FileText, ClipboardList, XCircle, RotateCcw, Save, Pencil, MessageSquare, Phone, MapPin, Send,
} from 'lucide-react';
import { api, qs } from '../lib/api';
import { fmt, fmtDateTime, money, REQUEST_STATUS, OPEN_REQUEST, CHANNELS, PRIORITY, docNumber, maskPhone, toLocalInput } from '../lib/format';
import { useAuth, useSettings } from '../context/AuthContext';
import { useCatalog } from '../context/CatalogContext';
import { useUI } from '../context/UIContext';
import { PageHeader, Input, Textarea, Select, Loading, Empty, Modal, useAction, FAIL, cx } from '../components/ui';
import CustomerPicker, { EquipmentPicker } from '../components/CustomerPicker';
import Attachments from '../components/Attachments';
import { useTable, SortTh, Pager } from '../components/Table';

export const RequestBadge = ({ status }) => <span className={cx('chip whitespace-nowrap', REQUEST_STATUS[status]?.cls)}>{REQUEST_STATUS[status]?.label || status}</span>;

export default function Requests() {
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const settings = useSettings();
  const { can } = useAuth();
  const [f, setF] = useState({ search: '', status: params.get('status') || 'abertas', channel: '' });
  const [list, setList] = useState(null);
  const load = useCallback(() => api.get(`/requests${qs(f)}`).then(setList).catch(() => setList([])), [f]);
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);
  useEffect(() => { const s = params.get('status'); if (s && s !== f.status) setF((x) => ({ ...x, status: s })); }, [params]); // eslint-disable-line
  const t = useTable(list, { get: { customer: (r) => r.customer_name, prio: (r) => ['urgente', 'alta', 'normal', 'baixa'].indexOf(r.priority) } });
  const counts = (list || []).reduce((a, r) => ({ ...a, [r.status]: (a[r.status] || 0) + 1 }), {});

  return (
    <div>
      <PageHeader title="Solicitações" subtitle="Tudo que chega pelo telefone, WhatsApp, e-mail ou balcão — da triagem ao orçamento ou OS"
        actions={can('requests_manage') && <Link to="/solicitacoes/nova" className="btn-primary"><Plus className="h-4 w-4" /> Nova solicitação</Link>} />
      {f.status === 'abertas' && list && (
        <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
          {OPEN_REQUEST.map((s) => (
            <button key={s} onClick={() => { setF({ ...f, status: s }); setParams({ status: s }); }} className="card p-3 text-left hover:border-primary/40">
              <div className="flex items-center gap-1.5 text-[11px] text-ink-faint"><span className={cx('h-2 w-2 rounded-full', REQUEST_STATUS[s].dot)} />{REQUEST_STATUS[s].label}</div>
              <div className="mt-1 text-lg font-semibold tabular-nums">{counts[s] || 0}</div>
            </button>
          ))}
        </div>
      )}
      <div className="card mb-4 flex flex-wrap items-end gap-3 p-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <input className="input pl-9" placeholder="Nº, pedido ou cliente…" value={f.search} onChange={(e) => setF({ ...f, search: e.target.value })} />
        </div>
        <select className="input w-48" value={f.status} onChange={(e) => { setF({ ...f, status: e.target.value }); setParams(e.target.value ? { status: e.target.value } : {}); }} aria-label="Situação">
          <option value="abertas">Em aberto</option><option value="">Todas</option>
          {Object.entries(REQUEST_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select className="input w-40" value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })} aria-label="Canal">
          <option value="">Todos os canais</option>{Object.entries(CHANNELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <div className="card overflow-hidden">
        {!list ? <Loading /> : !list.length ? (
          <Empty icon={Inbox} title="Nenhuma solicitação" text="Registre cada pedido de cliente para acompanhar triagem, visita, orçamento e conversão."
            action={can('requests_manage') && <Link to="/solicitacoes/nova" className="btn-primary"><Plus className="h-4 w-4" /> Registrar solicitação</Link>} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="table-clean">
                <thead><tr>
                  <SortTh t={t} k="number">Nº</SortTh><SortTh t={t} k="customer">Pedido</SortTh>
                  <SortTh t={t} k="channel" className="hidden md:table-cell">Canal</SortTh><SortTh t={t} k="prio" className="hidden md:table-cell">Prioridade</SortTh>
                  <SortTh t={t} k="created_at" className="hidden lg:table-cell">Entrada</SortTh><SortTh t={t} k="status">Situação</SortTh>
                </tr></thead>
                <tbody>
                  {t.rows.map((r) => (
                    <tr key={r.id} className="cursor-pointer" onClick={() => nav(`/solicitacoes/${r.id}`)}>
                      <td className="whitespace-nowrap font-medium tabular-nums">{docNumber(settings, 'request', r.number)}</td>
                      <td>
                        <div className="max-w-[340px] truncate">{r.title}</div>
                        <div className="max-w-[340px] truncate text-xs text-ink-faint">{r.customer_name || '—'}{r.equipment_description && ` · ${r.equipment_description}`}</div>
                      </td>
                      <td className="hidden text-ink-soft md:table-cell">{CHANNELS[r.channel]}</td>
                      <td className={cx('hidden md:table-cell', PRIORITY[r.priority]?.cls)}>{PRIORITY[r.priority]?.label}</td>
                      <td className="hidden whitespace-nowrap text-ink-soft lg:table-cell">{fmt(r.created_at, 'dd/MM/yy HH:mm')}</td>
                      <td>
                        <RequestBadge status={r.status} />
                        {r.status === 'visita_agendada' && r.visit_at && <div className="mt-0.5 text-xs text-ink-faint">{fmt(r.visit_at, 'dd/MM HH:mm')}{r.visit_technician_name && ` · ${r.visit_technician_name}`}</div>}
                        {r.quote_number && <div className="mt-0.5 text-xs text-ink-faint">{docNumber(settings, 'quote', r.quote_number)}{r.quote_total != null && ` · ${money(r.quote_total)}`}</div>}
                        {r.order_number && <div className="mt-0.5 text-xs text-ink-faint">{docNumber(settings, 'order', r.order_number)}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager t={t} />
          </>
        )}
      </div>
    </div>
  );
}

const blank = { customer: null, contact_name: '', contact_phone: '', contact_email: '', channel: 'telefone', equipment_id: null, equipment: null, title: '', description: '', service_location: 'oficina', address: '', desired_date: '', priority: 'normal' };

function RequestForm({ initial, onSaved, onCancel }) {
  const [run, busy] = useAction();
  const [f, setF] = useState(initial || blank);
  const [addresses, setAddresses] = useState([]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));
  useEffect(() => {
    if (!f.customer?.id) { setAddresses([]); return; }
    api.get(`/customers/${f.customer.id}`).then((c) => setAddresses(c.addresses || [])).catch(() => {});
  }, [f.customer?.id]);
  const save = async () => {
    const body = {
      customer_id: f.customer?.id || null, contact_name: f.contact_name, contact_phone: f.contact_phone, contact_email: f.contact_email || null,
      channel: f.channel, equipment_id: f.equipment_id || null, equipment: f.equipment?.description ? f.equipment : null, title: f.title,
      description: f.description, service_location: f.service_location, address: f.address, desired_date: f.desired_date || null, priority: f.priority,
    };
    const r = await run(() => (initial?.id ? api.put(`/requests/${initial.id}`, body) : api.post('/requests', body)), 'Solicitação salva');
    if (r !== FAIL) onSaved(r);
  };
  return (
    <div className="space-y-6">
      <section className="card space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <Select label="Canal de entrada" value={f.channel} onChange={set('channel')}>{Object.entries(CHANNELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
          <Select label="Prioridade" value={f.priority} onChange={set('priority')}>{Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select>
          <Input label="Data desejada" type="date" value={f.desired_date || ''} onChange={set('desired_date')} />
        </div>
        <CustomerPicker value={f.customer} onChange={(c) => setF({ ...f, customer: c, equipment_id: null, equipment: null })} label="Cliente (se já cadastrado)" optional />
        {!f.customer && (
          <div className="grid gap-4 rounded-app-sm border border-dashed border-line p-3 sm:grid-cols-3">
            <Input label="Nome do contato" value={f.contact_name} onChange={set('contact_name')} />
            <Input label="Telefone" value={f.contact_phone} onChange={(e) => setF({ ...f, contact_phone: maskPhone(e.target.value) })} />
            <Input label="E-mail" type="email" value={f.contact_email} onChange={set('contact_email')} />
            <p className="text-xs text-ink-faint sm:col-span-3">Sem cadastro ainda? Registre o contato; o cliente pode ser cadastrado depois, antes de orçar.</p>
          </div>
        )}
        {f.customer && <EquipmentPicker customerId={f.customer.id} value={f.equipment_id} onChange={set('equipment_id')} newEquipment={f.equipment} onNewEquipment={(e) => setF((x) => ({ ...x, equipment: e }))} />}
      </section>
      <section className="card space-y-4 p-5">
        <Input label="O que o cliente precisa (resumo)" value={f.title} onChange={set('title')} placeholder="Ex.: Portão basculante não fecha" />
        <Textarea label="Relato do cliente / detalhes" rows={4} value={f.description} onChange={set('description')} />
        <div className="grid gap-4 sm:grid-cols-3">
          <Select label="Local do serviço" value={f.service_location} onChange={set('service_location')}>
            <option value="oficina">Na oficina</option><option value="externo">No cliente (externo)</option>
          </Select>
          {f.service_location === 'externo' && (
            <div className="sm:col-span-2">
              {addresses.filter((a) => a.kind !== 'cobranca').length > 0 && (
                <Select label="Endereço cadastrado" value="" onChange={(e) => { const a = addresses.find((x) => x.id === e.target.value); if (a) setF({ ...f, address: [a.street, a.number, a.district, a.city && `${a.city}/${a.uf || ''}`].filter(Boolean).join(', ') }); }}>
                  <option value="">Escolher…</option>
                  {addresses.filter((a) => a.kind !== 'cobranca').map((a) => <option key={a.id} value={a.id}>{a.label || a.kind} — {a.street}, {a.number}</option>)}
                </Select>
              )}
              <Input label="Endereço de execução" value={f.address} onChange={set('address')} className="mt-2" />
            </div>
          )}
        </div>
      </section>
      <div className="action-bar">
        <div className="mx-auto flex max-w-[1400px] items-center justify-end gap-3 px-4 py-3 sm:px-8">
          <button className="btn-ghost" onClick={onCancel}>Voltar</button>
          <button className="btn-primary" disabled={busy || f.title.trim().length < 3 || (!f.customer && f.contact_name.trim().length < 2)} onClick={save}><Save className="h-4 w-4" /> Salvar solicitação</button>
        </div>
      </div>
    </div>
  );
}

export function RequestNew() {
  const nav = useNavigate();
  return (
    <div>
      <PageHeader title="Nova solicitação" subtitle="Registre o pedido como chegou; triagem, visita e orçamento vêm depois" />
      <RequestForm onSaved={(r) => nav(`/solicitacoes/${r.id}`, { replace: true })} onCancel={() => nav('/solicitacoes')} />
    </div>
  );
}

export function RequestDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const settings = useSettings();
  const { can } = useAuth();
  const { toast } = useUI();
  const [run, busy] = useAction();
  const [r, setR] = useState(null);
  const [edit, setEdit] = useState(false);
  const [modal, setModal] = useState(null);
  const [note, setNote] = useState('');
  const load = useCallback(() => api.get(`/requests/${id}`).then(setR).catch((e) => { toast(e.message, 'error'); nav('/solicitacoes'); }), [id]); // eslint-disable-line
  useEffect(() => { load(); }, [load]);
  if (!r) return <Loading />;
  const manage = can('requests_manage');
  const open = OPEN_REQUEST.includes(r.status);
  const act = async (fn, msg, after) => { const x = await run(fn, msg); if (x !== FAIL) { if (after) after(x); else setR(x); } return x; };

  if (edit) {
    return (
      <div>
        <PageHeader title={`Editar solicitação ${docNumber(settings, 'request', r.number)}`} />
        <RequestForm initial={{
          ...blank, ...r, customer: r.customer_id ? { id: r.customer_id, name: r.customer_name, phone: r.customer_phone } : null,
          contact_name: r.contact_name || '', contact_phone: r.contact_phone || '', contact_email: r.contact_email || '', description: r.description || '',
          address: r.address || '', desired_date: r.desired_date || '', equipment: null,
        }} onSaved={(x) => { setR(x); setEdit(false); }} onCancel={() => setEdit(false)} />
      </div>
    );
  }

  const quoteBlocked = r.quote_id && !['recusado', 'vencido'].includes(r.quote_status);
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Solicitação {docNumber(settings, 'request', r.number)}</h1>
            <RequestBadge status={r.status} />
            <span className={cx('text-sm', PRIORITY[r.priority]?.cls)}>{PRIORITY[r.priority]?.label}</span>
          </div>
          <p className="mt-0.5 text-sm text-ink-faint">{CHANNELS[r.channel]} · {fmtDateTime(r.created_at)}{r.created_by_name && ` · ${r.created_by_name}`}{r.unit_name && ` · ${r.unit_name}`}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {manage && open && <button className="btn-outline" onClick={() => setEdit(true)}><Pencil className="h-4 w-4" /> Editar</button>}
          {manage && open && ['nova', 'em_triagem', 'visita_agendada', 'diagnosticada'].includes(r.status) && <button className="btn-outline" onClick={() => setModal('visit')}><CalendarClock className="h-4 w-4" /> {r.visit_at ? 'Reagendar visita' : 'Agendar visita'}</button>}
          {manage && open && <button className="btn-outline" onClick={() => setModal('diagnosis')}><Stethoscope className="h-4 w-4" /> Diagnóstico</button>}
          {can('quotes') && open && !quoteBlocked && <button className="btn-primary" disabled={busy} onClick={() => act(() => api.post(`/requests/${r.id}/quote`), 'Orçamento criado', (x) => nav(`/orcamentos/${x.quote_id}`))}><FileText className="h-4 w-4" /> Criar orçamento</button>}
          {r.quote_id && <Link to={`/orcamentos/${r.quote_id}`} className="btn-outline"><FileText className="h-4 w-4" /> {docNumber(settings, 'quote', r.quote_number)}</Link>}
          {can('orders_create') && open && !quoteBlocked && <button className="btn-outline" disabled={busy} onClick={() => setModal('order')}><ClipboardList className="h-4 w-4" /> Gerar OS direta</button>}
          {r.order_id && <Link to={`/os/${r.order_id}`} className="btn-primary"><ClipboardList className="h-4 w-4" /> {docNumber(settings, 'order', r.order_number)}</Link>}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="card space-y-4 p-5">
            <div>
              <div className="text-lg font-semibold">{r.title}</div>
              {r.description && <p className="mt-1 whitespace-pre-line text-sm text-ink-soft">{r.description}</p>}
            </div>
            <div className="grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <div className="label">Cliente</div>
                {r.customer_id ? <Link to={`/clientes/${r.customer_id}`} className="font-medium text-primary">{r.customer_name}</Link> : <div className="font-medium">{r.contact_name}</div>}
                <div className="flex items-center gap-1 text-ink-soft"><Phone className="h-3.5 w-3.5" />{r.customer_phone || r.contact_phone || '—'}</div>
                {!r.customer_id && <div className="mt-1 text-xs text-amber-600">Cadastre o cliente e vincule-o (Editar) antes de orçar ou gerar OS.</div>}
              </div>
              <div>
                <div className="label">Objeto de serviço</div>
                <div>{[r.equipment_description, r.equipment_brand, r.equipment_model].filter(Boolean).join(' · ') || '—'}</div>
              </div>
              <div>
                <div className="label">Local</div>
                <div className="flex items-start gap-1">{r.service_location === 'externo' ? <><MapPin className="mt-0.5 h-3.5 w-3.5" />{r.address || 'Externo'}</> : 'Na oficina'}</div>
              </div>
              <div><div className="label">Data desejada</div><div>{fmt(r.desired_date)}</div></div>
            </div>
          </section>
          {(r.visit_at || r.diagnosis) && (
            <section className="card space-y-3 p-5 text-sm">
              {r.visit_at && <div><div className="label">Visita / triagem</div><div className="font-medium">{fmtDateTime(r.visit_at)}{r.visit_technician_name && ` · ${r.visit_technician_name}`}</div>{r.visit_notes && <p className="text-ink-soft">{r.visit_notes}</p>}</div>}
              {r.diagnosis && <div><div className="label">Diagnóstico</div><p className="whitespace-pre-line">{r.diagnosis}</p></div>}
            </section>
          )}
          {r.lost_reason && ['perdida', 'cancelada'].includes(r.status) && (
            <div className="rounded-app-sm border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">Motivo: {r.lost_reason}</div>
          )}
          <Attachments entity="request" entityId={r.id} canEdit={manage} title="Fotos do local / da peça" />
        </div>
        <div className="space-y-6">
          {manage && (
            <section className="card space-y-2 p-5 text-sm">
              <h2 className="font-semibold">Situação</h2>
              {r.status === 'nova' && <button className="btn-outline w-full" disabled={busy} onClick={() => act(() => api.post(`/requests/${r.id}/status`, { status: 'em_triagem' }), 'Em triagem')}>Iniciar triagem</button>}
              {open && <button className="btn-ghost w-full text-red-600" onClick={() => setModal('perdida')}><XCircle className="h-4 w-4" /> Marcar como perdida</button>}
              {open && <button className="btn-ghost w-full" onClick={() => setModal('cancelada')}>Cancelar solicitação</button>}
              {['perdida', 'cancelada'].includes(r.status) && <button className="btn-outline w-full" disabled={busy} onClick={() => act(() => api.post(`/requests/${r.id}/status`, { status: 'nova' }), 'Solicitação reaberta')}><RotateCcw className="h-4 w-4" /> Reabrir</button>}
              {!open && r.status === 'convertida' && <p className="text-ink-faint">Concluída: virou {docNumber(settings, 'order', r.order_number)}.</p>}
            </section>
          )}
          <section className="card p-5 text-sm">
            <h2 className="mb-3 flex items-center gap-2 font-semibold"><MessageSquare className="h-4 w-4 text-ink-faint" /> Histórico</h2>
            <ol className="space-y-3 border-l border-line pl-4">
              {r.events.map((e) => (
                <li key={e.id} className="relative">
                  <span className={cx('absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-surface', e.to_status ? REQUEST_STATUS[e.to_status]?.dot : 'bg-ink-faint')} />
                  <div className="text-xs text-ink-faint">{fmtDateTime(e.created_at)}{e.user_name && ` · ${e.user_name}`}</div>
                  {e.to_status && e.from_status && <div className="text-xs">{REQUEST_STATUS[e.from_status]?.label} → <b>{REQUEST_STATUS[e.to_status]?.label}</b></div>}
                  {e.message && <div>{e.message}</div>}
                </li>
              ))}
            </ol>
            {manage && (
              <div className="mt-4 flex gap-2">
                <input className="input h-9" placeholder="Anotação (retorno, contato…)" value={note} onChange={(e) => setNote(e.target.value)} />
                <button className="btn-outline btn-icon h-9" aria-label="Adicionar anotação" disabled={!note.trim() || busy}
                  onClick={async () => { const x = await act(() => api.post(`/requests/${r.id}/note`, { message: note.trim() })); if (x !== FAIL) setNote(''); }}><Send className="h-4 w-4" /></button>
              </div>
            )}
          </section>
        </div>
      </div>

      {modal === 'visit' && <VisitModal r={r} onClose={() => setModal(null)} onDone={(x) => { setR(x); setModal(null); }} />}
      {modal === 'diagnosis' && <DiagnosisModal r={r} onClose={() => setModal(null)} onDone={(x) => { setR(x); setModal(null); }} />}
      {['perdida', 'cancelada'].includes(modal) && <LoseModal r={r} status={modal} onClose={() => setModal(null)} onDone={(x) => { setR(x); setModal(null); }} />}
      {modal === 'order' && (
        <Modal open onClose={() => setModal(null)} size="sm" title="Gerar OS direta"
          footer={<><button className="btn-ghost" onClick={() => setModal(null)}>Voltar</button><button className="btn-primary" disabled={busy} onClick={() => act(() => api.post(`/requests/${r.id}/order`), 'OS gerada', (x) => nav(`/os/${x.order_id}`))}>Gerar OS</button></>}>
          <p className="text-sm">Para serviços simples, sem orçamento formal. A OS abre como “Recebida” com o relato e o diagnóstico desta solicitação; os itens e valores são lançados na OS.</p>
        </Modal>
      )}
    </div>
  );
}

function VisitModal({ r, onClose, onDone }) {
  const { technicians } = useCatalog();
  const [run, busy] = useAction();
  const [d, setD] = useState({ visit_at: toLocalInput(r.visit_at) || '', visit_technician_id: r.visit_technician_id || '', visit_notes: r.visit_notes || '' });
  const go = async () => {
    const x = await run(() => api.post(`/requests/${r.id}/visit`, { ...d, visit_at: new Date(d.visit_at).toISOString(), visit_technician_id: d.visit_technician_id || null }), 'Visita agendada');
    if (x !== FAIL) onDone(x);
  };
  return (
    <Modal open onClose={onClose} size="sm" title="Visita técnica / triagem"
      footer={<><button className="btn-ghost" onClick={onClose}>Voltar</button><button className="btn-primary" disabled={busy || !d.visit_at} onClick={go}>Agendar</button></>}>
      <div className="space-y-3">
        <Input label="Data e hora" type="datetime-local" value={d.visit_at} onChange={(e) => setD({ ...d, visit_at: e.target.value })} />
        <Select label="Técnico" value={d.visit_technician_id} onChange={(e) => setD({ ...d, visit_technician_id: e.target.value })}>
          <option value="">A definir</option>{technicians.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>
        <Textarea label="Orientações" rows={2} value={d.visit_notes} onChange={(e) => setD({ ...d, visit_notes: e.target.value })} />
      </div>
    </Modal>
  );
}

function DiagnosisModal({ r, onClose, onDone }) {
  const [run, busy] = useAction();
  const [text, setText] = useState(r.diagnosis || '');
  const go = async () => { const x = await run(() => api.post(`/requests/${r.id}/diagnosis`, { diagnosis: text }), 'Diagnóstico registrado'); if (x !== FAIL) onDone(x); };
  return (
    <Modal open onClose={onClose} size="md" title="Diagnóstico técnico"
      footer={<><button className="btn-ghost" onClick={onClose}>Voltar</button><button className="btn-primary" disabled={busy || text.trim().length < 3} onClick={go}>Salvar</button></>}>
      <Textarea label="Causa, condição encontrada e solução proposta" rows={6} value={text} onChange={(e) => setText(e.target.value)} hint="O diagnóstico vira o escopo técnico do orçamento." />
    </Modal>
  );
}

function LoseModal({ r, status, onClose, onDone }) {
  const [run, busy] = useAction();
  const [reason, setReason] = useState('');
  const go = async () => { const x = await run(() => api.post(`/requests/${r.id}/status`, { status, reason }), status === 'perdida' ? 'Marcada como perdida' : 'Solicitação cancelada'); if (x !== FAIL) onDone(x); };
  const opts = status === 'perdida' ? ['Preço', 'Prazo', 'Cliente desistiu', 'Fechou com concorrente', 'Sem retorno do cliente'] : ['Registro duplicado', 'Fora do escopo da empresa', 'Pedido do cliente'];
  return (
    <Modal open onClose={onClose} size="sm" title={status === 'perdida' ? 'Marcar como perdida' : 'Cancelar solicitação'}
      footer={<><button className="btn-ghost" onClick={onClose}>Voltar</button><button className="btn-danger" disabled={busy || reason.trim().length < 2} onClick={go}>Confirmar</button></>}>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1.5">{opts.map((o) => <button key={o} type="button" className={cx('chip border', reason === o ? 'border-primary bg-primary/10 text-primary' : 'border-line')} onClick={() => setReason(o)}>{o}</button>)}</div>
        <Input label="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
    </Modal>
  );
}
