// Campo de texto com ditado por voz (computador e celular). O microfone fica dentro do campo; a fala entra no fim do texto
// com pontuação falada ("vírgula", "ponto final", "nova linha"). Usa o reconhecimento de fala do navegador
// (Chrome, Edge, Safari, Android) — nada é salvo sem o usuário salvar o formulário.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, Square } from 'lucide-react';
import { Field, cx } from './ui';
import { useSettings } from '../context/AuthContext';
import { appendDictation } from '../lib/dictation';

const Recognition = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
// no Android o modo contínuo repete trechos: lá a escuta é por frase e reinicia sozinha enquanto o ditado estiver ligado
const CONTINUOUS = typeof navigator !== 'undefined' && !/Android/i.test(navigator.userAgent);
let activeStop = null; // só um campo ouve por vez

const ERRORS = {
  'not-allowed': 'Permita o microfone para este site (cadeado ao lado do endereço) e toque de novo.',
  'service-not-allowed': 'O navegador bloqueou o reconhecimento de fala. Confira a permissão do microfone.',
  'audio-capture': 'Nenhum microfone encontrado neste aparelho.',
  network: 'Sem conexão com o serviço de reconhecimento de fala.',
};

/** Ditado: start/stop, texto parcial enquanto fala e onFinal(texto) a cada trecho reconhecido. */
export function useDictation(onFinal) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState('');
  const rec = useRef(null);
  const on = useRef(false);
  const silent = useRef(0);
  const cb = useRef(onFinal);
  cb.current = onFinal;

  const stop = useCallback(() => {
    on.current = false; setListening(false); setInterim('');
    try { rec.current?.stop(); } catch { /* já parado */ }
    if (activeStop === stop) activeStop = null;
  }, []);

  const listen = useCallback(() => {
    const r = new Recognition();
    r.lang = 'pt-BR'; r.interimResults = true; r.continuous = CONTINUOUS; r.maxAlternatives = 1;
    let heard = false;
    r.onresult = (e) => {
      let tmp = '';
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) { heard = true; silent.current = 0; cb.current?.(t); } else tmp += t;
      }
      setInterim(tmp);
    };
    r.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      setError(ERRORS[e.error] || 'Não foi possível ouvir agora.'); on.current = false;
    };
    r.onend = () => {
      setInterim('');
      if (!heard) silent.current += 1;
      // continua ouvindo até o usuário parar (ou ~3 rodadas sem fala)
      if (on.current && silent.current < 3) { try { listen(); return; } catch { /* cai para parado */ } }
      on.current = false; setListening(false);
      if (activeStop === stop) activeStop = null;
    };
    rec.current = r;
    r.start();
  }, [stop]);

  const start = useCallback(() => {
    setError('');
    if (!Recognition) {
      setError('Este navegador não faz ditado. Use Chrome, Edge ou Safari — no celular também dá para usar o microfone do teclado.');
      return;
    }
    if (activeStop && activeStop !== stop) activeStop();
    activeStop = stop;
    on.current = true; silent.current = 0; setListening(true);
    try { listen(); } catch { stop(); setError('Não foi possível ligar o microfone.'); }
  }, [listen, stop]);

  useEffect(() => () => { on.current = false; try { rec.current?.abort(); } catch { /* */ } }, []);
  return { listening, interim, error, start, stop, supported: !!Recognition };
}

/**
 * Textarea com microfone. Mesmo uso do Textarea: onChange recebe { target: { value } }.
 * Some sozinho se o ditado estiver desligado em Configurações ou o campo estiver desabilitado.
 */
export default function VoiceTextarea({ label, hint, className, rows = 3, value, onChange, disabled, ...p }) {
  const settings = useSettings();
  const enabled = settings?.orders?.voiceDictation !== false && !disabled;
  const latest = useRef(value);
  latest.current = value;
  const d = useDictation((spoken) => {
    const next = appendDictation(latest.current, spoken);
    latest.current = next;
    onChange?.({ target: { value: next } });
  });
  useEffect(() => { if (disabled && d.listening) d.stop(); }, [disabled]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Field label={label} hint={hint} className={className}>
      <span className="relative block">
        <textarea className={cx('input', enabled && 'pr-11', d.listening && 'border-red-500 ring-2 ring-red-500/20')} rows={rows}
          value={value ?? ''} onChange={onChange} disabled={disabled}
          aria-label={typeof label === 'string' ? label : undefined} {...p} />
        {enabled && (
          <button type="button" onClick={(e) => { e.preventDefault(); d.listening ? d.stop() : d.start(); }}
            aria-label={d.listening ? `Parar ditado — ${label || 'campo'}` : `Ditar por voz — ${label || 'campo'}`} aria-pressed={d.listening}
            title={d.listening ? 'Parar ditado' : 'Ditar por voz (diga "vírgula", "ponto final", "nova linha")'}
            className={cx('absolute right-1.5 top-1.5 grid h-8 w-8 place-items-center rounded-full transition',
              d.listening ? 'animate-pulse bg-red-600 text-white' : 'text-ink-soft hover:bg-primary/10 hover:text-primary')}>
            {d.listening ? <Square className="h-3.5 w-3.5 fill-current" /> : <Mic className="h-4 w-4" />}
          </button>
        )}
      </span>
      {d.listening && (
        <span className="mt-1 flex items-center gap-1.5 text-xs text-red-600" role="status">
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-red-600" />
          <b>Ouvindo…</b> <span className="truncate text-ink-soft">{d.interim || 'fale; toque no quadrado para parar'}</span>
        </span>
      )}
      {d.error && <span className="mt-1 block text-xs text-red-600" role="alert">{d.error}</span>}
    </Field>
  );
}
