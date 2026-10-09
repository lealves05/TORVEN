import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { addDays, format } from 'date-fns';
import { Save, Wrench, MapPin, RotateCcw, Car } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useCatalog } from '../context/CatalogContext';
import { PageHeader, Input, Select, MoneyInput, ActionButton, Hint, highlight, useAction, FAIL, cx } from '../components/ui';
import { money } from '../lib/format';
import CustomerPicker, { EquipmentPicker } from '../components/CustomerPicker';
import PlateCapture from '../components/PlateCapture';
import ItemsEditor, { cleanItems } from '../components/ItemsEditor';
import VoiceTextarea from '../components/VoiceTextarea';
import { useOrderTypes, OrderTypeSelect, CHECK_KIND } from '../components/OrderTypes';

export default function OrderNew() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { company, setCompany, can, user } = useAuth();
  const { technicians, services } = useCatalog();
  const showValues = can('orders_values');
  const cfg = company.settings.orders;
  const [run, busy] = useAction();
  const [customer, setCustomer] = useState(null);
  const [f, setF] = useState({
    equipment_id: null, equipment: null, technician_id: user.technician_id || '', priority: 'normal', service_location: 'oficina',
    service_address: '', promised_at: format(addDays(new Date(), cfg.defaultPromiseDays || 3), "yyyy-MM-dd'T'18:00"),
    problem: '', accessories: '', condition: '', notes: '', internal_notes: '', items: [], discount: 0,
    warranty_days: cfg.defaultWarrantyDays, status: 'aberta', order_type_id: null,
  });
  const orderTypes = useOrderTypes();
  const [typeChecklists, setTypeChecklists] = useState([]);
  useEffect(() => {
    if (!f.order_type_id) { setTypeChecklists([]); return; }
    api.get(`/quality/templates?order_type_id=${f.order_type_id}`)
      .then((l) => setTypeChecklists(l.filter((t) => t.order_type_id === f.order_type_id))).catch(() => setTypeChecklists([]));
  }, [f.order_type_id]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));
  // foco automático só no computador: no celular o teclado e a lista cobririam o formulário
  const desktop = typeof window !== 'undefined' && window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;

  // serviço principal: um item do tipo serviço marcado (_main) na lista — o valor vem do cadastro e pode ser editado
  const mainIdx = f.items.findIndex((i) => i._main);
  const main = mainIdx >= 0 ? f.items[mainIdx] : null;
  const mainSvc = main && services.find((x) => x.id === main.service_id);
  const chooseService = (id) => setF((x) => {
    const rest = x.items.filter((i) => !i._main);
    const svc = services.find((v) => v.id === id);
    if (!svc) return { ...x, items: rest };
    const item = { kind: 'servico', service_id: svc.id, description: svc.name, unit: svc.unit, unit_price: Number(svc.price) || 0,
      unit_cost: svc.cost ?? 0, qty: 1, discount: 0, technician_id: null, _main: true };
    return { ...x, items: [item, ...rest] };
  });
  const setMainPrice = (v) => setF((x) => ({ ...x, items: x.items.map((i) => (i._main ? { ...i, unit_price: v } : i)) }));

  useEffect(() => {
    const id = params.get('cliente');
    if (id) api.get(`/customers/${id}`).then(setCustomer).catch(() => {});
  }, [params]);

  // comando de voz ("abrir ordem de serviço para João, placa ABC1D23, problema …"): preenche o que foi falado
  const [voice] = useState(() => { try { return JSON.parse(params.get('voz') || 'null'); } catch { return null; } });
  useEffect(() => {
    if (!voice) return;
    setF((x) => ({ ...x, problem: voice.problem || x.problem, priority: voice.priority || x.priority }));
    if (voice.customer && !voice.plate) {
      api.get(`/customers?search=${encodeURIComponent(voice.customer)}&limit=2`).then((l) => { if (l.length === 1) setCustomer(l[0]); }).catch(() => {});
    }
  }, [voice]);

  /** Veículo escolhido/cadastrado pela placa: preenche cliente e objeto de serviço. */
  const usePlate = async ({ customer_id, equipment_id }) => {
    const c = await api.get(`/customers/${customer_id}`).catch(() => null);
    if (c) setCustomer(c);
    setF((x) => ({ ...x, equipment_id, equipment: null }));
  };
  const clearPlate = () => setF((x) => ({ ...x, equipment_id: null, equipment: null }));

  // liga/desliga a pesquisa por placa direto na tela (grava nas configurações da empresa)
  const plateOn = cfg.plateOnOpen !== false;
  const togglePlate = async () => {
    const r = await run(() => api.put('/company', { settings: { orders: { ...cfg, plateOnOpen: !plateOn } } }),
      plateOn ? 'Pesquisa por placa desligada' : 'Pesquisa por placa ligada');
    if (r !== FAIL) setCompany(r);
  };

  const save = async () => {
    const body = {
      ...f, kind: 'os', customer_id: customer?.id, technician_id: f.technician_id || null,
      promised_at: f.promised_at ? new Date(f.promised_at).toISOString() : null,
      equipment: f.equipment?.description ? f.equipment : null, items: cleanItems(f.items), warranty_days: Number(f.warranty_days) || 0,
    };
    const r = await run(() => api.post('/orders', body), 'OS aberta');
    // com checklist de recebimento no tipo, a OS já abre com ele na tela para preencher
    const receive = typeChecklists.some((t) => t.kind === 'recebimento') && (can('orders_edit') || can('orders_create') || can('inspections'));
    if (r !== FAIL) nav(`/os/${r.id}${receive ? '?checklist=recebimento' : ''}`, { replace: true });
  };

  return (
    <div className="pb-2">
      <PageHeader title="Nova ordem de serviço" subtitle="Registre o que o cliente trouxe e o problema relatado" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <section className="card space-y-4 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold">Cliente e equipamento</h2>
              {can('settings') && (
                <button type="button" role="switch" aria-checked={plateOn} disabled={busy} onClick={togglePlate}
                  title="Liga ou desliga a pesquisa por placa na abertura da OS (vale para toda a empresa)"
                  className="ml-auto inline-flex items-center gap-2 rounded-full border border-line px-3 py-1 text-xs text-ink-soft hover:border-primary">
                  <Car className="h-3.5 w-3.5" /> Pesquisa por placa
                  <span className={cx('relative h-4 w-7 rounded-full transition', plateOn ? 'bg-primary' : 'bg-line')}>
                    <span className={cx('absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition', plateOn ? 'left-[14px]' : 'left-0.5')} />
                  </span>
                  <b className={plateOn ? 'text-primary' : ''}>{plateOn ? 'ligada' : 'desligada'}</b>
                </button>
              )}
            </div>
            {plateOn && <PlateCapture onSelect={usePlate} onClear={clearPlate} customer={customer} autoLookup={!!cfg.plateAutoLookup} initialPlate={voice?.plate} autoFocus={!voice && desktop} />}
            <div id="campo-cliente">
              <CustomerPicker value={customer} onChange={(c) => { setCustomer(c); setF((x) => ({ ...x, equipment_id: null, equipment: null })); }}
                autoFocus={!voice && !plateOn && desktop} initialText={!customer && voice?.customer && !voice?.plate ? voice.customer : undefined} />
            </div>
            <div id="campo-equipamento"><EquipmentPicker customerId={customer?.id} value={f.equipment_id} onChange={set('equipment_id')}
              newEquipment={f.equipment} onNewEquipment={(e) => setF((x) => ({ ...x, equipment: e }))} /></div>
          </section>

          <section className="card space-y-4 p-5">
            <h2 className="font-semibold">Relato e recebimento</h2>
            {orderTypes?.length > 0 && (
              <div id="campo-tipo-os" className="space-y-1.5">
                <OrderTypeSelect types={orderTypes} value={f.order_type_id} onChange={(v) => setF((x) => ({ ...x, order_type_id: v }))} />
                {typeChecklists.length > 0 && (
                  <p className="text-xs text-ink-faint">
                    Checklists deste tipo: {typeChecklists.map((t) => `${t.name} (${CHECK_KIND[t.kind]}${t.required ? ', obrigatório' : ''})`).join(' · ')}
                  </p>
                )}
              </div>
            )}
            {orderTypes?.length === 0 && can('settings') && (
              <p className="rounded-app-sm bg-sky-500/10 p-3 text-sm text-sky-800 dark:text-sky-200" data-testid="sem-tipos-os">
                Os tipos de OS prontos (com checklists) ficam ocultos até você escolher o ramo da oficina.{' '}
                <Link className="font-medium underline" to="/configuracoes?tab=tipos-os">Escolher o ramo da oficina</Link>
              </p>
            )}
            <VoiceTextarea label="Problema relatado / serviço solicitado" rows={3} value={f.problem} onChange={set('problem')}
              placeholder="Ex.: trinca na longarina, portão arrastando, máquina não abre arco…" />
            <div className="grid gap-4 sm:grid-cols-2">
              <VoiceTextarea label="Acessórios deixados" rows={2} value={f.accessories} onChange={set('accessories')} placeholder="Tocha, garra, cabo obra, cilindro…" />
              <VoiceTextarea label="Estado / condições do item" rows={2} value={f.condition} onChange={set('condition')} placeholder="Riscos, amassados, peças faltando…" />
            </div>
          </section>

          <section className="card space-y-4 p-5">
            <div>
              <h2 className="font-semibold">Serviços e materiais</h2>
              <p className="text-xs text-ink-faint">Opcional agora — você pode lançar depois do diagnóstico. Materiais baixam do estoque.</p>
            </div>
            <div className={cx('grid gap-4 rounded-app-sm border border-line bg-muted/30 p-3', showValues && 'sm:grid-cols-[1fr_12rem]')}>
              <Select label="Serviço principal" aria-label="Serviço" value={main?.service_id || ''} onChange={(e) => chooseService(e.target.value)}>
                <option value="">Selecione um serviço cadastrado (opcional)</option>
                {services.filter((x) => x.active !== false).map((x) => (
                  <option key={x.id} value={x.id}>{x.name}{showValues && x.price != null ? ` — ${money(x.price)}` : ''}</option>
                ))}
              </Select>
              {showValues && (
                <div>
                  <MoneyInput label="Valor do serviço" value={main ? main.unit_price : ''} onChange={setMainPrice} disabled={!main}
                    placeholder={main ? '' : 'escolha o serviço'} aria-label="Valor do serviço" />
                  {mainSvc && Number(main.unit_price) !== Number(mainSvc.price) ? (
                    <button type="button" title="Voltar ao valor da tabela" className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline" onClick={() => setMainPrice(Number(mainSvc.price) || 0)}>
                      <RotateCcw className="h-3 w-3" /> Tabela: {money(mainSvc.price)}
                    </button>
                  ) : main && <p className="mt-1 text-xs text-ink-faint">Valor da tabela — pode ser alterado</p>}
                </div>
              )}
            </div>
            <ItemsEditor items={f.items} onChange={set('items')} discount={f.discount} onDiscount={set('discount')} showTechnician hideValues={!can('orders_values')} editCost={can('orders_values')} showCost={can('orders_values')} />
          </section>
        </div>

        <div className="space-y-6">
          <section className="card space-y-4 p-5">
            <h2 className="font-semibold">Execução</h2>
            <Select label="Técnico responsável" value={f.technician_id} onChange={set('technician_id')}>
              <option value="">A definir</option>
              {technicians.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
            <div>
              <span className="label">Prioridade</span>
              <div className="grid grid-cols-4 gap-1">
                {[['baixa', 'Baixa'], ['normal', 'Normal'], ['alta', 'Alta'], ['urgente', 'Urgente']].map(([k, l]) => (
                  <button key={k} type="button" onClick={() => setF({ ...f, priority: k })}
                    className={cx('btn h-8 border px-1 text-xs', f.priority === k ? (k === 'urgente' ? 'border-red-500 bg-red-500/10 text-red-600' : 'border-primary bg-primary/10 text-primary') : 'border-line')}>{l}</button>
                ))}
              </div>
            </div>
            <div>
              <span className="label">Local do serviço</span>
              <div className="grid grid-cols-2 gap-2">
                {[['oficina', 'Na oficina', Wrench], ['externo', 'Externo', MapPin]].map(([k, l, I]) => (
                  <button key={k} type="button" onClick={() => setF({ ...f, service_location: k })}
                    className={cx('btn border', f.service_location === k ? 'border-primary bg-primary/10 text-primary' : 'border-line')}><I className="h-4 w-4" />{l}</button>
                ))}
              </div>
            </div>
            {f.service_location === 'externo' && <Input label="Endereço do serviço" value={f.service_address} onChange={set('service_address')} placeholder={[customer?.street, customer?.number, customer?.city].filter(Boolean).join(', ')} />}
            <Input label="Prazo de entrega" type="datetime-local" value={f.promised_at} onChange={set('promised_at')} />
            <Input label={<>Garantia (dias)<Hint text="Quantos dias, a partir da entrega, o serviço fica coberto. Retornos nesse prazo viram OS de garantia sem custo." /></>} type="number" min={0} value={f.warranty_days} onChange={set('warranty_days')} />
            <Select label={<>Etapa inicial<Hint text="Em que ponto a OS começa. O normal é “Recebida”; use outra se o serviço já foi avaliado ou aprovado." /></>} value={f.status} onChange={set('status')}>
              <option value="aberta">Recebida</option><option value="diagnostico">Em diagnóstico</option>
              <option value="aguardando_aprovacao">Aguardando aprovação</option><option value="aprovada">Aprovada</option>
              <option value="em_execucao">Em execução</option>
            </Select>
          </section>
          <section className="card space-y-4 p-5">
            <VoiceTextarea label="Observações (aparecem na OS impressa)" rows={2} value={f.notes} onChange={set('notes')} />
            <VoiceTextarea label="Anotações internas" rows={2} value={f.internal_notes} onChange={set('internal_notes')} />
          </section>
        </div>
      </div>

      <div className="action-bar">
        <div className="mx-auto flex max-w-[1400px] items-center justify-end gap-3 px-4 py-3 sm:px-8">
          <button className="btn-ghost" onClick={() => nav(-1)}>Cancelar</button>
          <ActionButton disabled={busy} onClick={save}
            blocked={!customer ? (plateOn ? 'Escolha o cliente: busque pela placa ou pelo nome.' : 'Escolha o cliente da OS (busque pelo nome, telefone ou CPF/CNPJ).')
              : f.equipment && !f.equipment.description ? 'Descreva o equipamento novo (ex.: “Portão basculante 3x2 m”).' : null}
            onBlocked={() => highlight(!customer ? '#campo-cliente' : '#campo-equipamento')}>
            <Save className="h-4 w-4" /> Abrir OS
          </ActionButton>
        </div>
      </div>
    </div>
  );
}
