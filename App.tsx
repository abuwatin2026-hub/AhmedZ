import type React from 'react';
import { useEffect, lazy, Suspense } from 'react';
import { HashRouter, Routes, Route, Outlet, Navigate, useLocation, useNavigate } from 'react-router-dom';
import Header from './components/Header';
import ConnectivityBanner from './components/ConnectivityBanner';
import { useOrders } from './contexts/OrderContext';
import { useUserAuth } from './contexts/UserAuthContext';
import { useMenu } from './contexts/MenuContext';
import Notification from './components/Notification';
import BottomNavBar from './components/BottomNavBar';
import { useReviews } from './contexts/ReviewContext';
import { App as CapacitorApp } from '@capacitor/app';
import PageLoader from './components/PageLoader';
import { useAuth } from './contexts/AuthContext';
import type { AdminPermission, AdminRole } from './types';
import ErrorBoundary from './components/ErrorBoundary';
import { ThemeProvider } from './contexts/ThemeContext';
import { useSettings } from './contexts/SettingsContext';
import { startQueueProcessor } from './utils/offlineQueue';
import { getSupabaseClient } from './supabase';
import { isRpcWrappersAvailable } from './supabase';
import { useSystemAudit } from './contexts/SystemAuditContext';

// Lazy load screens
const HomeScreen = lazy(() => import('./screens/HomeScreen'));
const ItemDetailsScreen = lazy(() => import('./screens/ItemDetailsScreen'));
const CartScreen = lazy(() => import('./screens/CartScreen'));
const CheckoutScreen = lazy(() => import('./screens/CheckoutScreen'));
const OrderConfirmationScreen = lazy(() => import('./screens/OrderConfirmationScreen'));
const MyOrdersScreen = lazy(() => import('./screens/MyOrdersScreen'));
const LoginScreen = lazy(() => import('./screens/LoginScreen'));
const OtpScreen = lazy(() => import('./screens/OtpScreen'));
const UserProfileScreen = lazy(() => import('./screens/UserProfileScreen'));
const InvoiceScreen = lazy(() => import('./screens/InvoiceScreen'));
const DownloadAppScreen = lazy(() => import('./screens/DownloadAppScreen'));
const HelpCenterScreen = lazy(() => import('./screens/HelpCenterScreen'));
const POSScreen = lazy(() => import('./screens/POSScreen'));
const PromotionDetailsScreen = lazy(() => import('./screens/PromotionDetailsScreen'));

// Lazy load admin screens
const AdminLoginScreen = lazy(() => import('./screens/admin/AdminLoginScreen'));
const AdminLayout = lazy(() => import('./screens/admin/AdminLayout'));
const AdminDashboardScreen = lazy(() => import('./screens/admin/AdminDashboardScreen'));
const ManageOrdersScreen = lazy(() => import('./screens/admin/ManageOrdersScreen'));
const ManageItemsScreen = lazy(() => import('./screens/admin/ManageItemsScreen'));
const ManageAddonsScreen = lazy(() => import('./screens/admin/ManageAddonsScreen'));
const ManageAdsScreen = lazy(() => import('./screens/admin/ManageAdsScreen'));
const ManageCustomersScreen = lazy(() => import('./screens/admin/ManageCustomersScreen'));
const ManageCouponsScreen = lazy(() => import('./screens/admin/ManageCouponsScreen'));
const ManagePromotionsScreen = lazy(() => import('./screens/admin/ManagePromotionsScreen'));
const ManageChallengesScreen = lazy(() => import('./screens/admin/ManageChallengesScreen'));
const ManageReviewsScreen = lazy(() => import('./screens/admin/ManageReviewsScreen'));
const ManageStockScreen = lazy(() => import('./screens/admin/ManageStockScreen'));
const ManagePricesScreen = lazy(() => import('./screens/admin/ManagePricesScreen'));
const ManageDeliveryZonesScreen = lazy(() => import('./screens/admin/ManageDeliveryZonesScreen'));
const ManageCostCentersScreen = lazy(() => import('./screens/admin/ManageCostCentersScreen'));
const ManageExpensesScreen = lazy(() => import('./screens/admin/ManageExpensesScreen'));
const ReportsScreen = lazy(() => import('./screens/admin/ReportsScreen'));
const SalesReports = lazy(() => import('./screens/admin/reports/SalesReports'));
const ProductReports = lazy(() => import('./screens/admin/reports/ProductReports'));
const CustomerReports = lazy(() => import('./screens/admin/reports/CustomerReports'));
const FinancialReports = lazy(() => import('./screens/admin/reports/FinancialReports'));
const FinancialReportsByJournal = lazy(() => import('./screens/admin/reports/FinancialReportsByJournal'));
const ReservationsReports = lazy(() => import('./screens/admin/reports/ReservationsReports'));
const FoodTraceReports = lazy(() => import('./screens/admin/reports/FoodTraceReports'));
const InventoryStockReportScreen = lazy(() => import('./screens/admin/reports/InventoryStockReportScreen'));
const SupplierStockReportScreen = lazy(() => import('./screens/admin/reports/SupplierStockReportScreen'));
const AdminProfileScreen = lazy(() => import('./screens/admin/AdminProfileScreen'));
const SettingsScreen = lazy(() => import('./screens/admin/SettingsScreen'));
const SuppliersScreen = lazy(() => import('./screens/admin/SuppliersScreen'));
const ApprovalsScreen = lazy(() => import('./screens/admin/ApprovalsScreen'));
const PrintedDocumentsScreen = lazy(() => import('./screens/admin/PrintedDocumentsScreen'));
const PayrollScreen = lazy(() => import('./screens/admin/PayrollScreen'));
const PurchaseOrderScreen = lazy(() => import('./screens/admin/PurchaseOrderScreen'));
const ShiftReportsScreen = lazy(() => import('./screens/admin/ShiftReportsScreen'));
const ShiftDetailsScreen = lazy(() => import('./screens/admin/ShiftDetailsScreen'));
const CODSettlementsScreen = lazy(() => import('./screens/admin/CODSettlementsScreen'));
const SystemAuditScreen = lazy(() => import('./screens/admin/SystemAuditScreen'));
const DatabaseExplorerScreen = lazy(() => import('./screens/admin/DatabaseExplorerScreen'));
const WarehousesScreen = lazy(() => import('./screens/admin/WarehousesScreen'));
const WarehouseTransfersScreen = lazy(() => import('./screens/admin/WarehouseTransfersScreen'));
const PriceTiersScreen = lazy(() => import('./screens/admin/PriceTiersScreen'));
const SupplierContractsScreen = lazy(() => import('./screens/admin/SupplierContractsScreen'));
const SupplierEvaluationsScreen = lazy(() => import('./screens/admin/SupplierEvaluationsScreen'));
const SupplierCreditNotesScreen = lazy(() => import('./screens/admin/SupplierCreditNotesScreen'));
const FxRatesScreen = lazy(() => import('./screens/admin/FxRatesScreen'));
const ImportShipmentsScreen = lazy(() => import('./screens/admin/ImportShipmentsScreen'));
const ImportShipmentDetailsScreen = lazy(() => import('./screens/admin/ImportShipmentDetailsScreen'));
const POSTestConsole = lazy(() => import('./screens/admin/POSTestConsole'));
const WastageScreen = lazy(() => import('./screens/admin/WastageScreen'));
const DocumentTemplatesScreen = lazy(() => import('./screens/admin/DocumentTemplatesScreen'));
const ExpiryBatchesScreen = lazy(() => import('./screens/admin/ExpiryBatchesScreen'));
const WastageExpiryReportsScreen = lazy(() => import('./screens/admin/WastageExpiryReportsScreen'));
const ChartOfAccountsScreen = lazy(() => import('./screens/admin/ChartOfAccountsScreen'));
const JournalsScreen = lazy(() => import('./screens/admin/JournalsScreen'));
const BankReconciliationScreen = lazy(() => import('./screens/admin/BankReconciliationScreen'));
const PayrollConfigScreen = lazy(() => import('./screens/admin/PayrollConfigScreen'));
const FinancialDimensionsScreen = lazy(() => import('./screens/admin/FinancialDimensionsScreen'));
const FinancialPartiesScreen = lazy(() => import('./screens/admin/FinancialPartiesScreen'));
const PartyLedgerStatementScreen = lazy(() => import('./screens/admin/PartyLedgerStatementScreen'));
const PartyAgingReportsScreen = lazy(() => import('./screens/admin/reports/PartyAgingReportsScreen'));
const PartyDocumentsScreen = lazy(() => import('./screens/admin/PartyDocumentsScreen'));
const SettlementWorkspaceScreen = lazy(() => import('./screens/admin/SettlementWorkspaceScreen'));
const AdvanceManagementScreen = lazy(() => import('./screens/admin/AdvanceManagementScreen'));

const CustomerLayout: React.FC = () => {
  const { settings } = useSettings();
  if (settings.maintenanceEnabled) {
    return (
      <div className="min-h-screen min-h-dvh flex items-center justify-center bg-gray-50 dark:bg-gray-950 text-gray-800 dark:text-gray-200 px-6">
        <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-xl shadow-lg p-6 text-center">
          <div className="text-2xl font-bold mb-2">التطبيق في وضع الصيانة</div>
          <div className="text-sm text-gray-600 dark:text-gray-400 mb-4">{settings.maintenanceMessage || 'الرجاء المحاولة لاحقًا.'}</div>
          <div className="text-sm text-gray-700 dark:text-gray-300">
            للتواصل: {settings.contactNumber || ''}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="min-h-screen min-h-dvh font-sans text-gray-800 dark:text-gray-200">
      <Header />
      <ConnectivityBanner />
      <Notification />
      <main style={{ paddingBottom: 'calc(var(--bottom-nav-height, 0px) + 16px)' }}>
        <Outlet />
      </main>
      <BottomNavBar />
    </div>
  );
};

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated: isCustomerAuthenticated, loading: customerLoading } = useUserAuth();
  const { isAuthenticated: isAdminAuthenticated, loading: adminLoading, hasPermission } = useAuth();
  const location = useLocation();

  if (customerLoading || adminLoading) {
    return <PageLoader />;
  }

  if (!isCustomerAuthenticated) {
    if (isAdminAuthenticated) {
      return <Navigate to={getAdminFallbackPath(hasPermission)} replace />;
    }
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
};

const getAdminFallbackPath = (hasPermission: (permission: AdminPermission) => boolean): string => {
  const candidates: Array<{ permission: AdminPermission; path: string }> = [
    { permission: 'dashboard.view', path: '/admin/dashboard' },
    { permission: 'orders.view', path: '/admin/orders' },
    { permission: 'items.manage', path: '/admin/items' },
    { permission: 'stock.manage', path: '/admin/stock' },
    { permission: 'deliveryZones.manage', path: '/admin/delivery-zones' },
    { permission: 'customers.manage', path: '/admin/customers' },
    { permission: 'reports.view', path: '/admin/reports' },
    { permission: 'profile.view', path: '/admin/profile' },
  ];

  const firstAllowed = candidates.find(candidate => hasPermission(candidate.permission));
  return firstAllowed?.path || '/admin/profile';
};

const AdminIndexRedirect: React.FC = () => {
  const { hasPermission } = useAuth();
  return <Navigate to={getAdminFallbackPath(hasPermission)} replace />;
};

const AdminProtectedRoute: React.FC<{
  children: React.ReactNode;
  roles?: AdminRole[];
  permissions?: AdminPermission[];
  requireAllPermissions?: boolean;
}> = ({ children, roles, permissions, requireAllPermissions = true }) => {
  const { isAuthenticated, loading, user, hasPermission } = useAuth();
  const location = useLocation();

  if (loading) {
    return <PageLoader />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/admin/login" state={{ from: location }} replace />;
  }

  const role: AdminRole = user?.role || 'employee';
  if (roles && roles.length > 0 && !roles.includes(role)) {
    return <Navigate to={getAdminFallbackPath(hasPermission)} replace />;
  }

  if (Array.isArray(permissions) && permissions.length > 0) {
    const ok = requireAllPermissions
      ? permissions.every(permission => hasPermission(permission))
      : permissions.some(permission => hasPermission(permission));
    if (!ok) {
      return <Navigate to={getAdminFallbackPath(hasPermission)} replace />;
    }
  }

  return <>{children}</>;
};

const HardwareBackButtonHandler: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    let handle: { remove: () => void } | undefined;
    const setup = async () => {
      handle = await CapacitorApp.addListener('backButton', () => {
        if (location.key !== 'default') {
          navigate(-1);
        } else {
          CapacitorApp.exitApp();
        }
      });
    };
    setup();

    return () => {
      handle?.remove();
    };
  }, [location.key, navigate]);

  return null;
};

const AppStateListener: React.FC = () => {
  const { fetchOrders } = useOrders();
  const { fetchMenuItems } = useMenu();
  const { fetchCustomers } = useUserAuth();
  const { fetchReviews } = useReviews();

  useEffect(() => {
    let handle: { remove: () => void } | undefined;
    const setup = async () => {
      handle = await CapacitorApp.addListener('appStateChange', ({ isActive }) => {
        if (isActive) {
          fetchOrders();
          fetchMenuItems();
          fetchCustomers();
          fetchReviews();
        }
      });
    };
    setup();

    return () => {
      handle?.remove();
    };
  }, [fetchOrders, fetchMenuItems, fetchCustomers, fetchReviews]);

  return null;
};

const RpcHealthCheck: React.FC = () => {
  const { logAction } = useSystemAudit();
  useEffect(() => {
    const run = async () => {
      const sup = getSupabaseClient();
      if (!sup) return;
      const { data: sessionData } = await sup.auth.getSession();
      if (!sessionData?.session) return;
      const ok = await isRpcWrappersAvailable();
      if (ok) {
        await logAction('rpc.health', 'system', 'wrappers available', { env: 'production' });
      } else {
        await logAction('rpc.health', 'system', 'wrappers missing', { env: 'production' });
      }
    };
    void run();
  }, [logAction]);
  return null;
};

const App: React.FC = () => {
  useEffect(() => {
    startQueueProcessor();
  }, []);
  return (
    <ThemeProvider>
      <ErrorBoundary>
        <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <HardwareBackButtonHandler />
          <AppStateListener />
          <RpcHealthCheck />
          <Suspense fallback={<PageLoader />}>
            <Routes>
              {/* Customer Facing Routes */}
              <Route path="/" element={<CustomerLayout />}>
                <Route index element={<HomeScreen />} />
                <Route path="item/:id" element={<ItemDetailsScreen />} />
                <Route path="promotion/:id" element={<PromotionDetailsScreen />} />
                <Route path="cart" element={<CartScreen />} />
                <Route path="login" element={<LoginScreen />} />
                <Route path="otp" element={<OtpScreen />} />
                <Route path="checkout" element={<ProtectedRoute><CheckoutScreen /></ProtectedRoute>} />
                <Route path="order/:orderId" element={<OrderConfirmationScreen />} />
                <Route path="my-orders" element={<ProtectedRoute><MyOrdersScreen /></ProtectedRoute>} />
                <Route path="profile" element={<ProtectedRoute><UserProfileScreen /></ProtectedRoute>} />
                <Route path="invoice/:orderId" element={<ProtectedRoute><InvoiceScreen /></ProtectedRoute>} />
                <Route path="download-app" element={<DownloadAppScreen />} />
                <Route path="help" element={<HelpCenterScreen />} />
              </Route>

              {/* Admin Dashboard Routes */}
              <Route path="/admin/login" element={<AdminLoginScreen />} />
              <Route path="/admin" element={<AdminProtectedRoute><AdminLayout /></AdminProtectedRoute>}>
                <Route index element={<AdminIndexRedirect />} />
                <Route path="dashboard" element={<AdminProtectedRoute permissions={['dashboard.view']}><AdminDashboardScreen /></AdminProtectedRoute>} />
                <Route path="orders" element={<AdminProtectedRoute permissions={['orders.view']}><ManageOrdersScreen /></AdminProtectedRoute>} />
                <Route path="invoice/:orderId" element={<AdminProtectedRoute permissions={['orders.view']}><InvoiceScreen /></AdminProtectedRoute>} />
                <Route path="delivery-zones" element={<AdminProtectedRoute permissions={['deliveryZones.manage']}><ManageDeliveryZonesScreen /></AdminProtectedRoute>} />
                <Route path="items" element={<AdminProtectedRoute permissions={['items.manage']}><ManageItemsScreen /></AdminProtectedRoute>} />
                <Route path="addons" element={<AdminProtectedRoute permissions={['addons.manage']}><ManageAddonsScreen /></AdminProtectedRoute>} />
                <Route path="ads" element={<AdminProtectedRoute permissions={['ads.manage']}><ManageAdsScreen /></AdminProtectedRoute>} />
                <Route path="customers" element={<AdminProtectedRoute permissions={['customers.manage']}><ManageCustomersScreen /></AdminProtectedRoute>} />
                <Route path="challenges" element={<AdminProtectedRoute permissions={['challenges.manage']}><ManageChallengesScreen /></AdminProtectedRoute>} />
                <Route path="coupons" element={<AdminProtectedRoute permissions={['coupons.manage']}><ManageCouponsScreen /></AdminProtectedRoute>} />
                <Route path="promotions" element={<AdminProtectedRoute permissions={['promotions.manage']}><ManagePromotionsScreen /></AdminProtectedRoute>} />
                <Route path="reviews" element={<AdminProtectedRoute permissions={['reviews.manage']}><ManageReviewsScreen /></AdminProtectedRoute>} />
                <Route
                  path="stock"
                  element={
                    <AdminProtectedRoute permissions={['inventory.view', 'stock.manage']} requireAllPermissions={false}>
                      <ManageStockScreen />
                    </AdminProtectedRoute>
                  }
                />
                <Route path="wastage" element={<AdminProtectedRoute permissions={['stock.manage']}><WastageScreen /></AdminProtectedRoute>} />
                <Route path="expiry-batches" element={<AdminProtectedRoute permissions={['stock.manage']}><ExpiryBatchesScreen /></AdminProtectedRoute>} />
                <Route
                  path="wastage-expiry-reports"
                  element={
                    <AdminProtectedRoute permissions={['inventory.movements.view', 'reports.view', 'stock.manage']} requireAllPermissions={false}>
                      <WastageExpiryReportsScreen />
                    </AdminProtectedRoute>
                  }
                />
                <Route path="suppliers" element={<AdminProtectedRoute permissions={['stock.manage']}><SuppliersScreen /></AdminProtectedRoute>} />
                <Route path="purchases" element={<AdminProtectedRoute permissions={['stock.manage']}><PurchaseOrderScreen /></AdminProtectedRoute>} />
                <Route path="supplier-contracts" element={<AdminProtectedRoute permissions={['stock.manage']}><SupplierContractsScreen /></AdminProtectedRoute>} />
                <Route path="supplier-evaluations" element={<AdminProtectedRoute permissions={['stock.manage']}><SupplierEvaluationsScreen /></AdminProtectedRoute>} />
                <Route path="supplier-credit-notes" element={<AdminProtectedRoute permissions={['accounting.manage']}><SupplierCreditNotesScreen /></AdminProtectedRoute>} />
                <Route
                  path="import-shipments"
                  element={
                    <AdminProtectedRoute permissions={['shipments.view', 'stock.manage']} requireAllPermissions={false}>
                      <ImportShipmentsScreen />
                    </AdminProtectedRoute>
                  }
                />
                <Route
                  path="import-shipments/:id"
                  element={
                    <AdminProtectedRoute permissions={['shipments.view', 'stock.manage']} requireAllPermissions={false}>
                      <ImportShipmentDetailsScreen />
                    </AdminProtectedRoute>
                  }
                />
                <Route path="warehouses" element={<AdminProtectedRoute permissions={['stock.manage']}><WarehousesScreen /></AdminProtectedRoute>} />
                <Route path="warehouse-transfers" element={<AdminProtectedRoute permissions={['stock.manage']}><WarehouseTransfersScreen /></AdminProtectedRoute>} />
                <Route path="price-tiers" element={<AdminProtectedRoute permissions={['prices.manage']}><PriceTiersScreen /></AdminProtectedRoute>} />
                <Route path="prices" element={<AdminProtectedRoute permissions={['prices.manage']}><ManagePricesScreen /></AdminProtectedRoute>} />
                <Route path="cost-centers" element={<AdminProtectedRoute permissions={['expenses.manage']}><ManageCostCentersScreen /></AdminProtectedRoute>} />
                <Route path="expenses" element={<AdminProtectedRoute permissions={['expenses.manage']}><ManageExpensesScreen /></AdminProtectedRoute>} />
                <Route path="reports" element={<AdminProtectedRoute permissions={['reports.view']}><ReportsScreen /></AdminProtectedRoute>} />
                <Route path="reports/sales" element={<AdminProtectedRoute permissions={['reports.view']}><SalesReports /></AdminProtectedRoute>} />
                <Route path="reports/products" element={<AdminProtectedRoute permissions={['reports.view']}><ProductReports /></AdminProtectedRoute>} />
                <Route path="reports/customers" element={<AdminProtectedRoute permissions={['reports.view']}><CustomerReports /></AdminProtectedRoute>} />
                <Route path="reports/reservations" element={<AdminProtectedRoute permissions={['reports.view']}><ReservationsReports /></AdminProtectedRoute>} />
                <Route path="reports/food-trace" element={<AdminProtectedRoute permissions={['reports.view']}><FoodTraceReports /></AdminProtectedRoute>} />
                <Route path="reports/inventory-stock" element={<AdminProtectedRoute permissions={['reports.view']}><InventoryStockReportScreen /></AdminProtectedRoute>} />
                <Route path="reports/supplier-stock" element={<AdminProtectedRoute permissions={['reports.view']}><SupplierStockReportScreen /></AdminProtectedRoute>} />
                <Route path="reports/financial" element={<AdminProtectedRoute permissions={['accounting.view']}><FinancialReports /></AdminProtectedRoute>} />
                <Route path="reports/financial-journals" element={<AdminProtectedRoute permissions={['accounting.view']}><FinancialReportsByJournal /></AdminProtectedRoute>} />
                <Route path="accounting" element={<AdminProtectedRoute permissions={['accounting.view']}><FinancialReports /></AdminProtectedRoute>} />
                <Route path="printed-documents" element={<AdminProtectedRoute permissions={['accounting.view']}><PrintedDocumentsScreen /></AdminProtectedRoute>} />
                <Route path="document-templates" element={<AdminProtectedRoute permissions={['accounting.view']}><DocumentTemplatesScreen /></AdminProtectedRoute>} />
                <Route path="payroll" element={<AdminProtectedRoute permissions={['expenses.manage', 'accounting.manage']} requireAllPermissions={false}><PayrollScreen /></AdminProtectedRoute>} />
                <Route path="chart-of-accounts" element={<AdminProtectedRoute roles={['owner']}><ChartOfAccountsScreen /></AdminProtectedRoute>} />
                <Route path="journals" element={<AdminProtectedRoute permissions={['accounting.manage']}><JournalsScreen /></AdminProtectedRoute>} />
                <Route path="fx-rates" element={<AdminProtectedRoute permissions={['accounting.manage']}><FxRatesScreen /></AdminProtectedRoute>} />
                <Route path="bank-reconciliation" element={<AdminProtectedRoute permissions={['accounting.manage']}><BankReconciliationScreen /></AdminProtectedRoute>} />
                <Route path="payroll-config" element={<AdminProtectedRoute permissions={['accounting.manage']}><PayrollConfigScreen /></AdminProtectedRoute>} />
                <Route path="financial-dimensions" element={<AdminProtectedRoute permissions={['accounting.manage']}><FinancialDimensionsScreen /></AdminProtectedRoute>} />
                <Route path="financial-parties" element={<AdminProtectedRoute permissions={['accounting.view']}><FinancialPartiesScreen /></AdminProtectedRoute>} />
                <Route path="financial-parties/:partyId" element={<AdminProtectedRoute permissions={['accounting.view']}><PartyLedgerStatementScreen /></AdminProtectedRoute>} />
                <Route path="party-documents" element={<AdminProtectedRoute permissions={['accounting.manage']}><PartyDocumentsScreen /></AdminProtectedRoute>} />
                <Route path="settlements" element={<AdminProtectedRoute permissions={['accounting.manage']}><SettlementWorkspaceScreen /></AdminProtectedRoute>} />
                <Route path="advances" element={<AdminProtectedRoute permissions={['accounting.manage']}><AdvanceManagementScreen /></AdminProtectedRoute>} />
                <Route
                  path="reports/party-aging"
                  element={
                    <AdminProtectedRoute permissions={['accounting.view', 'reports.view']} requireAllPermissions={false}>
                      <PartyAgingReportsScreen />
                    </AdminProtectedRoute>
                  }
                />
                <Route path="profile" element={<AdminProtectedRoute permissions={['profile.view']}><AdminProfileScreen /></AdminProtectedRoute>} />
                <Route path="settings" element={<AdminProtectedRoute permissions={['settings.manage']}><SettingsScreen /></AdminProtectedRoute>} />
                <Route path="approvals" element={<AdminProtectedRoute permissions={['approvals.manage']}><ApprovalsScreen /></AdminProtectedRoute>} />
                <Route path="audit" element={<AdminProtectedRoute permissions={['settings.manage']}><SystemAuditScreen /></AdminProtectedRoute>} />
                <Route path="database" element={<AdminProtectedRoute permissions={['settings.manage']}><DatabaseExplorerScreen /></AdminProtectedRoute>} />
                <Route path="shift-reports" element={<AdminProtectedRoute permissions={['reports.view']}><ShiftReportsScreen /></AdminProtectedRoute>} />
                <Route path="shift-reports/:shiftId" element={<AdminProtectedRoute permissions={['reports.view']}><ShiftDetailsScreen /></AdminProtectedRoute>} />
                <Route path="cod-settlements" element={<AdminProtectedRoute permissions={['accounting.manage']}><CODSettlementsScreen /></AdminProtectedRoute>} />
                <Route
                  path="my-shift"
                  element={
                    <AdminProtectedRoute permissions={['cashShifts.viewOwn', 'cashShifts.manage']} requireAllPermissions={false}>
                      <ShiftDetailsScreen />
                    </AdminProtectedRoute>
                  }
                />
              </Route>
              <Route
                path="/pos"
                element={
                  <AdminProtectedRoute permissions={['orders.createInStore', 'orders.updateStatus.all']} requireAllPermissions={false}>
                    <POSScreen />
                  </AdminProtectedRoute>
                }
              />
              <Route
                path="/admin/pos-test"
                element={
                  <AdminProtectedRoute permissions={['orders.updateStatus.all', 'orders.createInStore']} requireAllPermissions={false}>
                    <POSTestConsole />
                  </AdminProtectedRoute>
                }
              />
            </Routes>
          </Suspense>
        </HashRouter>
      </ErrorBoundary>
    </ThemeProvider>
  );
};

export default App;
