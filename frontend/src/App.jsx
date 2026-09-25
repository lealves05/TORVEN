import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { CatalogProvider } from './context/CatalogContext';
import Layout from './components/Layout';
import { Loading } from './components/ui';
import { Login, Register } from './pages/Auth';
import Dashboard from './pages/Dashboard';
import Orders from './pages/Orders';
import OrderNew from './pages/OrderNew';
import OrderDetail from './pages/OrderDetail';
import QuickSale from './pages/QuickSale';
import Quotes, { QuoteEditor } from './pages/Quotes';
import Customers, { CustomerDetail } from './pages/Customers';
import Materials from './pages/Materials';
import Purchases, { PurchaseEditor } from './pages/Purchases';
import { Services, Technicians, Suppliers } from './pages/Catalog';
import Cash from './pages/Cash';
import Invoices from './pages/Invoices';
import Reports, { Commissions } from './pages/Reports';
import Settings from './pages/Settings';
import Account from './pages/Account';
import Requests, { RequestNew, RequestDetail } from './pages/Requests';
import Audit from './pages/Audit';
import Units from './pages/Units';
import Agenda from './pages/Agenda';
import Production from './pages/Production';
import Warranty from './pages/Warranty';
import Procurement, { QuotationDetail, PurchaseOrderDetail, Picking } from './pages/Procurement';
import Finance from './pages/Finance';
import Relationship from './pages/Relationship';
import { PrintOrder, PrintQuote } from './pages/Print';
import { PublicQuote, PublicOrder } from './pages/Public';

function Guard({ perms, children }) {
  const { can } = useAuth();
  return can(...perms) ? children : <Navigate to="/" replace />;
}

export default function App() {
  const { user, loading } = useAuth();

  return (
    <Routes>
      <Route path="/p/orcamento/:token" element={<PublicQuote />} />
      <Route path="/p/os/:token" element={<PublicOrder />} />
      {loading ? (
        <Route path="*" element={<Loading />} />
      ) : !user ? (
        <>
          <Route path="/entrar" element={<Login />} />
          <Route path="/cadastro" element={<Register />} />
          <Route path="*" element={<Navigate to="/entrar" replace />} />
        </>
      ) : (
        <>
          <Route path="/imprimir/os/:id" element={<PrintOrder />} />
          <Route path="/imprimir/orcamento/:id" element={<PrintQuote />} />
          <Route element={<CatalogProvider><Layout /></CatalogProvider>}>
            <Route index element={<Dashboard />} />
            <Route path="os" element={<Guard perms={['orders_view', 'orders_create']}><Orders /></Guard>} />
            <Route path="os/nova" element={<Guard perms={['orders_create']}><OrderNew /></Guard>} />
            <Route path="os/:id" element={<Guard perms={['orders_view', 'orders_create']}><OrderDetail /></Guard>} />
            <Route path="venda" element={<Guard perms={['checkout']}><QuickSale /></Guard>} />
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
            <Route path="configuracoes" element={<Guard perms={['settings', 'users', 'fiscal_settings']}><Settings /></Guard>} />
            <Route path="configuracoes/unidades" element={<Guard perms={['units_manage', 'settings']}><Units /></Guard>} />
            <Route path="agenda" element={<Guard perms={['schedule_view', 'schedule_manage']}><Agenda /></Guard>} />
            <Route path="producao" element={<Guard perms={['schedule_view', 'time_log']}><Production /></Guard>} />
            <Route path="garantias" element={<Guard perms={['warranty_manage']}><Warranty /></Guard>} />
            <Route path="compras" element={<Guard perms={['purchases']}><Procurement /></Guard>} />
            <Route path="compras/cotacoes/:id" element={<Guard perms={['purchases']}><QuotationDetail /></Guard>} />
            <Route path="compras/pedidos/:id" element={<Guard perms={['purchases']}><PurchaseOrderDetail /></Guard>} />
            <Route path="separacao" element={<Guard perms={['materials_manage', 'orders_edit']}><Picking /></Guard>} />
            <Route path="financeiro/gestao" element={<Guard perms={['cash', 'reports']}><Finance /></Guard>} />
            <Route path="relacionamento" element={<Guard perms={['followups']}><Relationship /></Guard>} />
            <Route path="auditoria" element={<Guard perms={['audit_view']}><Audit /></Guard>} />
            <Route path="conta" element={<Account />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </>
      )}
    </Routes>
  );
}
