// "Meu trabalho": tela do técnico no chão de fábrica — as OS dele e botões grandes para
// iniciar/pausar/concluir o serviço, lançar material e tirar foto. Usa os endpoints já existentes.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Play, Pause, CheckCircle2, Package, Camera, HardHat, ChevronRight, Timer, Clock, RefreshCw } from 'lucide-react';
import { api, qs } from '../lib/api';
import { fmt, ORDER_STATUS, PRIORITY, orderNo, isTechnician } from '../lib/format';
import { useAuth, useSettings } from '../context/AuthContext';
import { useCatalog } from '../context/CatalogContext';
import { useUI } from '../context/UIContext';
import { PageHeader, Loading, Empty, Modal, useAction, FAIL, cx } from '../components/ui';
import Attachments from '../components/Attachments';
import { StatusBadge } from './Dashboard';
import { Elapsed, ACTIVITY, hm } from './Production';

const PRIO = { urgente: 0, alta: 1, normal: 2, baixa: 3 };
// antes da aprovação o tempo vai como diagnóstico (a API não aceita "execução" aguardando aprovação)
const activityFor = (status) => (['aberta', 'diagnostico', 'aguardando_aprovacao'].includes(status) ? 'diagnostico' : 'execucao');
const TECH_KEY = 'torven:meu-trabalho:tecnico';

export default function MyWork() {
  const { user, can } = useAuth();
  const settings = useSettings();
  const { technicians } = useCatalog();
  const { confirm, toast } = useUI();
  const [run, busy] = useAction();
  // técnico vinculado ao usuário; gestor sem vínculo escolhe de quem é a tela (lembrado neste aparelho)
  const [picked, setPicked] = useState(() => { try { return localStorage.getItem(TECH_KEY) || ''; } catch { return ''; } });
  const techId = user.technician_id || picked;
  const tech = technicians.find((t) => t.id === techId);
  const [orders, setOrders] = useState(null);
  const [running, setRunning] = useState(null);
  const [minutes, setMinutes] = useState(0);
  const [photo, setPhoto] = useState(null);

  const load = useCallback(async () => {
    if (!techId) { setOrders([]); return; }
    try {
      const [list, board] = await Promise.all([
        api.get(`/orders${qs({ status: 'abertas', kind: 'os', technician_id: techId })}`),
        api.get('/production/board'),
      ]);
      const t = board.technicians.find((x) => x.id === techId);
      setRunning(t?.log_id ? { id: t.log_id, order_id: t.order_id, started_at: t.log_started_at, activity: t.log_activity, order_number: t.order_number, customer_name: t.customer_name } : null);
      setMinutes(Number(t?.minutes_today) || 0);
      setOrders([...list].sort((a, b) => (a.id === t?.order_id ? -1 : b.id === t?.order_id ? 1 : 0)
        || (PRIO[a.priority] ?? 2) - (PRIO[b.priority] ?? 2)
        || (a.promised_at ? new Date(a.promised_at) : Infinity) - (b.promised_at ? new Date(b.promised_at) : Infinity)));
    } catch (e) { toast(e.message, 'error'); setOrders([]); }
  }, [techId, toast]);
  useEffect(() => { setOrders(null); load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);
  // comandos de voz alteram o apontamento fora desta tela
  useEffect(() => { const h = () => load(); window.addEventListener('torven:order-changed', h); return () => window.removeEventListener('torven:order-changed', h); }, [load]);

  const pick = (id) => { setPicked(id); try { localStorage.setItem(TECH_KEY, id); } catch { /* sem armazenamento */ } };

  const start = async (o) => {
    const activity = activityFor(o.status);
    if (running && running.order_id !== o.id) {
      const ok = await confirm({ title: 'Trocar de serviço?', message: `O cronômetro de ${orderNo(settings, running.order_number)} será pausado e o desta OS começa agora.`, confirmText: 'Trocar', danger: false });
      if (!ok) return;
    }
    const r = await run(() => api.post(`/production/orders/${o.id}/time/start`, { technician_id: techId, activity }), `${ACTIVITY[activity]} iniciado em ${orderNo(settings, o)}`);
    if (r !== FAIL) load();
  };
  const pause = async () => {
    const r = await run(() => api.post(`/production/time/${running.id}/stop`, {}), 'Cronômetro pausado');
    if (r !== FAIL) load();
  };
  const finish = async (o) => {
    const ok = await confirm({ title: `Concluir ${orderNo(settings, o)}?`, message: 'O cronômetro para e a OS vai para "Pronta p/ entrega" — o atendimento avisa o cliente.', confirmText: 'Concluir serviço', danger: false });
    if (!ok) return;
    const r = await run(async () => {
      if (running?.order_id === o.id) await api.post(`/production/time/${running.id}/stop`, {});
      return api.post(`/orders/${o.id}/status`, { status: 'pronta' });
    }, `${orderNo(settings, o)} pronta para entrega`);
    load(); // atualiza mesmo se a etapa for recusada (ex.: inspeção obrigatória) — o cronômetro já parou
    return r;
  };

  const manager = !isTechnician(user) && !user.technician_id;
  return (
    <div>
      <PageHeader title="Meu trabalho" subtitle={tech ? `${tech.name} · hoje ${hm(minutes)} apontadas` : 'Suas OS e o cronômetro do dia'}
        actions={<button className="btn-outline" onClick={load} aria-label="Atualizar"><RefreshCw className="h-4 w-4" /> Atualizar</button>} />

      {manager && (
        <div className="card mb-4 flex flex-wrap items-center gap-3 p-4">
          <HardHat className="h-5 w-5 text-ink-faint" />
          <label className="flex flex-1 flex-wrap items-center gap-2 text-sm">
            <span className="text-ink-soft">Ver como o técnico</span>
            <select className="input w-auto min-w-[12rem]" value={picked} onChange={(e) => pick(e.target.value)}>
              <option value="">Escolha…</option>
              {technicians.filter((t) => t.active !== false).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <p className="w-full text-xs text-ink-faint">Seu usuário não está vinculado a um técnico. Para cada técnico usar esta tela no celular, vincule o usuário dele em Configurações › Usuários.</p>
        </div>
      )}

      {!techId ? (
        !manager && <div className="card"><Empty icon={HardHat} title="Usuário sem técnico vinculado" text="Peça ao administrador para vincular seu usuário a um técnico em Configurações › Usuários." /></div>
      ) : !orders ? <Loading /> : (
        <div className="space-y-4">
          {running && (
            <section className="card border-emerald-500/40 bg-emerald-500/5 p-4" aria-live="polite">
              <div className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-300">
                <Timer className="h-5 w-5" /> {ACTIVITY[running.activity]} em andamento
              </div>
              <div className="mt-1 text-3xl font-semibold tabular-nums tracking-tight"><Elapsed since={running.started_at} /></div>
              <Link to={`/os/${running.order_id}`} className="mt-1 block truncate text-sm text-primary">{orderNo(settings, running.order_number)} · {running.customer_name}</Link>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button className="btn-outline tap text-base" disabled={busy} onClick={pause}><Pause className="h-5 w-5" /> Pausar</button>
                {can('orders_edit') && <button className="btn-primary tap text-base" disabled={busy} onClick={() => finish(orders.find((x) => x.id === running.order_id) || { id: running.order_id, number: running.order_number })}><CheckCircle2 className="h-5 w-5" /> Concluir</button>}
              </div>
            </section>
          )}

          {!orders.length ? (
            <div className="card"><Empty icon={CheckCircle2} title="Nenhuma OS com você agora" text="Quando o atendimento atribuir uma OS ao seu nome, ela aparece aqui." /></div>
          ) : (
            <ul className="space-y-3">
              {orders.map((o) => {
                const here = running?.order_id === o.id;
                const late = o.promised_at && o.status !== 'pronta' && new Date(o.promised_at) < new Date();
                const activity = activityFor(o.status);
                return (
                  <li key={o.id} className={cx('card p-4', here && 'ring-2 ring-emerald-500/40')}>
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-semibold tabular-nums">{orderNo(settings, o)}</span>
                          <StatusBadge status={o.status} />
                          {o.priority !== 'normal' && <span className={PRIORITY[o.priority].cls}>{PRIORITY[o.priority].label}</span>}
                        </div>
                        <div className="mt-1 truncate text-base font-medium">{o.customer_name || 'Sem cliente'}</div>
                        <div className="truncate text-sm text-ink-soft">{[o.equipment_description, o.equipment_brand].filter(Boolean).join(' · ') || o.problem || '—'}</div>
                        <div className={cx('mt-1 flex items-center gap-1 text-xs', late ? 'font-medium text-red-600' : 'text-ink-faint')}>
                          <Clock className="h-3.5 w-3.5" />{o.promised_at ? `prazo ${fmt(o.promised_at, 'dd/MM HH:mm')}` : 'sem prazo'}{late && ' · atrasada'}
                        </div>
                      </div>
                      <Link to={`/os/${o.id}`} className="btn-ghost btn-icon shrink-0" aria-label={`Abrir ${orderNo(settings, o)}`} title="Abrir a OS"><ChevronRight className="h-5 w-5" /></Link>
                    </div>
                    {o.problem && <p className="mt-2 line-clamp-2 rounded-app-sm bg-muted/60 px-3 py-2 text-sm text-ink-soft">{o.problem}</p>}
                    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {here ? (
                        <button className="btn-outline tap" disabled={busy} onClick={pause}><Pause className="h-5 w-5" /> Pausar</button>
                      ) : can('time_log') && o.status !== 'pronta' && (
                        <button className="btn-primary tap" disabled={busy} onClick={() => start(o)} title={`Liga o cronômetro como ${ACTIVITY[activity].toLowerCase()}`}>
                          <Play className="h-5 w-5" /> {activity === 'diagnostico' ? 'Iniciar diagnóstico' : 'Iniciar'}
                        </button>
                      )}
                      {can('orders_edit') && ['em_execucao', 'aprovada', 'aguardando_material'].includes(o.status) && (
                        <button className="btn-outline tap" disabled={busy} onClick={() => finish(o)}><CheckCircle2 className="h-5 w-5 text-emerald-600" /> Concluir</button>
                      )}
                      {can('orders_edit') && <Link to={`/os/${o.id}#itens`} className="btn-outline tap"><Package className="h-5 w-5" /> Material</Link>}
                      <button className="btn-outline tap" onClick={() => setPhoto(o)}><Camera className="h-5 w-5" /> Foto</button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="text-center text-xs text-ink-faint">Dica: com as mãos ocupadas, use o botão de microfone no topo — “iniciar apontamento na OS 12”, “parar apontamento”.</p>
        </div>
      )}

      {photo && (
        <Modal open onClose={() => setPhoto(null)} title={`Fotos — ${orderNo(settings, photo)}`} subtitle={ORDER_STATUS[photo.status]?.label} confirmClose={false}
          footer={<button className="btn-primary" onClick={() => setPhoto(null)}>Pronto</button>}>
          <Attachments entity="order" entityId={photo.id} canEdit={can('orders_edit', 'orders_create')} compact title="Fotos e documentos da OS" />
        </Modal>
      )}
    </div>
  );
}
