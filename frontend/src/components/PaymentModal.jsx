import { useMemo, useState } from 'react';
import { Plus, Trash2, CalendarClock } from 'lucide-react';
import { addDays, format } from 'date-fns';
import { money } from '../lib/format';
import { useSettings } from '../context/AuthContext';
import { Modal, MoneyInput, Input, Select, Toggle } from './ui';

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * Recebimento: várias formas de pagamento + saldo parcelado "a receber".
 * onConfirm({ payments, installments }) → Promise
 */
export default function PaymentModal({ open, onClose, balance, title = 'Receber pagamento', subtitle, confirmText = 'Confirmar recebimento', onConfirm, busy, allowSkip, requireCustomerForLater = false, hasCustomer = true, extra }) {
  const settings = useSettings();
  const methods = (settings.paymentMethods || []).filter((m) => m.active !== false);
  const [pays, setPays] = useState([{ method: 'pix', amount: round2(balance) }]);
  const [later, setLater] = useState(false);
  const [inst, setInst] = useState({ n: 1, first: format(addDays(new Date(), 30), 'yyyy-MM-dd'), every: 30, method: 'boleto' });

  const paid = round2(pays.reduce((a, p) => a + (Number(p.amount) || 0), 0));
  const rest = round2(Math.max(0, balance - paid));
  const cash = round2(pays.filter((p) => p.method === 'dinheiro').reduce((a, p) => a + (Number(p.amount) || 0), 0));
  const change = round2(Math.max(0, paid - balance));
  const invalidChange = change > 0 && change > cash + 0.001;
  const installments = useMemo(() => {
    if (!later || rest <= 0) return [];
    const n = Math.max(1, Math.min(24, Number(inst.n) || 1));
    const each = Math.floor((rest / n) * 100) / 100;
    return Array.from({ length: n }, (_, k) => ({
      due_date: format(addDays(new Date(`${inst.first}T12:00`), k * (Number(inst.every) || 30)), 'yyyy-MM-dd'),
      amount: k === n - 1 ? round2(rest - each * (n - 1)) : each,
      method: inst.method,
    }));
  }, [later, rest, inst]);

  const setP = (i, patch) => setPays(pays.map((p, k) => (k === i ? { ...p, ...patch } : p)));
  const valid = !invalidChange && (paid > 0 || installments.length > 0 || allowSkip) && !(later && requireCustomerForLater && !hasCustomer);

  return (
    <Modal open={open} onClose={onClose} title={title} subtitle={subtitle} size="md"
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Voltar</button>
        <button className="btn-primary" disabled={busy || !valid}
          onClick={() => onConfirm({ payments: pays.filter((p) => Number(p.amount) > 0).map((p) => ({ method: p.method, amount: Number(p.amount) })), installments })}>
          {confirmText}
        </button>
      </>}>
      <div className="space-y-4">
        {extra}
        <div className="flex items-center justify-between rounded-app-sm bg-muted/60 px-4 py-3">
          <span className="text-sm text-ink-soft">Saldo a receber</span>
          <span className="text-xl font-semibold tabular-nums">{money(balance)}</span>
        </div>
        <div className="space-y-2">
          {pays.map((p, i) => (
            <div key={i} className="flex items-end gap-2">
              <Select label={i === 0 ? 'Forma de pagamento' : undefined} value={p.method} onChange={(e) => setP(i, { method: e.target.value })} className="flex-1">
                {methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Select>
              <MoneyInput label={i === 0 ? 'Valor' : undefined} value={p.amount} onChange={(v) => setP(i, { amount: v })} className="w-36" />
              {pays.length > 1 && <button className="btn-ghost btn-icon text-red-600" onClick={() => setPays(pays.filter((_, k) => k !== i))}><Trash2 className="h-4 w-4" /></button>}
            </div>
          ))}
          <button className="btn-ghost text-primary" onClick={() => setPays([...pays, { method: 'dinheiro', amount: rest }])}><Plus className="h-4 w-4" /> Dividir pagamento</button>
        </div>
        {change > 0 && (
          <div className={invalidChange ? 'rounded-app-sm bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300' : 'rounded-app-sm bg-emerald-500/10 p-3 text-sm font-medium text-emerald-700 dark:text-emerald-300'}>
            {invalidChange ? 'Valor acima do saldo. Troco só é possível em dinheiro.' : `Troco: ${money(change)}`}
          </div>
        )}
        {rest > 0 && (
          <div className="rounded-app-sm border border-line p-3">
            <Toggle checked={later} onChange={setLater} label={`Lançar ${money(rest)} como "a receber"`} hint="Gera contas a receber com vencimento (boleto, fiado, faturado)." />
            {later && (
              <>
                {requireCustomerForLater && !hasCustomer && <p className="mt-2 text-xs text-red-600">Identifique o cliente para vender a prazo.</p>}
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Input label="Parcelas" type="number" min={1} max={24} value={inst.n} onChange={(e) => setInst({ ...inst, n: e.target.value })} />
                  <Input label="1º vencimento" type="date" value={inst.first} onChange={(e) => setInst({ ...inst, first: e.target.value })} />
                  <Input label="A cada (dias)" type="number" min={1} value={inst.every} onChange={(e) => setInst({ ...inst, every: e.target.value })} />
                  <Select label="Forma" value={inst.method} onChange={(e) => setInst({ ...inst, method: e.target.value })}>
                    {methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </Select>
                </div>
                <ul className="mt-3 space-y-1 text-xs text-ink-soft">
                  {installments.map((x, k) => (
                    <li key={k} className="flex justify-between"><span className="flex items-center gap-1.5"><CalendarClock className="h-3.5 w-3.5" />{format(new Date(`${x.due_date}T12:00`), 'dd/MM/yyyy')}</span><span className="tabular-nums">{money(x.amount)}</span></li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
