// Botão de voz: ouve um comando em português, mostra o que entendeu e só executa depois da confirmação.
// Usa o reconhecimento de fala do navegador (Chrome/Edge/Android/Safari). O áudio é processado pelo serviço do navegador.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mic, MicOff, Check, HelpCircle } from 'lucide-react';
import { api } from '../lib/api';
import { parseCommand, VOICE_EXAMPLES } from '../lib/voice';
import { useAuth } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import { Modal, Input, Textarea, Select, cx } from './ui';

const Recognition = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
export const voiceSupported = () => !!Recognition;

const STATUS = [['aberta', 'Recebida'], ['diagnostico', 'Em diagnóstico'], ['aguardando_aprovacao', 'Aguardando aprovação'], ['aprovada', 'Aprovada'],
  ['aguardando_material', 'Aguardando material'], ['em_execucao', 'Em execução'], ['pronta', 'Pronta']];

/** Hook de reconhecimento: start() → onText(final). */
export function useSpeech(onText) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState('');
  const rec = useRef(null);
  const cb = useRef(onText);
  cb.current = onText;
  const stop = useCallback(() => { try { rec.current?.stop(); } catch { /* */ } }, []);
  const start = useCallback(() => {
    if (!Recognition) { setError('Este navegador não reconhece fala. Use o Chrome, o Edge ou o celular Android/iPhone.'); return; }
    setError(''); setInterim('');
    const r = new Recognition();
    r.lang = 'pt-BR'; r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
    r.onresult = (e) => {
      let fin = ''; let tmp = '';
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        if (e.results[i].isFinal) fin += e.results[i][0].transcript; else tmp += e.results[i][0].transcript;
      }
      setInterim(tmp || fin);
      if (fin) cb.current?.(fin.trim());
    };
    r.onerror = (e) => {
      const m = { 'not-allowed': 'Permita o uso do microfone para este site (ícone ao lado do endereço).', 'no-speech': 'Não ouvi nada. Toque e fale de novo.',
        network: 'Sem conexão com o serviço de reconhecimento de fala.', 'audio-capture': 'Nenhum microfone encontrado.' }[e.error];
      if (e.error !== 'aborted') setError(m || 'Não foi possível ouvir agora.');
    };
    r.onend = () => setListening(false);
    rec.current = r;
    setListening(true);
    try { r.start(); } catch { setListening(false); }
  }, []);
  useEffect(() => () => stop(), [stop]);
  return { listening, interim, error, start, stop, supported: !!Recognition };
}

/** Botão do cabeçalho: comandos de OS em qualquer tela. */
export default function VoiceCommand({ light }) {
  const nav = useNavigate();
  const { company, can, user } = useAuth();
  const { toast } = useUI();
  const [cmd, setCmd] = useState(null);
  const [heard, setHeard] = useState('');
  const [busy, setBusy] = useState(false);
  const [help, setHelp] = useState(false);
  const sp = useSpeech((text) => { setHeard(text); setCmd(parseCommand(text)); });
  if (company?.settings?.orders?.voiceCommands === false) return null;

  const findOrder = async (n) => api.get(`/orders/by-number/${n}`);
  const close = () => { setCmd(null); setHeard(''); };

  const execute = async () => {
    setBusy(true);
    try {
      const c = cmd;
      if (c.intent === 'abrir_os') {
        nav(`/os/nova?voz=${encodeURIComponent(JSON.stringify({ customer: c.customer, plate: c.plate, problem: c.problem, priority: c.priority }))}`);
      } else if (c.intent === 'abrir_existente') {
        const o = await findOrder(c.order_number); nav(`/os/${o.id}`);
      } else if (c.intent === 'iniciar_apontamento') {
        if (!c.order_number) throw new Error('Diga o número da OS (ex.: "iniciar apontamento na OS 120").');
        const o = await findOrder(c.order_number);
        await api.post(`/production/orders/${o.id}/time/start`, { activity: c.activity_kind || 'execucao', notes: c.activity || null });
        toast(`Cronômetro iniciado na OS ${o.number}`);
        window.dispatchEvent(new CustomEvent('torven:order-changed', { detail: o.id }));
      } else if (c.intent === 'parar_apontamento') {
        const open = await api.get('/production/time/open');
        const target = c.order_number ? open.filter((l) => l.order_number === c.order_number) : open;
        if (!target.length) throw new Error(c.order_number ? `Nenhum apontamento seu em andamento na OS ${c.order_number}.` : 'Você não tem apontamento em andamento.');
        for (const l of target) await api.post(`/production/time/${l.id}/stop`, {});
        toast(`Apontamento encerrado${target.length === 1 ? ` (OS ${target[0].order_number})` : 's'}`);
        target.forEach((l) => window.dispatchEvent(new CustomEvent('torven:order-changed', { detail: l.order_id })));
      } else if (c.intent === 'apontar_horas') {
        if (!c.order_number) throw new Error('Diga o número da OS.');
        if (!(c.minutes > 0)) throw new Error('Diga quanto tempo apontar.');
        const o = await findOrder(c.order_number);
        const end = new Date(); const start = new Date(end.getTime() - c.minutes * 60000);
        await api.post(`/production/orders/${o.id}/time`, { activity: c.activity_kind || 'execucao', started_at: start.toISOString(), ended_at: end.toISOString(),
          notes: `Lançado por voz${c.activity ? `: ${c.activity}` : ''}` });
        toast(`${c.minutes} min apontados na OS ${o.number}`);
        window.dispatchEvent(new CustomEvent('torven:order-changed', { detail: o.id }));
      } else if (c.intent === 'anotar') {
        const o = await findOrder(c.order_number);
        await api.post(`/orders/${o.id}/events`, { message: c.note, public: false });
        toast(`Anotado na OS ${o.number}`);
        window.dispatchEvent(new CustomEvent('torven:order-changed', { detail: o.id }));
      } else if (c.intent === 'status') {
        const o = await findOrder(c.order_number);
        await api.post(`/orders/${o.id}/status`, { status: c.status, message: 'Alterado por comando de voz' });
        toast(`OS ${o.number} atualizada`);
        window.dispatchEvent(new CustomEvent('torven:order-changed', { detail: o.id }));
      }
      close();
    } catch (e) {
      toast(e.message, 'error');
    } finally { setBusy(false); }
  };

  const allowed = (i) => ({
    abrir_os: can('orders_create'), abrir_existente: can('orders_view') || can('orders_create'), iniciar_apontamento: can('time_log'),
    parar_apontamento: can('time_log'), apontar_horas: can('time_log'), anotar: can('orders_view') || can('orders_create'), status: can('orders_edit'),
  }[i]);
  const set = (k) => (e) => setCmd((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));

  return (
    <>
      <button type="button" onClick={() => (sp.listening ? sp.stop() : sp.start())} aria-label={sp.listening ? 'Parar de ouvir' : 'Comando de voz'}
        title="Comando de voz (abrir e apontar OS)"
        className={cx('flex h-9 items-center gap-1.5 rounded-app-sm border px-2.5 text-sm transition',
          sp.listening ? 'animate-pulse border-red-500 bg-red-500/10 text-red-600'
            : light ? 'border-primary-fg/25 text-primary-fg/85 hover:bg-primary-fg/10' : 'border-line text-ink-faint hover:text-ink')}>
        {sp.supported ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
        <span className="hidden xl:inline">{sp.listening ? 'Ouvindo…' : 'Voz'}</span>
      </button>
      {(sp.listening || sp.error) && !cmd && (
        <div role="status" className="fixed inset-x-3 top-16 z-50 mx-auto max-w-md rounded-app border border-line bg-surface p-3 text-sm shadow-lg">
          {sp.error ? <span className="text-red-600">{sp.error}</span> : <><b>Ouvindo…</b> <span className="text-ink-soft">{sp.interim || 'diga o comando'}</span></>}
          <button className="ml-2 text-xs text-primary hover:underline" onClick={() => setHelp(true)}>exemplos</button>
        </div>
      )}
      <Modal open={!!cmd} onClose={close} title="Confirmar comando de voz" subtitle={heard ? `Ouvi: “${heard}”` : undefined}
        footer={<>
          <button className="btn-ghost" onClick={() => { close(); sp.start(); }}><Mic className="h-4 w-4" /> Falar de novo</button>
          {cmd?.intent !== 'desconhecido' && (
            <button className="btn-primary" disabled={busy || !allowed(cmd?.intent)} onClick={execute}><Check className="h-4 w-4" /> Confirmar</button>
          )}
        </>}>
        {cmd && (
          <div className="space-y-3">
            <p className="rounded-app-sm bg-muted/60 px-3 py-2 text-sm font-medium">{cmd.summary}</p>
            {cmd.intent !== 'desconhecido' && !allowed(cmd.intent) && <p className="text-sm text-red-600">Seu perfil não permite esta ação.</p>}
            {cmd.intent === 'abrir_os' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Input label="Cliente" value={cmd.customer || ''} onChange={set('customer')} />
                <Input label="Placa" value={cmd.plate || ''} onChange={(e) => set('plate')(e.target.value.toUpperCase())} />
                <Textarea className="sm:col-span-2" label="Problema / serviço" rows={2} value={cmd.problem || ''} onChange={set('problem')} />
                <Select label="Prioridade" value={cmd.priority || 'normal'} onChange={set('priority')}>
                  <option value="baixa">Baixa</option><option value="normal">Normal</option><option value="alta">Alta</option><option value="urgente">Urgente</option>
                </Select>
              </div>
            )}
            {['iniciar_apontamento', 'apontar_horas', 'anotar', 'status', 'abrir_existente', 'parar_apontamento'].includes(cmd.intent) && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Input label="Nº da OS" type="number" min={1} value={cmd.order_number || ''} onChange={(e) => set('order_number')(Number(e.target.value) || undefined)} />
                {cmd.intent === 'apontar_horas' && <Input label="Minutos" type="number" min={1} max={960} value={cmd.minutes || ''} onChange={(e) => set('minutes')(Number(e.target.value) || 0)} />}
                {['iniciar_apontamento', 'apontar_horas'].includes(cmd.intent) && (
                  <Select label="Atividade" value={cmd.activity_kind || 'execucao'} onChange={set('activity_kind')}>
                    <option value="execucao">Execução</option><option value="diagnostico">Diagnóstico</option><option value="retrabalho">Retrabalho</option>
                    <option value="inspecao">Inspeção</option><option value="deslocamento">Deslocamento</option><option value="outro">Outro</option>
                  </Select>
                )}
                {['iniciar_apontamento', 'apontar_horas'].includes(cmd.intent) && <Input label="Observação" value={cmd.activity || ''} onChange={set('activity')} />}
                {cmd.intent === 'status' && (
                  <Select label="Nova etapa" value={cmd.status} onChange={set('status')}>{STATUS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
                )}
                {cmd.intent === 'anotar' && <Textarea className="sm:col-span-2" label="Anotação (interna)" rows={2} value={cmd.note || ''} onChange={set('note')} />}
              </div>
            )}
            {cmd.intent === 'desconhecido' && <VoiceHelp />}
            {user && cmd.intent === 'parar_apontamento' && !cmd.order_number && <p className="text-xs text-ink-faint">Encerra todos os seus apontamentos em andamento.</p>}
          </div>
        )}
      </Modal>
      <Modal open={help} onClose={() => setHelp(false)} title="Comandos de voz" size="sm"><VoiceHelp /></Modal>
    </>
  );
}

export function VoiceHelp() {
  return (
    <div className="space-y-2 text-sm">
      <p className="flex items-center gap-1.5 text-ink-soft"><HelpCircle className="h-4 w-4" /> Toque no microfone e fale, por exemplo:</p>
      <ul className="list-disc space-y-1 pl-5 text-ink-soft">{VOICE_EXAMPLES.map((e) => <li key={e}>“{e}”</li>)}</ul>
      <p className="text-xs text-ink-faint">O TORVEN mostra o que entendeu e só grava depois que você confirma. O reconhecimento de fala é feito pelo navegador.</p>
    </div>
  );
}
