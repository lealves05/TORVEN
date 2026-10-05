// Cobrança na maquininha: escolhe o aparelho, envia o valor e acompanha até o provedor confirmar.
// O lançamento do pagamento na OS é feito pelo servidor, só depois de consultar o provedor.
import { useEffect, useRef, useState } from 'react';
import { CreditCard, Send, XCircle, CheckCircle2, AlertTriangle, Loader2, Copy, ExternalLink, Settings } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { money } from '../lib/format';
import { useUI } from '../context/UIContext';
import { Modal, Select, MoneyInput, useAction, FAIL, Loading, cx } from './ui';

const OPEN = ['pendente', 'enviada'];
const METHOD = { credito: 'Crédito', debito: 'Débito', pix: 'Pix' };
const STATUS = {
  pendente: { label: 'Preparando…', tone: 'text-ink-soft' },
  enviada: { label: 'Aguardando o pagamento', tone: 'text-primary' },
  paga: { label: 'Pagamento aprovado', tone: 'text-emerald-600' },
  recusada: { label: 'Pagamento recusado', tone: 'text-red-600' },
  cancelada: { label: 'Cobrança cancelada', tone: 'text-ink-soft' },
  expirada: { label: 'Cobrança expirada', tone: 'text-amber-600' },
  erro: { label: 'Falha ao enviar', tone: 'text-red-600' },
  divergente: { label: 'Valor pago diferente do enviado', tone: 'text-amber-600' },
};

function QrCode({ text }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let alive = true;
    import('qrcode').then((m) => m.toDataURL(text, { margin: 1, width: 220 })).then((u) => alive && setSrc(u)).catch(() => {});
    return () => { alive = false; };
  }, [text]);
  return src ? <img src={src} alt="QR code do link de pagamento" className="mx-auto h-[220px] w-[220px] rounded bg-white p-1" /> : null;
}

/**
 * @param {{ order: { id: string, number: number, balance: number, kind?: string }, onClose: () => void,
 *   onPaid: (charge: object) => void, auto?: boolean }} p
 *   auto: envia direto para a maquininha padrão (configuração "Ao fechar a OS: enviar automaticamente").
 */
export default function TerminalChargeModal({ order, onClose, onPaid, auto = false }) {
  const { toast } = useUI();
  const [run, busy] = useAction();
  const [devices, setDevices] = useState(null);
  const [form, setForm] = useState({ terminal_id: '', method: 'credito', installments: 1, amount: Number(order.balance) });
  const [charge, setCharge] = useState(null);
  const sentAuto = useRef(false);
  const paidRef = useRef(false);

  const device = devices?.find((d) => d.id === form.terminal_id);

  // aparelhos + cobrança em andamento desta OS (retoma em vez de mandar de novo)
  useEffect(() => {
    let alive = true;
    Promise.all([api.get('/terminal-charges/devices'), api.get(`/terminal-charges?order_id=${order.id}`)])
      .then(([devs, charges]) => {
        if (!alive) return;
        setDevices(devs);
        const def = devs.find((d) => d.is_default && d.ready) || devs.find((d) => d.ready);
        if (def) setForm((f) => ({ ...f, terminal_id: def.id, method: def.methods.includes(f.method) ? f.method : def.methods[0] }));
        const open = charges.find((c) => OPEN.includes(c.status));
        if (open) setCharge(open);
        else if (auto && def && !sentAuto.current) { sentAuto.current = true; send({ terminal_id: def.id, method: def.methods[0] }); }
      })
      .catch((e) => { if (alive) { setDevices([]); toast(e.message, 'error'); } });
    return () => { alive = false; };
  }, [order.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // acompanha a cobrança a cada 3 s enquanto estiver aberta
  useEffect(() => {
    if (!charge || !OPEN.includes(charge.status)) return undefined;
    const t = setInterval(() => {
      api.get(`/terminal-charges/${charge.id}`).then(setCharge).catch(() => {});
    }, 3000);
    return () => clearInterval(t);
  }, [charge?.id, charge?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (charge?.status === 'paga' && !paidRef.current) { paidRef.current = true; toast(`Recebido ${money(charge.paid_amount ?? charge.amount)} na maquininha`); onPaid?.(charge); }
  }, [charge?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  async function send(over = {}) {
    const body = { ...form, ...over };
    const r = await run(() => api.post('/terminal-charges', {
      order_id: order.id, terminal_id: body.terminal_id || null, method: body.method,
      installments: body.method === 'credito' ? Number(body.installments) || 1 : 1,
      amount: Math.round(Number(body.amount ?? form.amount) * 100) / 100,
    }));
    if (r !== FAIL) setCharge(r);
  }

  const cancel = async () => {
    const r = await run(() => api.post(`/terminal-charges/${charge.id}/cancel`), 'Cobrança cancelada');
    if (r !== FAIL) setCharge(r);
  };

  const st = charge ? STATUS[charge.status] || { label: charge.status } : null;
  const open = charge && OPEN.includes(charge.status);
  const amountOk = form.amount > 0 && form.amount <= Number(order.balance) + 0.009;

  const footer = charge ? (
    <>
      {open && <button className="btn-ghost text-red-600" disabled={busy} onClick={cancel}><XCircle className="h-4 w-4" /> Cancelar cobrança</button>}
      {!open && charge.status !== 'paga' && <button className="btn-outline" onClick={() => setCharge(null)}>Nova cobrança</button>}
      <button className={charge.status === 'paga' ? 'btn-primary' : 'btn-ghost'} onClick={onClose}>{charge.status === 'paga' ? 'Concluir' : open ? 'Fechar (continua aguardando)' : 'Fechar'}</button>
    </>
  ) : (
    <>
      <button className="btn-ghost" onClick={onClose}>Voltar</button>
      <button className="btn-primary" disabled={busy || !device || !device.ready || !amountOk} onClick={() => send()}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Enviar {money(form.amount)}
      </button>
    </>
  );

  return (
    <Modal open onClose={onClose} size="sm" title="Cobrar na maquininha" footer={devices && (devices.length > 0 || charge) ? footer : null}
      subtitle={`${order.kind === 'venda' ? 'Venda' : 'OS'} nº ${order.number} · saldo ${money(order.balance)}`}>
      {!devices ? <Loading /> : charge ? (
        <div className="space-y-4 text-center">
          <div className={cx('flex items-center justify-center gap-2 text-base font-semibold', st.tone)}>
            {open ? <Loader2 className="h-5 w-5 animate-spin" /> : charge.status === 'paga' ? <CheckCircle2 className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
            {st.label}
          </div>
          <p className="text-2xl font-semibold tabular-nums">{money(charge.paid_amount ?? charge.amount)}</p>
          <p className="text-sm text-ink-soft">
            {charge.provider_name} · {METHOD[charge.method] || charge.method}{charge.method === 'credito' && charge.installments > 1 ? ` em ${charge.installments}x` : ''}
            {charge.nsu && <> · NSU {charge.nsu}</>}{charge.card_brand && <> · {charge.card_brand}</>}
          </p>
          {open && !charge.link_url && <p className="text-sm text-ink-soft">O valor foi enviado para a maquininha. Peça para o cliente aproximar ou inserir o cartão.</p>}
          {charge.link_url && open && (
            <div className="space-y-2">
              <QrCode text={charge.link_url} />
              <p className="text-sm text-ink-soft">Mostre o QR code ao cliente, abra o link na maquininha/celular ou envie por WhatsApp.</p>
              <div className="flex justify-center gap-2">
                <button className="btn-outline" onClick={() => navigator.clipboard?.writeText(charge.link_url).then(() => toast('Link copiado'))}><Copy className="h-4 w-4" /> Copiar link</button>
                <a className="btn-outline" href={charge.link_url} target="_blank" rel="noreferrer noopener"><ExternalLink className="h-4 w-4" /> Abrir</a>
              </div>
            </div>
          )}
          {charge.message && <p className="rounded-app-sm bg-amber-500/10 p-2 text-sm text-amber-800 dark:text-amber-200">{charge.message}</p>}
          {charge.check_error && open && <p className="text-xs text-ink-faint">Não foi possível consultar agora ({charge.check_error}). Tentando de novo…</p>}
          {open && <p className="text-xs text-ink-faint">A confirmação vem do provedor; o pagamento é lançado na OS automaticamente.</p>}
        </div>
      ) : devices.length === 0 ? (
        <div className="space-y-3 text-sm">
          <p>Nenhuma maquininha ativa. Configure o provedor e cadastre os aparelhos em Configurações › Integrações.</p>
          <Link to="/configuracoes?tab=integracoes" className="btn-outline" onClick={onClose}><Settings className="h-4 w-4" /> Abrir configurações</Link>
        </div>
      ) : (
        <div className="space-y-3">
          <Select label="Maquininha" value={form.terminal_id} onChange={(e) => {
            const d = devices.find((x) => x.id === e.target.value);
            setForm((f) => ({ ...f, terminal_id: e.target.value, method: d?.methods.includes(f.method) ? f.method : d?.methods[0] || 'credito' }));
          }}>
            {devices.map((d) => <option key={d.id} value={d.id} disabled={!d.ready}>{d.name} · {d.provider_name}{d.is_default ? ' (padrão)' : ''}{d.ready ? '' : ' — em preparação'}</option>)}
          </Select>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Forma de pagamento">
            {(device?.methods || []).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={form.method === m} onClick={() => setForm({ ...form, method: m })}
                className={cx('btn border', form.method === m ? 'border-primary bg-primary/10 text-primary' : 'border-line text-ink-soft')}>
                <CreditCard className="h-4 w-4" /> {METHOD[m]}
              </button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <MoneyInput label="Valor" value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} />
            {form.method === 'credito' && (
              <Select label="Parcelas" value={form.installments} onChange={(e) => setForm({ ...form, installments: Number(e.target.value) })}>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n === 1 ? 'À vista' : `${n}x de ${money(form.amount / n)}`}</option>)}
              </Select>
            )}
          </div>
          {!amountOk && <p className="text-xs text-red-600">O valor deve ser maior que zero e no máximo o saldo da OS.</p>}
          {device?.mode === 'link' && <p className="text-xs text-ink-faint">{device.provider_name} cobra por link/QR code: o cliente paga na maquininha ou no celular.</p>}
        </div>
      )}
    </Modal>
  );
}
