// Unidades (matriz, filiais, oficinas).
import { useState } from 'react';
import { Plus, Building2, Star, Pencil } from 'lucide-react';
import { api } from '../lib/api';
import { maskCep, lookupCep, maskPhone } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import { PageHeader, Input, Loading, Empty, Modal, Toggle, useFetch, useAction, FAIL } from '../components/ui';

export default function Units() {
  const { can } = useAuth();
  const { confirm } = useUI();
  const { data, reload, loading } = useFetch(() => api.get('/units'));
  const [edit, setEdit] = useState(null);
  const [run] = useAction();
  const manage = can('units_manage');
  const deactivate = async (u) => {
    if (!(await confirm({ title: `Desativar ${u.name}?`, message: 'Os registros antigos continuam vinculados a ela.', confirmText: 'Desativar' }))) return;
    if ((await run(() => api.del(`/units/${u.id}`), 'Unidade desativada')) !== FAIL) reload();
  };
  return (
    <div>
      <PageHeader title="Unidades" subtitle="Matriz e filiais. Solicitações, orçamentos e OS ficam vinculados à unidade de quem registrou."
        actions={manage && <button className="btn-primary" onClick={() => setEdit({ name: '', active: true })}><Plus className="h-4 w-4" /> Nova unidade</button>} />
      {loading && !data ? <Loading /> : !data?.length ? <div className="card"><Empty icon={Building2} title="Nenhuma unidade" /></div> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((u) => (
            <div key={u.id} className={`card p-4 ${u.active ? '' : 'opacity-60'}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-1.5 font-semibold">{u.name}{u.is_default && <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-label="Principal" />}</div>
                  <div className="text-sm text-ink-soft">{[u.street, u.number, u.district].filter(Boolean).join(', ') || 'Endereço não informado'}</div>
                  <div className="text-sm text-ink-soft">{[u.city, u.uf].filter(Boolean).join('/')}</div>
                  <div className="mt-1 text-xs text-ink-faint">{u.users_count} usuário(s){!u.active && ' · inativa'}</div>
                </div>
                {manage && <button className="btn-ghost btn-icon h-8" aria-label="Editar" onClick={() => setEdit(u)}><Pencil className="h-4 w-4" /></button>}
              </div>
              {manage && !u.is_default && u.active && <button className="btn-ghost mt-2 h-8 text-xs text-red-600" onClick={() => deactivate(u)}>Desativar</button>}
            </div>
          ))}
        </div>
      )}
      {edit && <UnitModal unit={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </div>
  );
}

function UnitModal({ unit, onClose, onSaved }) {
  const [run, busy] = useAction();
  const [f, setF] = useState({ ...unit });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const cep = async (v) => {
    const m = maskCep(v);
    setF((x) => ({ ...x, cep: m }));
    const a = await lookupCep(m);
    if (a) setF((x) => ({ ...x, ...a }));
  };
  const save = async () => {
    const body = { name: f.name, phone: f.phone || null, cep: f.cep || null, street: f.street || null, number: f.number || null, complement: f.complement || null,
      district: f.district || null, city: f.city || null, uf: f.uf || null, city_code: f.city_code || null, is_default: !!f.is_default, active: f.active !== false };
    const r = await run(() => (unit.id ? api.put(`/units/${unit.id}`, body) : api.post('/units', body)), 'Unidade salva');
    if (r !== FAIL) onSaved();
  };
  return (
    <Modal open onClose={onClose} title={unit.id ? 'Editar unidade' : 'Nova unidade'}
      footer={<><button className="btn-ghost" onClick={onClose}>Voltar</button><button className="btn-primary" disabled={busy || (f.name || '').trim().length < 2} onClick={save}>Salvar</button></>}>
      <div className="grid gap-3 sm:grid-cols-6">
        <Input label="Nome" value={f.name} onChange={set('name')} className="sm:col-span-4" placeholder="Ex.: Oficina Centro" />
        <Input label="Telefone" value={f.phone || ''} onChange={(e) => setF({ ...f, phone: maskPhone(e.target.value) })} className="sm:col-span-2" />
        <Input label="CEP" value={f.cep || ''} onChange={(e) => cep(e.target.value)} className="sm:col-span-2" />
        <Input label="Logradouro" value={f.street || ''} onChange={set('street')} className="sm:col-span-3" />
        <Input label="Número" value={f.number || ''} onChange={set('number')} className="sm:col-span-1" />
        <Input label="Bairro" value={f.district || ''} onChange={set('district')} className="sm:col-span-2" />
        <Input label="Cidade" value={f.city || ''} onChange={set('city')} className="sm:col-span-3" />
        <Input label="UF" value={f.uf || ''} maxLength={2} onChange={(e) => setF({ ...f, uf: e.target.value.toUpperCase() })} className="sm:col-span-1" />
        <div className="sm:col-span-6"><Toggle checked={!!f.is_default} onChange={(v) => setF({ ...f, is_default: v })} label="Unidade principal" hint="Usada como padrão para novos registros." /></div>
      </div>
    </Modal>
  );
}
