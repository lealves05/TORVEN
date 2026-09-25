import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Printer, MessageCircle, Wallet, PackageCheck, XCircle, RotateCcw, Receipt, Link2, Copy, Phone, Mail, Undo2,
  ShoppingCart, MapPin, Send, Lock, Globe, FileText, ExternalLink,
} from 'lucide-react';
import { api, appUrl } from '../lib/api';
import {
  money, fmt, fmtDateTime, ORDER_STATUS, OPEN_STATUSES, PRIORITY, INVOICE_STATUS, methodName, fillTemplate, waLink, toLocalInput,
} from '../lib/format';
import { useAuth, useSettings } from '../context/AuthContext';
import { useCatalog } from '../context/CatalogContext';
import { useUI } from '../context/UIContext';
import { Input, Textarea, Select, Modal, Toggle, Loading, useAction, FAIL, cx } from '../components/ui';
import ItemsEditor, { cleanItems } from '../components/ItemsEditor';
import PaymentModal from '../components/PaymentModal';
import InvoiceModal from '../components/InvoiceModal';
import { EquipmentPicker } from '../components/CustomerPicker';
import { StatusBadge } from './Dashboard';

const EDITABLE = ['customer_id', 'equipment_id', 'technician_id', 'priority', 'service_location', 'service_address', 'promised_at',
  'problem', 'diagnosis', 'solution', 'accessories', 'condition', 'discount', 'warranty_days', 'notes', 'internal_notes'];

const toForm = (o) => ({
  ...Object.fromEntries(EDITABLE.map((k) => [k, o[k] ?? ''])),
  promised_at: toLocalInput(o.promised_at),
  discount: Number(o.discount) || 0,
  equipment: null,
  items: o.items.map((i) => ({ ...i, qty: Number(i.qty), unit_price: i.unit_price == null ? null : Number(i.unit_price), discount: Number(i.discount) || 0, _savedQty: i.kind === 'material' ? Number(i.qty) : 0 })),
});

export const publicUrl = appUrl;

export default function OrderDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can, company } = useAuth();
  const settings = useSettings();
  const { technicians } = useCatalog();
  const { confirm, toast } = useUI();
  const [run, busy] = useAction();
  const [o, setO] = useState(null);
  const [f, setF] = useState(null);
  const [modal, setModal] = useState(null);

  const apply = useCallback((data) => { setO(data); setF(toForm(data)); }, []);
  const load = useCallback(() => api.get(`/orders/${id}`).then(apply).catch((e) => { toast(e.message, 'error'); nav('/os'); }), [id, apply]); // eslint-disable-line
  useEffect(() => { load(); }, [load]);

  const dirty = useMemo(() => o && f && JSON.stringify(f) !== JSON.stringify(toForm(o)), [o, f]);
  if (!o || !f) return <Loading />;

  const closed = ['entregue', 'cancelada'].includes(o.status);
  const editable = can('orders_edit') && !closed;
  const values = can('orders_values');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));
  const label = o.kind === 'venda' ? 'Venda' : 'OS';
  const trackUrl = publicUrl(`/p/os/${o.public_token}`);

  const save = async () => {
    const body = {
      ...f, kind: o.kind, customer_id: o.customer_id, technician_id: f.technician_id || null, equipment_id: f.equipment_id || null,
      equipment: f.equipment?.description ? f.equipment : null,
      promised_at: f.promised_at ? new Date(f.promised_at).toISOString() : null, warranty_days: Number(f.warranty_days) || 0,
      items: cleanItems(f.items), discount: Number(f.discount) || 0,
    };
    const r = await run(() => api.put(`/orders/${o.id}`, body), 'Alterações salvas');
    if (r !== FAIL) apply(r);
  };
  const setStatus = async (status) => {
    const r = await run(() => api.post(`/orders/${o.id}/status`, { status }), `Etapa: ${ORDER_STATUS[status].label}`);
    if (r !== FAIL) apply(r);
  };
  const reopen = async () => {
    if (!(await confirm({ title: `Reabrir ${label} nº ${o.number}?`, message: o.status === 'cancelada' ? 'Os materiais voltam a ser baixados do estoque.' : 'A OS volta para "em execução".', confirmText: 'Reabrir', danger: false }))) return;
    const r = await run(() => api.post(`/orders/${o.id}/reopen`), 'OS reaberta');
    if (r !== FAIL) apply(r);
  };
  const refund = async (t) => {
    if (!(await confirm({ title: 'Estornar este recebimento?', message: `${methodName(settings, t.method)} — ${money(t.amount)}`, confirmText: 'Estornar' }))) return;
    const r = await run(() => api.del(`/orders/${o.id}/payments/${t.id}`), 'Recebimento estornado');
    if (r !== FAIL) apply(r);
  };
  const whatsapp = (tpl) => {
    const text = fillTemplate(tpl, {
      cliente: o.customer_name?.split(' ')[0], numero: o.number, empresa: company.trade_name || company.name,
      equipamento: o.equipment_description || '', total: money(o.total), status: ORDER_STATUS[o.status].label, link: trackUrl,
    });
    const url = waLink(o.customer_phone, text);
    if (url) window.open(url, '_blank'); else toast('Cliente sem telefone cadastrado.', 'error');
  };

  return (
    <div className="pb-2">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
              {o.kind === 'venda' && <ShoppingCart className="mr-1.5 inline h-5 w-5 text-ink-faint" />}{label} nº {o.number}
            </h1>
            <StatusBadge status={o.status} />
            {o.priority !== 'normal' && <span className={cx('chip bg-muted', PRIORITY[o.priority].cls)}>{PRIORITY[o.priority].label}</span>}
            {o.service_location === 'externo' && <span className="chip bg-muted text-ink-soft"><MapPin className="h-3 w-3" /> Externo</span>}
          </div>
          <p className="mt-0.5 text-sm text-ink-faint">
            Aberta em {fmtDateTime(o.received_at)} por {o.created_by_name || '—'}
            {o.quote_number && <> · <Link to={`/orcamentos/${o.quote_id}`} className="text-primary">orçamento nº {o.quote_number}</Link></>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to={`/imprimir/os/${o.id}`} target="_blank" className="btn-outline"><Printer className="h-4 w-4" /> Imprimir</Link>
          {o.customer_phone && (
            <button className="btn-outline" onClick={() => whatsapp(o.status === 'pronta' ? settings.whatsapp.ready : settings.whatsapp.status)}>
              <MessageCircle className="h-4 w-4 text-emerald-600" /> WhatsApp
            </button>
          )}
          {!closed && can('checkout') && values && o.balance > 0.009 && <button className="btn-outline" onClick={() => setModal('pay')}><Wallet className="h-4 w-4" /> Receber</button>}
          {!closed && can('orders_deliver') && <button className="btn-primary" onClick={() => setModal('deliver')}><PackageCheck className="h-4 w-4" /> Entregar</button>}
          {closed && (can('orders_edit') && (o.status === 'entregue' || can('orders_cancel'))) && <button className="btn-outline" onClick={reopen}><RotateCcw className="h-4 w-4" /> Reabrir</button>}
        </div>
      </div>

      {!closed && o.kind === 'os' && can('orders_edit') && (
        <div className="card mb-6 overflow-x-auto p-1.5">
          <div className="flex min-w-max gap-1">
            {OPEN_STATUSES.map((s, i) => {
              const idx = OPEN_STATUSES.indexOf(o.status);
              return (
                <button key={s} onClick={() => setStatus(s)} disabled={busy}
                  className={cx('flex items-center gap-2 rounded-app-sm px-3 py-2 text-xs font-medium transition',
                    s === o.status ? 'bg-primary text-primary-fg' : i < idx ? 'text-ink-soft hover:bg-muted' : 'text-ink-faint hover:bg-muted')}>
                  <span className={cx('grid h-5 w-5 place-items-center rounded-full text-[10px]', s === o.status ? 'bg-primary-fg/20' : i < idx ? 'bg-emerald-500/15 text-emerald-700' : 'bg-muted')}>{i + 1}</span>
                  {ORDER_STATUS[s].label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="card p-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <div className="label">Cliente</div>
                {o.customer_id ? (
                  <>
                    <Link to={`/clientes/${o.customer_id}`} className="font-medium hover:text-primary">{o.customer_name}</Link>
                    <div className="mt-1 space-y-0.5 text-sm text-ink-soft">
                      {o.customer_phone && <div className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5" />{o.customer_phone}</div>}
                      {o.customer_email && <div className="flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" />{o.customer_email}</div>}
                      {o.customer_document && <div className="text-xs text-ink-faint">{o.customer_document}</div>}
                    </div>
                  </>
                ) : <div className="text-sm text-ink-faint">Consumidor não identificado</div>}
              </div>
              {o.kind === 'os' && (
                <div>
                  {editable ? (
                    <EquipmentPicker customerId={o.customer_id} value={f.equipment_id} onChange={set('equipment_id')}
                      newEquipment={f.equipment} onNewEquipment={(e) => setF((x) => ({ ...x, equipment: e }))} />
                  ) : (
                    <>
                      <div className="label">Equipamento / peça</div>
                      <div className="font-medium">{o.equipment_description || '—'}</div>
                      <div className="text-sm text-ink-soft">{[o.equipment_brand, o.equipment_model, o.equipment_serial && `nº ${o.equipment_serial}`].filter(Boolean).join(' · ')}</div>
                    </>
                  )}
                </div>
              )}
            </div>
          </section>

          {o.kind === 'os' && (
            <section className="card space-y-4 p-5">
              <h2 className="font-semibold">Diagnóstico e execução</h2>
              <Textarea label="Problema relatado" rows={2} value={f.problem} onChange={set('problem')} disabled={!editable} />
              <Textarea label="Diagnóstico técnico" rows={2} value={f.diagnosis} onChange={set('diagnosis')} disabled={!editable} placeholder="O que foi encontrado na inspeção…" />
              <Textarea label="Serviço executado / solução" rows={2} value={f.solution} onChange={set('solution')} disabled={!editable} placeholder="O que foi feito…" />
              <div className="grid gap-4 sm:grid-cols-2">
                <Textarea label="Acessórios deixados" rows={2} value={f.accessories} onChange={set('accessories')} disabled={!editable} />
                <Textarea label="Estado na entrada" rows={2} value={f.condition} onChange={set('condition')} disabled={!editable} />
              </div>
            </section>
          )}

          <section className="card space-y-4 p-5">
            <h2 className="font-semibold">Serviços e materiais</h2>
            <ItemsEditor items={f.items} onChange={set('items')} discount={f.discount} onDiscount={set('discount')}
              showTechnician={o.kind === 'os'} hideValues={!values} readOnly={!editable} />
          </section>

          <Timeline o={o} onAdded={apply} />
        </div>

        <div className="space-y-6">
          <section className="card space-y-4 p-5">
            <h2 className="font-semibold">Dados da {label}</h2>
            {o.kind === 'os' && (
              <>
                <Select label="Técnico responsável" value={f.technician_id || ''} onChange={set('technician_id')} disabled={!editable}>
                  <option value="">A definir</option>
                  {technicians.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </Select>
                <div className="grid grid-cols-2 gap-3">
                  <Select label="Prioridade" value={f.priority} onChange={set('priority')} disabled={!editable}>
                    {Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </Select>
                  <Select label="Local" value={f.service_location} onChange={set('service_location')} disabled={!editable}>
                    <option value="oficina">Oficina</option><option value="externo">Externo</option>
                  </Select>
                </div>
                {f.service_location === 'externo' && <Input label="Endereço do serviço" value={f.service_address} onChange={set('service_address')} disabled={!editable} />}
                <Input label="Prazo de entrega" type="datetime-local" value={f.promised_at} onChange={set('promised_at')} disabled={!editable} />
                <Input label="Garantia (dias)" type="number" min={0} value={f.warranty_days} onChange={set('warranty_days')} disabled={!editable} />
              </>
            )}
            <dl className="space-y-1.5 border-t border-line pt-3 text-sm">
              {o.started_at && <Row k="Início da execução" v={fmtDateTime(o.started_at)} />}
              {o.finished_at && <Row k="Concluída" v={fmtDateTime(o.finished_at)} />}
              {o.delivered_at && <Row k="Entregue" v={fmtDateTime(o.delivered_at)} />}
              {o.warranty_until && <Row k="Garantia até" v={fmt(o.warranty_until)} strong={new Date(o.warranty_until) >= new Date()} />}
              {o.cancelled_at && <Row k="Cancelada" v={fmtDateTime(o.cancelled_at)} />}
            </dl>
            <Textarea label="Observações (saem na impressão)" rows={2} value={f.notes} onChange={set('notes')} disabled={!editable} />
            <Textarea label="Anotações internas" rows={2} value={f.internal_notes} onChange={set('internal_notes')} disabled={!editable} />
          </section>

          {values && (
            <section className="card p-5">
              <h2 className="mb-3 font-semibold">Financeiro</h2>
              <dl className="space-y-1.5 text-sm">
                <Row k="Total" v={money(o.total)} strong />
                <Row k="Recebido" v={money(o.paid)} tone="text-emerald-600" />
                {o.receivable > 0 && <Row k="A receber (parcelas)" v={money(o.receivable)} tone="text-amber-600" />}
                <Row k="Saldo" v={money(o.balance)} strong tone={o.balance > 0.009 ? 'text-red-600' : undefined} />
              </dl>
              {o.payments.filter((t) => t.type === 'entrada').length > 0 && (
                <ul className="mt-3 divide-y divide-line border-t border-line text-sm">
                  {o.payments.filter((t) => t.type === 'entrada').map((t) => (
                    <li key={t.id} className="flex items-center gap-2 py-2">
                      <div className="min-w-0 flex-1">
                        <div>{methodName(settings, t.method)}</div>
                        <div className="text-xs text-ink-faint">{t.paid_at ? `pago ${fmt(t.paid_at, 'dd/MM/yy')}` : `vence ${fmt(t.due_date)}`}</div>
                      </div>
                      <span className={cx('tabular-nums', !t.paid_at && 'text-amber-600')}>{money(t.amount)}</span>
                      {can('cash') && o.status !== 'cancelada' && <button className="btn-ghost btn-icon h-7 text-ink-faint hover:text-red-600" title="Estornar" onClick={() => refund(t)}><Undo2 className="h-3.5 w-3.5" /></button>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {settings.modules?.invoices && (can('invoices_issue') || o.invoices.length > 0) && values && (
            <section className="card p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-semibold">Notas fiscais</h2>
                {can('invoices_issue') && o.status !== 'cancelada' && <button className="btn-outline h-8 text-xs" onClick={() => setModal('invoice')}><Receipt className="h-3.5 w-3.5" /> Emitir</button>}
              </div>
              {!o.invoices.length ? <p className="text-sm text-ink-faint">Nenhuma nota emitida.</p> : (
                <ul className="space-y-2 text-sm">
                  {o.invoices.map((i) => (
                    <li key={i.id} className="flex items-center gap-2">
                      <span className="w-12 text-xs font-medium uppercase text-ink-soft">{i.kind === 'nfe' ? 'NF-e' : 'NFS-e'}</span>
                      <span className="flex-1 tabular-nums">{i.number ? `nº ${i.number}` : '—'} · {money(i.amount)}</span>
                      <span className={cx('chip', INVOICE_STATUS[i.status]?.cls)}>{INVOICE_STATUS[i.status]?.label}</span>
                      {i.pdf_url && <a href={i.pdf_url} target="_blank" rel="noreferrer" className="btn-ghost btn-icon h-7"><ExternalLink className="h-3.5 w-3.5" /></a>}
                    </li>
                  ))}
                </ul>
              )}
              <Link to="/notas" className="mt-3 block text-xs text-primary">Ver todas as notas</Link>
            </section>
          )}

          {settings.modules?.publicLinks && (
            <section className="card space-y-2 p-5">
              <h2 className="flex items-center gap-2 font-semibold"><Link2 className="h-4 w-4" /> Acompanhamento do cliente</h2>
              <p className="text-xs text-ink-faint">O cliente acompanha a etapa, o histórico público e o valor — e aprova o serviço quando estiver “aguardando aprovação”.</p>
              <div className="flex gap-2">
                <input readOnly className="input text-xs" value={trackUrl} />
                <button className="btn-outline btn-icon" title="Copiar" onClick={() => { navigator.clipboard?.writeText(trackUrl); toast('Link copiado'); }}><Copy className="h-4 w-4" /></button>
                <a className="btn-outline btn-icon" href={trackUrl} target="_blank" rel="noreferrer" title="Abrir"><ExternalLink className="h-4 w-4" /></a>
              </div>
            </section>
          )}

          {!closed && can('orders_cancel') && (
            <button className="btn-ghost w-full text-red-600" onClick={() => setModal('cancel')}><XCircle className="h-4 w-4" /> Cancelar {label}</button>
          )}
        </div>
      </div>

      {dirty && editable && (
        <div className="action-bar">
          <div className="mx-auto flex max-w-[1400px] items-center justify-end gap-3 px-4 py-3 sm:px-8">
            <span className="mr-auto text-sm text-ink-soft">Alterações não salvas.</span>
            <button className="btn-ghost" onClick={() => setF(toForm(o))}>Descartar</button>
            <button className="btn-primary" disabled={busy} onClick={save}>Salvar alterações</button>
          </div>
        </div>
      )}

      {modal === 'pay' && (
        <PaymentModal open onClose={() => setModal(null)} balance={o.balance} subtitle={`${label} nº ${o.number} · ${o.customer_name || 'Consumidor'}`} busy={busy}
          requireCustomerForLater hasCustomer={!!o.customer_id}
          onConfirm={async (body) => {
            const r = await run(() => api.post(`/orders/${o.id}/payments`, body));
            if (r !== FAIL) { apply(r.order); setModal(null); toast(r.change > 0 ? `Recebido. Troco: ${money(r.change)}` : 'Pagamento registrado'); }
          }} />
      )}
      {modal === 'deliver' && <DeliverModal o={o} dirty={dirty} onClose={() => setModal(null)} onDone={(r) => { apply(r); setModal(null); }} />}
      {modal === 'cancel' && <CancelModal o={o} onClose={() => setModal(null)} onDone={(r) => { apply(r); setModal(null); }} />}
      {modal === 'invoice' && <InvoiceModal order={o} onClose={() => setModal(null)} onDone={(inv) => { setModal(null); load(); toast(inv.status === 'erro' ? `Nota rejeitada: ${inv.message}` : `Nota ${INVOICE_STATUS[inv.status]?.label.toLowerCase()}`, inv.status === 'erro' ? 'error' : 'success'); }} />}
    </div>
  );
}

const Row = ({ k, v, strong, tone }) => (
  <div className="flex justify-between gap-3"><dt className="text-ink-soft">{k}</dt><dd className={cx('tabular-nums', strong && 'font-semibold', tone)}>{v}</dd></div>
);

function Timeline({ o, onAdded }) {
  const [run, busy] = useAction();
  const [msg, setMsg] = useState('');
  const [pub, setPub] = useState(false);
  const add = async () => {
    const r = await run(() => api.post(`/orders/${o.id}/events`, { message: msg, public: pub }), 'Anotação registrada');
    if (r !== FAIL) { onAdded(r); setMsg(''); }
  };
  return (
    <section className="card p-5">
      <h2 className="mb-3 font-semibold">Histórico</h2>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <input className="input" placeholder="Registrar anotação, contato com o cliente, andamento…" value={msg} onChange={(e) => setMsg(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && msg.trim() && add()} />
        <button onClick={() => setPub(!pub)} className={cx('btn border text-xs', pub ? 'border-primary bg-primary/10 text-primary' : 'border-line text-ink-soft')} title="Visível no link do cliente">
          {pub ? <Globe className="h-4 w-4" /> : <Lock className="h-4 w-4" />}{pub ? 'Pública' : 'Interna'}
        </button>
        <button className="btn-primary" disabled={busy || !msg.trim()} onClick={add}><Send className="h-4 w-4" /></button>
      </div>
      <ol className="relative space-y-4 border-l border-line pl-5">
        {o.events.map((e) => (
          <li key={e.id} className="relative">
            <span className={cx('absolute -left-[26px] top-1 h-3 w-3 rounded-full border-2 border-surface', e.to_status ? ORDER_STATUS[e.to_status]?.dot : 'bg-ink-faint')} />
            <div className="text-sm">
              {e.type === 'status' || e.type === 'criacao' ? (
                <span>{e.type === 'criacao' ? 'Aberta' : 'Etapa'}: <b>{ORDER_STATUS[e.to_status]?.label}</b></span>
              ) : e.type === 'pagamento' ? <span className="flex items-center gap-1"><Wallet className="h-3.5 w-3.5" /> {e.message}</span>
                : e.type === 'nota' && e.message?.match(/NF|Nota|Documento/) ? <span className="flex items-center gap-1"><FileText className="h-3.5 w-3.5" /> {e.message}</span> : null}
              {e.message && !['pagamento'].includes(e.type) && !(e.type === 'nota' && e.message?.match(/NF|Nota|Documento/)) && (
                <div className={cx(e.type !== 'nota' && 'text-ink-soft')}>{e.message}</div>
              )}
            </div>
            <div className="text-xs text-ink-faint">{fmtDateTime(e.created_at)}{e.user_name && ` · ${e.user_name}`}{e.public && ' · visível ao cliente'}</div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function DeliverModal({ o, dirty, onClose, onDone }) {
  const { can } = useAuth();
  const settings = useSettings();
  const [run, busy] = useAction();
  const values = can('orders_values');
  const deliver = async (body = {}) => {
    const r = await run(() => api.post(`/orders/${o.id}/deliver`, body), `${o.kind === 'venda' ? 'Venda' : 'OS'} entregue`);
    if (r !== FAIL) onDone(r);
  };
  const warn = dirty && <div className="rounded-app-sm bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">Há alterações não salvas nesta OS. Salve antes de entregar.</div>;
  if (values && can('checkout') && o.balance > 0.009) {
    return (
      <PaymentModal open onClose={onClose} balance={o.balance} title="Entregar ao cliente" subtitle={`Receba o saldo de ${money(o.balance)} ou lance como a receber`}
        confirmText="Receber e entregar" busy={busy} allowSkip={!settings.orders?.requirePaymentToDeliver} requireCustomerForLater hasCustomer={!!o.customer_id}
        extra={<>{warn}{!settings.orders?.requirePaymentToDeliver && <p className="text-xs text-ink-faint">Para entregar sem receber agora, zere os valores e confirme — o saldo fica em aberto na OS.</p>}</>}
        onConfirm={(body) => deliver(body)} />
    );
  }
  return (
    <Modal open onClose={onClose} size="sm" title="Confirmar entrega"
      footer={<><button className="btn-ghost" onClick={onClose}>Voltar</button><button className="btn-primary" disabled={busy || dirty} onClick={() => deliver()}>Confirmar entrega</button></>}>
      <div className="space-y-3 text-sm">
        {warn}
        <p>O equipamento será marcado como entregue ao cliente{o.warranty_days > 0 && <> e a garantia de <b>{o.warranty_days} dias</b> começa a contar hoje</>}.</p>
      </div>
    </Modal>
  );
}

function CancelModal({ o, onClose, onDone }) {
  const [run, busy] = useAction();
  const [reason, setReason] = useState('');
  const [refund, setRefund] = useState(true);
  const go = async () => {
    const r = await run(() => api.post(`/orders/${o.id}/cancel`, { reason, refund }), 'Cancelada');
    if (r !== FAIL) onDone(r);
  };
  return (
    <Modal open onClose={onClose} size="sm" title={`Cancelar ${o.kind === 'venda' ? 'venda' : 'OS'} nº ${o.number}`}
      footer={<><button className="btn-ghost" onClick={onClose}>Voltar</button><button className="btn-danger" disabled={busy || reason.trim().length < 3} onClick={go}>Cancelar</button></>}>
      <div className="space-y-4">
        <Input label="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus placeholder="Ex.: cliente desistiu do reparo" />
        <p className="text-sm text-ink-soft">Os materiais lançados voltam ao estoque e as parcelas a receber são excluídas.</p>
        {o.paid > 0 && <Toggle checked={refund} onChange={setRefund} label={`Estornar ${money(o.paid)} já recebidos`} hint="Lança uma saída em “Estornos” no financeiro." />}
      </div>
    </Modal>
  );
}
