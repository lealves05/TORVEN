// Compras: sugestão de reposição, cotações (mapa de preços), pedidos de compra, recebimento conferido e separação para OS.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Plus, ShoppingBag, FileSpreadsheet, Truck, PackageCheck, Send, XCircle, AlertTriangle, CheckCircle2, Trash2, PackageOpen } from 'lucide-react';
import { addDays, format } from 'date-fns';
import { api, qs } from '../lib/api';
import { money, qty as fqty, fmt, docNumber } from '../lib/format';
import { useAuth, useSettings } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import { PageHeader, Tabs, Input, Select, Loading, Empty, Modal, MoneyInput, useAction, FAIL, cx } from '../components/ui';
import { useTable, SortTh, Pager } from '../components/Table';
import Attachments from '../components/Attachments';

export const PO_STATUS = {
  rascunho: { label: 'Rascunho', cls: 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-300' },
  enviado: { label: 'Enviado', cls: 'bg-sky-500/10 text-sky-700 dark:text-sky-300' },
  parcial: { label: 'Recebido parcial', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
  recebido: { label: 'Recebido', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  cancelado: { label: 'Cancelado', cls: 'bg-red-500/10 text-red-700 dark:text-red-300' },
};
const QT_STATUS = {
  aberta: { label: 'Aberta', cls: 'bg-sky-500/10 text-sky-700 dark:text-sky-300' },
  fechada: { label: 'Fechada', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  cancelada: { label: 'Cancelada', cls: 'bg-red-500/10 text-red-700 dark:text-red-300' },
};
const Badge = ({ map, s }) => <span className={cx('chip whitespace-nowrap', map[s]?.cls)}>{map[s]?.label || s}</span>;
const num = (v) => Number(String(v ?? '').replace(',', '.')) || 0;

function useSuppliers() {
  const [list, setList] = useState([]);
  useEffect(() => { api.get('/suppliers').then(setList).catch(() => {}); }, []);
  return list;
}

export default function Procurement() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('aba') || 'sugestoes';
  return (
    <div>
      <PageHeader title="Compras" subtitle="Reposição, cotação com fornecedores, pedido de compra e recebimento conferido" />
      <Tabs value={tab} onChange={(t) => setParams({ aba: t })} tabs={[
        { value: 'sugestoes', label: 'Sugestão de compra' }, { value: 'cotacoes', label: 'Cotações' }, { value: 'pedidos', label: 'Pedidos de compra' },
      ]} />
      {tab === 'sugestoes' && <Suggestions />}
      {tab === 'cotacoes' && <Quotations />}
      {tab === 'pedidos' && <PurchaseOrders />}
    </div>
  );
}

function Suggestions() {
  const nav = useNavigate();
  const [list, setList] = useState(null);
  const [sel, setSel] = useState({});
  const [modal, setModal] = useState(false);
  useEffect(() => { api.get('/procurement/suggestions').then((l) => { setList(l); setSel(Object.fromEntries(l.map((x) => [x.id, x.suggested]))); }).catch(() => setList([])); }, []);
  const chosen = (list || []).filter((x) => num(sel[x.id]) > 0);
  if (!list) return <Loading />;
  return (
    <div className="space-y-4">
      <div className="card overflow-hidden">
        {!list.length ? <Empty icon={CheckCircle2} title="Estoque em dia" text="Nenhum material abaixo do mínimo considerando os pedidos em aberto." /> : (
          <div className="overflow-x-auto">
            <table className="table-clean">
              <thead><tr><th>Material</th><th className="text-right">Estoque</th><th className="hidden text-right md:table-cell">Mínimo</th><th className="hidden text-right md:table-cell">A caminho</th><th className="hidden md:table-cell">OS</th><th className="text-right">Comprar</th></tr></thead>
              <tbody>
                {list.map((x) => (
                  <tr key={x.id}>
                    <td><div className="font-medium">{x.name}</div><div className="text-xs text-ink-faint">{x.supplier_name || 'sem fornecedor padrão'}{x.lead_days ? ` · ${x.lead_days} dias` : ''}</div></td>
                    <td className={cx('text-right tabular-nums', x.stock < 0 && 'text-red-600')}>{fqty(x.stock)} {x.unit}</td>
                    <td className="hidden text-right tabular-nums md:table-cell">{fqty(x.min_stock)}</td>
                    <td className="hidden text-right tabular-nums md:table-cell">{fqty(x.incoming)}</td>
                    <td className="hidden text-xs text-ink-faint md:table-cell">{x.orders?.length ? x.orders.map((n) => `OS ${n}`).join(', ') : '—'}</td>
                    <td className="text-right"><input className="input h-8 w-24 text-right tabular-nums" inputMode="decimal" value={sel[x.id] ?? ''} onChange={(e) => setSel({ ...sel, [x.id]: e.target.value })} aria-label={`Quantidade de ${x.name}`} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {list.length > 0 && (
        <div className="flex justify-end gap-2">
          <button className="btn-primary" disabled={!chosen.length} onClick={() => setModal(true)}><FileSpreadsheet className="h-4 w-4" /> Cotar {chosen.length} item(ns)</button>
        </div>
      )}
      {modal && <NewQuotation initial={chosen.map((x) => ({ product_id: x.id, description: x.name, unit: x.unit, qty: num(sel[x.id]), supplier_id: x.supplier_id }))}
        onClose={() => setModal(false)} onDone={(q) => nav(`/compras/cotacoes/${q.id}`)} />}
    </div>
  );
}

function NewQuotation({ initial = [], onClose, onDone }) {
  const suppliers = useSuppliers();
  const [run, busy] = useAction();
  const [products, setProducts] = useState([]);
  useEffect(() => { api.get('/products').then(setProducts).catch(() => {}); }, []);
  const [f, setF] = useState({ title: `Reposição ${format(new Date(), 'dd/MM')}`, due_date: format(addDays(new Date(), 3), 'yyyy-MM-dd'), items: initial.length ? initial : [], supplier_ids: [] });
  useEffect(() => {
    const pre = [...new Set(initial.map((i) => i.supplier_id).filter(Boolean))];
    if (pre.length) setF((x) => ({ ...x, supplier_ids: pre }));
  }, []); // eslint-disable-line
  const toggle = (id) => setF({ ...f, supplier_ids: f.supplier_ids.includes(id) ? f.supplier_ids.filter((x) => x !== id) : [...f.supplier_ids, id] });
  const setIt = (k, patch) => setF({ ...f, items: f.items.map((x, i) => (i === k ? { ...x, ...patch } : x)) });
  const go = async () => {
    const r = await run(() => api.post('/procurement/quotations', { ...f, items: f.items.map(({ supplier_id, ...i }) => ({ ...i, qty: num(i.qty) })) }), 'Cotação aberta');
    if (r !== FAIL) onDone(r);
  };
  return (
    <Modal open onClose={onClose} size="lg" title="Nova cotação"
      footer={<><button className="btn-ghost" onClick={onClose}>Voltar</button><button className="btn-primary" disabled={busy || !f.items.length || !f.supplier_ids.length || f.items.some((i) => !i.description || num(i.qty) <= 0)} onClick={go}>Abrir cotação</button></>}>
      <div className="space-y-4 text-sm">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Título" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          <Input label="Prazo para respostas" type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} />
        </div>
        <div>
          <div className="label">Fornecedores consultados</div>
          <div className="flex flex-wrap gap-1.5">
            {suppliers.map((sp) => <button key={sp.id} type="button" onClick={() => toggle(sp.id)} className={cx('chip border', f.supplier_ids.includes(sp.id) ? 'border-primary bg-primary/10 text-primary' : 'border-line')}>{sp.name}</button>)}
            {!suppliers.length && <span className="text-ink-faint">Cadastre fornecedores em Materiais › Fornecedores.</span>}
          </div>
        </div>
        <div>
          <div className="label">Itens</div>
          <div className="space-y-2">
            {f.items.map((i, k) => (
              <div key={k} className="flex flex-wrap items-center gap-2">
                <input className="input h-9 min-w-[200px] flex-1" value={i.description} onChange={(e) => setIt(k, { description: e.target.value })} placeholder="Descrição" />
                <input className="input h-9 w-24 text-right" inputMode="decimal" value={String(i.qty)} onChange={(e) => setIt(k, { qty: e.target.value })} aria-label="Quantidade" />
                <span className="w-8 text-xs text-ink-faint">{i.unit}</span>
                <button type="button" className="btn-ghost btn-icon h-9 text-red-600" aria-label="Remover" onClick={() => setF({ ...f, items: f.items.filter((_, x) => x !== k) })}><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
          <select className="input mt-2 h-9" value="" onChange={(e) => { const p = products.find((x) => x.id === e.target.value); if (p) setF({ ...f, items: [...f.items, { product_id: p.id, description: p.name, unit: p.unit, qty: 1 }] }); }} aria-label="Adicionar material">
            <option value="">+ Adicionar material do cadastro…</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button type="button" className="btn-ghost mt-1 h-8 text-xs" onClick={() => setF({ ...f, items: [...f.items, { description: '', unit: 'un', qty: 1 }] })}><Plus className="h-3.5 w-3.5" /> Item avulso</button>
        </div>
      </div>
    </Modal>
  );
}

function Quotations() {
  const nav = useNavigate();
  const settings = useSettings();
  const [list, setList] = useState(null);
  const [modal, setModal] = useState(false);
  useEffect(() => { api.get('/procurement/quotations').then(setList).catch(() => setList([])); }, []);
  const t = useTable(list, { sort: 'number', dir: 'desc' });
  return (
    <div className="space-y-4">
      <div className="flex justify-end"><button className="btn-primary" onClick={() => setModal(true)}><Plus className="h-4 w-4" /> Nova cotação</button></div>
      <div className="card overflow-hidden">
        {!list ? <Loading /> : !list.length ? <Empty icon={FileSpreadsheet} title="Nenhuma cotação" /> : (
          <>
            <div className="overflow-x-auto">
              <table className="table-clean">
                <thead><tr><SortTh t={t} k="number">Nº</SortTh><SortTh t={t} k="title">Cotação</SortTh><SortTh t={t} k="created_at" className="hidden md:table-cell">Abertura</SortTh><th className="text-right">Itens / fornecedores</th><SortTh t={t} k="status">Situação</SortTh></tr></thead>
                <tbody>
                  {t.rows.map((x) => (
                    <tr key={x.id} className="cursor-pointer" onClick={() => nav(`/compras/cotacoes/${x.id}`)}>
                      <td className="font-medium tabular-nums">{docNumber(settings, 'quotation', x.number)}</td>
                      <td>{x.title}</td>
                      <td className="hidden whitespace-nowrap text-ink-soft md:table-cell">{fmt(x.created_at, 'dd/MM/yy')}</td>
                      <td className="text-right tabular-nums">{x.items_count} / {x.suppliers_count}</td>
                      <td><Badge map={QT_STATUS} s={x.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager t={t} />
          </>
        )}
      </div>
      {modal && <NewQuotation onClose={() => setModal(false)} onDone={(q) => nav(`/compras/cotacoes/${q.id}`)} />}
    </div>
  );
}

/** Mapa de preços: um preço por item × fornecedor; escolha e geração dos pedidos. */
export function QuotationDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const settings = useSettings();
  const { confirm } = useUI();
  const [run, busy] = useAction();
  const [qt, setQt] = useState(null);
  const [prices, setPrices] = useState({});
  const [choice, setChoice] = useState({});
  const apply = useCallback((x) => {
    setQt(x);
    setPrices(Object.fromEntries(x.items.flatMap((i) => i.prices.map((p) => [`${i.id}:${p.supplier_id}`, String(p.unit_cost).replace('.', ',')]))));
    setChoice(Object.fromEntries(x.items.filter((i) => i.chosen_supplier_id).map((i) => [i.id, i.chosen_supplier_id])));
  }, []);
  useEffect(() => { api.get(`/procurement/quotations/${id}`).then(apply).catch(() => nav('/compras?aba=cotacoes')); }, [id]); // eslint-disable-line
  if (!qt) return <Loading />;
  const open = qt.status === 'aberta';
  const savePrices = async () => {
    const body = qt.items.flatMap((i) => qt.suppliers.map((sp) => {
      const v = prices[`${i.id}:${sp.id}`];
      return { item_id: i.id, supplier_id: sp.id, unit_cost: v === undefined || v === '' ? null : num(v) };
    }));
    const r = await run(() => api.post(`/procurement/quotations/${qt.id}/prices`, { prices: body }), 'Preços salvos');
    if (r !== FAIL) apply(r);
    return r;
  };
  const close = async () => {
    if ((await savePrices()) === FAIL) return;
    if (!(await confirm({ title: 'Fechar cotação e gerar pedidos?', danger: false, confirmText: 'Gerar pedidos', message: 'Será criado um pedido de compra (em rascunho) para cada fornecedor escolhido.' }))) return;
    const r = await run(() => api.post(`/procurement/quotations/${qt.id}/close`, { choices: qt.items.map((i) => ({ item_id: i.id, supplier_id: eff(i) || null })) }), 'Pedidos de compra gerados');
    if (r !== FAIL) apply(r.quotation);
  };
  const cancel = async () => {
    if (!(await confirm({ title: 'Cancelar cotação?', confirmText: 'Cancelar cotação' }))) return;
    const r = await run(() => api.post(`/procurement/quotations/${qt.id}/cancel`), 'Cotação cancelada');
    if (r !== FAIL) apply(r);
  };
  /** Fornecedor escolhido: o que o usuário marcou ou, por padrão, o de menor preço digitado. */
  const eff = (i) => {
    if (choice[i.id] !== undefined) return choice[i.id];
    let best = '';
    let min = Infinity;
    for (const sp of qt.suppliers) {
      const v = prices[`${i.id}:${sp.id}`];
      if (v !== undefined && v !== '' && num(v) < min) { min = num(v); best = sp.id; }
    }
    return best;
  };
  const totalFor = (sid) => qt.items.reduce((a, i) => a + (prices[`${i.id}:${sid}`] ? num(prices[`${i.id}:${sid}`]) * Number(i.qty) : 0), 0);
  const chosenTotal = qt.items.reduce((a, i) => { const c = eff(i); return a + (c && prices[`${i.id}:${c}`] ? num(prices[`${i.id}:${c}`]) * Number(i.qty) : 0); }, 0);
  return (
    <div className="pb-2">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><h1 className="text-xl font-semibold sm:text-2xl">Cotação {docNumber(settings, 'quotation', qt.number)}</h1><Badge map={QT_STATUS} s={qt.status} /></div>
          <p className="mt-0.5 text-sm text-ink-faint">{qt.title} · aberta {fmt(qt.created_at)}{qt.due_date && ` · respostas até ${fmt(qt.due_date)}`}</p>
        </div>
        {open && <div className="flex gap-2"><button className="btn-ghost text-red-600" onClick={cancel}>Cancelar</button><button className="btn-outline" disabled={busy} onClick={savePrices}>Salvar preços</button><button className="btn-primary" disabled={busy} onClick={close}><ShoppingBag className="h-4 w-4" /> Fechar e gerar pedidos</button></div>}
      </div>
      <p className="mb-3 text-sm text-ink-soft">Digite o preço unitário que cada fornecedor informou. O menor preço de cada item fica destacado; escolha o fornecedor na última coluna.</p>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-muted/50 text-xs text-ink-faint">
            <tr><th className="px-3 py-2 text-left font-medium">Item</th><th className="px-2 py-2 text-right font-medium">Qtd.</th>
              {qt.suppliers.map((sp) => <th key={sp.id} className="px-2 py-2 text-right font-medium">{sp.name}</th>)}
              <th className="px-3 py-2 text-left font-medium">Escolhido</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {qt.items.map((i) => {
              const vals = qt.suppliers.map((sp) => prices[`${i.id}:${sp.id}`]).filter((v) => v !== undefined && v !== '').map(num);
              const min = vals.length ? Math.min(...vals) : null;
              return (
                <tr key={i.id}>
                  <td className="px-3 py-2"><div>{i.description}</div>{i.order_number && <div className="text-xs text-ink-faint">para OS nº {i.order_number}</div>}{i.last_cost != null && <div className="text-xs text-ink-faint">último custo {money(i.last_cost)}</div>}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{fqty(i.qty)} {i.unit}</td>
                  {qt.suppliers.map((sp) => {
                    const v = prices[`${i.id}:${sp.id}`];
                    const best = v !== undefined && v !== '' && num(v) === min;
                    return (
                      <td key={sp.id} className="px-2 py-2 text-right">
                        {open ? <input className={cx('input h-8 w-24 text-right tabular-nums', best && 'border-emerald-500 bg-emerald-500/10')} inputMode="decimal" value={v ?? ''} placeholder="—"
                          onChange={(e) => setPrices({ ...prices, [`${i.id}:${sp.id}`]: e.target.value.replace(/[^\d,.]/g, '') })} aria-label={`Preço de ${sp.name} para ${i.description}`} />
                          : <span className={cx('tabular-nums', best && 'font-semibold text-emerald-700')}>{v ? money(num(v)) : '—'}</span>}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2">
                    {open ? (
                      <select className="input h-8 w-40 text-xs" value={eff(i)} onChange={(e) => setChoice({ ...choice, [i.id]: e.target.value })} aria-label="Fornecedor escolhido">
                        <option value="">Não comprar</option>{qt.suppliers.filter((sp) => prices[`${i.id}:${sp.id}`]).map((sp) => <option key={sp.id} value={sp.id}>{sp.name}</option>)}
                      </select>
                    ) : <span className="text-xs">{qt.suppliers.find((sp) => sp.id === i.chosen_supplier_id)?.name || '—'}</span>}
                  </td>
                </tr>
              );
            })}
            <tr className="bg-muted/30 font-medium">
              <td className="px-3 py-2" colSpan={2}>Total se comprar tudo</td>
              {qt.suppliers.map((sp) => <td key={sp.id} className="px-2 py-2 text-right tabular-nums">{money(totalFor(sp.id))}</td>)}
              <td className="px-3 py-2 tabular-nums">{money(chosenTotal)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {qt.purchase_orders?.length > 0 && (
        <div className="card mt-6 p-5 text-sm">
          <h2 className="mb-2 font-semibold">Pedidos gerados</h2>
          {qt.purchase_orders.map((po) => (
            <Link key={po.id} to={`/compras/pedidos/${po.id}`} className="flex items-center gap-3 py-1.5 hover:text-primary">
              <span className="font-medium">{docNumber(settings, 'purchase_order', po.number)}</span><span className="flex-1">{po.supplier_name}</span><Badge map={PO_STATUS} s={po.status} /><span className="tabular-nums">{money(po.total)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function PurchaseOrders() {
  const nav = useNavigate();
  const settings = useSettings();
  const [status, setStatus] = useState('abertos');
  const [list, setList] = useState(null);
  const [modal, setModal] = useState(false);
  useEffect(() => { setList(null); api.get(`/procurement/orders${qs({ status })}`).then(setList).catch(() => setList([])); }, [status]);
  const t = useTable(list, { sort: 'number', dir: 'desc' });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <select className="input w-48" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Situação">
          <option value="abertos">Em aberto</option><option value="">Todos</option>{Object.entries(PO_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <button className="btn-primary" onClick={() => setModal(true)}><Plus className="h-4 w-4" /> Novo pedido</button>
      </div>
      <div className="card overflow-hidden">
        {!list ? <Loading /> : !list.length ? <Empty icon={Truck} title="Nenhum pedido" /> : (
          <>
            <div className="overflow-x-auto">
              <table className="table-clean">
                <thead><tr><SortTh t={t} k="number">Nº</SortTh><SortTh t={t} k="supplier_name">Fornecedor</SortTh><SortTh t={t} k="expected_date" className="hidden md:table-cell">Previsão</SortTh><SortTh t={t} k="status">Situação</SortTh><SortTh t={t} k="total" className="text-right">Total</SortTh></tr></thead>
                <tbody>
                  {t.rows.map((x) => (
                    <tr key={x.id} className="cursor-pointer" onClick={() => nav(`/compras/pedidos/${x.id}`)}>
                      <td className="font-medium tabular-nums">{docNumber(settings, 'purchase_order', x.number)}</td>
                      <td>{x.supplier_name}<div className="text-xs text-ink-faint">{x.items_count} item(ns)</div></td>
                      <td className={cx('hidden whitespace-nowrap md:table-cell', x.expected_date && x.expected_date < format(new Date(), 'yyyy-MM-dd') && ['enviado', 'parcial'].includes(x.status) && 'text-red-600')}>{fmt(x.expected_date)}</td>
                      <td><Badge map={PO_STATUS} s={x.status} /></td>
                      <td className="text-right tabular-nums">{money(x.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager t={t} />
          </>
        )}
      </div>
      {modal && <NewPO onClose={() => setModal(false)} onDone={(po) => nav(`/compras/pedidos/${po.id}`)} />}
    </div>
  );
}

function NewPO({ onClose, onDone }) {
  const suppliers = useSuppliers();
  const [run, busy] = useAction();
  const [products, setProducts] = useState([]);
  useEffect(() => { api.get('/products').then(setProducts).catch(() => {}); }, []);
  const [f, setF] = useState({ supplier_id: '', expected_date: '', items: [] });
  const setIt = (k, patch) => setF({ ...f, items: f.items.map((x, i) => (i === k ? { ...x, ...patch } : x)) });
  const total = f.items.reduce((a, i) => a + num(i.qty) * (Number(i.unit_cost) || 0), 0);
  const go = async () => {
    const r = await run(() => api.post('/procurement/orders', { ...f, expected_date: f.expected_date || null, items: f.items.map((i) => ({ ...i, qty: num(i.qty), unit_cost: Number(i.unit_cost) || 0 })) }), 'Pedido criado');
    if (r !== FAIL) onDone(r);
  };
  return (
    <Modal open onClose={onClose} size="lg" title="Novo pedido de compra"
      footer={<><span className="mr-auto text-sm">Total: <b className="tabular-nums">{money(total)}</b></span><button className="btn-ghost" onClick={onClose}>Voltar</button><button className="btn-primary" disabled={busy || !f.supplier_id || !f.items.length} onClick={go}>Criar pedido</button></>}>
      <div className="space-y-4 text-sm">
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Fornecedor" value={f.supplier_id} onChange={(e) => setF({ ...f, supplier_id: e.target.value })}><option value="">Selecione…</option>{suppliers.map((sp) => <option key={sp.id} value={sp.id}>{sp.name}</option>)}</Select>
          <Input label="Previsão de entrega" type="date" value={f.expected_date} onChange={(e) => setF({ ...f, expected_date: e.target.value })} />
        </div>
        {f.items.map((i, k) => (
          <div key={k} className="flex flex-wrap items-center gap-2">
            <input className="input h-9 min-w-[180px] flex-1" value={i.description} onChange={(e) => setIt(k, { description: e.target.value })} placeholder="Descrição" />
            <input className="input h-9 w-20 text-right" inputMode="decimal" value={String(i.qty)} onChange={(e) => setIt(k, { qty: e.target.value })} aria-label="Quantidade" />
            <MoneyInput value={i.unit_cost} onChange={(v) => setIt(k, { unit_cost: v })} className="w-32 [&_input]:h-9" />
            <button type="button" className="btn-ghost btn-icon h-9 text-red-600" aria-label="Remover" onClick={() => setF({ ...f, items: f.items.filter((_, x) => x !== k) })}><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
        <select className="input h-9" value="" onChange={(e) => { const p = products.find((x) => x.id === e.target.value); if (p) setF({ ...f, items: [...f.items, { product_id: p.id, description: p.name, unit: p.unit, qty: 1, unit_cost: Number(p.cost) || 0 }] }); }} aria-label="Adicionar material">
          <option value="">+ Adicionar material do cadastro…</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
    </Modal>
  );
}

export function PurchaseOrderDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const settings = useSettings();
  const { confirm } = useUI();
  const [run, busy] = useAction();
  const [po, setPo] = useState(null);
  const [modal, setModal] = useState(null);
  const [reason, setReason] = useState('');
  const load = useCallback(() => api.get(`/procurement/orders/${id}`).then(setPo).catch(() => nav('/compras?aba=pedidos')), [id]); // eslint-disable-line
  useEffect(() => { load(); }, [load]);
  if (!po) return <Loading />;
  const open = ['rascunho', 'enviado', 'parcial'].includes(po.status);
  const send = async (via) => { const r = await run(() => api.post(`/procurement/orders/${po.id}/send`, { via }), 'Envio registrado'); if (r !== FAIL) { setPo(r); setModal(null); } };
  const cancel = async () => {
    if (!(await confirm({ title: 'Cancelar pedido?', confirmText: 'Cancelar pedido' }))) return;
    const r = await run(() => api.post(`/procurement/orders/${po.id}/cancel`, { reason }), 'Pedido cancelado');
    if (r !== FAIL) { setPo(r); setModal(null); }
  };
  return (
    <div className="pb-2">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><h1 className="text-xl font-semibold sm:text-2xl">Pedido {docNumber(settings, 'purchase_order', po.number)}</h1><Badge map={PO_STATUS} s={po.status} /></div>
          <p className="mt-0.5 text-sm text-ink-faint">{po.supplier_name}{po.quotation_number && ` · cotação ${docNumber(settings, 'quotation', po.quotation_number)}`}{po.expected_date && ` · previsão ${fmt(po.expected_date)}`}{po.sent_at && ` · enviado ${fmt(po.sent_at)} (${po.sent_via})`}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {po.status === 'rascunho' && <button className="btn-outline" onClick={() => setModal('send')}><Send className="h-4 w-4" /> Registrar envio</button>}
          {open && po.status !== 'rascunho' && <button className="btn-primary" onClick={() => setModal('receive')}><PackageCheck className="h-4 w-4" /> Receber</button>}
          {['rascunho', 'enviado'].includes(po.status) && <button className="btn-ghost text-red-600" onClick={() => setModal('cancel')}><XCircle className="h-4 w-4" /> Cancelar</button>}
        </div>
      </div>
      {po.cancel_reason && <div className="mb-4 rounded-app-sm bg-red-500/10 p-3 text-sm text-red-700">Cancelado: {po.cancel_reason}</div>}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="card overflow-hidden lg:col-span-2">
          <table className="table-clean">
            <thead><tr><th>Item</th><th className="text-right">Pedido</th><th className="text-right">Recebido</th><th className="text-right">Unitário</th><th className="text-right">Total</th></tr></thead>
            <tbody>
              {po.items.map((i) => (
                <tr key={i.id}>
                  <td>{i.description}{i.order_number && <div className="text-xs text-ink-faint">para OS nº {i.order_number}</div>}</td>
                  <td className="text-right tabular-nums">{fqty(i.qty)} {i.unit}</td>
                  <td className={cx('text-right tabular-nums', Number(i.qty_received) >= Number(i.qty) ? 'text-emerald-700' : Number(i.qty_received) > 0 && 'text-amber-700')}>{fqty(i.qty_received)}</td>
                  <td className="text-right tabular-nums">{money(i.unit_cost)}</td>
                  <td className="text-right tabular-nums">{money(Number(i.qty) * Number(i.unit_cost))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-line px-4 py-3 text-right font-semibold">Total {money(po.total)}</div>
        </div>
        <div className="space-y-6">
          <section className="card p-5 text-sm">
            <h2 className="mb-2 font-semibold">Recebimentos</h2>
            {!po.receipts.length ? <p className="text-ink-faint">Nada recebido ainda.</p> : po.receipts.map((r) => (
              <Link key={r.id} to={`/estoque/entradas/${r.id}`} className="flex items-center gap-2 py-1 hover:text-primary">
                <span className="font-medium">{docNumber(settings, 'purchase', r.number)}</span><span className="flex-1 text-xs text-ink-faint">NF {r.invoice_number || '—'} · {fmt(r.received_at)}</span>
                <span className={cx('text-xs', r.status === 'cancelada' && 'text-red-600 line-through')}>{money(r.total)}</span>
              </Link>
            ))}
          </section>
          <Attachments entity="purchase_order" entityId={po.id} title="Documentos do pedido" />
        </div>
      </div>
      {modal === 'send' && (
        <Modal open onClose={() => setModal(null)} size="sm" title="Registrar envio ao fornecedor">
          <div className="space-y-2 text-sm">
            <p className="text-ink-soft">O TORVEN não envia o pedido sozinho: registre como você o enviou.</p>
            {[['email', 'E-mail'], ['whatsapp', 'WhatsApp'], ['telefone', 'Telefone'], ['portal', 'Portal do fornecedor'], ['presencial', 'Presencial']].map(([k, l]) => (
              <button key={k} className="btn-outline w-full justify-start" disabled={busy} onClick={() => send(k)}>{l}</button>
            ))}
          </div>
        </Modal>
      )}
      {modal === 'cancel' && (
        <Modal open onClose={() => setModal(null)} size="sm" title="Cancelar pedido"
          footer={<><button className="btn-ghost" onClick={() => setModal(null)}>Voltar</button><button className="btn-danger" disabled={busy || reason.trim().length < 3} onClick={cancel}>Cancelar pedido</button></>}>
          <Input label="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Modal>
      )}
      {modal === 'receive' && <ReceiveModal po={po} onClose={() => setModal(null)} onDone={(r) => { setPo(r); setModal(null); }} />}
    </div>
  );
}

function ReceiveModal({ po, onClose, onDone }) {
  const { confirm, toast } = useUI();
  const [run, busy] = useAction();
  const pending = po.items.filter((i) => Number(i.qty_received) < Number(i.qty));
  const [f, setF] = useState({ invoice_number: '', invoice_key: '', issue_date: format(new Date(), 'yyyy-MM-dd'), freight: 0, other: 0, discount: 0 });
  const [lines, setLines] = useState(pending.map((i) => ({ po_item_id: i.id, description: i.description, unit: i.unit, pending: Number(i.qty) - Number(i.qty_received), qty: String(Number(i.qty) - Number(i.qty_received)), unit_cost: Number(i.unit_cost), ordered_cost: Number(i.unit_cost), lot: '', certificate: '' })));
  const [pay, setPay] = useState({ n: 1, first: format(addDays(new Date(), 28), 'yyyy-MM-dd'), method: 'boleto' });
  const setL = (k, patch) => setLines(lines.map((x, i) => (i === k ? { ...x, ...patch } : x)));
  const subtotal = lines.reduce((a, l) => a + num(l.qty) * (Number(l.unit_cost) || 0), 0);
  const total = Math.round((subtotal + (Number(f.freight) || 0) + (Number(f.other) || 0) - (Number(f.discount) || 0)) * 100) / 100;
  const installments = useMemo(() => {
    const n = Math.max(0, Math.min(24, Number(pay.n) || 0));
    if (!n || total <= 0) return [];
    const each = Math.floor((total / n) * 100) / 100;
    return Array.from({ length: n }, (_, k) => ({ due_date: format(addDays(new Date(`${pay.first}T12:00:00`), k * 30), 'yyyy-MM-dd'), amount: k === n - 1 ? Math.round((total - each * (n - 1)) * 100) / 100 : each, method: pay.method }));
  }, [pay, total]);
  const over = lines.filter((l) => num(l.qty) > l.pending + 0.0005);
  const go = async () => {
    let allow = false;
    if (over.length) {
      allow = await confirm({ title: 'Recebido acima do pedido', danger: false, confirmText: 'Confirmar recebimento', message: over.map((l) => `${l.description}: ${l.qty} (pendente ${l.pending})`).join('; ') });
      if (!allow) return;
    }
    const r = await run(() => api.post(`/procurement/orders/${po.id}/receive`, {
      ...f, freight: Number(f.freight) || 0, other: Number(f.other) || 0, discount: Number(f.discount) || 0, allow_over: allow, installments,
      items: lines.map((l) => ({ po_item_id: l.po_item_id, qty: num(l.qty), unit_cost: Number(l.unit_cost) || 0, lot: l.lot || null, certificate: l.certificate || null })),
    }), 'Recebimento registrado');
    if (r !== FAIL) { if (r.divergences?.length) toast(`Divergências registradas: ${r.divergences.join('; ')}`, 'error'); onDone(r); }
  };
  return (
    <Modal open onClose={onClose} size="lg" title="Recebimento conferido" subtitle="Informe o que realmente chegou; o estoque, o custo médio e as contas a pagar são atualizados"
      footer={<><span className="mr-auto text-sm">Total da nota: <b className="tabular-nums">{money(total)}</b></span><button className="btn-ghost" onClick={onClose}>Voltar</button><button className="btn-primary" disabled={busy || !lines.some((l) => num(l.qty) > 0)} onClick={go}>Registrar entrada</button></>}>
      <div className="space-y-4 text-sm">
        <div className="grid gap-3 sm:grid-cols-3">
          <Input label="Nº da nota fiscal" value={f.invoice_number} onChange={(e) => setF({ ...f, invoice_number: e.target.value })} />
          <Input label="Emissão" type="date" value={f.issue_date} onChange={(e) => setF({ ...f, issue_date: e.target.value })} />
          <Input label="Chave de acesso" value={f.invoice_key} onChange={(e) => setF({ ...f, invoice_key: e.target.value })} />
        </div>
        <div className="divide-y divide-line rounded-app-sm border border-line">
          {lines.map((l, k) => (
            <div key={l.po_item_id} className="grid gap-2 p-3 sm:grid-cols-6">
              <div className="sm:col-span-6"><b>{l.description}</b> <span className="text-xs text-ink-faint">pendente {fqty(l.pending)} {l.unit}</span></div>
              <Input label="Recebido" inputMode="decimal" value={l.qty} onChange={(e) => setL(k, { qty: e.target.value })} />
              <div><span className="label">Custo unit.</span><MoneyInput value={l.unit_cost} onChange={(v) => setL(k, { unit_cost: v })} /></div>
              <Input label="Lote / corrida" value={l.lot} onChange={(e) => setL(k, { lot: e.target.value })} className="sm:col-span-2" />
              <Input label="Certificado" value={l.certificate} onChange={(e) => setL(k, { certificate: e.target.value })} className="sm:col-span-2" />
              {(num(l.qty) !== l.pending || Math.abs((Number(l.unit_cost) || 0) - l.ordered_cost) > 0.0001) && (
                <div className="flex items-center gap-1 text-xs text-amber-700 sm:col-span-6"><AlertTriangle className="h-3.5 w-3.5" />Divergência com o pedido será registrada.</div>
              )}
            </div>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div><span className="label">Frete</span><MoneyInput value={f.freight} onChange={(v) => setF({ ...f, freight: v })} /></div>
          <div><span className="label">Outras despesas</span><MoneyInput value={f.other} onChange={(v) => setF({ ...f, other: v })} /></div>
          <div><span className="label">Desconto</span><MoneyInput value={f.discount} onChange={(v) => setF({ ...f, discount: v })} /></div>
        </div>
        <div className="grid gap-3 rounded-app-sm bg-muted/50 p-3 sm:grid-cols-3">
          <Input label="Parcelas a pagar" type="number" min={0} max={24} value={pay.n} onChange={(e) => setPay({ ...pay, n: e.target.value })} hint="0 = sem conta a pagar" />
          <Input label="1º vencimento" type="date" value={pay.first} onChange={(e) => setPay({ ...pay, first: e.target.value })} />
          <Select label="Forma" value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}><option value="boleto">Boleto</option><option value="pix">PIX</option><option value="transferencia">Transferência</option><option value="dinheiro">Dinheiro</option></Select>
        </div>
      </div>
    </Modal>
  );
}

/** Separação física dos materiais lançados nas OS aprovadas. */
export function Picking() {
  const settings = useSettings();
  const { can } = useAuth();
  const [run] = useAction();
  const [list, setList] = useState(null);
  const load = useCallback(() => api.get('/procurement/picking').then(setList).catch(() => setList([])), []);
  useEffect(() => { load(); }, [load]);
  const groups = useMemo(() => Object.values((list || []).reduce((g, i) => { (g[i.order_id] ??= { ...i, items: [] }).items.push(i); return g; }, {})), [list]);
  const pick = async (i, qtyVal) => { if ((await run(() => api.post(`/procurement/picking/${i.id}`, { qty: qtyVal }), 'Separação registrada')) !== FAIL) load(); };
  return (
    <div>
      <PageHeader title="Separação de materiais" subtitle="Materiais das OS aprovadas e em execução a separar no estoque" />
      {!list ? <Loading /> : !groups.length ? <div className="card"><Empty icon={PackageOpen} title="Nada a separar" text="Tudo que foi lançado nas OS abertas já foi separado." /></div> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {groups.map((g) => (
            <div key={g.order_id} className="card p-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <Link to={`/os/${g.order_id}`} className="font-semibold text-primary">{docNumber(settings, 'order', g.order_number)}</Link>
                <span className="truncate text-xs text-ink-faint">{g.customer_name}{g.technician_name && ` · ${g.technician_name}`}{g.promised_at && ` · prazo ${fmt(g.promised_at, 'dd/MM')}`}</span>
              </div>
              <ul className="divide-y divide-line text-sm">
                {g.items.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center gap-2 py-2">
                    <div className="min-w-0 flex-1">
                      <div>{i.description}</div>
                      <div className="text-xs text-ink-faint">{i.location ? `Local: ${i.location} · ` : ''}separado {fqty(i.picked_qty)} de {fqty(i.qty)} {i.unit}{Number(i.stock) < 0 && <span className="text-red-600"> · estoque negativo</span>}</div>
                    </div>
                    {can('materials_manage', 'orders_edit') && <button className="btn-outline h-8 text-xs" onClick={() => pick(i, Number(i.qty))}><CheckCircle2 className="h-3.5 w-3.5" /> Separado</button>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
