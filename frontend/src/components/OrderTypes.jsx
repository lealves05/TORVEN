// Tipos de ordem de serviço e os checklists vinculados a cada tipo (recebimento, inspeção final, entrega).
import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, X, ClipboardList, ClipboardCheck, ArrowUp, ArrowDown, Info, Pencil, Tags } from 'lucide-react';
import { api } from '../lib/api';
import { useUI } from '../context/UIContext';
import { Input, Textarea, Select, Toggle, Modal, Loading, useAction, FAIL, cx } from './ui';

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
function useQualityData() {
  const [types, setTypes] = useState(null);
  const [tpls, setTpls] = useState(null);
  const load = useCallback(() => Promise.all([
    api.get('/quality/types?all=1').then(setTypes).catch(() => setTypes([])),
    api.get('/quality/templates?all=1').then(setTpls).catch(() => setTpls([])),
  ]), []);
  useEffect(() => { load(); }, [load]);
  return { types, tpls, load };
}

/** Salva o checklist (com os tipos vinculados). Devolve o checklist salvo ou FAIL. */
async function saveTemplate(run, tpl) {
  const body = {
    name: tpl.name, kind: tpl.kind, required: !!tpl.required, active: tpl.active !== false,
    order_type_ids: tpl.order_type_ids || [], items: tpl.items.map((x) => x.trim()).filter(Boolean),
  };
  return run(() => (tpl.id ? api.put(`/quality/templates/${tpl.id}`, body) : api.post('/quality/templates', body)), 'Checklist salvo');
}

const Help = ({ children }) => <div className="flex gap-2 rounded-app-sm bg-sky-500/10 p-3 text-sm text-sky-800 dark:text-sky-200"><Info className="mt-0.5 h-4 w-4 shrink-0" /><div>{children}</div></div>;

/** Aba "Checklists": cadastro dos checklists (obrigatórios ou não) e em quais tipos de OS cada um vale. */
export function ChecklistsSettings() {
  const [run, busy] = useAction();
  const { types, tpls, load } = useQualityData();
  const [edit, setEdit] = useState(null);
  const [kind, setKind] = useState('');
  if (!types || !tpls) return <Loading />;
  const typeName = (id) => types.find((t) => t.id === id)?.name || 'tipo';
  const list = tpls.filter((c) => !kind || c.kind === kind);
  const save = async () => { if ((await saveTemplate(run, edit)) !== FAIL) { setEdit(null); load(); } };
  return (
    <div className="max-w-5xl space-y-4" id="checklists">
      <div className="card space-y-3 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold">Checklists</h3>
            <p className="text-sm text-ink-faint">Listas de conferência usadas nas OS: no recebimento, na inspeção final e na entrega.</p>
          </div>
          <button className="btn-primary h-9 text-sm" data-tour="novo-checklist" onClick={() => setEdit(newTpl([], 'recebimento'))}><Plus className="h-4 w-4" /> Novo checklist</button>
        </div>
        <Help>
          Marque <b>Obrigatório</b> para a OS não avançar sem o checklist preenchido. Escolha em <b>quais tipos de OS</b> ele vale;
          sem nenhum tipo marcado, ele vale para <b>todas as OS</b>.
        </Help>
        <div className="flex flex-wrap gap-1.5">
          {[['', 'Todas as etapas'], ...Object.entries(CHECK_KIND)].map(([k, l]) => (
            <button key={k} onClick={() => setKind(k)} className={cx('chip border', kind === k ? 'border-primary bg-primary/10 text-primary' : 'border-line')}>{l}</button>
          ))}
        </div>
      </div>
      {!list.length ? (
        <div className="card p-8 text-center text-sm text-ink-soft"><ClipboardList className="mx-auto mb-2 h-8 w-8 text-ink-faint" />Nenhum checklist ainda. Clique em <b>Novo checklist</b>.</div>
      ) : (
        <div className="card divide-y divide-line">
          {list.map((c) => (
            <button key={c.id} className={cx('flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-muted/50', !c.active && 'opacity-60')}
              onClick={() => setEdit({ ...c, items: [...c.items], order_type_ids: [...(c.order_type_ids || [])] })}>
              <ClipboardCheck className="h-5 w-5 shrink-0 text-ink-faint" />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{c.name}</span>
                <span className="text-xs text-ink-faint">{CHECK_KIND[c.kind]} · {c.items.length} itens</span>
              </span>
              <span className="flex flex-wrap gap-1">
                {c.required && <span className="chip bg-red-500/10 text-red-700 dark:text-red-300">Obrigatório</span>}
                {!c.active && <span className="chip bg-muted text-ink-soft">Desativado</span>}
                {c.order_type_ids?.length ? c.order_type_ids.map((id) => <span key={id} className="chip bg-primary/10 text-primary">{typeName(id)}</span>)
                  : <span className="chip bg-muted text-ink-soft">Todas as OS</span>}
              </span>
            </button>
          ))}
        </div>
      )}
      {edit && <TemplateModal tpl={edit} setTpl={setEdit} types={types} busy={busy} onSave={save} onClose={() => setEdit(null)} />}
    </div>
  );
}

/** Aba "Tipos de OS": cadastro dos tipos e escolha dos checklists de cada um. */
export function OrderTypesTab() {
  const [run, busy] = useAction();
  const { confirm } = useUI();
  const { types, tpls, load } = useQualityData();
  const [edit, setEdit] = useState(null); // { ...tipo, checklist_ids }
  const [newChecklist, setNewChecklist] = useState(null);
  if (!types || !tpls) return <Loading />;

  const open = (t) => setEdit(t ? { ...t, checklist_ids: [...(t.checklist_ids || [])] } : { name: '', description: '', active: true, checklist_ids: [] });
  const save = async () => {
    const body = { name: edit.name, description: edit.description || null, active: edit.active !== false };
    const r = await run(async () => {
      const t = edit.id ? await api.put(`/quality/types/${edit.id}`, body) : await api.post('/quality/types', body);
      await api.put(`/quality/types/${t.id}/checklists`, { template_ids: edit.checklist_ids });
      return t;
    }, 'Tipo de OS salvo');
    if (r !== FAIL) { setEdit(null); load(); }
  };
  const remove = async () => {
    if (!(await confirm({ title: 'Excluir este tipo de OS?', message: `"${edit.name}" deixa de existir. Checklists usados só por ele são desativados.`, confirmText: 'Excluir', danger: true }))) return;
    if ((await run(() => api.del(`/quality/types/${edit.id}`), 'Tipo de OS excluído')) !== FAIL) { setEdit(null); load(); }
  };
  const toggle = (id) => setEdit((e) => ({ ...e, checklist_ids: e.checklist_ids.includes(id) ? e.checklist_ids.filter((x) => x !== id) : [...e.checklist_ids, id] }));
  const createChecklist = async () => {
    const r = await saveTemplate(run, newChecklist);
    if (r === FAIL) return;
    setNewChecklist(null);
    await load();
    setEdit((e) => (e ? { ...e, checklist_ids: [...e.checklist_ids, r.id] } : e));
  };
  const tplName = (id) => tpls.find((c) => c.id === id);

  return (
    <div className="max-w-5xl space-y-4" id="tipos-de-os">
      <div className="card space-y-3 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold">Tipos de ordem de serviço</h3>
            <p className="text-sm text-ink-faint">Os serviços que a empresa faz (ex.: Troca de óleo, Funilaria, Solda). Ao escolher o tipo na OS, os checklists dele aparecem sozinhos.</p>
          </div>
          <button className="btn-primary h-9 text-sm" data-tour="novo-tipo" onClick={() => open(null)}><Plus className="h-4 w-4" /> Novo tipo de OS</button>
        </div>
        <Help>Em cada tipo, marque os <b>checklists</b> que devem ser usados. Os checklists marcados como <b>Obrigatório</b> travam a OS até serem preenchidos.</Help>
      </div>
      {!types.length ? (
        <div className="card p-8 text-center text-sm text-ink-soft"><Tags className="mx-auto mb-2 h-8 w-8 text-ink-faint" />Nenhum tipo de OS ainda. Clique em <b>Novo tipo de OS</b>.</div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {types.map((t) => (
            <section key={t.id} className={cx('card p-4', !t.active && 'opacity-60')} aria-label={`Tipo ${t.name}`}>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <h4 className="font-semibold">{t.name} {!t.active && <span className="chip bg-muted text-ink-soft">Desativado</span>}</h4>
                  <p className="text-xs text-ink-faint">{t.description || 'Sem descrição'} · {t.orders} OS</p>
                </div>
                <button className="btn-outline h-8 text-xs" onClick={() => open(t)}><Pencil className="h-3.5 w-3.5" /> Editar</button>
              </div>
              <ul className="mt-3 space-y-1 text-sm">
                {(t.checklist_ids || []).map((id) => tplName(id)).filter(Boolean).map((c) => (
                  <li key={c.id} className="flex items-center gap-2"><ClipboardCheck className="h-4 w-4 text-ink-faint" />
                    <span className="min-w-0 flex-1 truncate">{c.name} <span className="text-xs text-ink-faint">· {CHECK_KIND[c.kind]}</span></span>
                    {c.required && <span className="chip bg-red-500/10 text-red-700 dark:text-red-300">Obrigatório</span>}
                  </li>
                ))}
                {!t.checklist_ids?.length && <li className="text-xs text-ink-faint">Nenhum checklist próprio — usa só os checklists gerais.</li>}
              </ul>
            </section>
          ))}
        </div>
      )}

      {edit && (
        <Modal open onClose={() => setEdit(null)} size="lg" title={edit.id ? 'Editar tipo de OS' : 'Novo tipo de OS'}
          footer={<>
            {edit.id && !edit.orders && <button className="btn-ghost mr-auto text-red-600" disabled={busy} onClick={remove}><Trash2 className="h-4 w-4" /> Excluir</button>}
            <button className="btn-ghost" onClick={() => setEdit(null)}>Voltar</button>
            <button className="btn-primary" disabled={busy || edit.name.trim().length < 2} onClick={save}>Salvar tipo</button>
          </>}>
          <div className="space-y-4">
            <Input label="Nome do tipo" placeholder="Ex.: Troca de óleo" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} autoFocus />
            <Textarea label="Descrição (opcional)" rows={2} value={edit.description || ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
            {edit.id && <Toggle checked={edit.active !== false} onChange={(v) => setEdit({ ...edit, active: v })} label="Ativo" hint="Desativado, o tipo some da lista na abertura da OS. As OS antigas continuam com ele." />}
            <div>
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium">Checklists deste tipo</span>
                <button className="btn-ghost h-8 text-xs text-primary" onClick={() => setNewChecklist(newTpl([], 'recebimento'))}><Plus className="h-3.5 w-3.5" /> Criar checklist novo</button>
              </div>
              <p className="mb-2 text-xs text-ink-faint">Marque os checklists que valem para este tipo. Os que não têm tipo nenhum valem para todas as OS.</p>
              {!tpls.length ? <p className="text-sm text-ink-soft">Nenhum checklist cadastrado ainda.</p> : (
                <div className="grid gap-3 sm:grid-cols-3">
                  {Object.entries(CHECK_KIND).map(([k, label]) => (
                    <fieldset key={k} className="min-w-0 rounded-app-sm bg-muted/50 p-3">
                      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-soft">{label}</legend>
                      {tpls.filter((c) => c.kind === k && c.active).map((c) => (
                        <label key={c.id} className="flex cursor-pointer items-start gap-2 py-1 text-sm">
                          <input type="checkbox" className="mt-1" checked={edit.checklist_ids.includes(c.id)} onChange={() => toggle(c.id)} />
                          <span className="min-w-0">{c.name}{c.required && <span className="block text-[11px] text-red-600">obrigatório</span>}</span>
                        </label>
                      ))}
                      {!tpls.some((c) => c.kind === k && c.active) && <p className="text-xs text-ink-faint">Nenhum</p>}
                    </fieldset>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Modal>
      )}
      {newChecklist && <TemplateModal tpl={newChecklist} setTpl={setNewChecklist} types={types} busy={busy} onSave={createChecklist} onClose={() => setNewChecklist(null)} hideTypes />}
    </div>
  );
}

const newTpl = (typeIds, kind) => ({ name: '', kind, order_type_ids: typeIds, items: [''], required: false, active: true });

function TemplateModal({ tpl, setTpl, types, busy, onSave, onClose, hideTypes }) {
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
        <Select label="Etapa" className="sm:col-span-2" value={tpl.kind} onChange={(e) => setTpl({ ...tpl, kind: e.target.value })}>
          {Object.entries(CHECK_KIND).map(([k, v]) => <option key={k} value={k}>{v} — {KIND_HINT[k]}</option>)}
        </Select>
        {!hideTypes && (
          <div className="sm:col-span-2">
            <div className="mb-1 text-sm font-medium">Vale para quais tipos de OS?</div>
            <div className="flex flex-wrap gap-2">
              <label className={cx('flex cursor-pointer items-center gap-2 rounded-app-sm border px-3 py-1.5 text-sm', !tpl.order_type_ids?.length ? 'border-primary bg-primary/10 text-primary' : 'border-line')}>
                <input type="checkbox" checked={!tpl.order_type_ids?.length} onChange={() => setTpl({ ...tpl, order_type_ids: [] })} /> Todas as OS
              </label>
              {types.map((t) => {
                const on = tpl.order_type_ids?.includes(t.id);
                return (
                  <label key={t.id} className={cx('flex cursor-pointer items-center gap-2 rounded-app-sm border px-3 py-1.5 text-sm', on ? 'border-primary bg-primary/10 text-primary' : 'border-line')}>
                    <input type="checkbox" checked={!!on} onChange={() => setTpl({ ...tpl, order_type_ids: on ? tpl.order_type_ids.filter((x) => x !== t.id) : [...(tpl.order_type_ids || []), t.id] })} />
                    {t.name}{!t.active ? ' (desativado)' : ''}
                  </label>
                );
              })}
            </div>
            {!types.length && <p className="mt-1 text-xs text-ink-faint">Cadastre tipos de OS na aba Tipos de OS para usar checklists diferentes em cada serviço.</p>}
          </div>
        )}
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
