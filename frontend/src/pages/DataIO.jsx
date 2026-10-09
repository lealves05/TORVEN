// Importar e exportar dados: clientes (com veículo/objeto) e OS antigas por planilha; exportação em planilha.
// Antes de importar o sistema mostra a prévia linha a linha (o que será criado, atualizado ou tem erro). Dá para desfazer.
import { useCallback, useEffect, useRef, useState } from 'react';
import { FileUp, Download, Users, ClipboardList, Undo2, CheckCircle2, AlertTriangle, MinusCircle, PlusCircle, RefreshCw, FileSpreadsheet } from 'lucide-react';
import { api, apiBase, getToken } from '../lib/api';
import { fmtDateTime, downloadCSV } from '../lib/format';
import { readTable } from '../lib/sheet';
import { useAuth } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import { PageHeader, Modal, Toggle, Empty, Loading, useAction, FAIL, cx } from '../components/ui';

const KINDS = {
  clientes: {
    title: 'Clientes e veículos', icon: Users, perm: 'data_import',
    text: 'Nome, CPF/CNPJ, telefone, e-mail, endereço e, se quiser, a placa, marca e modelo do veículo.',
    template: [{ Nome: 'Maria da Silva', Tipo: 'PF', 'CPF/CNPJ': '529.982.247-25', Telefone: '(19) 98888-1111', Telefone2: '', Email: 'maria@email.com',
      CEP: '13010-000', Rua: 'Rua das Flores', Numero: '100', Complemento: '', Bairro: 'Centro', Cidade: 'Campinas', UF: 'SP', Observacoes: '',
      Placa: 'ABC1D23', Marca: 'Fiat', Modelo: 'Strada 1.4', Ano: '2019', Cor: 'Branca' }],
  },
  os: {
    title: 'Ordens de serviço antigas', icon: ClipboardList, perm: 'data_import',
    text: 'Histórico de OS do sistema anterior: número antigo, datas, cliente, veículo/objeto, problema, serviço, valor e situação.',
    template: [{ 'Numero antigo': '1520', 'Data abertura': '15/03/2025', Cliente: 'Maria da Silva', 'CPF/CNPJ': '529.982.247-25', Telefone: '(19) 98888-1111',
      Placa: 'ABC1D23', Equipamento: 'Fiat Strada', Problema: 'Barulho no freio', Diagnostico: 'Pastilhas gastas', 'Servico executado': 'Troca de pastilhas dianteiras',
      'Valor total': '450,00', Situacao: 'Entregue', 'Data entrega': '16/03/2025', Observacoes: '' }],
  },
};
const ST = {
  criado: ['Novo', 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300', PlusCircle],
  atualizado: ['Atualiza', 'bg-sky-500/10 text-sky-700 dark:text-sky-300', RefreshCw],
  sem_mudanca: ['Sem mudança', 'bg-muted text-ink-soft', MinusCircle],
  ignorado: ['Já existe', 'bg-muted text-ink-soft', MinusCircle],
  erro: ['Erro', 'bg-red-500/10 text-red-700 dark:text-red-300', AlertTriangle],
};

function Importer({ kind, onImported }) {
  const cfg = KINDS[kind];
  const { toast } = useUI();
  const [run, busy] = useAction();
  const [file, setFile] = useState(null);
  const [rows, setRows] = useState(null);
  const [update, setUpdate] = useState(true);
  const [preview, setPreview] = useState(null);
  const [only, setOnly] = useState('');
  const input = useRef(null);
  const reset = () => { setFile(null); setRows(null); setPreview(null); setOnly(''); if (input.current) input.current.value = ''; };

  const pick = async (f) => {
    if (!f) return;
    reset();
    try {
      const t = await readTable(f);
      if (!t.rows.length) throw new Error('A planilha não tem linhas com dados (a 1ª linha deve ter os nomes das colunas).');
      setFile(f); setRows(t.rows);
      const r = await run(() => api.post(`/data/${kind}/preview`, { rows: t.rows, filename: f.name, update }));
      if (r !== FAIL) setPreview(r);
    } catch (e) { toast(e.message, 'error'); }
  };
  const repreview = async (u) => {
    setUpdate(u);
    if (!rows) return;
    const r = await run(() => api.post(`/data/${kind}/preview`, { rows, filename: file.name, update: u }));
    if (r !== FAIL) setPreview(r);
  };
  const go = async () => {
    const r = await run(() => api.post(`/data/${kind}/import`, { rows, filename: file.name, update }),
      'Importação concluída');
    if (r !== FAIL) { reset(); onImported(r); }
  };
  const Icon = cfg.icon;
  const list = (preview?.rows || []).filter((x) => !only || x.status === only);
  return (
    <section className="card space-y-3 p-5" aria-label={`Importar ${cfg.title}`}>
      <div className="flex flex-wrap items-start gap-3">
        <Icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1 basis-60">
          <h3 className="font-semibold">Importar {cfg.title.toLowerCase()}</h3>
          <p className="text-sm text-ink-faint">{cfg.text}</p>
        </div>
        <button className="btn-outline h-9 text-sm" onClick={() => downloadCSV(`modelo-${kind}.csv`, cfg.template)}><Download className="h-4 w-4" /> Baixar modelo</button>
      </div>
      <ol className="list-decimal space-y-0.5 pl-5 text-xs text-ink-soft">
        <li>Baixe o modelo e preencha no Excel (ou use a sua planilha: a 1ª linha precisa ter os nomes das colunas).</li>
        <li>Salve como Excel (.xlsx) ou CSV e escolha o arquivo abaixo.</li>
        <li>Confira a prévia e clique em Importar. Se algo der errado, use Desfazer no histórico.</li>
      </ol>
      <label className={cx('flex cursor-pointer flex-col items-center justify-center gap-1 rounded-app-sm border-2 border-dashed border-line p-5 text-sm hover:border-primary', busy && 'opacity-60')}>
        <FileUp className="h-6 w-6 text-ink-faint" />
        <span><b>Escolher planilha</b> (.xlsx ou .csv)</span>
        {file && <span className="text-xs text-ink-faint">{file.name} · {rows?.length || 0} linha(s)</span>}
        <input ref={input} type="file" className="sr-only" accept=".xlsx,.csv,.txt" data-testid={`arquivo-${kind}`} onChange={(e) => pick(e.target.files?.[0])} />
      </label>
      {kind === 'clientes' && (
        <Toggle checked={update} onChange={repreview} label="Atualizar clientes que já estão cadastrados"
          hint="O cliente é encontrado pelo CPF/CNPJ, pelo telefone ou pelo nome. Desligado, os já cadastrados ficam como estão." />
      )}
      {busy && !preview && <Loading />}
      {preview && (
        <div className="space-y-2" aria-label="Prévia da importação">
          <div className="flex flex-wrap gap-1.5 text-xs">
            {[['', `Todas (${preview.total})`], ['criado', `Novos (${preview.created})`], ['atualizado', `Atualiza (${preview.updated})`],
              ['erro', `Com erro (${preview.errors})`], ['ignorado', `Já existem (${preview.skipped})`]].map(([k, l]) => (
              <button key={k} onClick={() => setOnly(k)} className={cx('chip border', only === k ? 'border-primary bg-primary/10 text-primary' : 'border-line')}>{l}</button>
            ))}
          </div>
          <div className="max-h-80 overflow-y-auto rounded-app-sm border border-line">
            <table className="table-clean text-sm">
              <thead><tr><th className="w-16">Linha</th><th className="w-28">Resultado</th><th>Nome</th><th className="hidden sm:table-cell">Detalhe</th></tr></thead>
              <tbody>
                {list.slice(0, 300).map((x) => {
                  const [label, tone, I] = ST[x.status] || ST.sem_mudanca;
                  return (
                    <tr key={x.line}>
                      <td className="tabular-nums text-ink-faint">{x.line}</td>
                      <td><span className={cx('chip gap-1', tone)}><I className="h-3 w-3" />{label}</span></td>
                      <td className="max-w-[200px] truncate">{x.name || '—'}<div className="text-xs text-ink-faint sm:hidden">{x.message}</div></td>
                      <td className={cx('hidden text-xs sm:table-cell', x.status === 'erro' ? 'text-red-600' : 'text-ink-faint')}>{x.message}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {preview.errors > 0 && <p className="text-xs text-amber-700">As linhas com erro não serão importadas. Corrija na planilha e importe só elas depois, se quiser.</p>}
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" disabled={busy || preview.created + preview.updated === 0} onClick={go}>
              <CheckCircle2 className="h-4 w-4" /> Importar {preview.created + preview.updated} linha(s)
            </button>
            <button className="btn-ghost" onClick={reset}>Cancelar</button>
          </div>
        </div>
      )}
    </section>
  );
}

function Exporter() {
  const { toast } = useUI();
  const [busy, setBusy] = useState('');
  const [list, setList] = useState([]);
  useEffect(() => { api.get('/export').then(setList).catch(() => {}); }, []);
  const download = async (key) => {
    setBusy(key);
    try {
      const res = await fetch(`${apiBase}/export/${key}.csv`, { headers: { Authorization: `Bearer ${getToken()}` } });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Falha ao exportar.');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(await res.blob());
      a.download = `torven-${key}-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  };
  const main = ['clientes', 'objetos', 'os', 'os_itens', 'lancamentos'];
  const sorted = [...list.filter((x) => main.includes(x.key)).sort((a, b) => main.indexOf(a.key) - main.indexOf(b.key)), ...list.filter((x) => !main.includes(x.key))];
  return (
    <section className="card space-y-3 p-5" aria-label="Exportar dados">
      <div className="flex items-start gap-3">
        <FileSpreadsheet className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div><h3 className="font-semibold">Exportar dados</h3><p className="text-sm text-ink-faint">Planilhas que abrem direto no Excel. Cada exportação fica registrada no histórico de alterações.</p></div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {sorted.map((x) => (
          <button key={x.key} className={cx('btn-outline justify-start', main.includes(x.key) && 'border-primary/40')} disabled={!!busy} onClick={() => download(x.key)}>
            <Download className="h-4 w-4" /> {busy === x.key ? 'Gerando…' : x.label}
          </button>
        ))}
      </div>
    </section>
  );
}

function History({ reloadKey }) {
  const { confirm } = useUI();
  const [run] = useAction();
  const [list, setList] = useState(null);
  const load = useCallback(() => api.get('/data/imports').then(setList).catch(() => setList([])), []);
  useEffect(() => { load(); }, [load, reloadKey]);
  const undo = async (b) => {
    if (!(await confirm({ title: 'Desfazer esta importação?', message: `Apaga o que ela criou e ainda não foi usado (OS sem pagamento, clientes sem outras OS). Dados atualizados em clientes que já existiam não voltam ao que eram.`, confirmText: 'Desfazer' }))) return;
    const r = await run(() => api.post(`/data/imports/${b.id}/undo`), null);
    if (r !== FAIL) load();
  };
  if (!list) return <Loading />;
  return (
    <section className="card overflow-hidden" aria-label="Importações feitas">
      <h3 className="border-b border-line px-5 py-3.5 font-semibold">Importações feitas</h3>
      {!list.length ? <Empty icon={FileUp} title="Nenhuma importação ainda" /> : (
        <div className="divide-y divide-line">
          {list.map((b) => (
            <div key={b.id} className={cx('flex flex-wrap items-center gap-3 px-5 py-2.5 text-sm', b.undone_at && 'opacity-60')}>
              <span className="min-w-0 flex-1">
                <b>{KINDS[b.kind]?.title || b.kind}</b> · {b.filename || 'planilha'}
                <span className="block text-xs text-ink-faint">{fmtDateTime(b.created_at)} · {b.user_name} · {b.created} novo(s), {b.updated} atualizado(s), {b.errors} com erro{b.undone_at ? ` · desfeita em ${fmtDateTime(b.undone_at)}` : ''}</span>
              </span>
              {!b.undone_at && b.created > 0 && <button className="btn-ghost h-8 text-xs" onClick={() => undo(b)}><Undo2 className="h-3.5 w-3.5" /> Desfazer</button>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default function DataIO() {
  const { can } = useAuth();
  const [done, setDone] = useState(null);
  const [n, setN] = useState(0);
  return (
    <div className="space-y-4">
      <PageHeader title="Importar e exportar dados" subtitle="Traga clientes e OS de outro sistema ou planilha, e leve seus dados para o Excel" />
      {can('data_import') && <Importer kind="clientes" onImported={(r) => { setDone(r); setN((x) => x + 1); }} />}
      {can('data_import') && can('orders_create') && <Importer kind="os" onImported={(r) => { setDone(r); setN((x) => x + 1); }} />}
      {can('data_export') && <Exporter />}
      {can('data_import') && <History reloadKey={n} />}
      {done && (
        <Modal open onClose={() => setDone(null)} size="sm" title="Importação concluída" footer={<button className="btn-primary" onClick={() => setDone(null)}>Ok</button>}>
          <div className="space-y-2 text-sm">
            <p><b>{done.created}</b> criado(s), <b>{done.updated}</b> atualizado(s), <b>{done.skipped + done.unchanged}</b> sem mudança e <b>{done.errors}</b> com erro.</p>
            {done.errors > 0 && (
              <ul className="max-h-48 list-disc overflow-y-auto pl-5 text-xs text-red-700">
                {done.rows.map((x) => <li key={x.line}>Linha {x.line}: {x.message}</li>)}
              </ul>
            )}
            <p className="text-xs text-ink-faint">Se precisar, desfaça em “Importações feitas”.</p>
          </div>
        </Modal>
      )}
    </div>
  );
}
