// Importar e exportar dados: clientes (com veículo/objeto) e OS antigas por planilha; exportação em planilha.
// Antes de importar o sistema mostra a prévia linha a linha (o que será criado, atualizado ou tem erro). Dá para desfazer.
import { useCallback, useEffect, useRef, useState } from 'react';
import { FileUp, Download, Users, Car, ClipboardList, Undo2, CheckCircle2, AlertTriangle, MinusCircle, PlusCircle, RefreshCw, FileSpreadsheet } from 'lucide-react';
import { api, apiBase, getToken } from '../lib/api';
import { fmtDateTime, downloadCSV } from '../lib/format';
import { readTable } from '../lib/sheet';
import { useAuth } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import { PageHeader, Modal, Toggle, Empty, Loading, useAction, FAIL, cx } from '../components/ui';

const KINDS = {
  clientes: {
    title: 'Clientes', icon: Users, step: 1,
    text: 'Nome, CPF/CNPJ, telefone, e-mail e endereço. O "Código antigo" (código do cliente no sistema anterior) liga depois os veículos e as OS.',
    template: [{ 'Codigo antigo': '153', Nome: 'Maria da Silva', Tipo: 'PF', 'CPF/CNPJ': '529.982.247-25', Telefone: '(19) 98888-1111', Telefone2: '', Email: 'maria@email.com',
      CEP: '13010-000', Rua: 'Rua das Flores', Numero: '100', Complemento: '', Bairro: 'Centro', Cidade: 'Campinas', UF: 'SP', Observacoes: '',
      Placa: 'ABC1D23', Marca: 'Fiat', Modelo: 'Strada 1.4', Ano: '2019', Cor: 'Branca' }],
  },
  veiculos: {
    title: 'Veículos', icon: Car, step: 2,
    text: 'Um veículo por linha, ligado ao cliente pelo código antigo (ou CPF/CNPJ, ou nome). Importe os clientes antes.',
    template: [{ 'Codigo cliente': '153', Placa: 'ABC1D23', Marca: 'Fiat', Modelo: 'Strada', Versao: '1.4 Working', Ano: '2019/2020', Cor: 'Branca', Chassi: '9BD27844PB7356495' }],
  },
  os: {
    title: 'Ordens de serviço antigas', icon: ClipboardList, step: 3,
    text: 'Uma linha por item (peça ou mão de obra). As linhas da mesma OS repetem o número antigo. OS sem itens: uma linha com o valor total.',
    template: [
      { 'Numero antigo': '1520', 'Data abertura': '15/03/2025', 'Data entrega': '16/03/2025', 'Codigo cliente': '153', Cliente: 'Maria da Silva', Placa: 'ABC1D23',
        Marca: 'Fiat', Modelo: 'Strada', Km: '62000', Tecnico: 'João', Situacao: 'Entregue', Problema: 'Barulho no freio', 'Item descricao': 'Pastilha de freio dianteira',
        'Item tipo': 'Peça', 'Item quantidade': '1', 'Item valor unitario': '180,00', 'Item desconto': '', Desconto: '', 'Valor total': '' },
      { 'Numero antigo': '1520', 'Data abertura': '15/03/2025', 'Data entrega': '16/03/2025', 'Codigo cliente': '153', Cliente: 'Maria da Silva', Placa: 'ABC1D23',
        Marca: 'Fiat', Modelo: 'Strada', Km: '62000', Tecnico: 'João', Situacao: 'Entregue', Problema: 'Barulho no freio', 'Item descricao': 'Mão de obra troca de pastilhas',
        'Item tipo': 'Serviço', 'Item quantidade': '1', 'Item valor unitario': '120,00', 'Item desconto': '', Desconto: '', 'Valor total': '' },
    ],
  },
};
// linhas por envio (arquivos grandes vão em partes; as linhas da mesma OS ficam juntas)
const CHUNK = 250;
const keyOf = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const OS_KEYS = ['numero_antigo', 'ordem_de_servico', 'numero_os', 'os', 'n_os', 'numero_da_os', 'ordem'];
function chunks(kind, rows) {
  const h = kind === 'os' ? Object.keys(rows[0] || {}).find((c) => OS_KEYS.includes(keyOf(c))) : null;
  const out = []; let cur = []; let start = 0;
  rows.forEach((r, i) => {
    if (cur.length >= CHUNK && (!h || r[h] !== rows[i - 1][h])) { out.push({ rows: cur, start }); cur = []; start = i; }
    cur.push(r);
  });
  if (cur.length) out.push({ rows: cur, start });
  return out;
}
const sum = (a, b) => ({ total: a.total + b.total, created: a.created + b.created, updated: a.updated + b.updated, skipped: a.skipped + b.skipped,
  unchanged: a.unchanged + b.unchanged, errors: a.errors + b.errors, rows: [...a.rows, ...b.rows], batch_id: a.batch_id || b.batch_id });
const EMPTY = { total: 0, created: 0, updated: 0, skipped: 0, unchanged: 0, errors: 0, rows: [] };
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

  const [progress, setProgress] = useState('');
  // envia em partes e soma os resultados (a prévia de cada parte é desfeita no servidor)
  const send = async (list, name, u, commit) => {
    const parts = chunks(kind, list);
    let acc = EMPTY;
    for (let i = 0; i < parts.length; i += 1) {
      if (parts.length > 1) setProgress(`${commit ? 'Importando' : 'Conferindo'} parte ${i + 1} de ${parts.length}…`);
      const r = await api.post(`/data/${kind}/${commit ? 'import' : 'preview'}`, {
        rows: parts[i].rows, filename: name, update: u, first_line: parts[i].start + 2, total: list.length, batch_id: commit ? acc.batch_id : undefined,
      });
      acc = sum(acc, r);
    }
    setProgress('');
    return acc;
  };
  const pick = async (f) => {
    if (!f) return;
    reset();
    try {
      const t = await readTable(f);
      if (!t.rows.length) throw new Error('A planilha não tem linhas com dados (a 1ª linha deve ter os nomes das colunas).');
      setFile(f); setRows(t.rows);
      const r = await run(() => send(t.rows, f.name, update, false));
      if (r !== FAIL) setPreview(r);
    } catch (e) { toast(e.message, 'error'); }
  };
  const repreview = async (u) => {
    setUpdate(u);
    if (!rows) return;
    const r = await run(() => send(rows, file.name, u, false));
    if (r !== FAIL) setPreview(r);
  };
  const go = async () => {
    const r = await run(() => send(rows, file.name, update, true), 'Importação concluída');
    if (r !== FAIL) { reset(); onImported({ ...r, rows: r.rows.filter((x) => x.status === 'erro') }); }
  };
  const Icon = cfg.icon;
  const list = (preview?.rows || []).filter((x) => !only || x.status === only);
  return (
    <section className="card space-y-3 p-5" aria-label={`Importar ${cfg.title}`}>
      <div className="flex flex-wrap items-start gap-3">
        <Icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1 basis-60">
          <h3 className="font-semibold"><span className="mr-1.5 inline-grid h-5 w-5 place-items-center rounded-full bg-primary text-[11px] text-primary-fg">{cfg.step}</span>Importar {cfg.title.toLowerCase()}</h3>
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
      {busy && !preview && (progress ? <p className="text-sm text-ink-soft">{progress}</p> : <Loading />)}
      {busy && preview && progress && <p className="text-sm text-ink-soft">{progress}</p>}
      {preview && (
        <div className="space-y-2" aria-label="Prévia da importação">
          <div className="flex flex-wrap gap-1.5 text-xs">
            {[['', `Todas (${preview.rows.length})`], ['criado', `Novos (${preview.created})`], ['atualizado', `Atualiza (${preview.updated})`],
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
          {kind === 'os' && <p className="text-xs text-ink-faint">Cada OS conta uma vez, mesmo com várias linhas de itens. As OS importadas não geram lançamentos no financeiro.</p>}
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
      <PageHeader title="Importar e exportar dados" subtitle="Traga clientes, veículos e OS de outro sistema ou planilha, e leve seus dados para o Excel" />
      {can('data_import') && <p className="rounded-app-sm bg-sky-500/10 p-3 text-sm text-sky-800 dark:text-sky-200">Vindo de outro sistema? Importe nesta ordem: <b>1. Clientes</b>, <b>2. Veículos</b> e <b>3. Ordens de serviço</b>. O código antigo do cliente liga tudo.</p>}
      {can('data_import') && <Importer kind="clientes" onImported={(r) => { setDone(r); setN((x) => x + 1); }} />}
      {can('data_import') && <Importer kind="veiculos" onImported={(r) => { setDone(r); setN((x) => x + 1); }} />}
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
