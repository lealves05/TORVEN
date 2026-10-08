// Configurações › Integrações › WhatsApp: API oficial da Meta, agente de atendimento, IA opcional e teste do agente.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageCircle, Save, Copy, Bot, Sparkles, Send, Trash2, ExternalLink, KeyRound } from 'lucide-react';
import { api } from '../lib/api';
import { useUI } from '../context/UIContext';
import { Input, Select, Textarea, Toggle, Loading, useAction, FAIL, cx } from './ui';

const DAYS = [['1', 'Seg'], ['2', 'Ter'], ['3', 'Qua'], ['4', 'Qui'], ['5', 'Sex'], ['6', 'Sáb'], ['0', 'Dom']];

function Secret({ label, saved, value, onChange }) {
  const removing = value === null;
  return (
    <div className="relative">
      <Input label={<span className="inline-flex items-center gap-1"><KeyRound className="h-3 w-3" /> {label}</span>} type="password" autoComplete="new-password"
        placeholder={removing ? 'será removido ao salvar' : saved?.set ? `configurado (${saved.hint}) — deixe vazio para manter` : 'cole aqui'}
        value={removing ? '' : value || ''} disabled={removing} onChange={(e) => onChange(e.target.value)} />
      {saved?.set && <button type="button" className="absolute right-0 top-0 text-xs text-ink-faint hover:text-red-600" onClick={() => onChange(removing ? undefined : null)}>{removing ? 'desfazer' : 'remover'}</button>}
    </div>
  );
}

function CopyField({ label, value }) {
  const { toast } = useUI();
  return (
    <div className="min-w-0">
      <span className="label">{label}</span>
      <div className="flex gap-1.5">
        <input className="input min-w-0 flex-1 font-mono text-xs" readOnly value={value} aria-label={label} onFocus={(e) => e.target.select()} />
        <button type="button" className="btn-outline h-10 px-3" aria-label={`Copiar ${label}`}
          onClick={() => navigator.clipboard?.writeText(value).then(() => toast('Copiado'), () => toast('Selecione e copie com Ctrl+C', 'error'))}><Copy className="h-4 w-4" /></button>
      </div>
    </div>
  );
}

const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v === null || (typeof v === 'string' && v.trim())));

export default function WhatsAppSetup() {
  const { toast } = useUI();
  const [run, busy] = useAction();
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [ai, setAi] = useState(null);
  const load = () => api.get('/whatsapp/config').then((d) => {
    setData(d);
    const c = d.whatsapp?.config || {};
    setForm({ enabled: !!d.whatsapp?.enabled, config: { ...d.defaults, site_url: window.location.origin, ...c }, secrets: {} });
    setAi({ enabled: !!d.ai?.enabled, config: { model: d.ai?.config?.model || d.models[0].id }, secrets: {} });
  }).catch((e) => toast(e.message, 'error'));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!data || !form) return <div className="card p-6 lg:col-span-2"><Loading /></div>;

  const cfg = form.config;
  const setC = (patch) => setForm({ ...form, config: { ...cfg, ...patch } });
  const days = String(cfg.work_days || '').split(',').filter(Boolean);
  const toggleDay = (d) => setC({ work_days: (days.includes(d) ? days.filter((x) => x !== d) : [...days, d]).sort().join(',') });
  const save = async () => {
    const config = { ...cfg };
    delete config.verify_token;
    const body = { enabled: form.enabled, config: { ...config, slot_minutes: Number(config.slot_minutes) || 60 }, secrets: clean(form.secrets) };
    const r = await run(() => api.put('/whatsapp/config', body), 'WhatsApp salvo');
    if (r !== FAIL) load();
  };
  const saveAi = async () => {
    const r = await run(() => api.put('/whatsapp/ai', { ...ai, secrets: clean(ai.secrets) }), 'IA salva');
    if (r !== FAIL) load();
  };
  const webhook = `${window.location.origin}/api/webhooks/whatsapp`;
  const verify = data.whatsapp?.config?.verify_token;

  return (
    <>
      <div className="card space-y-4 p-6 lg:col-span-2" id="whatsapp-config">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 font-semibold"><MessageCircle className="h-4 w-4 text-emerald-600" /> WhatsApp e agente de atendimento</h3>
            <p className="text-xs text-ink-faint">O agente responde o cliente, informa como está a OS pela placa e registra pedidos de serviço e de horário. A equipe aprova cada pedido em <Link className="text-primary" to="/whatsapp">Atendimento › WhatsApp</Link>.</p>
          </div>
          <span className={cx('chip', data.whatsapp?.enabled ? 'bg-emerald-500/10 text-emerald-700' : 'bg-muted text-ink-soft')}>{data.whatsapp?.enabled ? 'Ligado' : 'Desligado'}</span>
        </div>

        <details className="rounded-app-sm bg-muted/60 p-3 text-sm" open={!data.whatsapp}>
          <summary className="cursor-pointer font-medium">Como ligar o WhatsApp oficial (feito uma vez só)</summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-ink-soft">
            <li>Acesse <a className="inline-flex items-center gap-1 text-primary" href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer noopener">developers.facebook.com <ExternalLink className="h-3 w-3" /></a>, crie um app do tipo <b>Empresa</b> e adicione o produto <b>WhatsApp</b>.</li>
            <li>Em <b>WhatsApp › Configuração da API</b>, cadastre o número da empresa e copie o <b>Phone number ID</b> e o <b>WABA ID</b> para os campos abaixo.</li>
            <li>No <b>Gerenciador de Negócios</b>, crie um <b>usuário do sistema</b>, dê acesso ao app com a permissão <i>whatsapp_business_messaging</i> e gere um <b>token permanente</b>.</li>
            <li>Em <b>Configurações do app › Básico</b>, copie a <b>Chave secreta do app</b>.</li>
            <li>Salve aqui. Depois, em <b>WhatsApp › Configuração › Webhook</b>, cole o <b>endereço</b> e o <b>token de verificação</b> que aparecem abaixo e assine o campo <b>messages</b>.</li>
          </ol>
        </details>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {data.fields.map((f) => (
            <Input key={f.key} label={`${f.label}${f.required ? ' *' : ''}`} value={cfg[f.key] || ''} inputMode={f.key.endsWith('_id') ? 'numeric' : undefined}
              onChange={(e) => setC({ [f.key]: e.target.value })} />
          ))}
          {data.secrets.map((f) => (
            <Secret key={f.key} label={f.label} saved={data.whatsapp?.secrets?.[f.key]} value={form.secrets[f.key]}
              onChange={(v) => { const s = { ...form.secrets }; if (v === undefined) delete s[f.key]; else s[f.key] = v; setForm({ ...form, secrets: s }); }} />
          ))}
        </div>

        <div className="grid grid-cols-1 gap-3 rounded-app-sm border border-line p-3 sm:grid-cols-2">
          <CopyField label="Endereço do webhook (cole na Meta)" value={webhook} />
          {verify ? <CopyField label="Token de verificação (cole na Meta)" value={verify} /> : <p className="self-end text-xs text-ink-faint">O token de verificação aparece aqui depois de salvar.</p>}
        </div>

        <div className="space-y-3 rounded-app-sm border border-line p-3">
          <h4 className="flex items-center gap-2 text-sm font-semibold"><Bot className="h-4 w-4 text-primary" /> Agente automático</h4>
          <Toggle checked={cfg.agent_enabled !== false} onChange={(v) => setC({ agent_enabled: v })} label="O agente responde sozinho"
            hint="Desligado, as mensagens só chegam na tela de atendimento para a equipe responder." />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Input label="Abre às" type="time" value={cfg.hours_start} onChange={(e) => setC({ hours_start: e.target.value })} />
            <Input label="Fecha às" type="time" value={cfg.hours_end} onChange={(e) => setC({ hours_end: e.target.value })} />
            <Select label="Duração de cada horário" value={String(cfg.slot_minutes)} onChange={(e) => setC({ slot_minutes: Number(e.target.value) })}>
              {[30, 60, 90, 120, 180, 240].map((m) => <option key={m} value={m}>{m < 60 ? `${m} min` : `${m / 60} h`}</option>)}
            </Select>
          </div>
          <div>
            <span className="label">Dias de atendimento</span>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Dias de atendimento">
              {DAYS.map(([d, l]) => (
                <button key={d} type="button" aria-pressed={days.includes(d)} onClick={() => toggleDay(d)}
                  className={cx('h-9 w-12 rounded-app-sm border text-sm', days.includes(d) ? 'border-primary bg-primary/10 font-medium text-primary' : 'border-line text-ink-soft')}>{l}</button>
              ))}
            </div>
          </div>
          <Textarea label="Mensagem de boas-vindas (opcional)" rows={2} value={cfg.greeting || ''} maxLength={500}
            placeholder="Ex.: Olá! Bem-vindo à Soldas Silva. Sou o assistente virtual." onChange={(e) => setC({ greeting: e.target.value })} />
          <Input label="Endereço do sistema (para o link de acompanhamento da OS)" value={cfg.site_url || ''} onChange={(e) => setC({ site_url: e.target.value })} />
          <Toggle checked={!!cfg.ai_enabled} onChange={(v) => setC({ ai_enabled: v })} label="Usar IA para entender frases livres"
            hint="Com a IA, o cliente pode escrever do jeito dele (ex.: “quero levar o carro sexta de manhã”). Sem IA, o agente usa o menu com números." />
        </div>

        <Toggle checked={form.enabled} onChange={(v) => setForm({ ...form, enabled: v })} label="Ligar o WhatsApp"
          hint="Ligado, o sistema recebe e responde as mensagens do número configurado." />
        <div className="border-t border-line pt-4"><button className="btn-primary" disabled={busy} onClick={save}><Save className="h-4 w-4" /> Salvar WhatsApp</button></div>
      </div>

      <div className="card space-y-4 p-6">
        <div>
          <h3 className="flex items-center gap-2 font-semibold"><Sparkles className="h-4 w-4 text-primary" /> IA do agente (opcional)</h3>
          <p className="text-xs text-ink-faint">Serviço pago da Anthropic (Claude), cobrado por uso. A IA só lê o texto que o cliente escreveu, para entender o pedido; ela não recebe telefone, cadastro nem dados das OS, e as respostas são sempre montadas pelo sistema.</p>
        </div>
        <Select label="Modelo" value={ai.config.model} onChange={(e) => setAi({ ...ai, config: { model: e.target.value } })}>
          {data.models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </Select>
        <Secret label="Chave da API (começa com sk-ant-)" saved={data.ai?.secrets?.api_key} value={ai.secrets.api_key}
          onChange={(v) => { const s = { ...ai.secrets }; if (v === undefined) delete s.api_key; else s.api_key = v; setAi({ ...ai, secrets: s }); }} />
        <Toggle checked={ai.enabled} onChange={(v) => setAi({ ...ai, enabled: v })} label="Ligar a IA" />
        <div className="border-t border-line pt-4"><button className="btn-primary" disabled={busy} onClick={saveAi}><Save className="h-4 w-4" /> Salvar IA</button></div>
      </div>

      <AgentTester />
    </>
  );
}

/** Conversa de teste com o agente: nada é enviado pelo WhatsApp. */
function AgentTester() {
  const [run, busy] = useAction();
  const [phone, setPhone] = useState('11999990000');
  const [text, setText] = useState('');
  const [log, setLog] = useState([]);
  const [conv, setConv] = useState(null);
  const box = useRef(null);
  useEffect(() => { box.current?.scrollTo({ top: box.current.scrollHeight }); }, [log]);
  const send = async (t = text) => {
    if (!t.trim()) return;
    setLog((l) => [...l, { me: true, body: t }]);
    setText('');
    const r = await run(() => api.post('/whatsapp/simulate', { phone, text: t, name: 'Cliente de teste' }));
    if (r !== FAIL) { setConv(r.conversation_id); setLog((l) => [...l, ...r.replies.map((body) => ({ body })), ...(r.request_id ? [{ info: true, body: 'Pedido registrado: aparece em Atendimento › WhatsApp para aprovar.' }] : [])]); }
  };
  const reset = async () => {
    if (conv) await run(() => api.del(`/whatsapp/conversations/${conv}`));
    setConv(null); setLog([]);
  };
  return (
    <div className="card flex flex-col gap-3 p-6" id="testar-agente">
      <div>
        <h3 className="flex items-center gap-2 font-semibold"><Bot className="h-4 w-4 text-primary" /> Testar o agente</h3>
        <p className="text-xs text-ink-faint">Converse como se fosse um cliente. Nada é enviado pelo WhatsApp. Use o telefone de um cliente cadastrado para ver a consulta pela placa.</p>
      </div>
      <Input label="Telefone do cliente de teste" value={phone} inputMode="tel" onChange={(e) => setPhone(e.target.value)} />
      <div ref={box} className="h-72 space-y-2 overflow-y-auto rounded-app-sm bg-[#e9e3d8] p-3 text-sm dark:bg-zinc-800" aria-live="polite" aria-label="Conversa de teste">
        {!log.length && <p className="text-center text-xs text-ink-faint">Escreva “oi” para começar.</p>}
        {log.map((m, i) => (
          <div key={i} className={cx('max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 shadow-sm',
            m.info ? 'mx-auto bg-amber-100 text-xs text-amber-900' : m.me ? 'ml-auto bg-[#d9fdd3] text-zinc-900' : 'bg-white text-zinc-900')}>
            {m.body.replace(/\*(.+?)\*/g, '$1')}
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input className="input min-w-0 flex-1" placeholder="Digite a mensagem" aria-label="Mensagem de teste" value={text}
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } }} />
        <button className="btn-primary" disabled={busy || !text.trim()} onClick={() => send()} aria-label="Enviar"><Send className="h-4 w-4" /></button>
        <button className="btn-ghost" disabled={busy || !log.length} onClick={reset} title="Apagar a conversa de teste" aria-label="Apagar a conversa de teste"><Trash2 className="h-4 w-4" /></button>
      </div>
    </div>
  );
}
