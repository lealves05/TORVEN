// Cadastros simples: serviços, técnicos e fornecedores.
import { useCallback, useEffect, useState } from 'react';
import { Plus, Search, Pencil, Trash2, Wrench, HardHat, Truck } from 'lucide-react';
import { api, qs } from '../lib/api';
import { money, maskPhone, maskDoc } from '../lib/format';
import { useSettings } from '../context/AuthContext';
import { useCatalog } from '../context/CatalogContext';
import { useUI } from '../context/UIContext';
import { PageHeader, Input, Select, MoneyInput, Textarea, Modal, Loading, Empty, Avatar, useAction, FAIL, cx } from '../components/ui';

function CrudPage({ title, subtitle, endpoint, icon, columns, Form, blank, onChanged }) {
  const { confirm } = useUI();
  const [run] = useAction();
  const [search, setSearch] = useState('');
  const [list, setList] = useState(null);
  const [edit, setEdit] = useState(null);
  const load = useCallback(() => api.get(`${endpoint}${qs({ search })}`).then(setList), [endpoint, search]);
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);
  const remove = async (x) => {
    if (!(await confirm({ title: `Desativar ${x.name}?`, message: 'O histórico é mantido.', confirmText: 'Desativar' }))) return;
    if ((await run(() => api.del(`${endpoint}/${x.id}`), 'Registro desativado')) !== FAIL) { load(); onChanged?.(); }
  };
  return (
    <div>
      <PageHeader title={title} subtitle={subtitle} actions={<button className="btn-primary" onClick={() => setEdit(blank)}><Plus className="h-4 w-4" /> Novo</button>} />
      <div className="card mb-4 p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <input className="input pl-9" placeholder="Buscar…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>
      <div className="card overflow-hidden">
        {!list ? <Loading /> : !list.length ? <Empty icon={icon} title="Nenhum registro" /> : (
          <div className="overflow-x-auto">
            <table className="table-clean">
              <thead><tr>{columns.map((c) => <th key={c.label} className={c.th}>{c.label}</th>)}<th /></tr></thead>
              <tbody>
                {list.map((x) => (
                  <tr key={x.id}>
                    {columns.map((c) => <td key={c.label} className={c.td}>{c.render(x)}</td>)}
                    <td className="w-24 whitespace-nowrap text-right">
                      <button className="btn-ghost btn-icon h-8" onClick={() => setEdit(x)}><Pencil className="h-4 w-4" /></button>
                      <button className="btn-ghost btn-icon h-8 text-red-600" onClick={() => remove(x)}><Trash2 className="h-4 w-4" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {edit && <FormModal endpoint={endpoint} item={edit} Form={Form} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); onChanged?.(); }} />}
    </div>
  );
}

function FormModal({ endpoint, item, Form, onClose, onSaved }) {
  const [run, busy] = useAction();
  const [f, setF] = useState(item);
  const save = async () => {
    const { id, company_id, created_at, active, ...body } = f; // eslint-disable-line no-unused-vars
    const r = await run(() => (id ? api.put(`${endpoint}/${id}`, body) : api.post(endpoint, body)), 'Salvo');
    if (r !== FAIL) onSaved(r);
  };
  return (
    <Modal open onClose={onClose} title={item.id ? 'Editar' : 'Novo cadastro'}
      footer={<><button className="btn-ghost" onClick={onClose}>Cancelar</button><button className="btn-primary" disabled={busy || !f.name} onClick={save}>Salvar</button></>}>
      <Form f={f} setF={setF} />
    </Modal>
  );
}

export function Services() {
  const settings = useSettings();
  const { reload } = useCatalog();
  return (
    <CrudPage title="Tabela de serviços" subtitle="Serviços de solda, serralheria e mecânica com preço e código fiscal" endpoint="/services" icon={Wrench}
      onChanged={reload} blank={{ name: '', unit: 'serv', price: 0, cost: 0, est_minutes: 60, category: settings.serviceCategories?.[0], service_code: '14.01' }}
      columns={[
        { label: 'Serviço', render: (s) => <><div className="font-medium">{s.name}</div><div className="text-xs text-ink-faint">{s.category}</div></> },
        { label: 'Unidade', th: 'hidden md:table-cell', td: 'hidden md:table-cell text-ink-soft', render: (s) => s.unit },
        { label: 'Tempo', th: 'hidden lg:table-cell', td: 'hidden lg:table-cell text-ink-soft', render: (s) => (s.est_minutes ? `${s.est_minutes} min` : '—') },
        { label: 'LC 116', th: 'hidden lg:table-cell', td: 'hidden lg:table-cell text-ink-soft', render: (s) => s.service_code || '—' },
        { label: 'Preço', th: 'text-right', td: 'text-right tabular-nums font-medium', render: (s) => money(s.price) },
      ]}
      Form={({ f, setF }) => {
        const set = (k) => (e) => setF({ ...f, [k]: e?.target ? e.target.value : e });
        return (
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Nome do serviço" value={f.name} onChange={set('name')} className="sm:col-span-2" autoFocus />
            <Select label="Categoria" value={f.category || ''} onChange={set('category')}>{settings.serviceCategories?.map((c) => <option key={c}>{c}</option>)}</Select>
            <Select label="Unidade de cobrança" value={f.unit} onChange={set('unit')}>
              {[['serv', 'Serviço (valor fechado)'], ['h', 'Hora'], ['m', 'Metro'], ['m²', 'Metro quadrado'], ['kg', 'Quilo'], ['pç', 'Peça'], ['cm', 'Centímetro de cordão']].map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Select>
            <MoneyInput label="Preço" value={f.price} onChange={set('price')} />
            <MoneyInput label="Custo estimado" value={f.cost} onChange={set('cost')} />
            <Input label="Tempo estimado (min)" type="number" min={0} value={f.est_minutes} onChange={set('est_minutes')} />
            <Input label="Comissão própria (%)" type="number" min={0} max={100} value={f.commission_rate ?? ''} onChange={(e) => setF({ ...f, commission_rate: e.target.value === '' ? null : e.target.value })} hint="Vazio = usa a do técnico" />
            <Input label="Item da lista LC 116 (NFS-e)" value={f.service_code || ''} onChange={set('service_code')} hint="14.01 conserto/manutenção · 14.13 serralheria" />
            <Textarea label="Descrição" value={f.description || ''} onChange={set('description')} rows={2} className="sm:col-span-2" />
          </div>
        );
      }} />
  );
}

export function Technicians() {
  const { reload } = useCatalog();
  return (
    <CrudPage title="Técnicos" subtitle="Soldadores, serralheiros e mecânicos — comissão e custo/hora" endpoint="/technicians" icon={HardHat}
      onChanged={reload} blank={{ name: '', color: '#ea580c', commission_rate: 0, hourly_cost: 0 }}
      columns={[
        { label: 'Técnico', render: (t) => <div className="flex items-center gap-3"><Avatar name={t.name} color={t.color} /><div><div className="font-medium">{t.name}</div><div className="text-xs text-ink-faint">{t.specialty}</div></div></div> },
        { label: 'Telefone', th: 'hidden md:table-cell', td: 'hidden md:table-cell text-ink-soft', render: (t) => t.phone || '—' },
        { label: 'Comissão', th: 'text-right', td: 'text-right tabular-nums', render: (t) => `${Number(t.commission_rate)}%` },
        { label: 'Custo/hora', th: 'hidden text-right sm:table-cell', td: 'hidden text-right tabular-nums sm:table-cell', render: (t) => money(t.hourly_cost) },
      ]}
      Form={({ f, setF }) => {
        const set = (k) => (e) => setF({ ...f, [k]: e?.target ? e.target.value : e });
        return (
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Nome" value={f.name} onChange={set('name')} autoFocus />
            <Input label="Especialidade" value={f.specialty || ''} onChange={set('specialty')} placeholder="TIG, MIG, serralheria…" />
            <Input label="Telefone" value={f.phone || ''} onChange={(e) => setF({ ...f, phone: maskPhone(e.target.value) })} />
            <Input label="E-mail" value={f.email || ''} onChange={set('email')} />
            <Input label="Comissão sobre serviços (%)" type="number" min={0} max={100} value={f.commission_rate} onChange={set('commission_rate')} />
            <MoneyInput label="Custo por hora" value={f.hourly_cost} onChange={set('hourly_cost')} />
            <div>
              <span className="label">Cor no quadro</span>
              <div className="flex gap-2">{['#ea580c', '#2563eb', '#16a34a', '#7c3aed', '#db2777', '#0d9488', '#ca8a04', '#475569'].map((c) => (
                <button key={c} type="button" onClick={() => setF({ ...f, color: c })} className={cx('h-8 w-8 rounded-full ring-offset-2 ring-offset-surface', f.color === c && 'ring-2 ring-ink')} style={{ background: c }} />
              ))}</div>
            </div>
          </div>
        );
      }} />
  );
}

export function Suppliers() {
  return (
    <CrudPage title="Fornecedores" subtitle="Distribuidoras de gases, aço, consumíveis e peças" endpoint="/suppliers" icon={Truck} blank={{ name: '' }}
      columns={[
        { label: 'Fornecedor', render: (s) => <><div className="font-medium">{s.name}</div><div className="text-xs text-ink-faint">{s.document}</div></> },
        { label: 'Contato', th: 'hidden md:table-cell', td: 'hidden md:table-cell text-ink-soft', render: (s) => [s.contact, s.phone].filter(Boolean).join(' · ') || '—' },
        { label: 'E-mail', th: 'hidden lg:table-cell', td: 'hidden lg:table-cell text-ink-soft', render: (s) => s.email || '—' },
      ]}
      Form={({ f, setF }) => {
        const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
        return (
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Razão social / nome" value={f.name} onChange={set('name')} className="sm:col-span-2" autoFocus />
            <Input label="CNPJ / CPF" value={f.document || ''} onChange={(e) => setF({ ...f, document: maskDoc(e.target.value) })} />
            <Input label="Contato" value={f.contact || ''} onChange={set('contact')} />
            <Input label="Telefone" value={f.phone || ''} onChange={(e) => setF({ ...f, phone: maskPhone(e.target.value) })} />
            <Input label="E-mail" value={f.email || ''} onChange={set('email')} />
            <Input label="Endereço" value={f.address || ''} onChange={set('address')} className="sm:col-span-2" />
            <Textarea label="Observações" value={f.notes || ''} onChange={set('notes')} rows={2} className="sm:col-span-2" />
          </div>
        );
      }} />
  );
}
