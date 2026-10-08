import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { CatalogProvider } from './context/CatalogContext';
import Layout from './components/Layout';
import { Loading } from './components/ui';
import { Login, Register, DemoSignup, ForgotPassword, ResetPassword } from './pages/Auth';
import { BlockedScreen } from './components/Billing';
import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';

// Telas carregadas sob demanda: só o necessário para o primeiro desenho entra no pacote inicial.
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Orders = lazy(() => import('./pages/Orders'));
const OrderNew = lazy(() => import('./pages/OrderNew'));
const OrderDetail = lazy(() => import('./pages/OrderDetail'));
const QuickSale = lazy(() => import('./pages/QuickSale'));
const Quotes = lazy(() => import('./pages/Quotes'));
const QuoteEditor = lazy(() => import('./pages/Quotes').then((m) => ({ default: m.QuoteEditor })));
const Customers = lazy(() => import('./pages/Customers'));
const CustomerDetail = lazy(() => import('./pages/Customers').then((m) => ({ default: m.CustomerDetail })));
const Materials = lazy(() => import('./pages/Materials'));
const Purchases = lazy(() => import('./pages/Purchases'));
const PurchaseEditor = lazy(() => import('./pages/Purchases').then((m) => ({ default: m.PurchaseEditor })));
const Services = lazy(() => import('./pages/Catalog').then((m) => ({ default: m.Services })));
const Technicians = lazy(() => import('./pages/Catalog').then((m) => ({ default: m.Technicians })));
const Suppliers = lazy(() => import('./pages/Catalog').then((m) => ({ default: m.Suppliers })));
const Cash = lazy(() => import('./pages/Cash'));
const Invoices = lazy(() => import('./pages/Invoices'));
const Reports = lazy(() => import('./pages/Reports'));
const Commissions = lazy(() => import('./pages/Reports').then((m) => ({ default: m.Commissions })));
const Settings = lazy(() => import('./pages/Settings'));
const Account = lazy(() => import('./pages/Account'));
const Support = lazy(() => import('./pages/Support'));
const Requests = lazy(() => import('./pages/Requests'));
const WhatsApp = lazy(() => import('./pages/WhatsApp'));
const RequestNew = lazy(() => import('./pages/Requests').then((m) => ({ default: m.RequestNew })));
const RequestDetail = lazy(() => import('./pages/Requests').then((m) => ({ default: m.RequestDetail })));
const Audit = lazy(() => import('./pages/Audit'));
const Units = lazy(() => import('./pages/Units'));
const Agenda = lazy(() => import('./pages/Agenda'));
const Production = lazy(() => import('./pages/Production'));
const MyWork = lazy(() => import('./pages/MyWork'));
const Warranty = lazy(() => import('./pages/Warranty'));
const Procurement = lazy(() => import('./pages/Procurement'));
const QuotationDetail = lazy(() => import('./pages/Procurement').then((m) => ({ default: m.QuotationDetail })));
const PurchaseOrderDetail = lazy(() => import('./pages/Procurement').then((m) => ({ default: m.PurchaseOrderDetail })));
const Picking = lazy(() => import('./pages/Procurement').then((m) => ({ default: m.Picking })));
const Finance = lazy(() => import('./pages/Finance'));
const Relationship = lazy(() => import('./pages/Relationship'));
const PrintOrder = lazy(() => import('./pages/Print').then((m) => ({ default: m.PrintOrder })));
const PrintOrderFull = lazy(() => import('./pages/Print').then((m) => ({ default: m.PrintOrderFull })));
const PrintQuote = lazy(() => import('./pages/Print').then((m) => ({ default: m.PrintQuote })));
const PublicQuote = lazy(() => import('./pages/Public').then((m) => ({ default: m.PublicQuote })));
const PublicOrder = lazy(() => import('./pages/Public').then((m) => ({ default: m.PublicOrder })));
const Subscription = lazy(() => import('./pages/Subscription'));

/** Assinatura aberta com o acesso bloqueado: tela própria, sem o restante do sistema. */
function BlockedSubscription() {
  return (
    <div className="min-h-full bg-bg">
      <div className="mx-auto max-w-[1100px] p-4 sm:p-6">
        <Link to="/" className="btn-ghost mb-3"><ArrowLeft className="h-4 w-4" /> Voltar</Link>
        <Lazy><Subscription /></Lazy>
      </div>
    </div>
  );
}

const Lazy = ({ children }) => <Suspense fallback={<Loading />}>{children}</Suspense>;

function Guard({ perms, children }) {
  const { can } = useAuth();
  return can(...perms) ? <Lazy>{children}</Lazy> : <Navigate to="/" replace />;
}

export default function App() {
  const { user, loading, access } = useAuth();
  const admin = ['owner', 'admin'].includes(user?.role);

  return (
    <Routes>
      <Route path="/p/orcamento/:token" element={<Lazy><PublicQuote /></Lazy>} />
      <Route path="/p/os/:token" element={<Lazy><PublicOrder /></Lazy>} />
      <Route path="/esqueci-senha" element={<ForgotPassword />} />
      <Route path="/redefinir-senha" element={<ResetPassword />} />
      {loading ? (
        <Route path="*" element={<Loading />} />
      ) : !user ? (
        <>
          <Route path="/entrar" element={<Login />} />
          <Route path="/cadastro" element={<Register />} />
          <Route path="/demonstracao" element={<DemoSignup />} />
          <Route path="*" element={<Navigate to="/entrar" replace />} />
        </>
      ) : access?.blocked ? (
        <>
          {admin && <Route path="/assinatura" element={<BlockedSubscription />} />}
          <Route path="*" element={<BlockedScreen />} />
        </>
      ) : (
        <>
          <Route path="/imprimir/os/:id" element={<Lazy><PrintOrder /></Lazy>} />
          <Route path="/imprimir/os/:id/completa" element={<Lazy><PrintOrderFull /></Lazy>} />
          <Route path="/imprimir/orcamento/:id" element={<Lazy><PrintQuote /></Lazy>} />
          <Route element={<CatalogProvider><Layout /></CatalogProvider>}>
            <Route index element={<Lazy><Dashboard /></Lazy>} />
            <Route path="os" element={<Guard perms={['orders_view', 'orders_create']}><Orders /></Guard>} />
            <Route path="os/nova" element={<Guard perms={['orders_create']}><OrderNew /></Guard>} />
            <Route path="os/:id" element={<Guard perms={['orders_view', 'orders_create']}><OrderDetail /></Guard>} />
            <Route path="venda" element={<Guard perms={['checkout']}><QuickSale /></Guard>} />
            <Route path="whatsapp" element={<Guard perms={['requests_manage']}><WhatsApp /></Guard>} />
            <Route path="solicitacoes" element={<Guard perms={['requests_view', 'requests_manage']}><Requests /></Guard>} />
            <Route path="solicitacoes/nova" element={<Guard perms={['requests_manage']}><RequestNew /></Guard>} />
            <Route path="solicitacoes/:id" element={<Guard perms={['requests_view', 'requests_manage']}><RequestDetail /></Guard>} />
            <Route path="orcamentos" element={<Guard perms={['quotes_view', 'quotes', 'quotes_approve']}><Quotes /></Guard>} />
            <Route path="orcamentos/novo" element={<Guard perms={['quotes']}><QuoteEditor key="novo" /></Guard>} />
            <Route path="orcamentos/:id" element={<Guard perms={['quotes_view', 'quotes', 'quotes_approve']}><QuoteEditor /></Guard>} />
            <Route path="clientes" element={<Guard perms={['customers_view']}><Customers /></Guard>} />
            <Route path="clientes/:id" element={<Guard perms={['customers_view']}><CustomerDetail /></Guard>} />
            <Route path="estoque" element={<Guard perms={['materials_manage', 'purchases']}><Materials /></Guard>} />
            <Route path="estoque/entradas" element={<Guard perms={['purchases']}><Purchases /></Guard>} />
            <Route path="estoque/entradas/nova" element={<Guard perms={['purchases']}><PurchaseEditor key="nova" /></Guard>} />
            <Route path="estoque/entradas/:id" element={<Guard perms={['purchases']}><PurchaseEditor /></Guard>} />
            <Route path="fornecedores" element={<Guard perms={['suppliers', 'purchases']}><Suppliers /></Guard>} />
            <Route path="servicos" element={<Guard perms={['services_manage']}><Services /></Guard>} />
            <Route path="tecnicos" element={<Guard perms={['technicians_manage']}><Technicians /></Guard>} />
            <Route path="financeiro" element={<Guard perms={['cash']}><Cash /></Guard>} />
            <Route path="notas" element={<Guard perms={['invoices_issue', 'invoices_cancel']}><Invoices /></Guard>} />
            <Route path="relatorios" element={<Guard perms={['reports']}><Reports /></Guard>} />
            <Route path="comissoes" element={<Guard perms={['commissions']}><Commissions /></Guard>} />
            <Route path="configuracoes" element={<Guard perms={['settings', 'users', 'fiscal_settings', 'integrations']}><Settings /></Guard>} />
            <Route path="configuracoes/unidades" element={<Guard perms={['units_manage', 'settings']}><Units /></Guard>} />
            <Route path="agenda" element={<Guard perms={['schedule_view', 'schedule_manage']}><Agenda /></Guard>} />
            <Route path="meu-trabalho" element={<Guard perms={['time_log']}><MyWork /></Guard>} />
            <Route path="producao" element={<Guard perms={['schedule_view', 'time_log']}><Production /></Guard>} />
            <Route path="garantias" element={<Guard perms={['warranty_manage']}><Warranty /></Guard>} />
            <Route path="compras" element={<Guard perms={['purchases']}><Procurement /></Guard>} />
            <Route path="compras/cotacoes/:id" element={<Guard perms={['purchases']}><QuotationDetail /></Guard>} />
            <Route path="compras/pedidos/:id" element={<Guard perms={['purchases']}><PurchaseOrderDetail /></Guard>} />
            <Route path="separacao" element={<Guard perms={['materials_manage', 'orders_edit']}><Picking /></Guard>} />
            <Route path="financeiro/gestao" element={<Guard perms={['cash', 'reports']}><Finance /></Guard>} />
            <Route path="relacionamento" element={<Guard perms={['followups']}><Relationship /></Guard>} />
            <Route path="auditoria" element={<Guard perms={['audit_view']}><Audit /></Guard>} />
            <Route path="conta" element={<Lazy><Account /></Lazy>} />
            <Route path="suporte" element={<Lazy><Support /></Lazy>} />
            {access && admin && <Route path="assinatura" element={<Lazy><Subscription /></Lazy>} />}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </>
      )}
    </Routes>
  );
}
