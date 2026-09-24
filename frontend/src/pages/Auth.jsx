import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ClipboardList, Wallet, Receipt, PackageCheck, Building2, PlayCircle, LogIn, Loader2, ArrowRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import { Input, cx } from '../components/ui';
import { Logo } from '../components/Layout';
import { maskPhone } from '../lib/format';

function Shell({ children }) {
  const features = [
    [ClipboardList, 'Ordens de serviço', 'Do recebimento à entrega, com quadro, prazos e garantia.'],
    [PackageCheck, 'Orçamentos e estoque', 'Orçamento aprovado pelo cliente vira OS e baixa o material.'],
    [Wallet, 'Caixa e contas', 'Fluxo de caixa, contas a pagar e receber, parcelas e comissões.'],
    [Receipt, 'Notas fiscais', 'NFS-e e NF-e direto da OS, integradas à Focus NFe.'],
  ];
  return (
    <div className="grid min-h-full lg:grid-cols-2">
      <div className="flex items-center justify-center p-5 sm:p-10">
        <div className="w-full max-w-md animate-pop">
          <div className="mb-6"><Logo company={{ name: 'TORVEN' }} /></div>
          {children}
        </div>
      </div>
      <div className="relative hidden overflow-hidden bg-primary lg:flex lg:items-center lg:justify-center">
        <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-white/10" />
        <div className="absolute -bottom-32 -left-16 h-[28rem] w-[28rem] rounded-full border-[40px] border-white/10" />
        <div className="relative max-w-md p-10 text-primary-fg">
          <h2 className="text-3xl font-semibold leading-tight">Sua oficina sob controle.<br />Da solda à nota fiscal.</h2>
          <div className="mt-10 space-y-6">
            {features.map(([Icon, t, d]) => (
              <div key={t} className="flex gap-4">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-app-sm bg-white/15"><Icon className="h-5 w-5" /></div>
                <div><div className="font-medium">{t}</div><div className="text-sm opacity-80">{d}</div></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ModeTabs({ mode }) {
  const tabs = [['/entrar', 'Entrar', LogIn], ['/cadastro', 'Cadastrar empresa', Building2]];
  return (
    <div className="mb-6 grid grid-cols-2 gap-1 rounded-app-sm bg-muted p-1">
      {tabs.map(([to, l, I]) => (
        <Link key={to} to={to} className={cx('flex items-center justify-center gap-2 rounded-[calc(var(--radius)*0.45)] px-3 py-2 text-sm font-medium transition',
          mode === to ? 'bg-surface text-ink shadow-soft' : 'text-ink-soft hover:text-ink')}>
          <I className="h-4 w-4" />{l}
        </Link>
      ))}
    </div>
  );
}

function DemoCard() {
  const { demo } = useAuth();
  const { toast } = useUI();
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    try { await demo(); toast('Demonstração pronta! Explore à vontade — nada aqui é real.'); } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <div className="mt-6 rounded-app border border-dashed border-primary/40 bg-primary/5 p-4">
      <div className="flex items-start gap-3">
        <PlayCircle className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">Quer só conhecer o sistema?</div>
          <p className="mt-0.5 text-xs text-ink-soft">Abra uma demonstração com OS, orçamentos, estoque e financeiro de exemplo, sem cadastro. Quando quiser, é só ativar o uso normal com os seus dados.</p>
          <button className="btn-outline mt-3 w-full border-primary/40 text-primary" disabled={busy} onClick={start}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />} {busy ? 'Preparando a demonstração…' : 'Experimentar a demonstração'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Login() {
  const { login } = useAuth();
  const { toast } = useUI();
  const loc = useLocation();
  const [f, setF] = useState({ email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { await login(f.email, f.password); } catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <Shell>
      <ModeTabs mode={loc.pathname} />
      <h1 className="text-2xl font-semibold tracking-tight">Bem-vindo de volta</h1>
      <p className="mt-1 text-sm text-ink-faint">Entre para gerenciar sua assistência técnica.</p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <Input label="E-mail" type="email" autoComplete="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <Input label="Senha" type="password" autoComplete="current-password" required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
      </form>
      <Link to="/cadastro" className="mt-4 flex items-center justify-center gap-1 text-sm font-medium text-primary hover:underline">
        Ainda não tem conta? Cadastre sua empresa <ArrowRight className="h-4 w-4" />
      </Link>
      <DemoCard />
    </Shell>
  );
}

export function Register() {
  const { register } = useAuth();
  const { toast } = useUI();
  const loc = useLocation();
  const nav = useNavigate();
  const [f, setF] = useState({ companyName: '', name: '', email: '', password: '', phone: '', demo: false });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { await register(f); toast('Empresa criada! Bem-vindo ao TORVEN.'); nav('/'); } catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <Shell>
      <ModeTabs mode={loc.pathname} />
      <h1 className="text-2xl font-semibold tracking-tight">Cadastre sua empresa</h1>
      <p className="mt-1 text-sm text-ink-faint">Leva menos de um minuto. Os dados fiscais você completa depois.</p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <Input label="Nome da empresa" required value={f.companyName} onChange={set('companyName')} placeholder="Ex.: Solda Forte Serralheria" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Seu nome" required value={f.name} onChange={set('name')} />
          <Input label="Telefone / WhatsApp" value={f.phone} onChange={(e) => setF({ ...f, phone: maskPhone(e.target.value) })} />
        </div>
        <Input label="E-mail (login)" type="email" required value={f.email} onChange={set('email')} />
        <Input label="Senha" type="password" minLength={6} required value={f.password} onChange={set('password')} hint="Mínimo de 6 caracteres" />
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={f.demo} onChange={(e) => setF({ ...f, demo: e.target.checked })} />
          <span>Começar com dados de exemplo<span className="block text-xs text-ink-faint">Técnicos, serviços, materiais e OS fictícias para aprender o sistema.</span></span>
        </label>
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Criando…' : 'Criar minha empresa'}</button>
      </form>
      <DemoCard />
    </Shell>
  );
}
