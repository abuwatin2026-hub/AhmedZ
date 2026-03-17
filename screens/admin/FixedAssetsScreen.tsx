import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { getSupabaseClient } from '../../supabase';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import NumberInput from '../../components/NumberInput';
import { toDateInputValue } from '../../utils/dateUtils';

type AssetCategory = {
  id: string;
  code: string;
  name_ar: string;
  name_en: string | null;
  account_code: string;
  depreciation_method: string;
  default_useful_life_months: number;
  default_salvage_pct: number;
  is_active: boolean;
};

type FixedAsset = {
  id: string;
  asset_code: string;
  name_ar: string;
  name_en: string | null;
  category_id: string;
  acquisition_date: string;
  acquisition_cost: number;
  capitalized_costs: number;
  salvage_value: number;
  useful_life_months: number;
  depreciation_method: string;
  status: string;
  location: string | null;
  serial_number: string | null;
  warehouse_id?: string | null;
  impairment_accumulated?: number;
  notes: string | null;
  created_at: string;
};

type AssetSummary = {
  totalAssets: number;
  disposedAssets: number;
  totalCost: number;
  totalAccumulatedDepreciation: number;
  netBookValue: number;
  categorySummary: Array<{ category: string; count: number; totalCost: number }>;
};

type DepreciationEntry = {
  id: string;
  asset_id: string;
  period_start: string;
  period_end: string;
  depreciation_amount: number;
  accumulated_total: number;
  book_value: number;
};

type AssetComponent = {
  id: string;
  asset_id: string;
  component_code: string;
  name_ar: string;
  acquisition_date: string;
  cost: number;
  salvage_value: number;
  useful_life_months: number;
  depreciation_method: string;
  accumulated_depreciation: number;
  impairment_accumulated: number;
  status: string;
  notes: string | null;
};

const fmtAmount = (n: number) => {
  const v = Number(n || 0);
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const fmtDate = (iso: string) => {
  try { return new Date(iso).toLocaleDateString('en-GB'); }
  catch { return iso; }
};

const statusLabels: Record<string, { label: string; color: string }> = {
  active: { label: 'نشط', color: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300' },
  disposed: { label: 'مستبعد', color: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300' },
  fully_depreciated: { label: 'مهلك بالكامل', color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300' },
};

const methodLabels: Record<string, string> = {
  straight_line: 'القسط الثابت',
  declining_balance: 'القسط المتناقص',
};

export default function FixedAssetsScreen() {
  const { showNotification } = useToast();
  const { hasPermission } = useAuth();
  const canManage = hasPermission('accounting.manage');

  const [assets, setAssets] = useState<FixedAsset[]>([]);
  const [categories, setCategories] = useState<AssetCategory[]>([]);
  const [summary, setSummary] = useState<AssetSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterCategory, setFilterCategory] = useState<string>('all');

  // Modals
  const [showRegister, setShowRegister] = useState(false);
  const [showCapitalize, setShowCapitalize] = useState(false);
  const [showDispose, setShowDispose] = useState(false);
  const [showDepreciation, setShowDepreciation] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [showComponents, setShowComponents] = useState(false);
  const [showReplaceComponent, setShowReplaceComponent] = useState(false);
  const [showImpairment, setShowImpairment] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<FixedAsset | null>(null);
  const [deprEntries, setDeprEntries] = useState<DepreciationEntry[]>([]);
  const [components, setComponents] = useState<AssetComponent[]>([]);
  const [selectedComponent, setSelectedComponent] = useState<AssetComponent | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // Register form
  const [regForm, setRegForm] = useState({
    name_ar: '',
    category_code: 'other',
    acquisition_date: toDateInputValue(),
    acquisition_cost: 0,
    payment_method: 'cash',
    useful_life_months: 60,
    salvage_value: 0,
    location: '',
    serial_number: '',
    notes: '',
  });

  // Capitalize form
  const [capAmount, setCapAmount] = useState(0);
  const [capDescription, setCapDescription] = useState('');
  const [capMethod, setCapMethod] = useState('cash');

  // Dispose form
  const [dispAmount, setDispAmount] = useState(0);
  const [dispMethod, setDispMethod] = useState('scrap');
  const [dispReason, setDispReason] = useState('');

  // Depreciation
  const now = new Date();
  const [deprYear, setDeprYear] = useState(now.getFullYear());
  const [deprMonth, setDeprMonth] = useState(now.getMonth() + 1);
  const [impairAmount, setImpairAmount] = useState(0);
  const [impairDate, setImpairDate] = useState(toDateInputValue());
  const [impairReason, setImpairReason] = useState('');
  const [transferDate, setTransferDate] = useState(toDateInputValue());
  const [transferLocation, setTransferLocation] = useState('');
  const [transferReason, setTransferReason] = useState('');
  const [componentForm, setComponentForm] = useState({
    name_ar: '',
    cost: 0,
    useful_life_months: 60,
    acquisition_date: toDateInputValue(),
    salvage_value: 0,
    depreciation_method: 'straight_line',
    notes: '',
  });
  const [replaceForm, setReplaceForm] = useState({
    new_name_ar: '',
    new_cost: 0,
    new_useful_life_months: 60,
    replacement_date: toDateInputValue(),
    payment_method: 'cash',
    new_salvage_value: 0,
    new_depreciation_method: 'straight_line',
    reason: '',
  });

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = getSupabaseClient();
      if (!supabase) return;

      const [catRes, assetRes, summRes] = await Promise.all([
        supabase.from('fixed_asset_categories').select('*').eq('is_active', true).order('code'),
        supabase.from('fixed_assets').select('*').order('asset_code', { ascending: true }),
        supabase.rpc('get_fixed_assets_summary'),
      ]);

      if (catRes.data) setCategories(catRes.data);
      if (assetRes.data) setAssets(assetRes.data);
      if (summRes.data) setSummary(typeof summRes.data === 'string' ? JSON.parse(summRes.data) : summRes.data);
    } catch (e: any) {
      console.error('Failed to load assets', e);
      showNotification('فشل تحميل الأصول الثابتة', 'error');
    } finally {
      setLoading(false);
    }
  }, [showNotification]);

  useEffect(() => { void fetchAll(); }, [fetchAll]);

  const filteredAssets = useMemo(() => {
    return assets.filter(a => {
      if (filterStatus !== 'all' && a.status !== filterStatus) return false;
      if (filterCategory !== 'all' && a.category_id !== filterCategory) return false;
      return true;
    });
  }, [assets, filterStatus, filterCategory]);

  useEffect(() => {
    setPage(1);
  }, [filterStatus, filterCategory, assets.length, pageSize]);

  const totalPages = useMemo(() => {
    const n = Math.ceil(filteredAssets.length / pageSize);
    return Math.max(1, n);
  }, [filteredAssets.length, pageSize]);

  const pagedAssets = useMemo(() => {
    const safePage = Math.min(Math.max(page, 1), totalPages);
    const start = (safePage - 1) * pageSize;
    return filteredAssets.slice(start, start + pageSize);
  }, [filteredAssets, page, pageSize, totalPages]);


  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const supabase = getSupabaseClient();
      if (!supabase) return;

      const { error } = await supabase.rpc('register_fixed_asset', {
        p_name_ar: regForm.name_ar,
        p_category_code: regForm.category_code,
        p_acquisition_date: regForm.acquisition_date,
        p_acquisition_cost: regForm.acquisition_cost,
        p_payment_method: regForm.payment_method,
        p_useful_life_months: regForm.useful_life_months,
        p_salvage_value: regForm.salvage_value,
        p_location: regForm.location || null,
        p_serial_number: regForm.serial_number || null,
        p_notes: regForm.notes || null,
      });

      if (error) throw error;
      showNotification('تم تسجيل الأصل بنجاح ✅', 'success');
      setShowRegister(false);
      setRegForm({
        name_ar: '', category_code: 'other', acquisition_date: toDateInputValue(),
        acquisition_cost: 0, payment_method: 'cash', useful_life_months: 60,
        salvage_value: 0, location: '', serial_number: '', notes: '',
      });
      void fetchAll();
    } catch (e: any) {
      showNotification(e?.message || 'فشل تسجيل الأصل', 'error');
    }
  };

  const handleCapitalize = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAsset) return;
    try {
      const supabase = getSupabaseClient();
      if (!supabase) return;
      const { error } = await supabase.rpc('capitalize_asset_cost', {
        p_asset_id: selectedAsset.id,
        p_amount: capAmount,
        p_description: capDescription || null,
        p_payment_method: capMethod,
      });
      if (error) throw error;
      showNotification('تم رسملة التكلفة بنجاح ✅', 'success');
      setShowCapitalize(false);
      setCapAmount(0); setCapDescription(''); setCapMethod('cash');
      void fetchAll();
    } catch (e: any) {
      showNotification(e?.message || 'فشل رسملة التكلفة', 'error');
    }
  };

  const handleDispose = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAsset) return;
    try {
      const supabase = getSupabaseClient();
      if (!supabase) return;
      const { error } = await supabase.rpc('dispose_fixed_asset', {
        p_asset_id: selectedAsset.id,
        p_disposal_amount: dispAmount,
        p_disposal_method: dispMethod,
        p_reason: dispReason || null,
      });
      if (error) throw error;
      showNotification('تم استبعاد الأصل بنجاح ✅', 'success');
      setShowDispose(false);
      setDispAmount(0); setDispMethod('scrap'); setDispReason('');
      void fetchAll();
    } catch (e: any) {
      showNotification(e?.message || 'فشل استبعاد الأصل', 'error');
    }
  };

  const handleRunDepreciation = async () => {
    try {
      const supabase = getSupabaseClient();
      if (!supabase) return;
      const { data, error } = await supabase.rpc('run_monthly_depreciation', {
        p_year: deprYear,
        p_month: deprMonth,
      });
      if (error) throw error;
      const count = Number(data || 0);
      showNotification(`تم احتساب الإهلاك لـ ${count} أصل ✅`, 'success');
      setShowDepreciation(false);
      void fetchAll();
    } catch (e: any) {
      showNotification(e?.message || 'فشل احتساب الإهلاك', 'error');
    }
  };

  const handleImpairment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAsset) return;
    try {
      const supabase = getSupabaseClient();
      if (!supabase) return;
      const { error } = await supabase.rpc('post_asset_impairment', {
        p_asset_id: selectedAsset.id,
        p_impairment_amount: impairAmount,
        p_reason: impairReason || null,
        p_impairment_date: impairDate,
      });
      if (error) throw error;
      showNotification('تم ترحيل انخفاض القيمة بنجاح ✅', 'success');
      setShowImpairment(false);
      setImpairAmount(0);
      setImpairDate(toDateInputValue());
      setImpairReason('');
      void fetchAll();
    } catch (e: any) {
      showNotification(e?.message || 'فشل ترحيل انخفاض القيمة', 'error');
    }
  };

  const openComponents = async (asset: FixedAsset) => {
    setSelectedAsset(asset);
    setComponents([]);
    setComponentForm({
      name_ar: '',
      cost: 0,
      useful_life_months: 60,
      acquisition_date: toDateInputValue(),
      salvage_value: 0,
      depreciation_method: 'straight_line',
      notes: '',
    });
    setShowComponents(true);
    try {
      const supabase = getSupabaseClient();
      if (!supabase) return;
      const { data, error } = await supabase
        .from('fixed_asset_components')
        .select('*')
        .eq('asset_id', asset.id)
        .order('component_code', { ascending: true });
      if (error) throw error;
      setComponents((data as AssetComponent[]) || []);
    } catch (e: any) {
      showNotification(e?.message || 'فشل تحميل مكونات الأصل', 'error');
    }
  };

  const handleAddComponent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAsset) return;
    try {
      const supabase = getSupabaseClient();
      if (!supabase) return;
      const { error } = await supabase.rpc('add_asset_component', {
        p_asset_id: selectedAsset.id,
        p_name_ar: componentForm.name_ar,
        p_cost: componentForm.cost,
        p_useful_life_months: componentForm.useful_life_months,
        p_acquisition_date: componentForm.acquisition_date,
        p_salvage_value: componentForm.salvage_value,
        p_depreciation_method: componentForm.depreciation_method,
        p_notes: componentForm.notes || null,
      });
      if (error) throw error;
      showNotification('تمت إضافة المكوّن بنجاح ✅', 'success');
      await openComponents(selectedAsset);
      void fetchAll();
    } catch (e: any) {
      showNotification(e?.message || 'فشل إضافة مكوّن', 'error');
    }
  };

  const openReplaceComponent = (component: AssetComponent) => {
    setSelectedComponent(component);
    setReplaceForm({
      new_name_ar: component.name_ar,
      new_cost: component.cost,
      new_useful_life_months: component.useful_life_months,
      replacement_date: toDateInputValue(),
      payment_method: 'cash',
      new_salvage_value: component.salvage_value,
      new_depreciation_method: component.depreciation_method || 'straight_line',
      reason: '',
    });
    setShowReplaceComponent(true);
  };

  const handleReplaceComponent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedComponent || !selectedAsset) return;
    try {
      const supabase = getSupabaseClient();
      if (!supabase) return;
      const { error } = await supabase.rpc('replace_asset_component', {
        p_component_id: selectedComponent.id,
        p_new_name_ar: replaceForm.new_name_ar,
        p_new_cost: replaceForm.new_cost,
        p_new_useful_life_months: replaceForm.new_useful_life_months,
        p_replacement_date: replaceForm.replacement_date,
        p_payment_method: replaceForm.payment_method,
        p_new_salvage_value: replaceForm.new_salvage_value,
        p_new_depreciation_method: replaceForm.new_depreciation_method,
        p_reason: replaceForm.reason || null,
      });
      if (error) throw error;
      showNotification('تم استبدال المكوّن بنجاح ✅', 'success');
      setShowReplaceComponent(false);
      setSelectedComponent(null);
      await openComponents(selectedAsset);
      void fetchAll();
    } catch (e: any) {
      showNotification(e?.message || 'فشل استبدال المكوّن', 'error');
    }
  };

  const handleTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAsset) return;
    try {
      const supabase = getSupabaseClient();
      if (!supabase) return;
      const { error } = await supabase.rpc('transfer_fixed_asset', {
        p_asset_id: selectedAsset.id,
        p_new_location: transferLocation,
        p_new_warehouse_id: null,
        p_reason: transferReason || null,
        p_transfer_date: transferDate,
      });
      if (error) throw error;
      showNotification('تم نقل الأصل بنجاح ✅', 'success');
      setShowTransfer(false);
      setTransferDate(toDateInputValue());
      setTransferLocation('');
      setTransferReason('');
      void fetchAll();
    } catch (e: any) {
      showNotification(e?.message || 'فشل نقل الأصل', 'error');
    }
  };

  const openSchedule = async (asset: FixedAsset) => {
    setSelectedAsset(asset);
    setDeprEntries([]);
    setShowSchedule(true);
    try {
      const supabase = getSupabaseClient();
      if (!supabase) return;
      const { data, error } = await supabase
        .from('asset_depreciation_entries')
        .select('*')
        .eq('asset_id', asset.id)
        .order('period_start', { ascending: true });
      if (error) throw error;
      setDeprEntries(data || []);
    } catch (e) {
      console.error(e);
    }
  };

  const catMap = useMemo(() => {
    const m: Record<string, string> = {};
    categories.forEach(c => { m[c.id] = c.name_ar; });
    return m;
  }, [categories]);

  return (
    <div className="animate-fade-in p-4" dir="rtl">
      <div className="flex flex-wrap justify-between items-center mb-6 gap-3">
        <h1 className="text-3xl font-bold dark:text-white">🏢 الأصول الثابتة</h1>
        {canManage && (
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => setShowDepreciation(true)} className="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-lg text-sm font-bold">⏱ احتساب الإهلاك</button>
            <button onClick={() => setShowRegister(true)} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-bold">+ تسجيل أصل جديد</button>
          </div>
        )}
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 border-r-4 border-blue-500">
            <div className="text-sm text-gray-500 dark:text-gray-400">إجمالي الأصول</div>
            <div className="text-2xl font-bold dark:text-white">{summary.totalAssets}</div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 border-r-4 border-green-500">
            <div className="text-sm text-gray-500 dark:text-gray-400">إجمالي التكلفة</div>
            <div className="text-lg font-bold text-green-600">{fmtAmount(summary.totalCost)}</div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 border-r-4 border-amber-500">
            <div className="text-sm text-gray-500 dark:text-gray-400">مجمع الإهلاك</div>
            <div className="text-lg font-bold text-amber-600">{fmtAmount(summary.totalAccumulatedDepreciation)}</div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 border-r-4 border-purple-500">
            <div className="text-sm text-gray-500 dark:text-gray-400">القيمة الدفترية الصافية</div>
            <div className="text-lg font-bold text-purple-600">{fmtAmount(summary.netBookValue)}</div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 p-3 rounded-lg shadow mb-4 flex flex-wrap gap-3 items-center">
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white text-sm">
          <option value="all">كل الحالات</option>
          <option value="active">نشط</option>
          <option value="fully_depreciated">مهلك بالكامل</option>
          <option value="disposed">مستبعد</option>
        </select>
        <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} className="p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white text-sm">
          <option value="all">كل الفئات</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name_ar}</option>)}
        </select>
        <div className="mr-auto flex items-center gap-2">
          <div className="text-sm text-gray-500 dark:text-gray-400">{filteredAssets.length} أصل</div>
          <select value={pageSize} onChange={(e) => setPageSize(parseInt(e.target.value) || 20)} className="p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white text-xs">
            <option value={10}>10/صفحة</option>
            <option value={20}>20/صفحة</option>
            <option value={50}>50/صفحة</option>
          </select>
        </div>
      </div>

      {/* Assets Table */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-x-auto">
        <table className="min-w-[800px] w-full text-right">
          <thead className="bg-gray-50 dark:bg-gray-700">
            <tr>
              <th className="p-3 text-xs text-gray-600 dark:text-gray-300 border-r dark:border-gray-600">الكود</th>
              <th className="p-3 text-xs text-gray-600 dark:text-gray-300 border-r dark:border-gray-600">اسم الأصل</th>
              <th className="p-3 text-xs text-gray-600 dark:text-gray-300 border-r dark:border-gray-600">الفئة</th>
              <th className="p-3 text-xs text-gray-600 dark:text-gray-300 border-r dark:border-gray-600">تاريخ الاقتناء</th>
              <th className="p-3 text-xs text-gray-600 dark:text-gray-300 border-r dark:border-gray-600">التكلفة الإجمالية</th>
              <th className="p-3 text-xs text-gray-600 dark:text-gray-300 border-r dark:border-gray-600">العمر الإنتاجي</th>
              <th className="p-3 text-xs text-gray-600 dark:text-gray-300 border-r dark:border-gray-600">الحالة</th>
              <th className="p-3 text-xs text-gray-600 dark:text-gray-300">الإجراءات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {loading ? (
              <tr><td colSpan={8} className="p-8 text-center text-gray-500">جاري التحميل...</td></tr>
            ) : filteredAssets.length === 0 ? (
              <tr><td colSpan={8} className="p-8 text-center text-gray-500">لا توجد أصول ثابتة مسجلة</td></tr>
            ) : (
              pagedAssets.map(asset => {
                const totalCost = asset.acquisition_cost + asset.capitalized_costs;
                const st = statusLabels[asset.status] || statusLabels.active;
                const impair = Number((asset as any).impairment_accumulated || 0);
                return (
                  <tr key={asset.id} className="hover:bg-gray-50 dark:hover:bg-gray-750">
                    <td className="p-3 text-xs font-mono dark:text-gray-300 border-r dark:border-gray-600">{asset.asset_code}</td>
                    <td className="p-3 text-sm font-medium dark:text-gray-200 border-r dark:border-gray-600">
                      {asset.name_ar}
                      {asset.location && <div className="text-xs text-gray-500">📍 {asset.location}</div>}
                      {asset.serial_number && <div className="text-xs text-gray-400">SN: {asset.serial_number}</div>}
                    </td>
                    <td className="p-3 text-xs dark:text-gray-300 border-r dark:border-gray-600">{catMap[asset.category_id] || '—'}</td>
                    <td className="p-3 text-xs dark:text-gray-300 border-r dark:border-gray-600" dir="ltr">{fmtDate(asset.acquisition_date)}</td>
                    <td className="p-3 text-sm font-bold dark:text-gray-200 border-r dark:border-gray-600" dir="ltr">
                      {fmtAmount(totalCost)}
                      {asset.capitalized_costs > 0 && (
                        <div className="text-xs text-gray-500">+{fmtAmount(asset.capitalized_costs)} رسملة</div>
                      )}
                      {impair > 0 && (
                        <div className="text-xs text-red-500">-{fmtAmount(impair)} انخفاض قيمة</div>
                      )}
                    </td>
                    <td className="p-3 text-xs dark:text-gray-300 border-r dark:border-gray-600">
                      {Math.floor(asset.useful_life_months / 12)} سنة {asset.useful_life_months % 12 > 0 ? `و ${asset.useful_life_months % 12} شهر` : ''}
                      <div className="text-xs text-gray-400">{methodLabels[asset.depreciation_method] || asset.depreciation_method}</div>
                    </td>
                    <td className="p-3 border-r dark:border-gray-600">
                      <span className={`px-2 py-1 rounded-full text-xs font-bold ${st.color}`}>{st.label}</span>
                    </td>
                    <td className="p-3">
                      <div className="flex gap-1 flex-wrap">
                        <button onClick={() => openSchedule(asset)} className="text-blue-600 hover:text-blue-800 text-xs font-bold">📊 جدول</button>
                        {canManage && asset.status === 'active' && (
                          <>
                            <button onClick={() => { void openComponents(asset); }} className="text-cyan-600 hover:text-cyan-800 text-xs font-bold">🧩 مكونات</button>
                            <button onClick={() => { setSelectedAsset(asset); setShowCapitalize(true); }} className="text-green-600 hover:text-green-800 text-xs font-bold">➕ رسملة</button>
                            <button onClick={() => { setSelectedAsset(asset); setTransferLocation(asset.location || ''); setTransferDate(toDateInputValue()); setTransferReason(''); setShowTransfer(true); }} className="text-indigo-600 hover:text-indigo-800 text-xs font-bold">🚚 نقل</button>
                            <button onClick={() => { setSelectedAsset(asset); setImpairAmount(0); setImpairDate(toDateInputValue()); setImpairReason(''); setShowImpairment(true); }} className="text-orange-600 hover:text-orange-800 text-xs font-bold">📉 انخفاض قيمة</button>
                            <button onClick={() => { setSelectedAsset(asset); setShowDispose(true); }} className="text-red-600 hover:text-red-800 text-xs font-bold">🗑 استبعاد</button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <div className="text-xs text-gray-500 dark:text-gray-400">
          الصفحة {Math.min(page, totalPages)} من {totalPages}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="px-3 py-1 rounded bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 text-xs font-semibold disabled:opacity-60"
          >
            السابق
          </button>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="px-3 py-1 rounded bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 text-xs font-semibold disabled:opacity-60"
          >
            التالي
          </button>
        </div>
      </div>

      {/* Register Asset Modal */}
      {showRegister && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-lg p-6 animate-fade-in-up max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold mb-4 dark:text-white">تسجيل أصل ثابت جديد</h2>
            <form onSubmit={handleRegister} className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-300">اسم الأصل *</label>
                <input type="text" required value={regForm.name_ar} onChange={e => setRegForm({ ...regForm, name_ar: e.target.value })} className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="مثال: دباب توصيل، مكيف صالة" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1 dark:text-gray-300">الفئة</label>
                  <select value={regForm.category_code} onChange={e => {
                    const cat = categories.find(c => c.code === e.target.value);
                    setRegForm({
                      ...regForm,
                      category_code: e.target.value,
                      useful_life_months: cat?.default_useful_life_months || 60,
                      salvage_value: regForm.acquisition_cost * (cat?.default_salvage_pct || 0) / 100,
                    });
                  }} className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                    {categories.map(c => <option key={c.code} value={c.code}>{c.name_ar}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1 dark:text-gray-300">تاريخ الاقتناء *</label>
                  <input type="date" required value={regForm.acquisition_date} onChange={e => setRegForm({ ...regForm, acquisition_date: e.target.value })} className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1 dark:text-gray-300">تكلفة الشراء *</label>
                  <NumberInput id="acqCost" name="acqCost" value={regForm.acquisition_cost} onChange={e => setRegForm({ ...regForm, acquisition_cost: parseFloat(e.target.value) || 0 })} min={0} step={100} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1 dark:text-gray-300">طريقة الدفع</label>
                  <select value={regForm.payment_method} onChange={e => setRegForm({ ...regForm, payment_method: e.target.value })} className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                    <option value="cash">نقداً</option>
                    <option value="credit">آجل (ذمم دائنة)</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1 dark:text-gray-300">العمر الإنتاجي (شهور)</label>
                  <NumberInput id="usLife" name="usLife" value={regForm.useful_life_months} onChange={e => setRegForm({ ...regForm, useful_life_months: parseInt(e.target.value) || 60 })} min={1} step={12} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1 dark:text-gray-300">قيمة الخردة</label>
                  <NumberInput id="salvage" name="salvage" value={regForm.salvage_value} onChange={e => setRegForm({ ...regForm, salvage_value: parseFloat(e.target.value) || 0 })} min={0} step={100} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1 dark:text-gray-300">الموقع</label>
                  <input type="text" value={regForm.location} onChange={e => setRegForm({ ...regForm, location: e.target.value })} className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="المستودع، المكتب..." />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1 dark:text-gray-300">الرقم التسلسلي</label>
                  <input type="text" value={regForm.serial_number} onChange={e => setRegForm({ ...regForm, serial_number: e.target.value })} className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-300">ملاحظات</label>
                <textarea value={regForm.notes} onChange={e => setRegForm({ ...regForm, notes: e.target.value })} className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white" rows={2} />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowRegister(false)} className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300 text-gray-800">إلغاء</button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 font-bold">حفظ</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Capitalize Cost Modal */}
      {showCapitalize && selectedAsset && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md p-6 animate-fade-in-up">
            <h2 className="text-xl font-bold mb-4 dark:text-white">رسملة تكلفة على: {selectedAsset.name_ar}</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">إضافة تكلفة إلى قيمة الأصل (مثل: أجور عمال، تركيب، تحسينات)</p>
            <form onSubmit={handleCapitalize} className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-300">المبلغ *</label>
                <NumberInput id="capAmt" name="capAmt" value={capAmount} onChange={e => setCapAmount(parseFloat(e.target.value) || 0)} min={0.01} step={100} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-300">الوصف</label>
                <input type="text" value={capDescription} onChange={e => setCapDescription(e.target.value)} className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="أجور عمال ديكور، تركيب مكيف..." />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-300">طريقة الدفع</label>
                <select value={capMethod} onChange={e => setCapMethod(e.target.value)} className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                  <option value="cash">نقداً</option>
                  <option value="credit">آجل</option>
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowCapitalize(false)} className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300 text-gray-800">إلغاء</button>
                <button type="submit" className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 font-bold">إضافة</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Dispose Asset Modal */}
      {showDispose && selectedAsset && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md p-6 animate-fade-in-up">
            <h2 className="text-xl font-bold mb-4 dark:text-white text-red-600">استبعاد أصل: {selectedAsset.name_ar}</h2>
            <form onSubmit={handleDispose} className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-300">طريقة الاستبعاد</label>
                <select value={dispMethod} onChange={e => setDispMethod(e.target.value)} className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                  <option value="sale">بيع</option>
                  <option value="scrap">إتلاف / خردة</option>
                  <option value="donation">تبرع</option>
                  <option value="lost">مفقود</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-300">حصيلة البيع (إن وجدت)</label>
                <NumberInput id="dispAmt" name="dispAmt" value={dispAmount} onChange={e => setDispAmount(parseFloat(e.target.value) || 0)} min={0} step={100} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-300">سبب الاستبعاد</label>
                <input type="text" value={dispReason} onChange={e => setDispReason(e.target.value)} className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowDispose(false)} className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300 text-gray-800">إلغاء</button>
                <button type="submit" className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 font-bold">تأكيد الاستبعاد</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Run Depreciation Modal */}
      {showDepreciation && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md p-6 animate-fade-in-up">
            <h2 className="text-xl font-bold mb-4 dark:text-white">⏱ احتساب الإهلاك الشهري</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">سيتم احتساب الإهلاك لجميع الأصول النشطة للشهر المحدد</p>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-300">السنة</label>
                <NumberInput id="deprYear" name="deprYear" value={deprYear} onChange={e => setDeprYear(parseInt(e.target.value) || now.getFullYear())} min={2020} max={2099} step={1} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-300">الشهر</label>
                <select value={deprMonth} onChange={e => setDeprMonth(parseInt(e.target.value))} className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                  {[1,2,3,4,5,6,7,8,9,10,11,12].map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowDepreciation(false)} className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300 text-gray-800">إلغاء</button>
              <button onClick={handleRunDepreciation} className="px-4 py-2 bg-amber-600 text-white rounded hover:bg-amber-700 font-bold">تنفيذ الإهلاك</button>
            </div>
          </div>
        </div>
      )}

      {showImpairment && selectedAsset && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md p-6 animate-fade-in-up">
            <h2 className="text-xl font-bold mb-4 dark:text-white">انخفاض قيمة: {selectedAsset.name_ar}</h2>
            <form onSubmit={handleImpairment} className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-300">التاريخ</label>
                <input type="date" value={impairDate} onChange={e => setImpairDate(e.target.value)} className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-300">مبلغ الانخفاض *</label>
                <NumberInput id="impairAmount" name="impairAmount" value={impairAmount} onChange={e => setImpairAmount(parseFloat(e.target.value) || 0)} min={0.01} step={100} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-300">السبب</label>
                <input type="text" value={impairReason} onChange={e => setImpairReason(e.target.value)} className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowImpairment(false)} className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300 text-gray-800">إلغاء</button>
                <button type="submit" className="px-4 py-2 bg-orange-600 text-white rounded hover:bg-orange-700 font-bold">ترحيل</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showTransfer && selectedAsset && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md p-6 animate-fade-in-up">
            <h2 className="text-xl font-bold mb-4 dark:text-white">نقل أصل: {selectedAsset.name_ar}</h2>
            <form onSubmit={handleTransfer} className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-300">تاريخ النقل</label>
                <input type="date" value={transferDate} onChange={e => setTransferDate(e.target.value)} className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-300">الموقع الجديد *</label>
                <input type="text" required value={transferLocation} onChange={e => setTransferLocation(e.target.value)} className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-300">سبب النقل</label>
                <input type="text" value={transferReason} onChange={e => setTransferReason(e.target.value)} className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowTransfer(false)} className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300 text-gray-800">إلغاء</button>
                <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 font-bold">تنفيذ النقل</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showComponents && selectedAsset && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-4xl p-6 animate-fade-in-up max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold mb-4 dark:text-white">🧩 مكونات الأصل: {selectedAsset.name_ar}</h2>
            <form onSubmit={handleAddComponent} className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-4">
              <input
                type="text"
                required
                value={componentForm.name_ar}
                onChange={(e) => setComponentForm({ ...componentForm, name_ar: e.target.value })}
                placeholder="اسم المكوّن"
                className="p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white text-sm"
              />
              <NumberInput id="compCost" name="compCost" value={componentForm.cost} onChange={(e) => setComponentForm({ ...componentForm, cost: parseFloat(e.target.value) || 0 })} min={0.01} step={100} />
              <NumberInput id="compLife" name="compLife" value={componentForm.useful_life_months} onChange={(e) => setComponentForm({ ...componentForm, useful_life_months: parseInt(e.target.value) || 60 })} min={1} step={1} />
              <div className="flex gap-2">
                <button type="submit" className="flex-1 px-3 py-2 bg-cyan-600 text-white rounded hover:bg-cyan-700 text-sm font-bold">إضافة مكوّن</button>
                <button type="button" onClick={() => setShowComponents(false)} className="px-3 py-2 bg-gray-200 rounded hover:bg-gray-300 text-gray-800 text-sm">إغلاق</button>
              </div>
              <input
                type="date"
                value={componentForm.acquisition_date}
                onChange={(e) => setComponentForm({ ...componentForm, acquisition_date: e.target.value })}
                className="p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white text-sm"
              />
              <NumberInput id="compSalvage" name="compSalvage" value={componentForm.salvage_value} onChange={(e) => setComponentForm({ ...componentForm, salvage_value: parseFloat(e.target.value) || 0 })} min={0} step={100} />
              <select
                value={componentForm.depreciation_method}
                onChange={(e) => setComponentForm({ ...componentForm, depreciation_method: e.target.value })}
                className="p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white text-sm"
              >
                <option value="straight_line">القسط الثابت</option>
                <option value="declining_balance">القسط المتناقص</option>
              </select>
              <input
                type="text"
                value={componentForm.notes}
                onChange={(e) => setComponentForm({ ...componentForm, notes: e.target.value })}
                placeholder="ملاحظة"
                className="p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white text-sm"
              />
            </form>
            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="p-2 text-xs text-gray-600 dark:text-gray-300">الكود</th>
                    <th className="p-2 text-xs text-gray-600 dark:text-gray-300">المكوّن</th>
                    <th className="p-2 text-xs text-gray-600 dark:text-gray-300">التاريخ</th>
                    <th className="p-2 text-xs text-gray-600 dark:text-gray-300">التكلفة</th>
                    <th className="p-2 text-xs text-gray-600 dark:text-gray-300">العمر</th>
                    <th className="p-2 text-xs text-gray-600 dark:text-gray-300">الإهلاك</th>
                    <th className="p-2 text-xs text-gray-600 dark:text-gray-300">الانخفاض</th>
                    <th className="p-2 text-xs text-gray-600 dark:text-gray-300">الحالة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {components.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="p-4 text-center text-gray-500">لا توجد مكونات</td>
                    </tr>
                  ) : components.map((c) => (
                    <tr key={c.id}>
                      <td className="p-2 text-xs font-mono dark:text-gray-300">{c.component_code}</td>
                      <td className="p-2 text-xs dark:text-gray-200">{c.name_ar}</td>
                      <td className="p-2 text-xs dark:text-gray-300" dir="ltr">{fmtDate(c.acquisition_date)}</td>
                      <td className="p-2 text-xs font-bold dark:text-gray-200" dir="ltr">{fmtAmount(c.cost)}</td>
                      <td className="p-2 text-xs dark:text-gray-300">{c.useful_life_months} شهر</td>
                      <td className="p-2 text-xs text-amber-600 font-bold" dir="ltr">{fmtAmount(c.accumulated_depreciation)}</td>
                      <td className="p-2 text-xs text-red-600 font-bold" dir="ltr">{fmtAmount(c.impairment_accumulated)}</td>
                      <td className="p-2 text-xs dark:text-gray-300">
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${c.status === 'active' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'}`}>
                            {({active: 'نشط', disposed: 'مُستبعَد', replaced: 'مُستبدَل'} as Record<string,string>)[c.status] || c.status}
                          </span>
                          {canManage && c.status === 'active' && (
                            <button
                              type="button"
                              onClick={() => openReplaceComponent(c)}
                              className="px-2 py-1 rounded bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-200 text-[11px] font-bold"
                            >
                              استبدال
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {showReplaceComponent && selectedAsset && selectedComponent && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-lg p-6 animate-fade-in-up max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold mb-4 dark:text-white">استبدال مكوّن: {selectedComponent.name_ar}</h2>
            <form onSubmit={handleReplaceComponent} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1 dark:text-gray-300">اسم المكوّن الجديد *</label>
                  <input
                    type="text"
                    required
                    value={replaceForm.new_name_ar}
                    onChange={(e) => setReplaceForm({ ...replaceForm, new_name_ar: e.target.value })}
                    className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1 dark:text-gray-300">تاريخ الاستبدال *</label>
                  <input
                    type="date"
                    required
                    value={replaceForm.replacement_date}
                    onChange={(e) => setReplaceForm({ ...replaceForm, replacement_date: e.target.value })}
                    className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1 dark:text-gray-300">تكلفة المكوّن الجديد *</label>
                  <NumberInput id="replaceCost" name="replaceCost" value={replaceForm.new_cost} onChange={(e) => setReplaceForm({ ...replaceForm, new_cost: parseFloat(e.target.value) || 0 })} min={0.01} step={100} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1 dark:text-gray-300">العمر الإنتاجي (شهور)</label>
                  <NumberInput id="replaceLife" name="replaceLife" value={replaceForm.new_useful_life_months} onChange={(e) => setReplaceForm({ ...replaceForm, new_useful_life_months: parseInt(e.target.value) || 60 })} min={1} step={1} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1 dark:text-gray-300">طريقة الدفع</label>
                  <select
                    value={replaceForm.payment_method}
                    onChange={(e) => setReplaceForm({ ...replaceForm, payment_method: e.target.value })}
                    className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                  >
                    <option value="cash">نقداً</option>
                    <option value="credit">آجل</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1 dark:text-gray-300">قيمة الخردة</label>
                  <NumberInput id="replaceSalvage" name="replaceSalvage" value={replaceForm.new_salvage_value} onChange={(e) => setReplaceForm({ ...replaceForm, new_salvage_value: parseFloat(e.target.value) || 0 })} min={0} step={100} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1 dark:text-gray-300">طريقة الإهلاك</label>
                  <select
                    value={replaceForm.new_depreciation_method}
                    onChange={(e) => setReplaceForm({ ...replaceForm, new_depreciation_method: e.target.value })}
                    className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                  >
                    <option value="straight_line">القسط الثابت</option>
                    <option value="declining_balance">القسط المتناقص</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1 dark:text-gray-300">السبب</label>
                  <input
                    type="text"
                    value={replaceForm.reason}
                    onChange={(e) => setReplaceForm({ ...replaceForm, reason: e.target.value })}
                    className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                  />
                </div>
              </div>
              <div className="p-2 rounded border border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700 text-xs text-amber-800 dark:text-amber-200">
                سيتم شطب المكوّن القديم محاسبيًا وتسجيل المكوّن الجديد بقيد متوازن.
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => { setShowReplaceComponent(false); setSelectedComponent(null); }}
                  className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300 text-gray-800"
                >
                  إلغاء
                </button>
                <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 font-bold">
                  تنفيذ الاستبدال
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Depreciation Schedule Modal */}
      {showSchedule && selectedAsset && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl p-6 animate-fade-in-up max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold mb-2 dark:text-white">📊 جدول الإهلاك: {selectedAsset.name_ar}</h2>
            <div className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              التكلفة: {fmtAmount(selectedAsset.acquisition_cost + selectedAsset.capitalized_costs)} | قيمة الخردة: {fmtAmount(selectedAsset.salvage_value)} | {methodLabels[selectedAsset.depreciation_method] || selectedAsset.depreciation_method}
            </div>
            {deprEntries.length === 0 ? (
              <div className="text-center text-gray-500 p-8">لا توجد قيود إهلاك بعد — قم بتشغيل الإهلاك الشهري أولاً</div>
            ) : (
              <table className="w-full text-right text-sm">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="p-2 text-xs text-gray-600 dark:text-gray-300">الفترة</th>
                    <th className="p-2 text-xs text-gray-600 dark:text-gray-300">الإهلاك</th>
                    <th className="p-2 text-xs text-gray-600 dark:text-gray-300">المجمع</th>
                    <th className="p-2 text-xs text-gray-600 dark:text-gray-300">القيمة الدفترية</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {deprEntries.map(e => (
                    <tr key={e.id}>
                      <td className="p-2 text-xs dark:text-gray-300" dir="ltr">{e.period_start}</td>
                      <td className="p-2 text-xs font-bold text-red-600" dir="ltr">{fmtAmount(e.depreciation_amount)}</td>
                      <td className="p-2 text-xs font-bold text-amber-600" dir="ltr">{fmtAmount(e.accumulated_total)}</td>
                      <td className="p-2 text-xs font-bold text-blue-600" dir="ltr">{fmtAmount(e.book_value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="flex justify-end pt-4">
              <button onClick={() => setShowSchedule(false)} className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300 text-gray-800">إغلاق</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
