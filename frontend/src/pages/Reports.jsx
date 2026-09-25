import { useSearchParams } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { TrendingUp, TrendingDown, Wallet, ClipboardCheck, Timer, Target, Download, BadgePercent } from 'lucide-react';
import { api, qs } from '../lib/api';
import { money, num, qty, fmt, methodName, downloadCSV, ORDER_STATUS } from '../lib/format';
import { useAuth, useSettings } from '../context/AuthContext';
import { PageHeader, Tabs, Stat, Loading, Empty, Modal, MoneyInput, Select, useAction, FAIL, Avatar, cx } from '../components/ui';
import Management from './Management';
import { PeriodPicker, monthRange, HBar, InOutChart, useChartTheme } from '../components/charts';

export default function Reports() {
  const [params] = useSearchParams();
  const [tab, setTab] = useState(params.get('aba') || 'gestao');
  const [period, setPeriod] = useState(monthRange());
  return (
    <div>
      <PageHeader title="Relatórios" subtitle="Indicadores de gestão, resultado, produção da oficina, comissões e estoque" />
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Tabs value={tab} onChange={setTab} tabs={[
          { value: 'gestao', label: 'Indicadores de gestão' }, { value: 'financeiro', label: 'Financeiro' }, { value: 'producao', label: 'Produção' },
          { value: 'comissoes', label: 'Comissões' }, { value: 'estoque', label: 'Estoque' },
        ]} />
        {tab !== 'estoque' && <PeriodPicker value={period} onChange={setPeriod} />}
      </div>
      {tab === 'gestao' && <Management period={period} />}
      {tab === 'financeiro' && <Finance period={period} />}
      {tab === 'producao' && <Production period={period} />}
      {tab === 'comissoes' && <Commissions period={period} embedded />}
      {tab === 'estoque' && <Stock />}
    </div>
  );
}

function useReport(path, period) {
  const [data, setData] = useState(null);
  useEffect(() => { setData(null); api.get(`${path}${qs(period || {})}`).then(setData).catch(() => setData(false)); }, [path, period]);
  return data;
}

function Finance({ period }) {
  const settings = useSettings();
  const t = useChartTheme();
  const d = useReport('/reports/finance', period);
  if (d === null) return <Loading />;
  if (!d) return null;
  const exp = d.byCategory.filter((x) => x.type === 'saida');
  const inc = d.byCategory.filter((x) => x.type === 'entrada');
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Entradas" value={money(d.totals.income)} icon={TrendingUp} tone="text-emerald-500" />
        <Stat label="Saídas" value={money(d.totals.expense)} icon={TrendingDown} tone="text-red-500" />
        <Stat label="Saldo do período" value={money(d.totals.balance)} icon={Wallet} tone={d.totals.balance >= 0 ? 'text-emerald-500' : 'text-red-500'} />
        <Stat label="Margem bruta" value={d.dre.receita ? `${Math.round((d.dre.margem_bruta / d.dre.receita) * 100)}%` : '—'} hint="receita − custo dos materiais" />
      </div>
      <div className="card p-5"><h3 className="mb-2 font-semibold">Entradas × saídas por dia</h3><InOutChart data={d.byDay} /></div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card p-5">
          <h3 className="mb-3 font-semibold">DRE simplificada</h3>
          <dl className="space-y-2 text-sm">
            {[['Receita recebida', d.dre.receita, 'text-emerald-600'], ['(−) Custo dos materiais aplicados (CMV)', -d.dre.cmv], ['= Margem bruta', d.dre.margem_bruta, 'font-semibold'],
              ['(−) Despesas operacionais', -d.dre.despesas_operacionais], ['= Resultado', d.dre.resultado_competencia, 'font-semibold text-base']].map(([k, v, cls]) => (
              <div key={k} className={cx('flex justify-between border-b border-line/60 pb-2', cls)}><dt>{k}</dt><dd className={cx('tabular-nums', v < 0 && 'text-red-600')}>{money(v)}</dd></div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-ink-faint">Compras de estoque no período ({money(d.dre.compras_estoque)}) não entram como despesa: o custo é reconhecido quando o material é aplicado nas OS entregues.</p>
        </div>
        <div className="card p-5">
          <h3 className="mb-3 font-semibold">Recebimentos por forma de pagamento</h3>
          {!d.byMethod.length ? <p className="text-sm text-ink-faint">Sem recebimentos.</p> : <HBar rows={d.byMethod.map((m) => ({ name: methodName(settings, m.method), total: m.total }))} label="name" value="total" />}
        </div>
        <div className="card p-5">
          <h3 className="mb-3 font-semibold">Receitas por categoria</h3>
          {!inc.length ? <p className="text-sm text-ink-faint">Sem receitas.</p> : <HBar rows={inc} label="category" value="total" />}
        </div>
        <div className="card p-5">
          <h3 className="mb-3 font-semibold">Despesas por categoria</h3>
          {!exp.length ? <p className="text-sm text-ink-faint">Sem despesas.</p> : <HBar rows={exp} label="category" value="total" color={t.s[1]} />}
        </div>
      </div>
    </div>
  );
}

function Production({ period }) {
  const d = useReport('/reports/production', period);
  if (d === null) return <Loading />;
  if (!d) return null;
  const s = d.summary;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="OS entregues" value={s.os_n} hint={money(s.os_total)} icon={ClipboardCheck} tone="text-primary" />
        <Stat label="Vendas de balcão" value={s.sales_n} hint={money(s.sales_total)} />
        <Stat label="Tempo médio (entrada → entrega)" value={`${num(s.avg_days, 1)} dias`} icon={Timer} />
        <Stat label="Entregues no prazo" value={s.with_deadline ? `${Math.round((s.on_time / s.with_deadline) * 100)}%` : '—'} hint={`${s.on_time} de ${s.with_deadline} com prazo`} icon={Target} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card p-5">
          <h3 className="mb-3 font-semibold">Faturamento por tipo de serviço</h3>
          {!d.byCategory.length ? <p className="text-sm text-ink-faint">Sem serviços entregues.</p> : <HBar rows={d.byCategory} label="category" value="total" />}
        </div>
        <div className="card p-5">
          <h3 className="mb-3 font-semibold">Produção por técnico</h3>
          {!d.technicians.length ? <p className="text-sm text-ink-faint">Nenhum serviço atribuído a técnicos.</p> : (
            <ul className="space-y-3">
              {d.technicians.map((t) => (
                <li key={t.id} className="flex items-center gap-3 text-sm">
                  <Avatar name={t.name} color={t.color} />
                  <div className="min-w-0 flex-1"><div className="font-medium">{t.name}</div><div className="text-xs text-ink-faint">{t.orders} OS · comissão {money(t.commission)}</div></div>
                  <span className="font-semibold tabular-nums">{money(t.production)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="card">
          <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <h3 className="font-semibold">Serviços mais vendidos</h3>
            <button className="btn-ghost h-8 text-xs" disabled={!d.services.length} onClick={() => downloadCSV('servicos.csv', d.services)}><Download className="h-3.5 w-3.5" /></button>
          </div>
          {!d.services.length ? <Empty title="Sem dados" /> : (
            <table className="table-clean"><thead><tr><th>Serviço</th><th className="text-right">Qtd.</th><th className="text-right">Total</th></tr></thead>
              <tbody>{d.services.map((x) => <tr key={x.description}><td><div className="max-w-[260px] truncate">{x.description}</div><div className="text-xs text-ink-faint">{x.orders} OS</div></td><td className="text-right tabular-nums">{qty(x.qty)}</td><td className="text-right tabular-nums">{money(x.total)}</td></tr>)}</tbody>
            </table>
          )}
        </div>
        <div className="card">
          <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <h3 className="font-semibold">Materiais aplicados / vendidos</h3>
            <button className="btn-ghost h-8 text-xs" disabled={!d.materials.length} onClick={() => downloadCSV('materiais.csv', d.materials)}><Download className="h-3.5 w-3.5" /></button>
          </div>
          {!d.materials.length ? <Empty title="Sem dados" /> : (
            <table className="table-clean"><thead><tr><th>Material</th><th className="text-right">Qtd.</th><th className="text-right">Venda</th><th className="hidden text-right sm:table-cell">Margem</th></tr></thead>
              <tbody>{d.materials.map((x) => (
                <tr key={x.description}><td className="max-w-[220px] truncate">{x.description}</td><td className="text-right tabular-nums">{qty(x.qty)} {x.unit}</td><td className="text-right tabular-nums">{money(x.revenue)}</td>
                  <td className="hidden text-right tabular-nums text-ink-soft sm:table-cell">{x.revenue ? `${Math.round(((x.revenue - x.cost) / x.revenue) * 100)}%` : '—'}</td></tr>
              ))}</tbody>
            </table>
          )}
        </div>
        <div className="card">
          <h3 className="border-b border-line px-5 py-3.5 font-semibold">Melhores clientes</h3>
          {!d.customers.length ? <Empty title="Sem dados" /> : (
            <ul className="divide-y divide-line">{d.customers.map((c) => <li key={c.name} className="flex justify-between px-5 py-2.5 text-sm"><span className="truncate">{c.name} <span className="text-xs text-ink-faint">· {c.orders} OS</span></span><span className="tabular-nums">{money(c.total)}</span></li>)}</ul>
          )}
        </div>
        <div className="card p-5">
          <h3 className="mb-3 font-semibold">OS abertas no período por situação atual</h3>
          {!d.created.length ? <p className="text-sm text-ink-faint">Nenhuma OS aberta no período.</p> : (
            <ul className="space-y-2 text-sm">{d.created.map((c) => <li key={c.status} className="flex justify-between"><span className="flex items-center gap-2"><span className={cx('h-2 w-2 rounded-full', ORDER_STATUS[c.status]?.dot)} />{ORDER_STATUS[c.status]?.label}</span><b className="tabular-nums">{c.n}</b></li>)}</ul>
          )}
        </div>
      </div>
    </div>
  );
}

export function Commissions({ period: outer, embedded }) {
  const { can } = useAuth();
  const settings = useSettings();
  const [own, setOwn] = useState(monthRange());
  const period = outer || own;
  const [reload, setReload] = useState(0);
  const d = useReport('/reports/commissions', useMemo(() => ({ ...period, _r: reload }), [period, reload]));
  const [pay, setPay] = useState(null);
  const groups = useMemo(() => {
    if (!d) return [];
    const g = {};
    for (const i of d.items) {
      g[i.technician_id] ??= { id: i.technician_id, name: i.technician_name, items: [], total: 0 };
      g[i.technician_id].items.push(i);
      g[i.technician_id].total += i.commission_value;
    }
    const paid = Object.fromEntries(d.paid.map((p) => [p.technician_id, p.total]));
    return Object.values(g).map((x) => ({ ...x, paid: paid[x.id] || 0 }));
  }, [d]);
  const content = d === null ? <Loading /> : !groups.length ? <div className="card"><Empty icon={BadgePercent} title="Nenhuma comissão no período" text="Comissões são geradas pelos serviços das OS entregues." /></div> : (
    <div className="space-y-4">
      {groups.map((g) => (
        <div key={g.id} className="card">
          <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3.5">
            <Avatar name={g.name} />
            <div className="flex-1"><div className="font-semibold">{g.name}</div><div className="text-xs text-ink-faint">{g.items.length} serviço(s) · pago no período {money(g.paid)}</div></div>
            <div className="text-right"><div className="text-xs text-ink-faint">Comissão</div><div className="text-lg font-semibold tabular-nums">{money(g.total)}</div></div>
            {can('cash') && g.total - g.paid > 0.009 && <button className="btn-primary" onClick={() => setPay(g)}>Pagar {money(g.total - g.paid)}</button>}
          </div>
          <div className="overflow-x-auto">
            <table className="table-clean">
              <thead><tr><th>OS</th><th>Serviço</th><th className="hidden md:table-cell">Entrega</th><th className="text-right">Valor</th><th className="text-right">%</th><th className="text-right">Comissão</th></tr></thead>
              <tbody>{g.items.map((i, k) => (
                <tr key={k}><td><Link className="text-primary" to={`/os/${i.order_id}`}>#{i.number}</Link></td><td><div className="max-w-[260px] truncate">{i.description}</div><div className="text-xs text-ink-faint">{i.customer_name}</div></td>
                  <td className="hidden text-ink-soft md:table-cell">{fmt(i.delivered_at, 'dd/MM/yy')}</td><td className="text-right tabular-nums">{money(i.total)}</td>
                  <td className="text-right tabular-nums text-ink-soft">{Number(i.commission_rate)}%</td><td className="text-right font-medium tabular-nums">{money(i.commission_value)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
  return (
    <div>
      {!embedded && <PageHeader title="Comissões" subtitle="Comissões sobre os serviços das OS entregues" actions={<PeriodPicker value={own} onChange={setOwn} />} />}
      {content}
      {pay && <PayCommission g={pay} settings={settings} onClose={() => setPay(null)} onDone={() => { setPay(null); setReload((x) => x + 1); }} />}
    </div>
  );
}

function PayCommission({ g, settings, onClose, onDone }) {
  const [run, busy] = useAction();
  const [amount, setAmount] = useState(Math.round((g.total - g.paid) * 100) / 100);
  const [method, setMethod] = useState('pix');
  const go = async () => {
    const r = await run(() => api.post('/cash/transactions', { type: 'saida', category: 'Comissões', description: `Comissão — ${g.name}`, amount, method, paid: true, technician_id: g.id }), 'Pagamento de comissão lançado');
    if (r !== FAIL) onDone();
  };
  return (
    <Modal open onClose={onClose} size="sm" title={`Pagar comissão — ${g.name}`}
      footer={<><button className="btn-ghost" onClick={onClose}>Cancelar</button><button className="btn-primary" disabled={busy || amount <= 0} onClick={go}>Lançar pagamento</button></>}>
      <div className="space-y-4">
        <MoneyInput label="Valor" value={amount} onChange={setAmount} />
        <Select label="Forma" value={method} onChange={(e) => setMethod(e.target.value)}>{settings.paymentMethods?.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select>
      </div>
    </Modal>
  );
}

function Stock() {
  const d = useReport('/reports/stock');
  if (d === null) return <Loading />;
  if (!d) return null;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Valor total em estoque (custo)" value={money(d.total)} icon={Wallet} />
        <Stat label="Itens sem giro em 90 dias" value={d.items.filter((x) => x.stock > 0 && !x.out_90d).length} />
      </div>
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h3 className="font-semibold">Posição valorizada</h3>
          <button className="btn-outline h-8 text-xs" onClick={() => downloadCSV('estoque-valorizado.csv', d.items.map(({ id, ...x }) => x))}><Download className="h-3.5 w-3.5" /> CSV</button>
        </div>
        <div className="overflow-x-auto">
          <table className="table-clean">
            <thead><tr><th>Material</th><th className="text-right">Estoque</th><th className="hidden text-right md:table-cell">Custo médio</th><th className="text-right">Valor</th><th className="hidden text-right md:table-cell">Saída 90 dias</th><th className="hidden text-right lg:table-cell">Cobertura</th></tr></thead>
            <tbody>{d.items.map((x) => {
              const cover = x.out_90d > 0 ? Math.round(x.stock / (x.out_90d / 90)) : null;
              return (
                <tr key={x.id}><td><div className="max-w-[280px] truncate">{x.name}</div><div className="text-xs text-ink-faint">{x.category}</div></td>
                  <td className="text-right tabular-nums">{qty(x.stock)} {x.unit}</td><td className="hidden text-right tabular-nums text-ink-soft md:table-cell">{money(x.cost)}</td>
                  <td className="text-right font-medium tabular-nums">{money(x.value)}</td><td className="hidden text-right tabular-nums text-ink-soft md:table-cell">{qty(x.out_90d)}</td>
                  <td className={cx('hidden text-right tabular-nums lg:table-cell', cover !== null && cover < 15 && 'text-amber-600')}>{cover === null ? '—' : `${cover} dias`}</td></tr>
              );
            })}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
