import { useEffect, useRef, useState } from 'react';
import { Search, UserPlus, X, Building2, User, Car, Plus, Trash2, AlertTriangle } from 'lucide-react';
import { api, qs } from '../lib/api';
import { maskPhone, maskDoc, maskCep, lookupCep } from '../lib/format';
import { normalizePlate, formatPlate } from '../lib/plate';
import { useAuth } from '../context/AuthContext';
import { Modal, Input, Select, Textarea, useAction, FAIL, cx } from './ui';

/** Busca de cliente com cadastro rápido. value = objeto do cliente (ou null). */
export default function CustomerPicker({ value, onChange, label = 'Cliente', optional, autoFocus, initialText }) {
  const { can } = useAuth();
  const [text, setText] = useState(initialText || '');
  const [list, setList] = useState([]);
  const [open, setOpen] = useState(!!initialText); // nome falado no comando de voz: já mostra as opções
  const [creating, setCreating] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const t = setTimeout(() => api.get(`/customers${qs({ search: text, limit: 30 })}`).then(setList).catch(() => {}), 200);
    return () => clearTimeout(t);
  }, [text, open]);
  useEffect(() => {
    const h = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  if (value) {
    return (
      <div>
        {label && <span className="label">{label}</span>}
        <div className="flex items-center gap-3 rounded-app-sm border border-line bg-muted/40 px-3 py-2">
          {value.kind === 'pj' ? <Building2 className="h-4 w-4 text-ink-faint" /> : <User className="h-4 w-4 text-ink-faint" />}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{value.name}</div>
            <div className="truncate text-xs text-ink-faint">{[value.phone, value.document, value.city].filter(Boolean).join(' · ') || '—'}</div>
          </div>
          <button type="button" className="btn-ghost btn-icon h-8" onClick={() => onChange(null)} title="Trocar cliente" aria-label="Trocar cliente"><X className="h-4 w-4" /></button>
        </div>
      </div>
    );
  }

  return (
    <div ref={ref} className="relative">
      {label && <span className="label">{label}{optional && <span className="text-ink-faint"> (opcional)</span>}</span>}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
        {/* a lista só abre ao tocar/clicar ou digitar — o foco automático não cobre o resto do formulário */}
        <input className="input pl-9" placeholder="Buscar por nome, telefone ou CPF/CNPJ…" value={text} autoFocus={autoFocus}
          aria-label={label || 'Buscar cliente'} aria-expanded={open} aria-autocomplete="list" role="combobox"
          onClick={() => setOpen(true)} onKeyDown={(e) => { if (e.key === 'ArrowDown') setOpen(true); if (e.key === 'Escape') setOpen(false); }}
          onChange={(e) => { setText(e.target.value); setOpen(true); }} />
      </div>
      {open && (
        <div className="card animate-pop absolute z-40 mt-1 max-h-72 w-full overflow-y-auto p-1">
          {list.map((c) => (
            <button type="button" key={c.id} onClick={() => { onChange(c); setOpen(false); setText(''); }}
              className="flex min-h-[2.75rem] w-full items-center gap-3 rounded-app-sm px-3 py-2 text-left hover:bg-muted">
              {c.kind === 'pj' ? <Building2 className="h-4 w-4 shrink-0 text-ink-faint" /> : <User className="h-4 w-4 shrink-0 text-ink-faint" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{c.name}</span>
                <span className="block truncate text-xs text-ink-faint">{[c.phone, c.document].filter(Boolean).join(' · ')}</span>
              </span>
            </button>
          ))}
          {!list.length && <div className="px-3 py-2 text-sm text-ink-faint">Nenhum cliente encontrado.</div>}
          {can('customers_edit', 'orders_create') && (
            <button type="button" onClick={() => { setCreating({ kind: 'pf', name: text }); setOpen(false); }}
              className="flex w-full items-center gap-2 rounded-app-sm px-3 py-2 text-sm font-medium text-primary hover:bg-muted">
              <UserPlus className="h-4 w-4" /> Cadastrar {text ? `"${text}"` : 'novo cliente'}
            </button>
          )}
        </div>
      )}
      {creating && <CustomerForm customer={creating} onClose={() => setCreating(null)} onSaved={(c) => { onChange(c); setCreating(null); }} />}
    </div>
  );
}

/** Linhas de veículos do cadastro do cliente: placa, marca, modelo, ano e cor (vários por cliente). */
function VehiclesEditor({ rows, setRows, customerId, unique }) {
  const live = rows.filter((v) => !v.remove);
  const upd = (key, patch) => setRows((l) => l.map((v) => (v.key === key ? { ...v, ...patch } : v)));
  const repeated = (v) => {
    const n = normalizePlate(v.plate);
    return unique && n && live.filter((x) => normalizePlate(x.plate) === n).length > 1;
  };
  // placa completa: confere no cadastro se o veículo já pertence a outro cliente
  const check = async (v) => {
    const n = normalizePlate(v.plate);
    if (!v.plate) return upd(v.key, { warn: null });
    if (!n) return upd(v.key, { warn: 'Placa inválida (ABC1D23 ou ABC-1234)' });
    upd(v.key, { plate: formatPlate(n) });
    if (!unique) return upd(v.key, { warn: null });
    const r = await api.get(`/vehicles/plate/${n}`).catch(() => null);
    const other = r?.found && r.matches.find((m) => m.id !== v.id && m.customer_id !== customerId);
    upd(v.key, { warn: other ? `Já cadastrado para ${other.customer_name}` : null });
  };
  return (
    <div className="space-y-2 sm:col-span-6">
      <div className="flex items-center gap-2">
        <Car className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">Veículos</span>
        <span className="text-xs text-ink-faint">{unique ? 'cada placa pode estar em um único cadastro' : 'a mesma placa pode estar em mais de um cadastro'}</span>
        <button type="button" className="btn-ghost ml-auto h-8 border border-line px-2 text-xs"
          onClick={() => setRows((l) => [...l, { key: `n${Date.now()}`, plate: '', brand: '', model: '', year: '', color: '' }])}>
          <Plus className="h-3.5 w-3.5" /> Adicionar veículo
        </button>
      </div>
      {live.length === 0 && <p className="rounded-app-sm border border-dashed border-line px-3 py-2 text-xs text-ink-faint">Nenhum veículo. Use “Adicionar veículo” para cadastrar carro, moto ou utilitário do cliente.</p>}
      {live.map((v) => (
        <div key={v.key} className="rounded-app-sm border border-line p-2">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-[7.5rem_1fr_1fr_5.5rem_6.5rem_auto]">
            <Input label="Placa *" value={v.plate} maxLength={8} placeholder="ABC1D23" aria-label="Placa"
              onChange={(e) => upd(v.key, { plate: e.target.value.toUpperCase(), warn: null })} onBlur={() => check(v)} />
            <Input label="Marca" value={v.brand} placeholder="Ex.: Fiat" onChange={(e) => upd(v.key, { brand: e.target.value })} />
            <Input label="Modelo" value={v.model} placeholder="Ex.: Strada" onChange={(e) => upd(v.key, { model: e.target.value })} />
            <Input label="Ano" value={v.year} inputMode="numeric" maxLength={9} placeholder="2022" onChange={(e) => upd(v.key, { year: e.target.value })} />
            <Input label="Cor" value={v.color} onChange={(e) => upd(v.key, { color: e.target.value })} />
            <button type="button" className="btn-ghost btn-icon self-end text-red-600" title="Remover veículo"
              onClick={() => setRows((l) => (v.id ? l.map((x) => (x.key === v.key ? { ...x, remove: true } : x)) : l.filter((x) => x.key !== v.key)))}>
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          {(v.warn || repeated(v)) && (
            <p className="mt-1 flex items-center gap-1 text-xs text-red-600"><AlertTriangle className="h-3 w-3" />{v.warn || 'Placa repetida neste cadastro'}</p>
          )}
        </div>
      ))}
    </div>
  );
}

export function CustomerForm({ customer, onClose, onSaved }) {
  const [run, busy] = useAction();
  const { company } = useAuth();
  const unique = company?.settings?.orders?.uniqueVehicle !== false;
  const [f, setF] = useState({ kind: 'pf', ...customer });
  const [vehicles, setVehicles] = useState([]);
  useEffect(() => {
    if (!customer?.id) return;
    api.get(`/customers/${customer.id}/equipment`).then((l) => setVehicles(l.filter((e) => e.plate).map((e) => ({
      key: e.id, id: e.id, plate: e.plate || '', brand: e.brand || '', model: e.model || '', year: e.year || '', color: e.color || '',
    })))).catch(() => {});
  }, [customer?.id]);
  const vehiclesOk = vehicles.filter((v) => !v.remove).every((v) => normalizePlate(v.plate) && !v.warn)
    && (!unique || new Set(vehicles.filter((v) => !v.remove).map((v) => normalizePlate(v.plate))).size === vehicles.filter((v) => !v.remove).length);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));
  const pj = f.kind === 'pj';
  const cep = async (v) => {
    const m = maskCep(v);
    setF((x) => ({ ...x, cep: m }));
    if (m.length === 9) {
      const a = await lookupCep(m);
      if (a) setF((x) => ({ ...x, ...a, street: a.street || x.street, district: a.district || x.district }));
    }
  };
  const save = async () => {
    const body = { ...f };
    for (const k of ['id', 'created_at', 'orders_count', 'total_spent', 'last_order_at', 'equipment_count', 'company_id', 'equipment', 'orders', 'quotes', 'finance']) delete body[k];
    body.vehicles = vehicles.filter((v) => v.id || !v.remove).map(({ key, warn, ...v }) => ({
      ...v, plate: formatPlate(normalizePlate(v.plate) || v.plate), brand: v.brand || null, model: v.model || null, year: v.year || null, color: v.color || null,
    }));
    const r = await run(() => (f.id ? api.put(`/customers/${f.id}`, body) : api.post('/customers', body)), 'Cliente salvo');
    if (r !== FAIL) onSaved(r);
  };
  return (
    <Modal open onClose={onClose} size="lg" title={f.id ? 'Editar cliente' : 'Novo cliente'}
      footer={<><button className="btn-ghost" onClick={onClose}>Cancelar</button><button className="btn-primary" disabled={busy || !f.name || !vehiclesOk} onClick={save}>Salvar</button></>}>
      <div className="grid gap-4 sm:grid-cols-6">
        <div className="grid grid-cols-2 gap-2 sm:col-span-6">
          {[['pf', 'Pessoa física', User], ['pj', 'Pessoa jurídica', Building2]].map(([k, l, I]) => (
            <button key={k} type="button" onClick={() => setF({ ...f, kind: k })}
              className={cx('btn border', f.kind === k ? 'border-primary bg-primary/10 text-primary' : 'border-line')}><I className="h-4 w-4" />{l}</button>
          ))}
        </div>
        <Input label={pj ? 'Razão social' : 'Nome completo'} value={f.name} onChange={set('name')} className="sm:col-span-4" autoFocus />
        <Input label={pj ? 'CNPJ' : 'CPF'} value={f.document} onChange={(e) => setF({ ...f, document: maskDoc(e.target.value) })} className="sm:col-span-2" />
        {pj && <Input label="Nome fantasia" value={f.trade_name} onChange={set('trade_name')} className="sm:col-span-2" />}
        {pj && <Input label="Inscrição estadual" value={f.state_registration} onChange={set('state_registration')} className="sm:col-span-2" hint="Deixe vazio se isento" />}
        {pj && <Input label="Inscrição municipal" value={f.municipal_registration} onChange={set('municipal_registration')} className="sm:col-span-2" />}
        <Input label="Celular / WhatsApp" value={f.phone} onChange={(e) => setF({ ...f, phone: maskPhone(e.target.value) })} className="sm:col-span-2" />
        <Input label="Outro telefone" value={f.phone2} onChange={(e) => setF({ ...f, phone2: maskPhone(e.target.value) })} className="sm:col-span-2" />
        <Input label="E-mail" type="email" value={f.email} onChange={set('email')} className="sm:col-span-2" />
        <Input label="CEP" value={f.cep} onChange={(e) => cep(e.target.value)} className="sm:col-span-2" hint="Preenche o endereço" />
        <Input label="Endereço" value={f.street} onChange={set('street')} className="sm:col-span-3" />
        <Input label="Número" value={f.number} onChange={set('number')} className="sm:col-span-1" />
        <Input label="Complemento" value={f.complement} onChange={set('complement')} className="sm:col-span-2" />
        <Input label="Bairro" value={f.district} onChange={set('district')} className="sm:col-span-2" />
        <Input label="Cidade" value={f.city} onChange={set('city')} className="sm:col-span-1" />
        <Input label="UF" value={f.uf} maxLength={2} onChange={(e) => setF({ ...f, uf: e.target.value.toUpperCase() })} className="sm:col-span-1" />
        <VehiclesEditor rows={vehicles} setRows={setVehicles} customerId={f.id} unique={unique} />
        <Textarea label="Observações" value={f.notes} onChange={set('notes')} className="sm:col-span-6" rows={2} />
      </div>
    </Modal>
  );
}

/** Seleção do objeto de serviço do cliente (equipamento, peça, estrutura, veículo…), com cadastro rápido. */
export function EquipmentPicker({ customerId, value, onChange, newEquipment, onNewEquipment }) {
  const { company } = useAuth();
  const [list, setList] = useState([]);
  useEffect(() => {
    if (!customerId) { setList([]); return; }
    api.get(`/customers/${customerId}/equipment`).then(setList).catch(() => {});
  }, [customerId]);
  const cats = company?.settings?.equipmentCategories || [];
  const mode = newEquipment ? 'new' : 'pick';
  return (
    <div className="space-y-3">
      <div className="flex items-end gap-2">
        <Select label="Objeto de serviço" value={mode === 'new' ? '__new' : value || ''} className="flex-1" disabled={!customerId}
          onChange={(e) => {
            if (e.target.value === '__new') { onChange(null); onNewEquipment({ category: cats[0] || '', description: '' }); }
            else { onNewEquipment(null); onChange(e.target.value || null); }
          }}>
          <option value="">{customerId ? (list.length ? 'Selecione…' : 'Nenhum cadastrado') : 'Selecione o cliente primeiro'}</option>
          {list.map((e) => <option key={e.id} value={e.id}>{[e.plate && `Placa ${e.plate}`, e.description,
            ...[e.brand, e.model].filter((x) => x && !String(e.description || '').toLowerCase().includes(String(x).toLowerCase())),
            e.year, e.serial && `nº ${e.serial}`].filter(Boolean).join(' · ')}</option>)}
          {customerId && <option value="__new">+ Cadastrar novo objeto (equipamento, peça, estrutura…)</option>}
        </Select>
      </div>
      {newEquipment && (
        <div className="grid gap-3 rounded-app-sm border border-dashed border-line p-3 sm:grid-cols-6">
          <Select label="Tipo" value={newEquipment.category || ''} onChange={(e) => onNewEquipment({ ...newEquipment, category: e.target.value })} className="sm:col-span-2">
            {cats.map((c) => <option key={c}>{c}</option>)}
          </Select>
          <Input label="Descrição" value={newEquipment.description} placeholder="Ex.: Máquina MIG 250A, portão basculante…"
            onChange={(e) => onNewEquipment({ ...newEquipment, description: e.target.value })} className="sm:col-span-4" />
          <Input label="Marca" value={newEquipment.brand} onChange={(e) => onNewEquipment({ ...newEquipment, brand: e.target.value })} className="sm:col-span-2" />
          <Input label="Modelo" value={newEquipment.model} onChange={(e) => onNewEquipment({ ...newEquipment, model: e.target.value })} className="sm:col-span-2" />
          <Input label="Nº de série" value={newEquipment.serial} onChange={(e) => onNewEquipment({ ...newEquipment, serial: e.target.value })} className="sm:col-span-2" />
          <Input label="Material" value={newEquipment.material} placeholder="Ex.: aço carbono, inox 304" onChange={(e) => onNewEquipment({ ...newEquipment, material: e.target.value })} className="sm:col-span-3" />
          <Input label="Dimensões" value={newEquipment.dimensions} placeholder="Ex.: 3000 x 2400 mm" onChange={(e) => onNewEquipment({ ...newEquipment, dimensions: e.target.value })} className="sm:col-span-3" />
        </div>
      )}
    </div>
  );
}
