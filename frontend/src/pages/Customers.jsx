import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Plus, Search, Users, Building2, User, Pencil, Trash2, ClipboardList, FileText, Wrench, Phone, Mail, MapPin, MessageCircle, Download } from 'lucide-react';
import { api, qs } from '../lib/api';
import { money, fmt, waLink, downloadCSV } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import { PageHeader, Input, Select, Textarea, Modal, Loading, Empty, Stat, useAction, FAIL, cx } from '../components/ui';
import { CustomerForm } from '../components/CustomerPicker';
import { OrdersTable } from './Orders';
import { QuoteBadge } from './Quotes';

export default function Customers() {
  const nav = useNavigate();
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [list, setList] = useState(null);
  const [edit, setEdit] = useState(null);
  const load = useCallback(() => api.get(`/customers${qs({ search })}`).then(setList), [search]);
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);

  return (
    <div>
      <PageHeader title="Clientes" subtitle="Pessoas e empresas atendidas, com equipamentos e histórico"
        actions={<>
          {can('customers_contact') && <button className="btn-outline" disabled={!list?.length} onClick={() => downloadCSV('clientes.csv', list.map((c) => ({
            Nome: c.name, Tipo: c.kind.toUpperCase(), Documento: c.document, Telefone: c.phone, Email: c.email, Cidade: c.city, UF: c.uf, OS: c.orders_count, Total: c.total_spent,
          })))}><Download className="h-4 w-4" /> Exportar</button>}
          {can('customers_edit') && <button className="btn-primary" onClick={() => setEdit({ kind: 'pf' })}><Plus className="h-4 w-4" /> Novo cliente</button>}
        </>} />
      <div className="card mb-4 p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <input className="input pl-9" placeholder="Nome, telefone, CPF/CNPJ ou e-mail…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>
      <div className="card overflow-hidden">
        {!list ? <Loading /> : !list.length ? <Empty icon={Users} title="Nenhum cliente encontrado" /> : (
          <div className="overflow-x-auto">
            <table className="table-clean">
              <thead><tr><th>Cliente</th><th className="hidden md:table-cell">Contato</th><th className="hidden lg:table-cell">Cidade</th><th className="text-center">OS</th><th className="hidden text-right sm:table-cell">Total gasto</th><th className="hidden md:table-cell">Última OS</th></tr></thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.id} className="cursor-pointer" onClick={() => nav(`/clientes/${c.id}`)}>
                    <td>
                      <div className="flex items-center gap-2">
                        {c.kind === 'pj' ? <Building2 className="h-4 w-4 shrink-0 text-ink-faint" /> : <User className="h-4 w-4 shrink-0 text-ink-faint" />}
                        <div className="min-w-0"><div className="max-w-[260px] truncate font-medium">{c.name}</div><div className="text-xs text-ink-faint">{c.document}</div></div>
                      </div>
                    </td>
                    <td className="hidden text-ink-soft md:table-cell">{c.phone || '—'}</td>
                    <td className="hidden text-ink-soft lg:table-cell">{c.city ? `${c.city}/${c.uf || ''}` : '—'}</td>
                    <td className="text-center tabular-nums">{c.orders_count}</td>
                    <td className="hidden text-right tabular-nums sm:table-cell">{money(c.total_spent)}</td>
                    <td className="hidden text-ink-soft md:table-cell">{c.last_order_at ? fmt(c.last_order_at, 'dd/MM/yy') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {edit && <CustomerForm customer={edit} onClose={() => setEdit(null)} onSaved={(c) => { setEdit(null); nav(`/clientes/${c.id}`); }} />}
    </div>
  );
}

export function CustomerDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can, company } = useAuth();
  const { confirm } = useUI();
  const [run] = useAction();
  const [c, setC] = useState(null);
  const [edit, setEdit] = useState(false);
  const [eq, setEq] = useState(null);
  const load = useCallback(() => api.get(`/customers/${id}`).then(setC), [id]);
  useEffect(() => { load(); }, [load]);
  if (!c) return <Loading />;

  const removeEq = async (e) => {
    if (!(await confirm({ title: `Remover ${e.description}?`, confirmText: 'Remover' }))) return;
    if ((await run(() => api.del(`/customers/equipment/${e.id}`), 'Equipamento removido')) !== FAIL) load();
  };
  const remove = async () => {
    if (!(await confirm({ title: `Desativar ${c.name}?`, message: 'O histórico é mantido.', confirmText: 'Desativar' }))) return;
    if ((await run(() => api.del(`/customers/${c.id}`), 'Cliente desativado')) !== FAIL) nav('/clientes');
  };
  const address = [c.street, c.number, c.complement, c.district, c.city && `${c.city}/${c.uf || ''}`, c.cep].filter(Boolean).join(', ');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-full bg-primary/10 text-primary">{c.kind === 'pj' ? <Building2 className="h-5 w-5" /> : <User className="h-5 w-5" />}</div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{c.name}</h1>
            <p className="text-sm text-ink-faint">{[c.trade_name, c.document, c.state_registration && `IE ${c.state_registration}`].filter(Boolean).join(' · ') || (c.kind === 'pj' ? 'Pessoa jurídica' : 'Pessoa física')}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {c.phone && <a className="btn-outline" href={waLink(c.phone, `Olá ${c.name.split(' ')[0]}! Aqui é da ${company.trade_name || company.name}.`)} target="_blank" rel="noreferrer"><MessageCircle className="h-4 w-4 text-emerald-600" /> WhatsApp</a>}
          {can('customers_edit') && <button className="btn-outline" onClick={() => setEdit(true)}><Pencil className="h-4 w-4" /> Editar</button>}
          {can('quotes') && <Link className="btn-outline" to={`/orcamentos/novo?cliente=${c.id}`}><FileText className="h-4 w-4" /> Orçamento</Link>}
          {can('orders_create') && <Link className="btn-primary" to={`/os/nova?cliente=${c.id}`}><Plus className="h-4 w-4" /> Nova OS</Link>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Ordens de serviço" value={c.orders.filter((o) => o.status !== 'cancelada').length} icon={ClipboardList} />
        {can('orders_values') && <Stat label="Total gasto" value={money(c.orders.filter((o) => o.status === 'entregue').reduce((a, o) => a + (o.total || 0), 0))} />}
        {can('orders_values') && <Stat label="A receber" value={money(c.finance.receivable)} hint={c.finance.overdue > 0 ? `${money(c.finance.overdue)} vencido` : 'nada vencido'} tone={c.finance.overdue > 0 ? 'text-red-500' : undefined} />}
        <Stat label="Equipamentos" value={c.equipment.length} icon={Wrench} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div>
            <h2 className="mb-3 font-semibold">Ordens de serviço e vendas</h2>
            <OrdersTable list={c.orders.map((o) => ({ ...o, customer_name: c.name, equipment_description: o.equipment, received_at: o.created_at }))} compact />
          </div>
          {c.quotes.length > 0 && (
            <div className="card">
              <h2 className="border-b border-line px-5 py-3.5 font-semibold">Orçamentos</h2>
              <div className="divide-y divide-line">
                {c.quotes.map((q) => (
                  <Link key={q.id} to={`/orcamentos/${q.id}`} className="flex items-center gap-3 px-5 py-2.5 text-sm hover:bg-muted/50">
                    <span className="w-12 font-medium tabular-nums">#{q.number}</span>
                    <span className="min-w-0 flex-1 truncate">{q.title}</span>
                    <QuoteBadge status={q.status} />
                    {q.total != null && <span className="w-24 text-right tabular-nums">{money(q.total)}</span>}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="space-y-6">
          <div className="card space-y-2 p-5 text-sm">
            <h2 className="mb-1 font-semibold">Contato</h2>
            {c.phone && <div className="flex items-center gap-2"><Phone className="h-4 w-4 text-ink-faint" />{c.phone}{c.phone2 && ` · ${c.phone2}`}</div>}
            {c.email && <div className="flex items-center gap-2"><Mail className="h-4 w-4 text-ink-faint" />{c.email}</div>}
            {address && <div className="flex items-start gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" />{address}</div>}
            {c.notes && <p className="rounded-app-sm bg-muted/60 p-3 text-ink-soft">{c.notes}</p>}
          </div>
          <div className="card">
            <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
              <h2 className="font-semibold">Equipamentos e peças</h2>
              {can('customers_edit') && <button className="btn-ghost h-8 text-xs text-primary" onClick={() => setEq({ category: company.settings.equipmentCategories?.[0] })}><Plus className="h-3.5 w-3.5" /> Adicionar</button>}
            </div>
            {!c.equipment.length ? <p className="px-5 py-4 text-sm text-ink-faint">Nenhum equipamento cadastrado.</p> : (
              <ul className="divide-y divide-line">
                {c.equipment.map((e) => (
                  <li key={e.id} className="group flex items-start gap-2 px-5 py-3 text-sm">
                    <Wrench className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{e.description}</div>
                      <div className="text-xs text-ink-faint">{[e.category, e.brand, e.model, e.serial && `nº ${e.serial}`].filter(Boolean).join(' · ')}</div>
                    </div>
                    {can('customers_edit') && <>
                      <button className="btn-ghost btn-icon h-7 opacity-0 group-hover:opacity-100" onClick={() => setEq(e)}><Pencil className="h-3.5 w-3.5" /></button>
                      <button className="btn-ghost btn-icon h-7 text-red-600 opacity-0 group-hover:opacity-100" onClick={() => removeEq(e)}><Trash2 className="h-3.5 w-3.5" /></button>
                    </>}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {can('customers_edit') && <button className="btn-ghost w-full text-red-600" onClick={remove}><Trash2 className="h-4 w-4" /> Desativar cliente</button>}
        </div>
      </div>
      {edit && <CustomerForm customer={c} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); load(); }} />}
      {eq && <EquipmentForm customerId={c.id} eq={eq} onClose={() => setEq(null)} onSaved={() => { setEq(null); load(); }} />}
    </div>
  );
}

function EquipmentForm({ customerId, eq, onClose, onSaved }) {
  const { company } = useAuth();
  const [run, busy] = useAction();
  const [f, setF] = useState(eq);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    const body = { category: f.category, description: f.description, brand: f.brand, model: f.model, serial: f.serial, year: f.year, notes: f.notes };
    const r = await run(() => (f.id ? api.put(`/customers/equipment/${f.id}`, body) : api.post(`/customers/${customerId}/equipment`, body)), 'Equipamento salvo');
    if (r !== FAIL) onSaved(r);
  };
  return (
    <Modal open onClose={onClose} title={f.id ? 'Editar equipamento' : 'Novo equipamento / peça'}
      footer={<><button className="btn-ghost" onClick={onClose}>Cancelar</button><button className="btn-primary" disabled={busy || !f.description} onClick={save}>Salvar</button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Select label="Tipo" value={f.category || ''} onChange={set('category')}>{company.settings.equipmentCategories?.map((c) => <option key={c}>{c}</option>)}</Select>
        <Input label="Descrição" value={f.description} onChange={set('description')} autoFocus />
        <Input label="Marca" value={f.brand} onChange={set('brand')} />
        <Input label="Modelo" value={f.model} onChange={set('model')} />
        <Input label="Nº de série / placa / patrimônio" value={f.serial} onChange={set('serial')} />
        <Input label="Ano" value={f.year} onChange={set('year')} />
        <Textarea label="Observações" value={f.notes} onChange={set('notes')} className="sm:col-span-2" rows={2} />
      </div>
    </Modal>
  );
}
