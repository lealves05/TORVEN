// Suporte e treinamento: vídeo-aulas narradas, dúvidas frequentes e contato com a equipe da plataforma.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, Clock, LifeBuoy, PlayCircle, Search } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { PageHeader, cx } from '../components/ui';
import { LESSONS, MODULES, fmtDur, posterUrl, thumbUrl, videoUrl } from '../lib/training';

const FAQ = [
  ['Qual a diferença entre solicitação, orçamento e OS?', 'A solicitação é o pedido do cliente, antes de ver o serviço. O orçamento é a proposta com valores. A ordem de serviço é o trabalho aprovado, com etapas, materiais, horas e entrega.'],
  ['Como o cliente aprova um orçamento?', 'Ao salvar, o orçamento gera um link público. O cliente abre, confere e aprova; aprovado, vira OS com um clique.'],
  ['O material usado na OS sai do estoque?', 'Sim. Materiais adicionados à OS são baixados do estoque e o custo entra no resultado da ordem.'],
  ['Como registro as horas do técnico?', 'Na OS ou no Painel de produção, use Iniciar e Encerrar. Esqueceu? Use Lançar manual. As horas aparecem na Folha de horas e nas comissões.'],
  ['Recebi e o caixa estava fechado.', 'Abra o caixa em Financeiro › Caixa e lançamentos antes de receber. Recebimentos ficam ligados ao caixa do dia.'],
  ['Onde vejo quem alterou algo?', 'Em Configurações › Logs e auditoria, com usuário, data e o que mudou.'],
];
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const total = LESSONS.reduce((a, l) => a + l.s, 0);

function useWatched(userId) {
  const key = `torven.aulas.${userId || 'anon'}`;
  const [seen, setSeen] = useState(() => { try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch { return {}; } });
  const mark = (n) => setSeen((s) => {
    if (s[n]) return s;
    const next = { ...s, [n]: 1 };
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* sem armazenamento */ }
    return next;
  });
  return [seen, mark];
}

export default function Support() {
  const { user, access } = useAuth();
  const [params, setParams] = useSearchParams();
  const [term, setTerm] = useState('');
  const [seen, mark] = useWatched(user?.id);
  const player = useRef(null);
  const cur = LESSONS.find((l) => l.n === Number(params.get('aula'))) || LESSONS[0];
  const idx = LESSONS.indexOf(cur);
  const ch = access?.support_channel || {};
  const done = LESSONS.filter((l) => seen[l.n]).length;
  const open = (l, play = true) => {
    setParams((p) => { const q = new URLSearchParams(p); q.set('aula', String(l.n)); return q; }, { replace: true });
    if (play) setTimeout(() => { player.current?.play?.().catch(() => {}); player.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' }); }, 60);
  };
  useEffect(() => { player.current?.load?.(); }, [cur.n]);
  const groups = useMemo(() => {
    const t = norm(term.trim());
    const hit = (l) => !t || norm(`${l.title} ${l.desc} ${l.learn.join(' ')}`).includes(t);
    return MODULES.map((m) => ({ ...m, items: LESSONS.filter((l) => l.mod === m.key && hit(l)) })).filter((g) => g.items.length);
  }, [term]);
  const wa = String(ch.whatsapp || '').replace(/\D/g, '');

  return (
    <div className="space-y-6">
      <PageHeader title="Suporte e treinamento" subtitle={`${LESSONS.length} vídeo-aulas narradas, gravadas no próprio TORVEN (${Math.round(total / 60)} min no total).`} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section aria-label="Aula atual" className="min-w-0 space-y-3">
          <video ref={player} key={cur.n} controls playsInline preload="metadata" poster={posterUrl(cur)}
            className="aspect-[16/10] w-full rounded-xl bg-black shadow-lg" onEnded={() => { mark(cur.n); if (LESSONS[idx + 1]) open(LESSONS[idx + 1], false); }}>
            <source src={videoUrl(cur)} type="video/mp4" />
            Seu navegador não reproduz vídeos.
          </video>
          <div className="card p-5">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="chip bg-primary/10 text-primary">Aula {cur.n}</span>
              <span className="text-ink-faint"><Clock className="inline h-4 w-4" /> {fmtDur(cur.s)}</span>
              {seen[cur.n] && <span className="chip bg-emerald-500/10 text-emerald-600">assistida</span>}
            </div>
            <h2 className="mt-2 text-2xl font-bold">{cur.title}</h2>
            <p className="text-ink-soft">{cur.desc}</p>
            <ul className="mt-3 grid gap-1 text-sm sm:grid-cols-3">{cur.learn.map((x) => <li key={x} className="flex gap-1.5"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />{x}</li>)}</ul>
            <div className="mt-4 flex gap-2">
              <button className="btn btn-ghost border border-line" disabled={idx === 0} onClick={() => open(LESSONS[idx - 1])}>Aula anterior</button>
              <button className="btn btn-primary" disabled={idx === LESSONS.length - 1} onClick={() => open(LESSONS[idx + 1])}>Próxima aula</button>
            </div>
          </div>
        </section>
        <aside className="space-y-3">
          <div className="card p-3">
            <div className="mb-2 flex items-center justify-between text-sm"><span className="font-semibold">Seu progresso</span><span className="text-ink-faint">{done} de {LESSONS.length}</span></div>
            <div className="h-2 overflow-hidden rounded-full bg-line"><div className="h-full bg-primary" style={{ width: `${(done / LESSONS.length) * 100}%` }} /></div>
            <label className="mt-3 flex items-center gap-2 rounded-lg border border-line px-3"><Search className="h-4 w-4 text-ink-faint" />
              <input className="w-full bg-transparent py-2 text-sm outline-none" placeholder="Buscar aula" value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Buscar aula" /></label>
          </div>
          <div className="card max-h-[70vh] overflow-y-auto p-2">
            {groups.map((g) => (
              <div key={g.key} className="mb-2">
                <div className="px-2 pt-1 text-xs font-bold uppercase tracking-wide text-ink-faint">{g.label}</div>
                {g.items.map((l) => (
                  <button key={l.n} onClick={() => open(l)} aria-current={l.n === cur.n ? 'true' : undefined}
                    className={cx('mt-1 flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-primary/5', l.n === cur.n && 'bg-primary/10 ring-1 ring-primary/40')}>
                    <span className="relative shrink-0"><img src={thumbUrl(l)} alt="" loading="lazy" className="h-14 w-24 rounded object-cover" />
                      <PlayCircle className="absolute inset-0 m-auto h-5 w-5 text-white drop-shadow" /></span>
                    <span className="min-w-0"><span className="block truncate text-sm font-semibold">{l.n}. {l.title}</span>
                      <span className="text-xs text-ink-faint">{fmtDur(l.s)}{seen[l.n] ? ' · ✓ assistida' : ''}</span></span>
                  </button>
                ))}
              </div>
            ))}
            {!groups.length && <p className="p-3 text-sm text-ink-faint">Nenhuma aula encontrada.</p>}
          </div>
        </aside>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="text-xl font-bold">Perguntas frequentes</h2>
          <div className="mt-2 space-y-2">{FAQ.map(([q, a]) => <details key={q} className="card p-3"><summary className="cursor-pointer font-semibold">{q}</summary><p className="mt-2 text-sm">{a}</p></details>)}</div>
        </div>
        <div>
          <h2 className="text-xl font-bold">Fale com o suporte</h2>
          <div className="card mt-2 space-y-2 p-4 text-sm">
            {wa || ch.email ? (
              <div className="flex flex-wrap gap-2">
                {wa && <a className="btn btn-primary" href={`https://wa.me/${wa.length >= 12 ? wa : `55${wa}`}`} target="_blank" rel="noreferrer noopener"><LifeBuoy className="h-4 w-4" /> WhatsApp</a>}
                {ch.email && <a className="btn btn-ghost border border-line" href={`mailto:${ch.email}`}>{ch.email}</a>}
              </div>
            ) : access?.support ? <p>{access.support}</p> : <p className="text-ink-soft">Os contatos do suporte são configurados pela administração da plataforma e aparecerão aqui.</p>}
            {ch.hours && <p className="text-ink-faint">Horário: {ch.hours}</p>}
            {ch.message && <p className="text-ink-faint">{ch.message}</p>}
          </div>
          <p className="mt-3 text-xs text-ink-faint">Atalhos: Ctrl+K busca · Alt+O nova OS · Alt+Q novo orçamento · Alt+S nova solicitação.</p>
        </div>
      </div>
    </div>
  );
}
