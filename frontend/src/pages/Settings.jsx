import { Fragment, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Upload, Trash2, Plus, Check, Sun, Moon, Monitor } from 'lucide-react';
import { api, apiBase, getToken } from '../lib/api';
import { ROLES, maskPhone, maskDoc, maskCep, lookupCep } from '../lib/format';
import { applyTheme, PRESET_COLORS, RADIUS, FONTS } from '../lib/theme';
import { useAuth } from '../context/AuthContext';
import { useCatalog } from '../context/CatalogContext';
import FiscalEmitters from '../components/FiscalEmitters';
import IntegrationsSetup from '../components/IntegrationsSetup';
import { ChecklistsSettings, OrderTypesTab } from '../components/OrderTypes';
import { OrderDocument, SAMPLE_ORDER, docConfig } from '../components/DocumentTemplate';
import { useUI } from '../context/UIContext';
import { PageHeader, Tabs, Input, Textarea, Select, Toggle, Modal, Avatar, useAction, FAIL, cx } from '../components/ui';

export default function Settings() {
  const { company, setCompany, user, can } = useAuth();
  const full = can('settings');
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || (full ? 'empresa' : can('fiscal_settings') ? 'fiscal' : can('integrations') && !can('users') ? 'integracoes' : 'perfis');
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
        ...(full ? [{ value: 'empresa', label: 'Empresa' }, { value: 'aparencia', label: 'Aparência' }, { value: 'os', label: 'OS e orçamentos' }, { value: 'tipos-os', label: 'Tipos de OS' }, { value: 'checklists', label: 'Checklists' }, { value: 'documentos', label: 'Documentos (OS impressa)' },
          { value: 'financeiro', label: 'Financeiro' }, { value: 'categorias', label: 'Categorias' }] : []),
        ...(can('fiscal_settings') ? [{ value: 'fiscal', label: 'Fiscal (NF-e / NFS-e)' }] : []),
        ...(can('integrations') ? [{ value: 'integracoes', label: 'Integrações' }] : []),
        ...(full ? [{ value: 'modulos', label: 'Módulos' }] : []),
        ...(can('users') ? [{ value: 'perfis', label: 'Perfis de acesso' }, { value: 'equipe', label: 'Usuários' }] : []),
        ...(can('data_export') ? [{ value: 'dados', label: 'Dados e exportação' }] : []),
      ]} />

      {tab === 'empresa' && (
        <div className="card grid max-w-4xl gap-4 p-6 sm:grid-cols-6">
          <div className="sm:col-span-6"><LogoUpload value={f.logo_url} onChange={(v) => setF({ ...f, logo_url: v })} /></div>
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
            <Toggle checked={o.voiceCommands !== false} onChange={(v) => setO({ voiceCommands: v })} label="Comandos de voz"
              hint="Botão de microfone para abrir OS e apontar horas falando. Sempre pede confirmação antes de executar." />
            <Toggle checked={o.voiceDictation !== false} onChange={(v) => setO({ voiceDictation: v })} label="Ditado por voz nos campos de texto"
              hint="Microfone dentro dos campos da OS e das solicitações (relato, acessórios, diagnóstico, observações), no computador e no celular." />
            <Toggle checked={o.plateOnOpen !== false} onChange={(v) => setO({ plateOnOpen: v })} label="Pesquisa por placa na abertura da OS"
              hint="Foto ou digitação da placa: mostra os dados do veículo e coloca o proprietário como cliente. A consulta paga é configurada em Integrações." />
            {o.plateOnOpen !== false && (
              <Toggle checked={!!o.plateAutoLookup} onChange={(v) => setO({ plateAutoLookup: v })} label="Consultar o serviço de placas automaticamente"
                hint="Placa fora do cadastro: busca marca/modelo sem pedir clique. Cada consulta nova conta no limite mensal do serviço pago." />
            )}
            <Toggle checked={o.uniqueVehicle !== false} onChange={(v) => setO({ uniqueVehicle: v })} label="Um único cadastro por veículo"
              hint="Impede cadastrar a mesma placa em dois clientes. Desligue se a mesma placa puder aparecer em mais de um cadastro (ex.: frota e motorista)." />
            <Select label="Maquininha ao fechar a OS" value={o.terminalOnClose || 'perguntar'} onChange={(e) => setO({ terminalOnClose: e.target.value })}
              hint="Automático: na entrega, envia o saldo para a maquininha padrão e entrega quando o pagamento for aprovado.">
              <option value="perguntar">Oferecer a opção na entrega</option>
              <option value="automatico">Enviar automaticamente para a maquininha padrão</option>
              <option value="desligado">Não usar maquininha integrada</option>
            </Select>
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
          <div className="card flex flex-wrap items-center gap-3 p-5 text-sm lg:col-span-2">
            <span className="min-w-0 flex-1"><b>Tipos de OS e checklists</b> agora têm abas próprias.</span>
            <button className="btn-outline h-8 text-xs" onClick={() => setTab('tipos-os')}>Tipos de OS</button>
            <button className="btn-outline h-8 text-xs" onClick={() => setTab('checklists')}>Checklists</button>
          </div>
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
            <LogoUpload value={f.logo_url} onChange={(v) => setF({ ...f, logo_url: v })} />
            {f.logo_url && (
              <div className="space-y-3">
                <div>
                  <span className="label">Formato do logo no sistema</span>
                  <div className="grid grid-cols-2 gap-2">
                    {[['square', 'Quadrado (ícone)'], ['wide', 'Horizontal (largo)']].map(([k, l]) => (
                      <button key={k} type="button" onClick={() => setS({ brand: { ...s.brand, logoShape: k } })}
                        className={cx('btn border', (s.brand?.logoShape || 'square') === k ? 'border-primary bg-primary/10 text-primary' : 'border-line')}>{l}</button>
                    ))}
                  </div>
                </div>
                <Toggle checked={s.brand?.showName !== false} onChange={(v) => setS({ brand: { ...s.brand, showName: v } })}
                  label="Mostrar o nome da empresa ao lado do logo" hint="Desligue quando o logo já traz o nome escrito." />
              </div>
            )}
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
                {f.logo_url
                  ? <img src={f.logo_url} alt="" className={cx('h-10 rounded-app-sm bg-white object-contain', s.brand?.logoShape === 'wide' ? 'w-auto max-w-[160px] px-1' : 'w-10')} />
                  : <div className="grid h-10 w-10 place-items-center rounded-app-sm bg-primary font-semibold text-primary-fg">{(f.trade_name || f.name)?.[0]}</div>}
                <div>{(!f.logo_url || s.brand?.showName !== false) && <div className="font-semibold">{f.trade_name || f.name}</div>}<div className="text-xs text-ink-faint">Assim ficará o seu sistema</div></div>
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

      {tab === 'documentos' && <DocumentsTab f={f} setF={setF} s={s} setS={setS} goTab={setTab} />}

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

      {tab === 'tipos-os' && <OrderTypesTab />}
      {tab === 'checklists' && <ChecklistsSettings />}
      {tab === 'fiscal' && <FiscalEmitters />}
      {tab === 'integracoes' && <IntegrationsSetup />}
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

      {dirty && !['equipe', 'fiscal', 'dados', 'integracoes'].includes(tab) && (
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
            <Input label={edit.id ? 'Nova senha (opcional)' : 'Senha'} type="password" autoComplete="new-password" hint={edit.id ? 'Ao redefinir, as sessões abertas desse usuário são encerradas. Mínimo de 10 caracteres, com letras e números.' : 'Mínimo de 10 caracteres, com letras e números'} value={edit.password || ''} onChange={(e) => setEdit({ ...edit, password: e.target.value })} />
            {edit.id && <div className="sm:col-span-2"><Toggle checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} label="Acesso ativo" /></div>}
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Logo: reduz mantendo a proporção (PNG com transparência; se ficar grande, WEBP e por fim JPG). */
function resizeImage(file, max) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * scale)); c.height = Math.max(1, Math.round(img.height * scale));
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, c.width, c.height);
      let out = c.toDataURL('image/png');
      if (out.length > 600000) {
        const webp = c.toDataURL('image/webp', 0.9);
        if (webp.startsWith('data:image/webp') && webp.length <= 600000) out = webp;
        else {
          ctx.globalCompositeOperation = 'destination-over'; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
          out = c.toDataURL('image/jpeg', 0.85);
        }
      }
      URL.revokeObjectURL(img.src);
      resolve(out);
    };
    img.onerror = () => reject(new Error('imagem inválida'));
    img.src = URL.createObjectURL(file);
  });
}

/** Envio do logotipo: mostra a imagem inteira (sem cortar) sobre fundo quadriculado. */
function LogoUpload({ value, onChange }) {
  const [err, setErr] = useState('');
  return (
    <div>
      <span className="label">Logotipo</span>
      <div className="flex flex-wrap items-center gap-4">
        <div className="grid h-20 w-40 place-items-center overflow-hidden rounded-app border border-line"
          style={{ backgroundImage: 'linear-gradient(45deg,#e5e7eb 25%,transparent 25%,transparent 75%,#e5e7eb 75%),linear-gradient(45deg,#e5e7eb 25%,transparent 25%,transparent 75%,#e5e7eb 75%)',
            backgroundSize: '16px 16px', backgroundPosition: '0 0,8px 8px', backgroundColor: '#fff' }}>
          {value ? <img src={value} alt="Logotipo atual" className="max-h-[72px] max-w-[150px] object-contain" /> : <span className="text-xs text-zinc-500">sem logo</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="btn-outline cursor-pointer"><Upload className="h-4 w-4" /> {value ? 'Trocar logo' : 'Enviar logo'}
            <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" aria-label="Arquivo do logotipo"
              onChange={async (e) => {
                const file = e.target.files?.[0]; e.target.value = '';
                if (!file) return;
                setErr('');
                try { onChange(await resizeImage(file, 640)); } catch { setErr('Não consegui abrir esta imagem. Use PNG, JPG ou WEBP.'); }
              }} />
          </label>
          {value && <button type="button" className="btn-ghost text-red-600" onClick={() => onChange(null)}><Trash2 className="h-4 w-4" /> Remover</button>}
        </div>
      </div>
      <p className="mt-1 text-xs text-ink-faint">PNG com fundo transparente fica melhor. Aparece no sistema, nas OS, recibos e orçamentos impressos e nos links do cliente.</p>
      {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
    </div>
  );
}

const DOC_FIELDS = [
  ['status', 'Situação da OS'], ['technician', 'Técnico'], ['promised', 'Prazo de entrega'], ['warranty', 'Garantia'],
  ['problem', 'Problema relatado'], ['accessories', 'Acessórios deixados'], ['condition', 'Estado na entrada'], ['diagnosis', 'Diagnóstico'],
  ['solution', 'Serviço executado'], ['values', 'Valores (itens e total)'], ['notes', 'Observações'], ['terms', 'Termos e condições'],
  ['signatures', 'Assinaturas'], ['document', 'CNPJ/CPF da empresa'], ['address', 'Endereço da empresa'],
];
const DOC_COLORS = ['#111827', '#1d4ed8', '#0f766e', '#15803d', '#b91c1c', '#ea580c', '#7c3aed', '#be185d'];

/** Configurações › Documentos: parametrização da OS impressa, recibo e orçamento, com pré-visualização ao vivo. */
function DocumentsTab({ f, setF, s, setS, goTab }) {
  const d = docConfig(s);
  const [sample, setSample] = useState('os');
  // a folha A4 (794 px) é reduzida para caber na largura disponível (celular incluso)
  const boxRef = useRef(null);
  const [boxW, setBoxW] = useState(800);
  useEffect(() => {
    const el = boxRef.current; if (!el) return undefined;
    const ro = new ResizeObserver(([e]) => setBoxW(e.contentRect.width));
    ro.observe(el); return () => ro.disconnect();
  }, []);
  const zoom = d.paper === 'cupom80' ? Math.min(1, (boxW - 8) / 302) : Math.min(0.62, (boxW - 8) / 794);
  const setD = (patch) => setS({ documents: { ...(s.documents || {}), ...patch } });
  const setShow = (k, v) => setD({ show: { ...d.show, [k]: v } });
  const setTitle = (k, v) => setD({ titles: { ...d.titles, [k]: v } });
  const Choice = ({ value, onChange, options }) => (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map(([k, l]) => (
        <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)}
          className={cx('btn h-auto min-h-9 border px-2 py-1.5 text-sm', value === k ? 'border-primary bg-primary/10 text-primary' : 'border-line')}>{l}</button>
      ))}
    </div>
  );
  return (
    <div className="grid max-w-[1400px] gap-6 xl:grid-cols-[minmax(0,30rem)_minmax(0,1fr)]">
      <div className="space-y-6">
        <div className="card space-y-5 p-6">
          <h2 className="font-semibold">Identidade no documento</h2>
          <LogoUpload value={f.logo_url} onChange={(v) => setF({ ...f, logo_url: v })} />
          <div className="grid gap-4 sm:grid-cols-2">
            <div><span className="label">Posição do logo</span><Choice value={d.logoPosition} onChange={(v) => setD({ logoPosition: v })} options={[['left', 'Esquerda'], ['center', 'Centro']]} /></div>
            <div><span className="label">Tamanho do logo</span><Choice value={d.logoSize} onChange={(v) => setD({ logoSize: v })} options={[['p', 'P'], ['m', 'M'], ['g', 'G']]} /></div>
          </div>
          <div><span className="label">Cabeçalho</span>
            <Choice value={d.headerStyle} onChange={(v) => setD({ headerStyle: v })} options={[['linha', 'Com linha'], ['faixa', 'Faixa colorida'], ['simples', 'Simples']]} /></div>
          <div>
            <span className="label">Cor de destaque</span>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => setD({ accentColor: '' })}
                className={cx('btn h-9 border px-3 text-xs', !s.documents?.accentColor ? 'border-primary bg-primary/10 text-primary' : 'border-line')}>
                <span className="h-4 w-4 rounded-full" style={{ background: s.primaryColor }} /> Cor do sistema
              </button>
              {DOC_COLORS.map((c) => (
                <button key={c} type="button" aria-label={`Cor ${c}`} onClick={() => setD({ accentColor: c })}
                  className={cx('grid h-9 w-9 place-items-center rounded-full ring-offset-2 ring-offset-surface', s.documents?.accentColor === c && 'ring-2 ring-ink')} style={{ background: c }}>
                  {s.documents?.accentColor === c && <Check className="h-4 w-4 text-white" />}
                </button>
              ))}
              <label className="relative h-9 w-9 cursor-pointer overflow-hidden rounded-full border border-dashed border-line" title="Cor personalizada">
                <input type="color" value={d.accent} onChange={(e) => setD({ accentColor: e.target.value })} className="absolute -inset-2 h-14 w-14 cursor-pointer opacity-0" aria-label="Cor personalizada do documento" />
                <Plus className="m-auto mt-2 h-4 w-4 text-ink-faint" />
              </label>
            </div>
          </div>
          <div><span className="label">Fonte do documento</span>
            <Choice value={d.font} onChange={(v) => setD({ font: v })} options={[['sistema', 'Igual ao sistema'], ['serifada', 'Serifada (clássica)']]} /></div>
        </div>

        <div className="card space-y-5 p-6">
          <h2 className="font-semibold">Papel e textos</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><span className="label">Papel da OS e do recibo</span>
              <Choice value={d.paper} onChange={(v) => setD({ paper: v })} options={[['a4', 'A4'], ['cupom80', 'Cupom 80 mm']]} /></div>
            <div><span className="label">Vias por impressão</span>
              <Choice value={Number(d.copies) === 2 ? 2 : 1} onChange={(v) => setD({ copies: v })} options={[[1, '1 via'], [2, '2 vias']]} /></div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Título da OS" value={d.titles.os} maxLength={40} onChange={(e) => setTitle('os', e.target.value)} className="sm:col-span-2" />
            <Input label="Título do recibo" value={d.titles.receipt} maxLength={40} onChange={(e) => setTitle('receipt', e.target.value)} />
            <Input label="Título do orçamento" value={d.titles.quote} maxLength={40} onChange={(e) => setTitle('quote', e.target.value)} />
          </div>
          <Input label="Nome do quadro do objeto" value={d.equipmentLabel} maxLength={40} placeholder="Ex.: Veículo, Equipamento, Peça"
            onChange={(e) => setD({ equipmentLabel: e.target.value })} />
          <Input label="Linha extra no cabeçalho" value={d.headerNote} maxLength={140} placeholder="Ex.: Soldas especiais desde 1998"
            onChange={(e) => setD({ headerNote: e.target.value })} />
          <Textarea label="Rodapé" rows={2} value={d.footerNote} maxLength={300} placeholder="Ex.: www.suaempresa.com.br · PIX: CNPJ · @suaempresa"
            onChange={(e) => setD({ footerNote: e.target.value })} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Assinatura da empresa" value={d.signatureCompany} maxLength={80} placeholder={f.trade_name || f.name}
              onChange={(e) => setD({ signatureCompany: e.target.value })} />
            <Input label="Texto na assinatura do cliente" value={d.signatureCustomer} maxLength={80}
              onChange={(e) => setD({ signatureCustomer: e.target.value })} />
          </div>
          <p className="text-xs text-ink-faint">Os termos impressos ficam em <button type="button" className="text-primary hover:underline" onClick={() => goTab('os')}>OS e orçamentos</button>.</p>
        </div>

        <div className="card p-6">
          <h2 className="mb-3 font-semibold">O que aparece na OS</h2>
          <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
            {DOC_FIELDS.map(([k, l]) => (
              <label key={k} className="flex cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" checked={d.show[k] !== false} onChange={(e) => setShow(k, e.target.checked)} className="h-4 w-4 accent-primary" /> {l}
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="card min-w-0 p-4 sm:p-6 xl:sticky xl:top-20 xl:self-start">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="label mb-0">Pré-visualização</span>
          <div className="ml-auto flex gap-1">
            {[['os', 'OS'], ['recibo', 'Recibo']].map(([k, l]) => (
              <button key={k} type="button" aria-pressed={sample === k} onClick={() => setSample(k)}
                className={cx('btn h-8 border px-3 text-xs', sample === k ? 'border-primary bg-primary/10 text-primary' : 'border-line')}>{l}</button>
            ))}
          </div>
        </div>
        <div ref={boxRef} className="max-h-[78vh] overflow-auto rounded-app border border-line bg-zinc-200 p-3" aria-label="Pré-visualização do documento">
          <div className={cx('mx-auto bg-white text-zinc-900 shadow', d.paper === 'cupom80' ? 'w-[80mm] p-[4mm]' : 'w-[210mm] p-[12mm]')}
            style={{ zoom }}>
            <OrderDocument company={f} o={{ ...SAMPLE_ORDER, ...(sample === 'recibo' ? { status: 'entregue' } : {}) }} settings={s} receipt={sample === 'recibo'} />
          </div>
        </div>
        <p className="mt-2 text-xs text-ink-faint">Exemplo com dados fictícios. Salve para usar nas próximas impressões.</p>
      </div>
    </div>
  );
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
                    <input type="checkbox" aria-label={p.label} className="h-4 w-4 accent-primary" checked={!!perms[role]?.[p.key]} onChange={(e) => set(p.key, e.target.checked)} />
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
