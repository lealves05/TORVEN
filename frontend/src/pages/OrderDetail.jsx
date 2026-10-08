import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Printer, MessageCircle, Wallet, PackageCheck, XCircle, RotateCcw, Receipt, Link2, Copy, Phone, Mail, Undo2,
  ShoppingCart, MapPin, Send, Lock, Globe, FileText, ExternalLink, CreditCard, ChevronRight, Square, Timer,
} from 'lucide-react';
import { api, appUrl } from '../lib/api';
import {
  money, fmt, fmtDateTime, ORDER_STATUS, OPEN_STATUSES, PRIORITY, INVOICE_STATUS, methodName, fillTemplate, waLink, toLocalInput,
  NEXT_STEP, STATUS_HINT, orderNo, docNumber,
} from '../lib/format';
import { useAuth, useSettings } from '../context/AuthContext';
import { useCatalog } from '../context/CatalogContext';
import { useUI } from '../context/UIContext';
import { Input, Select, Modal, Toggle, Loading, ActionButton, useAction, FAIL, cx } from '../components/ui';
import Attachments from '../components/Attachments';
import ItemsEditor, { cleanItems } from '../components/ItemsEditor';
import PaymentModal from '../components/PaymentModal';
import InvoiceModal from '../components/InvoiceModal';
import TerminalChargeModal from '../components/TerminalChargeModal';
import { EquipmentPicker } from '../components/CustomerPicker';
import { StatusBadge } from '../components/StatusBadge';
import { StateChips, ExecutionCard, QualityCard, ScheduleCard, WarrantyCard } from '../components/OrderOperation';
import VoiceTextarea from '../components/VoiceTextarea';

const EDITABLE = ['customer_id', 'equipment_id', 'technician_id', 'priority', 'service_location', 'service_address', 'promised_at',
  'problem', 'diagnosis', 'solution', 'accessories', 'condition', 'discount', 'warranty_days', 'notes', 'internal_notes'];

const toForm = (o) => ({
  ...Object.fromEntries(EDITABLE.map((k) => [k, o[k] ?? ''])),
  promised_at: toLocalInput(o.promised_at),
  discount: Number(o.discount) || 0,
  equipment: null,
  items: o.items.map((i) => ({ ...i, qty: Number(i.qty), unit_price: i.unit_price == null ? null : Number(i.unit_price), unit_cost: i.unit_cost == null ? null : Number(i.unit_cost), discount: Number(i.discount) || 0, _savedQty: i.kind === 'material' ? Number(i.qty) : 0 })),
});

export const publicUrl = appUrl;

export default function OrderDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can, company, feature } = useAuth();
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
  // comandos de voz e cobranças alteram a OS fora desta tela: recarrega
  useEffect(() => {
    const h = (e) => { if (!e.detail?.id || e.detail.id === id) load(); };
    window.addEventListener('torven:order-changed', h);
    return () => window.removeEventListener('torven:order-changed', h);
  }, [id, load]);
  // retorno do link de pagamento (InfinitePay): repassa os identificadores; o servidor confirma na InfinitePay
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    const chargeId = params.get('cobranca');
    if (!chargeId || !/^[0-9a-f-]{36}$/i.test(chargeId)) return;
    const body = Object.fromEntries(['transaction_nsu', 'slug', 'invoice_slug'].map((k) => [k, params.get(k) || undefined]));
    setParams({}, { replace: true });
    api.post(`/terminal-charges/${chargeId}/return`, body)
      .then((c) => { toast(c.status === 'paga' ? 'Pagamento confirmado pela InfinitePay' : `Cobrança: ${c.status}`, c.status === 'paga' ? 'success' : 'error'); load(); })
      .catch((e) => toast(e.message, 'error'));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // atalhos vindos de "Meu trabalho": #itens (lançar material), #fotos, #horas
  const loc = useLocation();
  const ready = !!o;
  useEffect(() => {
    if (!ready || !loc.hash) return;
    const t = setTimeout(() => {
      const el = document.getElementById(loc.hash.slice(1));
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (loc.hash === '#itens') el.querySelector('input')?.focus({ preventScroll: true });
    }, 150);
    return () => clearTimeout(t);
  }, [ready, loc.hash]);
  const stepper = useRef(null);
  const status = o?.status;
  useEffect(() => {
    stepper.current?.querySelector('[aria-current="step"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [status]);

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
  const setStatus = async (status, { ask = true } = {}) => {
    if (status === o.status) return;
    const from = OPEN_STATUSES.indexOf(o.status);
    const to = OPEN_STATUSES.indexOf(status);
    // pular etapas ou voltar pede confirmação (evita toque acidental na barra de etapas)
    if (ask && (to < from || to - from > 1)) {
      const ok = await confirm({
        title: to < from ? `Voltar para "${ORDER_STATUS[status].label}"?` : `Pular para "${ORDER_STATUS[status].label}"?`,
        message: to < from ? 'A OS volta para uma etapa anterior.' : `A OS sai de "${ORDER_STATUS[o.status].label}" sem passar pelas etapas do meio.`,
        confirmText: to < from ? 'Voltar etapa' : 'Pular etapas', danger: false,
      });
      if (!ok) return;
    }
    const r = await run(() => api.post(`/orders/${o.id}/status`, { status }), `Etapa: ${ORDER_STATUS[status].label}`);
    if (r !== FAIL) apply(r);
  };
  const next = !closed && o.kind === 'os' && can('orders_edit') ? NEXT_STEP[o.status] : null;
  const docNo = orderNo(settings, o);
  const reopen = async () => {
    if (!(await confirm({ title: `Reabrir ${docNo}?`, message: o.status === 'cancelada' ? 'Os materiais voltam a ser baixados do estoque.' : 'A OS volta para "em execução".', confirmText: 'Reabrir', danger: false }))) return;
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
              {o.kind === 'venda' && <ShoppingCart className="mr-1.5 inline h-5 w-5 text-ink-faint" />}{docNo}
            </h1>
            <StatusBadge status={o.status} />
            {o.priority !== 'normal' && <span className={cx('chip bg-muted', PRIORITY[o.priority].cls)}>{PRIORITY[o.priority].label}</span>}
            {o.service_location === 'externo' && <span className="chip bg-muted text-ink-soft"><MapPin className="h-3 w-3" /> Externo</span>}
          </div>
          <p className="mt-0.5 text-sm text-ink-faint">
            Aberta em {fmtDateTime(o.received_at)} por {o.created_by_name || '—'}
            {o.quote_number && <> · <Link to={`/orcamentos/${o.quote_id}`} className="text-primary">orçamento {docNumber(settings, 'quote', o.quote_number)}</Link></>}
          </p>
          <StateChips o={o} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to={`/imprimir/os/${o.id}`} target="_blank" className="btn-outline"><Printer className="h-4 w-4" /> Imprimir</Link>
          <Link to={`/imprimir/os/${o.id}/completa`} target="_blank" className="btn-outline" title="Tudo da OS: serviços, materiais apontados, horas, checklists, pagamentos, fotos e histórico">
            <FileText className="h-4 w-4" /> OS completa
          </Link>
          {o.customer_phone && (
            <button className="btn-outline" onClick={() => whatsapp(o.status === 'pronta' ? settings.whatsapp.ready : settings.whatsapp.status)}>
              <MessageCircle className="h-4 w-4 text-emerald-600" /> WhatsApp
            </button>
          )}
          {!closed && can('checkout') && values && o.balance > 0.009 && <button className="btn-outline" onClick={() => setModal('pay')}><Wallet className="h-4 w-4" /> Receber</button>}
          {!closed && can('checkout') && feature('maquininha') && values && o.balance > 0.009 && settings.orders?.terminalOnClose !== 'desligado' && (
            <button className="btn-outline" onClick={() => setModal('terminal')}><CreditCard className="h-4 w-4" /> Maquininha</button>
          )}
          {next && <button className="btn-primary" disabled={busy} onClick={() => setStatus(next.to, { ask: false })} title={`Mover para "${ORDER_STATUS[next.to].label}"`}>{next.label} <ChevronRight className="h-4 w-4" /></button>}
          {!closed && can('orders_deliver') && <button className={next ? 'btn-outline' : 'btn-primary'} onClick={() => setModal('deliver')}><PackageCheck className="h-4 w-4" /> Entregar</button>}
          {closed && (can('orders_edit') && (o.status === 'entregue' || can('orders_cancel'))) && <button className="btn-outline" onClick={reopen}><RotateCcw className="h-4 w-4" /> Reabrir</button>}
        </div>
      </div>

      {!closed && o.kind === 'os' && can('orders_edit') && (
        <div ref={stepper} className="card mb-6 overflow-x-auto p-1.5" role="group" aria-label="Etapas da OS">
          <div className="flex min-w-max gap-1">
            {OPEN_STATUSES.map((s, i) => {
              const idx = OPEN_STATUSES.indexOf(o.status);
              return (
                <button key={s} onClick={() => setStatus(s)} disabled={busy} title={STATUS_HINT[s]} aria-current={s === o.status ? 'step' : undefined}
                  className={cx('flex min-h-[2.5rem] items-center gap-2 rounded-app-sm px-3 py-2 text-xs font-medium transition',
                    s === o.status ? 'bg-primary text-primary-fg' : i < idx ? 'text-ink-soft hover:bg-muted' : 'text-ink-faint hover:bg-muted')}>
                  <span className={cx('grid h-5 w-5 place-items-center rounded-full text-[10px]', s === o.status ? 'bg-primary-fg/20' : i < idx ? 'bg-emerald-500/15 text-emerald-700' : 'bg-muted')}>{i + 1}</span>
                  {ORDER_STATUS[s].label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="min-w-0 space-y-6 xl:col-span-2">
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
                      <div className="label">Objeto de serviço</div>
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
              <VoiceTextarea label="Problema relatado" rows={2} value={f.problem} onChange={set('problem')} disabled={!editable} />
              <VoiceTextarea label="Diagnóstico técnico" rows={2} value={f.diagnosis} onChange={set('diagnosis')} disabled={!editable} placeholder="O que foi encontrado na inspeção…" />
              <VoiceTextarea label="Serviço executado / solução" rows={2} value={f.solution} onChange={set('solution')} disabled={!editable} placeholder="O que foi feito…" />
              <div className="grid gap-4 sm:grid-cols-2">
                <VoiceTextarea label="Acessórios deixados" rows={2} value={f.accessories} onChange={set('accessories')} disabled={!editable} />
                <VoiceTextarea label="Estado na entrada" rows={2} value={f.condition} onChange={set('condition')} disabled={!editable} />
              </div>
            </section>
          )}

          <section id="itens" className="card scroll-mt-4 space-y-4 p-5">
            <h2 className="font-semibold">Serviços e materiais</h2>
            <ItemsEditor items={f.items} onChange={set('items')} discount={f.discount} onDiscount={set('discount')}
              showTechnician={o.kind === 'os'} hideValues={!values} readOnly={!editable} editCost={values} showCost={values} initialTab={loc.hash === '#itens' ? 'material' : undefined} />
          </section>

          {o.kind === 'os' && (can('time_log') || o.time_logs?.length > 0) && <div id="horas" className="scroll-mt-4"><ExecutionCard o={o} onChanged={load} /></div>}
          {o.kind === 'os' && <div id="fotos" className="scroll-mt-4"><Attachments entity="order" entityId={o.id} canEdit={can('orders_edit', 'orders_create') && !closed} title="Fotos e documentos da OS" /></div>}
          {o.kind === 'os' && <QualityCard o={o} onChanged={load} />}
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
            <VoiceTextarea label="Observações (saem na impressão)" rows={2} value={f.notes} onChange={set('notes')} disabled={!editable} />
            <VoiceTextarea label="Anotações internas" rows={2} value={f.internal_notes} onChange={set('internal_notes')} disabled={!editable} />
          </section>

          {o.kind === 'os' && (can('schedule_view', 'schedule_manage')) && <ScheduleCard o={o} onChanged={load} />}
          {o.kind === 'os' && <WarrantyCard o={o} onChanged={load} />}
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
        <PaymentModal open onClose={() => setModal(null)} balance={o.balance} subtitle={`${docNo} · ${o.customer_name || 'Consumidor'}`} busy={busy}
          requireCustomerForLater hasCustomer={!!o.customer_id}
          onConfirm={async (body) => {
            const r = await run(() => api.post(`/orders/${o.id}/payments`, body));
            if (r !== FAIL) { apply(r.order); setModal(null); toast(r.change > 0 ? `Recebido. Troco: ${money(r.change)}` : 'Pagamento registrado'); }
          }} />
      )}
      {modal === 'terminal' && <TerminalChargeModal order={o} onClose={() => { setModal(null); load(); }} onPaid={() => load()} />}
      {modal === 'deliver' && <DeliverModal o={o} dirty={dirty} onSave={save} onRefresh={load} onClose={() => setModal(null)} onDone={(r) => { apply(r); setModal(null); }} />}
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

function DeliverModal({ o, dirty, onSave, onRefresh, onClose, onDone }) {
  const { can, feature } = useAuth();
  const settings = useSettings();
  const [run, busy] = useAction();
  const [rec, setRec] = useState({ received_by: o.customer_name || '', received_document: '' });
  const values = can('orders_values');
  const needInspection = o.kind === 'os' && settings.orders?.requireInspection && !['aprovado', 'aprovado_ressalva'].includes(o.inspection_result);
  const deliver = async (body = {}) => {
    const r = await run(() => api.post(`/orders/${o.id}/deliver`, { ...body, received_by: rec.received_by || null, received_document: rec.received_document || null }), `${orderNo(settings, o)} entregue`);
    if (r !== FAIL) onDone(r);
  };
  // maquininha ao fechar a OS: 'perguntar' (botão), 'automatico' (envia direto à maquininha padrão) ou 'desligado'
  const termMode = settings.orders?.terminalOnClose || 'perguntar';
  const [balance, setBalance] = useState(Number(o.balance));
  const canTerminal = values && can('checkout') && feature('maquininha') && termMode !== 'desligado';
  const openLogs = o.open_logs || [];
  const needReceiver = settings.orders?.requireReceiver && o.kind === 'os' && !rec.received_by.trim();
  // o que impede a entrega, em linguagem simples (o botão explica ao ser tocado)
  const blockedMsg = (dirty && 'Salve as alterações da OS antes de entregar.')
    || (openLogs.length > 0 && 'Encerre o cronômetro em andamento antes de entregar.')
    || (needInspection && 'A empresa exige inspeção final aprovada antes da entrega.')
    || (needReceiver && 'Informe quem recebeu o equipamento.')
    || null;
  const blocked = !!(dirty || needInspection || openLogs.length > 0);
  const [term, setTerm] = useState(() => (canTerminal && termMode === 'automatico' && !blocked && Number(o.balance) > 0.009 ? 'auto' : null));
  const afterTerminal = async () => {
    const fresh = await api.get(`/orders/${o.id}`).catch(() => null);
    const left = fresh ? Number(fresh.balance) : balance;
    setBalance(left);
    if (left <= 0.009) { setTerm(null); await deliver(); } else setTerm(null);
  };
  const stopTimers = async () => {
    const r = await run(async () => { for (const l of openLogs) await api.post(`/production/time/${l.id}/stop`, {}); }, openLogs.length > 1 ? 'Cronômetros encerrados' : 'Cronômetro encerrado');
    if (r !== FAIL) await onRefresh?.();
  };
  if (term) {
    return <TerminalChargeModal order={{ ...o, balance }} auto={term === 'auto'} onPaid={afterTerminal} onClose={() => setTerm(null)} />;
  }
  const warn = (
    <>
      {dirty && (
        <div className="flex flex-wrap items-center gap-2 rounded-app-sm bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
          <span className="flex-1">Há alterações não salvas nesta OS.</span>
          {onSave && <button type="button" className="btn-outline h-9 bg-surface text-xs" disabled={busy} onClick={onSave}>Salvar agora</button>}
        </div>
      )}
      {needInspection && <div className="rounded-app-sm bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">A empresa exige inspeção final aprovada antes da entrega (seção “Qualidade e checklists”).</div>}
      {openLogs.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-app-sm bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
          <Timer className="h-4 w-4 shrink-0" />
          <span className="flex-1">Cronômetro ligado ({openLogs.map((l) => l.technician_name).filter(Boolean).join(', ') || 'técnico'}): encerre antes de entregar.</span>
          {can('time_log') && <button type="button" className="btn-outline h-9 bg-surface text-xs text-red-700" disabled={busy} onClick={stopTimers}><Square className="h-3.5 w-3.5" /> Encerrar agora</button>}
        </div>
      )}
      {o.kind === 'os' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label={`Quem recebeu${settings.orders?.requireReceiver ? '' : ' (opcional)'}`} value={rec.received_by} onChange={(e) => setRec({ ...rec, received_by: e.target.value })} />
          <Input label="Documento (opcional)" value={rec.received_document} onChange={(e) => setRec({ ...rec, received_document: e.target.value })} />
        </div>
      )}
    </>
  );
  if (values && can('checkout') && balance > 0.009) {
    return (
      <PaymentModal open onClose={onClose} balance={balance} title="Entregar ao cliente" subtitle={`${orderNo(settings, o)} · receba o saldo de ${money(balance)} ou deixe a receber`}
        confirmText="Receber e entregar" busy={busy} allowSkip={!settings.orders?.requirePaymentToDeliver} skipText="Entregar e deixar a receber"
        requireCustomerForLater hasCustomer={!!o.customer_id} blocked={blockedMsg}
        extra={<>{warn}{canTerminal && (
          <ActionButton className="btn-outline w-full justify-center" blocked={blockedMsg} onClick={() => setTerm('manual')}>
            <CreditCard className="h-4 w-4" /> Cobrar {money(balance)} na maquininha e entregar
          </ActionButton>
        )}</>}
        onConfirm={(body) => deliver(body)} />
    );
  }
  return (
    <Modal open onClose={onClose} size="sm" title="Confirmar entrega" subtitle={orderNo(settings, o)}
      footer={<><button className="btn-ghost" onClick={onClose}>Voltar</button><ActionButton blocked={blockedMsg} disabled={busy} onClick={() => deliver()}>Confirmar entrega</ActionButton></>}>
      <div className="space-y-3 text-sm">
        {warn}
        <p>O equipamento será marcado como entregue ao cliente{o.warranty_days > 0 && <> e a garantia de <b>{o.warranty_days} dias</b> começa a contar hoje</>}.</p>
      </div>
    </Modal>
  );
}

function CancelModal({ o, onClose, onDone }) {
  const settings = useSettings();
  const [run, busy] = useAction();
  const [reason, setReason] = useState('');
  const [refund, setRefund] = useState(true);
  const go = async () => {
    const r = await run(() => api.post(`/orders/${o.id}/cancel`, { reason, refund }), 'Cancelada');
    if (r !== FAIL) onDone(r);
  };
  return (
    <Modal open onClose={onClose} size="sm" title={`Cancelar ${orderNo(settings, o)}`}
      footer={<><button className="btn-ghost" onClick={onClose}>Voltar</button><ActionButton className="btn-danger" disabled={busy} blocked={reason.trim().length < 3 ? 'Escreva o motivo do cancelamento (mínimo 3 letras).' : null} onClick={go}>Cancelar {o.kind === 'venda' ? 'venda' : 'OS'}</ActionButton></>}>
      <div className="space-y-4">
        <Input label="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus placeholder="Ex.: cliente desistiu do reparo" />
        <p className="text-sm text-ink-soft">Os materiais lançados voltam ao estoque e as parcelas a receber são excluídas.</p>
        {o.paid > 0 && <Toggle checked={refund} onChange={setRefund} label={`Estornar ${money(o.paid)} já recebidos`} hint="Lança uma saída em “Estornos” no financeiro." />}
      </div>
    </Modal>
  );
}
