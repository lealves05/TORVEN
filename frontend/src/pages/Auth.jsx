import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardList, Wallet, Receipt, PackageCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import { Input, Toggle } from '../components/ui';
import { Logo } from '../components/Layout';

function Shell({ children }) {
  const features = [
    [ClipboardList, 'Ordens de serviço', 'Do recebimento à entrega, com quadro, prazos e garantia.'],
    [PackageCheck, 'Orçamentos e estoque', 'Orçamento aprovado pelo cliente vira OS e baixa o material.'],
    [Wallet, 'Caixa e contas', 'Fluxo de caixa, contas a pagar e receber, parcelas e comissões.'],
    [Receipt, 'Notas fiscais', 'NFS-e e NF-e direto da OS, integradas à Focus NFe.'],
  ];
  return (
    <div className="grid min-h-full lg:grid-cols-2">
      <div className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-sm animate-pop">
          <div className="mb-8"><Logo company={{ name: 'TORVEN' }} /></div>
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

export function Login() {
  const { login } = useAuth();
  const { toast } = useUI();
  const [f, setF] = useState({ email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { await login(f.email, f.password); } catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <Shell>
      <h1 className="text-2xl font-semibold tracking-tight">Bem-vindo de volta</h1>
      <p className="mt-1 text-sm text-ink-faint">Entre para gerenciar sua assistência técnica.</p>
      <form onSubmit={submit} className="mt-8 space-y-4">
        <Input label="E-mail" type="email" autoComplete="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <Input label="Senha" type="password" autoComplete="current-password" required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
      </form>
      <p className="mt-6 text-center text-sm text-ink-faint">
        Ainda não tem conta? <Link to="/cadastro" className="font-medium text-primary hover:underline">Cadastre sua empresa</Link>
      </p>
    </Shell>
  );
}

export function Register() {
  const { register } = useAuth();
  const { toast } = useUI();
  const [f, setF] = useState({ companyName: '', name: '', email: '', password: '', phone: '', demo: true });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { await register(f); toast('Empresa criada! Bem-vindo ao TORVEN.'); } catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <Shell>
      <h1 className="text-2xl font-semibold tracking-tight">Crie sua conta</h1>
      <p className="mt-1 text-sm text-ink-faint">Leva menos de um minuto.</p>
      <form onSubmit={submit} className="mt-8 space-y-4">
        <Input label="Nome da empresa" required value={f.companyName} onChange={set('companyName')} />
        <Input label="Seu nome" required value={f.name} onChange={set('name')} />
        <Input label="E-mail" type="email" required value={f.email} onChange={set('email')} />
        <Input label="Senha" type="password" minLength={6} required value={f.password} onChange={set('password')} hint="Mínimo de 6 caracteres" />
        <Toggle checked={f.demo} onChange={(demo) => setF({ ...f, demo })} label="Começar com dados de exemplo"
          hint="Técnicos, serviços, materiais, clientes e OS fictícias para explorar o sistema." />
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Criando…' : 'Criar minha empresa'}</button>
      </form>
      <p className="mt-6 text-center text-sm text-ink-faint">
        Já tem conta? <Link to="/entrar" className="font-medium text-primary hover:underline">Entrar</Link>
      </p>
    </Shell>
  );
}
