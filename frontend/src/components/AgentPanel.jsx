// Assistente: conversa por texto ou voz. Consultas respondem na hora; para gravar (incluir conta, dar baixa, lembrete)
// ele mostra um resumo com os campos para conferir e só grava depois do "Confirmar". Cada usuário tem a sua liberação.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Bot, Send, Mic, X, Check, Ban, ExternalLink, Sparkles } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useSpeech } from './VoiceCommand';
import { Input, MoneyInput, cx } from './ui';

const FIELD = { description: 'Descrição', amount: 'Valor', due_date: 'Vencimento', title: 'Lembrete' };

function ConfirmCard({ msg, onDone }) {
  const [p, setP] = useState(msg.params);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const go = async () => {
    setBusy(true); setErr('');
    try { onDone(await api.post('/agent/confirm', { intent: msg.intent, params: p, text: msg.ask })); } catch (e) { setErr(e.message); }
    setBusy(false);
  };
  const cancel = async () => { api.post('/agent/cancel', { intent: msg.intent, text: msg.ask }).catch(() => {}); onDone({ kind: 'cancelled', text: 'Tudo bem, não gravei nada.' }); };
  return (
    <div className="space-y-2 rounded-app-sm border border-primary/40 bg-primary/5 p-3 text-sm" aria-label="Confirmar pedido ao assistente">
      <p className="font-medium">{msg.summary}</p>
      {msg.fields?.length > 0 && (
        <div className="grid gap-2">
          {msg.fields.map((k) => (k === 'amount'
            ? <MoneyInput key={k} label={FIELD[k]} value={p.amount || 0} onChange={(v) => setP({ ...p, amount: v })} />
            : <Input key={k} label={FIELD[k]} type={k === 'due_date' ? 'date' : 'text'} value={p[k] || ''} onChange={(e) => setP({ ...p, [k]: e.target.value })} />))}
        </div>
      )}
      {err && <p className="text-red-600">{err}</p>}
      <div className="flex gap-2">
        <button className="btn-primary h-8 flex-1 text-xs" disabled={busy} onClick={go}><Check className="h-3.5 w-3.5" /> Confirmar</button>
        <button className="btn-ghost h-8 text-xs" disabled={busy} onClick={cancel}><Ban className="h-3.5 w-3.5" /> Cancelar</button>
      </div>
    </div>
  );
}

function Bubble({ m, onConfirmed, onExample, close }) {
  if (m.from === 'me') return <div className="ml-8 self-end rounded-app-sm bg-primary px-3 py-2 text-sm text-primary-fg">{m.text}</div>;
  return (
    <div className="mr-6 space-y-2 self-start">
      {m.kind === 'confirm' && !m.resolved ? <ConfirmCard msg={m} onDone={(r) => onConfirmed(m, r)} /> : (
        <div className={cx('rounded-app-sm px-3 py-2 text-sm', m.kind === 'denied' || m.kind === 'error' ? 'bg-red-500/10 text-red-700 dark:text-red-300' : m.kind === 'done' ? 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-200' : 'bg-muted')}>
          {m.kind === 'confirm' && m.resolved ? <span className="text-ink-faint">{m.summary}</span> : m.text}
          {m.items?.length > 0 && (
            <ul className="mt-2 space-y-1">
              {m.items.map((x) => (
                <li key={x.id} className="flex items-start justify-between gap-2 border-t border-line/60 pt-1">
                  <span className="min-w-0"><span className="block truncate font-medium">{x.title}</span><span className="text-xs text-ink-faint">{x.detail}</span></span>
                  <span className={cx('shrink-0 tabular-nums', x.tone === 'saida' ? 'text-red-600' : x.tone === 'entrada' ? 'text-emerald-600' : '')}>{x.value}</span>
                </li>
              ))}
            </ul>
          )}
          {m.examples?.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {m.examples.map((e) => <button key={e} className="chip border border-line bg-surface text-left hover:border-primary" onClick={() => onExample(e)}>{e}</button>)}
            </div>
          )}
          {m.link && <Link to={m.link} onClick={close} className="mt-2 flex items-center gap-1 text-xs text-primary hover:underline"><ExternalLink className="h-3 w-3" /> Abrir na tela</Link>}
        </div>
      )}
      {m.kind === 'choose' && !m.resolved && (
        <div className="space-y-2">{m.options.map((o) => <ConfirmCard key={o.params.transaction_id} msg={{ ...o, ask: m.ask }} onDone={(r) => onConfirmed(m, r)} />)}</div>
      )}
    </div>
  );
}

export default function AgentPanel({ light }) {
  const { agent, user } = useAuth();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [examples, setExamples] = useState([]);
  const end = useRef(null);
  const sp = useSpeech((t) => { setText(t); send(t); });
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs, busy]);
  useEffect(() => {
    if (!open || examples.length) return;
    api.get('/agent/profile').then((p) => setExamples(p.examples || [])).catch(() => {});
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return undefined;
    const k = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open]);
  if (!agent?.length) return null;

  async function send(raw) {
    const t = String(raw ?? text).trim();
    if (!t || busy) return;
    setText('');
    setMsgs((l) => [...l, { id: Date.now(), from: 'me', text: t }]);
    setBusy(true);
    try {
      const r = await api.post('/agent/ask', { text: t });
      setMsgs((l) => [...l, { id: Date.now() + 1, from: 'bot', ask: t, ...r }]);
    } catch (e) {
      setMsgs((l) => [...l, { id: Date.now() + 1, from: 'bot', kind: 'error', text: e.message }]);
    }
    setBusy(false);
  }
  const confirmed = (m, r) => setMsgs((l) => [...l.map((x) => (x.id === m.id ? { ...x, resolved: true } : x)), { id: Date.now(), from: 'bot', ...r }]);
  const close = () => setOpen(false);

  return (
    <>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-label="Assistente" title="Assistente: pergunte ou peça por texto ou voz"
        className={cx('flex h-9 items-center gap-1.5 rounded-app-sm border px-2.5 text-sm transition',
          light ? 'border-primary-fg/25 text-primary-fg/85 hover:bg-primary-fg/10' : 'border-line text-ink-faint hover:text-ink')}>
        <Bot className="h-4 w-4" /><span className="hidden xl:inline">Assistente</span>
      </button>
      {open && createPortal(
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30 animate-fade" onClick={close}>
          <aside role="dialog" aria-label="Assistente" className="flex h-full w-full max-w-md flex-col border-l border-line bg-surface text-ink shadow-xl" onClick={(e) => e.stopPropagation()}>
            <header className="flex items-center gap-2 border-b border-line px-4 py-3">
              <Sparkles className="h-5 w-5 text-primary" />
              <div className="min-w-0 flex-1"><h2 className="font-semibold">Assistente</h2><p className="text-xs text-ink-faint">Pergunte ou peça. Nada é gravado sem a sua confirmação.</p></div>
              <button className="btn-ghost btn-icon" onClick={close} aria-label="Fechar assistente"><X className="h-5 w-5" /></button>
            </header>
            <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
              {!msgs.length && (
                <div className="space-y-2 text-sm">
                  <p>Olá, {user?.name?.split(' ')[0]}! Escreva ou toque no microfone e fale. Por exemplo:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {examples.map((e) => <button key={e} className="chip border border-line text-left hover:border-primary" onClick={() => send(e)}>{e}</button>)}
                  </div>
                </div>
              )}
              {msgs.map((m) => <Bubble key={m.id} m={m} onConfirmed={confirmed} onExample={(e) => send(e)} close={close} />)}
              {busy && <div className="self-start rounded-app-sm bg-muted px-3 py-2 text-sm text-ink-faint">pensando…</div>}
              <div ref={end} />
            </div>
            {(sp.listening || sp.error) && <p className={cx('px-4 text-xs', sp.error ? 'text-red-600' : 'text-ink-soft')}>{sp.error || `Ouvindo… ${sp.interim}`}</p>}
            <form className="flex gap-2 border-t border-line p-3" onSubmit={(e) => { e.preventDefault(); send(); }}>
              <input className="input flex-1" placeholder="Ex.: contas a pagar desta semana" aria-label="Mensagem para o assistente" value={text} onChange={(e) => setText(e.target.value)} maxLength={500} autoFocus />
              {sp.supported && (
                <button type="button" className={cx('btn-outline btn-icon', sp.listening && 'animate-pulse border-red-500 text-red-600')} aria-label={sp.listening ? 'Parar de ouvir' : 'Falar com o assistente'}
                  onClick={() => (sp.listening ? sp.stop() : sp.start())}><Mic className="h-4 w-4" /></button>
              )}
              <button className="btn-primary btn-icon" disabled={busy || !text.trim()} aria-label="Enviar"><Send className="h-4 w-4" /></button>
            </form>
          </aside>
        </div>,
        document.body,
      )}
    </>
  );
}

