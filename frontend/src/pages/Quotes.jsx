import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { addDays, format } from 'date-fns';
import {
  Plus, Search, FileText, Printer, MessageCircle, Copy, CheckCircle2, XCircle, ClipboardList, Trash2, CopyPlus, Save, ExternalLink,
} from 'lucide-react';
import { api, qs } from '../lib/api';
import { money, fmt, QUOTE_STATUS, fillTemplate, waLink } from '../lib/format';
import { useAuth, useSettings } from '../context/AuthContext';
import { useCatalog } from '../context/CatalogContext';
import { useUI } from '../context/UIContext';
import { PageHeader, Input, Textarea, Select, Loading, Empty, Modal, useAction, FAIL, cx } from '../components/ui';
import CustomerPicker, { EquipmentPicker } from '../components/CustomerPicker';
import ItemsEditor, { cleanItems } from '../components/ItemsEditor';
import { publicUrl } from './OrderDetail';

export const QuoteBadge = ({ status }) => <span className={cx('chip whitespace-nowrap', QUOTE_STATUS[status]?.cls)}>{QUOTE_STATUS[status]?.label}</span>;

export default function Quotes() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const { can } = useAuth();
  const [f, setF] = useState({ search: '', status: params.get('status') || '' });
  const [list, setList] = useState(null);
  const load = useCallback(() => api.get(`/quotes${qs(f)}`).then(setList), [f]);
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);
  const pending = (list || []).filter((q) => ['rascunho', 'enviado'].includes(q.status));
  const approved = (list || []).filter((q) => ['aprovado', 'convertido'].includes(q.status));

  return (
    <div>
      <PageHeader title="Orçamentos" subtitle="Envie pelo WhatsApp, o cliente aprova pelo link e vira OS com um clique"
        actions={can('quotes') && <Link to="/orcamentos/novo" className="btn-primary"><Plus className="h-4 w-4" /> Novo orçamento</Link>} />
      {list && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="card p-4"><div className="text-xs text-ink-faint">Aguardando resposta</div><div className="mt-1 text-xl font-semibold">{pending.length}</div><div className="text-xs text-ink-faint tabular-nums">{money(pending.reduce((a, q) => a + q.total, 0))}</div></div>
          <div className="card p-4"><div className="text-xs text-ink-faint">Aprovados</div><div className="mt-1 text-xl font-semibold">{approved.length}</div><div className="text-xs text-ink-faint tabular-nums">{money(approved.reduce((a, q) => a + q.total, 0))}</div></div>
          <div className="card p-4"><div className="text-xs text-ink-faint">Taxa de aprovação</div><div className="mt-1 text-xl font-semibold">
            {(() => { const dec = list.filter((q) => ['aprovado', 'convertido', 'recusado', 'expirado'].includes(q.status)); return dec.length ? `${Math.round((approved.length / dec.length) * 100)}%` : '—'; })()}
          </div><div className="text-xs text-ink-faint">no filtro atual</div></div>
        </div>
      )}
      <div className="card mb-4 flex flex-wrap items-end gap-3 p-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <input className="input pl-9" placeholder="Nº, título ou cliente…" value={f.search} onChange={(e) => setF({ ...f, search: e.target.value })} />
        </div>
        <select className="input w-48" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
          <option value="">Todas as situações</option><option value="pendentes">Aguardando resposta</option>
          {Object.entries(QUOTE_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>
      <div className="card overflow-hidden">
        {!list ? <Loading /> : !list.length ? <Empty icon={FileText} title="Nenhum orçamento" /> : (
          <div className="overflow-x-auto">
            <table className="table-clean">
              <thead><tr><th>Nº</th><th>Orçamento</th><th className="hidden md:table-cell">Data</th><th className="hidden md:table-cell">Validade</th><th>Situação</th><th className="text-right">Total</th></tr></thead>
              <tbody>
                {list.map((q) => (
                  <tr key={q.id} className="cursor-pointer" onClick={() => nav(`/orcamentos/${q.id}`)}>
                    <td className="font-medium tabular-nums">#{q.number}</td>
                    <td><div className="max-w-[320px] truncate">{q.title}</div><div className="max-w-[320px] truncate text-xs text-ink-faint">{q.customer_name}{q.equipment_description && ` · ${q.equipment_description}`}</div></td>
                    <td className="hidden whitespace-nowrap text-ink-soft md:table-cell">{fmt(q.created_at, 'dd/MM/yy')}</td>
                    <td className="hidden whitespace-nowrap text-ink-soft md:table-cell">{fmt(q.valid_until, 'dd/MM/yy')}</td>
                    <td><QuoteBadge status={q.status} />{q.order_number && <div className="mt-0.5 text-xs text-ink-faint">OS #{q.order_number}</div>}</td>
                    <td className="text-right font-medium tabular-nums">{money(q.total)}</td>
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

const blank = (settings) => ({
  customer: null, equipment_id: null, equipment: null, technician_id: '', title: '', description: '', items: [], discount: 0,
  valid_until: format(addDays(new Date(), settings.orders?.quoteValidityDays || 15), 'yyyy-MM-dd'),
  payment_terms: '', delivery_days: 3, warranty_days: settings.orders?.defaultWarrantyDays ?? 90, terms: settings.orders?.termsQuote || '', internal_notes: '',
});

export function QuoteEditor() {
  const { id } = useParams();
  const nav = useNavigate();
  const settings = useSettings();
  const { can, company } = useAuth();
  const { technicians } = useCatalog();
  const { confirm, toast } = useUI();
  const [run, busy] = useAction();
  const [q, setQ] = useState(null);
  const [f, setF] = useState(id ? null : blank(settings));
  const [convert, setConvert] = useState(false);

  const apply = (r) => {
    setQ(r);
    setF({
      ...r, customer: r.customer_id ? { id: r.customer_id, name: r.customer_name, phone: r.customer_phone, document: r.customer_document } : null,
      equipment: null, technician_id: r.technician_id || '', discount: Number(r.discount),
      items: r.items.map((i) => ({ ...i, qty: Number(i.qty), unit_price: Number(i.unit_price), discount: Number(i.discount) })),
    });
  };
  const [params] = useSearchParams();
  useEffect(() => { if (id) api.get(`/quotes/${id}`).then(apply).catch((e) => { toast(e.message, 'error'); nav('/orcamentos'); }); }, [id]); // eslint-disable-line
  useEffect(() => {
    const c = params.get('cliente');
    if (!id && c) api.get(`/customers/${c}`).then((x) => setF((y) => ({ ...y, customer: x }))).catch(() => {});
  }, [id, params]);

  if (!f) return <Loading />;
  const locked = q && ['aprovado', 'convertido'].includes(q.status);
  const readOnly = locked || !can('quotes');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));
  const link = q && publicUrl(`/p/orcamento/${q.public_token}`);

  const save = async () => {
    const body = {
      customer_id: f.customer?.id, equipment_id: f.equipment_id || null, equipment: f.equipment?.description ? f.equipment : null,
      technician_id: f.technician_id || null, title: f.title, description: f.description, items: cleanItems(f.items), discount: Number(f.discount) || 0,
      valid_until: f.valid_until || null, payment_terms: f.payment_terms, delivery_days: f.delivery_days === '' ? null : Number(f.delivery_days),
      warranty_days: f.warranty_days === '' ? null : Number(f.warranty_days), terms: f.terms, internal_notes: f.internal_notes,
    };
    const r = await run(() => (q ? api.put(`/quotes/${q.id}`, body) : api.post('/quotes', body)), 'Orçamento salvo');
    if (r !== FAIL) { apply(r); if (!q) nav(`/orcamentos/${r.id}`, { replace: true }); }
    return r;
  };
  const status = async (s, msg) => {
    const r = await run(() => api.post(`/quotes/${q.id}/status`, { status: s }), msg);
    if (r !== FAIL) apply(r);
  };
  const send = async () => {
    const text = fillTemplate(settings.whatsapp.quote, {
      cliente: q.customer_name?.split(' ')[0], numero: q.number, empresa: company.trade_name || company.name, total: money(q.total), link,
    });
    const url = waLink(q.customer_phone, text);
    if (!url) return toast('Cliente sem telefone cadastrado.', 'error');
    window.open(url, '_blank');
    if (q.status === 'rascunho') status('enviado');
  };
  const duplicate = async () => {
    const r = await run(() => api.post(`/quotes/${q.id}/duplicate`), 'Orçamento duplicado');
    if (r !== FAIL) nav(`/orcamentos/${r.id}`);
  };
  const remove = async () => {
    if (!(await confirm({ title: `Excluir orçamento nº ${q.number}?`, confirmText: 'Excluir' }))) return;
    if ((await run(() => api.del(`/quotes/${q.id}`), 'Orçamento excluído')) !== FAIL) nav('/orcamentos');
  };

  return (
    <div className="pb-24">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{q ? `Orçamento nº ${q.number}` : 'Novo orçamento'}</h1>
            {q && <QuoteBadge status={q.status} />}
          </div>
          {q && <p className="mt-0.5 text-sm text-ink-faint">Criado em {fmt(q.created_at)} por {q.created_by_name || '—'}{q.customer_response && ` · ${q.customer_response}`}</p>}
        </div>
        {q && (
          <div className="flex flex-wrap gap-2">
            <Link to={`/imprimir/orcamento/${q.id}`} target="_blank" className="btn-outline"><Printer className="h-4 w-4" /> Imprimir / PDF</Link>
            {settings.modules?.publicLinks && !locked && <button className="btn-outline" onClick={send}><MessageCircle className="h-4 w-4 text-emerald-600" /> Enviar</button>}
            {settings.modules?.publicLinks && <button className="btn-outline btn-icon" title="Copiar link do cliente" onClick={() => { navigator.clipboard?.writeText(link); toast('Link copiado'); }}><Copy className="h-4 w-4" /></button>}
            {can('quotes_approve') && ['rascunho', 'enviado', 'expirado', 'recusado'].includes(q.status) && <>
              {q.status !== 'recusado' && <button className="btn-outline text-red-600" onClick={() => status('recusado', 'Marcado como recusado')}><XCircle className="h-4 w-4" /> Recusado</button>}
              <button className="btn-outline text-emerald-700" onClick={() => status('aprovado', 'Orçamento aprovado')}><CheckCircle2 className="h-4 w-4" /> Aprovado</button>
            </>}
            {can('quotes_approve') && q.status === 'aprovado' && <button className="btn-primary" onClick={() => setConvert(true)}><ClipboardList className="h-4 w-4" /> Gerar OS</button>}
            {q.status === 'convertido' && q.order_id && <Link to={`/os/${q.order_id}`} className="btn-primary"><ClipboardList className="h-4 w-4" /> Ver OS nº {q.order_number}</Link>}
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="card space-y-4 p-5">
            {readOnly ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div><div className="label">Cliente</div><div className="font-medium">{q.customer_name}</div><div className="text-sm text-ink-soft">{q.customer_phone}</div></div>
                <div><div className="label">Equipamento</div><div>{[q.equipment_description, q.equipment_brand, q.equipment_model].filter(Boolean).join(' · ') || '—'}</div></div>
              </div>
            ) : (
              <>
                <CustomerPicker value={f.customer} onChange={(c) => setF({ ...f, customer: c, equipment_id: null, equipment: null })} />
                <EquipmentPicker customerId={f.customer?.id} value={f.equipment_id} onChange={set('equipment_id')} newEquipment={f.equipment} onNewEquipment={(e) => setF((x) => ({ ...x, equipment: e }))} />
              </>
            )}
            <Input label="Título" value={f.title} onChange={set('title')} disabled={readOnly} placeholder="Ex.: Fabricação de portão basculante 3,0 x 2,4 m" />
            <Textarea label="Descrição do serviço (aparece para o cliente)" rows={3} value={f.description} onChange={set('description')} disabled={readOnly} />
          </section>
          <section className="card space-y-4 p-5">
            <h2 className="font-semibold">Itens</h2>
            <ItemsEditor items={f.items} onChange={set('items')} discount={f.discount} onDiscount={set('discount')} readOnly={readOnly} />
          </section>
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
            <Select label="Técnico previsto" value={f.technician_id || ''} onChange={set('technician_id')} disabled={readOnly}>
              <option value="">—</option>{technicians.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
            <Textarea label="Termos e observações" rows={4} value={f.terms || ''} onChange={set('terms')} disabled={readOnly} />
            <Textarea label="Anotações internas" rows={2} value={f.internal_notes || ''} onChange={set('internal_notes')} disabled={readOnly} />
          </section>
          {q && settings.modules?.publicLinks && (
            <section className="card space-y-2 p-5 text-sm">
              <div className="font-semibold">Link para o cliente</div>
              <p className="text-xs text-ink-faint">O cliente vê o orçamento com sua marca e aprova ou recusa online.</p>
              <a href={link} target="_blank" rel="noreferrer" className="flex items-center gap-1 break-all text-xs text-primary">{link} <ExternalLink className="h-3 w-3 shrink-0" /></a>
            </section>
          )}
          {q && (
            <div className="flex gap-2">
              {can('quotes') && <button className="btn-ghost flex-1" onClick={duplicate}><CopyPlus className="h-4 w-4" /> Duplicar</button>}
              {can('quotes') && q.status !== 'convertido' && <button className="btn-ghost flex-1 text-red-600" onClick={remove}><Trash2 className="h-4 w-4" /> Excluir</button>}
            </div>
          )}
        </div>
      </div>

      {!readOnly && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur">
          <div className="mx-auto flex max-w-[1400px] items-center justify-end gap-3 px-4 py-3 sm:px-8">
            <button className="btn-ghost" onClick={() => nav('/orcamentos')}>Voltar</button>
            <button className="btn-primary" disabled={busy || !f.customer || !f.title || !f.items.length} onClick={save}><Save className="h-4 w-4" /> Salvar orçamento</button>
          </div>
        </div>
      )}

      {convert && (
        <ConvertModal q={q} onClose={() => setConvert(false)} onDone={(r) => nav(`/os/${r.order_id}`)} />
      )}
    </div>
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
  return (
    <Modal open onClose={onClose} size="sm" title="Gerar ordem de serviço"
      footer={<><button className="btn-ghost" onClick={onClose}>Voltar</button><button className="btn-primary" disabled={busy} onClick={go}>Gerar OS</button></>}>
      <div className="space-y-4 text-sm">
        <p>Os itens do orçamento serão copiados para a OS e os materiais serão reservados (baixados) do estoque.</p>
        <Select label="Técnico responsável" value={tech} onChange={(e) => setTech(e.target.value)}>
          <option value="">A definir</option>{technicians.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>
      </div>
    </Modal>
  );
}
