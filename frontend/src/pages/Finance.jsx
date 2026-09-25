// Gestão financeira: contas e saldos, transferências, conciliação bancária, fluxo de caixa projetado e DRE gerencial.
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, ArrowLeftRight, Upload, Landmark, Wand2, CheckCircle2, Undo2, EyeOff, FilePlus2, Wallet } from 'lucide-react';
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { api } from '../lib/api';
import { money, fmt } from '../lib/format';
import { useAuth, useSettings } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import { PageHeader, Tabs, Input, Select, Loading, Empty, Modal, MoneyInput, Toggle, Stat, useAction, FAIL, cx } from '../components/ui';

const KIND = { caixa: 'Caixa', banco: 'Banco', cartao: 'Cartão', aplicacao: 'Aplicação', outro: 'Outro' };
const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

export default function Finance() {
  const [params, setParams] = useSearchParams();
  const { can } = useAuth();
  const tab = params.get('aba') || (can('cash') ? 'contas' : 'dre');
  return (
    <div>
      <PageHeader title="Gestão financeira" subtitle="Saldos por conta, conciliação com o extrato do banco, fluxo projetado e resultado do mês" />
      <Tabs value={tab} onChange={(t) => setParams({ aba: t })} tabs={[
        ...(can('cash') ? [{ value: 'contas', label: 'Contas' }, { value: 'conciliacao', label: 'Conciliação bancária' }, { value: 'fluxo', label: 'Fluxo projetado' }] : []),
        ...(can('reports') ? [{ value: 'dre', label: 'DRE gerencial' }] : []),
      ]} />
      {tab === 'contas' && <Accounts />}
      {tab === 'conciliacao' && <Reconciliation />}
      {tab === 'fluxo' && <Cashflow />}
      {tab === 'dre' && <Dre />}
    </div>
  );
}

function Accounts() {
  const [list, setList] = useState(null);
  const [edit, setEdit] = useState(null);
  const [transfer, setTransfer] = useState(false);
  const load = useCallback(() => api.get('/finance/accounts').then(setList).catch(() => setList([])), []);
  useEffect(() => { load(); }, [load]);
  if (!list) return <Loading />;
  const total = list.filter((a) => a.active).reduce((a, x) => a + Number(x.balance), 0);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-ink-soft">Saldo consolidado: <b className="text-base text-ink tabular-nums">{money(total)}</b></div>
        <div className="flex gap-2">
          <button className="btn-outline" onClick={() => setTransfer(true)}><ArrowLeftRight className="h-4 w-4" /> Transferir</button>
          <button className="btn-primary" onClick={() => setEdit({ name: '', kind: 'banco', opening_balance: 0, active: true })}><Plus className="h-4 w-4" /> Nova conta</button>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((a) => (
          <button key={a.id} onClick={() => setEdit({ ...a, opening_balance: Number(a.opening_balance) })} className={cx('card p-4 text-left hover:border-primary/40', !a.active && 'opacity-50')}>
            <div className="flex items-center gap-2">
              {a.kind === 'caixa' ? <Wallet className="h-4 w-4 text-ink-faint" /> : <Landmark className="h-4 w-4 text-ink-faint" />}
              <span className="font-semibold">{a.name}</span>
              <span className="ml-auto chip bg-muted text-ink-soft">{KIND[a.kind]}</span>
            </div>
            <div className={cx('mt-2 text-xl font-semibold tabular-nums', Number(a.balance) < 0 && 'text-red-600')}>{money(a.balance)}</div>
            <div className="text-xs text-ink-faint">
              {[a.bank_name, a.agency && `ag. ${a.agency}`, a.account_number && `cc ${a.account_number}`].filter(Boolean).join(' · ') || '—'}
              {a.is_default_cash && ' · padrão para dinheiro'}{a.is_default_bank && ' · padrão para PIX/cartão/boleto'}
            </div>
            {a.unreconciled > 0 && a.kind !== 'caixa' && <div className="mt-1 text-xs text-amber-700">{a.unreconciled} lançamento(s) sem conciliar</div>}
          </button>
        ))}
      </div>
      {edit && <AccountModal acc={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
      {transfer && <TransferModal accounts={list.filter((a) => a.active)} onClose={() => setTransfer(false)} onDone={() => { setTransfer(false); load(); }} />}
    </div>
  );
}

function AccountModal({ acc, onClose, onSaved }) {
  const [run, busy] = useAction();
  const [f, setF] = useState(acc);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    const body = { name: f.name, kind: f.kind, bank_name: f.bank_name || null, agency: f.agency || null, account_number: f.account_number || null,
      opening_balance: Number(f.opening_balance) || 0, is_default_cash: !!f.is_default_cash, is_default_bank: !!f.is_default_bank, active: f.active !== false };
    const r = await run(() => (acc.id ? api.put(`/finance/accounts/${acc.id}`, body) : api.post('/finance/accounts', body)), 'Conta salva');
    if (r !== FAIL) onSaved();
  };
  return (
    <Modal open onClose={onClose} title={acc.id ? 'Editar conta' : 'Nova conta'}
      footer={<><button className="btn-ghost" onClick={onClose}>Voltar</button><button className="btn-primary" disabled={busy || (f.name || '').trim().length < 2} onClick={save}>Salvar</button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Nome" value={f.name} onChange={set('name')} />
        <Select label="Tipo" value={f.kind} onChange={set('kind')}>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
        <Input label="Banco" value={f.bank_name || ''} onChange={set('bank_name')} />
        <div className="grid grid-cols-2 gap-2"><Input label="Agência" value={f.agency || ''} onChange={set('agency')} /><Input label="Conta" value={f.account_number || ''} onChange={set('account_number')} /></div>
        <div><span className="label">Saldo inicial</span><MoneyInput value={f.opening_balance} onChange={(v) => setF({ ...f, opening_balance: v })} /></div>
        <div className="space-y-1 sm:col-span-2">
          <Toggle checked={!!f.is_default_cash} onChange={(v) => setF({ ...f, is_default_cash: v })} label="Padrão para recebimentos em dinheiro" />
          <Toggle checked={!!f.is_default_bank} onChange={(v) => setF({ ...f, is_default_bank: v })} label="Padrão para PIX, cartão, boleto e transferências" />
          <Toggle checked={f.active !== false} onChange={(v) => setF({ ...f, active: v })} label="Ativa" />
        </div>
      </div>
    </Modal>
  );
}

function TransferModal({ accounts, onClose, onDone }) {
  const [run, busy] = useAction();
  const [f, setF] = useState({ from_id: accounts[0]?.id || '', to_id: accounts[1]?.id || '', amount: 0, date: new Date().toISOString().slice(0, 10), description: '' });
  const go = async () => { const r = await run(() => api.post('/finance/transfers', { ...f, description: f.description || null }), 'Transferência registrada'); if (r !== FAIL) onDone(); };
  return (
    <Modal open onClose={onClose} size="sm" title="Transferência entre contas" subtitle="Não entra como receita nem despesa"
      footer={<><button className="btn-ghost" onClick={onClose}>Voltar</button><button className="btn-primary" disabled={busy || !f.amount || f.from_id === f.to_id} onClick={go}>Transferir</button></>}>
      <div className="grid gap-3">
        <Select label="De" value={f.from_id} onChange={(e) => setF({ ...f, from_id: e.target.value })}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({money(a.balance)})</option>)}</Select>
        <Select label="Para" value={f.to_id} onChange={(e) => setF({ ...f, to_id: e.target.value })}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
        <div><span className="label">Valor</span><MoneyInput value={f.amount} onChange={(v) => setF({ ...f, amount: v })} /></div>
        <Input label="Data" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        <Input label="Descrição (opcional)" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      </div>
    </Modal>
  );
}

function Reconciliation() {
  const settings = useSettings();
  const [run, busy] = useAction();
  const [accounts, setAccounts] = useState([]);
  const [statements, setStatements] = useState(null);
  const [current, setCurrent] = useState(null);
  const [imp, setImp] = useState(false);
  const [create, setCreate] = useState(null);
  const [ignore, setIgnore] = useState(null);
  const [reason, setReason] = useState('');
  const loadList = useCallback(() => api.get('/finance/statements').then(setStatements).catch(() => setStatements([])), []);
  const open = useCallback((id) => api.get(`/finance/statements/${id}`).then(setCurrent), []);
  useEffect(() => { loadList(); api.get('/finance/accounts').then((a) => setAccounts(a.filter((x) => x.active))).catch(() => {}); }, [loadList]);
  const act = async (fn, msg) => { const r = await run(fn, msg); if (r !== FAIL) { open(current.id); loadList(); } };
  if (!statements) return <Loading />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-soft">Importe o extrato (OFX do internet banking ou CSV data;descrição;valor) e confirme cada lançamento.</p>
        <button className="btn-primary" onClick={() => setImp(true)}><Upload className="h-4 w-4" /> Importar extrato</button>
      </div>
      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <div className="card divide-y divide-line self-start">
          {!statements.length ? <p className="p-4 text-sm text-ink-faint">Nenhum extrato importado.</p> : statements.map((st) => (
            <button key={st.id} onClick={() => open(st.id)} className={cx('block w-full p-3 text-left text-sm hover:bg-muted', current?.id === st.id && 'bg-primary/10')}>
              <div className="font-medium">{st.account_name}</div>
              <div className="text-xs text-ink-faint">{fmt(st.period_start, 'dd/MM')}–{fmt(st.period_end, 'dd/MM/yy')} · {st.lines_count} linha(s)</div>
              {st.pending > 0 ? <div className="text-xs text-amber-700">{st.pending} pendente(s)</div> : <div className="text-xs text-emerald-700">conciliado</div>}
            </button>
          ))}
        </div>
        <div>
          {!current ? <div className="card"><Empty icon={Landmark} title="Selecione um extrato" /></div> : (
            <div className="card overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
                <div className="font-semibold">{current.account_name} · {current.filename || current.format.toUpperCase()}</div>
                <button className="btn-outline h-8 text-xs" disabled={busy} onClick={() => act(() => api.post(`/finance/statements/${current.id}/auto`), 'Conciliação automática concluída')}><Wand2 className="h-3.5 w-3.5" /> Conciliar automaticamente</button>
              </div>
              <ul className="divide-y divide-line text-sm">
                {current.lines.map((l) => (
                  <li key={l.id} className="p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="w-16 text-xs tabular-nums text-ink-faint">{fmt(l.posted_on, 'dd/MM')}</span>
                      <span className="min-w-0 flex-1 truncate">{l.description || '—'}</span>
                      <span className={cx('font-medium tabular-nums', l.amount < 0 ? 'text-red-600' : 'text-emerald-700')}>{money(l.amount)}</span>
                      {l.status === 'conciliado' && <span className="chip bg-emerald-500/15 text-emerald-700"><CheckCircle2 className="h-3 w-3" /> {l.tx_description || l.tx_category}</span>}
                      {l.status === 'ignorado' && <span className="chip bg-muted text-ink-faint">Ignorado</span>}
                      {l.status !== 'pendente' && <button className="btn-ghost btn-icon h-7" title="Desfazer" aria-label="Desfazer" onClick={() => act(() => api.post(`/finance/lines/${l.id}/undo`), 'Desfeito')}><Undo2 className="h-3.5 w-3.5" /></button>}
                    </div>
                    {l.status === 'pendente' && (
                      <div className="mt-2 space-y-1 pl-16">
                        {l.candidates.map((c) => (
                          <div key={c.id} className="flex flex-wrap items-center gap-2 rounded-app-sm bg-muted/50 px-2 py-1.5 text-xs">
                            <span className="flex-1">{c.description || c.category}{c.customer_name && ` · ${c.customer_name}`}{c.supplier_name && ` · ${c.supplier_name}`}{c.order_number && ` · OS ${c.order_number}`}
                              <span className="text-ink-faint"> · {c.paid_at ? `pago ${fmt(c.paid_at, 'dd/MM')}` : `vence ${fmt(c.due_date, 'dd/MM')} (será baixado)`}</span></span>
                            <button className="btn-outline h-7 text-xs" disabled={busy} onClick={() => act(() => api.post(`/finance/lines/${l.id}/match`, { transaction_id: c.id }), 'Conciliado')}>Conciliar</button>
                          </div>
                        ))}
                        <div className="flex flex-wrap gap-2">
                          <button className="btn-ghost h-7 text-xs" onClick={() => setCreate(l)}><FilePlus2 className="h-3.5 w-3.5" /> Lançar novo</button>
                          <button className="btn-ghost h-7 text-xs text-ink-faint" onClick={() => { setReason(''); setIgnore(l); }}><EyeOff className="h-3.5 w-3.5" /> Ignorar</button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
      {imp && <ImportModal accounts={accounts} onClose={() => setImp(false)} onDone={(st) => { setImp(false); loadList(); open(st.id); }} />}
      {ignore && (
        <Modal open onClose={() => setIgnore(null)} size="sm" title="Ignorar lançamento do extrato" subtitle={`${fmt(ignore.posted_on)} · ${money(ignore.amount)}`}
          footer={<><button className="btn-ghost" onClick={() => setIgnore(null)}>Voltar</button><button className="btn-primary" disabled={busy || reason.trim().length < 3}
            onClick={async () => { await act(() => api.post(`/finance/lines/${ignore.id}/ignore`, { reason }), 'Ignorado'); setIgnore(null); }}>Ignorar</button></>}>
          <Input label="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: estorno automático do banco, lançamento duplicado" />
        </Modal>
      )}
      {create && <CreateFromLine line={create} settings={settings} onClose={() => setCreate(null)} onDone={() => { setCreate(null); open(current.id); loadList(); }} />}
    </div>
  );
}

function ImportModal({ accounts, onClose, onDone }) {
  const { toast } = useUI();
  const [run, busy] = useAction();
  const [account, setAccount] = useState(accounts.find((a) => a.kind === 'banco')?.id || accounts[0]?.id || '');
  const [file, setFile] = useState(null);
  const pick = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 2_500_000) { toast('Arquivo muito grande.', 'error'); return; }
    const r = new FileReader();
    r.onload = () => setFile({ name: f.name, content: String(r.result) });
    r.readAsText(f, /\.ofx$/i.test(f.name) ? 'latin1' : 'utf-8');
  };
  const go = async () => {
    const r = await run(() => api.post('/finance/statements', { account_id: account, filename: file.name, content: file.content }), 'Extrato importado');
    if (r !== FAIL) onDone(r);
  };
  return (
    <Modal open onClose={onClose} size="sm" title="Importar extrato"
      footer={<><button className="btn-ghost" onClick={onClose}>Voltar</button><button className="btn-primary" disabled={busy || !file || !account} onClick={go}>Importar</button></>}>
      <div className="space-y-3 text-sm">
        <Select label="Conta" value={account} onChange={(e) => setAccount(e.target.value)}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
        <input type="file" accept=".ofx,.csv,.txt" onChange={pick} aria-label="Arquivo do extrato" />
        <p className="text-xs text-ink-faint">Lançamentos já importados (mesmo identificador do banco) são ignorados automaticamente.</p>
      </div>
    </Modal>
  );
}

function CreateFromLine({ line, settings, onClose, onDone }) {
  const [run, busy] = useAction();
  const cats = line.amount > 0 ? settings.incomeCategories || [] : ['Tarifas bancárias', ...(settings.expenseCategories || [])];
  const [f, setF] = useState({ category: cats[0] || '', description: line.description || '' });
  const go = async () => { const r = await run(() => api.post(`/finance/lines/${line.id}/create`, f), 'Lançado e conciliado'); if (r !== FAIL) onDone(); };
  return (
    <Modal open onClose={onClose} size="sm" title="Lançar a partir do extrato" subtitle={`${fmt(line.posted_on)} · ${money(line.amount)}`}
      footer={<><button className="btn-ghost" onClick={onClose}>Voltar</button><button className="btn-primary" disabled={busy || !f.category} onClick={go}>Lançar</button></>}>
      <div className="grid gap-3">
        <Select label="Categoria" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{[...new Set(cats)].map((c) => <option key={c}>{c}</option>)}</Select>
        <Input label="Descrição" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      </div>
    </Modal>
  );
}

function Cashflow() {
  const [days, setDays] = useState(90);
  const [data, setData] = useState(null);
  useEffect(() => { setData(null); api.get(`/finance/cashflow?days=${days}`).then(setData).catch(() => {}); }, [days]);
  if (!data) return <Loading />;
  const chart = data.weeks.map((w) => ({ semana: fmt(w.week, 'dd/MM'), Entradas: Number(w.inflow), Saídas: -Number(w.outflow), Saldo: w.balance }));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {[30, 60, 90, 180].map((d) => <button key={d} onClick={() => setDays(d)} className={cx('btn border text-xs', days === d ? 'border-primary bg-primary/10 text-primary' : 'border-line')}>{d} dias</button>)}
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Saldo hoje (todas as contas)" value={money(data.current)} />
        <Stat label="Saldo projetado" value={money(data.projected)} tone={data.projected < 0 ? 'text-red-500' : undefined} />
        <Stat label="A receber vencido" value={money(data.overdue.receivable)} tone="text-amber-500" />
        <Stat label="A pagar vencido" value={money(data.overdue.payable)} tone="text-red-500" />
      </div>
      <div className="card p-4">
        {!chart.length ? <Empty icon={Wallet} title="Nada a receber ou pagar no período" /> : (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chart} margin={{ left: 8, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--line))" vertical={false} />
                <XAxis dataKey="semana" tick={{ fontSize: 11 }} stroke="rgb(var(--ink-faint))" />
                <YAxis tick={{ fontSize: 11 }} stroke="rgb(var(--ink-faint))" tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                <Tooltip formatter={(v) => money(Math.abs(v))} />
                <Legend />
                <Bar dataKey="Entradas" fill="#16a34a" radius={[3, 3, 0, 0]} />
                <Bar dataKey="Saídas" fill="#dc2626" radius={[0, 0, 3, 3]} />
                <Line dataKey="Saldo" stroke="rgb(var(--primary))" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
      {data.overdue.receivable > 0 || data.overdue.payable > 0 ? <p className="text-xs text-ink-faint">A projeção considera só o que vence a partir de hoje; valores vencidos aparecem à parte.</p> : null}
    </div>
  );
}

function Dre() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [data, setData] = useState(null);
  useEffect(() => { setData(null); api.get(`/finance/dre?year=${year}`).then(setData).catch(() => {}); }, [year]);
  if (!data) return <Loading />;
  const rows = [
    ['Receita bruta', 'receita', true], ['(−) Deduções (taxas, impostos, estornos)', 'deducoes'], ['= Receita líquida', 'receita_liquida', true],
    ['(−) Custo dos materiais (CMV)', 'cmv'], ['(−) Comissões', 'comissoes'], ['= Lucro bruto', 'lucro_bruto', true],
    ['(−) Despesas operacionais', 'despesas'], ['= Resultado', 'resultado', true],
  ];
  const cats = [...new Set(data.months.flatMap((m) => Object.keys(m.despesas_por_categoria)))].sort();
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button className="btn-outline h-8" onClick={() => setYear(year - 1)}>‹</button><b>{year}</b><button className="btn-outline h-8" onClick={() => setYear(year + 1)}>›</button>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[900px] text-xs">
          <thead className="bg-muted/50 text-ink-faint"><tr><th className="px-3 py-2 text-left">DRE gerencial</th>{MONTHS.map((m) => <th key={m} className="px-2 py-2 text-right">{m}</th>)}<th className="px-3 py-2 text-right">Total</th></tr></thead>
          <tbody className="divide-y divide-line">
            {rows.map(([label, k, strong]) => (
              <tr key={k} className={cx(strong && 'bg-muted/30 font-semibold')}>
                <td className="px-3 py-1.5">{label}</td>
                {data.months.map((m) => <td key={m.month} className={cx('px-2 py-1.5 text-right tabular-nums', k === 'resultado' && m[k] < 0 && 'text-red-600')}>{m[k] ? money(m[k]).replace('R$', '').trim() : '—'}</td>)}
                <td className={cx('px-3 py-1.5 text-right tabular-nums', k === 'resultado' && data.total[k] < 0 && 'text-red-600')}>{money(data.total[k])}</td>
              </tr>
            ))}
            {cats.map((c) => (
              <tr key={c} className="text-ink-faint">
                <td className="px-3 py-1 pl-6">{c}</td>
                {data.months.map((m) => <td key={m.month} className="px-2 py-1 text-right tabular-nums">{m.despesas_por_categoria[c] ? money(m.despesas_por_categoria[c]).replace('R$', '').trim() : ''}</td>)}
                <td className="px-3 py-1 text-right tabular-nums">{money(data.months.reduce((a, m) => a + (m.despesas_por_categoria[c] || 0), 0))}</td>
              </tr>
            ))}
            <tr className="text-ink-faint"><td className="px-3 py-1.5">Informativo: compras de materiais (estoque)</td>{data.months.map((m) => <td key={m.month} className="px-2 py-1.5 text-right tabular-nums">{m.compras_materiais ? money(m.compras_materiais).replace('R$', '').trim() : ''}</td>)}<td className="px-3 py-1.5 text-right tabular-nums">{money(data.total.compras_materiais)}</td></tr>
            <tr className="text-ink-faint"><td className="px-3 py-1.5">Informativo: mão de obra apontada nas OS</td>{data.months.map((m) => <td key={m.month} className="px-2 py-1.5 text-right tabular-nums">{m.mao_de_obra_apontada ? money(m.mao_de_obra_apontada).replace('R$', '').trim() : ''}</td>)}<td className="px-3 py-1.5 text-right tabular-nums">{money(data.total.mao_de_obra_apontada)}</td></tr>
          </tbody>
        </table>
      </div>
      <p className="text-xs text-ink-faint">{data.basis} Não substitui a contabilidade oficial.</p>
    </div>
  );
}
