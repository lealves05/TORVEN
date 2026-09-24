import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShoppingCart, Printer } from 'lucide-react';
import { api, appPath } from '../lib/api';
import { money } from '../lib/format';
import { useUI } from '../context/UIContext';
import { PageHeader, Textarea, Modal, useAction, FAIL } from '../components/ui';
import CustomerPicker from '../components/CustomerPicker';
import ItemsEditor, { cleanItems, itemsSubtotal } from '../components/ItemsEditor';
import PaymentModal from '../components/PaymentModal';

/** Venda de balcão: materiais (e serviços rápidos) com recebimento na hora. */
export default function QuickSale() {
  const nav = useNavigate();
  const { toast } = useUI();
  const [run, busy] = useAction();
  const [customer, setCustomer] = useState(null);
  const [items, setItems] = useState([]);
  const [discount, setDiscount] = useState(0);
  const [notes, setNotes] = useState('');
  const [pay, setPay] = useState(false);
  const [done, setDone] = useState(null);
  const total = Math.round((itemsSubtotal(items) - discount) * 100) / 100;

  const finish = async (body) => {
    const r = await run(() => api.post('/orders/quick-sale', { customer_id: customer?.id || null, items: cleanItems(items), discount, notes, ...body }));
    if (r === FAIL) return;
    setPay(false);
    setDone(r);
    setItems([]); setDiscount(0); setNotes(''); setCustomer(null);
  };

  return (
    <div>
      <PageHeader title="Venda de balcão" subtitle="Venda de materiais e serviços rápidos com recebimento na hora" />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="card space-y-4 p-5 lg:col-span-2">
          <ItemsEditor items={items} onChange={setItems} discount={discount} onDiscount={setDiscount} />
        </div>
        <div className="space-y-4">
          <div className="card space-y-4 p-5">
            <CustomerPicker value={customer} onChange={setCustomer} optional />
            <Textarea label="Observações" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            <div className="flex items-center justify-between rounded-app-sm bg-muted/60 px-4 py-3">
              <span className="text-sm text-ink-soft">Total</span><span className="text-2xl font-semibold tabular-nums">{money(total)}</span>
            </div>
            <button className="btn-primary w-full" disabled={!items.length || total < 0 || items.some((i) => !i.description)} onClick={() => setPay(true)}>
              <ShoppingCart className="h-4 w-4" /> Finalizar venda
            </button>
          </div>
        </div>
      </div>
      {pay && (
        <PaymentModal open onClose={() => setPay(false)} balance={total} title="Receber venda" confirmText="Concluir venda" busy={busy}
          requireCustomerForLater hasCustomer={!!customer} allowSkip={total === 0} onConfirm={finish} />
      )}
      {done && (
        <Modal open onClose={() => setDone(null)} size="sm" title={`Venda nº ${done.order.number} concluída`}
          footer={<>
            <button className="btn-ghost" onClick={() => nav(`/os/${done.order.id}`)}>Ver venda</button>
            <a className="btn-outline" href={appPath(`/imprimir/os/${done.order.id}?recibo=1`)} target="_blank" rel="noreferrer"><Printer className="h-4 w-4" /> Recibo</a>
            <button className="btn-primary" onClick={() => { setDone(null); toast('Pronto para a próxima venda'); }}>Nova venda</button>
          </>}>
          <div className="space-y-2 text-center">
            <div className="text-3xl font-semibold tabular-nums">{money(done.order.total)}</div>
            {done.change > 0 && <div className="rounded-app-sm bg-emerald-500/10 p-3 text-lg font-semibold text-emerald-700 dark:text-emerald-300">Troco: {money(done.change)}</div>}
          </div>
        </Modal>
      )}
    </div>
  );
}
