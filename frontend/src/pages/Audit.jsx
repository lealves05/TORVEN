// Logs e auditoria: quem alterou preços, aprovações, estoque, caixa, pagamentos, documentos fiscais, perfis e configurações.
import { useCallback, useEffect, useState } from 'react';
import { Search, ShieldCheck, ChevronLeft, ChevronRight } from 'lucide-react';
import { api, qs } from '../lib/api';
import { fmtDateTime, downloadCSV } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import { PageHeader, Loading, Empty, Modal } from '../components/ui';

const PAGE = 50;

export default function Audit() {
  const { can } = useAuth();
  const [f, setF] = useState({ search: '', entity: '', from: '', to: '' });
  const [page, setPage] = useState(0);
  const [data, setData] = useState(null);
  const [view, setView] = useState(null);
  const load = useCallback(() => api.get(`/audit${qs({ ...f, limit: PAGE, offset: page * PAGE })}`).then(setData).catch(() => setData({ rows: [], total: 0, entities: {} })), [f, page]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  const upd = (k) => (e) => { setPage(0); setF({ ...f, [k]: e.target.value }); };
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE)) : 1;

  return (
    <div>
      <PageHeader title="Logs e auditoria" subtitle="Registro permanente das operações sensíveis — quem fez, quando e em qual registro"
        actions={can('data_export') && data?.rows?.length > 0 && (
          <button className="btn-outline" onClick={() => downloadCSV('auditoria.csv', data.rows.map((r) => ({
            data: fmtDateTime(r.created_at), usuario: r.user_name, area: data.entities[r.entity] || r.entity, acao: r.action, resumo: r.summary, ip: r.ip,
          })))}>Exportar CSV</button>
        )} />
      <div className="card mb-4 flex flex-wrap items-end gap-3 p-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <input className="input pl-9" placeholder="Texto ou usuário…" value={f.search} onChange={upd('search')} />
        </div>
        <select className="input w-48" value={f.entity} onChange={upd('entity')} aria-label="Área">
          <option value="">Todas as áreas</option>
          {Object.entries(data?.entities || {}).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input type="date" className="input w-40" value={f.from} onChange={upd('from')} aria-label="De" />
        <input type="date" className="input w-40" value={f.to} onChange={upd('to')} aria-label="Até" />
      </div>
      <div className="card overflow-hidden">
        {!data ? <Loading /> : !data.rows.length ? <Empty icon={ShieldCheck} title="Nenhum registro" text="As operações sensíveis aparecem aqui assim que forem feitas." /> : (
          <>
            <div className="overflow-x-auto">
              <table className="table-clean">
                <thead><tr><th>Quando</th><th>Usuário</th><th>Área</th><th>O que aconteceu</th></tr></thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.id} className="cursor-pointer" onClick={() => setView(r)}>
                      <td className="whitespace-nowrap text-ink-soft">{fmtDateTime(r.created_at)}</td>
                      <td className="whitespace-nowrap">{r.user_name || '—'}</td>
                      <td className="whitespace-nowrap"><span className="chip bg-muted text-ink-soft">{data.entities[r.entity] || r.entity}</span></td>
                      <td><div className="max-w-[520px] truncate">{r.summary || r.action}</div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t border-line px-4 py-2 text-xs text-ink-faint">
              <span>{data.total} registro(s)</span>
              <div className="flex items-center gap-1">
                <button className="btn-ghost btn-icon h-8" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Página anterior"><ChevronLeft className="h-4 w-4" /></button>
                <span className="tabular-nums">{page + 1}/{pages}</span>
                <button className="btn-ghost btn-icon h-8" disabled={page >= pages - 1} onClick={() => setPage(page + 1)} aria-label="Próxima página"><ChevronRight className="h-4 w-4" /></button>
              </div>
            </div>
          </>
        )}
      </div>
      {view && (
        <Modal open onClose={() => setView(null)} size="md" title={data.entities[view.entity] || view.entity} subtitle={`${fmtDateTime(view.created_at)} · ${view.user_name || '—'}${view.ip ? ` · IP ${view.ip}` : ''}`}>
          <div className="space-y-3 text-sm">
            <p>{view.summary}</p>
            <div className="text-xs text-ink-faint">Ação: {view.action}{view.entity_id && ` · registro ${view.entity_id}`}</div>
            {view.data && <pre className="max-h-72 overflow-auto rounded-app-sm bg-muted p-3 text-xs">{JSON.stringify(view.data, null, 2)}</pre>}
          </div>
        </Modal>
      )}
    </div>
  );
}
