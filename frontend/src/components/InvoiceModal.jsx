import { useEffect, useState } from 'react';
import { AlertTriangle, FileCheck2, Info, Loader2, Building2, Copy } from 'lucide-react';
import { api, qs } from '../lib/api';
import { money, qty, maskDoc } from '../lib/format';
import { useUI } from '../context/UIContext';
import { Modal, Select, useAction, FAIL, cx } from './ui';

/** Emissão de NFS-e (serviços) ou NF-e (materiais) a partir de uma OS/venda, pelo emitente (CNPJ + emissor) escolhido. */
export default function InvoiceModal({ order, onClose, onDone }) {
  const goods = (i) => ['material', 'consumivel'].includes(i.kind) && i.product_id;
  const hasServices = order.items?.some((i) => !goods(i));
  const hasMaterials = order.items?.some(goods);
  const [kind, setKind] = useState(hasServices ? 'nfse' : 'nfe');
  const [emitters, setEmitters] = useState(null);
  const [emitterId, setEmitterId] = useState('');
  const [prev, setPrev] = useState(null);
  const [run, busy] = useAction();
  const [polling, setPolling] = useState(false);
  const { toast } = useUI();

  useEffect(() => {
    api.get('/fiscal/emitters/options').then((l) => {
      setEmitters(l);
      setEmitterId((cur) => cur || (l.find((e) => e.is_default) || l[0])?.id || '');
    }).catch(() => setEmitters([]));
  }, []);

  useEffect(() => {
    if (emitters === null) return;
    setPrev(null);
    api.get(`/invoices/preview${qs({ order_id: order.id, kind, emitter_id: emitterId || undefined })}`).then(setPrev).catch((e) => setPrev({ error: e.message }));
  }, [kind, order.id, emitterId, emitters]);

  const em = prev?.emitter;
  const manual = !!prev?.manual;
  const canIssue = em ? !manual : prev?.provider === 'focus';

  const emit = async (prepareOnly = false) => {
    const r = await run(() => api.post('/invoices', { order_id: order.id, kind, prepare_only: prepareOnly, emitter_id: emitterId || undefined }),
      manual ? 'Nota preparada. Emita no site oficial e depois clique em “Informar nº”.' : prepareOnly || !canIssue ? 'Documento preparado para conferência' : null);
    if (r === FAIL) return;
    if (r.status === 'processando') {
      setPolling(true);
      let inv = r;
      for (let i = 0; i < 8 && inv.status === 'processando'; i++) {
        await new Promise((ok) => setTimeout(ok, 2500));
        try { inv = await api.post(`/invoices/${r.id}/refresh`); } catch { break; }
      }
      setPolling(false);
      if (inv.status === 'processando') toast('A nota continua em processamento. Consulte a situação em Notas fiscais daqui a pouco.');
      onDone(inv);
    } else onDone(r);
  };
  const copy = (text) => { navigator.clipboard?.writeText(text).then(() => toast('Copiado')).catch(() => {}); };

  const blocked = prev?.existing?.length > 0;
  const docKind = kind === 'nfe' ? 'NF-e' : 'NFS-e';
  return (
    <Modal open onClose={onClose} title="Nota fiscal" subtitle={`${order.kind === 'venda' ? 'Venda' : 'OS'} nº ${order.number}`} size="lg"
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Cancelar</button>
        {canIssue && <button className="btn-outline" disabled={busy || polling || !prev || prev.error || prev.amount <= 0 || blocked} onClick={() => emit(true)}>Só preparar</button>}
        <button className="btn-primary" data-tour="emitir-nota" disabled={busy || polling || !prev || prev.error || prev.amount <= 0 || blocked || (canIssue && prev.warnings.length > 0)} onClick={() => emit(!canIssue && !manual)}>
          {polling ? <><Loader2 className="h-4 w-4 animate-spin" /> Aguardando autorização…</> : <><FileCheck2 className="h-4 w-4" /> {canIssue ? 'Emitir nota' : manual ? 'Preparar para emitir no site' : 'Preparar documento'}</>}
        </button>
      </>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          {[['nfse', 'NFS-e (serviços)', hasServices], ['nfe', 'NF-e (materiais)', hasMaterials]].map(([k, l, ok]) => (
            <button key={k} disabled={!ok} onClick={() => setKind(k)}
              className={cx('btn border', kind === k ? 'border-primary bg-primary/10 text-primary' : 'border-line', !ok && 'opacity-40')}>{l}</button>
          ))}
        </div>
        {emitters?.length > 1 && (
          <Select label="Emitir pelo CNPJ" value={emitterId} onChange={(e) => setEmitterId(e.target.value)} data-tour="escolher-emitente">
            {emitters.map((e) => (
              <option key={e.id} value={e.id}>{e.name} · {maskDoc(e.cnpj)} · {e.provider_name}{e.is_default ? ' (padrão)' : ''}</option>
            ))}
          </Select>
        )}
        {!prev ? <div className="py-8 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-ink-faint" /></div> : prev.error ? (
          <div className="rounded-app-sm bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">{prev.error}</div>
        ) : (
          <>
            {!em && !canIssue && (
              <div className="flex gap-2 rounded-app-sm bg-sky-500/10 p-3 text-sm text-sky-800 dark:text-sky-200">
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                <span><b>Emissão indisponível: nenhum emitente fiscal cadastrado.</b> Você pode preparar o documento para conferência (sem número e sem valor fiscal). Cadastre o CNPJ e o emissor em Configurações › Fiscal para emitir notas reais.</span>
              </div>
            )}
            {em && (
              <div className="flex items-center gap-2 text-xs text-ink-faint">
                <Building2 className="h-3.5 w-3.5" /> {em.name} · {maskDoc(em.cnpj)} · {em.provider_name}
                {!manual && <> · ambiente de <b>{em.environment === 'producao' ? 'produção' : 'homologação (testes)'}</b></>}
              </div>
            )}
            {!em && canIssue && <div className="text-xs text-ink-faint">Focus NFe · ambiente de <b>{prev.environment === 'producao' ? 'produção' : 'homologação (testes)'}</b> · {prev.endpoint === 'nfsen' ? 'NFS-e padrão nacional' : prev.endpoint === 'nfse' ? 'NFS-e municipal' : 'NF-e modelo 55'}</div>}
            {manual && (
              <div className="flex gap-2 rounded-app-sm bg-sky-500/10 p-3 text-sm text-sky-800 dark:text-sky-200">
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                <span>Este CNPJ emite <b>no site da prefeitura/SEFAZ</b>. O TORVEN prepara os dados abaixo para você copiar. Depois de emitir lá, volte em <b>Notas fiscais</b> e clique em <b>Informar nº</b>.</span>
              </div>
            )}
            {prev.warnings.length > 0 && (
              <div className="space-y-1 rounded-app-sm bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
                {prev.warnings.map((w) => <div key={w} className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{w}</div>)}
              </div>
            )}
            {prev.existing?.length > 0 && (
              <div className="rounded-app-sm bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
                Já existe {docKind} {prev.existing[0].status === 'autorizada' ? 'autorizada' : 'em processamento'} para esta OS (nº {prev.existing.map((e) => e.number || '—').join(', ')}). Cancele-a antes de emitir outra.
              </div>
            )}
            <div className="text-sm"><span className="text-ink-faint">Tomador: </span>{prev.customer ? `${prev.customer.name}${prev.customer.document ? ` · ${prev.customer.document}` : ''}` : 'Consumidor não identificado'}</div>
            <div className="divide-y divide-line rounded-app-sm border border-line text-sm">
              {prev.items.map((i, k) => (
                <div key={k} className="flex justify-between gap-3 px-3 py-2"><span>{Number(i.qty) !== 1 && `${qty(i.qty)} ${i.unit || ''} × `}{i.description}</span><span className="tabular-nums">{money(i.net)}</span></div>
              ))}
              <div className="flex justify-between px-3 py-2 font-semibold"><span>Valor da nota</span><span className="tabular-nums">{money(prev.amount)}</span></div>
            </div>
            {kind === 'nfse' && (
              <div className="relative">
                <pre className={cx('max-h-32 overflow-auto whitespace-pre-wrap rounded-app-sm bg-muted/60 p-3 text-xs text-ink-soft', manual && 'pr-24')}>{prev.description}</pre>
                {manual && <button className="btn-ghost absolute right-1 top-1 h-7 text-xs" onClick={() => copy(prev.description)}><Copy className="h-3.5 w-3.5" /> Copiar</button>}
              </div>
            )}
            {manual && prev.document?.service && (
              <dl className="grid gap-2 rounded-app-sm border border-line p-3 text-sm sm:grid-cols-3">
                {[['Item LC 116', prev.document.service.lc116], ['Cód. tributação nacional', prev.document.service.national_code], ['Alíquota ISS', `${prev.document.service.iss_rate}%`],
                  ['CNPJ/CPF do tomador', prev.document.customer?.doc ? maskDoc(prev.document.customer.doc) : '—'], ['Valor', money(prev.amount)], ['ISS retido', prev.document.service.iss_retained ? 'Sim' : 'Não']].map(([k, v]) => (
                  <div key={k}><dt className="text-xs text-ink-faint">{k}</dt><dd className="font-medium">{v}</dd></div>
                ))}
              </dl>
            )}
            {em && !manual && prev.payload && (
              <details className="text-xs">
                <summary className="cursor-pointer text-ink-faint">Ver o envio completo para {em.provider_name} (conferência técnica)</summary>
                <pre className="mt-2 max-h-60 overflow-auto rounded-app-sm bg-muted/60 p-3">{JSON.stringify(prev.payload, null, 2)}</pre>
              </details>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
