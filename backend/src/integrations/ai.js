// IA opcional para o agente do WhatsApp: só ENTENDE a mensagem (intenção, placa, data, hora, problema).
// As respostas ao cliente são sempre montadas pelo sistema com dados reais — a IA nunca inventa status nem valores.
// Vai para a IA apenas o texto que o cliente escreveu (pode conter o nome que ele digitou) e a data de hoje — nunca telefone nem dados da OS.
export const AI_MODELS = [
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5 (rápido e econômico)' },
  { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' },
];
export const AI_URL = process.env.ANTHROPIC_URL || 'https://api.anthropic.com/v1/messages';

export const INTENTS = ['status', 'agendar', 'abrir_os', 'atendente', 'saudacao', 'cancelar', 'outro'];

const SYSTEM = `Você classifica mensagens de clientes de uma oficina (veículos, solda, serralheria) enviadas pelo WhatsApp.
Responda SOMENTE um JSON, sem texto fora dele, com as chaves:
intent: "status" (quer saber como está o serviço/OS/carro), "agendar" (quer marcar horário/trazer o veículo), "abrir_os" (quer pedir um serviço/orçamento sem falar de horário), "atendente" (quer falar com uma pessoa), "saudacao" (só cumprimento), "cancelar" (desistir do que estava fazendo), "outro";
plate: placa do veículo em maiúsculas sem traço ou null;
date: data pedida no formato AAAA-MM-DD (use a data de hoje informada para resolver "amanhã", "sexta" etc.) ou null;
time: horário pedido HH:MM ou null;
problem: o problema ou serviço descrito, curto, ou null;
name: nome que a pessoa disse ser o dela ou null.`;

/** Classifica a mensagem. Em qualquer falha devolve null (o agente segue pelo menu). */
export async function understand(cfg, secrets, text, today) {
  if (!secrets?.api_key) return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(AI_URL, {
      method: 'POST',
      headers: { 'x-api-key': secrets.api_key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: cfg?.model || AI_MODELS[0].id, max_tokens: 200, system: SYSTEM,
        messages: [{ role: 'user', content: `Hoje é ${today}. Mensagem do cliente: """${String(text).slice(0, 1000)}"""` }],
      }),
      signal: ctl.signal,
    });
    if (!r.ok) return null;
    const j = await r.json();
    const raw = (j.content || []).map((c) => c.text || '').join('');
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const x = JSON.parse(m[0]);
    return {
      intent: INTENTS.includes(x.intent) ? x.intent : 'outro',
      plate: typeof x.plate === 'string' ? x.plate : null,
      date: /^\d{4}-\d{2}-\d{2}$/.test(x.date || '') ? x.date : null,
      time: /^\d{1,2}:\d{2}$/.test(x.time || '') ? x.time.padStart(5, '0') : null,
      problem: typeof x.problem === 'string' ? x.problem.slice(0, 300) : null,
      name: typeof x.name === 'string' ? x.name.slice(0, 80) : null,
    };
  } catch {
    return null;
  } finally { clearTimeout(timer); }
}
