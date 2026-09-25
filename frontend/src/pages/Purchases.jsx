import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { addDays, format } from 'date-fns';
import { Plus, PackagePlus, Search, Trash2, Save, PackageCheck, XCircle, CalendarClock } from 'lucide-react';
import { api, qs } from '../lib/api';
import { money, qty, fmt, fmtDateTime, methodName } from '../lib/format';
import { useSettings } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import { PageHeader, Input, Select, MoneyInput, Textarea, Toggle, Loading, Empty, useAction, FAIL, cx } from '../components/ui';

const STATUS = {
  rascunho: 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-300',
  recebida: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  cancelada: 'bg-red-500/10 text-red-700 dark:text-red-300',
};
const LABEL = { rascunho: 'Rascunho', recebida: 'Recebida', cancelada: 'Cancelada' };
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export default function Purchases() {
  const nav = useNavigate();
  const [status, setStatus] = useState('');
  const [list, setList] = useState(null);
  useEffect(() => { api.get(`/purchases${qs({ status })}`).then(setList); }, [status]);
  return (
    <div>
      <PageHeader title="Entrada de materiais" subtitle="Notas de fornecedor: atualizam estoque, custo médio e contas a pagar"
        actions={<Link to="/estoque/entradas/nova" className="btn-primary"><Plus className="h-4 w-4" /> Nova entrada</Link>} />
      <div className="card mb-4 flex gap-3 p-3">
        <select className="input w-48" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Todas</option>{Object.entries(LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <div className="card overflow-hidden">
        {!list ? <Loading /> : !list.length ? <Empty icon={PackagePlus} title="Nenhuma entrada registrada" /> : (
          <div className="overflow-x-auto">
            <table className="table-clean">
              <thead><tr><th>Nº</th><th>Fornecedor</th><th className="hidden md:table-cell">NF</th><th className="hidden md:table-cell">Data</th><th>Situação</th><th className="text-right">Total</th></tr></thead>
              <tbody>
                {list.map((p) => (
                  <tr key={p.id} className="cursor-pointer" onClick={() => nav(`/estoque/entradas/${p.id}`)}>
                    <td className="font-medium tabular-nums">#{p.number}</td>
                    <td><div>{p.supplier_name || '—'}</div><div className="text-xs text-ink-faint">{p.items_count} item(ns)</div></td>
                    <td className="hidden text-ink-soft md:table-cell">{p.invoice_number || '—'}</td>
                    <td className="hidden text-ink-soft md:table-cell">{fmt(p.received_at || p.created_at, 'dd/MM/yy')}</td>
                    <td><span className={cx('chip', STATUS[p.status])}>{LABEL[p.status]}</span></td>
                    <td className="text-right font-medium tabular-nums">{money(p.total)}</td>
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

export function PurchaseEditor() {
  const { id } = useParams();
  const nav = useNavigate();
  const settings = useSettings();
  const { confirm } = useUI();
  const [run, busy] = useAction();
  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);
  const [p, setP] = useState(null);
  const [f, setF] = useState(id ? null : {
    supplier_id: '', invoice_number: '', invoice_series: '', invoice_key: '', issue_date: format(new Date(), 'yyyy-MM-dd'),
    items: [], freight: 0, other: 0, discount: 0, notes: '',
  });
  const [inst, setInst] = useState({ n: 1, first: format(addDays(new Date(), 28), 'yyyy-MM-dd'), every: 30, method: 'boleto', firstPaid: false });
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    api.get('/suppliers').then(setSuppliers).catch(() => {});
    api.get('/products').then(setProducts).catch(() => {});
    if (id) api.get(`/purchases/${id}`).then((r) => { setP(r); setF({ ...r, supplier_id: r.supplier_id || '', items: r.items.map((i) => ({ ...i, qty: Number(i.qty), unit_cost: Number(i.unit_cost) })) }); });
  }, [id]);
  useEffect(() => {
    const h = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const subtotal = f ? round2(f.items.reduce((a, i) => a + (Number(i.qty) || 0) * (Number(i.unit_cost) || 0), 0)) : 0;
  const total = f ? round2(subtotal + Number(f.freight || 0) + Number(f.other || 0) - Number(f.discount || 0)) : 0;
  const installments = useMemo(() => {
    const n = Math.max(1, Math.min(24, Number(inst.n) || 1));
    const each = Math.floor((total / n) * 100) / 100;
    return Array.from({ length: n }, (_, k) => ({
      due_date: k === 0 && inst.firstPaid ? format(new Date(), 'yyyy-MM-dd') : format(addDays(new Date(`${inst.first}T12:00`), (k - (inst.firstPaid ? 1 : 0)) * (Number(inst.every) || 30)), 'yyyy-MM-dd'),
      amount: k === n - 1 ? round2(total - each * (n - 1)) : each, method: inst.method, paid: k === 0 && inst.firstPaid,
    }));
  }, [inst, total]);

  if (!f) return <Loading />;
  const readOnly = p && p.status !== 'rascunho';
  const setI = (k, patch) => setF({ ...f, items: f.items.map((x, i) => (i === k ? { ...x, ...patch } : x)) });
  const found = products.filter((x) => !search || x.name.toLowerCase().includes(search.toLowerCase())).slice(0, 30);

  const save = async (receive) => {
    const body = {
      supplier_id: f.supplier_id || null, invoice_number: f.invoice_number || null, invoice_series: f.invoice_series || null,
      invoice_key: f.invoice_key || null, issue_date: f.issue_date || null, notes: f.notes || null,
      freight: Number(f.freight) || 0, other: Number(f.other) || 0, discount: Number(f.discount) || 0,
      items: f.items.map((i) => ({ product_id: i.product_id || null, description: i.description, unit: i.unit, category: i.category || null,
        qty: Number(String(i.qty).replace(',', '.')), unit_cost: Number(i.unit_cost) || 0, ...(i.sale_price ? { sale_price: Number(i.sale_price) } : {}) })),
      receive, installments: receive && total > 0 ? installments : [],
    };
    const r = await run(() => (p ? api.put(`/purchases/${p.id}`, body) : api.post('/purchases', body)), receive ? 'Entrada registrada — estoque atualizado' : 'Rascunho salvo');
    if (r !== FAIL) { if (!p) nav(`/estoque/entradas/${r.id}`, { replace: true }); setP(r); setF({ ...r, supplier_id: r.supplier_id || '', items: r.items.map((i) => ({ ...i, qty: Number(i.qty), unit_cost: Number(i.unit_cost) })) }); }
  };
  const cancel = async () => {
    if (!(await confirm({ title: `Cancelar entrada nº ${p.number}?`, message: p.status === 'recebida' ? 'O estoque será estornado e as parcelas em aberto excluídas.' : undefined, confirmText: 'Cancelar entrada' }))) return;
    const r = await run(() => api.post(`/purchases/${p.id}/cancel`), 'Entrada cancelada');
    if (r !== FAIL) setP(r);
  };

  return (
    <div className="pb-2">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{p ? `Entrada nº ${p.number}` : 'Nova entrada de materiais'}</h1>
            {p && <span className={cx('chip', STATUS[p.status])}>{LABEL[p.status]}</span>}
          </div>
          {p?.received_at && <p className="text-sm text-ink-faint">Recebida em {fmtDateTime(p.received_at)}</p>}
        </div>
        {p && p.status !== 'cancelada' && <button className="btn-ghost text-red-600" onClick={cancel}><XCircle className="h-4 w-4" /> Cancelar entrada</button>}
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="card grid gap-4 p-5 sm:grid-cols-6">
            <Select label="Fornecedor" value={f.supplier_id} onChange={(e) => setF({ ...f, supplier_id: e.target.value })} className="sm:col-span-3" disabled={readOnly}>
              <option value="">—</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
            <Input label="Nº da NF" value={f.invoice_number} onChange={(e) => setF({ ...f, invoice_number: e.target.value })} className="sm:col-span-2" disabled={readOnly} />
            <Input label="Série" value={f.invoice_series} onChange={(e) => setF({ ...f, invoice_series: e.target.value })} className="sm:col-span-1" disabled={readOnly} />
            <Input label="Emissão" type="date" value={f.issue_date || ''} onChange={(e) => setF({ ...f, issue_date: e.target.value })} className="sm:col-span-2" disabled={readOnly} />
            <Input label="Chave de acesso (44 dígitos)" value={f.invoice_key} onChange={(e) => setF({ ...f, invoice_key: e.target.value.replace(/\D/g, '').slice(0, 44) })} className="sm:col-span-4" disabled={readOnly} />
          </section>

          <section className="card space-y-3 p-5">
            <h2 className="font-semibold">Itens da nota</h2>
            {!readOnly && (
              <div ref={ref} className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
                <input className="input pl-9" placeholder="Buscar material cadastrado ou digitar um novo…" value={search}
                  onFocus={() => setOpen(true)} onChange={(e) => { setSearch(e.target.value); setOpen(true); }} />
                {open && (
                  <div className="card animate-pop absolute z-40 mt-1 max-h-72 w-full overflow-y-auto p-1">
                    {found.map((x) => (
                      <button key={x.id} className="flex w-full items-center justify-between gap-3 rounded-app-sm px-3 py-2 text-left text-sm hover:bg-muted"
                        onClick={() => { setF({ ...f, items: [...f.items, { product_id: x.id, description: x.name, unit: x.unit, qty: 1, unit_cost: Number(x.cost) || 0, _price: x.price }] }); setSearch(''); setOpen(false); }}>
                        <span className="truncate">{x.name}</span><span className="text-xs text-ink-faint">estoque {qty(x.stock)} {x.unit} · custo {money(x.cost)}</span>
                      </button>
                    ))}
                    {search && (
                      <button className="flex w-full items-center gap-2 rounded-app-sm px-3 py-2 text-sm font-medium text-primary hover:bg-muted"
                        onClick={() => { setF({ ...f, items: [...f.items, { product_id: null, description: search, unit: 'un', qty: 1, unit_cost: 0, category: settings.materialCategories?.[0] }] }); setSearch(''); setOpen(false); }}>
                        <Plus className="h-4 w-4" /> Cadastrar “{search}” como novo material
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
            {!f.items.length ? <div className="rounded-app-sm border border-dashed border-line px-4 py-6 text-center text-sm text-ink-faint">Adicione os itens da nota.</div> : (
              <div className="overflow-x-auto rounded-app-sm border border-line">
                <table className="table-stack w-full text-sm">
                  <thead className="bg-muted/50 text-xs text-ink-faint"><tr><th className="px-3 py-2 text-left font-medium">Material</th><th className="w-24 px-2 py-2 text-right font-medium">Qtd.</th><th className="w-32 px-2 py-2 text-right font-medium">Custo unit.</th><th className="hidden w-32 px-2 py-2 text-right font-medium md:table-cell">Novo preço venda</th><th className="w-28 px-3 py-2 text-right font-medium">Total</th>{!readOnly && <th className="w-10" />}</tr></thead>
                  <tbody className="divide-y divide-line">
                    {f.items.map((i, k) => (
                      <tr key={k}>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">{!i.product_id && <span className="chip bg-primary/10 text-primary">novo</span>}{i.description}</div>
                          {!i.product_id && !readOnly && (
                            <div className="mt-1 flex gap-2">
                              <select className="input h-7 w-auto text-xs" value={i.unit} onChange={(e) => setI(k, { unit: e.target.value })}>{['un', 'kg', 'm', 'm²', 'm³', 'br', 'pç', 'cx', 'rl', 'L'].map((u) => <option key={u}>{u}</option>)}</select>
                              <select className="input h-7 w-auto text-xs" value={i.category || ''} onChange={(e) => setI(k, { category: e.target.value })}>{settings.materialCategories?.map((c) => <option key={c}>{c}</option>)}</select>
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-2 text-right">{readOnly ? `${qty(i.qty)} ${i.unit || ''}` : <input className="input h-8 w-20 text-right" inputMode="decimal" value={String(i.qty).replace('.', ',')} onChange={(e) => setI(k, { qty: e.target.value.replace(/[^\d,.]/g, '').replace(',', '.') })} />}</td>
                        <td className="px-2 py-2 text-right">{readOnly ? money(i.unit_cost) : <MoneyInput value={i.unit_cost} onChange={(v) => setI(k, { unit_cost: v })} className="[&_input]:h-8 [&_input]:text-right" />}</td>
                        <td className="hidden px-2 py-2 text-right md:table-cell">{readOnly ? '—' : <MoneyInput value={i.sale_price ?? ''} placeholder={i._price ? String(i._price).replace('.', ',') : ''} onChange={(v) => setI(k, { sale_price: v || undefined })} className="[&_input]:h-8 [&_input]:text-right" />}</td>
                        <td className="px-3 py-2 text-right font-medium tabular-nums">{money((Number(i.qty) || 0) * (Number(i.unit_cost) || 0))}</td>
                        {!readOnly && <td className="pr-2"><button className="btn-ghost btn-icon h-8 text-red-600" onClick={() => setF({ ...f, items: f.items.filter((_, j) => j !== k) })}><Trash2 className="h-4 w-4" /></button></td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <Textarea label="Observações" rows={2} value={f.notes || ''} onChange={(e) => setF({ ...f, notes: e.target.value })} disabled={readOnly} />
          </section>
        </div>

        <div className="space-y-6">
          <section className="card space-y-3 p-5">
            <h2 className="font-semibold">Totais</h2>
            <div className="flex justify-between text-sm text-ink-soft"><span>Produtos</span><span className="tabular-nums">{money(subtotal)}</span></div>
            <MoneyInput label="Frete" value={f.freight} onChange={(v) => setF({ ...f, freight: v })} disabled={readOnly} />
            <MoneyInput label="Outras despesas (IPI, ST, seguro)" value={f.other} onChange={(v) => setF({ ...f, other: v })} disabled={readOnly} />
            <MoneyInput label="Desconto" value={f.discount} onChange={(v) => setF({ ...f, discount: v })} disabled={readOnly} />
            <div className="flex justify-between border-t border-line pt-2 text-lg font-semibold"><span>Total</span><span className="tabular-nums">{money(total)}</span></div>
            <p className="text-xs text-ink-faint">Frete, despesas e desconto são rateados no custo médio dos materiais.</p>
          </section>

          {readOnly ? (
            p.payables?.length > 0 && (
              <section className="card p-5">
                <h2 className="mb-2 font-semibold">Contas a pagar</h2>
                <ul className="space-y-1.5 text-sm">
                  {p.payables.map((t) => (
                    <li key={t.id} className="flex justify-between"><span className="text-ink-soft">{fmt(t.due_date)} · {methodName(settings, t.method)}</span>
                      <span className={cx('tabular-nums', t.paid_at ? 'text-emerald-600' : 'text-amber-600')}>{money(t.amount)} {t.paid_at ? '✓' : ''}</span></li>
                  ))}
                </ul>
                <Link to="/financeiro?tab=contas" className="mt-3 block text-xs text-primary">Abrir contas a pagar</Link>
              </section>
            )
          ) : (
            <section className="card space-y-3 p-5">
              <h2 className="font-semibold">Pagamento ao fornecedor</h2>
              <div className="grid grid-cols-2 gap-3">
                <Input label="Parcelas" type="number" min={1} max={24} value={inst.n} onChange={(e) => setInst({ ...inst, n: e.target.value })} />
                <Select label="Forma" value={inst.method} onChange={(e) => setInst({ ...inst, method: e.target.value })}>
                  {settings.paymentMethods?.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </Select>
                <Input label="1º vencimento" type="date" value={inst.first} onChange={(e) => setInst({ ...inst, first: e.target.value })} />
                <Input label="A cada (dias)" type="number" value={inst.every} onChange={(e) => setInst({ ...inst, every: e.target.value })} />
              </div>
              <Toggle checked={inst.firstPaid} onChange={(v) => setInst({ ...inst, firstPaid: v })} label="1ª parcela paga agora (à vista / entrada)" />
              <ul className="space-y-1 text-xs text-ink-soft">
                {installments.map((x, k) => <li key={k} className="flex justify-between"><span className="flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" />{fmt(x.due_date)}{x.paid && ' · paga'}</span><span className="tabular-nums">{money(x.amount)}</span></li>)}
              </ul>
            </section>
          )}
        </div>
      </div>

      {!readOnly && (
        <div className="action-bar">
          <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-end gap-3 px-4 py-3 sm:px-8">
            <button className="btn-ghost" onClick={() => nav('/estoque/entradas')}>Voltar</button>
            <button className="btn-outline" disabled={busy || !f.items.length} onClick={() => save(false)}><Save className="h-4 w-4" /> Salvar rascunho</button>
            <button className="btn-primary" disabled={busy || !f.items.length || total < 0} onClick={() => save(true)}><PackageCheck className="h-4 w-4" /> Dar entrada no estoque</button>
          </div>
        </div>
      )}
    </div>
  );
}
