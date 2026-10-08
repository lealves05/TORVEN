// Configurações › Integrações: serviço de consulta de placa e maquininhas de cartão.
// Os segredos (tokens/chaves) nunca voltam para a tela: só aparece se existem e o final mascarado.
import { useEffect, useState } from 'react';
import { Car, CreditCard, Save, FlaskConical, Plus, Trash2, Star, RefreshCw, ExternalLink, KeyRound } from 'lucide-react';
import { api } from '../lib/api';
import { useUI } from '../context/UIContext';
import { useAuth } from '../context/AuthContext';
import { Input, Select, Toggle, Modal, Loading, useAction, FAIL, cx } from './ui';
import WhatsAppSetup from './WhatsAppSetup';

const OPTION_LABEL = {
  no_ticket: 'Não imprimir', ticket: 'Imprimir', seller: 'Por conta da empresa', buyer: 'Por conta do cliente',
  merchant: 'Por conta da empresa', issuer: 'Por conta do cliente (emissor)', sandbox: 'Testes (sandbox)', producao: 'Produção',
};

function ConfigFields({ fields, value, onChange }) {
  return fields.map((f) => (f.type === 'select' ? (
    <Select key={f.key} label={f.label} value={value[f.key] ?? f.default ?? ''} onChange={(e) => onChange({ ...value, [f.key]: e.target.value })}>
      {f.options.map((o) => <option key={o} value={o}>{OPTION_LABEL[o] || o}</option>)}
    </Select>
  ) : (
    <Input key={f.key} label={`${f.label}${f.required ? ' *' : ''}`} placeholder={f.placeholder} type={f.type === 'number' ? 'number' : 'text'}
      min={f.min} max={f.max} step={f.step} value={value[f.key] ?? (f.type === 'number' ? f.default ?? '' : '')}
      onChange={(e) => onChange({ ...value, [f.key]: f.type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value })} />
  )));
}

/** Campos de segredo: vazio mantém o atual; "remover" apaga. Nada do valor salvo é exibido. */
function SecretFields({ fields, saved, value, onChange }) {
  return fields.map((f) => {
    const s = saved?.[f.key];
    const removing = value[f.key] === null;
    return (
      <div key={f.key} className="relative">
        <Input label={<span className="inline-flex items-center gap-1"><KeyRound className="h-3 w-3" /> {f.label}</span>} type="password" autoComplete="new-password"
          placeholder={removing ? 'será removido ao salvar' : s?.set ? `configurado (${s.hint}) — deixe vazio para manter` : 'cole aqui'}
          value={removing ? '' : value[f.key] || ''} disabled={removing}
          onChange={(e) => onChange({ ...value, [f.key]: e.target.value })} />
        {s?.set && (
          <button type="button" className="absolute right-0 top-0 text-xs text-ink-faint hover:text-red-600"
            onClick={() => { const v = { ...value }; if (removing) delete v[f.key]; else v[f.key] = null; onChange(v); }}>
            {removing ? 'desfazer' : 'remover'}
          </button>
        )}
      </div>
    );
  });
}

const cleanSecrets = (v) => Object.fromEntries(Object.entries(v).filter(([, x]) => x === null || String(x).trim()));

// ---------------- Consulta de placa ----------------
function PlateService() {
  const { toast } = useUI();
  const [run, busy] = useAction();
  const [data, setData] = useState(null);
  const [sel, setSel] = useState('');
  const [form, setForm] = useState(null);
  const [testPlate, setTestPlate] = useState('');
  const [testOut, setTestOut] = useState(null);

  const load = () => api.get('/integrations/plates').then((d) => {
    setData(d);
    setSel((cur) => cur || d.active?.provider || d.providers[0]?.id);
  }).catch((e) => toast(e.message, 'error'));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!data || !sel) return;
    const c = data.configs.find((x) => x.provider === sel);
    setForm({ enabled: c ? c.enabled : false, config: c?.config || {}, secrets: {} });
    setTestOut(null);
  }, [data, sel]);

  if (!data || !form) return <Loading />;
  const p = data.providers.find((x) => x.id === sel);
  const saved = data.configs.find((x) => x.provider === sel);

  const save = async () => {
    const r = await run(() => api.put(`/integrations/plates/${sel}`, { ...form, secrets: cleanSecrets(form.secrets) }), 'Serviço de consulta salvo');
    if (r !== FAIL) load();
  };
  const test = async () => {
    setTestOut(null);
    const r = await run(() => api.post(`/integrations/plates/${sel}/test`, { plate: testPlate }));
    if (r !== FAIL) { setTestOut(r); load(); }
  };

  return (
    <div className="card space-y-4 p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 font-semibold"><Car className="h-4 w-4 text-primary" /> Consulta de placa</h3>
          <p className="text-xs text-ink-faint">Busca marca, modelo, ano e cor quando a placa não está cadastrada. Serviço pago, contratado pela empresa.</p>
          <p className="mt-1 text-xs text-emerald-700">Sem serviço pago, o cadastro do veículo usa a <b>Tabela FIPE</b> grátis: escolha marca, modelo e ano numa lista (já vem ligada, não precisa configurar).</p>
        </div>
        <span className={cx('chip', data.active ? 'bg-emerald-500/10 text-emerald-700' : 'bg-muted text-ink-soft')}>{data.active ? `Ativo: ${data.active.name}` : 'Desligado'}</span>
      </div>
      <Select label="Serviço" value={sel} onChange={(e) => setSel(e.target.value)}>
        {data.providers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
      </Select>
      {p.help && <p className="text-sm text-ink-soft">{p.help}{p.site && <> <a className="inline-flex items-center gap-1 text-primary" href={p.site} target="_blank" rel="noreferrer noopener">site <ExternalLink className="h-3 w-3" /></a></>}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <ConfigFields fields={p.fields} value={form.config} onChange={(config) => setForm({ ...form, config })} />
        <SecretFields fields={p.secrets} saved={saved?.secrets} value={form.secrets} onChange={(secrets) => setForm({ ...form, secrets })} />
      </div>
      <div className="grid gap-3 rounded-app-sm border border-line p-3 sm:grid-cols-3">
        <ConfigFields fields={data.common} value={form.config} onChange={(config) => setForm({ ...form, config })} />
      </div>
      <p className="text-xs text-ink-faint">
        Este mês: {data.month?.ok ?? 0} consulta(s) com resultado de {data.month?.total ?? 0}
        {form.config.price > 0 && <> · estimado R$ {((data.month?.total ?? 0) * form.config.price).toFixed(2).replace('.', ',')}</>}.
        Consultas repetidas da mesma placa usam o resultado guardado. Dados do proprietário não são consultados (LGPD).
      </p>
      <Toggle checked={form.enabled} onChange={(v) => setForm({ ...form, enabled: v })} label="Usar este serviço"
        hint="Só um serviço de placa fica ativo por vez: ativar este desliga o outro." />
      <div className="flex flex-wrap items-end gap-2 border-t border-line pt-4">
        <button className="btn-primary" disabled={busy} onClick={save}><Save className="h-4 w-4" /> Salvar</button>
        <Input label="Placa para teste" className="w-36" maxLength={8} value={testPlate} onChange={(e) => setTestPlate(e.target.value.toUpperCase())} />
        <button className="btn-outline" disabled={busy || !saved || testPlate.replace(/[^A-Z0-9]/gi, '').length !== 7} onClick={test}><FlaskConical className="h-4 w-4" /> Testar (conta 1 consulta)</button>
      </div>
      {testOut && (
        <div className={cx('rounded-app-sm p-3 text-sm', testOut.found ? 'bg-emerald-500/10' : 'bg-amber-500/10')}>
          {testOut.found
            ? <>Encontrado: <b>{[testOut.vehicle?.brand, testOut.vehicle?.model].filter(Boolean).join(' ')}</b> {testOut.vehicle?.model_year || testOut.vehicle?.year} {testOut.vehicle?.color}</>
            : testOut.message || 'Placa não encontrada no serviço.'}
        </div>
      )}
    </div>
  );
}

// ---------------- Maquininhas ----------------
function Terminals() {
  const { toast, confirm } = useUI();
  const [run, busy] = useAction();
  const [data, setData] = useState(null);
  const [sel, setSel] = useState('');
  const [form, setForm] = useState(null);
  const [dev, setDev] = useState(null);
  const [remote, setRemote] = useState(null);

  const load = () => api.get('/integrations/terminals').then((d) => {
    setData(d);
    setSel((cur) => cur || d.configs.find((c) => c.enabled)?.provider || d.providers[0]?.id);
  }).catch((e) => toast(e.message, 'error'));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!data || !sel) return;
    const c = data.configs.find((x) => x.provider === sel);
    setForm({ enabled: c ? c.enabled : false, config: c?.config || {}, secrets: {} });
    setRemote(null);
  }, [data, sel]);

  if (!data || !form) return <Loading />;
  const p = data.providers.find((x) => x.id === sel);
  const saved = data.configs.find((x) => x.provider === sel);
  const name = (id) => data.providers.find((x) => x.id === id)?.name || id;
  const enabledSet = new Set(data.configs.filter((c) => c.enabled).map((c) => c.provider));

  const save = async () => {
    const r = await run(() => api.put(`/integrations/terminals/${sel}`, { ...form, secrets: cleanSecrets(form.secrets) }), `${p.name} salvo`);
    if (r !== FAIL) load();
  };
  const listRemote = async () => {
    const r = await run(() => api.get(`/integrations/terminals/${sel}/devices`));
    if (r !== FAIL) setRemote(r);
  };
  const saveDev = async () => {
    const body = { provider: dev.provider, name: dev.name, external_id: dev.external_id || null, is_default: !!dev.is_default, active: true };
    const r = await run(() => (dev.id ? api.put(`/integrations/devices/${dev.id}`, body) : api.post('/integrations/devices', body)), 'Maquininha salva');
    if (r !== FAIL) { setDev(null); load(); }
  };
  const removeDev = async (d) => {
    if (!(await confirm({ title: 'Remover maquininha?', message: `${d.name} deixa de aparecer para cobrança. O histórico de cobranças é mantido.`, confirmText: 'Remover', danger: true }))) return;
    const r = await run(() => api.del(`/integrations/devices/${d.id}`), 'Maquininha removida');
    if (r !== FAIL) load();
  };

  return (
    <div className="card space-y-4 p-6">
      <div>
        <h3 className="flex items-center gap-2 font-semibold"><CreditCard className="h-4 w-4 text-primary" /> Maquininhas de cartão</h3>
        <p className="text-xs text-ink-faint">Ao fechar a OS, o valor é enviado para a maquininha e o pagamento é lançado quando o provedor confirmar.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {data.providers.map((x) => (
          <button key={x.id} type="button" onClick={() => setSel(x.id)}
            className={cx('btn border text-sm', sel === x.id ? 'border-primary bg-primary/10 text-primary' : 'border-line text-ink-soft')}>
            {x.name}
            {enabledSet.has(x.id) && <span className="h-2 w-2 rounded-full bg-emerald-500" title="Ativa" />}
            {!x.ready && <span className="text-[10px] uppercase text-ink-faint">em breve</span>}
          </button>
        ))}
      </div>
      {p.homologation && <p className="rounded-app-sm bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-200">Integração pronta, mas o provedor exige homologação/credenciamento da empresa antes de usar em produção. Teste com valores baixos.</p>}
      {!p.ready && <p className="rounded-app-sm bg-muted p-2 text-xs text-ink-soft">Estrutura preparada: as credenciais podem ser guardadas, mas o envio para esta maquininha ainda não está disponível.</p>}
      {p.help && <p className="text-sm text-ink-soft">{p.help}</p>}
      <p className="text-xs text-ink-faint">Formas aceitas por esta integração: {p.methods.map((m) => ({ credito: 'crédito', debito: 'débito', pix: 'Pix' }[m])).join(', ')}{p.mode === 'link' ? ' · cobra por link/QR code' : ' · envia o valor direto para a maquininha'}.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <ConfigFields fields={p.fields} value={form.config} onChange={(config) => setForm({ ...form, config })} />
        <SecretFields fields={p.secrets} saved={saved?.secrets} value={form.secrets} onChange={(secrets) => setForm({ ...form, secrets })} />
      </div>
      <Toggle checked={form.enabled} onChange={(v) => setForm({ ...form, enabled: v })} label={`Ativar ${p.name}`} hint="Várias maquininhas de provedores diferentes podem ficar ativas ao mesmo tempo." />
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary" disabled={busy} onClick={save}><Save className="h-4 w-4" /> Salvar {p.name}</button>
        {p.can_list_devices && saved && <button className="btn-outline" disabled={busy} onClick={listRemote}><RefreshCw className="h-4 w-4" /> Buscar maquininhas da conta</button>}
      </div>
      {remote && (
        <div className="space-y-1 rounded-app-sm border border-line p-3 text-sm">
          {remote.length === 0 && <p className="text-ink-soft">Nenhuma maquininha encontrada na conta.</p>}
          {remote.map((r) => (
            <div key={r.external_id} className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs">{r.external_id}{r.mode && <span className="ml-2 text-ink-faint">({r.mode})</span>}</span>
              <button className="btn-ghost text-xs" onClick={() => setDev({ provider: sel, name: `${p.name} ${data.devices.length + 1}`, external_id: r.external_id, is_default: data.devices.length === 0 })}>
                <Plus className="h-3 w-3" /> Cadastrar
              </button>
            </div>
          ))}
          {sel === 'mercadopago' && remote.some((r) => r.mode && r.mode !== 'PDV') && <p className="text-xs text-ink-faint">A maquininha precisa estar no modo PDV para receber valores do sistema.</p>}
        </div>
      )}

      <div className="border-t border-line pt-4">
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-sm font-semibold">Aparelhos cadastrados</h4>
          <button className="btn-outline text-sm" onClick={() => setDev({ provider: sel, name: '', external_id: '', is_default: data.devices.length === 0 })}><Plus className="h-4 w-4" /> Adicionar</button>
        </div>
        {data.devices.length === 0 ? <p className="text-sm text-ink-faint">Nenhum aparelho. Cadastre ao menos um e marque como padrão.</p> : (
          <ul className="divide-y divide-line">
            {data.devices.map((d) => (
              <li key={d.id} className="flex items-center gap-3 py-2 text-sm">
                {d.is_default ? <Star className="h-4 w-4 fill-amber-400 text-amber-400" aria-label="Padrão" /> : <span className="w-4" />}
                <span className="min-w-0 flex-1"><b>{d.name}</b> · {name(d.provider)}{d.external_id && <span className="ml-1 font-mono text-xs text-ink-faint">{d.external_id}</span>}
                  {!enabledSet.has(d.provider) && <span className="ml-2 text-xs text-amber-600">integração desligada</span>}</span>
                <button className="btn-ghost text-xs" onClick={() => setDev({ ...d })}>Editar</button>
                <button className="btn-ghost btn-icon" aria-label={`Remover ${d.name}`} onClick={() => removeDev(d)}><Trash2 className="h-4 w-4" /></button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Modal open={!!dev} onClose={() => setDev(null)} size="sm" title={dev?.id ? 'Editar maquininha' : 'Nova maquininha'}
        footer={<><button className="btn-ghost" onClick={() => setDev(null)}>Voltar</button><button className="btn-primary" disabled={busy || !dev?.name?.trim()} onClick={saveDev}>Salvar</button></>}>
        {dev && (
          <div className="space-y-3">
            <Select label="Provedor" value={dev.provider} onChange={(e) => setDev({ ...dev, provider: e.target.value })}>
              {data.providers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </Select>
            <Input label="Nome (ex.: Balcão, Oficina)" value={dev.name} onChange={(e) => setDev({ ...dev, name: e.target.value })} />
            {data.providers.find((x) => x.id === dev.provider)?.terminalLabel && (
              <Input label={data.providers.find((x) => x.id === dev.provider).terminalLabel} value={dev.external_id || ''} onChange={(e) => setDev({ ...dev, external_id: e.target.value })} />
            )}
            <Toggle checked={!!dev.is_default} onChange={(v) => setDev({ ...dev, is_default: v })} label="Maquininha padrão" hint="Usada no envio automático ao fechar a OS." />
          </div>
        )}
      </Modal>
    </div>
  );
}

export default function IntegrationsSetup() {
  const { feature } = useAuth();
  // cada integração aparece só quando o plano inclui o módulo correspondente (a API também recusa)
  return (
    <div className="grid max-w-5xl gap-6 lg:grid-cols-2">
      {feature('whatsapp') && <WhatsAppSetup />}
      {feature('consulta_placa') && <PlateService />}
      {feature('maquininha') && <Terminals />}
    </div>
  );
}
