import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  ClipboardList, AlertTriangle, PackageCheck, FileText, TrendingUp, ArrowDownCircle, ArrowUpCircle, PackageX, ArrowRight, Plus, ShoppingCart, Clock,
  MessageCircle, CheckCircle2, Circle, X, Rocket, HardHat,
} from 'lucide-react';
import { useState } from 'react';
import { api, appUrl } from '../lib/api';
import { money, fmt, qty, ORDER_STATUS, OPEN_STATUSES, PRIORITY, orderNo, fillTemplate, waLink, isTechnician } from '../lib/format';
import { useAuth, useSettings } from '../context/AuthContext';
import { Stat, Loading, Empty, useFetch, cx } from '../components/ui';
import { InOutChart } from '../components/charts';
import { CertBanner } from './Invoices';

export function StatusBadge({ status }) {
  const s = ORDER_STATUS[status] || {};
  return <span className={cx('chip whitespace-nowrap', s.cls)}><span className={cx('h-1.5 w-1.5 rounded-full', s.dot)} />{s.label || status}</span>;
}

/** Cartão "Primeiros passos": some quando tudo estiver feito ou quando o usuário dispensar. */
function FirstSteps({ setup, companyId }) {
  const key = `torven:primeiros-passos:${companyId}`;
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(key) === '1'; } catch { return false; } });
  if (!setup || hidden) return null;
  const steps = [
    { done: setup.company, label: 'Complete os dados da empresa', hint: 'CNPJ e telefone saem na OS impressa e no link do cliente.', to: '/configuracoes' },
    { done: setup.technicians, label: 'Cadastre seus técnicos', hint: 'Para dividir o serviço e medir as horas de cada um.', to: '/tecnicos' },
    { done: setup.services, label: 'Cadastre serviços e preços', hint: 'Assim a OS e o orçamento já saem com valor.', to: '/servicos' },
    { done: setup.customers, label: 'Cadastre um cliente', hint: 'Ou busque pela placa ao abrir a OS.', to: '/clientes' },
    { done: setup.orders, label: 'Abra a primeira OS', hint: 'Por formulário, foto da placa ou comando de voz.', to: '/os/nova' },
    { done: setup.quotes, label: 'Envie um orçamento por link', hint: 'O cliente aprova pelo celular, sem imprimir nada.', to: '/orcamentos/novo' },
  ];
  const done = steps.filter((s) => s.done).length;
  if (done === steps.length) return null;
  const dismiss = () => { try { localStorage.setItem(key, '1'); } catch { /* sem armazenamento */ } setHidden(true); };
  return (
    <section className="card p-5" aria-labelledby="fs-title">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"><Rocket className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1">
          <h2 id="fs-title" className="font-semibold">Primeiros passos</h2>
          <p className="text-sm text-ink-faint">{done} de {steps.length} concluídos — deixe a oficina pronta para o dia a dia.</p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done} aria-label="Progresso dos primeiros passos">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(done / steps.length) * 100}%` }} />
          </div>
        </div>
        <button className="btn-ghost btn-icon -mr-2 -mt-1" onClick={dismiss} aria-label="Dispensar primeiros passos" title="Dispensar"><X className="h-4 w-4" /></button>
      </div>
      <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {steps.map((s) => (
          <li key={s.to} className={cx(s.done && 'hidden sm:block')}>
            <Link to={s.to} className={cx('flex min-h-[3rem] items-start gap-2.5 rounded-app-sm border p-3 text-sm transition', s.done ? 'border-transparent bg-muted/60 text-ink-faint' : 'border-line hover:border-primary/50 hover:bg-primary/5')}>
              {s.done ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" />}
              <span className="min-w-0">
                <span className={cx('block font-medium', s.done ? 'line-through' : 'text-ink')}>{s.label}</span>
                {!s.done && <span className="block text-xs text-ink-faint">{s.hint}</span>}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function Dashboard() {
  const { user, can, company } = useAuth();
  const settings = useSettings();
  const { data, loading } = useFetch(() => api.get('/dashboard'), []);
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
  if (loading && !data) return <Loading />;
  if (!data) return null;
  const f = data.finance;
  const by = Object.fromEntries(data.byStatus.map((s) => [s.status, s]));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{greet}, {user.name.split(' ')[0]}</h1>
          <p className="text-sm first-letter:uppercase text-ink-faint">{format(new Date(), "EEEE, dd 'de' MMMM", { locale: ptBR })}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {can('time_log') && isTechnician(user) && <Link to="/meu-trabalho" className="btn-primary"><HardHat className="h-4 w-4" /> Meu trabalho</Link>}
          {can('orders_create') && can('checkout') && <Link to="/venda" className="btn-outline"><ShoppingCart className="h-4 w-4" /> Venda de balcão</Link>}
          {can('orders_create') && <Link to="/os/nova" className="btn-primary"><Plus className="h-4 w-4" /> Nova OS</Link>}
        </div>
      </div>

      <FirstSteps setup={data.setup} companyId={company?.id} />
      {can('fiscal_settings', 'invoices_issue') && <CertBanner company={company} />}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Link to="/os?status=abertas"><Stat label="OS em aberto" value={data.open} hint={`${by.em_execucao?.n || 0} em execução`} icon={ClipboardList} tone="text-primary" /></Link>
        <Link to="/os?view=lista&overdue=1"><Stat label="Atrasadas" value={data.overdue} hint="prazo de entrega vencido" icon={AlertTriangle} tone={data.overdue ? 'text-red-500' : undefined} /></Link>
        <Link to="/os?view=lista&status=pronta"><Stat label="Prontas p/ entrega" value={data.ready} hint={data.ready ? 'toque para ver e avisar o cliente' : 'nenhuma esperando o cliente'} icon={PackageCheck} tone="text-emerald-500" /></Link>
        {data.quotes
          ? <Link to="/orcamentos?status=pendentes"><Stat label="Orçamentos pendentes" value={data.quotes.n} hint={can('orders_values') ? money(data.quotes.total) : 'aguardando resposta'} icon={FileText} /></Link>
          : <Stat label="Aguardando aprovação" value={by.aguardando_aprovacao?.n || 0} icon={FileText} />}
      </div>

      {f && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Entradas no mês" value={money(f.month.income)} icon={ArrowDownCircle} tone="text-emerald-500" hint={`${f.delivered.n} OS/vendas entregues`} />
          <Stat label="Saídas no mês" value={money(f.month.expense)} icon={ArrowUpCircle} tone="text-red-500" />
          <Stat label="Resultado do mês" value={money(f.month.balance)} icon={TrendingUp} tone={f.month.balance >= 0 ? 'text-emerald-500' : 'text-red-500'} />
          <Link to="/financeiro?tab=contas"><Stat label="A receber / a pagar" value={`${money(f.pending.receivable)}`} hint={`a pagar ${money(f.pending.payable)}${f.pending.receivable_overdue > 0 ? ` · ${money(f.pending.receivable_overdue)} vencido` : ''}`} icon={Clock} /></Link>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="card lg:col-span-2">
          <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <h2 className="font-semibold">Próximas entregas</h2>
            <Link to="/os" className="flex items-center gap-1 text-sm text-primary">Quadro de OS <ArrowRight className="h-4 w-4" /></Link>
          </div>
          {!data.upcoming.length ? <Empty icon={ClipboardList} title="Nenhuma OS em aberto" /> : (
            <div className="divide-y divide-line">
              {data.upcoming.map((o) => {
                const late = o.promised_at && o.status !== 'pronta' && new Date(o.promised_at) < new Date();
                const wa = o.status === 'pronta' && o.customer_phone && waLink(o.customer_phone, fillTemplate(settings.whatsapp?.ready, {
                  cliente: o.customer_name?.split(' ')[0], numero: o.number, empresa: company.trade_name || company.name,
                  equipamento: o.equipment_description || '', total: o.total != null ? money(o.total) : '', status: ORDER_STATUS[o.status].label,
                  link: o.public_token ? appUrl(`/p/os/${o.public_token}`) : '',
                }));
                return (
                  <div key={o.id} className="relative flex items-center gap-3 px-5 py-3 hover:bg-muted/50">
                    <span className="w-[4.5rem] shrink-0 text-xs font-semibold tabular-nums text-ink-soft">{orderNo(settings, o)}</span>
                    <div className="min-w-0 flex-1">
                      <Link to={`/os/${o.id}`} className="block truncate text-sm font-medium after:absolute after:inset-0 after:content-['']">{o.customer_name || 'Sem cliente'}</Link>
                      <div className="truncate text-xs text-ink-faint">{o.equipment_description || '—'}{o.technician_name && ` · ${o.technician_name}`}</div>
                    </div>
                    {o.priority !== 'normal' && <span className={cx('hidden text-xs sm:block', PRIORITY[o.priority].cls)}>{PRIORITY[o.priority].label}</span>}
                    <span className="hidden sm:inline"><StatusBadge status={o.status} /></span>
                    {wa ? (
                      <a href={wa} target="_blank" rel="noreferrer" className="btn-outline relative z-10 h-9 shrink-0 px-2.5 text-xs" title="Avisar o cliente pelo WhatsApp que está pronta">
                        <MessageCircle className="h-4 w-4 text-emerald-600" /><span className="hidden sm:inline">Avisar</span>
                      </a>
                    ) : <span className="sm:hidden"><StatusBadge status={o.status} /></span>}
                    <span className={cx('hidden w-20 text-right text-xs tabular-nums sm:block', late ? 'font-medium text-red-600' : 'text-ink-faint')}>
                      {o.promised_at ? fmt(o.promised_at, 'dd/MM HH:mm') : 'sem prazo'}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="card p-5">
            <h2 className="mb-3 font-semibold">OS por etapa</h2>
            <div className="space-y-2">
              {OPEN_STATUSES.map((s) => {
                const n = by[s]?.n || 0;
                const max = Math.max(1, ...data.byStatus.map((x) => x.n));
                return (
                  <Link key={s} to={`/os?view=lista&status=${s}`} className="block">
                    <div className="mb-1 flex justify-between text-xs"><span className="text-ink-soft">{ORDER_STATUS[s].label}</span><span className="font-medium tabular-nums">{n}</span></div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className={cx('h-full rounded-full', ORDER_STATUS[s].dot)} style={{ width: `${(n / max) * 100}%` }} /></div>
                  </Link>
                );
              })}
            </div>
          </div>
          {data.lowStock && (
            <div className="card">
              <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
                <h2 className="font-semibold">Estoque baixo</h2>
                <Link to="/estoque?low=1" className="text-sm text-primary">Ver</Link>
              </div>
              {!data.lowStock.length ? <p className="px-5 py-4 text-sm text-ink-faint">Tudo acima do mínimo.</p> : (
                <ul className="divide-y divide-line">
                  {data.lowStock.map((p) => (
                    <li key={p.id} className="flex items-center gap-2 px-5 py-2.5 text-sm">
                      <PackageX className="h-4 w-4 shrink-0 text-amber-500" />
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      <span className={cx('tabular-nums', p.stock <= 0 ? 'text-red-600' : 'text-amber-600')}>{qty(p.stock)}</span>
                      <span className="text-xs text-ink-faint">/ {qty(p.min_stock)} {p.unit}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>

      {f && (
        <div className="card p-5">
          <h2 className="mb-2 font-semibold">Fluxo de caixa — últimos 30 dias</h2>
          <InOutChart data={f.series} />
        </div>
      )}
    </div>
  );
}
