// Impressão A4 de OS, recibo e orçamento (use "Salvar como PDF" no navegador).
import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Printer } from 'lucide-react';
import { api } from '../lib/api';
import { fmt } from '../lib/format';
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
