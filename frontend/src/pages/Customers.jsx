import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Plus, Search, Users, Building2, User, Pencil, Trash2, ClipboardList, FileText, Wrench, Phone, Mail, MapPin, MessageCircle, Download, Star, Camera } from 'lucide-react';
import { api, qs } from '../lib/api';
import { money, fmt, waLink, downloadCSV, maskPhone, maskCep, lookupCep, docNumber } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import { PageHeader, Input, Select, Textarea, Modal, Loading, Empty, Stat, useAction, FAIL } from '../components/ui';
import { CustomerForm } from '../components/CustomerPicker';
import { OrdersTable } from './Orders';
import { QuoteBadge } from './Quotes';
import { RequestBadge } from './Requests';
import Attachments from '../components/Attachments';

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
  const [contact, setContact] = useState(null);
  const [addr, setAddr] = useState(null);
  const [photos, setPhotos] = useState(null);
  const load = useCallback(() => api.get(`/customers/${id}`).then(setC), [id]);
  useEffect(() => { load(); }, [load]);
  if (!c) return <Loading />;

  const removeEq = async (e) => {
    if (!(await confirm({ title: `Remover ${e.description}?`, confirmText: 'Remover' }))) return;
    if ((await run(() => api.del(`/customers/equipment/${e.id}`), 'Objeto removido')) !== FAIL) load();
  };
  const removeSub = async (kind, x) => {
    if (!(await confirm({ title: `Remover ${x.name || x.label || x.street}?`, confirmText: 'Remover' }))) return;
    if ((await run(() => api.del(`/customers/${c.id}/${kind}/${x.id}`), 'Removido')) !== FAIL) load();
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
        <Stat label="Objetos de serviço" value={c.equipment.length} icon={Wrench} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div>
            <h2 className="mb-3 font-semibold">Ordens de serviço e vendas</h2>
            <OrdersTable list={c.orders.map((o) => ({ ...o, customer_name: c.name, equipment_description: o.equipment, received_at: o.created_at }))} compact />
          </div>
          {c.requests?.length > 0 && (
            <div className="card">
              <h2 className="border-b border-line px-5 py-3.5 font-semibold">Solicitações</h2>
              <div className="divide-y divide-line">
                {c.requests.map((r) => (
                  <Link key={r.id} to={`/solicitacoes/${r.id}`} className="flex items-center gap-3 px-5 py-2.5 text-sm hover:bg-muted/50">
                    <span className="w-24 font-medium tabular-nums">{docNumber(company.settings, 'request', r.number)}</span>
                    <span className="min-w-0 flex-1 truncate">{r.title}</span>
                    <RequestBadge status={r.status} />
                  </Link>
                ))}
              </div>
            </div>
          )}
          {c.quotes.length > 0 && (
            <div className="card">
              <h2 className="border-b border-line px-5 py-3.5 font-semibold">Orçamentos</h2>
              <div className="divide-y divide-line">
                {c.quotes.map((q) => (
                  <Link key={q.id} to={`/orcamentos/${q.id}`} className="flex items-center gap-3 px-5 py-2.5 text-sm hover:bg-muted/50">
                    <span className="w-24 font-medium tabular-nums">{docNumber(company.settings, 'quote', q.number)}</span>
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
              <h2 className="font-semibold">Pessoas de contato</h2>
              {can('customers_edit') && <button className="btn-ghost h-8 text-xs text-primary" onClick={() => setContact({ name: '', receives_quotes: true })}><Plus className="h-3.5 w-3.5" /> Adicionar</button>}
            </div>
            {!c.contacts?.length ? <p className="px-5 py-4 text-sm text-ink-faint">Nenhum contato adicional.</p> : (
              <ul className="divide-y divide-line">
                {c.contacts.map((x) => (
                  <li key={x.id} className="group flex items-start gap-2 px-5 py-3 text-sm">
                    <User className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1 font-medium">{x.name}{x.is_primary && <Star className="h-3 w-3 fill-amber-400 text-amber-400" aria-label="Principal" />}</div>
                      <div className="text-xs text-ink-faint">{[x.role, x.phone, x.email].filter(Boolean).join(' · ')}</div>
                    </div>
                    {can('customers_edit') && <>
                      <button className="btn-ghost btn-icon h-7 md:opacity-0 md:group-hover:opacity-100" aria-label="Editar contato" onClick={() => setContact(x)}><Pencil className="h-3.5 w-3.5" /></button>
                      <button className="btn-ghost btn-icon h-7 text-red-600 md:opacity-0 md:group-hover:opacity-100" aria-label="Remover contato" onClick={() => removeSub('contacts', x)}><Trash2 className="h-3.5 w-3.5" /></button>
                    </>}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="card">
            <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
              <h2 className="font-semibold">Endereços</h2>
              {can('customers_edit') && <button className="btn-ghost h-8 text-xs text-primary" onClick={() => setAddr({ kind: 'execucao' })}><Plus className="h-3.5 w-3.5" /> Adicionar</button>}
            </div>
            {!c.addresses?.length ? <p className="px-5 py-4 text-sm text-ink-faint">Só o endereço principal.</p> : (
              <ul className="divide-y divide-line">
                {c.addresses.map((a) => (
                  <li key={a.id} className="group flex items-start gap-2 px-5 py-3 text-sm">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{a.label || ADDR_KIND[a.kind]} <span className="text-xs font-normal text-ink-faint">· {ADDR_KIND[a.kind]}</span></div>
                      <div className="text-xs text-ink-faint">{[a.street, a.number, a.district, a.city && `${a.city}/${a.uf || ''}`].filter(Boolean).join(', ')}</div>
                    </div>
                    {can('customers_edit') && <>
                      <button className="btn-ghost btn-icon h-7 md:opacity-0 md:group-hover:opacity-100" aria-label="Editar endereço" onClick={() => setAddr(a)}><Pencil className="h-3.5 w-3.5" /></button>
                      <button className="btn-ghost btn-icon h-7 text-red-600 md:opacity-0 md:group-hover:opacity-100" aria-label="Remover endereço" onClick={() => removeSub('addresses', a)}><Trash2 className="h-3.5 w-3.5" /></button>
                    </>}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="card">
            <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
              <h2 className="font-semibold">Objetos de serviço</h2>
              {can('customers_edit') && <button className="btn-ghost h-8 text-xs text-primary" onClick={() => setEq({ category: company.settings.equipmentCategories?.[0] })}><Plus className="h-3.5 w-3.5" /> Adicionar</button>}
            </div>
            {!c.equipment.length ? <p className="px-5 py-4 text-sm text-ink-faint">Nenhum equipamento cadastrado.</p> : (
              <ul className="divide-y divide-line">
                {c.equipment.map((e) => (
                  <li key={e.id} className="group flex items-start gap-2 px-5 py-3 text-sm">
                    <Wrench className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{e.description}</div>
                      <div className="text-xs text-ink-faint">{[e.category, e.brand, e.model, e.serial && `nº ${e.serial}`, e.plate && `placa ${e.plate}`, e.asset_tag && `patr. ${e.asset_tag}`].filter(Boolean).join(' · ')}</div>
                      {(e.material || e.dimensions || Number(e.quantity) > 1) && <div className="text-xs text-ink-faint">{[e.material, e.dimensions, Number(e.quantity) > 1 && `${e.quantity} un`].filter(Boolean).join(' · ')}</div>}
                      {e.condition && <div className="text-xs text-amber-700 dark:text-amber-300">Condição: {e.condition}</div>}
                    </div>
                    <button className="btn-ghost btn-icon h-7 md:opacity-0 md:group-hover:opacity-100" aria-label="Fotos" onClick={() => setPhotos(e)}><Camera className="h-3.5 w-3.5" /></button>
                    {can('customers_edit') && <>
                      <button className="btn-ghost btn-icon h-7 md:opacity-0 md:group-hover:opacity-100" aria-label="Editar" onClick={() => setEq(e)}><Pencil className="h-3.5 w-3.5" /></button>
                      <button className="btn-ghost btn-icon h-7 text-red-600 md:opacity-0 md:group-hover:opacity-100" aria-label="Remover" onClick={() => removeEq(e)}><Trash2 className="h-3.5 w-3.5" /></button>
                    </>}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Attachments entity="customer" entityId={c.id} canEdit={can('customers_edit')} title="Documentos do cliente" />
          {can('customers_edit') && <button className="btn-ghost w-full text-red-600" onClick={remove}><Trash2 className="h-4 w-4" /> Desativar cliente</button>}
        </div>
      </div>
      {edit && <CustomerForm customer={c} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); load(); }} />}
      {eq && <EquipmentForm customerId={c.id} eq={eq} onClose={() => setEq(null)} onSaved={() => { setEq(null); load(); }} />}
      {contact && <ContactForm customerId={c.id} contact={contact} onClose={() => setContact(null)} onSaved={() => { setContact(null); load(); }} />}
      {addr && <AddressForm customerId={c.id} addr={addr} onClose={() => setAddr(null)} onSaved={() => { setAddr(null); load(); }} />}
      {photos && (
        <Modal open onClose={() => setPhotos(null)} size="lg" title={photos.description} subtitle="Fotos e documentos do objeto">
          <Attachments entity="equipment" entityId={photos.id} canEdit={can('customers_edit', 'orders_edit')} compact title="Anexos" />
        </Modal>
      )}
    </div>
  );
}

function EquipmentForm({ customerId, eq, onClose, onSaved }) {
  const { company } = useAuth();
  const [run, busy] = useAction();
  const [f, setF] = useState(eq);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    const body = { category: f.category, description: f.description, brand: f.brand, model: f.model, serial: f.serial, year: f.year, notes: f.notes,
      quantity: Number(String(f.quantity ?? 1).replace(',', '.')) || 1, dimensions: f.dimensions, material: f.material, asset_tag: f.asset_tag, plate: f.plate, condition: f.condition };
    const r = await run(() => (f.id ? api.put(`/customers/equipment/${f.id}`, body) : api.post(`/customers/${customerId}/equipment`, body)), 'Objeto salvo');
    if (r !== FAIL) onSaved(r);
  };
  return (
    <Modal open onClose={onClose} title={f.id ? 'Editar objeto de serviço' : 'Novo objeto de serviço'}
      footer={<><button className="btn-ghost" onClick={onClose}>Cancelar</button><button className="btn-primary" disabled={busy || !f.description} onClick={save}>Salvar</button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Select label="Tipo" value={f.category || ''} onChange={set('category')}>{company.settings.equipmentCategories?.map((c) => <option key={c}>{c}</option>)}</Select>
        <Input label="Descrição" value={f.description} onChange={set('description')} autoFocus />
        <Input label="Marca" value={f.brand} onChange={set('brand')} />
        <Input label="Modelo" value={f.model} onChange={set('model')} />
        <Input label="Nº de série" value={f.serial} onChange={set('serial')} />
        <Input label="Ano" value={f.year} onChange={set('year')} />
        <Input label="Placa (veículos)" value={f.plate} onChange={set('plate')} />
        <Input label="Patrimônio" value={f.asset_tag} onChange={set('asset_tag')} />
        <Input label="Material" value={f.material} onChange={set('material')} placeholder="Ex.: aço carbono, inox 304, alumínio" />
        <Input label="Dimensões" value={f.dimensions} onChange={set('dimensions')} placeholder="Ex.: 3000 x 2400 mm" />
        <Input label="Quantidade" inputMode="decimal" value={String(f.quantity ?? 1)} onChange={set('quantity')} />
        <Input label="Condição de recebimento" value={f.condition} onChange={set('condition')} placeholder="Ex.: trinca na base, sem tampa" />
        <Textarea label="Observações" value={f.notes} onChange={set('notes')} className="sm:col-span-2" rows={2} />
      </div>
    </Modal>
  );
}

const ADDR_KIND = { cobranca: 'Cobrança', execucao: 'Execução do serviço', entrega: 'Entrega' };

function ContactForm({ customerId, contact, onClose, onSaved }) {
  const [run, busy] = useAction();
  const [f, setF] = useState({ role: '', phone: '', email: '', notes: '', is_primary: false, ...contact });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    const body = { name: f.name, role: f.role || null, phone: f.phone || null, email: f.email || null, is_primary: !!f.is_primary, receives_quotes: f.receives_quotes !== false, notes: f.notes || null };
    const r = await run(() => (f.id ? api.put(`/customers/${customerId}/contacts/${f.id}`, body) : api.post(`/customers/${customerId}/contacts`, body)), 'Contato salvo');
    if (r !== FAIL) onSaved(r);
  };
  return (
    <Modal open onClose={onClose} title={f.id ? 'Editar contato' : 'Nova pessoa de contato'}
      footer={<><button className="btn-ghost" onClick={onClose}>Cancelar</button><button className="btn-primary" disabled={busy || (f.name || '').trim().length < 2} onClick={save}>Salvar</button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Nome" value={f.name} onChange={set('name')} autoFocus />
        <Input label="Cargo / função" value={f.role} onChange={set('role')} placeholder="Ex.: Compras, Manutenção" />
        <Input label="Telefone" value={f.phone} onChange={(e) => setF({ ...f, phone: maskPhone(e.target.value) })} />
        <Input label="E-mail" type="email" value={f.email} onChange={set('email')} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!f.is_primary} onChange={(e) => setF({ ...f, is_primary: e.target.checked })} /> Contato principal</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.receives_quotes !== false} onChange={(e) => setF({ ...f, receives_quotes: e.target.checked })} /> Recebe orçamentos</label>
      </div>
    </Modal>
  );
}

function AddressForm({ customerId, addr, onClose, onSaved }) {
  const [run, busy] = useAction();
  const [f, setF] = useState({ label: '', cep: '', street: '', number: '', complement: '', district: '', city: '', uf: '', reference: '', ...addr });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const cep = async (v) => { const m = maskCep(v); setF((x) => ({ ...x, cep: m })); const a = await lookupCep(m); if (a) setF((x) => ({ ...x, ...a })); };
  const save = async () => {
    const keys = ['kind', 'label', 'cep', 'street', 'number', 'complement', 'district', 'city', 'uf', 'city_code', 'reference'];
    const body = Object.fromEntries(keys.map((k) => [k, f[k] || null]));
    const r = await run(() => (f.id ? api.put(`/customers/${customerId}/addresses/${f.id}`, body) : api.post(`/customers/${customerId}/addresses`, body)), 'Endereço salvo');
    if (r !== FAIL) onSaved(r);
  };
  return (
    <Modal open onClose={onClose} title={f.id ? 'Editar endereço' : 'Novo endereço'}
      footer={<><button className="btn-ghost" onClick={onClose}>Cancelar</button><button className="btn-primary" disabled={busy || (f.street || '').trim().length < 2} onClick={save}>Salvar</button></>}>
      <div className="grid gap-3 sm:grid-cols-6">
        <Select label="Tipo" value={f.kind} onChange={set('kind')} className="sm:col-span-3">{Object.entries(ADDR_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
        <Input label="Identificação" value={f.label} onChange={set('label')} className="sm:col-span-3" placeholder="Ex.: Fábrica, Obra Centro" />
        <Input label="CEP" value={f.cep} onChange={(e) => cep(e.target.value)} className="sm:col-span-2" />
        <Input label="Logradouro" value={f.street} onChange={set('street')} className="sm:col-span-3" />
        <Input label="Número" value={f.number} onChange={set('number')} className="sm:col-span-1" />
        <Input label="Complemento" value={f.complement} onChange={set('complement')} className="sm:col-span-2" />
        <Input label="Bairro" value={f.district} onChange={set('district')} className="sm:col-span-2" />
        <Input label="Cidade" value={f.city} onChange={set('city')} className="sm:col-span-1" />
        <Input label="UF" value={f.uf} maxLength={2} onChange={(e) => setF({ ...f, uf: e.target.value.toUpperCase() })} className="sm:col-span-1" />
        <Input label="Referência / acesso" value={f.reference} onChange={set('reference')} className="sm:col-span-6" />
      </div>
    </Modal>
  );
}
