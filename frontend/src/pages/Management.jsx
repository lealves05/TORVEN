// Indicadores de gestão: funil comercial, prazos, margem real por OS, retrabalho e produtividade por técnico.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Filter, Clock, TrendingUp, RotateCcw } from 'lucide-react';
import { api, qs } from '../lib/api';
import { money, docNumber } from '../lib/format';
import { useSettings } from '../context/AuthContext';
import { Loading, Stat, Empty, cx } from '../components/ui';
import { hm } from './Production';

const pct = (v) => (v == null ? '—' : `${String(v).replace('.', ',')}%`);
const days = (v) => (v == null ? '—' : `${String(v).replace('.', ',')} dias`);

export default function Management({ period }) {
  const settings = useSettings();
  const [d, setD] = useState(null);
  useEffect(() => { setD(null); api.get(`/reports/management${qs(period)}`).then(setD).catch(() => setD(false)); }, [period.from, period.to]); // eslint-disable-line
  if (d === null) return <Loading />;
  if (!d) return <Empty title="Não foi possível carregar os indicadores" />;
  const f = d.funnel;
  const steps = [['Solicitações', f.requests], ['Com orçamento', f.requests_quoted], ['Orçamentos enviados', f.quotes_sent], ['Aprovados', f.quotes_approved], ['OS entregues', f.orders_delivered]];
  const max = Math.max(1, ...steps.map((x) => x[1]));
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Aprovação de orçamentos" value={pct(f.quote_approval_pct)} hint={`${f.quotes_approved} aprovados · ${f.quotes_refused} recusados`} icon={Filter} />
        <Stat label="Margem real" value={pct(d.margin.margin_pct)} hint={`${money(d.margin.margin)} sobre ${money(d.margin.revenue)}`} icon={TrendingUp} />
        <Stat label="Entregas no prazo" value={pct(d.times.on_time_pct)} hint={`tempo médio da OS: ${days(d.times.order_days)}`} icon={Clock} />
        <Stat label="Retrabalho em garantia" value={pct(d.rework.rate_pct)} hint={`${d.rework.claims} chamado(s) no período`} icon={RotateCcw} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="mb-4 font-semibold">Funil comercial</h2>
          <div className="space-y-2">
            {steps.map(([l, n]) => (
              <div key={l} className="flex items-center gap-3 text-sm">
                <span className="w-40 shrink-0 text-ink-soft">{l}</span>
                <div className="h-6 flex-1 rounded-app-sm bg-muted"><div className="h-6 rounded-app-sm bg-primary/70" style={{ width: `${(n / max) * 100}%` }} /></div>
                <b className="w-10 text-right tabular-nums">{n}</b>
              </div>
            ))}
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-2 border-t border-line pt-3 text-sm">
            <div><dt className="text-xs text-ink-faint">Solicitação → orçamento enviado</dt><dd>{days(d.times.request_to_quote_days)}</dd></div>
            <div><dt className="text-xs text-ink-faint">Envio → aprovação</dt><dd>{days(d.times.quote_to_approval_days)}</dd></div>
            <div><dt className="text-xs text-ink-faint">Solicitações que viraram orçamento</dt><dd>{pct(f.request_to_quote_pct)}</dd></div>
            <div><dt className="text-xs text-ink-faint">Valor aprovado</dt><dd>{money(f.quotes_approved_value)}</dd></div>
          </dl>
        </section>
        <section className="card p-5">
          <h2 className="mb-3 font-semibold">Produtividade por técnico</h2>
          <table className="table-clean">
            <thead><tr><th>Técnico</th><th className="text-right">Horas</th><th className="text-right">OS</th><th className="text-right">Serviços</th><th className="text-right">R$/hora</th></tr></thead>
            <tbody>
              {d.technicians.map((t) => (
                <tr key={t.id}><td>{t.name}</td><td className="text-right tabular-nums">{hm(t.minutes)}</td><td className="text-right tabular-nums">{t.orders}</td>
                  <td className="text-right tabular-nums">{money(t.service_revenue)}</td><td className="text-right tabular-nums">{t.revenue_per_hour != null ? money(t.revenue_per_hour) : '—'}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3.5">
          <h2 className="font-semibold">OS entregues com menor margem</h2>
          <span className="text-xs text-ink-faint">Ticket médio {money(d.margin.avg_ticket)} · {d.margin.orders} OS</span>
        </div>
        {!d.margin.lowest.length ? <Empty title="Nenhuma OS entregue no período" /> : (
          <div className="overflow-x-auto">
            <table className="table-clean">
              <thead><tr><th>OS</th><th>Cliente</th><th className="text-right">Total</th><th className="hidden text-right md:table-cell">Materiais</th><th className="hidden text-right md:table-cell">Mão de obra</th><th className="hidden text-right md:table-cell">Terceiros/comissões</th><th className="text-right">Margem</th></tr></thead>
              <tbody>
                {d.margin.lowest.map((m) => (
                  <tr key={m.id}>
                    <td><Link to={`/os/${m.id}`} className="text-primary">{docNumber(settings, 'order', m.number)}</Link></td>
                    <td className="max-w-[200px] truncate">{m.customer_name}</td>
                    <td className="text-right tabular-nums">{money(m.total)}</td>
                    <td className="hidden text-right tabular-nums md:table-cell">{money(m.material_cost)}</td>
                    <td className="hidden text-right tabular-nums md:table-cell">{money(m.labor_cost)}<div className="text-xs text-ink-faint">{hm(m.labor_minutes)}</div></td>
                    <td className="hidden text-right tabular-nums md:table-cell">{money(Number(m.other_cost) + Number(m.commissions))}</td>
                    <td className={cx('text-right font-medium tabular-nums', m.margin < 0 && 'text-red-600')}>{money(m.margin)}<div className="text-xs">{pct(m.margin_pct)}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="border-t border-line px-5 py-2 text-xs text-ink-faint">{d.basis}</p>
      </section>
    </div>
  );
}
