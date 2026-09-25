import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Receipt, RefreshCw, ExternalLink, FileCode2, XCircle, Trash2, Plus, Settings2, Printer } from 'lucide-react';
import { api, qs, appPath } from '../lib/api';
import { money, fmt, fmtDateTime, INVOICE_STATUS, downloadCSV, docNumber } from '../lib/format';
import { useAuth, useSettings } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import { PageHeader, Input, Modal, Loading, Empty, Stat, useAction, FAIL, cx } from '../components/ui';
import { PeriodPicker, monthRange } from '../components/charts';
import InvoiceModal from '../components/InvoiceModal';

export default function Invoices() {
  const { can, company } = useAuth();
  const { confirm, toast } = useUI();
  const [run, busy] = useAction();
  const [period, setPeriod] = useState(monthRange());
  const [f, setF] = useState({ kind: '', status: '', search: '' });
  const [list, setList] = useState(null);
  const [cancel, setCancel] = useState(null);
  const [view, setView] = useState(null);
  const [pick, setPick] = useState(false);
  const [emitFor, setEmitFor] = useState(null);
  const load = useCallback(() => api.get(`/invoices${qs({ ...f, ...period })}`).then(setList), [f, period]);
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);

  const refresh = async (i) => {
    const r = await run(() => api.post(`/invoices/${i.id}/refresh`));
    if (r !== FAIL) { toast(`Situação: ${INVOICE_STATUS[r.status]?.label}${r.status === 'erro' ? ` — ${r.message}` : ''}`, r.status === 'erro' ? 'error' : 'success'); load(); }
  };
  const discard = async (i) => {
    if (!(await confirm({ title: 'Descartar documento?', message: 'Libera a OS para uma nova emissão.', confirmText: 'Descartar' }))) return;
    if ((await run(() => api.del(`/invoices/${i.id}`), 'Nota descartada')) !== FAIL) load();
  };
  const valid = (list || []).filter((i) => i.status === 'autorizada' && !i.test);
  const focus = company.fiscal_provider === 'focus';

  return (
    <div>
      <PageHeader title="Notas fiscais" subtitle="NFS-e dos serviços e NF-e dos materiais emitidas a partir das OS e vendas"
        actions={<>
          {can('fiscal_settings') && <Link to="/configuracoes?tab=fiscal" className="btn-outline"><Settings2 className="h-4 w-4" /> Configuração fiscal</Link>}
          {can('invoices_issue') && <button className="btn-primary" onClick={() => setPick(true)}><Plus className="h-4 w-4" /> Emitir nota</button>}
        </>} />
      {!focus && (
        <div className="mb-4 rounded-app border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-800 dark:text-sky-200">
          <b>Emissão indisponível: integração fiscal não configurada.</b> Por enquanto é possível apenas preparar documentos para conferência (sem número e sem valor fiscal). {can('fiscal_settings') && <Link to="/configuracoes?tab=fiscal" className="font-medium underline">Configurar agora (passo a passo)</Link>}
        </div>
      )}
      <CertBanner company={company} />
      {focus && company.fiscal_environment !== 'producao' && (
        <div className="mb-4 rounded-app border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
          Focus NFe em <b>homologação</b>: as notas emitidas são de teste e não têm validade fiscal.
        </div>
      )}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>
      {list && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Notas autorizadas" value={valid.length} icon={Receipt} />
          <Stat label="Serviços (NFS-e)" value={money(valid.filter((i) => i.kind === 'nfse').reduce((a, i) => a + i.amount, 0))} />
          <Stat label="Materiais (NF-e)" value={money(valid.filter((i) => i.kind === 'nfe').reduce((a, i) => a + i.amount, 0))} />
          <Stat label="Preparadas / erro / processando" value={list.filter((i) => ['erro', 'processando', 'preparada'].includes(i.status)).length} tone="text-amber-500" />
        </div>
      )}
      {can('invoices_issue') && <ToInvoice period={period} onEmit={async (id) => setEmitFor(await api.get(`/orders/${id}`))} reloadKey={list} />}
      <div className="card mb-4 flex flex-wrap items-end gap-3 p-3">
        <input className="input min-w-[200px] flex-1" placeholder="Cliente ou número…" value={f.search} onChange={(e) => setF({ ...f, search: e.target.value })} />
        <select className="input w-40" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="">NFS-e e NF-e</option><option value="nfse">NFS-e</option><option value="nfe">NF-e</option></select>
        <select className="input w-40" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
          <option value="">Todas</option>{Object.entries(INVOICE_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <button className="btn-outline" disabled={!list?.length} onClick={() => downloadCSV('notas-fiscais.csv', list.map((i) => ({
          Tipo: i.kind.toUpperCase(), Numero: i.number, Serie: i.series, Chave: i.access_key, Situacao: INVOICE_STATUS[i.status]?.label, Cliente: i.customer_name,
          OS: i.order_number, Valor: i.amount, Emissao: fmt(i.issued_at || i.created_at),
        })))}>CSV</button>
      </div>
      <div className="card overflow-hidden">
        {!list ? <Loading /> : !list.length ? <Empty icon={Receipt} title="Nenhuma nota no período" /> : (
          <div className="overflow-x-auto">
            <table className="table-clean">
              <thead><tr><th>Tipo / nº</th><th>Cliente</th><th className="hidden md:table-cell">OS</th><th className="hidden md:table-cell">Emissão</th><th>Situação</th><th className="text-right">Valor</th><th /></tr></thead>
              <tbody>
                {list.map((i) => (
                  <tr key={i.id}>
                    <td className="whitespace-nowrap"><button className="text-left" onClick={() => setView(i)}><div className="font-medium">{i.kind === 'nfe' ? 'NF-e' : 'NFS-e'} {i.number ? `nº ${i.number}` : ''}</div><div className="text-xs text-ink-faint">{i.status === 'preparada' ? 'Sem emissão' : i.provider === 'focus' ? (i.environment === 'producao' ? 'Produção' : 'Homologação') : '—'}{i.test && ' · teste'}</div></button></td>
                    <td className="max-w-[220px] truncate">{i.customer_name || 'Consumidor'}</td>
                    <td className="hidden md:table-cell">{i.order_id ? <Link className="text-primary" to={`/os/${i.order_id}`}>{docNumber(company.settings, 'order', i.order_number)}</Link> : '—'}</td>
                    <td className="hidden whitespace-nowrap text-ink-soft md:table-cell">{fmt(i.issued_at || i.created_at, 'dd/MM/yy HH:mm')}</td>
                    <td><span className={cx('chip', INVOICE_STATUS[i.status]?.cls)}>{INVOICE_STATUS[i.status]?.label}</span>{i.status === 'erro' && <div className="mt-0.5 max-w-[200px] truncate text-xs text-red-600" title={i.message}>{i.message}</div>}</td>
                    <td className="text-right font-medium tabular-nums">{money(i.amount)}</td>
                    <td className="w-40 whitespace-nowrap text-right">
                      {i.provider === 'focus' && ['processando', 'erro'].includes(i.status) && <button className="btn-ghost btn-icon h-8" title="Consultar situação" disabled={busy} onClick={() => refresh(i)}><RefreshCw className="h-4 w-4" /></button>}
                      {i.pdf_url && <a className="btn-ghost btn-icon h-8" title="DANFE / PDF" href={i.pdf_url} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /></a>}
                      {i.status === 'preparada' && i.order_id && <a className="btn-ghost btn-icon h-8" title="Imprimir recibo (sem valor fiscal)" href={appPath(`/imprimir/os/${i.order_id}?recibo=1`)} target="_blank" rel="noreferrer"><Printer className="h-4 w-4" /></a>}
                      {i.xml_url && <a className="btn-ghost btn-icon h-8" title="XML" href={i.xml_url} target="_blank" rel="noreferrer"><FileCode2 className="h-4 w-4" /></a>}
                      {can('invoices_cancel') && i.status === 'autorizada' && <button className="btn-ghost btn-icon h-8 text-red-600" title="Cancelar" onClick={() => setCancel(i)}><XCircle className="h-4 w-4" /></button>}
                      {can('invoices_issue') && ['erro', 'preparada'].includes(i.status) && <button className="btn-ghost btn-icon h-8 text-red-600" title="Descartar" onClick={() => discard(i)}><Trash2 className="h-4 w-4" /></button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {cancel && <CancelInvoice inv={cancel} onClose={() => setCancel(null)} onDone={() => { setCancel(null); load(); }} />}
      {view && <InvoiceView id={view.id} onClose={() => setView(null)} />}
      {pick && <PickOrder onClose={() => setPick(false)} onPick={async (o) => { setPick(false); setEmitFor(await api.get(`/orders/${o.id}`)); }} />}
      {emitFor && <InvoiceModal order={emitFor} onClose={() => setEmitFor(null)} onDone={() => { setEmitFor(null); load(); }} />}
    </div>
  );
}

function CancelInvoice({ inv, onClose, onDone }) {
  const [run, busy] = useAction();
  const [reason, setReason] = useState('');
  const go = async () => { if ((await run(() => api.post(`/invoices/${inv.id}/cancel`, { reason }), 'Nota cancelada')) !== FAIL) onDone(); };
  return (
    <Modal open onClose={onClose} size="sm" title={`Cancelar ${inv.kind === 'nfe' ? 'NF-e' : 'NFS-e'} ${inv.number || ''}`}
      footer={<><button className="btn-ghost" onClick={onClose}>Voltar</button><button className="btn-danger" disabled={busy || reason.trim().length < 15} onClick={go}>Cancelar nota</button></>}>
      <Input label="Justificativa (mín. 15 caracteres)" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus hint={`${reason.trim().length}/15`} />
      <p className="mt-3 text-xs text-ink-faint">O prazo de cancelamento depende da prefeitura (NFS-e) ou da SEFAZ (NF-e: em regra, até 24 h após a autorização).</p>
    </Modal>
  );
}

function InvoiceView({ id, onClose }) {
  const [i, setI] = useState(null);
  useEffect(() => { api.get(`/invoices/${id}`).then(setI); }, [id]);
  return (
    <Modal open onClose={onClose} size="lg" title="Detalhes da nota">
      {!i ? <Loading /> : (
        <div className="space-y-3 text-sm">
          <dl className="grid gap-2 sm:grid-cols-2">
            {[['Tipo', i.kind === 'nfe' ? 'NF-e' : 'NFS-e'], ['Situação', INVOICE_STATUS[i.status]?.label], ['Número', i.number || '—'], ['Série', i.series || '—'],
              ['Valor', money(i.amount)], ['Emissão', fmtDateTime(i.issued_at || i.created_at)], ['Referência', i.ref], ['Código de verificação', i.verification_code || '—']].map(([k, v]) => (
              <div key={k}><dt className="text-xs text-ink-faint">{k}</dt><dd className="break-all">{v}</dd></div>
            ))}
          </dl>
          {i.access_key && <div><div className="text-xs text-ink-faint">Chave de acesso</div><div className="font-mono text-xs">{i.access_key}</div></div>}
          {i.message && <div className="rounded-app-sm bg-muted/60 p-3">{i.message}</div>}
          {i.cancel_reason && <div className="rounded-app-sm bg-red-500/10 p-3 text-red-700 dark:text-red-300">Cancelada: {i.cancel_reason}</div>}
          <div><div className="mb-1 text-xs text-ink-faint">Descrição</div><pre className="whitespace-pre-wrap rounded-app-sm bg-muted/60 p-3 text-xs">{i.description}</pre></div>
          {i.response && <details><summary className="cursor-pointer text-xs text-ink-faint">Resposta da Focus NFe</summary><pre className="mt-2 max-h-60 overflow-auto rounded-app-sm bg-muted/60 p-3 text-xs">{JSON.stringify(i.response, null, 2)}</pre></details>}
        </div>
      )}
    </Modal>
  );
}

function PickOrder({ onClose, onPick }) {
  const [search, setSearch] = useState('');
  const [list, setList] = useState(null);
  useEffect(() => { const t = setTimeout(() => api.get(`/orders${qs({ search, limit: 40 })}`).then((l) => setList(l.filter((o) => o.status !== 'cancelada'))), 200); return () => clearTimeout(t); }, [search]);
  return (
    <Modal open onClose={onClose} title="Emitir nota de qual OS/venda?">
      <input className="input mb-3" placeholder="Nº da OS ou cliente…" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
      {!list ? <Loading /> : (
        <div className="divide-y divide-line rounded-app-sm border border-line">
          {list.map((o) => (
            <button key={o.id} className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => onPick(o)}>
              <span className="w-12 font-medium tabular-nums">#{o.number}</span>
              <span className="min-w-0 flex-1 truncate">{o.customer_name || 'Consumidor'}<span className="text-ink-faint"> · {o.kind === 'venda' ? 'venda' : o.equipment_description}</span></span>
              {o.invoices_count > 0 && <span className="chip bg-emerald-500/10 text-emerald-700">com nota</span>}
              <span className="tabular-nums">{money(o.total)}</span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

export function CertBanner({ company }) {
  if (company.fiscal_provider !== 'focus' || !company.fiscal_cert_until) return null;
  const days = Math.floor((new Date(company.fiscal_cert_until) - Date.now()) / 86400000);
  if (days > 30) return null;
  return (
    <div className={cx('mb-4 rounded-app border px-4 py-3 text-sm', days < 0 ? 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300' : 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200')}>
      {days < 0 ? 'O certificado digital A1 está vencido — as notas serão rejeitadas.' : `O certificado digital A1 vence em ${days} dia(s) (${fmt(company.fiscal_cert_until)}).`}{' '}
      <Link to="/configuracoes?tab=fiscal" className="font-medium underline">Renovar certificado</Link>
    </div>
  );
}

/** OS entregues no período ainda sem documento fiscal autorizado ou em processamento. */
function ToInvoice({ period, onEmit, reloadKey }) {
  const settings = useSettings();
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(false);
  useEffect(() => { api.get(`/reports/fiscal${qs(period)}`).then(setData).catch(() => setData(null)); }, [period, reloadKey]);
  if (!data || !data.pending.length) return null;
  return (
    <div className="card mb-4 overflow-hidden">
      <button className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm" onClick={() => setOpen(!open)}>
        <span><b>{data.pending.length} OS entregue(s) sem nota</b> no período · {money(data.pending_total)}</span>
        <span className="text-xs text-primary">{open ? 'Ocultar' : 'Ver lista'}</span>
      </button>
      {open && (
        <div className="overflow-x-auto border-t border-line">
          <table className="table-clean">
            <thead><tr><th>OS</th><th>Cliente</th><th className="hidden md:table-cell">Entregue</th><th className="text-right">Serviços</th><th className="text-right">Materiais</th><th /></tr></thead>
            <tbody>
              {data.pending.map((o) => (
                <tr key={o.id}>
                  <td><Link to={`/os/${o.id}`} className="text-primary">{docNumber(settings, 'order', o.number)}</Link>{o.invoice_statuses && <div className="text-xs text-ink-faint">{o.invoice_statuses.replace('preparada', 'preparada (sem emissão)')}</div>}</td>
                  <td className="max-w-[220px] truncate">{o.customer_name || 'Consumidor'}</td>
                  <td className="hidden whitespace-nowrap text-ink-soft md:table-cell">{fmt(o.delivered_at, 'dd/MM/yy')}</td>
                  <td className="text-right tabular-nums">{money(o.services)}</td>
                  <td className="text-right tabular-nums">{money(o.goods)}</td>
                  <td className="text-right"><button className="btn-outline h-8 text-xs" onClick={() => onEmit(o.id)}>Nota</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
