import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Search, Trash2, Wrench, Package, PenLine, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api';
import { money, qty as fqty, ITEM_KIND } from '../lib/format';
import { useCatalog } from '../context/CatalogContext';
import { useAuth } from '../context/AuthContext';
import { MoneyInput, cx } from './ui';

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const itemTotal = (i) => round2((Number(i.qty) || 0) * (Number(i.unit_price) || 0) - (Number(i.discount) || 0));
export const itemsSubtotal = (items) => round2(items.reduce((a, i) => a + itemTotal(i), 0));

/** Limpa os itens para envio à API. */
export const cleanItems = (items) => items.map((i) => ({
  kind: i.kind, service_id: i.service_id || null, product_id: i.product_id || null, technician_id: i.technician_id || null,
  description: i.description, unit: i.unit || null, qty: Number(i.qty) || 0, unit_price: Number(i.unit_price) || 0,
  discount: Number(i.discount) || 0,
}));

/**
 * Editor de itens (serviços, materiais e avulsos) com busca no catálogo.
 * hideValues: perfil sem acesso a valores (preço vem do catálogo no servidor).
 */
export default function ItemsEditor({ items, onChange, discount = 0, onDiscount, showTechnician, hideValues, readOnly, allowDiscount = true }) {
  const { services, technicians } = useCatalog();
  const { can } = useAuth();
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('servico');
  const ref = useRef(null);
  useEffect(() => { api.get('/products').then(setProducts).catch(() => {}); }, []);
  useEffect(() => {
    const h = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const set = (idx, patch) => onChange(items.map((x, i) => (i === idx ? { ...x, ...patch } : x)));
  const remove = (idx) => onChange(items.filter((_, i) => i !== idx));
  const add = (item) => { onChange([...items, { qty: 1, discount: 0, ...item }]); setSearch(''); setOpen(false); };

  const t = search.trim().toLowerCase();
  const found = useMemo(() => {
    if (tab === 'servico') return services.filter((s) => !t || `${s.name} ${s.category}`.toLowerCase().includes(t)).slice(0, 40);
    return products.filter((p) => !t || `${p.name} ${p.sku || ''} ${p.category || ''}`.toLowerCase().includes(t)).slice(0, 40);
  }, [tab, t, services, products]);
  const prodById = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p])), [products]);

  const subtotal = itemsSubtotal(items);
  const total = round2(subtotal - (Number(discount) || 0));

  return (
    <div className="space-y-3">
      {!readOnly && (
        <div ref={ref} className="relative">
          <div className="flex flex-wrap gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
              <input className="input pl-9" placeholder="Adicionar serviço ou material…" value={search}
                onFocus={() => setOpen(true)} onChange={(e) => { setSearch(e.target.value); setOpen(true); }} />
            </div>
            {!hideValues && (
              <button type="button" className="btn-outline" onClick={() => add({ kind: 'avulso', description: '', unit: 'un', unit_price: 0 })}>
                <PenLine className="h-4 w-4" /> Item avulso
              </button>
            )}
          </div>
          {open && (
            <div className="card animate-pop absolute z-40 mt-1 w-full max-w-2xl p-1.5">
              <div className="mb-1 flex gap-1 p-1">
                {[['servico', 'Serviços', Wrench], ['material', 'Materiais', Package]].map(([k, l, I]) => (
                  <button key={k} type="button" onClick={() => setTab(k)}
                    className={cx('flex items-center gap-1.5 rounded-app-sm px-3 py-1.5 text-xs font-medium', tab === k ? 'bg-primary/10 text-primary' : 'text-ink-soft hover:bg-muted')}>
                    <I className="h-3.5 w-3.5" />{l}
                  </button>
                ))}
              </div>
              <div className="max-h-72 overflow-y-auto">
                {found.map((x) => (
                  <button key={x.id} type="button" className="flex w-full items-center gap-3 rounded-app-sm px-3 py-2 text-left text-sm hover:bg-muted"
                    onClick={() => add(tab === 'servico'
                      ? { kind: 'servico', service_id: x.id, description: x.name, unit: x.unit, unit_price: x.price, technician_id: null }
                      : { kind: 'material', product_id: x.id, description: x.name, unit: x.unit, unit_price: x.price })}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{x.name}</span>
                      <span className="block truncate text-xs text-ink-faint">
                        {x.category}{tab === 'material' && <> · estoque <b className={cx(x.stock <= 0 && 'text-red-600', x.stock > 0 && x.stock <= x.min_stock && 'text-amber-600')}>{fqty(x.stock)} {x.unit}</b></>}
                      </span>
                    </span>
                    {!hideValues && <span className="tabular-nums text-ink-soft">{money(x.price)}<span className="text-xs text-ink-faint">/{x.unit}</span></span>}
                  </button>
                ))}
                {!found.length && <div className="px-3 py-3 text-sm text-ink-faint">Nada encontrado.</div>}
              </div>
            </div>
          )}
        </div>
      )}

      {items.length === 0 ? (
        <div className="rounded-app-sm border border-dashed border-line px-4 py-6 text-center text-sm text-ink-faint">Nenhum item lançado.</div>
      ) : (
        <div className="overflow-x-auto rounded-app-sm border border-line">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-ink-faint">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Item</th>
                <th className="w-24 px-2 py-2 text-right font-medium">Qtd.</th>
                {!hideValues && <th className="w-32 px-2 py-2 text-right font-medium">Unitário</th>}
                {!hideValues && allowDiscount && <th className="hidden w-28 px-2 py-2 text-right font-medium md:table-cell">Desc.</th>}
                {!hideValues && <th className="w-28 px-3 py-2 text-right font-medium">Total</th>}
                {!readOnly && <th className="w-10" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {items.map((i, idx) => {
                const p = i.product_id && prodById[i.product_id];
                const short = p && i.kind === 'material' && Number(i.qty) > Number(p.stock) + (i._savedQty || 0);
                return (
                  <tr key={idx} className="align-top">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className={cx('chip shrink-0', i.kind === 'servico' ? 'bg-primary/10 text-primary' : i.kind === 'material' ? 'bg-sky-500/10 text-sky-700 dark:text-sky-300' : 'bg-muted text-ink-soft')}>
                          {ITEM_KIND[i.kind]}
                        </span>
                        {readOnly ? <span>{i.description}</span> : (
                          <input className="input h-8 min-w-[180px]" value={i.description} onChange={(e) => set(idx, { description: e.target.value })} placeholder="Descrição" />
                        )}
                      </div>
                      {showTechnician && i.kind === 'servico' && (
                        readOnly ? (i.technician_name && <div className="mt-1 text-xs text-ink-faint">Técnico: {i.technician_name}</div>) : (
                          <select className="input mt-1.5 h-7 w-auto text-xs" value={i.technician_id || ''} onChange={(e) => set(idx, { technician_id: e.target.value || null })}>
                            <option value="">Técnico da OS</option>
                            {technicians.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                          </select>
                        )
                      )}
                      {short && <div className="mt-1 flex items-center gap-1 text-xs text-amber-600"><AlertTriangle className="h-3 w-3" /> Estoque atual: {fqty(p.stock)} {p.unit}</div>}
                    </td>
                    <td className="px-2 py-2 text-right">
                      {readOnly ? <span className="tabular-nums">{fqty(i.qty)} <span className="text-xs text-ink-faint">{i.unit}</span></span> : (
                        <div className="flex items-center justify-end gap-1">
                          <input className="input h-8 w-20 text-right tabular-nums" inputMode="decimal" value={String(i.qty).replace('.', ',')}
                            onChange={(e) => { const v = e.target.value.replace(/[^\d,.]/g, '').replace(',', '.'); set(idx, { qty: v }); }} />
                          <span className="w-6 text-left text-xs text-ink-faint">{i.unit}</span>
                        </div>
                      )}
                    </td>
                    {!hideValues && (
                      <td className="px-2 py-2 text-right">
                        {readOnly ? <span className="tabular-nums">{money(i.unit_price)}</span>
                          : <MoneyInput value={i.unit_price} onChange={(v) => set(idx, { unit_price: v })} className="[&_input]:h-8 [&_input]:text-right" />}
                      </td>
                    )}
                    {!hideValues && allowDiscount && (
                      <td className="hidden px-2 py-2 text-right md:table-cell">
                        {readOnly ? <span className="tabular-nums text-ink-faint">{Number(i.discount) ? money(i.discount) : '—'}</span>
                          : <MoneyInput value={i.discount} onChange={(v) => set(idx, { discount: v })} disabled={!can('discount')} className="[&_input]:h-8 [&_input]:text-right" />}
                      </td>
                    )}
                    {!hideValues && <td className="px-3 py-2 text-right font-medium tabular-nums">{money(itemTotal(i))}</td>}
                    {!readOnly && (
                      <td className="py-2 pr-2 text-right">
                        <button type="button" className="btn-ghost btn-icon h-8 text-red-600" onClick={() => remove(idx)}><Trash2 className="h-4 w-4" /></button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!hideValues && items.length > 0 && (
        <div className="ml-auto w-full max-w-xs space-y-1.5 text-sm">
          <div className="flex justify-between text-ink-soft"><span>Subtotal</span><span className="tabular-nums">{money(subtotal)}</span></div>
          {onDiscount && !readOnly && allowDiscount ? (
            <div className="flex items-center justify-between gap-3 text-ink-soft">
              <span>Desconto geral</span>
              <MoneyInput value={discount} onChange={onDiscount} disabled={!can('discount')} className="w-32 [&_input]:h-8 [&_input]:text-right" />
            </div>
          ) : Number(discount) > 0 && (
            <div className="flex justify-between text-ink-soft"><span>Desconto</span><span className="tabular-nums">− {money(discount)}</span></div>
          )}
          <div className="flex justify-between border-t border-line pt-1.5 text-base font-semibold"><span>Total</span><span className="tabular-nums">{money(total)}</span></div>
        </div>
      )}
    </div>
  );
}
