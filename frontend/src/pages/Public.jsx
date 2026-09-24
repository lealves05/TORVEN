// Páginas públicas: orçamento para aprovação e acompanhamento da OS.
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, XCircle, Phone, Clock, ShieldCheck, Printer, Circle } from 'lucide-react';
import { api } from '../lib/api';
import { money, fmt, fmtDateTime, qty, ORDER_STATUS, QUOTE_STATUS, OPEN_STATUSES, waLink } from '../lib/format';
import { applyTheme } from '../lib/theme';
import { Loading, Input, Textarea, Modal, useAction, FAIL, cx } from '../components/ui';
import { Mark } from '../components/Layout';

function Shell({ company, children }) {
  useEffect(() => { if (company) applyTheme({ primaryColor: company.primaryColor, theme: 'light' }); }, [company]);
  if (!company) return children;
  return (
    <div className="min-h-full bg-bg">
      <header className="bg-primary text-primary-fg">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-4">
          {company.logo_url ? <img src={company.logo_url} alt="" className="h-11 w-11 rounded-app-sm bg-white object-cover" />
            : <div className="grid h-11 w-11 place-items-center rounded-app-sm bg-primary-fg/15"><Mark /></div>}
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold">{company.trade_name || company.name}</div>
            <div className="truncate text-xs opacity-80">{[company.city && `${company.city}/${company.uf || ''}`, company.phone].filter(Boolean).join(' · ')}</div>
          </div>
          {company.phone && <a href={waLink(company.phone, 'Olá!') || `tel:${company.phone}`} target="_blank" rel="noreferrer" className="btn h-9 rounded-full bg-primary-fg/15 px-3 text-xs"><Phone className="h-4 w-4" /> Contato</a>}
        </div>
      </header>
      <main className="mx-auto max-w-3xl space-y-4 p-4 pb-16">{children}</main>
      <footer className="pb-8 text-center text-xs text-ink-faint">Sistema TORVEN</footer>
    </div>
  );
}

function ItemsTable({ items, doc }) {
  return (
    <div className="card overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs text-ink-faint"><tr><th className="px-4 py-2 text-left font-medium">Item</th><th className="px-2 py-2 text-right font-medium">Qtd.</th><th className="px-4 py-2 text-right font-medium">Total</th></tr></thead>
        <tbody className="divide-y divide-line">
          {items.map((i, k) => (
            <tr key={k}><td className="px-4 py-2.5">{i.description}{i.kind === 'material' && <span className="text-xs text-ink-faint"> · material</span>}</td>
              <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums text-ink-soft">{qty(i.qty)} {i.unit}</td>
              <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">{money(i.total)}</td></tr>
          ))}
        </tbody>
      </table>
      <div className="space-y-1 border-t border-line px-4 py-3 text-sm">
        {Number(doc.discount) > 0 && <><div className="flex justify-between text-ink-soft"><span>Subtotal</span><span className="tabular-nums">{money(doc.subtotal)}</span></div>
          <div className="flex justify-between text-ink-soft"><span>Desconto</span><span className="tabular-nums">− {money(doc.discount)}</span></div></>}
        <div className="flex justify-between text-lg font-semibold"><span>Total</span><span className="tabular-nums">{money(doc.total)}</span></div>
      </div>
    </div>
  );
}

function Respond({ title, confirmText, danger, onClose, onSubmit }) {
  const [run, busy] = useAction();
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  return (
    <Modal open onClose={onClose} size="sm" title={title}
      footer={<><button className="btn-ghost" onClick={onClose}>Voltar</button>
        <button className={danger ? 'btn-danger' : 'btn-primary'} disabled={busy || name.trim().length < 2} onClick={async () => { if ((await run(() => onSubmit({ name, note }))) !== FAIL) onClose(true); }}>{confirmText}</button></>}>
      <div className="space-y-4">
        <Input label="Seu nome" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <Textarea label="Comentário (opcional)" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
    </Modal>
  );
}

export function PublicQuote() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [act, setAct] = useState(null);
  const load = useCallback(() => api.get(`/public/quote/${token}`).then(setData).catch((e) => setErr(e.message)), [token]);
  useEffect(() => { load(); }, [load]);
  if (err) return <div className="grid min-h-full place-items-center p-6 text-center text-ink-soft">{err}</div>;
  if (!data) return <Loading />;
  const { company, quote: q } = data;
  const open = ['rascunho', 'enviado'].includes(q.status);
  return (
    <Shell company={company}>
      <div className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="text-xs uppercase tracking-wider text-ink-faint">Orçamento nº {q.number}</div>
            <h1 className="mt-1 text-xl font-semibold">{q.title}</h1>
            <div className="mt-1 text-sm text-ink-soft">Para {q.customer_name}{q.equipment_description && ` · ${[q.equipment_description, q.equipment_brand, q.equipment_model].filter(Boolean).join(' ')}`}</div>
          </div>
          <span className={cx('chip', QUOTE_STATUS[q.status]?.cls)}>{q.status === 'convertido' ? 'Aprovado' : QUOTE_STATUS[q.status]?.label}</span>
        </div>
        {q.description && <p className="mt-4 whitespace-pre-wrap text-sm">{q.description}</p>}
      </div>
      <ItemsTable items={q.items} doc={q} />
      <div className="card grid gap-3 p-5 text-sm sm:grid-cols-2">
        <div><div className="text-xs text-ink-faint">Válido até</div><div className="font-medium">{fmt(q.valid_until)}</div></div>
        <div><div className="text-xs text-ink-faint">Prazo de execução</div><div className="font-medium">{q.delivery_days != null ? `${q.delivery_days} dias após aprovação` : 'a combinar'}</div></div>
        <div><div className="text-xs text-ink-faint">Garantia</div><div className="font-medium">{q.warranty_days ? `${q.warranty_days} dias` : '—'}</div></div>
        <div><div className="text-xs text-ink-faint">Pagamento</div><div className="font-medium">{q.payment_terms || `a combinar (${company.paymentMethods.join(', ')})`}</div></div>
        {q.terms && <p className="whitespace-pre-wrap text-xs text-ink-soft sm:col-span-2">{q.terms}</p>}
      </div>
      {open ? (
        <div className="card flex flex-col gap-2 p-4 sm:flex-row">
          <button className="btn-primary h-12 flex-1 text-base" onClick={() => setAct('approve')}><CheckCircle2 className="h-5 w-5" /> Aprovar orçamento</button>
          <button className="btn-outline h-12 text-red-600 sm:w-48" onClick={() => setAct('refuse')}><XCircle className="h-5 w-5" /> Recusar</button>
        </div>
      ) : (
        <div className={cx('card p-4 text-center text-sm', ['aprovado', 'convertido'].includes(q.status) ? 'text-emerald-700' : 'text-ink-soft')}>
          {['aprovado', 'convertido'].includes(q.status) ? `Orçamento aprovado${q.approved_at ? ` em ${fmtDateTime(q.approved_at)}` : ''}. Obrigado!`
            : q.status === 'recusado' ? 'Orçamento recusado.' : 'Este orçamento expirou. Fale com a empresa para atualizá-lo.'}
          {q.order_token && <a href={`/p/os/${q.order_token}`} className="mt-2 block font-medium text-primary">Acompanhar o serviço</a>}
        </div>
      )}
      <button className="btn-ghost mx-auto flex" onClick={() => window.print()}><Printer className="h-4 w-4" /> Imprimir</button>
      {act && <Respond title={act === 'approve' ? 'Aprovar orçamento' : 'Recusar orçamento'} confirmText={act === 'approve' ? 'Confirmar aprovação' : 'Recusar'} danger={act === 'refuse'}
        onClose={(ok) => { setAct(null); if (ok) load(); }} onSubmit={(b) => api.post(`/public/quote/${token}/${act}`, b)} />}
    </Shell>
  );
}

export function PublicOrder() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [act, setAct] = useState(false);
  const load = useCallback(() => api.get(`/public/order/${token}`).then(setData).catch((e) => setErr(e.message)), [token]);
  useEffect(() => { load(); }, [load]);
  if (err) return <div className="grid min-h-full place-items-center p-6 text-center text-ink-soft">{err}</div>;
  if (!data) return <Loading />;
  const { company, order: o } = data;
  const steps = o.kind === 'venda' ? [] : [...OPEN_STATUSES.filter((s) => !['aguardando_material'].includes(s) || o.status === s), 'entregue'];
  const idx = steps.indexOf(o.status);
  return (
    <Shell company={company}>
      <div className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="text-xs uppercase tracking-wider text-ink-faint">{o.kind === 'venda' ? 'Venda' : 'Ordem de serviço'} nº {o.number}</div>
            <h1 className="mt-1 text-xl font-semibold">{o.equipment_description || 'Seu serviço'}</h1>
            <div className="text-sm text-ink-soft">{[o.equipment_brand, o.equipment_model, o.equipment_serial && `nº ${o.equipment_serial}`].filter(Boolean).join(' · ')}</div>
          </div>
          <span className={cx('chip', ORDER_STATUS[o.status]?.cls)}><span className={cx('h-1.5 w-1.5 rounded-full', ORDER_STATUS[o.status]?.dot)} />{ORDER_STATUS[o.status]?.label}</span>
        </div>
        <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
          <div><div className="text-xs text-ink-faint">Recebido em</div>{fmtDateTime(o.received_at)}</div>
          {o.status !== 'entregue' && o.promised_at && <div><div className="text-xs text-ink-faint">Previsão de entrega</div><span className="flex items-center gap-1 font-medium"><Clock className="h-4 w-4" />{fmtDateTime(o.promised_at)}</span></div>}
          {o.delivered_at && <div><div className="text-xs text-ink-faint">Entregue em</div>{fmtDateTime(o.delivered_at)}</div>}
          {o.warranty_until && <div><div className="text-xs text-ink-faint">Garantia até</div><span className="flex items-center gap-1 font-medium text-emerald-700"><ShieldCheck className="h-4 w-4" />{fmt(o.warranty_until)}</span></div>}
        </div>
      </div>

      {o.status === 'aguardando_aprovacao' && (
        <div className="card border-amber-500/40 p-5">
          <div className="font-semibold">Seu serviço aguarda aprovação</div>
          <p className="mt-1 text-sm text-ink-soft">Confira os itens e o valor abaixo e aprove para darmos andamento.</p>
          <button className="btn-primary mt-3 h-11 w-full text-base" onClick={() => setAct(true)}><CheckCircle2 className="h-5 w-5" /> Aprovar serviço — {money(o.total)}</button>
        </div>
      )}

      {steps.length > 0 && o.status !== 'cancelada' && (
        <div className="card p-5">
          <h2 className="mb-4 font-semibold">Andamento</h2>
          <ol className="space-y-3">
            {steps.map((s, i) => (
              <li key={s} className="flex items-center gap-3 text-sm">
                {i <= idx ? <CheckCircle2 className={cx('h-5 w-5', i === idx ? 'text-primary' : 'text-emerald-600')} /> : <Circle className="h-5 w-5 text-line" />}
                <span className={cx(i === idx && 'font-semibold', i > idx && 'text-ink-faint')}>{ORDER_STATUS[s].label}</span>
                {(() => { const e = [...o.events].reverse().find((x) => x.to_status === s); return e && i <= idx ? <span className="ml-auto text-xs text-ink-faint">{fmt(e.created_at, 'dd/MM HH:mm')}</span> : null; })()}
              </li>
            ))}
          </ol>
          {o.events.filter((e) => e.message && e.type !== 'criacao').length > 0 && (
            <div className="mt-5 space-y-2 border-t border-line pt-4">
              {o.events.filter((e) => e.message && e.type !== 'criacao').map((e, k) => (
                <div key={k} className="text-sm"><span className="text-xs text-ink-faint">{fmtDateTime(e.created_at)} · </span>{e.message}</div>
              ))}
            </div>
          )}
        </div>
      )}
      {o.status === 'cancelada' && <div className="card p-4 text-center text-sm text-red-600">Esta OS foi cancelada.</div>}

      {(o.problem || o.diagnosis || o.solution) && (
        <div className="card space-y-3 p-5 text-sm">
          {o.problem && <div><div className="text-xs text-ink-faint">Problema relatado</div><p className="whitespace-pre-wrap">{o.problem}</p></div>}
          {o.diagnosis && <div><div className="text-xs text-ink-faint">Diagnóstico</div><p className="whitespace-pre-wrap">{o.diagnosis}</p></div>}
          {o.solution && <div><div className="text-xs text-ink-faint">Serviço executado</div><p className="whitespace-pre-wrap">{o.solution}</p></div>}
        </div>
      )}
      {o.items.length > 0 && <ItemsTable items={o.items} doc={o} />}
      {o.items.length > 0 && (
        <div className="card flex justify-between p-4 text-sm">
          <span>Pago: <b className="tabular-nums">{money(o.paid)}</b></span>
          <span>Saldo: <b className={cx('tabular-nums', o.balance > 0.009 && 'text-amber-600')}>{money(Math.max(0, o.balance))}</b></span>
        </div>
      )}
      {act && <Respond title="Aprovar serviço" confirmText="Aprovar" onClose={(ok) => { setAct(false); if (ok) load(); }} onSubmit={(b) => api.post(`/public/order/${token}/approve`, b)} />}
    </Shell>
  );
}
