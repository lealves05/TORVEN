import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { addDays, format } from 'date-fns';
import {
  Plus, Search, FileText, Printer, MessageCircle, Copy, CheckCircle2, ClipboardList, Trash2, CopyPlus, Save, ExternalLink,
  Send, Gavel, RotateCcw, History, Mail, Link2,
} from 'lucide-react';
import { api, qs } from '../lib/api';
import { money, fmt, fmtDateTime, QUOTE_STATUS, DECISION_VIAS, fillTemplate, waLink, docNumber } from '../lib/format';
import { useAuth, useSettings } from '../context/AuthContext';
import { useCatalog } from '../context/CatalogContext';
import { useUI } from '../context/UIContext';
import { PageHeader, Input, Textarea, Select, Loading, Empty, Modal, useAction, FAIL, cx } from '../components/ui';
import CustomerPicker, { EquipmentPicker } from '../components/CustomerPicker';
import ItemsEditor, { cleanItems, itemTotal } from '../components/ItemsEditor';
import Attachments from '../components/Attachments';
import { useTable, SortTh, Pager } from '../components/Table';
import { publicUrl } from './OrderDetail';

export const QuoteBadge = ({ status }) => <span className={cx('chip whitespace-nowrap', QUOTE_STATUS[status]?.cls)}>{QUOTE_STATUS[status]?.label || status}</span>;

const PENDING = ['rascunho', 'enviado', 'aguardando_decisao'];
const APPROVED = ['aprovado', 'parcialmente_aprovado'];

export default function Quotes() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const settings = useSettings();
  const { can } = useAuth();
  const [f, setF] = useState({ search: '', status: params.get('status') || '' });
  const [list, setList] = useState(null);
  const load = useCallback(() => api.get(`/quotes${qs(f)}`).then(setList), [f]);
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);
  const t = useTable(list, { sort: 'created_at', dir: 'desc', get: { customer: (q) => q.customer_name, value: (q) => q.approved_total ?? q.total } });
  const pending = (list || []).filter((q) => PENDING.includes(q.status));
  const approved = (list || []).filter((q) => [...APPROVED, 'convertido'].includes(q.status));
  const decided = (list || []).filter((q) => [...APPROVED, 'convertido', 'recusado', 'vencido'].includes(q.status));

  return (
    <div>
      <PageHeader title="Orçamentos" subtitle="Revisões versionadas, aprovação total ou parcial registrada e conversão em OS"
        actions={can('quotes') && <Link to="/orcamentos/novo" className="btn-primary"><Plus className="h-4 w-4" /> Novo orçamento</Link>} />
      {list && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="card p-4"><div className="text-xs text-ink-faint">Em aberto</div><div className="mt-1 text-xl font-semibold">{pending.length}</div><div className="text-xs tabular-nums text-ink-faint">{money(pending.reduce((a, q) => a + q.total, 0))}</div></div>
          <div className="card p-4"><div className="text-xs text-ink-faint">Aprovados</div><div className="mt-1 text-xl font-semibold">{approved.length}</div><div className="text-xs tabular-nums text-ink-faint">{money(approved.reduce((a, q) => a + (q.approved_total ?? q.total), 0))}</div></div>
          <div className="card p-4"><div className="text-xs text-ink-faint">Taxa de aprovação</div><div className="mt-1 text-xl font-semibold">{decided.length ? `${Math.round((approved.length / decided.length) * 100)}%` : '—'}</div><div className="text-xs text-ink-faint">no filtro atual</div></div>
          <div className="card p-4"><div className="text-xs text-ink-faint">Aprovados sem OS</div><div className="mt-1 text-xl font-semibold">{(list || []).filter((q) => APPROVED.includes(q.status)).length}</div><div className="text-xs text-ink-faint">prontos para programar</div></div>
        </div>
      )}
      <div className="card mb-4 flex flex-wrap items-end gap-3 p-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <input className="input pl-9" placeholder="Nº, título ou cliente…" value={f.search} onChange={(e) => setF({ ...f, search: e.target.value })} />
        </div>
        <select className="input w-52" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} aria-label="Situação">
          <option value="">Todas as situações</option><option value="pendentes">Em aberto</option><option value="aprovados">Aprovados (sem OS)</option>
          {Object.entries(QUOTE_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>
      <div className="card overflow-hidden">
        {!list ? <Loading /> : !list.length ? <Empty icon={FileText} title="Nenhum orçamento" /> : (
          <>
            <div className="overflow-x-auto">
              <table className="table-clean">
                <thead><tr>
                  <SortTh t={t} k="number">Nº</SortTh><SortTh t={t} k="customer">Orçamento</SortTh>
                  <SortTh t={t} k="created_at" className="hidden md:table-cell">Data</SortTh><SortTh t={t} k="valid_until" className="hidden md:table-cell">Validade</SortTh>
                  <SortTh t={t} k="status">Situação</SortTh><SortTh t={t} k="value" className="text-right">Total</SortTh>
                </tr></thead>
                <tbody>
                  {t.rows.map((q) => (
                    <tr key={q.id} className="cursor-pointer" onClick={() => nav(`/orcamentos/${q.id}`)}>
                      <td className="whitespace-nowrap font-medium tabular-nums">{docNumber(settings, 'quote', q.number)}{q.revision > 1 && <span className="ml-1 text-xs text-ink-faint">r{q.revision}</span>}</td>
                      <td><div className="max-w-[320px] truncate">{q.title}</div><div className="max-w-[320px] truncate text-xs text-ink-faint">{q.customer_name}{q.equipment_description && ` · ${q.equipment_description}`}</div></td>
                      <td className="hidden whitespace-nowrap text-ink-soft md:table-cell">{fmt(q.created_at, 'dd/MM/yy')}</td>
                      <td className="hidden whitespace-nowrap text-ink-soft md:table-cell">{fmt(q.valid_until, 'dd/MM/yy')}</td>
                      <td><QuoteBadge status={q.status} />{q.order_number && <div className="mt-0.5 text-xs text-ink-faint">{docNumber(settings, 'order', q.order_number)}</div>}</td>
                      <td className="text-right font-medium tabular-nums">
                        {q.approved_total != null && q.approved_total !== q.total ? <><span className="text-xs text-ink-faint line-through">{money(q.total)}</span> {money(q.approved_total)}</> : money(q.total)}
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

const blank = (settings) => ({
  customer: null, equipment_id: null, equipment: null, technician_id: '', title: '', description: '', scope: '',
  assumptions: settings.quotes?.assumptions || '', exclusions: settings.quotes?.exclusions || '',
  items: [], discount: 0, surcharge: 0, tax_rate: settings.quotes?.taxRate || 0,
  valid_until: format(addDays(new Date(), settings.orders?.quoteValidityDays || 15), 'yyyy-MM-dd'),
  payment_terms: '', delivery_days: 3, warranty_days: settings.orders?.defaultWarrantyDays ?? 90, terms: settings.orders?.termsQuote || '', internal_notes: '',
});

export function QuoteEditor() {
  const { id } = useParams();
  const nav = useNavigate();
  const settings = useSettings();
  const { can } = useAuth();
  const { technicians } = useCatalog();
  const { confirm, toast } = useUI();
  const [run, busy] = useAction();
  const [q, setQ] = useState(null);
  const [f, setF] = useState(id ? null : blank(settings));
  const [modal, setModal] = useState(null);

  const apply = (r) => {
    setQ(r);
    setF({
      ...r, customer: r.customer_id ? { id: r.customer_id, name: r.customer_name, phone: r.customer_phone, document: r.customer_document } : null,
      equipment: null, technician_id: r.technician_id || '', discount: Number(r.discount), surcharge: Number(r.surcharge), tax_rate: Number(r.tax_rate),
      items: r.items.map((i) => ({ ...i, qty: Number(i.qty), unit_price: Number(i.unit_price), unit_cost: i.unit_cost == null ? null : Number(i.unit_cost), discount: Number(i.discount) })),
    });
  };
  const [params] = useSearchParams();
  useEffect(() => { if (id) api.get(`/quotes/${id}`).then(apply).catch((e) => { toast(e.message, 'error'); nav('/orcamentos'); }); }, [id]); // eslint-disable-line
  useEffect(() => {
    const c = params.get('cliente');
    if (!id && c) api.get(`/customers/${c}`).then((x) => setF((y) => ({ ...y, customer: x }))).catch(() => {});
  }, [id, params]);

  if (!f) return <Loading />;
  const locked = q && (APPROVED.includes(q.status) || q.status === 'convertido');
  const readOnly = locked || !can('quotes');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));
  const link = q && publicUrl(`/p/orcamento/${q.public_token}`);
  const showCost = can('orders_values');
  const dirtyAfterSend = q && ['enviado', 'aguardando_decisao', 'recusado', 'vencido'].includes(q.status);

  const body = () => ({
    customer_id: f.customer?.id, equipment_id: f.equipment_id || null, equipment: f.equipment?.description ? f.equipment : null,
    technician_id: f.technician_id || null, title: f.title, description: f.description, scope: f.scope, assumptions: f.assumptions, exclusions: f.exclusions,
    items: cleanItems(f.items), discount: Number(f.discount) || 0, surcharge: Number(f.surcharge) || 0, tax_rate: Number(f.tax_rate) || 0,
    valid_until: f.valid_until || null, payment_terms: f.payment_terms, delivery_days: f.delivery_days === '' ? null : Number(f.delivery_days),
    warranty_days: f.warranty_days === '' ? null : Number(f.warranty_days), terms: f.terms, internal_notes: f.internal_notes,
  });
  const save = async () => {
    if (dirtyAfterSend && !(await confirm({
      title: 'Criar nova revisão?', danger: false, confirmText: 'Salvar como rascunho',
      message: `O orçamento já foi enviado ao cliente (revisão ${q.revision}). Ao salvar, ele volta a rascunho e o próximo envio gera a revisão ${q.revision + 1}. A revisão anterior fica guardada no histórico.`,
    }))) return FAIL;
    const r = await run(() => (q ? api.put(`/quotes/${q.id}`, body()) : api.post('/quotes', body())), 'Orçamento salvo');
    if (r !== FAIL) { apply(r); if (!q) nav(`/orcamentos/${r.id}`, { replace: true }); }
    return r;
  };
  const reopen = async () => {
    if (!(await confirm({ title: 'Reabrir para revisão?', danger: false, confirmText: 'Reabrir', message: 'A decisão registrada fica no histórico e o orçamento volta a rascunho para ajustes e novo envio.' }))) return;
    const r = await run(() => api.post(`/quotes/${q.id}/reopen`, {}), 'Orçamento reaberto');
    if (r !== FAIL) apply(r);
  };
  const duplicate = async () => {
    const r = await run(() => api.post(`/quotes/${q.id}/duplicate`), 'Orçamento duplicado');
    if (r !== FAIL) nav(`/orcamentos/${r.id}`);
  };
  const remove = async () => {
    if (!(await confirm({ title: `Excluir orçamento ${docNumber(settings, 'quote', q.number)}?`, confirmText: 'Excluir' }))) return;
    if ((await run(() => api.del(`/quotes/${q.id}`), 'Orçamento excluído')) !== FAIL) nav('/orcamentos');
  };
  const canSend = q && can('quotes_send') && ['rascunho', 'enviado', 'aguardando_decisao', 'vencido'].includes(q.status);
  const canDecide = q && can('quotes_approve') && ['rascunho', 'enviado', 'aguardando_decisao'].includes(q.status) && Number(q.total) > 0;

  return (
    <div className="pb-2">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{q ? `Orçamento ${docNumber(settings, 'quote', q.number)}` : 'Novo orçamento'}</h1>
            {q && <QuoteBadge status={q.status} />}
            {q?.revision > 0 && <span className="chip bg-muted text-ink-soft">Revisão {q.revision}</span>}
          </div>
          {q && (
            <p className="mt-0.5 text-sm text-ink-faint">
              Criado em {fmt(q.created_at)} por {q.created_by_name || '—'}
              {q.request_id && <> · <Link className="text-primary" to={`/solicitacoes/${q.request_id}`}>Solicitação {docNumber(settings, 'request', q.request_number)}</Link></>}
              {q.sent_at && ` · enviado ${fmtDateTime(q.sent_at)}${q.sent_via ? ` (${q.sent_via})` : ''}`}
            </p>
          )}
        </div>
        {q && (
          <div className="flex flex-wrap gap-2">
            <Link to={`/imprimir/orcamento/${q.id}`} target="_blank" className="btn-outline"><Printer className="h-4 w-4" /> Imprimir / PDF</Link>
            {canSend && <button className="btn-outline" onClick={() => setModal('send')}><Send className="h-4 w-4" /> Enviar</button>}
            {canDecide && <button className="btn-outline text-emerald-700" onClick={() => setModal('decision')}><Gavel className="h-4 w-4" /> Registrar decisão</button>}
            {can('quotes') && ['aprovado', 'parcialmente_aprovado', 'recusado', 'vencido'].includes(q.status) && <button className="btn-outline" onClick={reopen}><RotateCcw className="h-4 w-4" /> Reabrir para revisão</button>}
            {can('quotes_approve') && can('orders_create') && APPROVED.includes(q.status) && <button className="btn-primary" onClick={() => setModal('convert')}><ClipboardList className="h-4 w-4" /> Gerar OS</button>}
            {q.status === 'convertido' && q.order_id && <Link to={`/os/${q.order_id}`} className="btn-primary"><ClipboardList className="h-4 w-4" /> Ver {docNumber(settings, 'order', q.order_number)}</Link>}
          </div>
        )}
      </div>

      {q && APPROVED.includes(q.status) && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-app-sm border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-800 dark:text-emerald-200">
          <CheckCircle2 className="h-4 w-4" />
          {q.customer_response} · valor aprovado <b className="tabular-nums">{money(q.approved_total)}</b>
          {q.status === 'parcialmente_aprovado' && <span>· só os itens marcados vão para a OS</span>}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="card space-y-4 p-5">
            {readOnly ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div><div className="label">Cliente</div><div className="font-medium">{q.customer_name}</div><div className="text-sm text-ink-soft">{q.customer_phone}</div></div>
                <div><div className="label">Objeto de serviço</div><div>{[q.equipment_description, q.equipment_brand, q.equipment_model].filter(Boolean).join(' · ') || '—'}</div></div>
              </div>
            ) : (
              <>
                <CustomerPicker value={f.customer} onChange={(c) => setF({ ...f, customer: c, equipment_id: null, equipment: null })} />
                <EquipmentPicker customerId={f.customer?.id} value={f.equipment_id} onChange={set('equipment_id')} newEquipment={f.equipment} onNewEquipment={(e) => setF((x) => ({ ...x, equipment: e }))} />
              </>
            )}
            <Input label="Título" value={f.title} onChange={set('title')} disabled={readOnly} placeholder="Ex.: Fabricação de portão basculante 3,0 x 2,4 m" />
            <Textarea label="Escopo técnico (o que será feito)" rows={3} value={f.scope || ''} onChange={set('scope')} disabled={readOnly} />
            <Textarea label="Descrição para o cliente" rows={2} value={f.description || ''} onChange={set('description')} disabled={readOnly} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Textarea label="Premissas" rows={2} value={f.assumptions || ''} onChange={set('assumptions')} disabled={readOnly} placeholder="Ex.: acesso livre ao local, energia disponível" />
              <Textarea label="Exclusões" rows={2} value={f.exclusions || ''} onChange={set('exclusions')} disabled={readOnly} placeholder="Ex.: pintura final, alvenaria" />
            </div>
          </section>
          <section className="card space-y-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">Itens</h2>
              <span className="text-xs text-ink-faint">Marque como opcional/alternativa o que o cliente pode escolher</span>
            </div>
            <ItemsEditor items={f.items} onChange={set('items')} discount={f.discount} onDiscount={set('discount')} readOnly={readOnly}
              quoteMode surcharge={f.surcharge} onSurcharge={set('surcharge')} taxRate={f.tax_rate} showCost={showCost} editCost={showCost} />
          </section>
          {q && <Attachments entity="quote" entityId={q.id} canEdit={can('quotes')} />}
        </div>
        <div className="space-y-6">
          <section className="card space-y-4 p-5">
            <h2 className="font-semibold">Condições</h2>
            <Input label="Válido até" type="date" value={f.valid_until || ''} onChange={set('valid_until')} disabled={readOnly} />
            <div className="grid grid-cols-2 gap-3">
              <Input label="Prazo de execução (dias)" type="number" min={0} value={f.delivery_days ?? ''} onChange={set('delivery_days')} disabled={readOnly} />
              <Input label="Garantia (dias)" type="number" min={0} value={f.warranty_days ?? ''} onChange={set('warranty_days')} disabled={readOnly} />
            </div>
            <Input label="Forma de pagamento" value={f.payment_terms || ''} onChange={set('payment_terms')} disabled={readOnly} placeholder="Ex.: 50% na aprovação e 50% na entrega" />
            {showCost && <Input label="Tributos estimados (%)" type="number" min={0} max={100} step="0.01" value={f.tax_rate ?? 0} onChange={set('tax_rate')} disabled={readOnly} hint="Estimativa para cálculo da margem; não altera o valor ao cliente." />}
            <Select label="Técnico previsto" value={f.technician_id || ''} onChange={set('technician_id')} disabled={readOnly}>
              <option value="">—</option>{technicians.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
            <Textarea label="Termos e observações" rows={4} value={f.terms || ''} onChange={set('terms')} disabled={readOnly} />
            <Textarea label="Anotações internas" rows={2} value={f.internal_notes || ''} onChange={set('internal_notes')} disabled={readOnly} />
          </section>
          {q && settings.modules?.publicLinks && q.status !== 'rascunho' && (
            <section className="card space-y-2 p-5 text-sm">
              <div className="font-semibold">Link para o cliente</div>
              <p className="text-xs text-ink-faint">Mostra a revisão enviada; o cliente aprova (com os opcionais que quiser) ou recusa.</p>
              <a href={link} target="_blank" rel="noreferrer" className="flex items-center gap-1 break-all text-xs text-primary">{link} <ExternalLink className="h-3 w-3 shrink-0" /></a>
            </section>
          )}
          {q && (q.versions?.length > 0 || q.approvals?.length > 0) && <HistoryCard q={q} />}
          {q && (
            <div className="flex gap-2">
              {can('quotes') && <button className="btn-ghost flex-1" onClick={duplicate}><CopyPlus className="h-4 w-4" /> Duplicar</button>}
              {can('quotes') && q.status === 'rascunho' && !q.versions?.length && <button className="btn-ghost flex-1 text-red-600" onClick={remove}><Trash2 className="h-4 w-4" /> Excluir</button>}
            </div>
          )}
        </div>
      </div>

      {!readOnly && (
        <div className="action-bar">
          <div className="mx-auto flex max-w-[1400px] items-center justify-end gap-3 px-4 py-3 sm:px-8">
            <button className="btn-ghost" onClick={() => nav('/orcamentos')}>Voltar</button>
            <button className="btn-primary" disabled={busy || !f.customer || !f.title || !f.items.length} onClick={save}><Save className="h-4 w-4" /> Salvar orçamento</button>
          </div>
        </div>
      )}

      {modal === 'send' && <SendModal q={q} link={link} onClose={() => setModal(null)} onDone={(r) => { apply(r); setModal(null); }} />}
      {modal === 'decision' && <DecisionModal q={q} onClose={() => setModal(null)} onDone={(r) => { apply(r); setModal(null); }} />}
      {modal === 'convert' && <ConvertModal q={q} onClose={() => setModal(null)} onDone={(r) => nav(`/os/${r.order_id}`)} />}
    </div>
  );
}

function HistoryCard({ q }) {
  const [view, setView] = useState(null);
  const open = async (rev) => setView(await api.get(`/quotes/${q.id}/versions/${rev}`));
  return (
    <section className="card space-y-3 p-5 text-sm">
      <h2 className="flex items-center gap-2 font-semibold"><History className="h-4 w-4 text-ink-faint" /> Histórico</h2>
      {q.approvals?.map((a) => (
        <div key={a.id} className="rounded-app-sm border border-line p-2.5">
          <div className="flex items-center justify-between gap-2"><QuoteBadge status={a.decision} /><span className="text-xs text-ink-faint">rev. {a.revision}</span></div>
          <div className="mt-1">{a.decided_by} · {DECISION_VIAS[a.via] || a.via}</div>
          <div className="text-xs text-ink-faint">{fmtDateTime(a.decided_at)}{a.recorded_by_name && ` · registrado por ${a.recorded_by_name}`}</div>
          {a.approved_total != null && <div className="text-xs">Valor aprovado: <b className="tabular-nums">{money(a.approved_total)}</b></div>}
          {a.notes && <div className="mt-1 text-xs text-ink-soft">{a.notes}</div>}
        </div>
      ))}
      <div className="space-y-1">
        {q.versions?.map((v) => (
          <button key={v.id} onClick={() => open(v.revision)} className="flex w-full items-center justify-between gap-2 rounded-app-sm px-2 py-1.5 text-left hover:bg-muted">
            <span>Revisão {v.revision} <span className="text-xs text-ink-faint">· {fmt(v.created_at, 'dd/MM/yy HH:mm')}{v.sent_via && ` · ${v.sent_via}`}</span></span>
            <span className="tabular-nums">{money(v.total)}</span>
          </button>
        ))}
      </div>
      {view && (
        <Modal open onClose={() => setView(null)} size="lg" title={`Revisão ${view.revision} — como enviada`} subtitle={fmtDateTime(view.created_at)}>
          <div className="space-y-3 text-sm">
            <div className="font-medium">{view.snapshot.title}</div>
            {view.snapshot.scope && <p className="whitespace-pre-line text-ink-soft">{view.snapshot.scope}</p>}
            <ItemsEditor items={view.snapshot.items.map((i) => ({ ...i, approved: undefined }))} onChange={() => {}} readOnly quoteMode
              discount={view.snapshot.discount} surcharge={view.snapshot.surcharge} />
          </div>
        </Modal>
      )}
    </section>
  );
}

/** Registra o envio. Nada é enviado automaticamente: o usuário escolhe o canal e confirma a abertura. */
function SendModal({ q, link, onClose, onDone }) {
  const settings = useSettings();
  const { company } = useAuth();
  const { toast, confirm } = useUI();
  const [run, busy] = useAction();
  const text = fillTemplate(settings.whatsapp?.quote, {
    cliente: q.customer_name?.split(' ')[0], numero: docNumber(settings, 'quote', q.number), empresa: company.trade_name || company.name, total: money(q.total), link,
  });
  const record = async (via, msg) => {
    const r = await run(() => api.post(`/quotes/${q.id}/send`, { via }), msg);
    if (r !== FAIL) onDone(r);
    return r;
  };
  const whatsapp = async () => {
    const url = waLink(q.customer_phone, text);
    if (!url) return toast('Cliente sem telefone cadastrado.', 'error');
    if (!(await confirm({ title: 'Abrir o WhatsApp?', danger: false, confirmText: 'Abrir WhatsApp', message: `A mensagem com o link será aberta no seu WhatsApp para ${q.customer_name}. O envio é feito por você.` }))) return;
    window.open(url, '_blank', 'noopener');
    record('whatsapp', 'Envio registrado (WhatsApp)');
  };
  const email = async () => {
    if (!q.customer_email) return toast('Cliente sem e-mail cadastrado.', 'error');
    window.location.href = `mailto:${q.customer_email}?subject=${encodeURIComponent(`Orçamento ${docNumber(settings, 'quote', q.number)}`)}&body=${encodeURIComponent(text)}`;
    record('email', 'Envio registrado (e-mail)');
  };
  const copy = () => { navigator.clipboard?.writeText(link); record('link', 'Link copiado e envio registrado'); };
  return (
    <Modal open onClose={onClose} size="sm" title="Enviar orçamento" subtitle={q.status === 'rascunho' ? `Gera a revisão ${q.revision + 1} (fica congelada no histórico)` : `Reenvio da revisão ${q.revision}`}>
      <div className="space-y-2 text-sm">
        {settings.modules?.publicLinks && <button disabled={busy} className="btn-outline w-full justify-start" onClick={copy}><Link2 className="h-4 w-4" /> Copiar link do cliente</button>}
        {settings.modules?.publicLinks && <button disabled={busy} className="btn-outline w-full justify-start" onClick={whatsapp}><MessageCircle className="h-4 w-4 text-emerald-600" /> Abrir WhatsApp com a mensagem</button>}
        <button disabled={busy} className="btn-outline w-full justify-start" onClick={email}><Mail className="h-4 w-4" /> Abrir e-mail</button>
        <button disabled={busy} className="btn-outline w-full justify-start" onClick={() => record('impresso', 'Envio registrado (impresso)')}><Printer className="h-4 w-4" /> Entregue impresso</button>
        <button disabled={busy} className="btn-outline w-full justify-start" onClick={() => record('presencial', 'Envio registrado (presencial)')}><Copy className="h-4 w-4" /> Apresentado pessoalmente</button>
        <p className="pt-1 text-xs text-ink-faint">O TORVEN não dispara mensagens sozinho: registra a revisão e o canal que você usou.</p>
      </div>
    </Modal>
  );
}

function DecisionModal({ q, onClose, onDone }) {
  const [run, busy] = useAction();
  const [d, setD] = useState({ decision: 'aprovado', decided_by: q.customer_name || '', via: 'presencial', notes: '' });
  const [sel, setSel] = useState(() => new Set(q.items.filter((i) => !i.optional).map((i) => i.id)));
  const toggle = (id) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const approvedItems = d.decision === 'aprovado' ? q.items.filter((i) => !i.optional || sel.has(i.id)) : q.items.filter((i) => sel.has(i.id));
  const sub = approvedItems.reduce((a, i) => a + itemTotal(i), 0);
  const allBase = q.items.every((i) => i.optional || sel.has(i.id));
  const go = async () => {
    const decision = d.decision === 'aprovado' && !allBase ? 'parcialmente_aprovado' : d.decision;
    const r = await run(() => api.post(`/quotes/${q.id}/decision`, {
      ...d, decision, approved_item_ids: decision === 'recusado' ? [] : [...sel],
    }), decision === 'recusado' ? 'Recusa registrada' : 'Aprovação registrada');
    if (r !== FAIL) onDone(r);
  };
  return (
    <Modal open onClose={onClose} size="md" title="Registrar decisão do cliente" subtitle={q.status === 'rascunho' ? `Congela a revisão ${q.revision + 1} com a decisão` : `Revisão ${q.revision}`}
      footer={<><button className="btn-ghost" onClick={onClose}>Voltar</button><button className={d.decision === 'recusado' ? 'btn-danger' : 'btn-primary'} disabled={busy || d.decided_by.trim().length < 2 || (d.decision !== 'recusado' && !approvedItems.length)} onClick={go}>Registrar</button></>}>
      <div className="space-y-4 text-sm">
        <div className="grid grid-cols-2 gap-2">
          {[['aprovado', 'Aprovado'], ['recusado', 'Recusado']].map(([k, l]) => (
            <button key={k} type="button" onClick={() => setD({ ...d, decision: k })}
              className={cx('rounded-app-sm border px-3 py-2 font-medium', d.decision === k ? (k === 'recusado' ? 'border-red-500 bg-red-500/10 text-red-700' : 'border-emerald-500 bg-emerald-500/10 text-emerald-700') : 'border-line')}>{l}</button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Quem decidiu (cliente)" value={d.decided_by} onChange={(e) => setD({ ...d, decided_by: e.target.value })} />
          <Select label="Como" value={d.via} onChange={(e) => setD({ ...d, via: e.target.value })}>
            {Object.entries(DECISION_VIAS).filter(([k]) => k !== 'link').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </div>
        {d.decision === 'aprovado' && (
          <div>
            <div className="label">Itens aprovados</div>
            <div className="max-h-60 space-y-1 overflow-y-auto rounded-app-sm border border-line p-2">
              {q.items.map((i) => (
                <label key={i.id} className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-muted">
                  <input type="checkbox" checked={sel.has(i.id)} onChange={() => toggle(i.id)} />
                  <span className="min-w-0 flex-1 truncate">{i.description}{i.optional && <span className="ml-1 text-xs text-ink-faint">(opcional)</span>}</span>
                  <span className="tabular-nums text-ink-soft">{money(itemTotal(i))}</span>
                </label>
              ))}
            </div>
            <div className="mt-2 flex justify-between text-xs text-ink-soft">
              <span>{allBase ? 'Aprovação total' : 'Aprovação parcial'}</span>
              <span>Itens selecionados: <b className="tabular-nums">{money(sub)}</b> (desconto/acréscimo proporcionais)</span>
            </div>
          </div>
        )}
        <Textarea label={d.decision === 'recusado' ? 'Motivo da recusa' : 'Observações'} rows={2} value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })} />
      </div>
    </Modal>
  );
}

function ConvertModal({ q, onClose, onDone }) {
  const { technicians } = useCatalog();
  const [run, busy] = useAction();
  const [tech, setTech] = useState(q.technician_id || '');
  const go = async () => {
    const r = await run(() => api.post(`/quotes/${q.id}/convert`, { technician_id: tech || null }), 'OS gerada a partir do orçamento');
    if (r !== FAIL) onDone(r);
  };
  const n = q.items.filter((i) => (q.items.some((x) => x.approved !== null) ? i.approved : !i.optional)).length;
  return (
    <Modal open onClose={onClose} size="sm" title="Gerar ordem de serviço"
      footer={<><button className="btn-ghost" onClick={onClose}>Voltar</button><button className="btn-primary" disabled={busy} onClick={go}>Gerar OS</button></>}>
      <div className="space-y-4 text-sm">
        <p>{n} item(ns) aprovado(s) serão copiados para a OS ({money(q.approved_total ?? q.total)}). Os materiais saem do estoque.</p>
        <Select label="Técnico responsável" value={tech} onChange={(e) => setTech(e.target.value)}>
          <option value="">A definir</option>{technicians.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>
      </div>
    </Modal>
  );
}

