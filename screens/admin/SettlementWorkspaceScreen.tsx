import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { getSupabaseClient } from '../../supabase';
import * as Icons from '../../components/icons';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import { localizeSourceTableAr, shortId } from '../../utils/displayLabels';
import { translateAccountName } from '../../utils/accountUtils';

type PartyRow = { id: string; name: string; currency_preference?: string | null };

type OpenItemRow = {
  id: string;
  party_id: string;
  journal_entry_id: string;
  journal_line_id: string;
  account_code: string;
  account_name: string;
  direction: 'debit' | 'credit';
  occurred_at: string;
  due_date: string | null;
  item_role: string | null;
  item_type: string;
  source_table: string | null;
  source_id: string | null;
  source_event: string | null;
  currency_code: string;
  foreign_amount: number | null;
  base_amount: number;
  open_foreign_amount: number | null;
  open_base_amount: number;
  status: string;
};

type AllocationDraft = {
  fromOpenItemId: string;
  toOpenItemId: string;
  allocatedForeignAmount?: number;
  allocatedBaseAmount?: number;
};

const withTimeout = async <T,>(promise: PromiseLike<T>, ms: number, message: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  try {
    return await Promise.race([Promise.resolve(promise), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const formatTime = (iso: string) => {
  try {
    return new Date(iso).toLocaleString('ar-SA-u-nu-latn');
  } catch {
    return iso;
  }
};

export default function SettlementWorkspaceScreen() {
  const location = useLocation();
  const { showNotification } = useToast();
  const { hasPermission } = useAuth();
  const canManage = Boolean(hasPermission?.('accounting.manage'));
  const canView = Boolean(hasPermission?.('accounting.view') || canManage);
  const [loading, setLoading] = useState(true);
  const loadingRef = useRef(false);
  const [parties, setParties] = useState<PartyRow[]>([]);
  const [partyId, setPartyId] = useState('');
  const [currency, setCurrency] = useState('');
  const [items, setItems] = useState<OpenItemRow[]>([]);
  const [currencyHint, setCurrencyHint] = useState<string>('');
  const [selectedDebit, setSelectedDebit] = useState<string>('');
  const [selectedCredit, setSelectedCredit] = useState<string>('');
  const [allocations, setAllocations] = useState<AllocationDraft[]>([]);
  const [notes, setNotes] = useState('');
  const [running, setRunning] = useState(false);
  const [recentSettlements, setRecentSettlements] = useState<any[]>([]);
  const [nextForeign, setNextForeign] = useState<string>('');
  const [nextBase, setNextBase] = useState<string>('');
  const [backfilling, setBackfilling] = useState(false);
  const [lastBackfillCount, setLastBackfillCount] = useState<number | null>(null);
  const didAutoBackfillRef = useRef(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const loadParties = async () => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const { data, error } = await supabase
      .from('financial_parties')
      .select('id,name,currency_preference')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) throw error;
    const rows = (Array.isArray(data) ? data : []).map((r: any) => ({
      id: String(r.id),
      name: String(r.name || '—'),
      currency_preference: r.currency_preference ? String(r.currency_preference) : null,
    }));
    setParties(rows);
    const requestedPartyId = String(new URLSearchParams(location.search).get('partyId') || '').trim();
    if (requestedPartyId && rows.some((p: any) => String(p.id) === requestedPartyId)) {
      setPartyId(requestedPartyId);
      return;
    }
    if (!partyId && rows.length > 0) setPartyId(rows[0].id);
  };

  const loadOpenItems = async () => {
    if (!partyId) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      setCurrencyHint('');
      const { data, error } = await withTimeout<any>(
        supabase.rpc('list_party_open_items', {
          p_party_id: partyId,
          p_currency: null,
          p_status: 'open_active',
        } as any),
        15000,
        'انتهت مهلة تحميل العناصر المفتوحة.'
      );
      if (error) throw error;
      const rows = (Array.isArray(data) ? data : []) as any[];
      setItems(rows as any);
      const currencies = Array.from(new Set(rows.map((x: any) => String(x?.currency_code || '').trim().toUpperCase()).filter(Boolean)));
      const current = currency.trim().toUpperCase();
      const pref = String(parties.find((p) => p.id === partyId)?.currency_preference || '').trim().toUpperCase();

      if (current && currencies.length > 0 && !currencies.includes(current)) {
        setCurrencyHint(`لا توجد عناصر بالعملة ${current}. العملات المتاحة: ${currencies.join('، ')}`);
      }

      if (!current) {
        if (pref && currencies.includes(pref)) {
          setCurrency(pref);
        } else if (currencies.length === 1) {
          setCurrency(currencies[0]);
        }
      }
      if (rows.length === 0 && !didAutoBackfillRef.current && canManage) {
        didAutoBackfillRef.current = true;
        void backfillOpenItems();
      }
    } catch (e: any) {
      setItems([]);
      showNotification(String(e?.message || 'فشل تحميل العناصر المفتوحة.'), 'error');
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  };

  const loadRecentSettlements = async () => {
    if (!partyId) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;
    try {
      const { data } = await withTimeout<any>(
        supabase
          .from('settlement_headers')
          .select('id,settlement_date,currency_code,settlement_type,reverses_settlement_id,created_at,notes')
          .eq('party_id', partyId)
          .order('settlement_date', { ascending: false })
          .limit(50),
        15000,
        'انتهت مهلة تحميل التسويات الأخيرة.'
      );
      setRecentSettlements(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setRecentSettlements([]);
      showNotification(String(e?.message || 'فشل تحميل التسويات الأخيرة.'), 'error');
    }
  };

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        if (!canView) {
          setParties([]);
          setItems([]);
          return;
        }
        await loadParties();
      } finally {
        setLoading(false);
      }
    })();
  }, [canView]);

  useEffect(() => {
    if (!canView) return;
    void loadOpenItems();
    void loadRecentSettlements();
  }, [partyId, canView]);

  const backfillOpenItems = async () => {
    if (!partyId) return;
    if (!canManage) {
      showNotification('ليس لديك صلاحية تحديث العناصر المفتوحة.', 'error');
      return;
    }
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setBackfilling(true);
    try {
      const { data, error } = await withTimeout<any>(
        supabase.rpc('backfill_party_open_items_for_party', {
          p_party_id: partyId,
          p_batch: 5000,
        } as any),
        20000,
        'انتهت مهلة تحديث العناصر المفتوحة.'
      );
      if (error) throw error;
      const created = Number((data as any)?.openItemsCreated || 0);
      setLastBackfillCount(created);
      if (created > 0) {
        showNotification(`تم تحديث العناصر المفتوحة: ${created}`, 'success');
      }
      await loadOpenItems();
      await loadRecentSettlements();
    } catch (e: any) {
      showNotification(String(e?.message || 'فشل تحديث العناصر المفتوحة.'), 'error');
    } finally {
      setBackfilling(false);
    }
  };

  const currencyFilter = useMemo(() => String(currency || '').trim().toUpperCase(), [currency]);
  const filteredItems = useMemo(() => {
    if (!currencyFilter) return items;
    return items.filter((x) => String(x.currency_code || '').toUpperCase() === currencyFilter);
  }, [items, currencyFilter]);

  const currencyOptions = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) {
      const c = String(it.currency_code || '').trim().toUpperCase();
      if (c) set.add(c);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [items]);

  const debits = useMemo(() => filteredItems.filter((x) => x.direction === 'debit').sort((a, b) => String(a.due_date || a.occurred_at).localeCompare(String(b.due_date || b.occurred_at))), [filteredItems]);
  const credits = useMemo(() => filteredItems.filter((x) => x.direction === 'credit').sort((a, b) => String(a.due_date || a.occurred_at).localeCompare(String(b.due_date || b.occurred_at))), [filteredItems]);

  const debitById = useMemo(() => {
    const map: Record<string, OpenItemRow> = {};
    debits.forEach((d) => { map[d.id] = d; });
    return map;
  }, [debits]);
  const creditById = useMemo(() => {
    const map: Record<string, OpenItemRow> = {};
    credits.forEach((d) => { map[d.id] = d; });
    return map;
  }, [credits]);

  const suggestedAmount = useMemo(() => {
    const d = debitById[selectedDebit];
    const c = creditById[selectedCredit];
    if (!d || !c) return { kind: 'none' as const, value: 0 };
    if (d.currency_code !== c.currency_code) return { kind: 'none' as const, value: 0 };
    if (d.open_foreign_amount != null && c.open_foreign_amount != null) {
      return { kind: 'foreign' as const, value: Math.max(0, Math.min(Number(d.open_foreign_amount || 0), Number(c.open_foreign_amount || 0))) };
    }
    return { kind: 'base' as const, value: Math.max(0, Math.min(Number(d.open_base_amount || 0), Number(c.open_base_amount || 0))) };
  }, [creditById, debitById, selectedCredit, selectedDebit]);

  const addAllocation = () => {
    const d = debitById[selectedDebit];
    const c = creditById[selectedCredit];
    if (!d || !c) return;
    if (d.currency_code !== c.currency_code) {
      showNotification('العملة يجب أن تكون نفسها.', 'error');
      return;
    }
    const baseDraft: AllocationDraft = { fromOpenItemId: d.id, toOpenItemId: c.id };
    const useForeign = (d.open_foreign_amount != null && c.open_foreign_amount != null);
    if (useForeign) {
      const maxForeign = Math.max(0, Math.min(Number(d.open_foreign_amount || 0), Number(c.open_foreign_amount || 0)));
      const chosen = Number(nextForeign || '') || Number(suggestedAmount.value || 0);
      if (!(chosen > 0)) {
        showNotification('حدد مبلغ تخصيص صحيح.', 'error');
        return;
      }
      if (chosen - maxForeign > 1e-6) {
        showNotification(`المبلغ يتجاوز المتاح (${maxForeign.toFixed(2)})`, 'error');
        return;
      }
      baseDraft.allocatedForeignAmount = chosen;
    } else {
      const maxBase = Math.max(0, Math.min(Number(d.open_base_amount || 0), Number(c.open_base_amount || 0)));
      const chosen = Number(nextBase || '') || Number(suggestedAmount.value || 0);
      if (!(chosen > 0)) {
        showNotification('حدد مبلغ تخصيص صحيح.', 'error');
        return;
      }
      if (chosen - maxBase > 1e-6) {
        showNotification(`المبلغ يتجاوز المتاح (${maxBase.toFixed(2)})`, 'error');
        return;
      }
      baseDraft.allocatedBaseAmount = chosen;
    }
    if (!baseDraft.allocatedForeignAmount && !baseDraft.allocatedBaseAmount) {
      showNotification('حدد مبلغ تخصيص صحيح.', 'error');
      return;
    }
    setAllocations((prev) => [...prev, baseDraft]);
    setNextForeign('');
    setNextBase('');
  };

  const createSettlement = async () => {
    if (!partyId) return;
    if (!canManage) {
      showNotification('ليس لديك صلاحية إنشاء التسويات.', 'error');
      return;
    }
    if (allocations.length === 0) {
      showNotification('لا توجد تخصيصات.', 'info');
      return;
    }
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setRunning(true);
    try {
      const payload = allocations.map((a) => ({
        fromOpenItemId: a.fromOpenItemId,
        toOpenItemId: a.toOpenItemId,
        allocatedForeignAmount: a.allocatedForeignAmount ?? undefined,
        allocatedBaseAmount: a.allocatedBaseAmount ?? undefined,
      }));
      const { data, error } = await supabase.rpc('create_settlement', {
        p_party_id: partyId,
        p_settlement_date: new Date().toISOString(),
        p_allocations: payload as any,
        p_notes: notes || null,
      } as any);
      if (error) throw error;
      setAllocations([]);
      setNotes('');
      await loadOpenItems();
      await loadRecentSettlements();
      showNotification(`تم إنشاء التسوية: ${String(data || '').slice(-8)}`, 'success');
    } catch (e: any) {
      showNotification(String(e?.message || 'فشل إنشاء التسوية'), 'error');
    } finally {
      setRunning(false);
    }
  };

  const autoSettle = async () => {
    if (!partyId) return;
    if (!canManage) {
      showNotification('ليس لديك صلاحية تنفيذ التسوية التلقائية.', 'error');
      return;
    }
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setRunning(true);
    try {
      const { data, error } = await supabase.rpc('auto_settle_party_items', { p_party_id: partyId } as any);
      if (error) throw error;
      await loadOpenItems();
      await loadRecentSettlements();
      showNotification(data ? `تمت التسوية التلقائية: ${String(data).slice(-8)}` : 'لا توجد عناصر قابلة للمطابقة.', data ? 'success' : 'info');
    } catch (e: any) {
      showNotification(String(e?.message || 'فشل التشغيل التلقائي'), 'error');
    } finally {
      setRunning(false);
    }
  };

  const reverseSettlement = async (id: string) => {
    if (!canManage) {
      showNotification('ليس لديك صلاحية عكس التسويات.', 'error');
      return;
    }
    const reason = window.prompt('سبب عكس التسوية؟');
    if (!reason) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setRunning(true);
    try {
      const { error } = await supabase.rpc('void_settlement', { p_settlement_id: id, p_reason: reason } as any);
      if (error) throw error;
      await loadOpenItems();
      await loadRecentSettlements();
      showNotification('تم عكس التسوية.', 'success');
    } catch (e: any) {
      showNotification(String(e?.message || 'فشل عكس التسوية'), 'error');
    } finally {
      setRunning(false);
    }
  };

  const onDragStart = (openItemId: string) => (e: React.DragEvent) => {
    e.dataTransfer.setData('text/plain', openItemId);
  };

  const onDropToDebit = (e: React.DragEvent) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    if (debitById[id]) setSelectedDebit(id);
    if (creditById[id]) setSelectedCredit('');
  };

  const onDropToCredit = (e: React.DragEvent) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    if (creditById[id]) setSelectedCredit(id);
    if (debitById[id]) setSelectedDebit('');
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold dark:text-white">مساحة التسويات المالية</h1>
          <div className="text-sm text-gray-500 dark:text-gray-400">مطابقة وتخصيص الدفعات والفواتير (ذمم مدينة / دائنة / سلف)</div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setHelpOpen(v => !v)}
            className="px-3 py-2 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 text-sm text-blue-700 dark:text-blue-200 flex items-center gap-1"
            title="مركز المساعدة"
          >
            <Icons.InfoIcon className="w-4 h-4" />
            {helpOpen ? 'إخفاء الدليل' : 'دليل الاستخدام'}
          </button>
          <button
            onClick={() => void loadOpenItems()}
            disabled={!canView}
            className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
          >
            تحديث
          </button>
          <button
            onClick={() => void backfillOpenItems()}
            disabled={backfilling || !canManage}
            className="px-3 py-2 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 text-sm text-emerald-700 dark:text-emerald-200 disabled:opacity-60"
          >
            {backfilling ? 'جاري التحديث...' : 'تحديث العناصر المفتوحة'}
          </button>
          {lastBackfillCount != null ? (
            <span className="text-xs text-gray-600 dark:text-gray-300 px-2 py-1 border rounded-md bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
              تم تحديث: {Number(lastBackfillCount || 0)}
            </span>
          ) : null}
        </div>
      </div>

      {/* ═══════════ مركز المساعدة ═══════════ */}
      {helpOpen && (
        <div className="bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800 rounded-2xl p-5 space-y-5 text-sm text-gray-800 dark:text-gray-200" dir="rtl">
          <div className="flex items-center gap-2 mb-1">
            <Icons.InfoIcon className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0" />
            <span className="text-lg font-bold text-blue-800 dark:text-blue-200">دليل مساحة التسويات المالية</span>
          </div>

          {/* ما هو */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-blue-100 dark:border-blue-800 space-y-2">
            <div className="font-bold text-blue-700 dark:text-blue-300">📌 ما هذا القسم؟</div>
            <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
              عند إنشاء سند قبض أو صرف، تُسجَّل الدفعة كـ <strong>«مفتوحة»</strong> — أي مبلغ موجود في النظام لكنه غير مرتبط بفاتورة بعينها.
              مساحة التسويات هي المكان الذي <strong>تُطابق فيه كل دفعة مع الفاتورة أو المستحق الذي تسدِّده.</strong>
            </p>
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg px-3 py-2 text-amber-800 dark:text-amber-200 text-xs">
              ⚠️ بدون التسوية: الأرصدة ضخمة وغير واضحة، وتقارير الذمم تُظهر أرقاماً غير دقيقة.
            </div>
          </div>

          {/* متى تستخدم */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-blue-100 dark:border-blue-800">
            <div className="font-bold text-blue-700 dark:text-blue-300 mb-3">📅 متى تستخدمه؟</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {[
                ['💰 دفعت لمورّد', 'بعد صدور سند الصرف مباشرةً — اربط الدفعة بالفاتورة.'],
                ['🧾 وصلت فاتورة ولديك دفعة مقدمة', 'طبّق الدفعة المقدمة القديمة على الفاتورة الجديدة.'],
                ['📥 عميل دفع مبلغاً يغطي فاتورتين', 'وزّع سند القبض على أكثر من فاتورة.'],
                ['📆 إغلاق الشهر المحاسبي', 'قبل إغلاق الدورة، سوِّ جميع الدفعات المفتوحة.'],
              ].map(([title, desc]) => (
                <div key={title} className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
                  <div className="font-semibold text-gray-800 dark:text-gray-100 text-xs mb-1">{title}</div>
                  <div className="text-gray-600 dark:text-gray-300 text-xs leading-relaxed">{desc}</div>
                </div>
              ))}
            </div>
          </div>

          {/* كيفية الاستخدام */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-blue-100 dark:border-blue-800 space-y-3">
            <div className="font-bold text-blue-700 dark:text-blue-300">🔧 كيف تعمل الشاشة؟</div>
            <div className="space-y-2">
              {[
                { step: '١', title: 'اختر الطرف المالي', desc: 'من القائمة أعلاه — مورّد أو عميل. ستظهر عناصره المفتوحة تلقائياً.' },
                { step: '٢', title: 'اختر العملة (اختياري)', desc: 'فلتَر العناصر بعملة معينة إذا كان الطرف يتعامل بأكثر من عملة.' },
                { step: '٣', title: 'العناصر المدينة (Debits)', desc: 'الجدول الأيسر — ما هو مستحق عليك أو ما قدّمته من فواتير (للعملاء). انقر على الصف لتحديده.' },
                { step: '٤', title: 'العناصر الدائنة (Credits)', desc: 'الجدول الأيمن — الدفعات والمدفوعات المُستلمة أو المُرسلة. انقر على الصف لتحديده.' },
                { step: '٥', title: 'تخصيص يدوي', desc: 'بعد تحديد عنصر مدين + دائن، يظهر المبلغ المقترح تلقائياً. اضغط «إضافة تخصيص» ثم «إنشاء Settlement».' },
                { step: '٦', title: 'Auto Match (FIFO)', desc: 'يُطابق النظام تلقائياً الدفعات مع الفواتير بترتيب الأقدم فالأحدث. مفيد للتسوية السريعة.' },
              ].map(({ step, title, desc }) => (
                <div key={step} className="flex gap-3 items-start">
                  <div className="w-7 h-7 rounded-full bg-blue-600 dark:bg-blue-500 text-white text-xs flex items-center justify-center flex-shrink-0 font-bold">{step}</div>
                  <div>
                    <div className="font-semibold text-gray-800 dark:text-gray-100 text-xs">{title}</div>
                    <div className="text-gray-600 dark:text-gray-300 text-xs leading-relaxed">{desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* مصطلحات */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-blue-100 dark:border-blue-800">
            <div className="font-bold text-blue-700 dark:text-blue-300 mb-3">📖 دليل المصطلحات</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {[
                ['مفتوح (Open)', 'دفعة أو فاتورة لم تُطابَق بعد مع أي مقابل.'],
                ['مُسوَّى جزئياً', 'طُبِّق جزء من المبلغ، والباقي لا يزال معلّقاً.'],
                ['مُسوَّى بالكامل', 'الفاتورة مسدَّدة 100% وأُغلق العنصر.'],
                ['Auto Match FIFO', 'مطابقة تلقائية بدءاً من أقدم فاتورة/دفعة.'],
                ['عكس التسوية', 'إلغاء تسوية خاطئة — يعود العنصران إلى حالة «مفتوح».'],
                ['تحديث العناصر المفتوحة', 'يُعيد حساب أرصدة العناصر من القيود المرحّلة.'],
              ].map(([term, def]) => (
                <div key={term} className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-2">
                  <span className="font-mono text-blue-700 dark:text-blue-300 text-xs">{term}: </span>
                  <span className="text-gray-600 dark:text-gray-300 text-xs">{def}</span>
                </div>
              ))}
            </div>
          </div>

          {/* نصيحة */}
          <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700 rounded-xl p-4">
            <div className="font-bold text-emerald-700 dark:text-emerald-300 mb-1">💡 نصيحة ذهبية</div>
            <p className="text-emerald-800 dark:text-emerald-200 text-xs leading-relaxed">
              قبل طباعة أي كشف حساب لطرف مالي، تأكد من إتمام التسويات أولاً.
              كشف الحساب غير المُسوَّى يُعطي أرصدة مضخَّمة لا تعكس الواقع.
              التسوية الشهرية قبل إغلاق الدورة المحاسبية ضرورة، وليست خياراً.
            </p>
          </div>
        </div>
      )}
      {!canView ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 p-6 text-center text-gray-500 dark:text-gray-400 font-semibold">
          لا تملك صلاحية عرض التسويات.
        </div>
      ) : !canManage ? (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-sm text-amber-900 dark:text-amber-200">
          وضع عرض فقط: لا يمكنك إنشاء/عكس التسويات أو تحديث العناصر المفتوحة.
        </div>
      ) : null}
      {loading ? (
        <div className="text-xs text-gray-500 dark:text-gray-400">جاري التحميل...</div>
      ) : null}

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">الطرف</div>
          <select
            value={partyId}
            onChange={(e) => setPartyId(e.target.value)}
            disabled={!canView}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
          >
            {parties.map((p) => (
              <option key={p.id} value={p.id}>{p.name} — {p.id.slice(-6)}</option>
            ))}
          </select>
        </div>
        <div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">العملة (اختياري)</div>
          <select
            value={currencyFilter}
            onChange={(e) => setCurrency(e.target.value)}
            disabled={!canView}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm font-mono"
          >
            <option value="">كل العملات</option>
            {currencyOptions.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="flex items-end gap-2">
          <button
            disabled={running || !canManage}
            onClick={() => void autoSettle()}
            className="w-full px-3 py-2 rounded-lg bg-primary-600 text-white text-sm disabled:opacity-60"
          >
            تشغيل Auto Match (FIFO)
          </button>
        </div>
      </div>

      {currencyHint ? (
        <div className="bg-amber-50 dark:bg-amber-900/20 text-amber-900 dark:text-amber-200 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-sm">
          {currencyHint}
        </div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div
          className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 overflow-hidden"
          onDrop={onDropToDebit}
          onDragOver={(e) => e.preventDefault()}
        >
          <div className="p-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
            <div className="font-semibold dark:text-white">عناصر مدينة (Debits)</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">{debits.length}</div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700/50">
                <tr>
                  <th className="p-3 border-r dark:border-gray-700">التاريخ</th>
                  <th className="p-3 border-r dark:border-gray-700">النوع</th>
                  <th className="p-3 border-r dark:border-gray-700">الحساب</th>
                  <th className="p-3 border-r dark:border-gray-700">المتبقي</th>
                  <th className="p-3">المرجع</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {debits.map((d) => (
                  <tr
                    key={d.id}
                    draggable
                    onDragStart={onDragStart(d.id)}
                    onClick={() => setSelectedDebit(d.id)}
                    className={`cursor-pointer ${selectedDebit === d.id ? 'bg-primary-50 dark:bg-primary-900/20' : ''} hover:bg-gray-50 dark:hover:bg-gray-700/30`}
                  >
                    <td className="p-3 border-r dark:border-gray-700 font-mono" dir="ltr">{formatTime(d.occurred_at)}</td>
                    <td className="p-3 border-r dark:border-gray-700">{d.item_type}</td>
                    <td className="p-3 border-r dark:border-gray-700">
                      <div className="font-mono">{d.account_code}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {translateAccountName(d.account_name) !== d.account_name
                          ? `${translateAccountName(d.account_name)} (${d.account_name})`
                          : translateAccountName(d.account_name)}
                      </div>
                    </td>
                    <td className="p-3 border-r dark:border-gray-700 font-mono" dir="ltr">
                      {Number(d.open_base_amount || 0).toFixed(2)}
                      <div className="text-xs text-gray-500 dark:text-gray-400">{d.currency_code}{d.open_foreign_amount != null ? ` (${Number(d.open_foreign_amount).toFixed(2)})` : ''}</div>
                    </td>
                    <td className="p-3 text-xs">{`${localizeSourceTableAr(d.source_table)} • ${shortId(d.source_id)}`}</td>
                  </tr>
                ))}
                {debits.length === 0 ? (
                  <tr><td className="p-6 text-center text-gray-500" colSpan={5}>لا توجد عناصر.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div
          className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 overflow-hidden"
          onDrop={onDropToCredit}
          onDragOver={(e) => e.preventDefault()}
        >
          <div className="p-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
            <div className="font-semibold dark:text-white">عناصر دائنة (Credits)</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">{credits.length}</div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700/50">
                <tr>
                  <th className="p-3 border-r dark:border-gray-700">التاريخ</th>
                  <th className="p-3 border-r dark:border-gray-700">النوع</th>
                  <th className="p-3 border-r dark:border-gray-700">الحساب</th>
                  <th className="p-3 border-r dark:border-gray-700">المتبقي</th>
                  <th className="p-3">المرجع</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {credits.map((d) => (
                  <tr
                    key={d.id}
                    draggable
                    onDragStart={onDragStart(d.id)}
                    onClick={() => setSelectedCredit(d.id)}
                    className={`cursor-pointer ${selectedCredit === d.id ? 'bg-primary-50 dark:bg-primary-900/20' : ''} hover:bg-gray-50 dark:hover:bg-gray-700/30`}
                  >
                    <td className="p-3 border-r dark:border-gray-700 font-mono" dir="ltr">{formatTime(d.occurred_at)}</td>
                    <td className="p-3 border-r dark:border-gray-700">{d.item_type}</td>
                    <td className="p-3 border-r dark:border-gray-700">
                      <div className="font-mono">{d.account_code}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {translateAccountName(d.account_name) !== d.account_name
                          ? `${translateAccountName(d.account_name)} (${d.account_name})`
                          : translateAccountName(d.account_name)}
                      </div>
                    </td>
                    <td className="p-3 border-r dark:border-gray-700 font-mono" dir="ltr">
                      {Number(d.open_base_amount || 0).toFixed(2)}
                      <div className="text-xs text-gray-500 dark:text-gray-400">{d.currency_code}{d.open_foreign_amount != null ? ` (${Number(d.open_foreign_amount).toFixed(2)})` : ''}</div>
                    </td>
                    <td className="p-3 text-xs">{`${localizeSourceTableAr(d.source_table)} • ${shortId(d.source_id)}`}</td>
                  </tr>
                ))}
                {credits.length === 0 ? (
                  <tr><td className="p-6 text-center text-gray-500" colSpan={5}>لا توجد عناصر.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="font-semibold dark:text-white">تخصيص يدوي</div>
          <button
            disabled={!selectedDebit || !selectedCredit}
            onClick={addAllocation}
            className="px-3 py-2 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-sm disabled:opacity-50 flex items-center gap-2"
          >
            <Icons.PlusIcon className="w-4 h-4" />
            إضافة تخصيص
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="text-sm text-gray-700 dark:text-gray-200">
            من (مدين): <span className="font-mono">{shortId(selectedDebit)}</span>
          </div>
          <div className="text-sm text-gray-700 dark:text-gray-200">
            إلى (دائن): <span className="font-mono">{shortId(selectedCredit)}</span>
          </div>
          <div className="text-sm text-gray-700 dark:text-gray-200">
            مقترح: <span className="font-mono">{suggestedAmount.kind === 'foreign' || suggestedAmount.kind === 'base' ? suggestedAmount.value.toFixed(2) : '—'}</span>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">مبلغ عملة أجنبية</div>
              <input
                type="number"
                value={nextForeign}
                onChange={(e) => setNextForeign(e.target.value)}
                placeholder="اختياري إذا كان العنصر بعملة أجنبية"
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm font-mono"
              />
            </div>
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">مبلغ بالأساس</div>
              <input
                type="number"
                value={nextBase}
                onChange={(e) => setNextBase(e.target.value)}
                placeholder="اختياري عند عدم وجود أجنبي"
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm font-mono"
              />
            </div>
          </div>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="ملاحظات (اختياري)"
            className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
          />
          <div className="flex gap-2">
            <button
              disabled={running || !canManage}
              onClick={() => void createSettlement()}
              className="flex-1 px-3 py-2 rounded-lg bg-primary-600 text-white text-sm disabled:opacity-60"
            >
              إنشاء Settlement
            </button>
            <button
              disabled={running}
              onClick={() => setAllocations([])}
              className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm disabled:opacity-60"
            >
              مسح
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700/50">
              <tr>
                <th className="p-3 border-r dark:border-gray-700">من</th>
                <th className="p-3 border-r dark:border-gray-700">إلى</th>
                <th className="p-3 border-r dark:border-gray-700">المبلغ</th>
                <th className="p-3">حذف</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {allocations.map((a, idx) => (
                <tr key={`${a.fromOpenItemId}-${a.toOpenItemId}-${idx}`}>
                  <td className="p-3 border-r dark:border-gray-700 font-mono" dir="ltr">{a.fromOpenItemId.slice(-8)}</td>
                  <td className="p-3 border-r dark:border-gray-700 font-mono" dir="ltr">{a.toOpenItemId.slice(-8)}</td>
                  <td className="p-3 border-r dark:border-gray-700 font-mono" dir="ltr">
                    {a.allocatedForeignAmount != null ? `F:${Number(a.allocatedForeignAmount).toFixed(2)}` : `B:${Number(a.allocatedBaseAmount || 0).toFixed(2)}`}
                  </td>
                  <td className="p-3">
                    <button
                      onClick={() => setAllocations((prev) => prev.filter((_, i) => i !== idx))}
                      className="px-2 py-1 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-200"
                    >
                      <Icons.TrashIcon className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
              {allocations.length === 0 ? (
                <tr><td colSpan={4} className="p-6 text-center text-gray-500">لا توجد تخصيصات.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 p-4">
        <div className="font-semibold dark:text-white mb-3">Settlements الأخيرة</div>
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700/50">
              <tr>
                <th className="p-3 border-r dark:border-gray-700">التاريخ</th>
                <th className="p-3 border-r dark:border-gray-700">النوع</th>
                <th className="p-3 border-r dark:border-gray-700">العملة</th>
                <th className="p-3 border-r dark:border-gray-700">المرجع</th>
                <th className="p-3">عكس</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {recentSettlements.map((s: any) => (
                <tr key={String(s.id)}>
                  <td className="p-3 border-r dark:border-gray-700 font-mono" dir="ltr">{formatTime(String(s.settlement_date || s.created_at || ''))}</td>
                  <td className="p-3 border-r dark:border-gray-700">{String(s.settlement_type || 'normal')}</td>
                  <td className="p-3 border-r dark:border-gray-700 font-mono">{String(s.currency_code || '—')}</td>
                  <td className="p-3 border-r dark:border-gray-700 font-mono" dir="ltr">{String(s.id).slice(-8)}</td>
                  <td className="p-3">
                    {String(s.settlement_type) === 'normal' ? (
                      <button
                        disabled={running || !canManage}
                        onClick={() => void reverseSettlement(String(s.id))}
                        className="px-2 py-1 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-200 disabled:opacity-60"
                        title="عكس"
                      >
                        <Icons.ArrowLeft className="w-4 h-4" />
                      </button>
                    ) : (
                      <span className="text-xs text-gray-500">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {recentSettlements.length === 0 ? (
                <tr><td colSpan={5} className="p-6 text-center text-gray-500">لا توجد تسويات.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
