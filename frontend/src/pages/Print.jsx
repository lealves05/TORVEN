// Impressão A4 de OS, recibo e orçamento (use "Salvar como PDF" no navegador).
import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Printer } from 'lucide-react';
import { api, apiBase, getToken } from '../lib/api';
import { fmt, money, ORDER_STATUS, PRIORITY, methodName } from '../lib/format';
import { OrderDocument, DocHeader, Items, Totals, DocFooter, docConfig } from '../components/DocumentTemplate';
import { useAuth } from '../context/AuthContext';
import { Loading, cx } from '../components/ui';

function Page({ children, paper = 'a4' }) {
  useEffect(() => {
    document.documentElement.classList.remove('dark');
    const t = setTimeout(() => window.print(), 500);
    return () => clearTimeout(t);
  }, []);
  const cupom = paper === 'cupom80';
  const pageCss = cupom ? '@page { size: 80mm auto; margin: 3mm; }' : '@page { size: A4; margin: 12mm; }';
  return (
    <div className="min-h-full bg-zinc-100 py-6 text-zinc-900 print:bg-white print:py-0">
      <style>{`${pageCss} @media print { .no-print { display: none !important; } }`}</style>
      <div className={cx('no-print mx-auto mb-4 flex justify-end gap-2 px-4', cupom ? 'max-w-[90mm]' : 'max-w-[210mm]')}>
        <button className="btn-primary" onClick={() => window.print()}><Printer className="h-4 w-4" /> Imprimir / salvar PDF</button>
      </div>
      <div className={cx('mx-auto space-y-4 bg-white shadow print:max-w-none print:p-0 print:shadow-none', cupom ? 'max-w-[80mm] p-[4mm]' : 'max-w-[210mm] p-[12mm]')}>{children}</div>
    </div>
  );
}

export function PrintOrder() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { company } = useAuth();
  const [o, setO] = useState(null);
  useEffect(() => { api.get(`/orders/${id}`).then(setO); }, [id]);
  if (!o) return <Loading />;
  const receipt = params.get('recibo') === '1' || o.kind === 'venda';
  const cfg = docConfig(company.settings);
  return (
    <Page paper={cfg.paper}>
      <OrderDocument company={company} o={o} settings={company.settings} receipt={receipt} />
    </Page>
  );
}

export function PrintQuote() {
  const { id } = useParams();
  const { company } = useAuth();
  const [q, setQ] = useState(null);
  useEffect(() => { api.get(`/quotes/${id}`).then(setQ); }, [id]);
  if (!q) return <Loading />;
  const cfg = docConfig(company.settings);
  return (
    <Page>
      <div className="space-y-4" style={{ fontFamily: cfg.font === 'serifada' ? 'Georgia, "Times New Roman", serif' : undefined }}>
      <DocHeader company={company} cfg={cfg} title={cfg.titles.quote} number={q.number} date={fmt(q.created_at)} />
      <section className="grid grid-cols-2 gap-3 text-[11px]">
        <div className="rounded border border-zinc-300 p-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: cfg.accent }}>Cliente</div>
          <div className="font-semibold">{q.customer_name}</div>
          <div>{[q.customer_document, q.customer_phone, q.customer_email].filter(Boolean).join(' · ')}</div>
          <div>{[q.street, q.address_number, q.district, q.city && `${q.city}/${q.uf || ''}`].filter(Boolean).join(', ')}</div>
        </div>
        <div className="rounded border border-zinc-300 p-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: cfg.accent }}>{cfg.equipmentLabel}</div>
          <div className="font-semibold">{q.equipment_description || '—'}</div>
          <div>{[q.equipment_brand, q.equipment_model, q.equipment_serial && `nº série ${q.equipment_serial}`].filter(Boolean).join(' · ')}</div>
        </div>
      </section>
      <section>
        <h2 className="text-base font-bold">{q.title}</h2>
        {q.description && <p className="mt-1 whitespace-pre-wrap text-[11px]">{q.description}</p>}
      </section>
      <section><Items items={q.items} accent={cfg.accent} /><Totals o={q} accent={cfg.accent} /></section>
      <section className="grid grid-cols-4 gap-3 text-[11px]">
        <div><span className="text-zinc-500">Validade: </span><b>{fmt(q.valid_until)}</b></div>
        <div><span className="text-zinc-500">Prazo de execução: </span>{q.delivery_days != null ? `${q.delivery_days} dias` : '—'}</div>
        <div><span className="text-zinc-500">Garantia: </span>{q.warranty_days ? `${q.warranty_days} dias` : '—'}</div>
        <div><span className="text-zinc-500">Pagamento: </span>{q.payment_terms || 'a combinar'}</div>
      </section>
      {cfg.show.terms && q.terms && (
        <div className="rounded border border-zinc-300 p-2.5">
          <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: cfg.accent }}>Condições</div>
          <div className="whitespace-pre-wrap text-[11px]">{q.terms}</div>
        </div>
      )}
      {cfg.show.signatures && (
        <section className="grid grid-cols-2 gap-10 pt-12 text-center text-[11px]">
          <div className="border-t border-zinc-600 pt-1">{cfg.signatureCompany || company.trade_name || company.name}</div>
          <div className="border-t border-zinc-600 pt-1">{q.customer_name} — aprovado em ___/___/______</div>
        </section>
      )}
      <DocFooter cfg={cfg} />
      </div>
    </Page>
  );
}

// ---------------------------------------------------------------- OS completa (relatório de tudo o que aconteceu)
const hm = (min) => `${Math.floor((Number(min) || 0) / 60)}h${String(Math.round(Number(min) || 0) % 60).padStart(2, '0')}`;
const RESULT = { aprovado: 'Aprovada', aprovado_ressalva: 'Aprovada com ressalva', reprovado: 'Reprovada' };
const CHECK = { recebimento: 'Recebimento', inspecao: 'Inspeção final', entrega: 'Entrega' };
const ITEM_RESULT = { ok: 'OK', nok: 'Não conforme', na: 'N/A' };

function Box({ title, accent, children, className }) {
  return (
    <section className={cx('break-inside-avoid rounded border border-zinc-300 p-2.5 text-[11px]', className)}>
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: accent }}>{title}</div>
      {children}
    </section>
  );
}
const Field = ({ k, v }) => (v ? <div><span className="text-zinc-500">{k}: </span><b className="font-semibold">{v}</b></div> : null);
function Table({ head, rows, right = [], foot }) {
  return (
    <table className="w-full border-collapse text-[10.5px]">
      <thead><tr>{head.map((h, i) => <th key={h} className={cx('border-b border-zinc-400 px-1 py-1 text-left font-semibold', right.includes(i) && 'text-right')}>{h}</th>)}</tr></thead>
      <tbody>{rows.map((r, k) => <tr key={k} className="break-inside-avoid">{r.map((c, i) => <td key={i} className={cx('border-b border-zinc-200 px-1 py-1 align-top', right.includes(i) && 'text-right tabular-nums')}>{c}</td>)}</tr>)}</tbody>
      {foot && <tfoot><tr>{foot.map((c, i) => <td key={i} className={cx('px-1 py-1 font-semibold', right.includes(i) && 'text-right tabular-nums')}>{c}</td>)}</tr></tfoot>}
    </table>
  );
}

/** Fotos da OS: baixadas com a sessão (o link da imagem exige login). */
function Photos({ orderId, accent }) {
  const [list, setList] = useState(null);
  useEffect(() => {
    let urls = [];
    (async () => {
      try {
        const all = (await api.get(`/attachments?entity=order&entity_id=${orderId}`)).filter((a) => /^image\//.test(a.mime)).slice(0, 12);
        const out = [];
        for (const a of all) {
          const r = await fetch(`${apiBase}/attachments/${a.id}?raw=1`, { headers: { Authorization: `Bearer ${getToken()}` } });
          if (r.ok) { const u = URL.createObjectURL(await r.blob()); urls.push(u); out.push({ ...a, url: u }); }
        }
        setList(out);
      } catch { setList([]); }
    })();
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [orderId]);
  if (!list?.length) return null;
  return (
    <Box title={`Fotos (${list.length})`} accent={accent}>
      <div className="grid grid-cols-4 gap-2">
        {list.map((a) => (
          <figure key={a.id} className="break-inside-avoid">
            <img src={a.url} alt={a.caption || a.filename} className="h-28 w-full rounded object-cover" />
            <figcaption className="mt-0.5 truncate text-[9px] text-zinc-500">{a.caption || a.filename}</figcaption>
          </figure>
        ))}
      </div>
    </Box>
  );
}

export function PrintOrderFull() {
  const { id } = useParams();
  const { company, can } = useAuth();
  const [o, setO] = useState(null);
  useEffect(() => { api.get(`/orders/${id}`).then(setO); }, [id]);
  if (!o) return <Loading />;
  const cfg = docConfig(company.settings);
  const A = cfg.accent;
  const values = o.total != null;
  const services = o.items.filter((i) => !['material', 'consumivel'].includes(i.kind));
  const materials = o.items.filter((i) => ['material', 'consumivel'].includes(i.kind));
  const sum = (l, f) => l.reduce((a, x) => a + (Number(f(x)) || 0), 0);
  const logs = (o.time_logs || []).filter((l) => l.ended_at || l.minutes);
  const vehicle = [o.equipment_description, o.equipment_brand, o.equipment_model].filter(Boolean).join(' · ');
  return (
    <Page>
      <div className="space-y-3" style={{ fontFamily: cfg.font === 'serifada' ? 'Georgia, "Times New Roman", serif' : undefined }}>
        <DocHeader company={company} cfg={cfg} title={`${o.kind === 'venda' ? 'Venda' : 'Ordem de serviço'} — relatório completo`} number={o.number} date={fmt(o.created_at, 'dd/MM/yyyy HH:mm')} />

        <div className="grid grid-cols-2 gap-3">
          <Box title="Cliente" accent={A}>
            <div className="text-[12px] font-semibold">{o.customer_name || 'Consumidor'}</div>
            <Field k="CPF/CNPJ" v={o.customer_document} /><Field k="Telefone" v={o.customer_phone} /><Field k="E-mail" v={o.customer_email} />
          </Box>
          <Box title="Veículo / equipamento" accent={A}>
            <div className="text-[12px] font-semibold">{vehicle || '—'}</div>
            <Field k="Placa" v={o.equipment_plate} /><Field k="Ano" v={o.equipment_year} /><Field k="Cor" v={o.equipment_color} /><Field k="Nº de série" v={o.equipment_serial} />
          </Box>
        </div>

        <Box title="Dados da OS" accent={A}>
          <div className="grid grid-cols-3 gap-x-4 gap-y-0.5">
            <Field k="Situação" v={ORDER_STATUS[o.status]?.label || o.status} /><Field k="Tipo de OS" v={o.order_type_name} /><Field k="Prioridade" v={PRIORITY[o.priority]?.label} />
            <Field k="Técnico" v={o.technician_name} /><Field k="Local" v={o.service_location === 'externo' ? 'Externo' : 'Oficina'} /><Field k="Aberta por" v={o.created_by_name} />
            <Field k="Recebida" v={o.received_at && fmt(o.received_at, 'dd/MM/yyyy HH:mm')} /><Field k="Prazo" v={o.promised_at && fmt(o.promised_at, 'dd/MM/yyyy HH:mm')} />
            <Field k="Início" v={o.started_at && fmt(o.started_at, 'dd/MM/yyyy HH:mm')} /><Field k="Concluída" v={o.finished_at && fmt(o.finished_at, 'dd/MM/yyyy HH:mm')} />
            <Field k="Entregue" v={o.delivered_at && fmt(o.delivered_at, 'dd/MM/yyyy HH:mm')} /><Field k="Entregue a" v={o.delivered_to} />
            <Field k="Garantia até" v={o.warranty_until && fmt(o.warranty_until)} /><Field k="Orçamento" v={o.quote_number && `nº ${o.quote_number}`} />
          </div>
        </Box>

        {[['Problema relatado', o.problem], ['Acessórios deixados', o.accessories], ['Estado / condições', o.condition], ['Diagnóstico técnico', o.diagnosis],
          ['Serviço executado / solução', o.solution], ['Observações', o.notes]].filter(([, v]) => v).map(([t, v]) => (
          <Box key={t} title={t} accent={A}><p className="whitespace-pre-wrap">{v}</p></Box>
        ))}

        {services.length > 0 && (
          <Box title="Serviços" accent={A}>
            <Table head={['Serviço', 'Técnico', 'Qtd.', ...(values ? ['Valor unit.', 'Total'] : [])]} right={[2, 3, 4]}
              rows={services.map((i) => [i.description, i.technician_name || '—', `${Number(i.qty)} ${i.unit || ''}`, ...(values ? [money(i.unit_price), money(i.total)] : [])])}
              foot={values ? ['Total de serviços', '', '', '', money(sum(services, (x) => x.total))] : null} />
          </Box>
        )}

        {materials.length > 0 && (
          <Box title="Materiais apontados" accent={A}>
            <Table head={['Material', 'Código', 'Qtd.', 'Separado', ...(values ? ['Valor unit.', 'Total'] : [])]} right={[2, 4, 5]}
              rows={materials.map((i) => [i.description, i.product_sku || '—', `${Number(i.qty)} ${i.unit || ''}`,
                Number(i.picked_qty) > 0 ? `${Number(i.picked_qty)} ${i.unit || ''}${i.picked_at ? ` em ${fmt(i.picked_at, 'dd/MM HH:mm')}` : ''}${i.picked_by_name ? ` por ${i.picked_by_name}` : ''}` : '—',
                ...(values ? [money(i.unit_price), money(i.total)] : [])])}
              foot={values ? ['Total de materiais', '', '', '', '', money(sum(materials, (x) => x.total))] : null} />
          </Box>
        )}

        {values && (
          <section className="ml-auto w-64 break-inside-avoid text-[11px]">
            {[['Subtotal', o.subtotal], ['Desconto', o.discount > 0 ? -o.discount : null], ['Total', o.total], ['Pago', o.paid], ['A receber', o.receivable], ['Saldo', o.balance]]
              .filter(([k, v]) => v != null && (k !== 'Saldo' || Number(v) > 0.009) && (k !== 'A receber' || Number(v) > 0.009)).map(([k, v]) => (
                <div key={k} className={cx('flex justify-between py-0.5', k === 'Total' && 'border-t border-zinc-400 font-bold')}><span>{k}</span><span className="tabular-nums">{money(v)}</span></div>
              ))}
          </section>
        )}

        {logs.length > 0 && (
          <Box title="Horas apontadas" accent={A}>
            <Table head={['Técnico', 'Atividade', 'Início', 'Fim', 'Tempo']} right={[4]}
              rows={logs.map((l) => [l.technician_name, l.activity || '—', fmt(l.started_at, 'dd/MM HH:mm'), l.ended_at ? fmt(l.ended_at, 'dd/MM HH:mm') : 'em andamento', hm(l.minutes)])}
              foot={['Total', '', '', '', hm(sum(logs, (l) => l.minutes))]} />
          </Box>
        )}

        {o.inspections?.length > 0 && (
          <Box title="Checklists" accent={A}>
            <div className="space-y-2">
              {[...o.inspections].reverse().map((i) => (
                <div key={i.id} className="break-inside-avoid">
                  <div><b>{CHECK[i.kind] || i.kind}</b>{i.template_name && ` — ${i.template_name}`} · <b>{RESULT[i.result] || i.result}</b> · {fmt(i.created_at, 'dd/MM/yyyy HH:mm')}{i.inspector_name && ` · ${i.inspector_name}`}</div>
                  <ul className="mt-0.5 grid grid-cols-2 gap-x-4">
                    {i.items.map((it, k) => <li key={k}>[{ITEM_RESULT[it.result] || it.result}] {it.label}{it.note && ` — ${it.note}`}</li>)}
                  </ul>
                  {i.notes && <div className="text-zinc-600">Obs.: {i.notes}</div>}
                </div>
              ))}
            </div>
          </Box>
        )}

        {values && o.payments?.length > 0 && (
          <Box title="Pagamentos e lançamentos" accent={A}>
            <Table head={['Descrição', 'Forma', 'Vencimento', 'Pago em', 'Valor']} right={[4]}
              rows={o.payments.map((p) => [`${p.type === 'saida' ? '(saída) ' : ''}${p.description || p.category}`, methodName(company.settings, p.method),
                p.due_date ? fmt(p.due_date) : '—', p.paid_at ? fmt(p.paid_at, 'dd/MM/yyyy') : 'em aberto', money(p.amount)])} />
          </Box>
        )}

        {o.invoices?.length > 0 && (
          <Box title="Notas fiscais" accent={A}>
            {o.invoices.map((n) => <div key={n.id}>{n.kind === 'nfe' ? 'NF-e' : 'NFS-e'} {n.number ? `nº ${n.number}` : ''} · {n.status}{values && ` · ${money(n.amount)}`} · {fmt(n.created_at)}</div>)}
          </Box>
        )}

        {o.schedule?.length > 0 && (
          <Box title="Agenda" accent={A}>
            {o.schedule.map((e) => <div key={e.id}>{fmt(e.starts_at, 'dd/MM/yyyy HH:mm')}–{fmt(e.ends_at, 'HH:mm')} · {e.title || e.kind} · {e.technician_name || 'Sem técnico'} · {e.status}</div>)}
          </Box>
        )}

        <Photos orderId={o.id} accent={A} />

        {can('orders_view') && o.events?.length > 0 && (
          <Box title="Histórico" accent={A}>
            <Table head={['Data', 'Quem', 'O que aconteceu']}
              rows={[...o.events].reverse().slice(-40).map((e) => [fmt(e.created_at, 'dd/MM/yy HH:mm'), e.user_name || 'Sistema',
                [e.from_status && e.to_status ? `${ORDER_STATUS[e.from_status]?.label || e.from_status} → ${ORDER_STATUS[e.to_status]?.label || e.to_status}` : null, e.message].filter(Boolean).join(' · ') || e.type])} />
          </Box>
        )}

        <section className="grid grid-cols-2 gap-10 pt-10 text-center text-[11px] break-inside-avoid">
          <div className="border-t border-zinc-500 pt-1">{company.trade_name || company.name}</div>
          <div className="border-t border-zinc-500 pt-1">{o.customer_name || 'Cliente'} — de acordo</div>
        </section>
        <p className="text-center text-[9px] text-zinc-500">Emitido em {fmt(new Date(), 'dd/MM/yyyy HH:mm')} pelo TORVEN</p>
      </div>
    </Page>
  );
}
