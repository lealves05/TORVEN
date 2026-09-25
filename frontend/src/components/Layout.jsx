import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, ClipboardList, FileText, Users, Wallet, BarChart3, Wrench, UserRound, Package, Settings,
  LogOut, Menu, X, Sun, Moon, BadgePercent, ChevronDown, Plus, ShoppingCart, Truck, PackagePlus, Receipt, HardHat,
  Inbox, Headset, Boxes, Landmark, FileSpreadsheet, ShieldCheck, Building2, ChevronsLeft, ChevronsRight, ChevronRight, Home,
} from 'lucide-react';
import { GlobalSearch, SearchButton, Notifications, useShortcuts } from './Workspace';
import { useAuth } from '../context/AuthContext';
import { ROLES } from '../lib/format';
import { cx, Avatar } from './ui';
import DemoBanner from './DemoBanner';
import { PRESET_COLORS } from '../lib/theme';

export function Mark({ className = 'h-5 w-5' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h16M12 7v13" />
      <path d="M15.5 3.5c1.2 1 1.6 2.1 1 3.5" opacity=".7" />
      <path d="M8.5 20h7" />
    </svg>
  );
}

export function Logo({ company, compact, light }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      {company?.logo_url
        ? <img src={company.logo_url} alt="" className="h-9 w-9 rounded-app-sm bg-white object-cover" />
        : <div className={cx('grid h-9 w-9 shrink-0 place-items-center rounded-app-sm', light ? 'bg-primary-fg/15 text-primary-fg' : 'bg-primary text-primary-fg')}>
            <Mark />
          </div>}
      {!compact && (
        <div className="min-w-0 leading-tight">
          <div className="max-w-[180px] truncate text-sm font-semibold">{company?.trade_name || company?.name || 'TORVEN'}</div>
          <div className={cx('whitespace-nowrap text-[11px]', light ? 'hidden opacity-70 2xl:block' : 'text-ink-faint')}>TORVEN · assistência técnica</div>
        </div>
      )}
    </div>
  );
}

/**
 * Menu agrupado conforme o perfil de acesso. Só entram telas que já funcionam de ponta a ponta;
 * módulos das próximas fases (agenda/produção, Torven Pay…) aparecem quando estiverem operacionais.
 */
export function useNav() {
  const { company, can, scope } = useAuth();
  const mods = company?.settings?.modules || {};
  const groups = [
    { label: 'Atendimento e comercial', icon: Headset, children: [
      can('requests_view', 'requests_manage') && { to: '/solicitacoes', label: 'Solicitações', icon: Inbox },
      can('quotes_view', 'quotes', 'quotes_approve') && { to: '/orcamentos', label: 'Orçamentos', icon: FileText },
      can('customers_view') && { to: '/clientes', label: 'Clientes e objetos', icon: Users },
    ] },
    { label: 'Ordens de serviço', icon: ClipboardList, children: [
      can('orders_view', 'orders_create') && { to: '/os', label: 'Ordens de serviço', icon: ClipboardList },
      can('orders_create') && can('checkout') && { to: '/venda', label: 'Venda de balcão', icon: ShoppingCart },
    ] },
    { label: 'Materiais', icon: Boxes, children: [
      can('materials_manage', 'purchases') && { to: '/estoque', label: 'Materiais e estoque', icon: Package, end: true },
      can('purchases') && mods.purchases && { to: '/estoque/entradas', label: 'Entrada de materiais', icon: PackagePlus },
      can('suppliers', 'purchases') && { to: '/fornecedores', label: 'Fornecedores', icon: Truck },
    ] },
    { label: 'Financeiro', icon: Landmark, children: [
      can('cash') && { to: '/financeiro', label: 'Caixa e contas', icon: Wallet },
      mods.commissions && scope('commissions') !== 'none' && { to: '/comissoes', label: 'Comissões', icon: BadgePercent },
    ] },
    { label: 'Fiscal', icon: Receipt, children: [
      can('invoices_issue', 'invoices_cancel') && mods.invoices && { to: '/notas', label: 'Documentos fiscais', icon: Receipt },
    ] },
    { label: 'Relatórios', icon: BarChart3, children: [
      can('reports') && { to: '/relatorios', label: 'Relatórios gerenciais', icon: FileSpreadsheet },
    ] },
    { label: 'Configurações', icon: Settings, children: [
      can('settings', 'users', 'fiscal_settings') && { to: '/configuracoes', label: 'Empresa e sistema', icon: Settings, end: true },
      can('units_manage', 'settings') && { to: '/configuracoes/unidades', label: 'Unidades', icon: Building2 },
      can('services_manage') && { to: '/servicos', label: 'Serviços e preços', icon: Wrench },
      can('technicians_manage') && { to: '/tecnicos', label: 'Técnicos', icon: HardHat },
      can('audit_view') && { to: '/auditoria', label: 'Logs e auditoria', icon: ShieldCheck },
    ] },
    { label: 'Minha Torven', icon: UserRound, children: [
      { to: '/conta', label: 'Minha conta e aparência', icon: UserRound },
    ] },
  ].map((g) => ({ ...g, children: g.children.filter(Boolean) })).filter((g) => g.children.length);
  return [{ to: '/', label: 'Início', icon: LayoutDashboard, end: true }, ...groups];
}

/** Trilha de navegação a partir do menu. */
function Breadcrumbs({ nav }) {
  const loc = useLocation();
  const path = loc.pathname;
  if (path === '/') return null;
  let group = null;
  let item = null;
  for (const n of nav) {
    for (const c of n.children || [n]) {
      const hit = c.to && (c.end ? path === c.to : path === c.to || path.startsWith(`${c.to}/`));
      if (hit && (!item || c.to.length > item.to.length)) { item = c; group = n.children ? n : null; }
    }
  }
  const rest = item ? path.slice(item.to.length).split('/').filter(Boolean) : [];
  const tail = rest.length ? (['novo', 'nova'].includes(rest[0]) ? 'Novo registro' : 'Detalhe') : null;
  return (
    <nav aria-label="Trilha" className="flex min-w-0 items-center gap-1 text-xs text-ink-faint">
      <Link to="/" className="shrink-0 hover:text-ink" title="Início"><Home className="h-3.5 w-3.5" /></Link>
      {group && <><ChevronRight className="h-3 w-3 shrink-0" /><span className="hidden truncate sm:inline">{group.label}</span></>}
      {item && <><ChevronRight className="hidden h-3 w-3 shrink-0 sm:inline" /><Link to={item.to} className="truncate hover:text-ink">{item.label}</Link></>}
      {tail && <><ChevronRight className="h-3 w-3 shrink-0" /><span className="truncate text-ink-soft">{tail}</span></>}
    </nav>
  );
}

function QuickActions({ light, collapsed }) {
  const { can } = useAuth();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const items = [
    can('requests_manage') && { label: 'Nova solicitação', icon: Inbox, to: '/solicitacoes/nova', key: 'Alt+S' },
    can('orders_create') && { label: 'Nova ordem de serviço', icon: ClipboardList, to: '/os/nova', key: 'Alt+O' },
    can('quotes') && { label: 'Novo orçamento', icon: FileText, to: '/orcamentos/novo', key: 'Alt+Q' },
    can('orders_create') && can('checkout') && { label: 'Venda de balcão', icon: ShoppingCart, to: '/venda' },
    can('purchases') && { label: 'Entrada de materiais', icon: PackagePlus, to: '/estoque/entradas/nova' },
  ].filter(Boolean);
  if (!items.length) return null;
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)}
        className={cx('btn h-9 gap-1.5 rounded-full px-3 text-xs', light ? 'bg-primary-fg text-primary hover:brightness-95' : 'bg-primary text-primary-fg')}>
        <Plus className="h-4 w-4" /><span className={cx('hidden sm:inline', collapsed && 'sm:hidden')}>Novo</span>
      </button>
      {open && (
        <div className="card animate-pop absolute right-0 top-full z-50 mt-2 w-64 p-1.5 text-sm text-ink">
          {items.map((i) => (
            <button key={i.to} onClick={() => { setOpen(false); nav(i.to); }} className="flex w-full items-center gap-2.5 rounded-app-sm px-3 py-2 text-left hover:bg-muted">
              <i.icon className="h-4 w-4 text-ink-faint" /><span className="flex-1">{i.label}</span>
              {i.key && <kbd className="hidden text-[10px] text-ink-faint sm:inline">{i.key}</kbd>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function UserMenu({ light, up }) {
  const { user, logout, savePrefs } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const dark = document.documentElement.classList.contains('dark');
  useEffect(() => {
    const h = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  return (
    <div ref={ref} className="relative">
      <button className={cx('flex w-full items-center gap-2.5 rounded-app-sm p-1.5 text-left', light ? 'hover:bg-primary-fg/10' : 'hover:bg-muted')} onClick={() => setOpen((o) => !o)}>
        <Avatar name={user.name} size="h-8 w-8" color={light ? 'rgb(var(--primary-fg) / 0.22)' : undefined} />
        <div className={cx('min-w-0 flex-1 leading-tight', light && 'hidden xl:block')}>
          <div className="max-w-[140px] truncate text-sm font-medium">{user.name}</div>
          <div className={cx('text-[11px]', light ? 'opacity-70' : 'text-ink-faint')}>{ROLES[user.role]}</div>
        </div>
        <ChevronDown className="h-4 w-4 opacity-60" />
      </button>
      {open && (
        <div className={cx('card animate-pop absolute z-50 w-56 p-1.5 text-sm text-ink', up ? 'bottom-full left-0 mb-2' : 'right-0 top-full mt-2')}>
          <NavLink to="/conta" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-app-sm px-3 py-2 hover:bg-muted">
            <UserRound className="h-4 w-4" /> Minha conta
          </NavLink>
          <button className="flex w-full items-center gap-2 rounded-app-sm px-3 py-2 hover:bg-muted" onClick={() => savePrefs({ theme: dark ? 'light' : 'dark' })}>
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />} Tema {dark ? 'claro' : 'escuro'}
          </button>
          <div className="px-3 pb-1 pt-2">
            <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-faint">Minha cor</div>
            <div className="grid grid-cols-6 gap-1.5">
              {PRESET_COLORS.slice(0, 11).map((c) => (
                <button key={c} title={c} onClick={() => savePrefs({ primaryColor: c })}
                  className={cx('h-6 w-6 rounded-full ring-offset-2 ring-offset-surface', user.preferences?.primaryColor === c && 'ring-2 ring-ink')} style={{ background: c }} />
              ))}
              <button title="Cor da empresa" onClick={() => savePrefs({ primaryColor: null })}
                className={cx('grid h-6 w-6 place-items-center rounded-full border border-dashed border-line text-[9px] text-ink-faint', !user.preferences?.primaryColor && 'ring-2 ring-ink ring-offset-2 ring-offset-surface')}>A</button>
            </div>
          </div>
          <button className="flex w-full items-center gap-2 rounded-app-sm px-3 py-2 text-red-600 hover:bg-muted" onClick={logout}>
            <LogOut className="h-4 w-4" /> Sair
          </button>
        </div>
      )}
    </div>
  );
}

function Dropdown({ item, light }) {
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const active = item.children.some((c) => (c.end ? loc.pathname === c.to : loc.pathname.startsWith(c.to)));
  useEffect(() => setOpen(false), [loc.pathname]);
  return (
    <div className="relative" onMouseLeave={() => setOpen(false)}>
      <button onClick={() => setOpen((o) => !o)} onMouseEnter={() => setOpen(true)}
        className={cx('flex h-14 items-center gap-2 whitespace-nowrap border-b-[3px] px-2.5 text-sm font-medium transition xl:px-3',
          active ? 'border-primary-fg text-primary-fg' : 'border-transparent text-primary-fg/80 hover:text-primary-fg', !light && 'text-ink')}>
        <item.icon className="h-[18px] w-[18px]" />{item.label}<ChevronDown className="h-3.5 w-3.5 opacity-70" />
      </button>
      {open && (
        <div className="card animate-pop absolute left-0 top-full z-50 w-52 p-1.5">
          {item.children.map((c) => (
            <NavLink key={c.to} to={c.to} end={c.end} className={({ isActive }) => cx('flex items-center gap-2.5 rounded-app-sm px-3 py-2 text-sm', isActive ? 'bg-primary/10 text-primary' : 'text-ink hover:bg-muted')}>
              <c.icon className="h-4 w-4" />{c.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

function MobileDrawer({ nav, onClose }) {
  const { company } = useAuth();
  return (
    <div className="fixed inset-0 z-40 bg-black/40 animate-fade" onClick={onClose}>
      <aside className="flex h-full w-72 flex-col bg-surface animate-pop" onClick={(e) => e.stopPropagation()}>
        <div className="flex h-16 items-center justify-between px-4"><Logo company={company} /><button className="btn-ghost btn-icon" onClick={onClose}><X className="h-4 w-4" /></button></div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
          {nav.flatMap((n) => (n.children ? [{ section: n.label }, ...n.children] : [n])).map((n, i) => (n.section
            ? <div key={i} className="px-3 pb-1 pt-4 text-[11px] font-medium uppercase tracking-wider text-ink-faint">{n.section}</div>
            : (
              <NavLink key={n.to} to={n.to} end={n.end} onClick={onClose}
                className={({ isActive }) => cx('flex items-center gap-3 rounded-app-sm px-3 py-2.5 text-sm font-medium', isActive ? 'bg-primary/10 text-primary' : 'text-ink-soft hover:bg-muted')}>
                <n.icon className="h-[18px] w-[18px]" />{n.label}
              </NavLink>
            )))}
        </nav>
        <div className="border-t border-line p-3"><UserMenu up /></div>
      </aside>
    </div>
  );
}

/** Layout com menu superior (opcional). */
function TopLayout() {
  const { company } = useAuth();
  const nav = useNav();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const wide = loc.pathname === '/os' && new URLSearchParams(loc.search).get('view') !== 'lista';
  return (
    <div className="flex h-full flex-col">
      <header className="sticky top-0 z-30 bg-primary text-primary-fg shadow-sm">
        <div className="flex h-14 items-center gap-2 px-3 sm:px-5">
          <button className="btn-icon h-9 rounded-app-sm hover:bg-primary-fg/10 lg:hidden" onClick={() => setOpen(true)} aria-label="Menu"><Menu className="h-5 w-5" /></button>
          <div className="shrink-0"><Logo company={company} light compact /></div>
          <nav className="ml-3 hidden h-14 items-stretch lg:flex">
            {nav.map((n) => (n.children ? <Dropdown key={n.label} item={n} light /> : (
              <NavLink key={n.to} to={n.to} end={n.end}
                className={({ isActive }) => cx('flex items-center gap-2 whitespace-nowrap border-b-[3px] px-2.5 text-sm font-medium transition xl:px-3',
                  isActive ? 'border-primary-fg text-primary-fg' : 'border-transparent text-primary-fg/80 hover:text-primary-fg')}>
                <n.icon className="h-[18px] w-[18px]" />{n.short || n.label}
              </NavLink>
            )))}
          </nav>
          <div className="ml-auto flex items-center gap-1.5"><SearchButton light /><Notifications light /><QuickActions light /><UserMenu light /></div>
        </div>
      </header>
      {open && <MobileDrawer nav={nav} onClose={() => setOpen(false)} />}
      <DemoBanner />
      <main key={loc.pathname} className="flex-1 overflow-y-auto">
        <div className={cx('mx-auto w-full p-4 animate-fade sm:p-6', wide ? 'max-w-none lg:px-6' : 'max-w-[1400px] lg:p-8')}>
          <div className="mb-3"><Breadcrumbs nav={nav} /></div>
          <Outlet />
        </div>
      </main>
    </div>
  );
}

const readCollapsed = () => { try { return localStorage.getItem('torven:sidebar') === '1'; } catch { return false; } };

/** Grupo do menu lateral: expande/recolhe; recolhido mostra só ícones com dica. */
function SideGroup({ item, collapsed }) {
  const loc = useLocation();
  const active = item.children.some((c) => (c.end ? loc.pathname === c.to : loc.pathname.startsWith(c.to)));
  const [open, setOpen] = useState(active);
  useEffect(() => { if (active) setOpen(true); }, [active]);
  if (collapsed) {
    return (
      <div className="space-y-0.5 border-t border-line/60 pt-1.5 first:border-0">
        {item.children.map((c) => <SideLink key={c.to} item={c} collapsed />)}
      </div>
    );
  }
  return (
    <div>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className={cx('flex w-full items-center gap-2 rounded-app-sm px-3 pb-1 pt-3 text-xs font-semibold', active ? 'text-primary' : 'text-ink-faint hover:text-ink-soft')}>
        <span className="flex-1 truncate text-left">{item.label}</span>
        <ChevronDown className={cx('h-3.5 w-3.5 transition', !open && '-rotate-90')} />
      </button>
      {open && <div className="space-y-0.5">{item.children.map((c) => <SideLink key={c.to} item={c} />)}</div>}
    </div>
  );
}

function SideLink({ item, collapsed }) {
  return (
    <NavLink to={item.to} end={item.end} title={collapsed ? item.label : undefined} aria-label={item.label}
      className={({ isActive }) => cx('group relative flex items-center gap-3 rounded-app-sm text-sm font-medium transition',
        collapsed ? 'h-10 justify-center' : 'px-3 py-2',
        isActive ? 'bg-primary/10 text-primary' : 'text-ink-soft hover:bg-muted hover:text-ink')}>
      <item.icon className="h-[18px] w-[18px] shrink-0" />
      {!collapsed && <span className="truncate">{item.label}</span>}
      {collapsed && (
        <span className="pointer-events-none absolute left-full z-50 ml-2 hidden whitespace-nowrap rounded-app-sm bg-ink px-2 py-1 text-xs text-surface shadow-lg group-hover:block group-focus-visible:block">
          {item.label}
        </span>
      )}
    </NavLink>
  );
}

/** Layout padrão: menu lateral recolhível com grupos, trilha, busca global e notificações. */
function SideLayout() {
  const { company } = useAuth();
  const nav = useNav();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const loc = useLocation();
  const toggle = () => setCollapsed((c) => { try { localStorage.setItem('torven:sidebar', c ? '0' : '1'); } catch { /* sem armazenamento */ } return !c; });
  const wide = loc.pathname === '/os' && new URLSearchParams(loc.search).get('view') !== 'lista';
  return (
    <div className="flex h-full">
      <aside className={cx('hidden h-full flex-col border-r border-line bg-surface transition-[width] duration-200 lg:flex', collapsed ? 'w-[68px]' : 'w-64')}>
        <div className={cx('flex h-14 items-center', collapsed ? 'justify-center' : 'px-4')}><Logo company={company} compact={collapsed} /></div>
        <nav className={cx('flex-1 space-y-0.5 overflow-y-auto py-2', collapsed ? 'overflow-x-visible px-2' : 'px-3')} aria-label="Menu principal">
          {nav.map((n) => (n.children ? <SideGroup key={n.label} item={n} collapsed={collapsed} /> : <SideLink key={n.to} item={n} collapsed={collapsed} />))}
        </nav>
        <div className="border-t border-line p-2">
          <button onClick={toggle} className="btn-ghost h-9 w-full justify-center gap-2 text-xs text-ink-faint" title={collapsed ? 'Expandir menu' : 'Recolher menu'}>
            {collapsed ? <ChevronsRight className="h-4 w-4" /> : <><ChevronsLeft className="h-4 w-4" /> Recolher menu</>}
          </button>
        </div>
      </aside>
      {open && <MobileDrawer nav={nav} onClose={() => setOpen(false)} />}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-surface/95 px-3 backdrop-blur sm:px-4">
          <button className="btn-ghost btn-icon lg:hidden" onClick={() => setOpen(true)} aria-label="Menu"><Menu className="h-5 w-5" /></button>
          <div className="lg:hidden"><Logo company={company} compact /></div>
          <div className="hidden min-w-0 flex-1 lg:block"><Breadcrumbs nav={nav} /></div>
          <div className="ml-auto flex items-center gap-1.5">
            <SearchButton />
            <Notifications />
            <QuickActions />
            <div className="hidden sm:block"><UserMenu /></div>
          </div>
        </header>
        <DemoBanner />
        <main key={loc.pathname} className="flex-1 overflow-y-auto">
          <div className={cx('mx-auto w-full p-4 animate-fade sm:p-6', wide ? 'max-w-none lg:px-6' : 'max-w-[1400px] lg:p-8')}>
            <div className="mb-3 lg:hidden"><Breadcrumbs nav={nav} /></div>
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

export default function Layout() {
  const { user, company } = useAuth();
  useShortcuts();
  // menu lateral recolhível é o padrão; a barra superior continua disponível (empresa ou "Minha conta")
  const layout = (user?.preferences?.layout || company?.settings?.layout) === 'top' ? 'top' : 'side';
  return (
    <>
      {layout === 'top' ? <TopLayout /> : <SideLayout />}
      <GlobalSearch />
    </>
  );
}
