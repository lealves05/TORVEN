// Impressão A4 de OS, recibo e orçamento (use "Salvar como PDF" no navegador).
import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Printer } from 'lucide-react';
import { api } from '../lib/api';
import { money, fmt, fmtDateTime, qty, ORDER_STATUS, methodName } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import { Loading } from '../components/ui';

function Header({ company, title, number, date }) {
  const addr = [company.street, company.number, company.district, company.city && `${company.city}/${company.uf || ''}`, company.cep].filter(Boolean).join(', ');
  return (
    <header className="flex items-start justify-between gap-6 border-b-2 border-zinc-800 pb-4">
      <div className="flex items-start gap-4">
        {company.logo_url && <img src={company.logo_url} alt="" className="h-16 w-16 object-contain" />}
        <div className="text-[11px] leading-snug">
          <div className="text-base font-bold">{company.trade_name || company.name}</div>
          {company.trade_name && company.trade_name !== company.name && <div>{company.name}</div>}
          {company.document && <div>CNPJ/CPF {company.document}{company.state_registration && ` · IE ${company.state_registration}`}</div>}
          {addr && <div>{addr}</div>}
          <div>{[company.phone, company.email].filter(Boolean).join(' · ')}</div>
        </div>
      </div>
      <div className="text-right">
        <div className="text-xs uppercase tracking-wider text-zinc-500">{title}</div>
        <div className="text-2xl font-bold">nº {number}</div>
        <div className="text-[11px]">{date}</div>
      </div>
    </header>
  );
}

function Items({ items }) {
  return (
    <table className="w-full border-collapse text-[11px]">
      <thead><tr className="border-b border-zinc-400 text-left">
        <th className="py-1.5">Descrição</th><th className="w-20 py-1.5 text-right">Qtd.</th><th className="w-24 py-1.5 text-right">Unitário</th><th className="w-20 py-1.5 text-right">Desc.</th><th className="w-24 py-1.5 text-right">Total</th>
      </tr></thead>
      <tbody>
        {items.map((i, k) => (
          <tr key={k} className="border-b border-zinc-200 align-top">
            <td className="py-1.5">{i.description}{i.kind === 'material' && <span className="text-zinc-500"> (material)</span>}</td>
            <td className="py-1.5 text-right">{qty(i.qty)} {i.unit}</td>
            <td className="py-1.5 text-right">{money(i.unit_price)}</td>
            <td className="py-1.5 text-right">{Number(i.discount) ? money(i.discount) : '—'}</td>
            <td className="py-1.5 text-right">{money(i.total)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const Totals = ({ o }) => (
  <div className="ml-auto mt-2 w-64 space-y-0.5 text-[12px]">
    <div className="flex justify-between"><span>Subtotal</span><span>{money(o.subtotal)}</span></div>
    {Number(o.discount) > 0 && <div className="flex justify-between"><span>Desconto</span><span>− {money(o.discount)}</span></div>}
    {Number(o.surcharge) > 0 && <div className="flex justify-between"><span>Acréscimos</span><span>+ {money(o.surcharge)}</span></div>}
    {o.approved_total != null && Number(o.approved_total) !== Number(o.total) && <div className="flex justify-between font-semibold"><span>Valor aprovado</span><span>{money(o.approved_total)}</span></div>}
    <div className="flex justify-between border-t border-zinc-800 pt-1 text-sm font-bold"><span>Total</span><span>{money(o.total)}</span></div>
  </div>
);

const Box = ({ title, children }) => (children ? (
  <div className="rounded border border-zinc-300 p-2.5">
    <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{title}</div>
    <div className="whitespace-pre-wrap text-[11px]">{children}</div>
  </div>
) : null);

function Page({ children }) {
  useEffect(() => {
    document.documentElement.classList.remove('dark');
    const t = setTimeout(() => window.print(), 500);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="min-h-full bg-zinc-100 py-6 text-zinc-900 print:bg-white print:py-0">
      <style>{'@page { size: A4; margin: 12mm; } @media print { .no-print { display: none !important; } }'}</style>
      <div className="no-print mx-auto mb-4 flex max-w-[210mm] justify-end gap-2 px-4">
        <button className="btn-primary" onClick={() => window.print()}><Printer className="h-4 w-4" /> Imprimir / salvar PDF</button>
      </div>
      <div className="mx-auto max-w-[210mm] space-y-4 bg-white p-[12mm] shadow print:max-w-none print:p-0 print:shadow-none">{children}</div>
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
  const values = o.total != null;
  const s = company.settings;
  return (
    <Page>
      <Header company={company} title={receipt ? (o.kind === 'venda' ? 'Recibo de venda' : 'Recibo') : 'Ordem de serviço'} number={o.number} date={fmtDateTime(o.received_at)} />
      <section className="grid grid-cols-2 gap-3 text-[11px]">
        <div className="rounded border border-zinc-300 p-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Cliente</div>
          <div className="font-semibold">{o.customer_name || 'Consumidor'}</div>
          <div>{[o.customer_document, o.customer_phone, o.customer_email].filter(Boolean).join(' · ')}</div>
        </div>
        {o.kind === 'os' ? (
          <div className="rounded border border-zinc-300 p-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Equipamento / peça</div>
            <div className="font-semibold">{o.equipment_description || '—'}</div>
            <div>{[o.equipment_brand, o.equipment_model, o.equipment_serial && `nº série ${o.equipment_serial}`].filter(Boolean).join(' · ')}</div>
          </div>
        ) : <div />}
      </section>
      {o.kind === 'os' && (
        <section className="grid grid-cols-4 gap-3 text-[11px]">
          <div><span className="text-zinc-500">Situação: </span><b>{ORDER_STATUS[o.status].label}</b></div>
          <div><span className="text-zinc-500">Técnico: </span>{o.technician_name || '—'}</div>
          <div><span className="text-zinc-500">Prazo: </span>{o.promised_at ? fmtDateTime(o.promised_at) : '—'}</div>
          <div><span className="text-zinc-500">Garantia: </span>{o.warranty_days ? `${o.warranty_days} dias${o.warranty_until ? ` (até ${fmt(o.warranty_until)})` : ''}` : '—'}</div>
        </section>
      )}
      {o.kind === 'os' && !receipt && (
        <section className="space-y-2">
          <Box title="Problema relatado">{o.problem}</Box>
          <div className="grid grid-cols-2 gap-2"><Box title="Acessórios deixados">{o.accessories}</Box><Box title="Estado na entrada">{o.condition}</Box></div>
          <Box title="Diagnóstico">{o.diagnosis}</Box>
          <Box title="Serviço executado">{o.solution}</Box>
        </section>
      )}
      {o.items.length > 0 && (
        values ? <section><Items items={o.items} /><Totals o={o} /></section>
          : <section className="text-[11px]"><b>Itens:</b> {o.items.map((i) => `${qty(i.qty)} ${i.unit || ''} ${i.description}`).join('; ')}</section>
      )}
      {values && receipt && o.payments.length > 0 && (
        <section className="text-[11px]">
          <div className="mb-1 font-semibold">Pagamentos</div>
          {o.payments.filter((t) => t.type === 'entrada').map((t) => (
            <div key={t.id} className="flex justify-between"><span>{methodName(s, t.method)} {t.paid_at ? `— pago em ${fmt(t.paid_at)}` : `— vence em ${fmt(t.due_date)}`}</span><span>{money(t.amount)}</span></div>
          ))}
          {o.balance > 0.009 && <div className="mt-1 flex justify-between font-semibold"><span>Saldo em aberto</span><span>{money(o.balance)}</span></div>}
        </section>
      )}
      {o.notes && <Box title="Observações">{o.notes}</Box>}
      {o.kind === 'os' && <p className="text-[10px] leading-snug text-zinc-600">{s.orders?.termsOrder}</p>}
      <section className="grid grid-cols-2 gap-10 pt-10 text-center text-[11px]">
        <div className="border-t border-zinc-600 pt-1">{company.trade_name || company.name}</div>
        <div className="border-t border-zinc-600 pt-1">{o.customer_name || 'Cliente'}{receipt ? ' — recebi o equipamento/material' : ' — de acordo'}</div>
      </section>
      {receipt && <p className="text-center text-[10px] text-zinc-500">Documento sem valor fiscal.</p>}
    </Page>
  );
}

export function PrintQuote() {
  const { id } = useParams();
  const { company } = useAuth();
  const [q, setQ] = useState(null);
  useEffect(() => { api.get(`/quotes/${id}`).then(setQ); }, [id]);
  if (!q) return <Loading />;
  return (
    <Page>
      <Header company={company} title="Orçamento" number={q.number} date={fmt(q.created_at)} />
      <section className="grid grid-cols-2 gap-3 text-[11px]">
        <div className="rounded border border-zinc-300 p-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Cliente</div>
          <div className="font-semibold">{q.customer_name}</div>
          <div>{[q.customer_document, q.customer_phone, q.customer_email].filter(Boolean).join(' · ')}</div>
          <div>{[q.street, q.address_number, q.district, q.city && `${q.city}/${q.uf || ''}`].filter(Boolean).join(', ')}</div>
        </div>
        <div className="rounded border border-zinc-300 p-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Equipamento / peça</div>
          <div className="font-semibold">{q.equipment_description || '—'}</div>
          <div>{[q.equipment_brand, q.equipment_model, q.equipment_serial && `nº série ${q.equipment_serial}`].filter(Boolean).join(' · ')}</div>
        </div>
      </section>
      <section>
        <h2 className="text-base font-bold">{q.title}</h2>
        {q.description && <p className="mt-1 whitespace-pre-wrap text-[11px]">{q.description}</p>}
      </section>
      <section><Items items={q.items} /><Totals o={q} /></section>
      <section className="grid grid-cols-4 gap-3 text-[11px]">
        <div><span className="text-zinc-500">Validade: </span><b>{fmt(q.valid_until)}</b></div>
        <div><span className="text-zinc-500">Prazo de execução: </span>{q.delivery_days != null ? `${q.delivery_days} dias` : '—'}</div>
        <div><span className="text-zinc-500">Garantia: </span>{q.warranty_days ? `${q.warranty_days} dias` : '—'}</div>
        <div><span className="text-zinc-500">Pagamento: </span>{q.payment_terms || 'a combinar'}</div>
      </section>
      <Box title="Condições">{q.terms}</Box>
      <section className="grid grid-cols-2 gap-10 pt-12 text-center text-[11px]">
        <div className="border-t border-zinc-600 pt-1">{company.trade_name || company.name}</div>
        <div className="border-t border-zinc-600 pt-1">{q.customer_name} — aprovado em ___/___/______</div>
      </section>
    </Page>
  );
}
