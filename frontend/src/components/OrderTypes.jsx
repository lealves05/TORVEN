// Tipos de ordem de serviço e os checklists vinculados a cada tipo (recebimento, inspeção final, entrega).
import { useEffect, useState } from 'react';
import { Plus, Trash2, X, ClipboardList, ArrowUp, ArrowDown } from 'lucide-react';
import { api } from '../lib/api';
import { useUI } from '../context/UIContext';
import { Input, Textarea, Select, Toggle, Modal, useAction, FAIL, cx } from './ui';

export const CHECK_KIND = { recebimento: 'Recebimento', inspecao: 'Inspeção final', entrega: 'Entrega' };
const KIND_HINT = {
  recebimento: 'quando o cliente deixa o item',
  inspecao: 'antes de marcar a OS como pronta',
  entrega: 'na hora de devolver ao cliente',
};

/** Lista dos tipos de OS ativos (para escolher na OS). */
export function useOrderTypes() {
  const [types, setTypes] = useState(null);
  useEffect(() => { api.get('/quality/types').then(setTypes).catch(() => setTypes([])); }, []);
  return types;
}

/** Campo "Tipo de OS" usado na abertura e na própria OS. */
export function OrderTypeSelect({ types, value, onChange, label = 'Tipo de OS', className }) {
  if (!types?.length) return null;
  const current = value && !types.some((t) => t.id === value);
  return (
    <Select label={label} value={value || ''} onChange={(e) => onChange(e.target.value || null)} className={className}>
      <option value="">Sem tipo (checklists gerais)</option>
      {current && <option value={value}>Tipo desativado</option>}
      {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
    </Select>
  );
}

// ---------- Configurações ----------
export function OrderTypesSettings() {
  const [run, busy] = useAction();
  const { confirm } = useUI();
  const [types, setTypes] = useState([]);
  const [tpls, setTpls] = useState([]);
  const [editType, setEditType] = useState(null);
  const [editTpl, setEditTpl] = useState(null);
  const load = () => {
    api.get('/quality/types?all=1').then(setTypes).catch(() => {});
    api.get('/quality/templates?all=1').then(setTpls).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const saveType = async () => {
    const body = { name: editType.name, description: editType.description || null, active: editType.active !== false };
    const r = await run(() => (editType.id ? api.put(`/quality/types/${editType.id}`, body) : api.post('/quality/types', body)), 'Tipo de OS salvo');
    if (r === FAIL) return;
    const isNew = !editType.id;
    setEditType(null);
    load();
    // tipo novo: já abre o primeiro checklist dele, que é o passo seguinte natural
    if (isNew && r?.id) setEditTpl(newTpl(r.id, 'recebimento'));
  };
  const removeType = async () => {
    if (!(await confirm({ title: 'Excluir este tipo de OS?', message: `"${editType.name}" e os checklists dele deixam de aparecer.`, confirmText: 'Excluir' }))) return;
    const r = await run(() => api.del(`/quality/types/${editType.id}`), 'Tipo de OS excluído');
    if (r !== FAIL) { setEditType(null); load(); }
  };
  const saveTpl = async () => {
    const body = {
      name: editTpl.name, kind: editTpl.kind, order_type_id: editTpl.order_type_id || null, required: !!editTpl.required,
      items: editTpl.items.map((x) => x.trim()).filter(Boolean), active: editTpl.active !== false,
    };
    const r = await run(() => (editTpl.id ? api.put(`/quality/templates/${editTpl.id}`, body) : api.post('/quality/templates', body)), 'Checklist salvo');
    if (r !== FAIL) { setEditTpl(null); load(); }
  };

  const groups = [...types.map((t) => ({ type: t, list: tpls.filter((c) => c.order_type_id === t.id) })),
    { type: null, list: tpls.filter((c) => !c.order_type_id) }];

  return (
    <div className="card space-y-4 p-6 lg:col-span-2" id="tipos-de-os">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold">Tipos de OS e checklists</h3>
          <p className="text-sm text-ink-faint">
            Crie os tipos de serviço que a empresa faz (ex.: Troca de óleo, Funilaria, Solda) e monte o checklist de cada etapa.
            Ao escolher o tipo na OS, o checklist certo aparece sozinho.
          </p>
        </div>
        <button className="btn-primary h-9 text-sm" onClick={() => setEditType({ name: '', description: '', active: true })}><Plus className="h-4 w-4" /> Novo tipo de OS</button>
      </div>

      {groups.map(({ type, list }) => (
        <section key={type?.id || 'geral'} className={cx('rounded-app-sm border border-line p-4', type && !type.active && 'opacity-60')} aria-label={type ? `Tipo ${type.name}` : 'Checklists gerais'}>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <ClipboardList className="h-4 w-4 text-ink-faint" />
            <h4 className="font-semibold">{type ? type.name : 'Checklists gerais'}</h4>
            {type && !type.active && <span className="chip bg-muted text-ink-soft">Desativado</span>}
            {type && <span className="text-xs text-ink-faint">{type.orders} OS</span>}
            {type && <button className="btn-ghost ml-auto h-8 text-xs" onClick={() => setEditType({ ...type })}>Editar tipo</button>}
          </div>
          <p className="-mt-2 mb-3 text-xs text-ink-faint">{type ? type.description || 'Checklists usados só nas OS deste tipo.' : 'Valem para todas as OS, inclusive as sem tipo.'}</p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {Object.entries(CHECK_KIND).map(([k, label]) => (
              <div key={k} className="min-w-0 rounded-app-sm bg-muted/50 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-ink-soft">{label}</div>
                <div className="mb-2 text-[11px] text-ink-faint">{KIND_HINT[k]}</div>
                <ul className="space-y-1.5">
                  {list.filter((c) => c.kind === k).map((c) => (
                    <li key={c.id}>
                      <button className={cx('w-full rounded-app-sm border border-line bg-surface px-2 py-1.5 text-left text-sm hover:border-primary', !c.active && 'opacity-50')}
                        onClick={() => setEditTpl({ ...c, items: [...c.items] })}>
                        <span className="block truncate font-medium">{c.name}</span>
                        <span className="text-xs text-ink-faint">{c.items.length} itens{c.required && ' · obrigatório'}{!c.active && ' · desativado'}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                <button className="btn-ghost mt-1.5 h-8 w-full justify-start text-xs text-primary" onClick={() => setEditTpl(newTpl(type?.id || null, k))}
                  aria-label={`Criar checklist de ${label}${type ? ` para ${type.name}` : ' geral'}`}>
                  <Plus className="h-3.5 w-3.5" /> Criar checklist
                </button>
              </div>
            ))}
          </div>
        </section>
      ))}

      {editType && (
        <Modal open onClose={() => setEditType(null)} title={editType.id ? 'Editar tipo de OS' : 'Novo tipo de OS'}
          footer={<>
            {editType.id && !editType.orders && <button className="btn-ghost mr-auto text-red-600" disabled={busy} onClick={removeType}><Trash2 className="h-4 w-4" /> Excluir</button>}
            <button className="btn-ghost" onClick={() => setEditType(null)}>Voltar</button>
            <button className="btn-primary" disabled={busy || editType.name.trim().length < 2} onClick={saveType}>Salvar</button>
          </>}>
          <div className="space-y-3">
            <Input label="Nome do tipo" placeholder="Ex.: Troca de óleo" value={editType.name} onChange={(e) => setEditType({ ...editType, name: e.target.value })} autoFocus />
            <Textarea label="Descrição (opcional)" rows={2} value={editType.description || ''} onChange={(e) => setEditType({ ...editType, description: e.target.value })} />
            {editType.id && <Toggle checked={editType.active !== false} onChange={(v) => setEditType({ ...editType, active: v })} label="Ativo" hint="Desativado, o tipo some da lista na abertura da OS. As OS antigas continuam com ele." />}
            {!editType.id && <p className="text-xs text-ink-faint">Depois de salvar, você já monta o primeiro checklist deste tipo.</p>}
          </div>
        </Modal>
      )}
      {editTpl && <TemplateModal tpl={editTpl} setTpl={setEditTpl} types={types} busy={busy} onSave={saveTpl} onClose={() => setEditTpl(null)} />}
    </div>
  );
}

const newTpl = (typeId, kind) => ({ name: '', kind, order_type_id: typeId, items: [''], required: false, active: true });

function TemplateModal({ tpl, setTpl, types, busy, onSave, onClose }) {
  const [extra, setExtra] = useState('');
  const items = tpl.items;
  const setItems = (list) => setTpl({ ...tpl, items: list });
  const add = () => {
    const v = extra.trim();
    if (v.length < 2) return;
    setItems([...items.filter((x) => x.trim()), v]);
    setExtra('');
  };
  const move = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    const l = [...items];
    [l[i], l[j]] = [l[j], l[i]];
    setItems(l);
  };
  const valid = tpl.name.trim().length >= 2 && items.some((x) => x.trim().length >= 2);
  return (
    <Modal open onClose={onClose} size="lg" title={tpl.id ? 'Editar checklist' : 'Novo checklist'}
      footer={<><button className="btn-ghost" onClick={onClose}>Voltar</button><button className="btn-primary" disabled={busy || !valid} onClick={onSave}>Salvar checklist</button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input label="Nome do checklist" placeholder="Ex.: Recebimento do veículo" value={tpl.name} onChange={(e) => setTpl({ ...tpl, name: e.target.value })} className="sm:col-span-2" autoFocus />
        <Select label="Tipo de OS" value={tpl.order_type_id || ''} onChange={(e) => setTpl({ ...tpl, order_type_id: e.target.value || null })}>
          <option value="">Geral (todas as OS)</option>
          {types.map((t) => <option key={t.id} value={t.id}>{t.name}{!t.active ? ' (desativado)' : ''}</option>)}
        </Select>
        <Select label="Etapa" value={tpl.kind} onChange={(e) => setTpl({ ...tpl, kind: e.target.value })}>
          {Object.entries(CHECK_KIND).map(([k, v]) => <option key={k} value={k}>{v} — {KIND_HINT[k]}</option>)}
        </Select>
        <div className="sm:col-span-2">
          <div className="mb-1 text-sm font-medium">Itens a conferir</div>
          <ol className="space-y-1.5">
            {items.map((it, i) => (
              <li key={i} className="flex items-center gap-1.5">
                <span className="w-6 shrink-0 text-right text-xs text-ink-faint">{i + 1}.</span>
                <input className="input h-9 min-w-0 flex-1" value={it} aria-label={`Item ${i + 1}`} placeholder="Ex.: Nível do óleo"
                  onChange={(e) => setItems(items.map((x, k) => (k === i ? e.target.value : x)))} />
                <button type="button" className="btn-ghost h-9 w-9 p-0" aria-label="Subir item" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="h-4 w-4" /></button>
                <button type="button" className="btn-ghost h-9 w-9 p-0" aria-label="Descer item" disabled={i === items.length - 1} onClick={() => move(i, 1)}><ArrowDown className="h-4 w-4" /></button>
                <button type="button" className="btn-ghost h-9 w-9 p-0 text-red-600" aria-label={`Apagar item ${i + 1}`} onClick={() => setItems(items.length > 1 ? items.filter((_, k) => k !== i) : [''])}><X className="h-4 w-4" /></button>
              </li>
            ))}
          </ol>
          <div className="mt-2 flex gap-2">
            <input className="input h-9 min-w-0 flex-1" placeholder="Escreva um item e toque em Adicionar" value={extra} aria-label="Novo item"
              onChange={(e) => setExtra(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
            <button type="button" className="btn-outline h-9 text-sm" disabled={extra.trim().length < 2} onClick={add}><Plus className="h-4 w-4" /> Adicionar</button>
          </div>
        </div>
        <div className="sm:col-span-2 space-y-1">
          <Toggle checked={!!tpl.required} onChange={(v) => setTpl({ ...tpl, required: v })} label="Obrigatório"
            hint={tpl.kind === 'recebimento' ? 'A OS só sai de “Recebida” depois que este checklist for preenchido.'
              : tpl.kind === 'inspecao' ? 'A OS só pode ser marcada como pronta (ou entregue) com este checklist aprovado.'
                : 'A OS só pode ser entregue depois que este checklist for preenchido.'} />
          <Toggle checked={tpl.active !== false} onChange={(v) => setTpl({ ...tpl, active: v })} label="Ativo" />
        </div>
      </div>
    </Modal>
  );
}
