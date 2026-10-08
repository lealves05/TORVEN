// Emitentes de nota fiscal: cada CNPJ com o emissor que a empresa escolher (Focus, NFE.io, PlugNotas, Nuvem Fiscal,
// eNotas, API própria ou emissão no site da prefeitura) e o certificado A1 guardado cifrado.
import { useCallback, useEffect, useState } from 'react';
import {
  Building2, CheckCircle2, AlertTriangle, FileKey2, Upload, Plug, Send, Star, Pencil, Trash2, Plus, ExternalLink, Loader2,
  ShieldCheck, Info, ChevronDown, Power,
} from 'lucide-react';
import { api } from '../lib/api';
import { fmt, fmtDateTime, maskDoc, maskPhone, maskCep, lookupCep } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import { Input, Select, Toggle, Loading, Modal, useAction, FAIL, cx } from './ui';
import FiscalSetup from './FiscalSetup';

const toBase64 = (file) => new Promise((ok, err) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).replace(/^data:[^,]*,/, ''));
  r.onerror = err;
  r.readAsDataURL(file);
});

export default function FiscalEmitters() {
  const [data, setData] = useState(null);
  const [edit, setEdit] = useState(null); // null | 'new' | emitente
  const [legacyOpen, setLegacyOpen] = useState(false);
  const [run, busy] = useAction();
  const { toast } = useUI();
  const load = useCallback(() => api.get('/fiscal/emitters').then(setData), []);
  useEffect(() => { load(); }, [load]);
  if (!data) return <Loading />;
  const { emitters, providers } = data;
  const alerts = emitters.filter((e) => e.active && e.certificate && (e.certificate.expired || e.certificate.expiring));
  const importLegacy = async () => {
    const r = await run(() => api.post('/fiscal/emitters/import-legacy'), 'Configuração da Focus trazida para o emitente "Principal"');
    if (r !== FAIL) load();
  };

  return (
    <div className="max-w-4xl space-y-4 pb-10">
      <div className="card p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <div className="hidden h-11 w-11 shrink-0 place-items-center rounded-full bg-primary/10 text-primary sm:grid"><ShieldCheck className="h-5 w-5" /></div>
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold">Quem emite as suas notas</h3>
            <p className="text-sm text-ink-soft">
              Cadastre aqui <b>cada CNPJ</b> que emite nota (ex.: a oficina e o MEI). Para cada um, escolha a <b>empresa emissora</b> que você já
              contratou (Focus NFe, NFE.io, PlugNotas, Nuvem Fiscal, eNotas ou outra) e envie o <b>certificado digital A1</b>.
            </p>
          </div>
          <button className="btn-primary self-start" data-tour="novo-emitente" onClick={() => setEdit('new')}><Plus className="h-4 w-4" /> Novo emitente</button>
        </div>
        <ol className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
          {[['1', 'Dados do CNPJ', 'Razão social, inscrições e endereço'], ['2', 'Emissor e chave', 'A empresa que transmite as notas'], ['3', 'Certificado e envio', 'Arquivo .pfx, senha e “Enviar cadastro”']].map(([n, t, d]) => (
            <li key={n} className="flex gap-2 rounded-app-sm bg-muted/60 p-3">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-white">{n}</span>
              <span><b className="block">{t}</b><span className="text-xs text-ink-faint">{d}</span></span>
            </li>
          ))}
        </ol>
      </div>

      {alerts.map((e) => (
        <div key={e.id} className={cx('flex items-center gap-2 rounded-app-sm p-3 text-sm', e.certificate.expired ? 'bg-red-500/10 text-red-700 dark:text-red-300' : 'bg-amber-500/10 text-amber-800 dark:text-amber-200')}>
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Certificado de <b>{e.name}</b> {e.certificate.expired ? `venceu em ${fmt(e.certificate.valid_until)}. As notas desse CNPJ serão recusadas até renovar.` : `vence em ${e.certificate.days_left} dia(s) (${fmt(e.certificate.valid_until)}). Renove com a certificadora e envie o novo arquivo.`}
        </div>
      ))}

      {data.legacy_focus && (
        <div className="flex flex-wrap items-center gap-3 rounded-app-sm bg-sky-500/10 p-3 text-sm text-sky-800 dark:text-sky-200">
          <Info className="h-4 w-4 shrink-0" />
          <span className="flex-1">Você já usa a Focus NFe na configuração anterior. Traga para cá com um clique (tokens e numeração são mantidos).</span>
          <button className="btn-primary h-8 text-xs" disabled={busy} onClick={importLegacy}>Trazer configuração</button>
        </div>
      )}

      {emitters.length === 0 ? (
        <div className="card p-8 text-center text-sm text-ink-soft">
          <Building2 className="mx-auto mb-2 h-8 w-8 text-ink-faint" />
          Nenhum emitente cadastrado. Clique em <b>Novo emitente</b> para começar.
        </div>
      ) : emitters.map((e) => <EmitterCard key={e.id} em={e} onEdit={() => setEdit(e)} onChanged={load} toast={toast} />)}

      {data.legacy_focus && (
        <section className="card overflow-hidden">
          <button className="flex w-full items-center gap-3 px-5 py-3 text-left text-sm" onClick={() => setLegacyOpen(!legacyOpen)}>
            <span className="flex-1 font-medium">Configuração anterior (Focus NFe direto na empresa)</span>
            <ChevronDown className={cx('h-4 w-4 transition', legacyOpen && 'rotate-180')} />
          </button>
          {legacyOpen && <div className="border-t border-line p-4"><FiscalSetup /></div>}
        </section>
      )}

      {edit && <EmitterEditor em={edit === 'new' ? null : edit} providers={providers} defaults={data.defaults} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </div>
  );
}

// ---------------------------------------------------------------- cartão do emitente
function EmitterCard({ em, onEdit, onChanged, toast }) {
  const [run, busy] = useAction();
  const { confirm } = useUI();
  const [file, setFile] = useState(null);
  const [pw, setPw] = useState('');
  const [certOpen, setCertOpen] = useState(!em.certificate && !['manual', 'generico'].includes(em.provider));
  const manual = em.provider === 'manual';
  const cert = em.certificate;

  const upload = async () => {
    const r = await run(async () => api.post(`/fiscal/emitters/${em.id}/certificate`, { file_base64: await toBase64(file), password: pw }), 'Certificado conferido e guardado com segurança');
    if (r !== FAIL) { setFile(null); setPw(''); setCertOpen(false); onChanged(); }
  };
  const register = async () => { const r = await run(() => api.post(`/fiscal/emitters/${em.id}/register`)); if (r !== FAIL) { toast(r.message || 'Cadastro enviado'); } onChanged(); };
  const test = async () => { const r = await run(() => api.post(`/fiscal/emitters/${em.id}/test`)); if (r !== FAIL) toast(r.message); };
  const setDefault = async () => { if ((await run(() => api.post(`/fiscal/emitters/${em.id}/default`), `${em.name} é o emitente padrão`)) !== FAIL) onChanged(); };
  const toggle = async () => { if ((await run(() => api.post(`/fiscal/emitters/${em.id}/active`, { active: !em.active }), em.active ? 'Emitente desativado' : 'Emitente ativado')) !== FAIL) onChanged(); };
  const remove = async () => {
    if (!(await confirm({ title: `Excluir ${em.name}?`, message: 'O certificado e as chaves guardadas serão apagados. Se já houver notas desse emitente, ele só será desativado.', confirmText: 'Excluir', danger: true }))) return;
    const r = await run(() => api.del(`/fiscal/emitters/${em.id}`));
    if (r !== FAIL) { toast(r?.deactivated ? 'Emitente desativado (tem notas emitidas)' : 'Emitente excluído'); onChanged(); }
  };
  const removeCert = async () => {
    if (!(await confirm({ title: 'Apagar o certificado do TORVEN?', message: 'O certificado continua no emissor, se já foi enviado.', confirmText: 'Apagar', danger: true }))) return;
    if ((await run(() => api.del(`/fiscal/emitters/${em.id}/certificate`), 'Certificado apagado')) !== FAIL) onChanged();
  };

  return (
    <section className={cx('card p-5', !em.active && 'opacity-60')} data-tour="emitente">
      <div className="flex flex-wrap items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-muted text-ink-soft"><Building2 className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="font-semibold">{em.name}</h4>
            {em.is_default && <span className="chip bg-primary/15 text-primary"><Star className="h-3 w-3" /> Padrão</span>}
            {!em.active && <span className="chip bg-muted text-ink-soft">Desativado</span>}
            <span className={cx('chip', manual ? 'bg-muted text-ink-soft' : em.environment === 'producao' ? 'bg-emerald-500/15 text-emerald-700' : 'bg-amber-500/15 text-amber-700')}>
              {manual ? 'Registro manual' : em.environment === 'producao' ? 'Produção (vale de verdade)' : 'Homologação (testes)'}
            </span>
          </div>
          <p className="text-sm text-ink-soft">{em.razao_social} · CNPJ {maskDoc(em.cnpj)}</p>
          <p className="text-sm"><span className="text-ink-faint">Emissor:</span> <b>{em.provider_name}</b> · {[em.docs?.nfse && 'NFS-e', em.docs?.nfe && 'NF-e'].filter(Boolean).join(' e ') || 'nenhum documento marcado'}</p>
        </div>
        <div className="flex flex-wrap gap-1">
          <button className="btn-outline h-8 text-xs" onClick={onEdit}><Pencil className="h-3.5 w-3.5" /> Editar</button>
          {!em.is_default && em.active && <button className="btn-ghost h-8 text-xs" disabled={busy} onClick={setDefault}><Star className="h-3.5 w-3.5" /> Tornar padrão</button>}
          <button className="btn-ghost btn-icon h-8" title={em.active ? 'Desativar' : 'Ativar'} disabled={busy} onClick={toggle}><Power className="h-3.5 w-3.5" /></button>
          <button className="btn-ghost btn-icon h-8 text-red-600" title="Excluir" disabled={busy} onClick={remove}><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      </div>

      {em.problems.length > 0 && (
        <div className="mt-3 rounded-app-sm bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200"><b>Falta completar:</b> {em.problems.join(' · ')}</div>
      )}

      {!manual && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-app-sm border border-line p-3 text-sm">
            <div className="mb-1 flex items-center gap-2 font-medium"><FileKey2 className="h-4 w-4" /> Certificado digital A1</div>
            {cert ? (
              <div className={cx('text-sm', cert.expired ? 'text-red-600' : cert.expiring ? 'text-amber-700' : 'text-emerald-700')}>
                {cert.name || 'Titular'}{cert.cnpj && ` · ${maskDoc(cert.cnpj)}`}<br />
                Válido até <b>{fmt(cert.valid_until)}</b> {cert.expired ? '— VENCIDO' : `— faltam ${cert.days_left} dias`}
                <div className="mt-1 flex gap-3 text-xs">
                  <button className="text-primary" onClick={() => setCertOpen(!certOpen)}>Trocar / renovar</button>
                  <button className="text-red-600" onClick={removeCert}>Apagar</button>
                </div>
              </div>
            ) : <p className="text-ink-faint">Nenhum certificado enviado.</p>}
          </div>
          <div className="rounded-app-sm border border-line p-3 text-sm">
            <div className="mb-1 flex items-center gap-2 font-medium"><Send className="h-4 w-4" /> Cadastro no emissor</div>
            <p className={cx(em.sync_status === 'ok' ? 'text-emerald-700' : em.sync_status === 'erro' ? 'text-red-600' : 'text-ink-faint')}>
              {em.sync_status === 'ok' ? <><CheckCircle2 className="inline h-3.5 w-3.5" /> {em.sync_message}</> : em.sync_message || 'Ainda não enviado.'}
              {em.synced_at && <span className="block text-xs text-ink-faint">em {fmtDateTime(em.synced_at)}</span>}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button className="btn-primary h-8 text-xs" disabled={busy} onClick={register} data-tour="enviar-cadastro">
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Enviar cadastro ao emissor
              </button>
              <button className="btn-outline h-8 text-xs" disabled={busy} onClick={test}><Plug className="h-3.5 w-3.5" /> Testar conexão</button>
            </div>
          </div>
          {certOpen && (
            <div className="grid gap-3 rounded-app-sm border border-dashed border-primary/50 p-3 sm:col-span-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <label className="block">
                <span className="label">Arquivo do certificado (.pfx ou .p12)</span>
                <span className="flex h-[var(--row)] cursor-pointer items-center gap-2 rounded-app-sm border border-dashed border-line px-3 hover:border-primary">
                  <Upload className="h-4 w-4 text-ink-faint" /><span className="truncate">{file ? file.name : 'Clique para escolher…'}</span>
                  <input type="file" accept=".pfx,.p12,application/x-pkcs12" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
                </span>
              </label>
              <Input label="Senha do certificado" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
              <button className="btn-primary" disabled={busy || !file || !pw} onClick={upload}><FileKey2 className="h-4 w-4" /> Conferir e guardar</button>
              <p className="text-xs text-ink-faint sm:col-span-3">O TORVEN confere a senha, o CNPJ e a validade, guarda o arquivo cifrado e o envia ao emissor quando você clicar em “Enviar cadastro ao emissor”.</p>
            </div>
          )}
        </div>
      )}
      {manual && (
        <p className="mt-3 rounded-app-sm bg-muted/60 p-3 text-sm text-ink-soft">
          Sem integração: ao emitir, o TORVEN mostra os dados da nota para você copiar no site da prefeitura ou da SEFAZ. Depois, informe o número da nota emitida.
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- cadastro / edição
const blank = { name: '', cnpj: '', razao_social: '', nome_fantasia: '', ie: '', im: '', regime: 'simples', email: '', phone: '', cep: '', street: '', number: '',
  complement: '', district: '', city: '', uf: '', city_code: '', provider: '', environment: 'homologacao', docs: { nfse: true, nfe: false }, settings: {} };

function EmitterEditor({ em, providers, defaults, onClose, onSaved }) {
  const { company } = useAuth();
  const [run, busy] = useAction();
  const [step, setStep] = useState(em ? 2 : 1);
  const [f, setF] = useState(() => (em ? { ...blank, ...Object.fromEntries(Object.entries(em).map(([k, v]) => [k, v ?? ''])), cnpj: maskDoc(em.cnpj), settings: { ...em.settings } } : { ...blank, settings: { ...(defaults || {}) } }));
  const [sec, setSec] = useState({});
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const setS = (k, v) => setF({ ...f, settings: { ...f.settings, [k]: v } });
  const p = providers.find((x) => x.id === f.provider);
  const copyCompany = () => setF({ ...f, name: f.name || 'Matriz', cnpj: maskDoc(company.document || ''), razao_social: company.name || '', nome_fantasia: company.trade_name || '',
    ie: company.state_registration || '', im: company.municipal_registration || '', email: company.email || '', phone: company.phone || '', cep: company.cep || '',
    street: company.street || '', number: company.number || '', complement: company.complement || '', district: company.district || '', city: company.city || '',
    uf: company.uf || '', city_code: company.city_code || '' });
  const cep = async (v) => {
    const m = maskCep(v);
    setF((y) => ({ ...y, cep: m }));
    if (m.length === 9) { const a = await lookupCep(m); if (a) setF((y) => ({ ...y, ...a, street: a.street || y.street, district: a.district || y.district })); }
  };
  const save = async () => {
    const s = f.settings;
    const body = {
      ...Object.fromEntries(Object.keys(blank).map((k) => [k, f[k] === '' ? null : f[k]])), name: f.name, cnpj: f.cnpj, razao_social: f.razao_social,
      docs: f.docs, settings: Object.fromEntries(Object.entries(s).filter(([, v]) => v !== '' && v !== undefined)),
      secrets: Object.fromEntries(Object.entries(sec).filter(([, v]) => v)),
      ...(f.next_dps_producao ? { next_dps_producao: Number(f.next_dps_producao) } : {}),
      ...(f.next_nfe_producao ? { next_nfe_producao: Number(f.next_nfe_producao) } : {}),
    };
    const r = await run(() => (em ? api.put(`/fiscal/emitters/${em.id}`, body) : api.post('/fiscal/emitters', body)), em ? 'Emitente salvo' : 'Emitente criado. Agora envie o certificado.');
    if (r !== FAIL) onSaved();
  };
  const step1ok = f.name.trim().length >= 2 && f.cnpj.replace(/\D/g, '').length === 14 && f.razao_social.trim().length >= 2;
  const isNacional = (f.settings.nfseMode || 'nacional') === 'nacional';

  return (
    <Modal open onClose={onClose} title={em ? `Editar ${em.name}` : 'Novo emitente'} subtitle={`Passo ${step} de 3`} size="lg" dirty
      footer={<>
        {step > 1 && <button className="btn-ghost" onClick={() => setStep(step - 1)}>Voltar</button>}
        <span className="flex-1" />
        {step < 3 ? <button className="btn-primary" disabled={(step === 1 && !step1ok) || (step === 2 && !f.provider)} onClick={() => setStep(step + 1)}>Continuar</button>
          : <button className="btn-primary" disabled={busy || !step1ok || !f.provider} onClick={save}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Salvar emitente</button>}
      </>}>
      <div className="mb-4 flex gap-2">
        {['Dados do CNPJ', 'Emissor', 'Impostos'].map((t, i) => (
          <button key={t} onClick={() => (i === 0 || step1ok) && setStep(i + 1)} className={cx('flex-1 rounded-app-sm border px-2 py-1.5 text-xs font-medium', step === i + 1 ? 'border-primary bg-primary/10 text-primary' : 'border-line text-ink-soft')}>{i + 1}. {t}</button>
        ))}
      </div>

      {step === 1 && (
        <div className="space-y-4">
          {!em && <button className="btn-outline h-8 text-xs" onClick={copyCompany}><Building2 className="h-3.5 w-3.5" /> Copiar os dados da minha empresa</button>}
          <div className="grid gap-3 sm:grid-cols-6">
            <Input label="Apelido (como vai aparecer na tela)" value={f.name} onChange={set('name')} className="sm:col-span-2" placeholder="ex.: Matriz, MEI" />
            <Input label="CNPJ" value={f.cnpj} onChange={(e) => setF({ ...f, cnpj: maskDoc(e.target.value) })} className="sm:col-span-2" />
            <Select label="Regime" value={f.regime} onChange={set('regime')} className="sm:col-span-2">
              <option value="simples">Simples Nacional</option><option value="mei">MEI</option><option value="normal">Lucro presumido / real</option>
            </Select>
            <Input label="Razão social" value={f.razao_social} onChange={set('razao_social')} className="sm:col-span-4" />
            <Input label="Nome fantasia" value={f.nome_fantasia} onChange={set('nome_fantasia')} className="sm:col-span-2" />
            <Input label="Inscrição municipal" value={f.im} onChange={set('im')} className="sm:col-span-2" hint="Para NFS-e" />
            <Input label="Inscrição estadual" value={f.ie} onChange={set('ie')} className="sm:col-span-2" hint="Para NF-e" />
            <Input label="Telefone" value={f.phone} onChange={(e) => setF({ ...f, phone: maskPhone(e.target.value) })} className="sm:col-span-2" />
            <Input label="E-mail" value={f.email} onChange={set('email')} className="sm:col-span-3" />
            <Input label="CEP" value={f.cep} onChange={(e) => cep(e.target.value)} className="sm:col-span-3" hint="Preenche o endereço e o código IBGE" />
            <Input label="Endereço" value={f.street} onChange={set('street')} className="sm:col-span-4" />
            <Input label="Número" value={f.number} onChange={set('number')} className="sm:col-span-2" />
            <Input label="Bairro" value={f.district} onChange={set('district')} className="sm:col-span-2" />
            <Input label="Cidade" value={f.city} onChange={set('city')} className="sm:col-span-2" />
            <Input label="UF" value={f.uf} maxLength={2} onChange={(e) => setF({ ...f, uf: e.target.value.toUpperCase() })} className="sm:col-span-1" />
            <Input label="Cód. IBGE" value={f.city_code} onChange={set('city_code')} className="sm:col-span-1" />
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <p className="text-sm text-ink-soft">Escolha a empresa que vai <b>transmitir</b> as notas deste CNPJ. Você precisa ter uma conta nela.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {providers.map((x) => (
              <button key={x.id} onClick={() => setF({ ...f, provider: x.id })} data-tour={`emissor-${x.id}`}
                className={cx('rounded-app-sm border p-3 text-left text-sm transition', f.provider === x.id ? 'border-primary bg-primary/10 ring-1 ring-primary/40' : 'border-line hover:border-primary/50')}>
                <b className="block">{x.name}</b>
                <span className="block text-xs text-ink-faint">{x.help}</span>
              </button>
            ))}
          </div>
          {p && (
            <div className="space-y-3 rounded-app-sm border border-line p-3">
              {p.site && <a href={p.site} target="_blank" rel="noreferrer" className="text-sm text-primary">Abrir o site da {p.name} <ExternalLink className="inline h-3 w-3" /></a>}
              <div className="flex flex-wrap gap-2">
                {[['nfse', 'NFS-e (serviços)'], ['nfe', 'NF-e (materiais)']].filter(([k]) => p.docs.includes(k)).map(([k, l]) => (
                  <label key={k} className={cx('flex cursor-pointer items-center gap-2 rounded-app-sm border px-3 py-2 text-sm', f.docs[k] ? 'border-primary bg-primary/10 text-primary' : 'border-line')}>
                    <input type="checkbox" checked={!!f.docs[k]} onChange={(e) => setF({ ...f, docs: { ...f.docs, [k]: e.target.checked } })} />{l}
                  </label>
                ))}
              </div>
              {!p.manual && (
                <Select label="Ambiente" value={f.environment} onChange={set('environment')} hint="Comece em homologação: as notas de teste não têm valor fiscal.">
                  <option value="homologacao">Homologação (testes, sem valor fiscal)</option><option value="producao">Produção (notas de verdade)</option>
                </Select>
              )}
              {p.secrets.map((s) => (
                <Input key={s.key} label={`${s.label}${s.optional ? ' (opcional)' : ''}`} type="password" autoComplete="new-password" value={sec[s.key] || ''}
                  onChange={(e) => setSec({ ...sec, [s.key]: e.target.value })}
                  placeholder={em?.provider === f.provider && em?.secrets?.[s.key]?.set ? `já salvo (${em.secrets[s.key].hint}) — deixe vazio para manter` : 'cole aqui'} />
              ))}
              {p.fields.map((x) => (x.type === 'boolean'
                ? <Toggle key={x.key} checked={!!f.settings[x.key]} onChange={(v) => setS(x.key, v)} label={x.label} />
                : <Input key={x.key} label={x.label} value={f.settings[x.key] ?? ''} placeholder={x.placeholder} onChange={(e) => setS(x.key, e.target.value)} />))}
              {(p.secrets.length > 0) && <p className="text-xs text-ink-faint">As chaves ficam guardadas cifradas e nunca aparecem de novo na tela.</p>}
            </div>
          )}
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4 text-sm">
          {f.docs.nfse && (
            <div className="space-y-3">
              <h4 className="font-semibold">NFS-e — serviços</h4>
              <div className="grid gap-3 sm:grid-cols-3">
                <Select label="Padrão da NFS-e" value={f.settings.nfseMode || 'nacional'} onChange={(e) => setS('nfseMode', e.target.value)} className="sm:col-span-3">
                  <option value="nacional">Padrão nacional (DPS)</option><option value="municipal">Padrão da prefeitura</option>
                </Select>
                <Input label="Item LC 116" value={f.settings.itemListaServico ?? ''} onChange={(e) => setS('itemListaServico', e.target.value)} hint="14.01 conserto · 14.13 serralheria" />
                {isNacional && <Input label="Cód. tributação nacional" value={f.settings.codigoTributacaoNacional ?? ''} onChange={(e) => setS('codigoTributacaoNacional', e.target.value)} hint="6 dígitos, ex.: 140101" />}
                <Input label="Cód. tributário municipal" value={f.settings.codigoTributarioMunicipio ?? ''} onChange={(e) => setS('codigoTributarioMunicipio', e.target.value)} hint="Se a prefeitura exigir" />
                <Input label="Alíquota do ISS (%)" type="number" step="0.01" value={f.settings.issRate ?? ''} onChange={(e) => setS('issRate', e.target.value === '' ? '' : +e.target.value)} />
                <Input label="CNAE" value={f.settings.cnae ?? ''} onChange={(e) => setS('cnae', e.target.value)} />
                <Input label="Próximo nº da DPS (produção)" type="number" min={1} value={f.next_dps_producao ?? 1} onChange={(e) => setF({ ...f, next_dps_producao: +e.target.value || 1 })} hint="Se já emitia por outro sistema" />
              </div>
              <Toggle checked={!!f.settings.issRetido} onChange={(v) => setS('issRetido', v)} label="ISS retido pelo tomador" hint="Normalmente não." />
            </div>
          )}
          {f.docs.nfe && (
            <div className="space-y-3">
              <h4 className="font-semibold">NF-e — materiais</h4>
              <div className="grid gap-3 sm:grid-cols-3">
                <Input label="Natureza da operação" value={f.settings.naturezaOperacao ?? ''} onChange={(e) => setS('naturezaOperacao', e.target.value)} className="sm:col-span-3" />
                <Input label="CFOP dentro do estado" value={f.settings.cfopDentro ?? ''} onChange={(e) => setS('cfopDentro', e.target.value)} hint="5102 revenda" />
                <Input label="CFOP fora do estado" value={f.settings.cfopFora ?? ''} onChange={(e) => setS('cfopFora', e.target.value)} hint="6102" />
                <Input label="Série da NF-e" type="number" value={f.settings.serieNfe ?? ''} onChange={(e) => setS('serieNfe', +e.target.value || 1)} />
                <Input label={f.regime === 'normal' ? 'CST ICMS' : 'CSOSN'} value={f.settings.icmsSituacao ?? ''} onChange={(e) => setS('icmsSituacao', e.target.value)} />
                <Input label="CST PIS/COFINS" value={f.settings.pisCofinsSituacao ?? ''} onChange={(e) => setS('pisCofinsSituacao', e.target.value)} />
                {f.provider === 'nuvemfiscal' && <Input label="Próximo nº da NF-e (produção)" type="number" min={1} value={f.next_nfe_producao ?? 1} onChange={(e) => setF({ ...f, next_nfe_producao: +e.target.value || 1 })} />}
              </div>
            </div>
          )}
          <p className="text-xs text-ink-faint">Confirme estes códigos com o seu contador — eles mudam conforme o município, o estado e a atividade.</p>
        </div>
      )}
    </Modal>
  );
}
