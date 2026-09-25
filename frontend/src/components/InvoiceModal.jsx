import { useEffect, useState } from 'react';
import { AlertTriangle, FileCheck2, Info, Loader2 } from 'lucide-react';
import { api, qs } from '../lib/api';
import { money, qty } from '../lib/format';
import { Modal, useAction, FAIL, cx } from './ui';

/** Emissão de NFS-e (serviços) ou NF-e (materiais) a partir de uma OS/venda. */
export default function InvoiceModal({ order, onClose, onDone }) {
  const goods = (i) => ['material', 'consumivel'].includes(i.kind) && i.product_id;
  const hasServices = order.items?.some((i) => !goods(i));
  const hasMaterials = order.items?.some(goods);
  const [kind, setKind] = useState(hasServices ? 'nfse' : 'nfe');
  const [prev, setPrev] = useState(null);
  const [run, busy] = useAction();
  const [polling, setPolling] = useState(false);

  useEffect(() => {
    setPrev(null);
    api.get(`/invoices/preview${qs({ order_id: order.id, kind })}`).then(setPrev).catch((e) => setPrev({ error: e.message }));
  }, [kind, order.id]);

  const emit = async (prepareOnly = false) => {
    const r = await run(() => api.post('/invoices', { order_id: order.id, kind, prepare_only: prepareOnly }), prepareOnly || prev?.provider !== 'focus' ? 'Documento preparado para conferência' : null);
    if (r === FAIL) return;
    if (r.status === 'processando') {
      setPolling(true);
      let inv = r;
      for (let i = 0; i < 8 && inv.status === 'processando'; i++) {
        await new Promise((ok) => setTimeout(ok, 2500));
        try { inv = await api.post(`/invoices/${r.id}/refresh`); } catch { break; }
      }
      setPolling(false);
      onDone(inv);
    } else onDone(r);
  };

  const focus = prev?.provider === 'focus';
  const blocked = prev?.existing?.length > 0;
  return (
    <Modal open onClose={onClose} title="Nota fiscal" subtitle={`${order.kind === 'venda' ? 'Venda' : 'OS'} nº ${order.number}`} size="lg"
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Cancelar</button>
        {focus && <button className="btn-outline" disabled={busy || polling || !prev || prev.error || prev.amount <= 0 || blocked} onClick={() => emit(true)}>Só preparar</button>}
        <button className="btn-primary" disabled={busy || polling || !prev || prev.error || prev.amount <= 0 || blocked || (focus && prev.warnings.length > 0)} onClick={() => emit(!focus)}>
          {polling ? <><Loader2 className="h-4 w-4 animate-spin" /> Aguardando autorização…</> : <><FileCheck2 className="h-4 w-4" /> {focus ? 'Emitir nota' : 'Preparar documento'}</>}
        </button>
      </>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          {[['nfse', 'NFS-e (serviços)', hasServices], ['nfe', 'NF-e (materiais)', hasMaterials]].map(([k, l, ok]) => (
            <button key={k} disabled={!ok} onClick={() => setKind(k)}
              className={cx('btn border', kind === k ? 'border-primary bg-primary/10 text-primary' : 'border-line', !ok && 'opacity-40')}>{l}</button>
          ))}
        </div>
        {!prev ? <div className="py-8 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-ink-faint" /></div> : prev.error ? (
          <div className="rounded-app-sm bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">{prev.error}</div>
        ) : (
          <>
            {!focus && (
              <div className="flex gap-2 rounded-app-sm bg-sky-500/10 p-3 text-sm text-sky-800 dark:text-sky-200">
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                <span><b>Emissão indisponível: integração fiscal não configurada.</b> Você pode preparar o documento para conferência (sem número e sem valor fiscal). Configure a Focus NFe em Configurações › Fiscal para emitir notas reais.</span>
              </div>
            )}
            {focus && <div className="text-xs text-ink-faint">Focus NFe · ambiente de <b>{prev.environment === 'producao' ? 'produção' : 'homologação (testes)'}</b> · {prev.endpoint === 'nfsen' ? 'NFS-e padrão nacional' : prev.endpoint === 'nfse' ? 'NFS-e municipal' : 'NF-e modelo 55'}</div>}
            {prev.warnings.length > 0 && (
              <div className="space-y-1 rounded-app-sm bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
                {prev.warnings.map((w) => <div key={w} className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{w}</div>)}
              </div>
            )}
            {prev.existing?.length > 0 && (
              <div className="rounded-app-sm bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
                Já existe nota deste tipo {prev.existing[0].status === 'autorizada' ? 'autorizada' : 'em processamento'} para esta OS (nº {prev.existing.map((e) => e.number || '—').join(', ')}). Cancele-a antes de emitir outra.
              </div>
            )}
            <div className="text-sm"><span className="text-ink-faint">Tomador: </span>{prev.customer ? `${prev.customer.name}${prev.customer.document ? ` · ${prev.customer.document}` : ''}` : 'Consumidor não identificado'}</div>
            <div className="divide-y divide-line rounded-app-sm border border-line text-sm">
              {prev.items.map((i, k) => (
                <div key={k} className="flex justify-between gap-3 px-3 py-2"><span>{Number(i.qty) !== 1 && `${qty(i.qty)} ${i.unit || ''} × `}{i.description}</span><span className="tabular-nums">{money(i.net)}</span></div>
              ))}
              <div className="flex justify-between px-3 py-2 font-semibold"><span>Valor da nota</span><span className="tabular-nums">{money(prev.amount)}</span></div>
            </div>
            {kind === 'nfse' && <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-app-sm bg-muted/60 p-3 text-xs text-ink-soft">{prev.description}</pre>}
          </>
        )}
      </div>
    </Modal>
  );
}
