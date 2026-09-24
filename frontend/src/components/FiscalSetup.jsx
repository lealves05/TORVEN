// Assistente de configuração fiscal: empresa → conta Focus → certificado → tributação → teste → produção.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CheckCircle2, Circle, AlertTriangle, KeyRound, FileKey2, Building2, Calculator, FlaskConical, Rocket, RefreshCw,
  Upload, ExternalLink, Loader2, ShieldCheck, Plug, ChevronDown,
} from 'lucide-react';
import { api } from '../lib/api';
import { fmt, fmtDateTime, money, maskDoc, maskPhone, maskCep, lookupCep, INVOICE_STATUS } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import { Input, Select, Toggle, Loading, useAction, FAIL, cx } from './ui';
import CustomerPicker from './CustomerPicker';

const ICONS = { empresa: Building2, conta: KeyRound, certificado: FileKey2, tributacao: Calculator, teste: FlaskConical, producao: Rocket };

export default function FiscalSetup() {
  const [status, setStatus] = useState(null);
  const [fiscal, setFiscal] = useState(null);
  const [open, setOpen] = useState(null);
  const load = useCallback(async () => {
    const [s, f] = await Promise.all([api.get('/company/fiscal/status'), api.get('/company/fiscal')]);
    setStatus(s); setFiscal(f);
    setOpen((cur) => cur || s.steps.find((x) => !x.ok)?.key || 'tributacao');
  }, []);
  useEffect(() => { load(); }, [load]);
  if (!status || !fiscal) return <Loading />;

  const done = status.steps.filter((s) => s.ok).length;
  const cert = status.certificate;
  return (
    <div className="max-w-4xl space-y-4 pb-10">
      <div className="card p-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-full bg-primary/10 text-primary"><ShieldCheck className="h-5 w-5" /></div>
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold">Configuração fiscal — Focus NFe</h3>
            <p className="text-sm text-ink-faint">Siga as etapas na ordem. O certificado vai direto para a Focus NFe e não fica guardado no TORVEN.</p>
          </div>
          <span className={cx('chip', status.provider !== 'focus' ? 'bg-muted text-ink-soft' : status.environment === 'producao' ? 'bg-emerald-500/15 text-emerald-700' : 'bg-amber-500/15 text-amber-700')}>
            {status.provider !== 'focus' ? 'Documento interno' : status.environment === 'producao' ? 'Produção' : 'Homologação'}
          </span>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(done / 6) * 100}%` }} /></div>
          <span className="text-sm tabular-nums text-ink-soft">{done}/6</span>
        </div>
        {cert && (
          <div className={cx('mt-4 flex items-center gap-2 rounded-app-sm p-3 text-sm',
            cert.days_left < 0 ? 'bg-red-500/10 text-red-700 dark:text-red-300' : cert.days_left <= 30 ? 'bg-amber-500/10 text-amber-800 dark:text-amber-200' : 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-200')}>
            <FileKey2 className="h-4 w-4 shrink-0" />
            Certificado A1 {cert.cnpj && `(${maskDoc(cert.cnpj)})`} válido até <b>{fmt(cert.valid_until)}</b>
            {cert.days_left < 0 ? ' — VENCIDO' : ` — ${cert.days_left} dias`}{!cert.matches && ' · não pertence ao CNPJ da empresa'}
          </div>
        )}
      </div>

      <Section status={status} open={open} setOpen={setOpen} k="empresa" n={1} subtitle="CNPJ, inscrições e endereço conferidos"><CompanyStep status={status} fiscal={fiscal} onSaved={load} /></Section>
      <Section status={status} open={open} setOpen={setOpen} k="conta" n={2} subtitle={fiscal.has_account_token ? 'Token principal conectado' : 'Tokens informados manualmente'}><AccountStep fiscal={fiscal} onSaved={load} /></Section>
      <Section status={status} open={open} setOpen={setOpen} k="certificado" n={3} subtitle={status.focus_company_id ? `Empresa nº ${status.focus_company_id} na Focus · sincronizado ${status.synced_at ? fmtDateTime(status.synced_at) : ''}` : ''}>
        <CertificateStep status={status} fiscal={fiscal} onSaved={load} />
      </Section>
      <Section status={status} open={open} setOpen={setOpen} k="tributacao" n={4}><TaxStep status={status} fiscal={fiscal} onSaved={load} /></Section>
      <Section status={status} open={open} setOpen={setOpen} k="teste" n={5} subtitle="NFS-e/NF-e de teste autorizadas"><TestStep fiscal={fiscal} onChanged={load} /></Section>
      <Section status={status} open={open} setOpen={setOpen} k="producao" n={6} subtitle="Notas com validade fiscal"><ProductionStep status={status} fiscal={fiscal} onSaved={load} /></Section>
    </div>
  );
}

function Section({ status, open, setOpen, k, n, children, subtitle }) {
  const step = status.steps.find((s) => s.key === k);
  const Icon = ICONS[k];
  const isOpen = open === k;
  return (
    <section className={cx('card overflow-hidden', isOpen && 'ring-1 ring-primary/30')}>
      <button className="flex w-full items-center gap-3 px-5 py-4 text-left" onClick={() => setOpen(isOpen ? null : k)}>
        <span className={cx('grid h-9 w-9 shrink-0 place-items-center rounded-full', step.ok ? 'bg-emerald-500/15 text-emerald-600' : 'bg-muted text-ink-soft')}>
          {step.ok ? <CheckCircle2 className="h-5 w-5" /> : <Icon className="h-4 w-4" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{n}. {step.label}</span>
          <span className="block truncate text-xs text-ink-faint">{step.ok ? (subtitle || 'Concluído') : step.detail.join(' · ') || subtitle}</span>
        </span>
        <ChevronDown className={cx('h-4 w-4 text-ink-faint transition', isOpen && 'rotate-180')} />
      </button>
      {isOpen && <div className="border-t border-line px-5 py-5">{children}</div>}
    </section>
  );
}

// ---------------------------------------------------------------- 1. empresa
function CompanyStep({ status, fiscal, onSaved }) {
  const { company, setCompany } = useAuth();
  const [run, busy] = useAction();
  const [f, setF] = useState(() => ({ ...company }));
  const [x, setX] = useState({ simples: fiscal.simplesNacional ? String(fiscal.codigoOpcaoSimples) : 'normal', cnae: fiscal.cnae, docs: fiscal.docs, nfseMode: fiscal.nfseMode, cpfCnpjContabilidade: fiscal.cpfCnpjContabilidade });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const bad = new Set(status.problems.map((p) => p.field));
  const cls = (k) => (bad.has(k) ? '[&_input]:border-red-400' : '');
  const cep = async (v) => {
    const m = maskCep(v);
    setF((y) => ({ ...y, cep: m }));
    if (m.length === 9) { const a = await lookupCep(m); if (a) setF((y) => ({ ...y, ...a, street: a.street || y.street, district: a.district || y.district })); }
  };
  const save = async () => {
    const fields = ['name', 'trade_name', 'document', 'state_registration', 'municipal_registration', 'phone', 'email', 'cep', 'street', 'number', 'complement', 'district', 'city', 'uf', 'city_code'];
    const r = await run(async () => {
      const c = await api.put('/company', Object.fromEntries(fields.map((k) => [k, f[k] || null])));
      await api.put('/company/fiscal', {
        simplesNacional: x.simples !== 'normal', codigoOpcaoSimples: x.simples === 'normal' ? 3 : Number(x.simples),
        cnae: x.cnae || '', docs: x.docs, nfseMode: x.nfseMode, cpfCnpjContabilidade: x.cpfCnpjContabilidade || '',
      });
      return c;
    }, 'Dados fiscais salvos');
    if (r !== FAIL) { setCompany(r); onSaved(); }
  };
  return (
    <div className="space-y-5">
      {status.problems.length > 0 && (
        <div className="rounded-app-sm bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
          <b>Faltando:</b> {status.problems.map((p) => p.msg).join(' · ')}
        </div>
      )}
      <div>
        <span className="label">O que a empresa vai emitir</span>
        <div className="flex flex-wrap gap-2">
          {[['nfse', 'NFS-e (serviços de solda, serralheria, reparo)'], ['nfe', 'NF-e (venda de materiais e peças)']].map(([k, l]) => (
            <label key={k} className={cx('flex cursor-pointer items-center gap-2 rounded-app-sm border px-3 py-2 text-sm', x.docs[k] ? 'border-primary bg-primary/10 text-primary' : 'border-line')}>
              <input type="checkbox" checked={x.docs[k]} onChange={(e) => setX({ ...x, docs: { ...x.docs, [k]: e.target.checked } })} />{l}
            </label>
          ))}
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-6">
        <Input label="Razão social" value={f.name} onChange={set('name')} className={cx('sm:col-span-4', cls('name'))} />
        <Input label="CNPJ" value={f.document} onChange={(e) => setF({ ...f, document: maskDoc(e.target.value) })} className={cx('sm:col-span-2', cls('document'))} />
        <Input label="Nome fantasia" value={f.trade_name} onChange={set('trade_name')} className="sm:col-span-2" />
        <Input label="Inscrição estadual" value={f.state_registration} onChange={set('state_registration')} className={cx('sm:col-span-2', cls('state_registration'))} hint={x.docs.nfe ? 'Obrigatória para NF-e' : 'Opcional'} />
        <Input label="Inscrição municipal" value={f.municipal_registration} onChange={set('municipal_registration')} className={cx('sm:col-span-2', cls('municipal_registration'))} hint={x.docs.nfse ? 'Obrigatória para NFS-e' : 'Opcional'} />
        <Select label="Regime tributário" value={x.simples} onChange={(e) => setX({ ...x, simples: e.target.value })} className="sm:col-span-2">
          <option value="3">Simples Nacional (ME/EPP)</option><option value="2">MEI</option><option value="normal">Lucro presumido / real</option>
        </Select>
        <Input label="CNAE principal" value={x.cnae} onChange={(e) => setX({ ...x, cnae: e.target.value })} className="sm:col-span-2" placeholder="ex.: 3311-2/00" />
        <Input label="CPF/CNPJ do contador (opcional)" value={x.cpfCnpjContabilidade} onChange={(e) => setX({ ...x, cpfCnpjContabilidade: maskDoc(e.target.value) })} className="sm:col-span-2" />
        <Input label="E-mail" value={f.email} onChange={set('email')} className={cx('sm:col-span-3', cls('email'))} />
        <Input label="Telefone" value={f.phone} onChange={(e) => setF({ ...f, phone: maskPhone(e.target.value) })} className={cx('sm:col-span-3', cls('phone'))} />
        <Input label="CEP" value={f.cep} onChange={(e) => cep(e.target.value)} className={cx('sm:col-span-2', cls('cep'))} hint="Preenche endereço e código IBGE" />
        <Input label="Endereço" value={f.street} onChange={set('street')} className={cx('sm:col-span-3', cls('street'))} />
        <Input label="Número" value={f.number} onChange={set('number')} className={cx('sm:col-span-1', cls('street'))} />
        <Input label="Complemento" value={f.complement} onChange={set('complement')} className="sm:col-span-2" />
        <Input label="Bairro" value={f.district} onChange={set('district')} className={cx('sm:col-span-2', cls('street'))} />
        <Input label="Cidade" value={f.city} onChange={set('city')} className={cx('sm:col-span-1', cls('city'))} />
        <Input label="UF" value={f.uf} maxLength={2} onChange={(e) => setF({ ...f, uf: e.target.value.toUpperCase() })} className={cx('sm:col-span-1', cls('city'))} />
        <Input label="Código IBGE" value={f.city_code} onChange={set('city_code')} className={cx('sm:col-span-2', cls('city_code'))} />
        {x.docs.nfse && (
          <Select label="Padrão da NFS-e no seu município" value={x.nfseMode} onChange={(e) => setX({ ...x, nfseMode: e.target.value })} className="sm:col-span-4"
            hint="A maioria dos municípios já usa o emissor nacional (DPS). Se a prefeitura mantém webservice próprio, escolha municipal.">
            <option value="nacional">NFS-e padrão nacional (DPS / Sefin Nacional)</option><option value="municipal">NFS-e municipal (webservice da prefeitura)</option>
          </Select>
        )}
      </div>
      <div className="flex justify-end"><button className="btn-primary" disabled={busy} onClick={save}>Salvar dados fiscais</button></div>
    </div>
  );
}

// ---------------------------------------------------------------- 2. conta Focus
function AccountStep({ fiscal, onSaved }) {
  const [run, busy] = useAction();
  const { toast } = useUI();
  const [token, setToken] = useState(fiscal.account_token || '');
  const [manual, setManual] = useState(!fiscal.has_account_token && (fiscal.has_token_homologacao || fiscal.has_token_producao));
  const [tk, setTk] = useState({ token_homologacao: fiscal.token_homologacao, token_producao: fiscal.token_producao });
  const connect = async () => {
    const r = await run(() => api.post('/company/fiscal/account', { account_token: token }));
    if (r !== FAIL) { toast(r.message); onSaved(); }
  };
  const saveManual = async () => {
    const r = await run(() => api.put('/company/fiscal', { ...tk, provider: 'focus' }), 'Tokens salvos');
    if (r !== FAIL) onSaved();
  };
  return (
    <div className="space-y-5 text-sm">
      <ol className="list-decimal space-y-1 pl-5 text-ink-soft">
        <li>Crie ou acesse sua conta em <a href="https://app-v2.focusnfe.com.br" target="_blank" rel="noreferrer" className="text-primary">focusnfe.com.br <ExternalLink className="inline h-3 w-3" /></a> (há período de teste gratuito).</li>
        <li>No painel, abra <b>Minha conta › Token</b> e copie o <b>token principal da conta</b> (é diferente do token de cada empresa).</li>
        <li>Cole abaixo e clique em Conectar. Com ele o TORVEN cadastra a empresa e o certificado por você.</li>
      </ol>
      <div className="flex flex-wrap items-end gap-2">
        <Input label="Token principal da conta Focus NFe" value={token} onChange={(e) => setToken(e.target.value)} className="min-w-[280px] flex-1" placeholder="cole o token aqui" autoComplete="off" />
        <button className="btn-primary" disabled={busy || token.length < 10} onClick={connect}><Plug className="h-4 w-4" /> Conectar</button>
      </div>
      <div className="border-t border-line pt-4">
        <Toggle checked={manual} onChange={setManual} label="Prefiro cadastrar a empresa no painel da Focus e colar os tokens da empresa"
          hint="Use se o seu plano não liberar a API de empresas. Os tokens ficam em Empresas › (sua empresa) › Tokens." />
        {manual && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Input label="Token de homologação da empresa" value={tk.token_homologacao} onChange={(e) => setTk({ ...tk, token_homologacao: e.target.value })} autoComplete="off" />
            <Input label="Token de produção da empresa" value={tk.token_producao} onChange={(e) => setTk({ ...tk, token_producao: e.target.value })} autoComplete="off" />
            <div className="sm:col-span-2 flex justify-end"><button className="btn-outline" disabled={busy} onClick={saveManual}>Salvar tokens</button></div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 3. certificado + cadastro
const toBase64 = (file) => new Promise((ok, err) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).replace(/^data:[^,]*,/, ''));
  r.onerror = err;
  r.readAsDataURL(file);
});

function CertificateStep({ status, fiscal, onSaved }) {
  const [run, busy] = useAction();
  const { toast } = useUI();
  const [file, setFile] = useState(null);
  const [pw, setPw] = useState('');
  const [more, setMore] = useState({ municipal_login: '', municipal_password: '', responsible_name: '', responsible_cpf: '', next_nfe_number: '', next_dps_number: '' });
  const [adv, setAdv] = useState(false);
  const registered = !!status.focus_company_id;
  if (!fiscal.has_account_token) {
    return (
      <div className="text-sm text-ink-soft">
        {fiscal.has_token_homologacao
          ? <>Você está usando tokens informados manualmente: o certificado e o cadastro da empresa são feitos no painel da Focus NFe. Para o TORVEN fazer isso por você, conecte o token principal da conta na etapa 2.</>
          : <>Conecte a conta Focus na etapa 2 para enviar o certificado e cadastrar a empresa.</>}
      </div>
    );
  }
  const send = async (dry) => {
    const body = {
      ...(file ? { certificate_base64: await toBase64(file), certificate_password: pw } : {}),
      ...Object.fromEntries(Object.entries(more).filter(([, v]) => v !== '')), dry_run: dry,
    };
    const r = await run(() => api.post('/company/fiscal/register', body));
    if (r !== FAIL) { toast(r.message); if (!dry) { setFile(null); setPw(''); onSaved(); } }
  };
  const sync = async () => { if ((await run(() => api.post('/company/fiscal/sync'), 'Dados atualizados da Focus')) !== FAIL) onSaved(); };
  const municipal = fiscal.docs?.nfse && fiscal.nfseMode === 'municipal';
  return (
    <div className="space-y-5 text-sm">
      {registered && (
        <div className="flex flex-wrap items-center gap-3 rounded-app-sm bg-muted/60 p-3">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          <span className="flex-1">Empresa cadastrada na Focus (nº {status.focus_company_id}). Tokens de homologação e produção importados.
            {status.focus_flags && <span className="block text-xs text-ink-faint">Habilitado: {[status.focus_flags.nfe && 'NF-e', status.focus_flags.nfse && 'NFS-e municipal', status.focus_flags.nfsen_producao && 'NFS-e nacional'].filter(Boolean).join(', ') || '—'}</span>}
          </span>
          <button className="btn-outline h-8 text-xs" disabled={busy} onClick={sync}><RefreshCw className="h-3.5 w-3.5" /> Sincronizar</button>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="label">Certificado digital A1 (.pfx ou .p12){registered && ' — só para trocar/renovar'}</span>
          <span className="flex h-[var(--row)] cursor-pointer items-center gap-2 rounded-app-sm border border-dashed border-line px-3 hover:border-primary">
            <Upload className="h-4 w-4 text-ink-faint" /><span className="truncate">{file ? file.name : 'Selecionar arquivo…'}</span>
            <input type="file" accept=".pfx,.p12,application/x-pkcs12" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </span>
        </label>
        <Input label="Senha do certificado" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
      </div>
      {municipal && (
        <div className="grid gap-4 rounded-app-sm border border-line p-3 sm:grid-cols-2">
          <p className="text-xs text-ink-faint sm:col-span-2">Alguns municípios exigem usuário e senha do portal da prefeitura para emitir NFS-e.</p>
          <Input label="Login no portal da prefeitura" value={more.municipal_login} onChange={(e) => setMore({ ...more, municipal_login: e.target.value })} />
          <Input label="Senha do portal" type="password" value={more.municipal_password} onChange={(e) => setMore({ ...more, municipal_password: e.target.value })} autoComplete="new-password" />
        </div>
      )}
      <button className="btn-ghost h-8 px-0 text-xs text-primary" onClick={() => setAdv(!adv)}>{adv ? 'Ocultar' : 'Já emitia notas por outro sistema? Ajustar numeração e responsável'}</button>
      {adv && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Próximo nº da NF-e (produção)" type="number" min={1} value={more.next_nfe_number} onChange={(e) => setMore({ ...more, next_nfe_number: e.target.value })} hint="Continuação da numeração do sistema anterior" />
          <Input label="Próximo nº da DPS / NFS-e (produção)" type="number" min={1} value={more.next_dps_number} onChange={(e) => setMore({ ...more, next_dps_number: e.target.value })} />
          <Input label="Nome do responsável" value={more.responsible_name} onChange={(e) => setMore({ ...more, responsible_name: e.target.value })} />
          <Input label="CPF do responsável" value={more.responsible_cpf} onChange={(e) => setMore({ ...more, responsible_cpf: maskDoc(e.target.value) })} />
        </div>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <button className="btn-outline" disabled={busy || (!registered && (!file || !pw))} onClick={() => send(true)}>Validar sem gravar</button>
        <button className="btn-primary" disabled={busy || (!registered && (!file || !pw)) || (file && !pw)} onClick={() => send(false)}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileKey2 className="h-4 w-4" />} {registered ? 'Atualizar cadastro na Focus' : 'Cadastrar empresa na Focus'}
        </button>
      </div>
      <p className="text-xs text-ink-faint">O arquivo e a senha do certificado são enviados diretamente à Focus NFe por conexão segura e não ficam armazenados no TORVEN. Os dados da empresa (etapa 1) e a logo em PNG também são enviados.</p>
    </div>
  );
}

// ---------------------------------------------------------------- 4. tributação
function TaxStep({ status, fiscal, onSaved }) {
  const [run, busy] = useAction();
  const [f, setF] = useState(fiscal);
  const set = (k) => (e) => setF({ ...f, [k]: e?.target ? (e.target.type === 'number' ? +e.target.value : e.target.value) : e });
  const save = async () => {
    const keys = ['issRate', 'issRetido', 'itemListaServico', 'codigoTributacaoNacional', 'codigoTributarioMunicipio', 'regimeEspecial',
      'naturezaOperacao', 'cfopDentro', 'cfopFora', 'icmsSituacao', 'pisCofinsSituacao', 'serieNfe', 'serieDps', 'nextDpsNumber', 'nextDpsNumberHomologacao'];
    const r = await run(() => api.put('/company/fiscal', Object.fromEntries(keys.map((k) => [k, f[k]]))), 'Tributação salva');
    if (r !== FAIL) onSaved();
  };
  return (
    <div className="space-y-6 text-sm">
      {fiscal.docs?.nfse && (
        <div className="space-y-3">
          <h4 className="font-semibold">NFS-e — serviços</h4>
          <div className="grid gap-3 sm:grid-cols-3">
            <Input label="Item LC 116 padrão" value={f.itemListaServico} onChange={set('itemListaServico')} hint="14.01 conserto/manutenção · 14.13 serralheria" />
            {fiscal.nfseMode === 'nacional' && <Input label="Código de tributação nacional" value={f.codigoTributacaoNacional} onChange={set('codigoTributacaoNacional')} hint="6 dígitos, ex.: 140101" />}
            <Input label="Código tributário municipal" value={f.codigoTributarioMunicipio} onChange={set('codigoTributarioMunicipio')} hint="Se a prefeitura exigir" />
            <Input label="Alíquota do ISS (%)" type="number" step="0.01" value={f.issRate} onChange={set('issRate')} />
            <Select label="Regime especial" value={f.regimeEspecial} onChange={(e) => setF({ ...f, regimeEspecial: +e.target.value })}>
              <option value={0}>Nenhum</option><option value={1}>Ato cooperado</option><option value={2}>Estimativa</option><option value={3}>Microempresa municipal</option>
              <option value={4}>Notário/registrador</option><option value={5}>Profissional autônomo</option><option value={6}>Sociedade de profissionais</option>
            </Select>
            {fiscal.nfseMode === 'nacional' && <Input label="Série / próximo nº DPS (produção)" type="number" min={1} value={f.nextDpsNumber} onChange={set('nextDpsNumber')} hint={`série ${f.serieDps} · homologação: ${f.nextDpsNumberHomologacao}`} />}
          </div>
          <Toggle checked={f.issRetido} onChange={set('issRetido')} label="ISS retido pelo tomador" hint="Normalmente não. Marque se seus clientes PJ retêm o ISS na fonte." />
          {status.services.missing > 0 && <p className="text-xs text-ink-faint">{status.services.missing} serviço(s) sem item LC 116 próprio — usam o padrão acima. <Link to="/servicos" className="text-primary">Revisar serviços</Link></p>}
        </div>
      )}
      {fiscal.docs?.nfe && (
        <div className="space-y-3">
          <h4 className="font-semibold">NF-e — materiais</h4>
          <div className="grid gap-3 sm:grid-cols-3">
            <Input label="Natureza da operação" value={f.naturezaOperacao} onChange={set('naturezaOperacao')} className="sm:col-span-3" />
            <Input label="CFOP dentro do estado" value={f.cfopDentro} onChange={set('cfopDentro')} hint="5102 revenda · 5101 produção própria" />
            <Input label="CFOP fora do estado" value={f.cfopFora} onChange={set('cfopFora')} hint="6102 · 6101" />
            <Input label="Série da NF-e" type="number" value={f.serieNfe} onChange={set('serieNfe')} />
            <Input label={fiscal.simplesNacional ? 'CSOSN' : 'CST ICMS'} value={f.icmsSituacao} onChange={set('icmsSituacao')} hint={fiscal.simplesNacional ? '102 tributada sem crédito' : '00 tributada integralmente'} />
            <Input label="CST PIS/COFINS" value={f.pisCofinsSituacao} onChange={set('pisCofinsSituacao')} hint={fiscal.simplesNacional ? '07 / 99 no Simples' : ''} />
          </div>
          {status.materials.missing > 0 && (
            <div className="flex items-center gap-2 rounded-app-sm bg-amber-500/10 p-3 text-amber-800 dark:text-amber-200">
              <AlertTriangle className="h-4 w-4 shrink-0" /> {status.materials.missing} de {status.materials.total} materiais sem NCM não poderão sair em NF-e. <Link to="/estoque" className="font-medium underline">Completar NCM</Link>
            </div>
          )}
        </div>
      )}
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-ink-faint">Confirme estes códigos com o seu contador — eles variam por município, estado e atividade.</p>
        <button className="btn-primary" disabled={busy} onClick={save}>Salvar tributação</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 5. testes em homologação
function TestStep({ fiscal, onChanged }) {
  const [run, busy] = useAction();
  const { toast } = useUI();
  const [customer, setCustomer] = useState(null);
  const [conn, setConn] = useState(null);
  const [tests, setTests] = useState([]);
  const [waiting, setWaiting] = useState(false);
  const loadTests = useCallback(() => api.get('/invoices?limit=20').then((l) => setTests(l.filter((i) => i.environment === 'homologacao' && i.provider === 'focus').slice(0, 6))), []);
  useEffect(() => { loadTests(); }, [loadTests]);
  const testConn = async () => { const r = await run(() => api.post('/company/fiscal/test-connection')); if (r !== FAIL) setConn(r); };
  const emit = async (kind) => {
    const r = await run(() => api.post('/company/fiscal/test-invoice', { kind, customer_id: customer?.id }));
    if (r === FAIL) return;
    setWaiting(true);
    let inv = r;
    for (let i = 0; i < 8 && inv.status === 'processando'; i++) {
      await new Promise((ok) => setTimeout(ok, 2500));
      try { inv = await api.post(`/invoices/${r.id}/refresh`); } catch { break; }
    }
    setWaiting(false);
    toast(inv.status === 'autorizada' ? `${kind === 'nfe' ? 'NF-e' : 'NFS-e'} de teste autorizada!` : `Situação: ${INVOICE_STATUS[inv.status]?.label} — ${inv.message || ''}`, inv.status === 'autorizada' ? 'success' : 'error');
    loadTests(); onChanged();
  };
  const refresh = async (i) => { if ((await run(() => api.post(`/invoices/${i.id}/refresh`))) !== FAIL) { loadTests(); onChanged(); } };
  if (!fiscal.has_token_homologacao) return <p className="text-sm text-ink-soft">Conclua as etapas 2 e 3 para receber o token de homologação.</p>;
  return (
    <div className="space-y-5 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-outline" disabled={busy} onClick={testConn}><Plug className="h-4 w-4" /> Testar conexão</button>
        {conn && ['homologacao', 'producao'].map((env) => (
          <span key={env} className={cx('chip', conn[env].ok ? 'bg-emerald-500/15 text-emerald-700' : 'bg-red-500/10 text-red-700')}>
            {env === 'producao' ? 'Produção' : 'Homologação'}: {conn[env].message}
          </span>
        ))}
      </div>
      <div className="rounded-app-sm border border-line p-4">
        <p className="mb-3 text-ink-soft">Emita notas de <b>teste</b> (R$ 1,00, sem valor fiscal) no ambiente de homologação. Use um cliente com CPF/CNPJ e endereço completos.</p>
        <CustomerPicker value={customer} onChange={setCustomer} label="Tomador / destinatário do teste" />
        <div className="mt-3 flex flex-wrap gap-2">
          {fiscal.docs?.nfse && <button className="btn-primary" disabled={busy || waiting || !customer} onClick={() => emit('nfse')}><FlaskConical className="h-4 w-4" /> Emitir NFS-e de teste</button>}
          {fiscal.docs?.nfe && <button className="btn-primary" disabled={busy || waiting || !customer} onClick={() => emit('nfe')}><FlaskConical className="h-4 w-4" /> Emitir NF-e de teste</button>}
          {waiting && <span className="flex items-center gap-2 text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" /> Aguardando a prefeitura/SEFAZ…</span>}
        </div>
      </div>
      {tests.length > 0 && (
        <ul className="divide-y divide-line rounded-app-sm border border-line">
          {tests.map((i) => (
            <li key={i.id} className="flex items-center gap-3 px-3 py-2">
              <span className="w-12 text-xs font-medium uppercase">{i.kind === 'nfe' ? 'NF-e' : 'NFS-e'}</span>
              <span className="min-w-0 flex-1 truncate">{i.number ? `nº ${i.number}` : '—'} · {money(i.amount)} · {fmtDateTime(i.created_at)}
                {i.status === 'erro' && <span className="block truncate text-xs text-red-600" title={i.message}>{i.message}</span>}</span>
              <span className={cx('chip', INVOICE_STATUS[i.status]?.cls)}>{INVOICE_STATUS[i.status]?.label}</span>
              {i.status === 'processando' && <button className="btn-ghost btn-icon h-7" onClick={() => refresh(i)}><RefreshCw className="h-3.5 w-3.5" /></button>}
              {i.pdf_url && <a className="btn-ghost btn-icon h-7" href={i.pdf_url} target="_blank" rel="noreferrer"><ExternalLink className="h-3.5 w-3.5" /></a>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- 6. produção
function ProductionStep({ status, fiscal, onSaved }) {
  const [run, busy] = useAction();
  const { confirm } = useUI();
  const { refresh } = useAuth();
  const set = async (env) => {
    if (env === 'producao') {
      const warn = status.ready_for_production ? 'A partir de agora as notas emitidas terão validade fiscal.' : 'Ainda há etapas pendentes no checklist. As notas em produção têm validade fiscal e podem ser rejeitadas se a configuração estiver incompleta.';
      if (!(await confirm({ title: 'Ativar emissão em produção?', message: warn, confirmText: 'Ativar produção', danger: !status.ready_for_production }))) return;
    }
    const r = await run(() => api.put('/company/fiscal', { environment: env, provider: 'focus' }), env === 'producao' ? 'Emissão em produção ativada' : 'Voltou para homologação');
    if (r !== FAIL) { onSaved(); refresh(); }
  };
  const prod = fiscal.provider === 'focus' && fiscal.environment === 'producao';
  return (
    <div className="space-y-4 text-sm">
      <div className="space-y-1.5">
        {status.steps.slice(0, 5).map((s) => (
          <div key={s.key} className="flex items-center gap-2">{s.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Circle className="h-4 w-4 text-ink-faint" />}<span className={cx(!s.ok && 'text-ink-soft')}>{s.label}</span></div>
        ))}
      </div>
      {prod ? (
        <div className="flex flex-wrap items-center gap-3 rounded-app-sm bg-emerald-500/10 p-3 text-emerald-800 dark:text-emerald-200">
          <Rocket className="h-4 w-4" /> <span className="flex-1">Emitindo em <b>produção</b>. As notas das OS e vendas têm validade fiscal.</span>
          <button className="btn-outline h-8 text-xs" disabled={busy} onClick={() => set('homologacao')}>Voltar para homologação</button>
        </div>
      ) : (
        <div className="flex justify-end">
          <button className="btn-primary" disabled={busy || !fiscal.has_token_producao} onClick={() => set('producao')}><Rocket className="h-4 w-4" /> Ativar emissão em produção</button>
        </div>
      )}
      {fiscal.provider === 'focus' && <p className="text-xs text-ink-faint">Para desligar a integração e voltar a gerar só documentos internos, use o botão abaixo.</p>}
      {fiscal.provider === 'focus' && <DisableFocus onDone={() => { onSaved(); refresh(); }} />}
    </div>
  );
}

function DisableFocus({ onDone }) {
  const [run, busy] = useAction();
  const { confirm } = useUI();
  const go = async () => {
    if (!(await confirm({ title: 'Desligar a integração com a Focus?', message: 'Os tokens continuam salvos; você pode religar depois.', confirmText: 'Desligar' }))) return;
    if ((await run(() => api.put('/company/fiscal', { provider: 'none' }), 'Integração desligada')) !== FAIL) onDone();
  };
  return <button className="btn-ghost h-8 text-xs text-red-600" disabled={busy} onClick={go}>Desligar integração fiscal</button>;
}
