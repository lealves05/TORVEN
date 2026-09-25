import { Fragment, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Upload, Trash2, Plus, Check, Sun, Moon, Monitor } from 'lucide-react';
import { api, apiBase, getToken } from '../lib/api';
import { ROLES, maskPhone, maskDoc, maskCep, lookupCep } from '../lib/format';
import { applyTheme, PRESET_COLORS, RADIUS, FONTS } from '../lib/theme';
import { useAuth } from '../context/AuthContext';
import { useCatalog } from '../context/CatalogContext';
import FiscalSetup from '../components/FiscalSetup';
import { useUI } from '../context/UIContext';
import { PageHeader, Tabs, Input, Textarea, Select, Toggle, Modal, Avatar, useAction, FAIL, cx } from '../components/ui';

export default function Settings() {
  const { company, setCompany, user, can } = useAuth();
  const full = can('settings');
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || (full ? 'empresa' : can('fiscal_settings') ? 'fiscal' : 'perfis');
  const setTab = (t) => setParams({ tab: t });
  const [f, setF] = useState(() => structuredClone(company));
  const [run, busy] = useAction();
  const s = f.settings;
  const setS = (patch) => setF((x) => ({ ...x, settings: { ...x.settings, ...patch } }));
  const dirty = JSON.stringify(f) !== JSON.stringify(company);

  useEffect(() => { applyTheme(f.settings, user.preferences); }, [f.settings, user.preferences]);
  useEffect(() => () => applyTheme(company.settings, user.preferences), []); // eslint-disable-line

  const save = async () => {
    const fields = ['name', 'trade_name', 'document', 'state_registration', 'municipal_registration', 'phone', 'email', 'cep', 'street', 'number',
      'complement', 'district', 'city', 'uf', 'city_code', 'logo_url'];
    const body = full
      ? { ...Object.fromEntries(fields.map((k) => [k, f[k] ?? null])), settings: can('users') ? f.settings : (({ permissions, ...rest }) => rest)(f.settings) }
      : { settings: { permissions: f.settings.permissions } };
    const r = await run(() => api.put('/company', body), 'Configurações salvas');
    if (r !== FAIL) { setCompany(r); setF(structuredClone(r)); }
  };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const cep = async (v) => {
    const m = maskCep(v);
    setF((x) => ({ ...x, cep: m }));
    if (m.length === 9) { const a = await lookupCep(m); if (a) setF((x) => ({ ...x, ...a, street: a.street || x.street, district: a.district || x.district })); }
  };
  const o = s.orders;
  const setO = (patch) => setS({ orders: { ...o, ...patch } });

  return (
    <div className="pb-20">
      <PageHeader title="Configurações" subtitle="Dados da empresa, aparência, regras das OS, financeiro, fiscal e acessos" />
      <Tabs value={tab} onChange={setTab} tabs={[
        ...(full ? [{ value: 'empresa', label: 'Empresa' }, { value: 'aparencia', label: 'Aparência' }, { value: 'os', label: 'OS e orçamentos' },
          { value: 'financeiro', label: 'Financeiro' }, { value: 'categorias', label: 'Categorias' }] : []),
        ...(can('fiscal_settings') ? [{ value: 'fiscal', label: 'Fiscal (NF-e / NFS-e)' }] : []),
        ...(full ? [{ value: 'modulos', label: 'Módulos' }] : []),
        ...(can('users') ? [{ value: 'perfis', label: 'Perfis de acesso' }, { value: 'equipe', label: 'Usuários' }] : []),
        ...(can('data_export') ? [{ value: 'dados', label: 'Dados e exportação' }] : []),
      ]} />

      {tab === 'empresa' && (
        <div className="card grid max-w-4xl gap-4 p-6 sm:grid-cols-6">
          <div className="flex items-center gap-4 sm:col-span-6">
            {f.logo_url ? <img src={f.logo_url} alt="" className="h-16 w-16 rounded-app object-cover" /> : <div className="grid h-16 w-16 place-items-center rounded-app bg-muted text-xs text-ink-faint">logo</div>}
            <label className="btn-outline cursor-pointer"><Upload className="h-4 w-4" /> Enviar logo
              <input type="file" accept="image/*" className="hidden" onChange={async (e) => { const file = e.target.files?.[0]; if (file) setF({ ...f, logo_url: await resizeImage(file, 256) }); }} />
            </label>
            {f.logo_url && <button className="btn-ghost text-red-600" onClick={() => setF({ ...f, logo_url: null })}><Trash2 className="h-4 w-4" /></button>}
            <p className="text-xs text-ink-faint">Aparece no sistema, nas OS e orçamentos impressos e nos links do cliente.</p>
          </div>
          <Input label="Razão social" value={f.name} onChange={set('name')} className="sm:col-span-3" />
          <Input label="Nome fantasia" value={f.trade_name} onChange={set('trade_name')} className="sm:col-span-3" />
          <Input label="CNPJ / CPF" value={f.document} onChange={(e) => setF({ ...f, document: maskDoc(e.target.value) })} className="sm:col-span-2" />
          <Input label="Inscrição estadual" value={f.state_registration} onChange={set('state_registration')} className="sm:col-span-2" />
          <Input label="Inscrição municipal" value={f.municipal_registration} onChange={set('municipal_registration')} className="sm:col-span-2" />
          <Input label="Telefone / WhatsApp" value={f.phone} onChange={(e) => setF({ ...f, phone: maskPhone(e.target.value) })} className="sm:col-span-3" />
          <Input label="E-mail" value={f.email} onChange={set('email')} className="sm:col-span-3" />
          <Input label="CEP" value={f.cep} onChange={(e) => cep(e.target.value)} className="sm:col-span-2" />
          <Input label="Endereço" value={f.street} onChange={set('street')} className="sm:col-span-3" />
          <Input label="Número" value={f.number} onChange={set('number')} className="sm:col-span-1" />
          <Input label="Complemento" value={f.complement} onChange={set('complement')} className="sm:col-span-2" />
          <Input label="Bairro" value={f.district} onChange={set('district')} className="sm:col-span-2" />
          <Input label="Cidade" value={f.city} onChange={set('city')} className="sm:col-span-2" />
          <Input label="UF" value={f.uf} maxLength={2} onChange={(e) => setF({ ...f, uf: e.target.value.toUpperCase() })} className="sm:col-span-1" />
          <Input label="Código IBGE do município" value={f.city_code} onChange={set('city_code')} className="sm:col-span-2" hint="Preenchido pelo CEP. Necessário para NFS-e." />
          <Select label="Fuso horário" value={s.timezone} onChange={(e) => setS({ timezone: e.target.value })} className="sm:col-span-3">
            {['America/Sao_Paulo', 'America/Manaus', 'America/Cuiaba', 'America/Belem', 'America/Fortaleza', 'America/Recife', 'America/Bahia', 'America/Porto_Velho', 'America/Rio_Branco', 'America/Noronha'].map((z) => <option key={z}>{z}</option>)}
          </Select>
        </div>
      )}

      {tab === 'os' && (
        <div className="grid max-w-5xl gap-6 lg:grid-cols-2">
          <div className="card space-y-4 p-6">
            <h3 className="font-semibold">Padrões das ordens de serviço</h3>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Garantia padrão (dias)" type="number" min={0} value={o.defaultWarrantyDays} onChange={(e) => setO({ defaultWarrantyDays: +e.target.value })} />
              <Input label="Prazo padrão de entrega (dias)" type="number" min={0} value={o.defaultPromiseDays} onChange={(e) => setO({ defaultPromiseDays: +e.target.value })} />
              <Input label="Validade dos orçamentos (dias)" type="number" min={1} value={o.quoteValidityDays} onChange={(e) => setO({ quoteValidityDays: +e.target.value })} />
            </div>
            <Toggle checked={o.allowNegativeStock} onChange={(v) => setO({ allowNegativeStock: v })} label="Permitir lançar material sem saldo em estoque" hint="Útil quando a entrada da nota do fornecedor ainda não foi registrada." />
            <Toggle checked={o.requirePaymentToDeliver} onChange={(v) => setO({ requirePaymentToDeliver: v })} label="Exigir pagamento (ou parcelas lançadas) para entregar" />
            <Toggle checked={!!o.requireInspection} onChange={(v) => setO({ requireInspection: v })} label="Exigir inspeção final aprovada" hint="A OS só pode ficar pronta e ser entregue com checklist de inspeção aprovado." />
            <Toggle checked={!!o.requireReceiver} onChange={(v) => setO({ requireReceiver: v })} label="Exigir nome de quem recebeu na entrega" />
            <Input label="Duração padrão da visita técnica (min)" type="number" min={15} step={15} value={o.defaultVisitMinutes ?? 60} onChange={(e) => setO({ defaultVisitMinutes: +e.target.value })} />
            <Textarea label="Termos impressos na OS" rows={4} value={o.termsOrder} onChange={(e) => setO({ termsOrder: e.target.value })} />
            <Textarea label="Termos padrão dos orçamentos" rows={4} value={o.termsQuote} onChange={(e) => setO({ termsQuote: e.target.value })} />
          </div>
          <div className="card space-y-4 p-6">
            <h3 className="font-semibold">Orçamentos</h3>
            <Input label="Tributos estimados padrão (%)" type="number" min={0} max={100} step="0.01" value={s.quotes?.taxRate ?? 0} onChange={(e) => setS({ quotes: { ...s.quotes, taxRate: +e.target.value } })} hint="Usado só para calcular a margem estimada." />
            <Textarea label="Premissas padrão" rows={2} value={s.quotes?.assumptions || ''} onChange={(e) => setS({ quotes: { ...s.quotes, assumptions: e.target.value } })} />
            <Textarea label="Exclusões padrão" rows={2} value={s.quotes?.exclusions || ''} onChange={(e) => setS({ quotes: { ...s.quotes, exclusions: e.target.value } })} />
          </div>
          <div className="card space-y-4 p-6">
            <h3 className="font-semibold">Relacionamento (retornos automáticos)</h3>
            <div className="grid grid-cols-2 gap-3">
              {[['postSaleDays', 'Pós-venda após a entrega (dias)'], ['quoteFollowupDays', 'Retorno de orçamento enviado (dias)'], ['warrantyNoticeDays', 'Aviso antes do fim da garantia (dias)'],
                ['collectionDays', 'Cobrança após o vencimento (dias)'], ['maintenanceDays', 'Oferecer manutenção após (dias, 0 = não)']].map(([k, l]) => (
                <Input key={k} label={l} type="number" min={0} value={s.relationship?.[k] ?? 0} onChange={(e) => setS({ relationship: { ...s.relationship, [k]: +e.target.value } })} />
              ))}
            </div>
            <p className="text-xs text-ink-faint">O sistema só cria a lista de retornos; o contato é feito e registrado pela equipe.</p>
          </div>
          <ChecklistTemplates />
          <div className="card space-y-4 p-6">
            <h3 className="font-semibold">Numeração dos documentos</h3>
            <div className="grid grid-cols-2 gap-3">
              {[['request', 'Solicitação'], ['quote', 'Orçamento'], ['order', 'Ordem de serviço'], ['purchase', 'Entrada de materiais']].map(([k, l]) => (
                <Input key={k} label={`Prefixo — ${l}`} maxLength={6} value={s.numbering?.[k] ?? ''} onChange={(e) => setS({ numbering: { ...s.numbering, [k]: e.target.value.toUpperCase() } })} />
              ))}
              <Input label="Dígitos" type="number" min={1} max={8} value={s.numbering?.digits ?? 5} onChange={(e) => setS({ numbering: { ...s.numbering, digits: +e.target.value } })} />
            </div>
            <p className="text-xs text-ink-faint">Exemplo: {(s.numbering?.order || 'OS')}-{String(12).padStart(s.numbering?.digits || 5, '0')}. A sequência é única por empresa e nunca é reutilizada.</p>
          </div>
          <div className="card space-y-4 p-6">
            <h3 className="font-semibold">Mensagens de WhatsApp</h3>
            <Textarea label="Envio de orçamento" rows={3} value={s.whatsapp.quote} onChange={(e) => setS({ whatsapp: { ...s.whatsapp, quote: e.target.value } })} />
            <Textarea label="OS pronta para retirada" rows={3} value={s.whatsapp.ready} onChange={(e) => setS({ whatsapp: { ...s.whatsapp, ready: e.target.value } })} />
            <Textarea label="Atualização de andamento" rows={3} value={s.whatsapp.status} onChange={(e) => setS({ whatsapp: { ...s.whatsapp, status: e.target.value } })} />
            <p className="text-xs text-ink-faint">Variáveis: {'{cliente} {numero} {empresa} {equipamento} {total} {status} {link}'}</p>
          </div>
        </div>
      )}

      {tab === 'aparencia' && (
        <div className="grid max-w-5xl gap-6 lg:grid-cols-2">
          <div className="card space-y-6 p-6">
            <div>
              <span className="label">Cor principal</span>
              <div className="flex flex-wrap items-center gap-2">
                {PRESET_COLORS.map((c) => (
                  <button key={c} onClick={() => setS({ primaryColor: c })} className={cx('grid h-9 w-9 place-items-center rounded-full ring-offset-2 ring-offset-surface transition', s.primaryColor === c && 'ring-2 ring-ink')} style={{ background: c }}>
                    {s.primaryColor === c && <Check className="h-4 w-4 text-white" />}
                  </button>
                ))}
                <label className="relative h-9 w-9 cursor-pointer overflow-hidden rounded-full border border-dashed border-line" title="Cor personalizada">
                  <input type="color" value={s.primaryColor} onChange={(e) => setS({ primaryColor: e.target.value })} className="absolute -inset-2 h-14 w-14 cursor-pointer opacity-0" />
                  <Plus className="m-auto mt-2 h-4 w-4 text-ink-faint" />
                </label>
              </div>
            </div>
            <div>
              <span className="label">Tema padrão</span>
              <div className="grid grid-cols-3 gap-2">
                {[['light', 'Claro', Sun], ['dark', 'Escuro', Moon], ['system', 'Automático', Monitor]].map(([k, l, I]) => (
                  <button key={k} onClick={() => setS({ theme: k })} className={cx('btn border', s.theme === k ? 'border-primary bg-primary/10 text-primary' : 'border-line')}><I className="h-4 w-4" />{l}</button>
                ))}
              </div>
              <p className="mt-1 text-xs text-ink-faint">Cada usuário pode trocar o próprio tema no menu da conta.</p>
            </div>
            <div>
              <span className="label">Cantos</span>
              <div className="grid grid-cols-4 gap-2">
                {Object.entries({ none: 'Retos', md: 'Suaves', lg: 'Padrão', xl: 'Redondos' }).map(([k, l]) => (
                  <button key={k} onClick={() => setS({ radius: k })} className={cx('btn border', s.radius === k ? 'border-primary bg-primary/10 text-primary' : 'border-line')}
                    style={{ borderRadius: RADIUS[k] }}>{l}</button>
                ))}
              </div>
            </div>
            <Select label="Fonte" value={s.font || 'Inter'} onChange={(e) => setS({ font: e.target.value })}>
              {Object.keys(FONTS).map((k) => <option key={k} value={k}>{k}</option>)}
            </Select>
            <Select label="Densidade" value={s.density || 'comfortable'} onChange={(e) => setS({ density: e.target.value })}>
              <option value="comfortable">Confortável</option><option value="compact">Compacta</option>
            </Select>
            <div>
              <span className="label">Menu</span>
              <div className="grid grid-cols-2 gap-2">
                {[['top', 'Barra superior'], ['side', 'Menu lateral']].map(([k, l]) => (
                  <button key={k} onClick={() => setS({ layout: k })} className={cx('btn h-auto flex-col gap-2 border py-3', (s.layout || 'side') === k ? 'border-primary bg-primary/10 text-primary' : 'border-line')}>
                    <span className="flex h-10 w-16 overflow-hidden rounded border border-current/30">
                      {k === 'top'
                        ? <span className="flex w-full flex-col"><span className="h-2.5 w-full bg-current opacity-70" /><span className="flex-1" /></span>
                        : <span className="flex w-full"><span className="h-full w-3.5 bg-current opacity-70" /><span className="flex-1" /></span>}
                    </span>{l}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-xs text-ink-faint">Salve para aplicar o novo menu.</p>
            </div>
          </div>
          <div className="card p-6">
            <span className="label">Pré-visualização</span>
            <div className="mt-2 space-y-4 rounded-app border border-line bg-bg p-5">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-app-sm bg-primary font-semibold text-primary-fg">{(f.trade_name || f.name)?.[0]}</div>
                <div><div className="font-semibold">{f.trade_name || f.name}</div><div className="text-xs text-ink-faint">Assim ficará o seu sistema</div></div>
              </div>
              <div className="card p-4">
                <div className="text-xs text-ink-faint">OS entregues no mês</div>
                <div className="text-2xl font-semibold">R$ 48.920,00</div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full w-2/3 rounded-full bg-primary" /></div>
              </div>
              <div className="flex gap-2"><button className="btn-primary">Nova OS</button><button className="btn-outline">Cancelar</button></div>
              <input className="input" placeholder="Campo de texto" />
              <div className="flex gap-2"><span className="chip bg-primary/10 text-primary">Em execução</span><span className="chip bg-muted">Solda TIG</span></div>
            </div>
          </div>
        </div>
      )}

      {tab === 'financeiro' && (
        <div className="grid max-w-5xl gap-6 lg:grid-cols-2">
          <div className="card p-6">
            <h3 className="mb-3 font-semibold">Formas de pagamento</h3>
            <div className="space-y-2">
              {s.paymentMethods.map((m, i) => {
                const setM = (patch) => setS({ paymentMethods: s.paymentMethods.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
                return (
                  <div key={m.id} className="flex items-center gap-2">
                    <input type="checkbox" checked={m.active !== false} onChange={(e) => setM({ active: e.target.checked })} title="Ativa" />
                    <input className="input" value={m.name} onChange={(e) => setM({ name: e.target.value })} />
                    <div className="relative w-28 shrink-0">
                      <input className="input pr-14 tabular-nums" type="number" step="0.01" min={0} value={m.fee} onChange={(e) => setM({ fee: +e.target.value })} />
                      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-ink-faint">% taxa</span>
                    </div>
                    {m.id !== 'dinheiro' && <button className="btn-ghost btn-icon" onClick={() => setS({ paymentMethods: s.paymentMethods.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></button>}
                  </div>
                );
              })}
            </div>
            <button className="btn-ghost mt-2 text-primary" onClick={() => setS({ paymentMethods: [...s.paymentMethods, { id: `m${Date.now().toString(36)}`, name: 'Nova forma', fee: 0, active: true }] })}>
              <Plus className="h-4 w-4" /> Adicionar forma
            </button>
            <div className="mt-5 space-y-3 border-t border-line pt-5">
              <Toggle checked={s.cardFeesAsExpense} onChange={(v) => setS({ cardFeesAsExpense: v })} label="Lançar taxas de cartão automaticamente como despesa" />
              <Toggle checked={s.requireOpenCash} onChange={(v) => setS({ requireOpenCash: v })} label="Exigir caixa aberto para receber" />
            </div>
          </div>
          <div className="card space-y-5 p-6">
            <TagList label="Categorias de receita" value={s.incomeCategories} onChange={(v) => setS({ incomeCategories: v })} />
            <TagList label="Categorias de despesa" value={s.expenseCategories} onChange={(v) => setS({ expenseCategories: v })} />
          </div>
        </div>
      )}

      {tab === 'categorias' && (
        <div className="grid max-w-5xl gap-6 lg:grid-cols-3">
          <div className="card p-6"><TagList label="Tipos de serviço" value={s.serviceCategories} onChange={(v) => setS({ serviceCategories: v })} /></div>
          <div className="card p-6"><TagList label="Categorias de materiais" value={s.materialCategories} onChange={(v) => setS({ materialCategories: v })} /></div>
          <div className="card p-6"><TagList label="Tipos de equipamento / peça" value={s.equipmentCategories} onChange={(v) => setS({ equipmentCategories: v })} /></div>
        </div>
      )}

      {tab === 'fiscal' && <FiscalSetup />}
      {tab === 'perfis' && <PermissionsTab s={s} setS={setS} />}

      {tab === 'modulos' && (
        <div className="card max-w-2xl space-y-3 p-6">
          <p className="text-sm text-ink-faint">Ative apenas o que faz sentido para a sua oficina. Os itens desativados somem do menu.</p>
          <Toggle checked={s.modules.purchases} onChange={(v) => setS({ modules: { ...s.modules, purchases: v } })} label="Entrada de materiais" hint="Registro de notas de fornecedor com contas a pagar." />
          <Toggle checked={s.modules.invoices} onChange={(v) => setS({ modules: { ...s.modules, invoices: v } })} label="Notas fiscais" hint="Emissão de NFS-e e NF-e a partir das OS." />
          <Toggle checked={s.modules.commissions} onChange={(v) => setS({ modules: { ...s.modules, commissions: v } })} label="Comissões" hint="Técnicos podem ver as próprias comissões." />
          <Toggle checked={s.modules.publicLinks} onChange={(v) => setS({ modules: { ...s.modules, publicLinks: v } })} label="Links para o cliente" hint="Aprovação de orçamento e acompanhamento da OS pela internet." />
        </div>
      )}

      {tab === 'equipe' && <Team />}
      {tab === 'dados' && <DataExport />}

      {dirty && !['equipe', 'fiscal', 'dados'].includes(tab) && (
        <div className="action-bar">
          <div className="mx-auto flex max-w-[1400px] items-center justify-end gap-3 px-4 py-3 sm:px-8">
            <span className="mr-auto text-sm text-ink-soft">Você tem alterações não salvas.</span>
            <button className="btn-ghost" onClick={() => setF(structuredClone(company))}>Descartar</button>
            <button className="btn-primary" disabled={busy} onClick={save}>Salvar alterações</button>
          </div>
        </div>
      )}
    </div>
  );
}

function TagList({ label, value = [], onChange }) {
  const [text, setText] = useState('');
  const add = () => { const t = text.trim(); if (t && !value.includes(t)) onChange([...value, t]); setText(''); };
  return (
    <div>
      <span className="label">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {value.map((v) => (
          <span key={v} className="chip bg-muted py-1 text-ink-soft">{v}
            <button onClick={() => onChange(value.filter((x) => x !== v))} className="text-ink-faint hover:text-red-600">×</button></span>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <input className="input" placeholder="Nova categoria" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button className="btn-outline" onClick={add}>Adicionar</button>
      </div>
    </div>
  );
}

function Team() {
  const { user } = useAuth();
  const { technicians } = useCatalog();
  const { confirm } = useUI();
  const [run, busy] = useAction();
  const [list, setList] = useState([]);
  const [edit, setEdit] = useState(null);
  const [units, setUnits] = useState([]);
  const load = () => api.get('/users').then(setList);
  useEffect(() => { load(); api.get('/units').then((u) => setUnits(u.filter((x) => x.active))).catch(() => {}); }, []);
  const save = async () => {
    const body = { name: edit.name, email: edit.email, role: edit.role, technician_id: edit.technician_id || null, unit_id: edit.unit_id || null, active: edit.active ?? true, password: edit.password || undefined };
    const r = await run(() => (edit.id ? api.put(`/users/${edit.id}`, body) : api.post('/users', body)), 'Usuário salvo');
    if (r !== FAIL) { setEdit(null); load(); }
  };
  const remove = async (u) => {
    if (!(await confirm({ title: `Remover acesso de ${u.name}?`, confirmText: 'Remover' }))) return;
    if ((await run(() => api.del(`/users/${u.id}`), 'Acesso removido')) !== FAIL) load();
  };
  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-ink-faint">Cada usuário recebe um perfil (atendimento, orçamentista, técnico, financeiro…). O que cada perfil pode fazer é ajustável em Perfis de acesso.</p>
        <button className="btn-primary" onClick={() => setEdit({ role: 'attendant', active: true })}><Plus className="h-4 w-4" /> Novo acesso</button>
      </div>
      <div className="card divide-y divide-line">
        {list.map((u) => (
          <div key={u.id} className={cx('flex items-center gap-3 px-5 py-3', !u.active && 'opacity-50')}>
            <Avatar name={u.name} />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{u.name} {u.id === user.id && <span className="text-xs text-ink-faint">(você)</span>}</div>
              <div className="truncate text-xs text-ink-faint">{u.email}</div>
            </div>
            <span className="chip bg-muted text-ink-soft">{ROLES[u.role]}</span>
            {u.role !== 'owner' && <>
              <button className="btn-ghost h-8 text-xs" onClick={() => setEdit({ ...u, password: '' })}>Editar</button>
              {u.id !== user.id && <button className="btn-ghost btn-icon h-8 text-red-600" onClick={() => remove(u)}><Trash2 className="h-4 w-4" /></button>}
            </>}
          </div>
        ))}
      </div>
      {edit && (
        <Modal open onClose={() => setEdit(null)} title={edit.id ? 'Editar acesso' : 'Novo acesso'}
          footer={<><button className="btn-ghost" onClick={() => setEdit(null)}>Cancelar</button><button className="btn-primary" disabled={busy} onClick={save}>Salvar</button></>}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Nome" value={edit.name || ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            <Input label="E-mail (login)" type="email" value={edit.email || ''} onChange={(e) => setEdit({ ...edit, email: e.target.value })} />
            <Select label="Perfil" value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value })}>
              {Object.entries(ROLES).filter(([k]) => k !== 'owner').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
            <Select label="Unidade" value={edit.unit_id || ''} onChange={(e) => setEdit({ ...edit, unit_id: e.target.value })}>
              <option value="">Principal</option>{units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
            {!['admin', 'manager', 'finance', 'fiscal', 'purchasing', 'viewer'].includes(edit.role) && (
              <Select label="Vincular ao técnico" value={edit.technician_id || ''} onChange={(e) => setEdit({ ...edit, technician_id: e.target.value })}>
                <option value="">{edit.role === 'technician' ? 'Selecione…' : 'Nenhum'}</option>{technicians.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            )}
            <Input label={edit.id ? 'Nova senha (opcional)' : 'Senha'} type="password" value={edit.password || ''} onChange={(e) => setEdit({ ...edit, password: e.target.value })} />
            {edit.id && <div className="sm:col-span-2"><Toggle checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} label="Acesso ativo" /></div>}
          </div>
        </Modal>
      )}
    </div>
  );
}

function resizeImage(file, max) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/png'));
      URL.revokeObjectURL(img.src);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

const SCOPE_OPTS = {
  orders_view: [['all', 'Todas'], ['own', 'Só as próprias'], ['none', 'Nenhuma']],
  commissions: [['all', 'Todas'], ['own', 'Só as próprias'], ['none', 'Nenhuma']],
  time_log: [['all', 'De qualquer técnico'], ['own', 'Só as próprias horas'], ['none', 'Não aponta']],
};
const DEFAULT_SCOPE = [['all', 'Todos'], ['own', 'Só os próprios'], ['none', 'Nenhum']];

function PermissionsTab({ s, setS }) {
  const { permissionCatalog } = useAuth();
  const [role, setRole] = useState('attendant');
  const perms = s.permissions || {};
  const groups = permissionCatalog.reduce((g, p) => ({ ...g, [p.group]: [...(g[p.group] || []), p] }), {});
  const set = (key, v) => setS({ permissions: { ...perms, [role]: { ...perms[role], [key]: v } } });
  const roles = Object.entries(ROLES).filter(([k]) => k !== 'owner');
  const count = (r) => Object.values(perms[r] || {}).filter((v) => v === true || v === 'all' || v === 'own').length;
  return (
    <div className="grid max-w-5xl gap-6 lg:grid-cols-[240px_1fr]">
      <div className="space-y-1">
        <p className="mb-2 text-sm text-ink-faint">O <b>Proprietário</b> sempre tem acesso total. As regras valem para a API, não só para o menu.</p>
        {roles.map(([k, l]) => (
          <button key={k} onClick={() => setRole(k)} className={cx('flex w-full items-center justify-between rounded-app-sm px-3 py-2 text-left text-sm', role === k ? 'bg-primary/10 font-medium text-primary' : 'hover:bg-muted')}>
            {l}<span className="text-xs text-ink-faint">{count(k)}</span>
          </button>
        ))}
      </div>
      <div className="card divide-y divide-line">
        {Object.entries(groups).map(([g, items]) => (
          <div key={g} className="p-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-soft">{g}</div>
            <div className="space-y-1">
              {items.map((p) => (
                <div key={p.key} className="flex items-center justify-between gap-3 py-1 text-sm">
                  <span>{p.label}</span>
                  {p.type === 'scope' ? (
                    <select className="input h-8 w-40 text-xs" value={perms[role]?.[p.key] || 'none'} onChange={(e) => set(p.key, e.target.value)} aria-label={p.label}>
                      {(SCOPE_OPTS[p.key] || DEFAULT_SCOPE).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  ) : (
                    <input type="checkbox" aria-label={p.label} className="h-4 w-4 accent-[rgb(var(--primary))]" checked={!!perms[role]?.[p.key]} onChange={(e) => set(p.key, e.target.checked)} />
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
        <p className="p-4 text-xs text-ink-faint">Dica: para que um técnico veja “só as próprias OS”, vincule o usuário dele ao cadastro do técnico em Usuários. Salve para aplicar.</p>
      </div>
    </div>
  );
}


const CHECK_KIND = { recebimento: 'Recebimento', inspecao: 'Inspeção final', entrega: 'Entrega' };

function ChecklistTemplates() {
  const [run, busy] = useAction();
  const [list, setList] = useState([]);
  const [edit, setEdit] = useState(null);
  const load = () => api.get('/quality/templates?all=1').then(setList).catch(() => {});
  useEffect(() => { load(); }, []);
  const save = async () => {
    const body = { name: edit.name, kind: edit.kind, items: edit.text.split('\n').map((x) => x.trim()).filter(Boolean), active: edit.active !== false };
    const r = await run(() => (edit.id ? api.put(`/quality/templates/${edit.id}`, body) : api.post('/quality/templates', body)), 'Checklist salvo');
    if (r !== FAIL) { setEdit(null); load(); }
  };
  return (
    <div className="card space-y-3 p-6">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Checklists de qualidade</h3>
        <button className="btn-ghost h-8 text-xs text-primary" onClick={() => setEdit({ name: '', kind: 'inspecao', text: '', active: true })}><Plus className="h-3.5 w-3.5" /> Novo</button>
      </div>
      <ul className="divide-y divide-line text-sm">
        {list.map((t) => (
          <li key={t.id} className={cx('flex items-center gap-2 py-2', !t.active && 'opacity-50')}>
            <span className="chip bg-muted text-ink-soft">{CHECK_KIND[t.kind]}</span>
            <span className="flex-1">{t.name} <span className="text-xs text-ink-faint">· {t.items.length} itens</span></span>
            <button className="btn-ghost h-8 text-xs" onClick={() => setEdit({ ...t, text: t.items.join('\n') })}>Editar</button>
          </li>
        ))}
      </ul>
      {edit && (
        <Modal open onClose={() => setEdit(null)} title={edit.id ? 'Editar checklist' : 'Novo checklist'}
          footer={<><button className="btn-ghost" onClick={() => setEdit(null)}>Voltar</button><button className="btn-primary" disabled={busy || edit.name.trim().length < 2 || !edit.text.trim()} onClick={save}>Salvar</button></>}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Nome" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            <Select label="Uso" value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value })}>{Object.entries(CHECK_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
            <Textarea label="Itens (um por linha)" rows={8} value={edit.text} onChange={(e) => setEdit({ ...edit, text: e.target.value })} className="sm:col-span-2" />
            <div className="sm:col-span-2"><Toggle checked={edit.active !== false} onChange={(v) => setEdit({ ...edit, active: v })} label="Ativo" /></div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function DataExport() {
  const { toast } = useUI();
  const [list, setList] = useState([]);
  const [busy, setBusy] = useState('');
  useEffect(() => { api.get('/export').then(setList).catch(() => {}); }, []);
  const download = async (path, filename) => {
    setBusy(path);
    try {
      const res = await fetch(`${apiBase}${path}`, { headers: { Authorization: `Bearer ${getToken()}` } });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Falha ao exportar.');
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  };
  return (
    <div className="max-w-4xl space-y-4">
      <div className="card flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <h3 className="font-semibold">Cópia completa dos dados (JSON)</h3>
          <p className="text-sm text-ink-faint">Todas as tabelas da empresa em um arquivo. Não inclui senhas, tokens fiscais nem certificados. Fica registrado na auditoria.</p>
        </div>
        <button className="btn-primary" disabled={!!busy} onClick={() => download('/export/backup.json', `torven-backup-${new Date().toISOString().slice(0, 10)}.json`)}>Baixar cópia</button>
      </div>
      <div className="card p-5">
        <h3 className="mb-3 font-semibold">Planilhas (CSV) por assunto</h3>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((x) => (
            <button key={x.key} className="btn-outline justify-start" disabled={!!busy} onClick={() => download(`/export/${x.key}.csv`, `torven-${x.key}.csv`)}>{busy === `/export/${x.key}.csv` ? 'Gerando…' : x.label}</button>
          ))}
        </div>
      </div>
    </div>
  );
}
