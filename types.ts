export type LocalizedString = {
  ar: string;
  en?: string;
};

// Unit types for products (weight-based and count-based)
export type UnitType = 'kg' | 'piece' | 'bundle' | 'gram' | (string & {});

// Freshness levels for perishable products
export type FreshnessLevel = 'fresh' | 'good' | 'acceptable' | (string & {});

export interface ItemCategoryDef {
  id: string;
  key: string;
  name: LocalizedString;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UnitTypeDef {
  id: string;
  key: UnitType;
  label: LocalizedString;
  isActive: boolean;
  isWeightBased: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FreshnessLevelDef {
  id: string;
  key: FreshnessLevel;
  label: LocalizedString;
  isActive: boolean;
  tone?: 'green' | 'blue' | 'yellow' | 'gray' | 'red' | (string & {});
  createdAt: string;
  updatedAt: string;
}

export interface Addon {
  id: string;
  name: LocalizedString;
  price: number;
  isDefault?: boolean;
  size?: LocalizedString;
}


export interface Supplier {
  id: string;
  name: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  taxNumber?: string;
  address?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface SupplierContract {
  id: string;
  supplierId: string;
  contractNumber?: string;
  startDate: string;
  endDate: string;
  paymentTerms?: 'cash' | 'net15' | 'net30' | 'net45' | 'net60' | 'custom';
  paymentTermsCustom?: string;
  deliveryLeadTimeDays?: number;
  minimumOrderAmount?: number;
  documentUrl?: string;
  status: 'active' | 'expired' | 'terminated' | 'draft';
  notes?: string;
  createdAt: string;
  updatedAt?: string;
  createdBy?: string;
}

export interface SupplierEvaluation {
  id: string;
  supplierId: string;
  evaluationDate: string;
  periodStart?: string;
  periodEnd?: string;
  qualityScore?: number; // 1-5
  timelinessScore?: number; // 1-5
  pricingScore?: number; // 1-5
  communicationScore?: number; // 1-5
  overallScore: number;
  notes?: string;
  recommendation?: 'maintain' | 'improve' | 'terminate';
  createdAt: string;
  updatedAt?: string;
  createdBy?: string;
}

export interface ImportShipment {
  id: string;
  referenceNumber: string;
  supplierId?: string;
  status: 'draft' | 'ordered' | 'shipped' | 'at_customs' | 'cleared' | 'delivered' | 'cancelled';
  originCountry?: string;
  destinationWarehouseId?: string;
  shippingCarrier?: string;
  trackingNumber?: string;
  departureDate?: string;
  expectedArrivalDate?: string;
  actualArrivalDate?: string;
  totalWeightKg?: number;
  notes?: string;
  createdAt: string;
  updatedAt?: string;
  createdBy?: string;
  items?: ImportShipmentItem[];
  expenses?: ImportExpense[];
}

export interface ImportShipmentItem {
  id: string;
  shipmentId: string;
  itemId: string;
  quantity: number;
  unitPriceFob: number;
  currency?: string;
  expiryDate?: string;
  landingCostPerUnit?: number;
  notes?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface ImportExpense {
  id: string;
  shipmentId: string;
  expenseType: 'shipping' | 'customs' | 'insurance' | 'clearance' | 'transport' | 'other';
  amount: number;
  currency: string;
  exchangeRate: number;
  description?: string;
  invoiceNumber?: string;
  paidAt?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface PurchaseItem {
  id: string;
  purchaseOrderId: string;
  itemId: string; // Links to Menu Item
  itemName?: string; // For display
  quantity: number;
  receivedQuantity?: number;
  unitCost: number;
  totalCost: number;
}

export interface PurchaseOrder {
  id: string;
  supplierId: string;
  supplierName?: string; // For display
  status: 'draft' | 'partial' | 'completed' | 'cancelled';
  referenceNumber?: string;
  totalAmount: number;
  paidAmount: number;
  purchaseDate: string;
  itemsCount: number;
  notes?: string;
  createdBy: string; // User ID
  createdAt: string;
  updatedAt?: string;
  items?: PurchaseItem[];
  hasReturns?: boolean;
}

export interface CashShift {
  id: string;
  cashierId: string;
  openedAt: string;
  closedAt?: string;
  startAmount: number;
  endAmount?: number;
  expectedAmount?: number;
  difference?: number;
  status: 'open' | 'closed';
  notes?: string;
}

export interface MenuItem {
  id: string;
  name: LocalizedString;
  description: LocalizedString;
  barcode?: string;
  sellable?: boolean;
  price: number; // Price per unit (per kg, per piece, etc.)
  imageUrl: string;
  category: string;
  addons?: Addon[];
  status?: 'active' | 'archived';
  isFeatured?: boolean;
  rating?: {
    average: number;
    count: number;
  };
  // New fields for weight-based products
  unitType?: UnitType; // Type of unit (kg, piece, bundle, gram)
  pricePerUnit?: number; // Price per unit (if different from price)
  minWeight?: number; // Minimum weight/quantity to order
  availableStock?: number; // Available quantity in stock
  productionDate?: string; // Date of production/manufacture (ISO string)
  expiryDate?: string; // Expiry date (ISO string)
  freshnessLevel?: FreshnessLevel; // Current freshness level
  costPrice?: number; // Total Cost price (Buying + Transport + Tax)
  buyingPrice?: number; // Base purchase price
  transportCost?: number; // Cost of transport
  supplyTaxCost?: number; // Input Tax / Supply Tax
}

export interface StockWastage {
  id: string;
  itemId: string;
  quantity: number;
  unitType?: string;
  costAtTime: number;
  reason: string;
  notes?: string;
  reportedBy?: string;
  createdAt: string;
}

export interface SalesReturnItem {
  itemId: string;
  itemName: string;
  quantity: number;
  unitPrice: number;
  total: number;
  reason?: string;
}

export interface SalesReturn {
  id: string;
  orderId: string;
  returnDate: string; // ISO string
  reason?: string;
  refundMethod?: 'cash' | 'network' | 'kuraimi';
  totalRefundAmount: number;
  items: SalesReturnItem[];
  status: 'draft' | 'completed' | 'cancelled';
  createdBy?: string;
  createdAt: string;
}

export interface SystemAuditLog {
  id: string;
  action: string;
  module: string; // 'settings', 'inventory', 'orders', etc.
  details: string;
  performedBy: string;
  performedAt: string;
  ipAddress?: string;
  metadata?: Record<string, any>;
  riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
  reasonCode?: string;
}

export interface CartItem extends MenuItem {
  quantity: number; // Number of units (pieces, bundles) or weight (kg)
  selectedAddons: Record<string, { addon: Addon; quantity: number }>;
  cartItemId: string;
  lineDiscountType?: 'amount' | 'percent';
  lineDiscountValue?: number;
  lineType?: 'menu' | 'promotion';
  promotionId?: string;
  promotionLineId?: string;
  promotionSnapshot?: PromotionApplicationSnapshot;
  // New fields for weight-based products
  weight?: number; // Weight in kg or grams (if unitType is weight-based)
  unit?: UnitType; // Unit type for this cart item
}

export type OrderStatus = 'pending' | 'preparing' | 'out_for_delivery' | 'delivered' | 'scheduled' | 'cancelled';

export interface Order {
  id: string;
  userId?: string;
  orderSource?: 'online' | 'in_store';
  warehouseId?: string;
  offlineId?: string;
  offlineState?: 'CREATED_OFFLINE' | 'SYNCED' | 'DELIVERED' | 'FAILED' | 'CONFLICT';
  offlineError?: string;
  offlineSyncedAt?: string;
  items: CartItem[];
  subtotal: number;
  deliveryFee: number;
  deliveryZoneId?: string;
  total: number;
  customerName: string;
  phoneNumber: string;
  notes?: string;
  address: string;
  location?: {
    lat: number;
    lng: number;
  };
  paymentMethod: string;
  paymentBreakdown?: Array<{
    method: string;
    amount: number;
    referenceNumber?: string;
    senderName?: string;
    senderPhone?: string;
    cashReceived?: number;
    cashChange?: number;
  }>;
  cashReceived?: number;
  cashChange?: number;
  paymentBank?: {
    bankId: string;
    bankName: string;
    accountName: string;
    accountNumber: string;
  };
  paymentNetworkRecipient?: {
    recipientId: string;
    recipientName: string;
    recipientPhoneNumber: string;
  };
  paymentProofType?: 'image' | 'ref_number';
  paymentProof?: string; // base64 string for image, or reference number
  paymentSenderName?: string;
  paymentSenderPhone?: string;
  paymentDeclaredAmount?: number;
  paymentVerifiedBy?: string;
  paymentVerifiedAt?: string;
  deliveryInstructions?: string;
  assignedDeliveryUserId?: string;
  deliveryAcceptedAt?: string;
  deliveryAcceptedBy?: string;
  outForDeliveryAt?: string;
  deliveredBy?: string;
  deliveryPin?: string;
  deliveredLocation?: {
    lat: number;
    lng: number;
    accuracy?: number;
  };
  status: OrderStatus;
  createdAt: string; // Can be a Date object or a Firestore Timestamp
  deliveredAt?: string;
  cancelledAt?: string;
  paidAt?: string;
  invoiceIssuedAt?: string;
  invoiceNumber?: string;
  invoicePrintCount?: number;
  invoiceLastPrintedAt?: string;
  invoiceSnapshot?: {
    issuedAt: string;
    invoiceNumber: string;
    createdAt: string;
    orderSource?: 'online' | 'in_store';
    items: CartItem[];
    subtotal: number;
    deliveryFee: number;
    discountAmount?: number;
    total: number;
    paymentMethod: string;
    paymentBreakdown?: Array<{
      method: string;
      amount: number;
      referenceNumber?: string;
      senderName?: string;
      senderPhone?: string;
      cashReceived?: number;
      cashChange?: number;
    }>;
    cashReceived?: number;
    cashChange?: number;
    paymentBank?: {
      bankId: string;
      bankName: string;
      accountName: string;
      accountNumber: string;
    };
    paymentNetworkRecipient?: {
      recipientId: string;
      recipientName: string;
      recipientPhoneNumber: string;
    };
    paymentProofType?: 'image' | 'ref_number';
    paymentProof?: string;
    paymentSenderName?: string;
    paymentSenderPhone?: string;
    paymentDeclaredAmount?: number;
    paymentVerifiedBy?: string;
    paymentVerifiedAt?: string;
    customerName: string;
    phoneNumber: string;
    address: string;
    deliveryZoneId?: string;
    taxAmount?: number;
    taxRate?: number;
  };
  appliedCouponCode?: string;
  discountAmount?: number;
  pointsEarned?: number;
  pointsRedeemedValue?: number;
  reviewPointsAwarded?: boolean;
  referralDiscount?: number;
  isScheduled?: boolean;
  scheduledAt?: string; // ISO string
  taxAmount?: number;
  taxRate?: number;
}

export interface User {
  id: string;
  username: string;
  fullName: string;
  email: string;
  phoneNumber: string;
  avatarUrl: string;
}

export type LoyaltyTier = 'regular' | 'bronze' | 'silver' | 'gold';

export interface Customer {
  id: string;
  phoneNumber?: string;
  email?: string;
  fullName?: string;
  avatarUrl?: string;
  authProvider: 'password' | 'phone' | 'google';
  passwordSalt?: string;
  passwordHash?: string;
  loginIdentifier?: string;
  requirePasskey?: boolean;
  loyaltyPoints: number;
  loyaltyTier: LoyaltyTier;
  totalSpent: number;
  referralCode?: string;
  referredBy?: string; // Code of the user who referred them
  firstOrderDiscountApplied?: boolean;
  savedAddresses?: {
    id: string;
    label: string;
    address: string;
    location?: { lat: number; lng: number };
    deliveryInstructions?: string;
    createdAt: string;
  }[];
}


export interface AppSettings {
  cafeteriaName: LocalizedString;
  logoUrl: string;
  contactNumber: string;
  address: string;
  maintenanceEnabled?: boolean;
  maintenanceMessage?: string;
  brandColors?: {
    primary: string;
    gold: string;
    mint: string;
  };
  posFlags?: {
    barcodeScanEnabled?: boolean;
    autoPrintThermalEnabled?: boolean;
    thermalCopies?: number;
  };
  inventoryFlags?: {
    autoArchiveExpired?: boolean;
  };
  paymentMethods: {
    cash: boolean;
    network: boolean;
    kuraimi: boolean;
  };
  defaultLanguage: 'ar' | 'en';
  loyaltySettings: {
    enabled: boolean;
    pointsPerCurrencyUnit: number; // e.g., 0.1 for 1 point per 10 currency
    currencyValuePerPoint: number; // e.g., 1 for 1 point = 1 YER
    tiers: {
      regular: { name: LocalizedString; threshold: number; discountPercentage: number; };
      bronze: { name: LocalizedString; threshold: number; discountPercentage: number; };
      silver: { name: LocalizedString; threshold: number; discountPercentage: number; };
      gold: { name: LocalizedString; threshold: number; discountPercentage: number; };
    };
    referralRewardPoints: number; // Points for the referrer
    newUserReferralDiscount: {
      type: 'percentage' | 'fixed';
      value: number;
    };
  };
  taxSettings?: {
    enabled: boolean;
    rate: number; // Percentage
    taxNumber?: string;
  };
  accounting_accounts?: {
    sales?: string;
    sales_returns?: string;
    inventory?: string;
    cogs?: string;
    ar?: string;
    ap?: string;
    vat_payable?: string;
    vat_recoverable?: string;
    cash?: string;
    bank?: string;
    deposits?: string;
    expenses?: string;
    shrinkage?: string;
    gain?: string;
    delivery_income?: string;
    sales_discounts?: string;
    over_short?: string;
  };
}

export interface Review {
  id: string;
  userId: string;
  menuItemId: string;
  userName: string;
  userAvatarUrl?: string;
  rating: number; // 1-5
  comment?: string;
  createdAt: string; // ISO string
}

export interface Coupon {
  id: string;
  code: string;
  type: 'percentage' | 'fixed';
  value: number;
  minOrderAmount?: number;
  maxDiscount?: number;
  expiresAt?: string; // ISO string
  usageLimit?: number;
  usageCount?: number;
  isActive: boolean;
}

export interface PromotionItem {
  id?: string;
  itemId: string;
  quantity: number;
  sortOrder?: number;
}

export type PromotionDiscountMode = 'fixed_total' | 'percent_off';

export interface Promotion {
  id: string;
  name: string;
  imageUrl?: string;
  startAt: string;
  endAt: string;
  isActive: boolean;
  discountMode: PromotionDiscountMode;
  fixedTotal?: number;
  percentOff?: number;
  displayOriginalTotal?: number;
  maxUses?: number;
  exclusiveWithCoupon?: boolean;
  requiresApproval?: boolean;
  approvalStatus?: 'pending' | 'approved' | 'rejected';
  approvalRequestId?: string | null;
  items: PromotionItem[];
}

export interface PromotionApplicationSnapshot {
  promotionId: string;
  name: string;
  imageUrl?: string | null;
  startAt: string;
  endAt: string;
  bundleQty: number;
  displayOriginalTotal?: number | null;
  computedOriginalTotal: number;
  finalTotal: number;
  promotionExpense: number;
  items: Array<{
    itemId: string;
    quantity: number;
    unitPrice: number;
    grossTotal: number;
  }>;
  revenueAllocation: Array<{
    itemId: string;
    quantity: number;
    unitPrice: number;
    grossTotal: number;
    allocatedRevenue: number;
    allocatedRevenuePct: number;
  }>;
  warehouseId: string;
  customerId?: string | null;
  appliedAt: string;
}

export interface Ad {
  id: string;
  title: LocalizedString;
  subtitle: LocalizedString;
  imageUrl: string;
  actionType: 'none' | 'item' | 'category' | 'promotion';
  actionTarget?: string; // Will hold item ID or category name
  order: number;
  status: 'active' | 'inactive';
}


export interface Challenge {
  id: string;
  title: LocalizedString;
  description: LocalizedString;
  type: 'category_count' | 'distinct_items';
  targetCategory?: string;
  targetCount: number;
  rewardType: 'points';
  rewardValue: number;
  startDate: string; // ISO string
  endDate: string; // ISO string
  status: 'active' | 'inactive';
}

export interface UserChallengeProgress {
  id: string; // userId_challengeId
  userId: string;
  challengeId: string;
  currentProgress: number;
  isCompleted: boolean;
  rewardClaimed: boolean;
  // For 'distinct_items' type
  _completedItems?: string[];
}

// Stock Management for inventory tracking
export interface StockManagement {
  id: string; // itemId
  itemId: string;
  availableQuantity: number; // Available quantity in stock
  unit: UnitType; // Unit type (kg, piece, bundle, gram)
  reservedQuantity: number; // Reserved in active orders
  lastUpdated: string; // ISO string
  lowStockThreshold?: number; // Alert when stock is low
  avgCost?: number;
  lastBatchId?: string;
}

export interface InventoryMovement {
  id: string;
  itemId: string;
  movementType: 'purchase_in' | 'sale_out' | 'wastage_out' | 'adjust_in' | 'adjust_out' | 'return_in' | 'return_out';
  quantity: number;
  unitCost: number;
  totalCost: number;
  referenceTable?: string;
  referenceId?: string;
  occurredAt: string;
  createdBy?: string;
  createdAt: string;
  batchId?: string;
  warehouseId?: string;
}

export interface ItemBatch {
  batchId: string;
  occurredAt: string;
  unitCost: number;
  receivedQuantity: number;
  consumedQuantity: number;
  remainingQuantity: number;
}

export interface OrderItemCogs {
  id: string;
  orderId: string;
  itemId: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  createdAt: string;
}

export interface AccountingLightEntry {
  id: string;
  entryType: 'wastage' | 'expiry';
  itemId: string;
  warehouseId?: string;
  batchId?: string;
  quantity: number;
  unit?: string;
  unitCost: number;
  totalCost: number;
  occurredAt: string;
  debitAccount: string;
  creditAccount: string;
  createdBy?: string;
  createdAt: string;
  notes?: string;
  sourceRef?: string;
}

export interface Payment {
  id: string;
  direction: 'in' | 'out';
  method: string;
  amount: number;
  currency: string;
  referenceTable?: string;
  referenceId?: string;
  occurredAt: string;
  createdBy?: string;
  createdAt: string;
}

// Price History for tracking price changes
export interface PriceHistory {
  id: string;
  itemId: string;
  price: number;
  date: string; // ISO string
  reason?: string; // Reason for price change
  changedBy?: string; // Admin who changed the price
}

export interface StockHistory {
  id: string;
  itemId: string;
  quantity: number;
  unit: UnitType;
  date: string;
  reason: string;
  changedBy?: string;
}

// Delivery Zones for area-based delivery
export interface DeliveryZone {
  id: string;
  name: LocalizedString;
  deliveryFee: number;
  estimatedTime: number; // Estimated delivery time in minutes
  isActive: boolean;
  coordinates?: {
    lat: number;
    lng: number;
    radius: number; // Radius in meters
  };
  statistics?: {
    totalOrders: number;
    totalRevenue: number;
    averageDeliveryTime: number; // Average actual delivery time in minutes
    lastOrderDate?: string;
  };
}

export interface Bank {
  id: string;
  name: string;
  accountName: string;
  accountNumber: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TransferRecipient {
  id: string;
  name: string;
  phoneNumber: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type AdminRole = 'owner' | 'manager' | 'employee' | 'cashier' | 'delivery' | 'accountant';

export type AdminPermission =
  | 'dashboard.view'
  | 'profile.view'
  | 'orders.view'
  | 'orders.cancel'
  | 'orders.markPaid'
  | 'orders.createInStore'
  | 'orders.updateStatus.all'
  | 'orders.updateStatus.delivery'
  | 'cashShifts.open'
  | 'cashShifts.viewOwn'
  | 'cashShifts.closeSelf'
  | 'cashShifts.cashIn'
  | 'cashShifts.cashOut'
  | 'cashShifts.manage'
  | 'deliveryZones.manage'
  | 'items.manage'
  | 'addons.manage'
  | 'ads.manage'
  | 'customers.manage'
  | 'coupons.manage'
  | 'promotions.manage'
  | 'reviews.manage'
  | 'stock.manage'
  | 'prices.manage'
  | 'reports.view'
  | 'settings.manage'
  | 'approvals.manage'
  | 'adminUsers.manage'
  | 'challenges.manage'
  | 'expenses.manage'
  | 'accounting.view'
  | 'accounting.manage'
  | 'accounting.periods.close'
  | 'accounting.approve'
  | 'accounting.void';

export const ADMIN_PERMISSION_DEFS: Array<{ key: AdminPermission; labelAr: string }> = [
  { key: 'dashboard.view', labelAr: 'عرض لوحة المعلومات' },
  { key: 'profile.view', labelAr: 'عرض الملف الشخصي' },
  { key: 'orders.view', labelAr: 'عرض الطلبات' },
  { key: 'orders.cancel', labelAr: 'إلغاء الطلبات' },
  { key: 'orders.markPaid', labelAr: 'تأكيد الدفع/التحصيل' },
  { key: 'orders.createInStore', labelAr: 'إضافة بيع حضوري' },
  { key: 'orders.updateStatus.all', labelAr: 'تغيير حالة الطلبات (كامل)' },
  { key: 'orders.updateStatus.delivery', labelAr: 'تغيير حالة الطلبات (مندوب)' },
  { key: 'cashShifts.open', labelAr: 'فتح وردية نقدية' },
  { key: 'cashShifts.viewOwn', labelAr: 'عرض ورديتي' },
  { key: 'cashShifts.closeSelf', labelAr: 'إغلاق ورديتي' },
  { key: 'cashShifts.cashIn', labelAr: 'إيداع نقدي داخل الوردية' },
  { key: 'cashShifts.cashOut', labelAr: 'صرف نقدي داخل الوردية' },
  { key: 'cashShifts.manage', labelAr: 'إدارة ورديات النقد (فتح/إغلاق)' },
  { key: 'deliveryZones.manage', labelAr: 'إدارة مناطق التوصيل' },
  { key: 'items.manage', labelAr: 'إدارة الأصناف' },
  { key: 'addons.manage', labelAr: 'إدارة الإضافات' },
  { key: 'ads.manage', labelAr: 'إدارة الإعلانات' },
  { key: 'customers.manage', labelAr: 'إدارة العملاء' },
  { key: 'coupons.manage', labelAr: 'إدارة الكوبونات' },
  { key: 'promotions.manage', labelAr: 'إدارة العروض' },
  { key: 'reviews.manage', labelAr: 'إدارة المراجعات' },
  { key: 'stock.manage', labelAr: 'إدارة المخزون' },
  { key: 'prices.manage', labelAr: 'إدارة الأسعار' },
  { key: 'reports.view', labelAr: 'عرض التقارير' },
  { key: 'settings.manage', labelAr: 'إدارة الإعدادات' },
  { key: 'approvals.manage', labelAr: 'إدارة الموافقات' },
  { key: 'adminUsers.manage', labelAr: 'إدارة مستخدمي لوحة التحكم' },
  { key: 'challenges.manage', labelAr: 'إدارة التحديات' },
  { key: 'expenses.manage', labelAr: 'إدارة المصاريف' },
  { key: 'accounting.view', labelAr: 'عرض المحاسبة' },
  { key: 'accounting.manage', labelAr: 'إدارة المحاسبة' },
  { key: 'accounting.periods.close', labelAr: 'إقفال الفترات المحاسبية' },
  { key: 'accounting.approve', labelAr: 'اعتماد القيود المحاسبية' },
  { key: 'accounting.void', labelAr: 'عكس/إلغاء القيود المحاسبية' },
];

export const defaultAdminPermissionsForRole = (role: AdminRole): AdminPermission[] => {
  const allPermissions: AdminPermission[] = ADMIN_PERMISSION_DEFS.map(def => def.key);

  if (role === 'owner' || role === 'manager') return allPermissions;
  if (role === 'accountant') return [
    'dashboard.view',
    'profile.view',
    'reports.view',
    'expenses.manage',
    'accounting.view',
    'accounting.manage',
    'accounting.periods.close',
  ];
  if (role === 'delivery') return ['profile.view', 'orders.view', 'orders.updateStatus.delivery'];
  if (role === 'cashier') return [
    'dashboard.view',
    'profile.view',
    'orders.view',
    'orders.markPaid',
    'orders.createInStore',
    'cashShifts.open',
    'cashShifts.viewOwn',
    'cashShifts.closeSelf',
    'cashShifts.cashIn',
    'cashShifts.cashOut',
  ];

  return ['dashboard.view', 'profile.view', 'orders.view', 'orders.markPaid'];
};

export interface AdminUser {
  id: string;
  username: string;
  fullName: string;
  email?: string;
  phoneNumber?: string;
  avatarUrl?: string;
  role: AdminRole;
  permissions?: AdminPermission[];
  isActive: boolean;
  passwordSalt: string;
  passwordHash: string;
  createdAt: string;
  updatedAt: string;
}

export type AppTheme = 'light' | 'dark';
export type AppLanguage = 'ar' | 'en';

export interface PersistedAppSettings {
  id: 'app';
  settings: AppSettings;
  theme: AppTheme;
  customerLanguage: AppLanguage;
  adminLanguage: AppLanguage;
  updatedAt: string;
}

export interface AdminSession {
  id: 'current';
  adminUserId: string;
  createdAt: string;
}

export type OrderAuditActorType = 'customer' | 'admin' | 'system';

export type OrderAuditAction =
  | 'order.created'
  | 'order.assignedDelivery'
  | 'order.unassignedDelivery'
  | 'order.deliveryAccepted'
  | 'order.statusChanged'
  | 'order.paymentRecorded'
  | 'order.markedPaid'
  | 'order.invoiceIssued'
  | 'order.invoicePrinted';

export interface OrderAuditEvent {
  id: string;
  orderId: string;
  action: OrderAuditAction;
  actorType: OrderAuditActorType;
  actorId?: string;
  fromStatus?: OrderStatus;
  toStatus?: OrderStatus;
  createdAt: string;
  payload?: Record<string, unknown>;
}

export interface Notification {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error' | 'order_update' | 'promo';
  link?: string;
  isRead: boolean;
  createdAt: string;
}

export interface Expense {
  id: string;
  title: string;
  amount: number;
  category: 'rent' | 'salary' | 'utilities' | 'marketing' | 'maintenance' | 'other';
  date: string; // ISO date string YYYY-MM-DD
  notes?: string;
  cost_center_id?: string;
  createdAt: string;
}

export interface CostCenter {
  id: string;
  name: string;
  code?: string;
  description?: string;
  isActive: boolean;
  createdAt: string;
}

// ==========================================
// Warehouses and Multi-location
// ==========================================

export interface Warehouse {
  id: string;
  code: string;
  name: string;
  type: 'main' | 'branch' | 'incoming' | 'cold_storage';
  location?: string;
  address?: string;
  managerId?: string;
  phone?: string;
  isActive: boolean;
  capacityLimit?: number;
  notes?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface WarehouseTransfer {
  id: string;
  transferNumber: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  transferDate: string;
  status: 'pending' | 'in_transit' | 'completed' | 'cancelled';
  notes?: string;
  createdBy?: string;
  approvedBy?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt?: string;
  // For display
  fromWarehouseName?: string;
  toWarehouseName?: string;
  items?: WarehouseTransferItem[];
}

export interface WarehouseTransferItem {
  id: string;
  transferId: string;
  itemId: string;
  quantity: number;
  transferredQuantity: number;
  notes?: string;
  // For display
  itemName?: string;
}

// ==========================================
// Pricing System
// ==========================================

export type CustomerType = 'retail' | 'wholesale' | 'distributor' | 'vip';
export type PaymentTerms = 'cash' | 'net_7' | 'net_15' | 'net_30' | 'net_60' | 'net_90';

export interface PriceTier {
  id: string;
  itemId: string;
  customerType: CustomerType;
  minQuantity: number;
  maxQuantity?: number;
  price: number;
  discountPercentage?: number;
  isActive: boolean;
  validFrom?: string;
  validTo?: string;
  notes?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface CustomerSpecialPrice {
  id: string;
  customerId: string;
  itemId: string;
  specialPrice: number;
  validFrom: string;
  validTo?: string;
  notes?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt?: string;
}
