import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { startOfMonth, endOfMonth } from 'date-fns';
import {
  Lock, Unlock, ArrowDownCircle, ArrowUpCircle, ShoppingCart, Plus, Check, Trash2, Pencil, Download, Wallet, Search, Undo2, ArrowLeftRight, Eye,
} from 'lucide-react';
import { api, qs } from '../lib/api';
import { money, fmt, fmtDateTime, fmtTime, ymd, downloadCSV, methodName } from '../lib/format';
import { useAuth, useSettings } from '../context/AuthContext';
import { useCatalog } from '../context/CatalogContext';
import { useUI } from '../context/UIContext';
import { PageHeader, Tabs, Modal, Input, Select, MoneyInput, Toggle, Stat, Empty, Loading, useAction, FAIL, cx } from '../components/ui';
import { TransferModal } from './Finance';
import FinanceAlerts from '../components/FinanceAlerts';

// Financeiro: cada opção do menu é uma aba com endereço próprio (/financeiro/receber, /financeiro/pagar...)
const TABS = [
  ['caixa', 'Caixa'], ['receber', 'Contas a receber'], ['pagar', 'Contas a pagar'], ['lancamentos', 'Lançamentos'],
  ['transferencia', 'Transferência'], ['fechados', 'Caixas fechados'], ['alertas', 'Alertas e lembretes'],
];
const ALIAS = { fluxo: 'lancamentos', incluir: 'pagar' };

export default function Cash() {
  const { aba } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { feature } = useAuth();
  const raw = aba || params.get('tab') || 'caixa';
  const tab = ALIAS[raw] || raw;
  const tabs = TABS.filter(([k]) => k !== 'transferencia' || feature('financeiro'));
  return (
    <div>
      <PageHeader title="Financeiro" subtitle="Caixa, contas a pagar e a receber, transferências, fechamentos, alertas e lembretes" />
      <Tabs value={tab} onChange={(t) => navigate(`/financeiro/${t}`)} tabs={tabs.map(([value, label]) => ({ value, label }))} />
      {tab === 'caixa' && <Session />}
      {tab === 'receber' && <Transactions key="receber" pendingOnly fixedType="entrada" />}
      {tab === 'pagar' && <Transactions key={`pagar-${raw}`} pendingOnly fixedType="saida" openNew={raw === 'incluir'} />}
      {tab === 'contas' && <Transactions key="contas" pendingOnly />}
      {tab === 'lancamentos' && <Transactions key="lanc" />}
      {tab === 'transferencia' && <Transfers />}
      {tab === 'fechados' && <ClosedSessions />}
      {tab === 'alertas' && <FinanceAlerts />}
    </div>
  );
}

function Session() {
  const settings = useSettings();
  const [run, busy] = useAction();
  const [session, setSession] = useState(undefined);
  const [history, setHistory] = useState([]);
  const [opening, setOpening] = useState(0);
  const [moveType, setMoveType] = useState(null);
  const [closing, setClosing] = useState(false);
  const [movs, setMovs] = useState([]);

  const load = useCallback(async () => {
    const [s, h] = await Promise.all([api.get('/cash/session'), api.get('/cash/sessions')]);
    setSession(s); setHistory(h);
    if (s) {
      const t = await api.get(`/cash/transactions${qs({ from: ymd(new Date(s.opened_at)) })}`);
      setMovs(t.items.filter((x) => x.cash_session_id === s.id));
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (session === undefined) return <Loading />;

  if (!session) {
    return (
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="card p-6 lg:col-span-1">
          <div className="mb-4 grid h-12 w-12 place-items-center rounded-full bg-muted"><Lock className="h-5 w-5 text-ink-faint" /></div>
          <h2 className="text-lg font-semibold">Caixa fechado</h2>
          <p className="mt-1 text-sm text-ink-faint">Informe o valor em dinheiro na gaveta para abrir o caixa.</p>
          <MoneyInput label="Troco inicial" value={opening} onChange={setOpening} className="mt-5" />
          <button className="btn-primary mt-4 w-full" disabled={busy}
            onClick={async () => { if ((await run(() => api.post('/cash/session/open', { opening_amount: opening }), 'Caixa aberto')) !== FAIL) load(); }}>
            <Unlock className="h-4 w-4" /> Abrir caixa
          </button>
        </div>
        <SessionHistory history={history} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <span className="chip bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Caixa aberto</span>
        <span className="text-sm text-ink-faint">desde {fmtDateTime(session.opened_at)} por {session.opened_by_name}</span>
        <div className="ml-auto flex flex-wrap gap-2">
          <button className="btn-outline" onClick={() => setMoveType('Suprimento')}><ArrowDownCircle className="h-4 w-4 text-emerald-600" /> Suprimento</button>
          <button className="btn-outline" onClick={() => setMoveType('Sangria')}><ArrowUpCircle className="h-4 w-4 text-red-600" /> Sangria</button>
          <Link className="btn-outline" to="/venda"><ShoppingCart className="h-4 w-4" /> Venda de balcão</Link>
          <button className="btn-primary" onClick={() => setClosing(true)}><Lock className="h-4 w-4" /> Fechar caixa</button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Troco inicial" value={money(session.opening_amount)} />
        <Stat label="Entradas" value={money(session.entries)} hint={`${session.sales_count} OS/venda(s)`} tone="text-emerald-500" icon={ArrowDownCircle} />
        <Stat label="Saídas" value={money(session.exits)} tone="text-red-500" icon={ArrowUpCircle} />
        <Stat label="Dinheiro na gaveta (esperado)" value={money(session.expected_cash)} icon={Wallet} tone="text-primary" />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="card p-5">
          <h3 className="mb-3 font-semibold">Recebido por forma de pagamento</h3>
          {Object.keys(session.by_method).length === 0 ? <p className="text-sm text-ink-faint">Nenhum recebimento ainda.</p> : (
            <ul className="space-y-2 text-sm">
              {Object.entries(session.by_method).map(([m, v]) => (
                <li key={m} className="flex justify-between"><span>{methodName(settings, m)}</span><span className="font-medium tabular-nums">{money(v)}</span></li>
              ))}
            </ul>
          )}
        </div>
        <div className="card lg:col-span-2">
          <h3 className="border-b border-line px-5 py-3.5 font-semibold">Movimentações deste caixa</h3>
          {movs.length === 0 ? <Empty title="Sem movimentações" /> : (
            <div className="max-h-96 divide-y divide-line overflow-y-auto">
              {movs.map((t) => (
                <div key={t.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                  <span className="w-12 text-xs tabular-nums text-ink-faint">{fmtTime(t.paid_at)}</span>
                  <span className="min-w-0 flex-1 truncate">{t.description || t.category}<span className="ml-2 text-xs text-ink-faint">{methodName(settings, t.method)}</span></span>
                  <span className={cx('tabular-nums font-medium', t.type === 'entrada' ? 'text-emerald-600' : 'text-red-600')}>{t.type === 'entrada' ? '+' : '−'}{money(t.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <SessionHistory history={history} />

      {moveType && <CashMove type={moveType} onClose={() => setMoveType(null)} onSaved={load} />}
      {closing && <CloseSession session={session} onClose={() => setClosing(false)} onSaved={load} />}
    </div>
  );
}

function SessionHistory({ history }) {
  const closed = history.filter((h) => h.closed_at);
  return (
    <div className="card lg:col-span-2">
      <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <h3 className="font-semibold">Fechamentos anteriores</h3>
        <Link className="text-sm text-primary hover:underline" to="/financeiro/fechados">Ver todos</Link>
      </div>
      {closed.length === 0 ? <Empty title="Nenhum fechamento ainda" /> : (
        <div className="overflow-x-auto">
          <table className="table-clean">
            <thead><tr><th>Período</th><th className="text-right">Esperado</th><th className="text-right">Contado</th><th className="text-right">Diferença</th></tr></thead>
            <tbody>
              {closed.slice(0, 15).map((h) => {
                const diff = h.closing_amount - h.expected_amount;
                return (
                  <tr key={h.id}>
                    <td><div>{fmt(h.opened_at, 'dd/MM HH:mm')} → {fmt(h.closed_at, 'dd/MM HH:mm')}</div><div className="text-xs text-ink-faint">{h.closed_by_name}</div></td>
                    <td className="text-right tabular-nums">{money(h.expected_amount)}</td>
                    <td className="text-right tabular-nums">{money(h.closing_amount)}</td>
                    <td className={cx('text-right tabular-nums font-medium', Math.abs(diff) < 0.01 ? 'text-emerald-600' : 'text-red-600')}>{money(diff)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CashMove({ type, onClose, onSaved }) {
  const [run, busy] = useAction();
  const [amount, setAmount] = useState(0);
  const [desc, setDesc] = useState('');
  const save = async () => {
    const r = await run(() => api.post('/cash/transactions', {
      type: type === 'Sangria' ? 'saida' : 'entrada', category: type, description: desc || type, amount, method: 'dinheiro', paid: true,
    }), `${type} registrada`);
    if (r !== FAIL) { onSaved(); onClose(); }
  };
  return (
    <Modal open onClose={onClose} size="sm" title={type} subtitle={type === 'Sangria' ? 'Retirada de dinheiro da gaveta' : 'Reforço de dinheiro na gaveta'}
      footer={<><button className="btn-ghost" onClick={onClose}>Cancelar</button><button className="btn-primary" disabled={busy || amount <= 0} onClick={save}>Registrar</button></>}>
      <div className="space-y-4">
        <MoneyInput label="Valor" value={amount} onChange={setAmount} autoFocus />
        <Input label="Motivo" value={desc} onChange={(e) => setDesc(e.target.value)} />
      </div>
    </Modal>
  );
}

function CloseSession({ session, onClose, onSaved }) {
  const [run, busy] = useAction();
  const [counted, setCounted] = useState(session.expected_cash);
  const [notes, setNotes] = useState('');
  const diff = Math.round((counted - session.expected_cash) * 100) / 100;
  const save = async () => {
    const r = await run(() => api.post('/cash/session/close', { closing_amount: counted, notes }), 'Caixa fechado');
    if (r !== FAIL) { onSaved(); onClose(); }
  };
  return (
    <Modal open onClose={onClose} size="sm" title="Fechar caixa"
      footer={<><button className="btn-ghost" onClick={onClose}>Cancelar</button><button className="btn-primary" disabled={busy} onClick={save}>Confirmar fechamento</button></>}>
      <div className="space-y-4">
        <div className="rounded-app-sm bg-muted/60 p-4 text-sm">
          <div className="flex justify-between"><span>Dinheiro esperado na gaveta</span><b className="tabular-nums">{money(session.expected_cash)}</b></div>
        </div>
        <MoneyInput label="Valor contado" value={counted} onChange={setCounted} autoFocus />
        <div className={cx('rounded-app-sm p-3 text-sm font-medium', Math.abs(diff) < 0.01 ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-red-500/10 text-red-700 dark:text-red-300')}>
          {Math.abs(diff) < 0.01 ? 'Caixa conferido, sem diferença.' : diff > 0 ? `Sobra de ${money(diff)}` : `Falta de ${money(-diff)}`}
        </div>
        <Input label="Observações" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
    </Modal>
  );
}

function Transactions({ pendingOnly, fixedType, openNew }) {
  const settings = useSettings();
  const { confirm } = useUI();
  const [run] = useAction();
  const [params] = useSearchParams();
  const [f, setF] = useState({
    from: pendingOnly ? '' : ymd(startOfMonth(new Date())), to: pendingOnly ? '' : ymd(endOfMonth(new Date())),
    type: fixedType || '', status: pendingOnly ? (params.get('situacao') === 'vencido' ? 'vencido' : 'pendente') : '', category: '', search: '',
  });
  const [data, setData] = useState(null);
  const [edit, setEdit] = useState(openNew ? { type: fixedType || 'saida', paid: false } : null);
  const load = useCallback(() => api.get(`/cash/transactions${qs(f)}`).then(setData), [f]);
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);

  const pay = async (t) => {
    if (!(await confirm({ title: t.type === 'entrada' ? 'Confirmar recebimento?' : 'Confirmar pagamento?', message: `${t.description || t.category} — ${money(t.amount)}`, confirmText: 'Confirmar', danger: false }))) return;
    if ((await run(() => api.post(`/cash/transactions/${t.id}/pay`, { method: t.method === 'fiado' ? 'dinheiro' : t.method }), 'Baixa registrada')) !== FAIL) load();
  };
  const unpay = async (t) => {
    if (!(await confirm({ title: 'Desfazer a baixa?', message: `${t.description || t.category} volta a ficar em aberto.`, confirmText: 'Desfazer', danger: false }))) return;
    if ((await run(() => api.post(`/cash/transactions/${t.id}/unpay`), 'Baixa desfeita')) !== FAIL) load();
  };
  const remove = async (t) => {
    if (!(await confirm({ title: 'Excluir lançamento?', message: t.description, confirmText: 'Excluir' }))) return;
    if ((await run(() => api.del(`/cash/transactions/${t.id}`), 'Lançamento excluído')) !== FAIL) load();
  };
  const today = ymd();
  const cats = fixedType === 'entrada' ? settings.incomeCategories || [] : fixedType === 'saida' ? settings.expenseCategories || []
    : [...(settings.incomeCategories || []), ...(settings.expenseCategories || []), 'Sangria', 'Suprimento'];

  return (
    <div className="space-y-4">
      {data && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {!pendingOnly && <Stat label="Entradas" value={money(data.totals.entradas)} tone="text-emerald-500" icon={ArrowDownCircle} />}
          {!pendingOnly && <Stat label="Saídas" value={money(data.totals.saidas)} tone="text-red-500" icon={ArrowUpCircle} />}
          {!pendingOnly && <Stat label="Saldo realizado" value={money(data.totals.entradas - data.totals.saidas)} />}
          {fixedType !== 'saida' && <Stat label="A receber" value={money(data.totals.a_receber)} hint="pendente" tone={fixedType ? 'text-emerald-600' : undefined} />}
          {fixedType !== 'entrada' && <Stat label="A pagar" value={money(data.totals.a_pagar)} hint="pendente" tone={fixedType ? 'text-red-600' : undefined} />}
          {fixedType && <Stat label="Vencidas" value={String(data.items.filter((t) => !t.paid_at && t.due_date && t.due_date < ymd()).length)} hint="no filtro" />}
          {pendingOnly && !fixedType && <Stat label="Saldo previsto" value={money(data.totals.a_receber - data.totals.a_pagar)} />}
        </div>
      )}
      <div className="card flex flex-wrap items-end gap-3 p-3">
        {!pendingOnly && <Input label="De" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} className="w-40" />}
        {!pendingOnly && <Input label="Até" type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} className="w-40" />}
        {!fixedType && (
          <Select label="Tipo" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} className="w-36">
            <option value="">Todos</option><option value="entrada">Entradas</option><option value="saida">Saídas</option>
          </Select>
        )}
        {pendingOnly ? (
          <Select label="Situação" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} className="w-36">
            <option value="pendente">Em aberto</option><option value="vencido">Vencidas</option>
          </Select>
        ) : (
          <Select label="Situação" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} className="w-36">
            <option value="">Todas</option><option value="pago">Pagas</option><option value="pendente">Pendentes</option>
          </Select>
        )}
        <Select label="Categoria" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} className="w-44">
          <option value="">Todas</option>{[...new Set(cats)].map((c) => <option key={c}>{c}</option>)}
        </Select>
        <div className="relative min-w-[160px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-[calc(50%+10px)] h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <Input label="Buscar" value={f.search} onChange={(e) => setF({ ...f, search: e.target.value })} className="[&_input]:pl-9" />
        </div>
        <button className="btn-outline" disabled={!data?.items.length} onClick={() => downloadCSV('lancamentos.csv', data.items.map((t) => ({
          Data: fmt(t.ref_date), Tipo: t.type, Categoria: t.category, Descricao: t.description, Valor: t.amount, Forma: methodName(settings, t.method),
          Situacao: t.paid_at ? 'Pago' : 'Pendente', Vencimento: t.due_date ? fmt(t.due_date) : '',
        })))}><Download className="h-4 w-4" /></button>
        <button className="btn-primary" data-tour="incluir-conta" onClick={() => setEdit({ type: fixedType || 'saida', paid: !pendingOnly })}>
          <Plus className="h-4 w-4" /> {fixedType === 'entrada' ? 'Incluir conta a receber' : fixedType === 'saida' ? 'Incluir conta a pagar' : 'Lançamento'}
        </button>
      </div>
      <div className="card overflow-hidden">
        {!data ? <Loading /> : !data.items.length ? <Empty icon={Wallet} title={fixedType === 'entrada' ? 'Nenhuma conta a receber neste filtro' : fixedType === 'saida' ? 'Nenhuma conta a pagar neste filtro' : 'Nenhum lançamento no filtro'} /> : (
          <div className="overflow-x-auto">
            <table className="table-clean">
              <thead><tr><th>Data</th><th>Descrição</th><th className="hidden md:table-cell">Categoria</th><th className="hidden lg:table-cell">Forma</th><th className="text-right">Valor</th><th /></tr></thead>
              <tbody>
                {data.items.map((t) => {
                  const overdue = !t.paid_at && t.due_date && t.due_date < today;
                  return (
                    <tr key={t.id}>
                      <td className="whitespace-nowrap tabular-nums">
                        {fmt(t.ref_date)}
                        {!t.paid_at && <div className={cx('text-xs', overdue ? 'text-red-600' : 'text-amber-600')}>{overdue ? 'vencida' : 'em aberto'}</div>}
                      </td>
                      <td>
                        <div className="max-w-[260px] truncate">{t.description || t.category}</div>
                        <div className="text-xs text-ink-faint">
                          {t.order_id && <Link to={`/os/${t.order_id}`} className="text-primary hover:underline">{t.order_kind === 'venda' ? 'Venda' : 'OS'} #{t.order_number}</Link>}
                          {t.purchase_id && <Link to={`/estoque/entradas/${t.purchase_id}`} className="text-primary hover:underline">Entrada #{t.purchase_number}</Link>}
                          {[t.customer_name, t.supplier_name, t.technician_name, t.document && `doc. ${t.document}`].filter(Boolean).map((x) => ` · ${x}`)}
                        </div>
                      </td>
                      <td className="hidden text-ink-soft md:table-cell">{t.category}</td>
                      <td className="hidden text-ink-soft lg:table-cell">{methodName(settings, t.method)}{t.account_name && <div className="text-xs text-ink-faint">{t.account_name}{t.reconciled_at && ' · conciliado'}</div>}</td>
                      <td className={cx('whitespace-nowrap text-right font-medium tabular-nums', t.type === 'entrada' ? 'text-emerald-600' : 'text-red-600')}>
                        {t.type === 'entrada' ? '+' : '−'} {money(t.amount)}
                      </td>
                      <td className="w-36 whitespace-nowrap text-right">
                        {!t.paid_at && <button className="btn-ghost btn-icon h-8 text-emerald-600" title="Dar baixa" onClick={() => pay(t)}><Check className="h-4 w-4" /></button>}
                        {t.paid_at && t.due_date && !t.order_id && <button className="btn-ghost btn-icon h-8" title="Desfazer baixa" onClick={() => unpay(t)}><Undo2 className="h-4 w-4" /></button>}
                        {!((t.order_id || t.purchase_id) && t.paid_at) && <>
                          <button className="btn-ghost btn-icon h-8" title="Editar" onClick={() => setEdit({ ...t, paid: !!t.paid_at })}><Pencil className="h-4 w-4" /></button>
                          <button className="btn-ghost btn-icon h-8 text-red-600" title="Excluir" onClick={() => remove(t)}><Trash2 className="h-4 w-4" /></button>
                        </>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {edit && <TxForm tx={edit} onClose={() => setEdit(null)} onSaved={load} />}
    </div>
  );
}

function TxForm({ tx, onClose, onSaved }) {
  const settings = useSettings();
  const [run, busy] = useAction();
  const [f, setF] = useState({ category: '', description: '', amount: 0, method: 'pix', repeat: 1, ...tx, due_date: tx.due_date || ymd() });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const cats = f.type === 'entrada' ? settings.incomeCategories : settings.expenseCategories;
  const { technicians } = useCatalog();
  const [suppliers, setSuppliers] = useState([]);
  const [accounts, setAccounts] = useState([]);
  useEffect(() => { api.get('/suppliers').then(setSuppliers).catch(() => {}); api.get('/finance/accounts').then((a) => setAccounts(a.filter((x) => x.active))).catch(() => {}); }, []);
  useEffect(() => { if (!cats?.includes(f.category)) set('category', cats?.[0] || ''); }, [f.type]); // eslint-disable-line
  const save = async () => {
    const body = { type: f.type, category: f.category, description: f.description, amount: +f.amount, method: f.method || null,
      due_date: f.due_date || null, paid: f.paid, repeat: +f.repeat || 1, customer_id: f.customer_id || null, technician_id: f.technician_id || null,
      supplier_id: f.supplier_id || null, document: f.document || null, account_id: f.account_id || null };
    const r = await run(() => (tx.id ? api.put(`/cash/transactions/${tx.id}`, body) : api.post('/cash/transactions', body)), 'Lançamento salvo');
    if (r !== FAIL) { onSaved(); onClose(); }
  };
  return (
    <Modal open onClose={onClose} title={tx.id ? 'Editar lançamento' : f.paid ? 'Novo lançamento' : f.type === 'entrada' ? 'Incluir conta a receber' : 'Incluir conta a pagar'}
      footer={<><button className="btn-ghost" onClick={onClose}>Cancelar</button><button className="btn-primary" disabled={busy || !(+f.amount > 0) || !f.category} onClick={save}>Salvar</button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid grid-cols-2 gap-2 sm:col-span-2">
          {['entrada', 'saida'].map((t) => (
            <button key={t} type="button" onClick={() => set('type', t)}
              className={cx('btn border', f.type === t ? (t === 'entrada' ? 'border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'border-red-500 bg-red-500/10 text-red-700 dark:text-red-300') : 'border-line')}>
              {t === 'entrada' ? <ArrowDownCircle className="h-4 w-4" /> : <ArrowUpCircle className="h-4 w-4" />}{t === 'entrada' ? 'Receita' : 'Despesa'}
            </button>
          ))}
        </div>
        <Input label="Descrição" value={f.description || ''} onChange={(e) => set('description', e.target.value)} className="sm:col-span-2" autoFocus />
        <MoneyInput label="Valor" value={f.amount} onChange={(v) => set('amount', v)} />
        <Select label="Categoria" value={f.category} onChange={(e) => set('category', e.target.value)}>
          {[...new Set([...(cats || []), f.category].filter(Boolean))].map((c) => <option key={c}>{c}</option>)}
        </Select>
        <Input label="Vencimento" type="date" value={f.due_date} onChange={(e) => set('due_date', e.target.value)} />
        <Select label="Forma de pagamento" value={f.method || ''} onChange={(e) => set('method', e.target.value)}>
          <option value="">—</option>{settings.paymentMethods?.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </Select>
        <Input label="Nº do documento (NF, boleto)" value={f.document || ''} onChange={(e) => set('document', e.target.value)} />
        {!tx.id && f.paid && accounts.length > 0 && (
          <Select label="Conta" value={f.account_id || ''} onChange={(e) => set('account_id', e.target.value)}>
            <option value="">Padrão pela forma de pagamento</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        )}
        {f.type === 'saida' ? (
          <Select label="Fornecedor" value={f.supplier_id || ''} onChange={(e) => set('supplier_id', e.target.value)}>
            <option value="">—</option>{suppliers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </Select>
        ) : <div />}
        {f.category === 'Comissões' && (
          <Select label="Técnico" value={f.technician_id || ''} onChange={(e) => set('technician_id', e.target.value)}>
            <option value="">—</option>{technicians.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </Select>
        )}
        <div className="sm:col-span-2"><Toggle checked={f.paid} onChange={(v) => set('paid', v)} label={f.type === 'entrada' ? 'Já recebido' : 'Já pago'} /></div>
        {!tx.id && (
          <Input label="Repetir mensalmente (vezes)" type="number" min={1} max={36} value={f.repeat} onChange={(e) => set('repeat', e.target.value)}
            hint="Ex.: aluguel 12x. Só o primeiro fica pago." />
        )}
      </div>
    </Modal>
  );
}

/** Caixas fechados: período, só com diferença, e o detalhe de cada fechamento. */
function ClosedSessions() {
  const settings = useSettings();
  const [f, setF] = useState({ from: ymd(new Date(Date.now() - 60 * 86400000)), to: ymd(), diff: '' });
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(null);
  useEffect(() => { setRows(null); api.get(`/cash/sessions/closed${qs(f)}`).then(setRows).catch(() => setRows([])); }, [f]);
  const show = async (id) => setOpen(await api.get(`/cash/sessions/${id}`));
  const totalDiff = (rows || []).reduce((a, x) => a + Number(x.difference || 0), 0);
  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-end gap-3 p-3">
        <Input label="De" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} className="w-40" />
        <Input label="Até" type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} className="w-40" />
        <label className="flex h-[var(--row)] items-center gap-2 text-sm"><input type="checkbox" checked={f.diff === '1'} onChange={(e) => setF({ ...f, diff: e.target.checked ? '1' : '' })} /> Só com diferença</label>
        <button className="btn-outline ml-auto" disabled={!rows?.length} onClick={() => downloadCSV('caixas-fechados.csv', rows.map((h) => ({
          Abertura: fmtDateTime(h.opened_at), Fechamento: fmtDateTime(h.closed_at), 'Aberto por': h.opened_by_name, 'Fechado por': h.closed_by_name,
          'Troco inicial': h.opening_amount, Entradas: h.entries, Saidas: h.exits, Esperado: h.expected_amount, Contado: h.closing_amount, Diferenca: h.difference,
        })))}><Download className="h-4 w-4" /> Exportar</button>
      </div>
      {rows && rows.length > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Fechamentos" value={String(rows.length)} />
          <Stat label="Com diferença" value={String(rows.filter((x) => Math.abs(x.difference) >= 0.01).length)} />
          <Stat label="Diferença somada" value={money(totalDiff)} tone={Math.abs(totalDiff) < 0.01 ? 'text-emerald-600' : 'text-red-600'} />
          <Stat label="Entradas no período" value={money(rows.reduce((a, x) => a + x.entries, 0))} tone="text-emerald-500" />
        </div>
      )}
      <div className="card overflow-hidden">
        {!rows ? <Loading /> : !rows.length ? <Empty icon={Lock} title="Nenhum caixa fechado neste período" /> : (
          <div className="overflow-x-auto">
            <table className="table-clean">
              <thead><tr><th>Período</th><th className="hidden md:table-cell text-right">Entradas</th><th className="hidden md:table-cell text-right">Saídas</th><th className="text-right">Esperado</th><th className="text-right">Contado</th><th className="text-right">Diferença</th><th /></tr></thead>
              <tbody>
                {rows.map((h) => (
                  <tr key={h.id}>
                    <td><div className="whitespace-nowrap">{fmt(h.opened_at, 'dd/MM HH:mm')} → {fmt(h.closed_at, 'dd/MM HH:mm')}</div><div className="text-xs text-ink-faint">{h.closed_by_name || h.opened_by_name}</div></td>
                    <td className="hidden text-right tabular-nums text-emerald-600 md:table-cell">{money(h.entries)}</td>
                    <td className="hidden text-right tabular-nums text-red-600 md:table-cell">{money(h.exits)}</td>
                    <td className="text-right tabular-nums">{money(h.expected_amount)}</td>
                    <td className="text-right tabular-nums">{money(h.closing_amount)}</td>
                    <td className={cx('text-right font-medium tabular-nums', Math.abs(h.difference) < 0.01 ? 'text-emerald-600' : 'text-red-600')}>{money(h.difference)}</td>
                    <td className="text-right"><button className="btn-ghost h-8 text-xs" onClick={() => show(h.id)} aria-label={`Ver caixa de ${fmt(h.opened_at, 'dd/MM')}`}><Eye className="h-4 w-4" /> Ver</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {open && (
        <Modal open onClose={() => setOpen(null)} size="lg" title="Caixa fechado" subtitle={`${fmtDateTime(open.opened_at)} → ${fmtDateTime(open.closed_at)}`}
          footer={<button className="btn-ghost" onClick={() => setOpen(null)}>Fechar</button>}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              {[['Troco inicial', open.opening_amount], ['Entradas', open.entries], ['Saídas', open.exits], ['Esperado na gaveta', open.expected_amount],
                ['Contado', open.closing_amount], ['Diferença', open.closing_amount - open.expected_amount]].map(([k, v]) => (
                <div key={k} className="rounded-app-sm bg-muted/60 p-2"><div className="text-xs text-ink-faint">{k}</div><b className="tabular-nums">{money(v)}</b></div>
              ))}
            </div>
            <p className="text-xs text-ink-faint">Aberto por {open.opened_by_name || '—'} · fechado por {open.closed_by_name || '—'}{open.notes ? ` · Obs.: ${open.notes}` : ''}</p>
            {Object.keys(open.by_method).length > 0 && (
              <div className="flex flex-wrap gap-2 text-xs">{Object.entries(open.by_method).map(([m, v]) => <span key={m} className="chip bg-muted">{methodName(settings, m)}: {money(v)}</span>)}</div>
            )}
            <div className="max-h-80 divide-y divide-line overflow-y-auto rounded-app-sm border border-line">
              {!open.movements.length ? <p className="p-4 text-sm text-ink-faint">Sem movimentações.</p> : open.movements.map((t) => (
                <div key={t.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="w-12 text-xs tabular-nums text-ink-faint">{fmtTime(t.paid_at)}</span>
                  <span className="min-w-0 flex-1 truncate">{t.description || t.category}{t.order_number && <span className="ml-1 text-xs text-ink-faint">OS {t.order_number}</span>}<span className="ml-2 text-xs text-ink-faint">{methodName(settings, t.method)}</span></span>
                  <span className={cx('tabular-nums font-medium', t.type === 'entrada' ? 'text-emerald-600' : 'text-red-600')}>{t.type === 'entrada' ? '+' : '−'}{money(t.amount)}</span>
                </div>
              ))}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Transferência entre contas (caixa, banco...): não conta como receita nem despesa. */
function Transfers() {
  const [accounts, setAccounts] = useState(null);
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(false);
  const load = useCallback(() => {
    api.get('/finance/accounts').then((a) => setAccounts(a.filter((x) => x.active))).catch(() => setAccounts([]));
    api.get(`/cash/transactions${qs({ category: 'Transferência entre contas' })}`).then((d) => setRows(d.items)).catch(() => setRows([]));
  }, []);
  useEffect(() => { load(); }, [load]);
  const pairs = Object.values((rows || []).reduce((acc, t) => {
    const k = t.transfer_id || t.id;
    acc[k] = acc[k] || { id: k, date: t.ref_date, amount: t.amount, description: t.description };
    if (t.type === 'saida') acc[k].from = t.account_name; else acc[k].to = t.account_name;
    return acc;
  }, {}));
  if (!accounts) return <Loading />;
  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center gap-3 p-4">
        <div className="min-w-0 flex-1 basis-72">
          <h3 className="font-semibold">Transferência entre contas</h3>
          <p className="text-sm text-ink-faint">Ex.: levar o dinheiro do caixa para o banco. Não entra como receita nem como despesa.</p>
        </div>
        <button className="btn-primary" disabled={accounts.length < 2} onClick={() => setOpen(true)}><ArrowLeftRight className="h-4 w-4" /> Nova transferência</button>
      </div>
      {accounts.length < 2 && <p className="text-sm text-amber-700">Cadastre pelo menos duas contas em <Link className="underline" to="/financeiro/gestao">Contas, conciliação e DRE</Link>.</p>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {accounts.map((a) => <Stat key={a.id} label={a.name} value={money(a.balance)} />)}
      </div>
      <div className="card overflow-hidden">
        <h3 className="border-b border-line px-5 py-3.5 font-semibold">Transferências feitas</h3>
        {!rows ? <Loading /> : !pairs.length ? <Empty icon={ArrowLeftRight} title="Nenhuma transferência ainda" /> : (
          <div className="divide-y divide-line">
            {pairs.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-sm">
                <span className="w-20 tabular-nums text-ink-faint">{fmt(p.date)}</span>
                <span className="min-w-0 flex-1">{p.from || '—'} → {p.to || '—'}{p.description && <span className="ml-2 text-xs text-ink-faint">{p.description}</span>}</span>
                <b className="tabular-nums">{money(p.amount)}</b>
              </div>
            ))}
          </div>
        )}
      </div>
      {open && <TransferModal accounts={accounts} onClose={() => setOpen(false)} onDone={() => { setOpen(false); load(); }} />}
    </div>
  );
}
