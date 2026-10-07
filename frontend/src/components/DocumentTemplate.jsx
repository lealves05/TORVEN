// Modelo dos documentos impressos (OS, recibo, orçamento), parametrizado em Configurações › Documentos:
// logo (posição e tamanho), cor de destaque, estilo do cabeçalho, fonte, títulos, campos exibidos, textos de cabeçalho/rodapé,
// assinaturas, vias e papel (A4 ou cupom 80 mm). O mesmo componente desenha a impressão e a pré-visualização.
import { money, fmt, fmtDateTime, qty, ORDER_STATUS, methodName } from '../lib/format';

export const DOC_DEFAULTS = {
  accentColor: '', headerStyle: 'linha', logoPosition: 'left', logoSize: 'm', font: 'sistema', paper: 'a4', copies: 1,
  titles: { os: 'Ordem de serviço', receipt: 'Recibo', quote: 'Orçamento' },
  equipmentLabel: 'Equipamento / peça', headerNote: '', footerNote: '', signatureCompany: '', signatureCustomer: 'de acordo',
  show: {
    status: true, technician: true, promised: true, warranty: true, problem: true, accessories: true, condition: true,
    diagnosis: true, solution: true, values: true, notes: true, terms: true, signatures: true, document: true, address: true,
  },
};

/** Configuração efetiva do documento (padrões + o que a empresa ajustou). */
export function docConfig(settings = {}) {
  const d = settings.documents || {};
  return {
    ...DOC_DEFAULTS, ...d,
    titles: { ...DOC_DEFAULTS.titles, ...(d.titles || {}) },
    show: { ...DOC_DEFAULTS.show, ...(d.show || {}) },
    accent: d.accentColor || settings.primaryColor || '#ea580c',
  };
}

const LOGO_H = { p: 40, m: 64, g: 96 };
const FONT = { sistema: undefined, serifada: 'Georgia, "Times New Roman", serif' };

/** Texto legível (preto/branco) sobre a cor de destaque. */
function onColor(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '#fff';
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? '#111' : '#fff';
}

export function DocHeader({ company, cfg, title, number, date }) {
  const addr = [company.street, company.number, company.district, company.city && `${company.city}/${company.uf || ''}`, company.cep].filter(Boolean).join(', ');
  const band = cfg.headerStyle === 'faixa';
  const center = cfg.logoPosition === 'center';
  const fg = band ? onColor(cfg.accent) : undefined;
  const logo = company.logo_url && (
    <img src={company.logo_url} alt="" style={{ height: LOGO_H[cfg.logoSize] || 64, maxWidth: (LOGO_H[cfg.logoSize] || 64) * 3.2 }}
      className={band ? 'rounded bg-white p-1 object-contain' : 'object-contain'} />
  );
  return (
    <header data-doc-header className={band ? 'rounded px-4 py-3' : cfg.headerStyle === 'simples' ? 'pb-3' : 'border-b-2 pb-4'}
      style={band ? { background: cfg.accent, color: fg } : { borderColor: cfg.accent }}>
      <div className={center ? 'flex flex-col items-center gap-2 text-center' : 'flex items-start justify-between gap-6'}>
        <div className={center ? 'flex flex-col items-center gap-2' : 'flex items-start gap-4'}>
          {logo}
          <div className="text-[11px] leading-snug">
            <div className="text-base font-bold" style={!band ? { color: cfg.accent } : undefined}>{company.trade_name || company.name}</div>
            {company.trade_name && company.trade_name !== company.name && <div>{company.name}</div>}
            {cfg.show.document && company.document && <div>CNPJ/CPF {company.document}{company.state_registration && ` · IE ${company.state_registration}`}</div>}
            {cfg.show.address && addr && <div>{addr}</div>}
            <div>{[company.phone, company.email].filter(Boolean).join(' · ')}</div>
            {cfg.headerNote && <div className="mt-0.5 italic">{cfg.headerNote}</div>}
          </div>
        </div>
        <div className={center ? '' : 'shrink-0 text-right'}>
          <div className="text-xs uppercase tracking-wider" style={{ opacity: 0.75 }}>{title}</div>
          <div className="text-2xl font-bold">nº {number}</div>
          <div className="text-[11px]">{date}</div>
        </div>
      </div>
    </header>
  );
}

const Box = ({ title, children, accent }) => (children ? (
  <div className="rounded border border-zinc-300 p-2.5">
    <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: accent }}>{title}</div>
    <div className="whitespace-pre-wrap text-[11px]">{children}</div>
  </div>
) : null);

export function Items({ items, accent }) {
  return (
    <table className="w-full border-collapse text-[11px]">
      <thead><tr className="border-b-2 text-left" style={{ borderColor: accent }}>
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

export const Totals = ({ o, accent }) => (
  <div className="ml-auto mt-2 w-64 space-y-0.5 text-[12px]">
    <div className="flex justify-between"><span>Subtotal</span><span>{money(o.subtotal)}</span></div>
    {Number(o.discount) > 0 && <div className="flex justify-between"><span>Desconto</span><span>− {money(o.discount)}</span></div>}
    {Number(o.surcharge) > 0 && <div className="flex justify-between"><span>Acréscimos</span><span>+ {money(o.surcharge)}</span></div>}
    {o.approved_total != null && Number(o.approved_total) !== Number(o.total) && <div className="flex justify-between font-semibold"><span>Valor aprovado</span><span>{money(o.approved_total)}</span></div>}
    <div className="flex justify-between border-t-2 pt-1 text-sm font-bold" style={{ borderColor: accent }}><span>Total</span><span>{money(o.total)}</span></div>
  </div>
);

export const DocFooter = ({ cfg }) => (cfg.footerNote
  ? <p className="border-t pt-2 text-center text-[10px] text-zinc-600" style={{ borderColor: cfg.accent }}>{cfg.footerNote}</p> : null);

const equipLine = (o) => [o.equipment_plate && `Placa ${o.equipment_plate}`, o.equipment_brand, o.equipment_model, o.equipment_year,
  o.equipment_color, o.equipment_serial && `nº série ${o.equipment_serial}`].filter(Boolean).join(' · ');

/** Uma via da OS / recibo no papel A4. */
function OrderA4({ company, o, cfg, receipt, settings, via }) {
  const show = cfg.show;
  const values = o.total != null && show.values;
  const title = receipt ? (o.kind === 'venda' ? `${cfg.titles.receipt} de venda` : cfg.titles.receipt) : cfg.titles.os;
  const facts = [
    show.status && ['Situação', <b key="s">{ORDER_STATUS[o.status]?.label || o.status}</b>],
    show.technician && ['Técnico', o.technician_name || '—'],
    show.promised && ['Prazo', o.promised_at ? fmtDateTime(o.promised_at) : '—'],
    show.warranty && ['Garantia', o.warranty_days ? `${o.warranty_days} dias${o.warranty_until ? ` (até ${fmt(o.warranty_until)})` : ''}` : '—'],
  ].filter(Boolean);
  return (
    <div className="space-y-4">
      {via && <div className="text-right text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{via}</div>}
      <DocHeader company={company} cfg={cfg} title={title} number={o.number} date={fmtDateTime(o.received_at)} />
      <section className="grid grid-cols-2 gap-3 text-[11px]">
        <div className="rounded border border-zinc-300 p-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: cfg.accent }}>Cliente</div>
          <div className="font-semibold">{o.customer_name || 'Consumidor'}</div>
          <div>{[o.customer_document, o.customer_phone, o.customer_email].filter(Boolean).join(' · ')}</div>
        </div>
        {o.kind === 'os' ? (
          <div className="rounded border border-zinc-300 p-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: cfg.accent }}>{cfg.equipmentLabel}</div>
            <div className="font-semibold">{o.equipment_description || '—'}</div>
            <div>{equipLine(o)}</div>
          </div>
        ) : <div />}
      </section>
      {o.kind === 'os' && facts.length > 0 && (
        <section className="grid gap-3 text-[11px]" style={{ gridTemplateColumns: `repeat(${facts.length}, minmax(0, 1fr))` }}>
          {facts.map(([k, v]) => <div key={k}><span className="text-zinc-500">{k}: </span>{v}</div>)}
        </section>
      )}
      {o.kind === 'os' && !receipt && (
        <section className="space-y-2">
          {show.problem && <Box title="Problema relatado" accent={cfg.accent}>{o.problem}</Box>}
          {(show.accessories || show.condition) && (
            <div className="grid grid-cols-2 gap-2">
              {show.accessories && <Box title="Acessórios deixados" accent={cfg.accent}>{o.accessories}</Box>}
              {show.condition && <Box title="Estado na entrada" accent={cfg.accent}>{o.condition}</Box>}
            </div>
          )}
          {show.diagnosis && <Box title="Diagnóstico" accent={cfg.accent}>{o.diagnosis}</Box>}
          {show.solution && <Box title="Serviço executado" accent={cfg.accent}>{o.solution}</Box>}
        </section>
      )}
      {o.items.length > 0 && (
        values ? <section><Items items={o.items} accent={cfg.accent} /><Totals o={o} accent={cfg.accent} /></section>
          : <section className="text-[11px]"><b>Itens:</b> {o.items.map((i) => `${qty(i.qty)} ${i.unit || ''} ${i.description}`).join('; ')}</section>
      )}
      {values && receipt && o.payments?.length > 0 && (
        <section className="text-[11px]">
          <div className="mb-1 font-semibold">Pagamentos</div>
          {o.payments.filter((t) => t.type === 'entrada').map((t) => (
            <div key={t.id} className="flex justify-between"><span>{methodName(settings, t.method)} {t.paid_at ? `— pago em ${fmt(t.paid_at)}` : `— vence em ${fmt(t.due_date)}`}</span><span>{money(t.amount)}</span></div>
          ))}
          {o.balance > 0.009 && <div className="mt-1 flex justify-between font-semibold"><span>Saldo em aberto</span><span>{money(o.balance)}</span></div>}
        </section>
      )}
      {show.notes && o.notes && <Box title="Observações" accent={cfg.accent}>{o.notes}</Box>}
      {o.kind === 'os' && show.terms && settings.orders?.termsOrder && <p className="text-[10px] leading-snug text-zinc-600">{settings.orders.termsOrder}</p>}
      {show.signatures && (
        <section className="grid grid-cols-2 gap-10 pt-10 text-center text-[11px]">
          <div className="border-t border-zinc-600 pt-1">{cfg.signatureCompany || company.trade_name || company.name}</div>
          <div className="border-t border-zinc-600 pt-1">{o.customer_name || 'Cliente'}{receipt ? ' — recebi o equipamento/material' : cfg.signatureCustomer ? ` — ${cfg.signatureCustomer}` : ''}</div>
        </section>
      )}
      {receipt && <p className="text-center text-[10px] text-zinc-500">Documento sem valor fiscal.</p>}
      <DocFooter cfg={cfg} />
    </div>
  );
}

/** Cupom para impressora térmica de 80 mm: uma coluna, letras pequenas, sem quadros. */
function OrderCupom({ company, o, cfg, receipt, settings, via }) {
  const show = cfg.show;
  const values = o.total != null && show.values;
  const line = <div className="my-1.5 border-t border-dashed border-zinc-500" />;
  const title = receipt ? cfg.titles.receipt : cfg.titles.os;
  return (
    <div className="mx-auto w-[72mm] font-mono text-[10.5px] leading-snug text-black">
      <div className="text-center">
        {company.logo_url && <img src={company.logo_url} alt="" className="mx-auto mb-1 object-contain grayscale" style={{ height: Math.min(LOGO_H[cfg.logoSize] || 64, 56), maxWidth: '60mm' }} />}
        <div className="font-bold">{company.trade_name || company.name}</div>
        {show.document && company.document && <div>{company.document}</div>}
        <div>{company.phone}</div>
        {cfg.headerNote && <div className="italic">{cfg.headerNote}</div>}
      </div>
      {line}
      <div className="text-center font-bold uppercase">{title} nº {o.number}</div>
      <div className="text-center">{fmtDateTime(o.received_at)}</div>
      {via && <div className="text-center">{via}</div>}
      {line}
      <div><b>Cliente:</b> {o.customer_name || 'Consumidor'}</div>
      {o.customer_phone && <div>{o.customer_phone}</div>}
      {o.kind === 'os' && <div><b>{cfg.equipmentLabel}:</b> {[o.equipment_description, equipLine(o)].filter(Boolean).join(' · ') || '—'}</div>}
      {o.kind === 'os' && show.promised && o.promised_at && <div><b>Prazo:</b> {fmtDateTime(o.promised_at)}</div>}
      {o.kind === 'os' && !receipt && show.problem && o.problem && <div className="whitespace-pre-wrap"><b>Problema:</b> {o.problem}</div>}
      {o.kind === 'os' && !receipt && show.accessories && o.accessories && <div className="whitespace-pre-wrap"><b>Acessórios:</b> {o.accessories}</div>}
      {o.items.length > 0 && (
        <>
          {line}
          {o.items.map((i, k) => (
            <div key={k}>
              <div>{i.description}</div>
              <div className="flex justify-between"><span>{qty(i.qty)} {i.unit || ''}{values ? ` x ${money(i.unit_price)}` : ''}</span>{values && <span>{money(i.total)}</span>}</div>
            </div>
          ))}
          {values && <>{line}<div className="flex justify-between text-[12px] font-bold"><span>TOTAL</span><span>{money(o.total)}</span></div></>}
        </>
      )}
      {values && receipt && o.payments?.filter((t) => t.type === 'entrada').map((t) => (
        <div key={t.id} className="flex justify-between"><span>{methodName(settings, t.method)}</span><span>{money(t.amount)}</span></div>
      ))}
      {show.warranty && o.warranty_days ? <div className="mt-1">Garantia: {o.warranty_days} dias</div> : null}
      {show.signatures && <div className="mt-8 border-t border-black pt-0.5 text-center">{o.customer_name || 'Cliente'}</div>}
      {line}
      {cfg.footerNote && <div className="text-center">{cfg.footerNote}</div>}
      {receipt && <div className="text-center">Documento sem valor fiscal.</div>}
    </div>
  );
}

/** OS / recibo completo, com as vias configuradas. */
export function OrderDocument({ company, o, settings, receipt = false }) {
  const cfg = docConfig(settings);
  const Paper = cfg.paper === 'cupom80' ? OrderCupom : OrderA4;
  const copies = Number(cfg.copies) === 2 ? ['Via da empresa', 'Via do cliente'] : [null];
  return (
    <div style={{ fontFamily: FONT[cfg.font] }}>
      {copies.map((via, k) => (
        <div key={k} className={k > 0 ? 'mt-8 border-t border-dashed border-zinc-400 pt-8 print:mt-0 print:border-0 print:pt-0 print:[break-before:page]' : ''}>
          <Paper company={company} o={o} cfg={cfg} receipt={receipt} settings={settings} via={via} />
        </div>
      ))}
    </div>
  );
}

/** Dados de exemplo para a pré-visualização em Configurações. */
export const SAMPLE_ORDER = {
  kind: 'os', number: 128, status: 'em_execucao', received_at: new Date().toISOString(),
  promised_at: new Date(Date.now() + 3 * 864e5).toISOString(), warranty_days: 90,
  customer_name: 'Maria Oliveira', customer_phone: '(19) 99876-5432', customer_document: '123.456.789-09',
  equipment_description: 'Portão basculante', equipment_brand: 'Metalúrgica Silva', equipment_plate: null,
  technician_name: 'Carlos', problem: 'Portão arrastando no trilho e solda da longarina trincada.',
  accessories: 'Controle remoto', condition: 'Pintura descascada na lateral esquerda.', diagnosis: 'Roldana gasta e trinca de 12 cm na longarina.',
  solution: '', notes: 'Cliente pediu orçamento da pintura.',
  items: [
    { kind: 'servico', description: 'Solda TIG na longarina', qty: 1, unit: 'serv', unit_price: 280, discount: 0, total: 280 },
    { kind: 'material', description: 'Roldana 4" com rolamento', qty: 2, unit: 'un', unit_price: 45, discount: 0, total: 90 },
  ],
  subtotal: 370, discount: 0, surcharge: 0, total: 370, payments: [], balance: 370,
};
