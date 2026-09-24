import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Search, Package, Pencil, ArrowDownUp, History, Trash2, Download, AlertTriangle } from 'lucide-react';
import { api, qs } from '../lib/api';
import { money, qty, fmtDateTime, downloadCSV } from '../lib/format';
import { useAuth, useSettings } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import { PageHeader, Input, Select, MoneyInput, Modal, Loading, Empty, Stat, useAction, FAIL, cx } from '../components/ui';

export default function Materials() {
  const [params] = useSearchParams();
  const settings = useSettings();
  const { can } = useAuth();
  const { confirm } = useUI();
  const [run] = useAction();
  const [f, setF] = useState({ search: '', category: '', low: params.get('low') || '' });
  const [list, setList] = useState(null);
  const [edit, setEdit] = useState(null);
  const [adjust, setAdjust] = useState(null);
  const [hist, setHist] = useState(null);
  const load = useCallback(() => api.get(`/products${qs(f)}`).then(setList), [f]);
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);
  const manage = can('materials_manage');
  const value = (list || []).reduce((a, p) => a + Math.max(0, Number(p.stock_value) || 0), 0);
  const low = (list || []).filter((p) => p.min_stock > 0 && p.stock <= p.min_stock).length;

  const remove = async (p) => {
    if (!(await confirm({ title: `Desativar ${p.name}?`, confirmText: 'Desativar' }))) return;
    if ((await run(() => api.del(`/products/${p.id}`), 'Material desativado')) !== FAIL) load();
  };

  return (
    <div>
      <PageHeader title="Materiais e estoque" subtitle="Eletrodos, varetas, gases, chapas, perfis e peças de reposição"
        actions={<>
          <button className="btn-outline" disabled={!list?.length} onClick={() => downloadCSV('estoque.csv', list.map((p) => ({
            Material: p.name, Codigo: p.sku, Categoria: p.category, Unidade: p.unit, Estoque: p.stock, Minimo: p.min_stock, Custo: p.cost, Preco: p.price, NCM: p.ncm, Local: p.location,
          })))}><Download className="h-4 w-4" /> Exportar</button>
          {manage && <button className="btn-primary" onClick={() => setEdit({ unit: 'un', origin: 0, category: settings.materialCategories?.[0] })}><Plus className="h-4 w-4" /> Novo material</button>}
        </>} />
      {list && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Itens cadastrados" value={list.length} icon={Package} />
          {'stock_value' in (list[0] || {}) && <Stat label="Valor em estoque (custo)" value={money(value)} />}
          <button className="text-left" onClick={() => setF({ ...f, low: f.low ? '' : '1' })}><Stat label="Abaixo do mínimo" value={low} icon={AlertTriangle} tone={low ? 'text-amber-500' : undefined} hint={f.low ? 'mostrando só estes' : 'clique para filtrar'} /></button>
        </div>
      )}
      <div className="card mb-4 flex flex-wrap items-end gap-3 p-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <input className="input pl-9" placeholder="Nome, código ou código de barras…" value={f.search} onChange={(e) => setF({ ...f, search: e.target.value })} />
        </div>
        <select className="input w-52" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
          <option value="">Todas as categorias</option>{settings.materialCategories?.map((c) => <option key={c}>{c}</option>)}
        </select>
        <label className="flex h-[var(--row)] items-center gap-2 text-sm"><input type="checkbox" checked={!!f.low} onChange={(e) => setF({ ...f, low: e.target.checked ? '1' : '' })} /> Só abaixo do mínimo</label>
      </div>
      <div className="card overflow-hidden">
        {!list ? <Loading /> : !list.length ? <Empty icon={Package} title="Nenhum material" /> : (
          <div className="overflow-x-auto">
            <table className="table-clean">
              <thead><tr><th>Material</th><th className="text-right">Estoque</th><th className="hidden text-right md:table-cell">Mínimo</th>{'cost' in list[0] && <th className="hidden text-right lg:table-cell">Custo médio</th>}<th className="text-right">Preço venda</th><th /></tr></thead>
              <tbody>
                {list.map((p) => {
                  const lowS = p.min_stock > 0 && p.stock <= p.min_stock;
                  return (
                    <tr key={p.id}>
                      <td><div className="max-w-[320px] truncate font-medium">{p.name}</div><div className="text-xs text-ink-faint">{[p.category, p.sku, p.location && `local ${p.location}`].filter(Boolean).join(' · ')}</div></td>
                      <td className={cx('whitespace-nowrap text-right font-medium tabular-nums', p.stock < 0 ? 'text-red-600' : lowS && 'text-amber-600')}>{qty(p.stock)} <span className="text-xs font-normal text-ink-faint">{p.unit}</span></td>
                      <td className="hidden text-right tabular-nums text-ink-soft md:table-cell">{qty(p.min_stock)}</td>
                      {'cost' in p && <td className="hidden text-right tabular-nums text-ink-soft lg:table-cell">{money(p.cost)}</td>}
                      <td className="text-right tabular-nums">{money(p.price)}</td>
                      <td className="w-32 whitespace-nowrap text-right">
                        {manage && <button className="btn-ghost btn-icon h-8" title="Movimentar estoque" onClick={() => setAdjust(p)}><ArrowDownUp className="h-4 w-4" /></button>}
                        {(manage || can('purchases')) && <button className="btn-ghost btn-icon h-8" title="Histórico" onClick={() => setHist(p)}><History className="h-4 w-4" /></button>}
                        {manage && <button className="btn-ghost btn-icon h-8" title="Editar" onClick={() => setEdit(p)}><Pencil className="h-4 w-4" /></button>}
                        {manage && <button className="btn-ghost btn-icon h-8 text-red-600" title="Desativar" onClick={() => remove(p)}><Trash2 className="h-4 w-4" /></button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {edit && <ProductForm p={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
      {adjust && <AdjustModal p={adjust} onClose={() => setAdjust(null)} onSaved={() => { setAdjust(null); load(); }} />}
      {hist && <HistoryModal p={hist} onClose={() => setHist(null)} />}
    </div>
  );
}

function ProductForm({ p, onClose, onSaved }) {
  const settings = useSettings();
  const [run, busy] = useAction();
  const [suppliers, setSuppliers] = useState([]);
  const [f, setF] = useState({ ...p, stock: p.id ? undefined : 0 });
  useEffect(() => { api.get('/suppliers').then(setSuppliers).catch(() => {}); }, []);
  const set = (k) => (e) => setF({ ...f, [k]: e?.target ? e.target.value : e });
  const margin = f.cost > 0 ? Math.round(((f.price - f.cost) / f.cost) * 100) : null;
  const save = async () => {
    const body = {
      name: f.name, sku: f.sku || null, barcode: f.barcode || null, category: f.category || null, unit: f.unit || 'un', cost: Number(f.cost) || 0,
      price: Number(f.price) || 0, min_stock: Number(f.min_stock) || 0, location: f.location || null, ncm: f.ncm || null, cfop: f.cfop || null,
      origin: Number(f.origin) || 0, supplier_id: f.supplier_id || null, ...(p.id ? {} : { stock: Number(f.stock) || 0 }),
    };
    const r = await run(() => (p.id ? api.put(`/products/${p.id}`, body) : api.post('/products', body)), 'Material salvo');
    if (r !== FAIL) onSaved(r);
  };
  return (
    <Modal open onClose={onClose} size="lg" title={p.id ? 'Editar material' : 'Novo material'}
      footer={<><button className="btn-ghost" onClick={onClose}>Cancelar</button><button className="btn-primary" disabled={busy || !f.name} onClick={save}>Salvar</button></>}>
      <div className="grid gap-4 sm:grid-cols-6">
        <Input label="Nome" value={f.name} onChange={set('name')} className="sm:col-span-4" autoFocus />
        <Select label="Unidade" value={f.unit} onChange={set('unit')} className="sm:col-span-2">
          {['un', 'kg', 'm', 'm²', 'm³', 'br', 'pç', 'cx', 'rl', 'L', 'par', 'jg'].map((u) => <option key={u}>{u}</option>)}
        </Select>
        <Select label="Categoria" value={f.category || ''} onChange={set('category')} className="sm:col-span-3">
          <option value="">—</option>{settings.materialCategories?.map((c) => <option key={c}>{c}</option>)}
        </Select>
        <Select label="Fornecedor principal" value={f.supplier_id || ''} onChange={set('supplier_id')} className="sm:col-span-3">
          <option value="">—</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
        <MoneyInput label="Custo" value={f.cost ?? 0} onChange={set('cost')} className="sm:col-span-2" />
        <MoneyInput label="Preço de venda" value={f.price ?? 0} onChange={set('price')} className="sm:col-span-2" />
        <div className="flex items-end pb-2 text-sm text-ink-faint sm:col-span-2">{margin !== null && <>Markup: <b className="ml-1 text-ink">{margin}%</b></>}</div>
        {!p.id && <Input label="Estoque inicial" type="number" step="0.001" value={f.stock} onChange={set('stock')} className="sm:col-span-2" />}
        <Input label="Estoque mínimo" type="number" step="0.001" min={0} value={f.min_stock ?? 0} onChange={set('min_stock')} className="sm:col-span-2" />
        <Input label="Localização" value={f.location} onChange={set('location')} className="sm:col-span-2" placeholder="Prateleira A3" />
        <Input label="Código interno (SKU)" value={f.sku} onChange={set('sku')} className="sm:col-span-2" />
        <Input label="Código de barras" value={f.barcode} onChange={set('barcode')} className="sm:col-span-2" />
        <div className="border-t border-line pt-3 text-xs font-semibold uppercase tracking-wider text-ink-faint sm:col-span-6">Dados fiscais (NF-e)</div>
        <Input label="NCM" value={f.ncm} onChange={set('ncm')} className="sm:col-span-2" placeholder="8 dígitos" />
        <Input label="CFOP (opcional)" value={f.cfop} onChange={set('cfop')} className="sm:col-span-2" placeholder="usa o padrão" />
        <Select label="Origem" value={f.origin ?? 0} onChange={set('origin')} className="sm:col-span-2">
          <option value={0}>0 — Nacional</option><option value={1}>1 — Estrangeira (importação direta)</option><option value={2}>2 — Estrangeira (mercado interno)</option>
        </Select>
      </div>
    </Modal>
  );
}

function AdjustModal({ p, onClose, onSaved }) {
  const [run, busy] = useAction();
  const [f, setF] = useState({ type: 'entrada', qty: '', reason: '', unit_cost: p.cost });
  const save = async () => {
    const r = await run(() => api.post(`/products/${p.id}/adjust`, { ...f, qty: Number(String(f.qty).replace(',', '.')) }), 'Estoque atualizado');
    if (r !== FAIL) onSaved();
  };
  return (
    <Modal open onClose={onClose} size="sm" title="Movimentar estoque" subtitle={`${p.name} · atual ${qty(p.stock)} ${p.unit}`}
      footer={<><button className="btn-ghost" onClick={onClose}>Cancelar</button><button className="btn-primary" disabled={busy || f.qty === '' || f.reason.length < 2} onClick={save}>Confirmar</button></>}>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2">
          {[['entrada', 'Entrada'], ['saida', 'Saída'], ['inventario', 'Inventário']].map(([k, l]) => (
            <button key={k} onClick={() => setF({ ...f, type: k })} className={cx('btn border', f.type === k ? 'border-primary bg-primary/10 text-primary' : 'border-line')}>{l}</button>
          ))}
        </div>
        <Input label={f.type === 'inventario' ? 'Saldo contado' : 'Quantidade'} inputMode="decimal" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} autoFocus />
        {f.type === 'entrada' && <MoneyInput label="Custo unitário" value={f.unit_cost} onChange={(v) => setF({ ...f, unit_cost: v })} />}
        <Input label="Motivo" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })}
          placeholder={f.type === 'saida' ? 'Uso interno, perda, sucata…' : f.type === 'inventario' ? 'Contagem física' : 'Compra sem nota, devolução…'} />
        <p className="text-xs text-ink-faint">Compras com nota do fornecedor: use <b>Entrada de materiais</b> para gerar também as contas a pagar.</p>
      </div>
    </Modal>
  );
}

function HistoryModal({ p, onClose }) {
  const [list, setList] = useState(null);
  useEffect(() => { api.get(`/products/${p.id}/movements`).then(setList); }, [p.id]);
  return (
    <Modal open onClose={onClose} size="lg" title="Histórico de movimentações" subtitle={p.name}>
      {!list ? <Loading /> : !list.length ? <Empty title="Sem movimentações" /> : (
        <table className="table-clean">
          <thead><tr><th>Data</th><th>Motivo</th><th className="text-right">Qtd.</th><th className="text-right">Saldo</th></tr></thead>
          <tbody>
            {list.map((m) => (
              <tr key={m.id}>
                <td className="whitespace-nowrap text-ink-soft">{fmtDateTime(m.created_at)}</td>
                <td><div>{m.reason}</div><div className="text-xs text-ink-faint">{m.user_name}</div></td>
                <td className={cx('text-right tabular-nums font-medium', m.qty > 0 ? 'text-emerald-600' : 'text-red-600')}>{m.qty > 0 ? '+' : ''}{qty(m.qty)}</td>
                <td className="text-right tabular-nums">{qty(m.balance_after)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}
