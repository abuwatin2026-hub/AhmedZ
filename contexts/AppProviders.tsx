import React from 'react';
import { SettingsProvider } from './SettingsContext';
import { AuthProvider } from './AuthContext';
import { NotificationProvider } from './NotificationContext';
import { NotificationSettingsProvider } from './NotificationSettingsContext';
import { ToastProvider } from './ToastContext';
import { MenuProvider } from './MenuContext';
import { CartProvider } from './CartContext';
import { OrderProvider } from './OrderContext';
import { UserAuthProvider } from './UserAuthContext';
import { ReviewProvider } from './ReviewContext';
import { CouponProvider } from './CouponContext';
import { AddonProvider } from './AddonContext';
import { AdProvider } from './AdContext';
import { ChallengeProvider } from './ChallengeContext';
import { StockProvider } from './StockContext';
import { PriceProvider } from './PriceContext';
import { DeliveryZoneProvider } from './DeliveryZoneContext';
import { ItemMetaProvider } from './ItemMetaContext';
import { CashShiftProvider } from './CashShiftContext';
import { PurchasesProvider } from './PurchasesContext';
import { ImportProvider } from './ImportContext';
import { SalesReturnProvider } from './SalesReturnContext';
import { SystemAuditProvider } from './SystemAuditContext';
import { WarehouseProvider } from './WarehouseContext';
import { PricingProvider } from './PricingContext';
import { SupplierEnhancementProvider } from './SupplierEnhancementContext';
import { SessionScopeProvider } from './SessionScopeContext';

export const AppProviders: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    return (
        <SettingsProvider>
            <ToastProvider>
                <AuthProvider>
                    <SessionScopeProvider>
                    <UserAuthProvider>
                        <NotificationSettingsProvider>
                            <NotificationProvider>
                                <SystemAuditProvider>
                                    <CashShiftProvider>
                                        <PurchasesProvider>
                                            <SalesReturnProvider>
                                                <WarehouseProvider>
                                                    <PricingProvider>
                                                        <ReviewProvider>
                                                            <ChallengeProvider>
                                                                <OrderProvider>
                                                                    <CouponProvider>
                                                                        <CartProvider>
                                                                            <DeliveryZoneProvider>
                                                                                <AdProvider>
                                                                                    <AddonProvider>
                                                                                        <PriceProvider>
                                                                                            <StockProvider>
                                                                                                <MenuProvider>
                                                                                                    <ItemMetaProvider>
                                                                                                        <ImportProvider>
                                                                                                            <SupplierEnhancementProvider>
                                                                                                                {children}
                                                                                                            </SupplierEnhancementProvider>
                                                                                                        </ImportProvider>
                                                                                                    </ItemMetaProvider>
                                                                                                </MenuProvider>
                                                                                            </StockProvider>
                                                                                        </PriceProvider>
                                                                                    </AddonProvider>
                                                                                </AdProvider>
                                                                            </DeliveryZoneProvider>
                                                                        </CartProvider>
                                                                    </CouponProvider>
                                                                </OrderProvider>
                                                            </ChallengeProvider>
                                                        </ReviewProvider>
                                                    </PricingProvider>
                                                </WarehouseProvider>
                                            </SalesReturnProvider>
                                        </PurchasesProvider>
                                    </CashShiftProvider>
                                </SystemAuditProvider>
                            </NotificationProvider>
                        </NotificationSettingsProvider>
                    </UserAuthProvider>
                    </SessionScopeProvider>
                </AuthProvider>
            </ToastProvider>
        </SettingsProvider>
    );
};
