import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { addDays, format } from 'date-fns';
import { Save, Wrench, MapPin, RotateCcw } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useCatalog } from '../context/CatalogContext';
import { PageHeader, Input, Textarea, Select, MoneyInput, useAction, FAIL, cx } from '../components/ui';
import { money } from '../lib/format';
import CustomerPicker, { EquipmentPicker } from '../components/CustomerPicker';
import ItemsEditor, { cleanItems } from '../components/ItemsEditor';

export default function OrderNew() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { company, can, user } = useAuth();
  const { technicians, services } = useCatalog();
  const showValues = can('orders_values');
  const cfg = company.settings.orders;
  const [run, busy] = useAction();
  const [customer, setCustomer] = useState(null);
  const [f, setF] = useState({
    equipment_id: null, equipment: null, technician_id: user.technician_id || '', priority: 'normal', service_location: 'oficina',
    service_address: '', promised_at: format(addDays(new Date(), cfg.defaultPromiseDays || 3), "yyyy-MM-dd'T'18:00"),
    problem: '', accessories: '', condition: '', notes: '', internal_notes: '', items: [], discount: 0,
    warranty_days: cfg.defaultWarrantyDays, status: 'aberta',
  });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));

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

  const save = async () => {
    const body = {
      ...f, kind: 'os', customer_id: customer?.id, technician_id: f.technician_id || null,
      promised_at: f.promised_at ? new Date(f.promised_at).toISOString() : null,
      equipment: f.equipment?.description ? f.equipment : null, items: cleanItems(f.items), warranty_days: Number(f.warranty_days) || 0,
    };
    const r = await run(() => api.post('/orders', body), 'OS aberta');
    if (r !== FAIL) nav(`/os/${r.id}`, { replace: true });
  };

  return (
    <div className="pb-2">
      <PageHeader title="Nova ordem de serviço" subtitle="Registre o que o cliente trouxe e o problema relatado" />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="card space-y-4 p-5">
            <h2 className="font-semibold">Cliente e equipamento</h2>
            <CustomerPicker value={customer} onChange={(c) => { setCustomer(c); setF((x) => ({ ...x, equipment_id: null, equipment: null })); }} autoFocus />
            <EquipmentPicker customerId={customer?.id} value={f.equipment_id} onChange={set('equipment_id')}
              newEquipment={f.equipment} onNewEquipment={(e) => setF((x) => ({ ...x, equipment: e }))} />
          </section>

          <section className="card space-y-4 p-5">
            <h2 className="font-semibold">Relato e recebimento</h2>
            <Textarea label="Problema relatado / serviço solicitado" rows={3} value={f.problem} onChange={set('problem')}
              placeholder="Ex.: trinca na longarina, portão arrastando, máquina não abre arco…" />
            <div className="grid gap-4 sm:grid-cols-2">
              <Textarea label="Acessórios deixados" rows={2} value={f.accessories} onChange={set('accessories')} placeholder="Tocha, garra, cabo obra, cilindro…" />
              <Textarea label="Estado / condições do item" rows={2} value={f.condition} onChange={set('condition')} placeholder="Riscos, amassados, peças faltando…" />
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
            <Input label="Garantia (dias)" type="number" min={0} value={f.warranty_days} onChange={set('warranty_days')} />
            <Select label="Etapa inicial" value={f.status} onChange={set('status')}>
              <option value="aberta">Recebida</option><option value="diagnostico">Em diagnóstico</option>
              <option value="aguardando_aprovacao">Aguardando aprovação</option><option value="aprovada">Aprovada</option>
              <option value="em_execucao">Em execução</option>
            </Select>
          </section>
          <section className="card space-y-4 p-5">
            <Textarea label="Observações (aparecem na OS impressa)" rows={2} value={f.notes} onChange={set('notes')} />
            <Textarea label="Anotações internas" rows={2} value={f.internal_notes} onChange={set('internal_notes')} />
          </section>
        </div>
      </div>

      <div className="action-bar">
        <div className="mx-auto flex max-w-[1400px] items-center justify-end gap-3 px-4 py-3 sm:px-8">
          <button className="btn-ghost" onClick={() => nav(-1)}>Cancelar</button>
          <button className="btn-primary" disabled={busy || !customer || (f.equipment && !f.equipment.description)} onClick={save}><Save className="h-4 w-4" /> Abrir OS</button>
        </div>
      </div>
    </div>
  );
}
