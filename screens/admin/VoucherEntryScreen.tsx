import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getSupabaseClient } from '../../supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { useSettings } from '../../contexts/SettingsContext';
import { printJournalVoucherByEntryId, printPaymentVoucherByEntryId, printReceiptVoucherByEntryId } from '../../utils/vouchers';
import { inferDestinationParentCode } from '../../utils/accountDestinationUtils';

type AccountRow = { id: string; code: string; name: string; nameAr: string; parentId?: string; parentCode?: string };
type CostCenterRow = { id: string; name: string; code: string | null };
type PartyRow = { id: string; name: string };
type VoucherHistoryRow = {
  id: string;
  entryDate: string;
  memo: string;
  status: string;
  sourceEvent: string;
  documentNumber: string;
  totalDebit: number;
  baseDebit: number;
  baseCredit: number;
  currency: string;
  createdBy: string;
  lineCount: number;
  lines: {
    accountCode: string;
    accountName: string;
    partyName: string;
    debit: number;
    credit: number;
    currency: string;
    foreignAmount: number;
    memo: string;
  }[];
  voidReason?: string;
};
type VoucherLine = {
  accountCode: string;
  partyId: string;
  debit: string;
  credit: string;
  memo: string;
};

import { translateAccountName } from '../../utils/accountUtils';

const toDateTimeLocalInputValue = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const min = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
};

const emptyLine = (): VoucherLine => ({ accountCode: '', partyId: '', debit: '', credit: '', memo: '' });

/* ═══ Searchable Select ═══ */
function SearchableSelect({ options, value, onChange, placeholder, className }: {
  options: { value: string; label: string; searchText: string }[];
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return options.slice(0, 80);
    return options.filter(o => o.searchText.toLowerCase().includes(q)).slice(0, 80);
  }, [options, search]);

  const selectedLabel = options.find(o => o.value === value)?.label || '';

  return (
    <div ref={ref} className={`relative ${className || ''}`}>
      <input
        ref={inputRef}
        type="text"
        value={open ? search : selectedLabel}
        placeholder={placeholder || '— اختر الحساب —'}
        onChange={(e) => { setSearch(e.target.value); if (!open) setOpen(true); }}
        onFocus={() => { setOpen(true); setSearch(''); }}
        className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 font-mono text-sm"
        autoComplete="off"
      />
      {value && !open && (
        <button type="button" onClick={() => { onChange(''); setSearch(''); }} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-red-500 text-xs">✕</button>
      )}
      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 max-h-60 overflow-y-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-sm text-gray-400">لا نتائج</div>
          ) : (
            filtered.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => { onChange(o.value); setOpen(false); setSearch(''); }}
                className={`w-full text-right px-3 py-1.5 text-sm hover:bg-blue-50 dark:hover:bg-blue-900/30 ${value === o.value ? 'bg-blue-50 dark:bg-blue-900/20 font-bold' : ''}`}
              >
                {o.label}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default function VoucherEntryScreen() {
  const { showNotification } = useToast();
  const { hasPermission, userId } = useAuth();
  const { settings } = useSettings();

  const canView = hasPermission('accounting.view') || hasPermission('accounting.manage');
  const canManage = hasPermission('accounting.manage');
  const canApprove = hasPermission('accounting.approve');
  const canVoid = hasPermission('accounting.void');

  const baseCurrencyCode = String((settings as any)?.baseCurrency || '').trim().toUpperCase() || 'YER';

  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenterRow[]>([]);
  const [parties, setParties] = useState<PartyRow[]>([]);
  const [currencyOptions, setCurrencyOptions] = useState<string[]>([]);

  const [voucherType, setVoucherType] = useState<'receipt' | 'payment' | 'journal'>('receipt');
  const [occurredAt, setOccurredAt] = useState(() => toDateTimeLocalInputValue(new Date()));
  const [memo, setMemo] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<string>('cash');
  const [referenceNumber, setReferenceNumber] = useState<string>('');
  const [destinationAccountCode, setDestinationAccountCode] = useState<string>('');
  const [costCenterId, setCostCenterId] = useState<string>('');

  // Multi-line support
  const [lines, setLines] = useState<VoucherLine[]>([emptyLine(), emptyLine()]);

  // Currency / FX
  const [currencyCode, setCurrencyCode] = useState<string>('');
  const [fxRate, setFxRate] = useState<string>('');
  const [foreignAmount, setForeignAmount] = useState<string>('');
  const [fxSource, setFxSource] = useState<'system' | 'manual' | 'unknown'>('unknown');

  // Attachment
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const [attachmentUrl, setAttachmentUrl] = useState<string>('');
  const [uploadingAttachment, setUploadingAttachment] = useState(false);

  const [busy, setBusy] = useState(false);
  const [lastEntryId, setLastEntryId] = useState<string>('');
  const [lastEntryStatus, setLastEntryStatus] = useState<string>('');

  // History
  const [history, setHistory] = useState<VoucherHistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<'all' | 'draft' | 'pending_approval' | 'posted' | 'voided'>('all');
  const [historyTypeFilter, setHistoryTypeFilter] = useState<'all' | 'receipt' | 'payment' | 'journal'>('all');
  const [historyDateFrom, setHistoryDateFrom] = useState<string>('');
  const [historyDateTo, setHistoryDateTo] = useState<string>('');
  const [historyPage, setHistoryPage] = useState(1);
  const [expandedHistoryEntryId, setExpandedHistoryEntryId] = useState<string>('');

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    if (!canView) {
      setAccounts([]); setCostCenters([]); setParties([]); setLoading(false);
      return;
    }
    void (async () => {
      setLoading(true);
      try {
        const results = await Promise.allSettled([
          supabase.from('chart_of_accounts').select('id,code,name,parent_id').eq('is_active', true).order('code', { ascending: true }).limit(1500),
          supabase.from('cost_centers').select('id,name,code').eq('is_active', true).order('name', { ascending: true }).limit(500),
          supabase.from('financial_parties').select('id,name').eq('is_active', true).order('created_at', { ascending: false }).limit(500),
          supabase.from('currencies').select('code').order('code', { ascending: true }).limit(500),
        ]);
        const coaRes = results[0];
        const ccRes = results[1];
        const fpRes = results[2];
        const curRes = results[3];

        let coaRows: any[] = [];
        if (coaRes.status === 'fulfilled') {
          const payload = coaRes.value as any;
          if (!payload?.error && Array.isArray(payload?.data)) {
            coaRows = payload.data;
          }
        }
        if (coaRows.length === 0) {
          const { data: rpcData, error: rpcErr } = await supabase.rpc('list_active_accounts');
          if (!rpcErr && Array.isArray(rpcData)) {
            coaRows = rpcData.map((r: any) => ({
              id: r?.id,
              code: r?.code,
              name: r?.name,
              parent_id: r?.parent_id,
            }));
          }
        }

        const mappedAccounts: AccountRow[] = (Array.isArray(coaRows) ? coaRows : []).map((r: any) => ({
          id: String(r.id), code: String(r.code || ''), name: String(r.name || ''),
          parentId: r?.parent_id ? String(r.parent_id) : undefined,
          nameAr: translateAccountName(String(r.name || ''))
        }));
        const codeById = new Map(mappedAccounts.map((a) => [a.id, a.code]));
        setAccounts(mappedAccounts.map((a) => {
          const parentCodeRaw = a.parentId ? (codeById.get(a.parentId) || undefined) : undefined;
          const parentCode = inferDestinationParentCode(a.code, parentCodeRaw);
          return { ...a, parentCode };
        }));
        if (ccRes.status === 'fulfilled' && !(ccRes.value as any)?.error) {
          const cc = (ccRes.value as any)?.data;
          setCostCenters((Array.isArray(cc) ? cc : []).map((r: any) => ({ id: String(r.id), name: String(r.name || ''), code: r.code ? String(r.code) : null })));
        } else {
          setCostCenters([]);
        }

        let partiesRows: any[] = [];
        if (fpRes.status === 'fulfilled' && !(fpRes.value as any)?.error) {
          const ps = (fpRes.value as any)?.data;
          partiesRows = Array.isArray(ps) ? ps : [];
        } else {
          const { data: altPs, error: altPsErr } = await supabase
            .from('financial_parties')
            .select('id,name')
            .eq('status', 'active')
            .order('created_at', { ascending: false })
            .limit(500);
          if (!altPsErr && Array.isArray(altPs)) partiesRows = altPs;
        }
        setParties(partiesRows.map((r: any) => ({ id: String(r.id), name: String(r.name || '') })));

        if (curRes.status === 'fulfilled' && !(curRes.value as any)?.error) {
          const cur = (curRes.value as any)?.data;
          setCurrencyOptions((Array.isArray(cur) ? cur : []).map((r: any) => String(r.code || '').trim().toUpperCase()).filter(Boolean));
        } else {
          setCurrencyOptions([]);
        }
      } catch (e: any) {
        showNotification(String(e?.message || 'تعذر تحميل البيانات المساعدة.'), 'error');
      } finally {
        setLoading(false);
      }
    })();
  }, [canView, showNotification]);

  const normalizedCurrency = useMemo(() => String(currencyCode || '').trim().toUpperCase(), [currencyCode]);
  const effectiveCurrency = useMemo(() => normalizedCurrency || baseCurrencyCode, [baseCurrencyCode, normalizedCurrency]);
  const usingForeign = Boolean(normalizedCurrency && normalizedCurrency !== baseCurrencyCode);
  const occurredAtYmd = useMemo(() => {
    const raw = String(occurredAt || '');
    if (raw.length >= 10) return raw.slice(0, 10);
    try { return new Date().toISOString().slice(0, 10); } catch { return ''; }
  }, [occurredAt]);

  const applySystemFxRate = useCallback(async () => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const code = String(normalizedCurrency || '').trim().toUpperCase();
    if (!code || !occurredAtYmd) return;
    if (code === baseCurrencyCode) { setFxRate('1'); setFxSource('system'); return; }
    try {
      const { data, error } = await supabase.rpc('get_fx_rate', { p_currency: code, p_date: occurredAtYmd, p_rate_type: 'operational' } as any);
      if (error) throw error;
      const n = Number(data);
      if (!Number.isFinite(n) || n <= 0) {
        setFxSource('unknown');
        showNotification('لا يوجد سعر صرف تشغيلي لهذه العملة في هذا التاريخ.', 'error');
        return;
      }
      setFxRate(String(n));
      setFxSource('system');
    } catch {
      setFxSource('unknown');
      showNotification('تعذر جلب سعر الصرف من النظام.', 'error');
    }
  }, [baseCurrencyCode, normalizedCurrency, occurredAtYmd, showNotification]);

  useEffect(() => {
    if (!canView) return;
    if (!normalizedCurrency || normalizedCurrency === baseCurrencyCode) {
      if (fxRate) setFxRate('');
      if (foreignAmount) setForeignAmount('');
      if (fxSource !== 'unknown') setFxSource('unknown');
      return;
    }
    if (fxRate && Number(fxRate) > 0) return;
    void applySystemFxRate();
  }, [applySystemFxRate, baseCurrencyCode, canView, foreignAmount, fxRate, fxSource, normalizedCurrency]);

  const fx = useMemo(() => { const n = Number(fxRate || ''); return Number.isFinite(n) && n > 0 ? n : 0; }, [fxRate]);
  const fAmt = useMemo(() => { const n = Number(foreignAmount || ''); return Number.isFinite(n) && n > 0 ? n : 0; }, [foreignAmount]);
  const normalizedVoucherMethod = useMemo(() => {
    const m = String(paymentMethod || '').trim();
    if (m === 'bank_transfer') return 'kuraimi';
    if (m === 'network') return 'network';
    return 'cash';
  }, [paymentMethod]);
  const needsDestination = useMemo(() => voucherType !== 'journal' && (normalizedVoucherMethod === 'kuraimi' || normalizedVoucherMethod === 'network'), [normalizedVoucherMethod, voucherType]);
  const destinationParentCode = useMemo(() => normalizedVoucherMethod === 'kuraimi' ? '1020' : (normalizedVoucherMethod === 'network' ? '1030' : ''), [normalizedVoucherMethod]);
  const voucherDestinationOptions = useMemo(() => {
    return accounts
      .filter((a) => a.parentCode === '1020' || a.parentCode === '1030')
      .filter((a) => String(a.code || '').toUpperCase().endsWith(effectiveCurrency));
  }, [accounts, effectiveCurrency]);

  useEffect(() => {
    if (!needsDestination) {
      setDestinationAccountCode('');
      return;
    }
    const availableForMethod = voucherDestinationOptions.filter((a) => a.parentCode === destinationParentCode);
    if (availableForMethod.length === 0) {
      setDestinationAccountCode('');
      return;
    }
    if (!destinationAccountCode || !availableForMethod.some((a) => a.code === destinationAccountCode)) {
      setDestinationAccountCode(availableForMethod[0].code);
    }
  }, [destinationAccountCode, destinationParentCode, needsDestination, voucherDestinationOptions]);

  // ═══ LINE MANAGEMENT ═══
  const addLine = () => setLines(prev => [...prev, emptyLine()]);
  const removeLine = (idx: number) => setLines(prev => prev.length <= 2 ? prev : prev.filter((_, i) => i !== idx));
  const updateLine = (idx: number, field: keyof VoucherLine, value: string) => {
    setLines(prev => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l));
  };

  const totalDebit = useMemo(() => lines.reduce((s, l) => s + (Number(l.debit) || 0), 0), [lines]);
  const totalCredit = useMemo(() => lines.reduce((s, l) => s + (Number(l.credit) || 0), 0), [lines]);
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.005;

  const buildPayload = () => {
    return lines
      .filter(l => l.accountCode && (Number(l.debit) > 0 || Number(l.credit) > 0))
      .map(l => {
        const payload: any = {
          accountCode: l.accountCode,
          debit: Number(l.debit) || 0,
          credit: Number(l.credit) || 0,
          memo: l.memo || null,
          partyId: l.partyId || null,
          costCenterId: costCenterId || null,
        };
        if (usingForeign && normalizedCurrency) {
          payload.currencyCode = normalizedCurrency;
          payload.foreignAmount = fAmt > 0 ? fAmt : null;
        }
        return payload;
      });
  };

  const loadEntryMeta = async (entryId: string) => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const { data, error } = await supabase.from('journal_entries').select('id,status,created_by').eq('id', entryId).maybeSingle();
    if (error) throw error;
    setLastEntryStatus(String((data as any)?.status || ''));
  };

  // ═══ ATTACHMENT UPLOAD ═══
  const uploadAttachment = async (): Promise<string | null> => {
    if (!attachmentFile) return null;
    const supabase = getSupabaseClient();
    if (!supabase) return null;
    setUploadingAttachment(true);
    try {
      const ext = attachmentFile.name.split('.').pop() || 'bin';
      const path = `voucher-attachments/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await supabase.storage.from('documents').upload(path, attachmentFile, { upsert: false });
      if (error) throw error;
      const { data: urlData } = supabase.storage.from('documents').getPublicUrl(path);
      return urlData?.publicUrl || path;
    } catch (e: any) {
      showNotification(String(e?.message || 'تعذر رفع المرفق.'), 'error');
      return null;
    } finally {
      setUploadingAttachment(false);
    }
  };

  const createVoucher = async () => {
    if (!canManage) { showNotification('ليس لديك صلاحية إنشاء السندات.', 'error'); return; }
    const payload = buildPayload();
    if (payload.length < 2) { showNotification('يجب إدخال سطرين على الأقل.', 'error'); return; }
    const td = payload.reduce((s, l) => s + l.debit, 0);
    const tc = payload.reduce((s, l) => s + l.credit, 0);
    if (Math.abs(td - tc) > 0.005) { showNotification(`مجموع المدين (${td.toFixed(2)}) لا يساوي مجموع الدائن (${tc.toFixed(2)}).`, 'error'); return; }
    if (usingForeign && (!(fx > 0) || !(fAmt > 0))) {
      showNotification('تعذر اعتماد مبلغ أجنبي بدون سعر صرف ومبلغ أجنبي صحيح.', 'error');
      return;
    }
    if (needsDestination) {
      const availableForMethod = voucherDestinationOptions.filter((a) => a.parentCode === destinationParentCode);
      if (availableForMethod.length > 0 && !destinationAccountCode) {
        showNotification('يرجى اختيار الحساب البنكي / شركة الصرافة في السند.', 'error');
        return;
      }
      if (destinationAccountCode && !payload.some((l) => l.accountCode === destinationAccountCode)) {
        const idx = payload.findIndex((l) => voucherType === 'receipt' ? Number(l.debit) > 0 : Number(l.credit) > 0);
        if (idx >= 0) {
          payload[idx].accountCode = destinationAccountCode;
        }
      }
    }
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setBusy(true);
    try {
      // Upload attachment if provided
      let uploadedUrl: string | null = null;
      if (attachmentFile) uploadedUrl = await uploadAttachment();

      const entryDateIso = occurredAt ? new Date(occurredAt).toISOString() : new Date().toISOString();
      const refPart = referenceNumber.trim() ? `[${referenceNumber.trim()}]` : '';
      const fullMemo = [paymentMethod !== 'cash' ? `[${paymentMethodLabel(paymentMethod)}]` : '', refPart, memo].filter(Boolean).join(' ').trim() || null;
      const { data, error } = await supabase.rpc('create_manual_voucher', {
        p_voucher_type: voucherType,
        p_entry_date: entryDateIso,
        p_memo: fullMemo,
        p_lines: payload as any,
        p_journal_id: null,
      } as any);
      if (error) throw error;
      const entryId = String(data || '');
      setLastEntryId(entryId);
      await loadEntryMeta(entryId);
      if (uploadedUrl) setAttachmentUrl(uploadedUrl);
      setAttachmentFile(null);
      setReferenceNumber('');
      showNotification(`تم إنشاء ${voucherTypeLabel} (مسودة).`, 'success');
      void fetchHistory();
    } catch (e: any) {
      showNotification(String(e?.message || 'تعذر إنشاء السند.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  // ═══ HISTORY ═══
  const fetchHistory = useCallback(async () => {
    const supabase = getSupabaseClient();
    if (!supabase || !canView) return;
    setHistoryLoading(true);
    try {
      let query = supabase
        .from('journal_entries')
        .select('id,entry_date,memo,status,source_event,document_id,created_by,void_reason,journal_lines(debit,credit,currency_code,foreign_amount,line_memo,chart_of_accounts(code,name),financial_parties!journal_lines_party_id_fkey(name)),accounting_documents(document_number)')
        .eq('source_table', 'manual')
        .order('entry_date', { ascending: false })
        .range(0, historyPage * 100 - 1);
      if (historyFilter !== 'all') query = query.eq('status', historyFilter);
      if (historyTypeFilter !== 'all') query = query.eq('source_event', historyTypeFilter);
      if (historyDateFrom) query = query.gte('entry_date', historyDateFrom);
      if (historyDateTo) query = query.lte('entry_date', historyDateTo + 'T23:59:59');
      const { data: rows, error } = await query;
      if (error) throw error;
      const mapped: VoucherHistoryRow[] = (rows || []).map((r: any) => {
        const jlines = Array.isArray(r.journal_lines) ? r.journal_lines : [];
        const tDebitBase = jlines.reduce((s: number, l: any) => s + Number(l.debit || 0), 0);
        const tCreditBase = jlines.reduce((s: number, l: any) => s + Number(l.credit || 0), 0);
        let cur = '';
        for (const l of jlines) {
          const code = String(l.currency_code || '').trim().toUpperCase();
          if (code) { cur = code; break; }
        }
        const foreignAmtDebit = jlines
          .filter((l: any) => Number(l.debit || 0) > 0)
          .reduce((s: number, l: any) => s + (Number(l.foreign_amount || 0) > 0 ? Number(l.foreign_amount || 0) : 0), 0);
        const tDebit = foreignAmtDebit > 0 ? foreignAmtDebit : tDebitBase;
        const docNum = Array.isArray(r.accounting_documents)
          ? (r.accounting_documents[0]?.document_number || '')
          : ((r.accounting_documents as any)?.document_number || '');
        const mappedLines = jlines.map((l: any) => ({
          accountCode: String(l?.chart_of_accounts?.code || ''),
          accountName: String(l?.chart_of_accounts?.name || ''),
          partyName: String(l?.financial_parties?.name || ''),
          debit: Number(l.debit || 0),
          credit: Number(l.credit || 0),
          currency: String(l.currency_code || '').trim().toUpperCase(),
          foreignAmount: Number(l.foreign_amount || 0),
          memo: String(l.line_memo || ''),
        }));
        return {
          id: String(r.id || ''),
          entryDate: String(r.entry_date || ''),
          memo: (() => {
            const rawMemo = String(r.memo || '').trim();
            if (rawMemo && !rawMemo.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i)) return rawMemo;
            return 'بدون بيان';
          })(),
          status: String(r.status || ''),
          sourceEvent: String(r.source_event || ''),
          documentNumber: String(docNum),
          totalDebit: tDebit,
          baseDebit: tDebitBase,
          baseCredit: tCreditBase,
          currency: String(cur || '').toUpperCase(),
          createdBy: String(r.created_by || ''),
          lineCount: mappedLines.length,
          lines: mappedLines,
          voidReason: String(r.void_reason || ''),
        };
      });
      setHistory(mapped);
    } catch (e: any) {
      showNotification(String(e?.message || 'تعذر تحميل سجل السندات.'), 'error');
    } finally {
      setHistoryLoading(false);
    }
  }, [canView, historyFilter, historyTypeFilter, historyDateFrom, historyDateTo, historyPage, showNotification]);

  useEffect(() => { void fetchHistory(); }, [fetchHistory]);

  // ═══ HISTORY ACTIONS ═══
  const printHistoryEntry = async (entryId: string, type: string) => {
    try {
      const brand = {
        name: String((settings as any)?.cafeteriaName?.ar || (settings as any)?.cafeteriaName?.en || '').trim(),
        address: String((settings as any)?.address || '').trim(),
        contactNumber: String((settings as any)?.contactNumber || '').trim(),
        logoUrl: String((settings as any)?.logoUrl || '').trim(),
      };
      if (type === 'receipt') await printReceiptVoucherByEntryId(entryId, brand);
      else if (type === 'payment') await printPaymentVoucherByEntryId(entryId, brand);
      else await printJournalVoucherByEntryId(entryId, brand);
    } catch (e: any) {
      showNotification(String(e?.message || 'تعذر الطباعة.'), 'error');
    }
  };

  const approveHistoryEntry = async (entryId: string, currentStatus: string) => {
    if (!canApprove) { showNotification('ليس لديك صلاحية اعتماد السندات.', 'error'); return; }
    const supabase = getSupabaseClient();
    if (!supabase) return;
    try {
      if (currentStatus === 'draft') {
        // Step 1: Submit for approval (Maker)
        const { error } = await supabase.rpc('submit_voucher_for_approval', { p_entry_id: entryId, p_notes: null } as any);
        if (error) throw error;
        showNotification('تم إرسال السند لاعتماد المدير.', 'success');
      } else if (currentStatus === 'pending_approval') {
        // Step 2: Approve (Checker — must be different user)
        const { error } = await supabase.rpc('approve_voucher', { p_entry_id: entryId, p_notes: null } as any);
        if (error) throw error;
        showNotification('تم اعتماد وترحيل السند.', 'success');
      } else {
        showNotification('لا يمكن اعتماد هذا السند في حالته الحالية.', 'error');
        return;
      }
      void fetchHistory();
    } catch (e: any) {
      showNotification(String(e?.message || 'تعذر اعتماد السند.'), 'error');
    }
  };

  const voidHistoryEntry = async (entryId: string) => {
    if (!canVoid) { showNotification('ليس لديك صلاحية إبطال السندات.', 'error'); return; }
    const reason = window.prompt('سبب الإبطال/العكس؟') || '';
    if (!reason.trim()) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;
    try {
      const { error } = await supabase.rpc('void_journal_entry', { p_entry_id: entryId, p_reason: reason.trim() } as any);
      if (error) throw error;
      showNotification('تم إبطال/عكس السند.', 'success');
      void fetchHistory();
    } catch (e: any) {
      showNotification(String(e?.message || 'تعذر إبطال/عكس السند.'), 'error');
    }
  };

  const approveLast = async () => {
    if (!lastEntryId) return;
    if (!canApprove) { showNotification('ليس لديك صلاحية اعتماد السندات.', 'error'); return; }
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setBusy(true);
    try {
      if (lastEntryStatus === 'draft') {
        // Submit for approval — any authorized user can do this
        const { error } = await supabase.rpc('submit_voucher_for_approval', { p_entry_id: lastEntryId, p_notes: null } as any);
        if (error) throw error;
        await loadEntryMeta(lastEntryId);
        showNotification('تم إرسال السند لاعتماد المدير (pending_approval).', 'success');
      } else if (lastEntryStatus === 'pending_approval') {
        // Maker ≠ Checker check happens in DB function
        const { error } = await supabase.rpc('approve_voucher', { p_entry_id: lastEntryId, p_notes: null } as any);
        if (error) throw error;
        await loadEntryMeta(lastEntryId);
        showNotification('تم اعتماد وترحيل السند.', 'success');
      } else {
        showNotification(`لا يمكن اعتماد السند في الحالة '${lastEntryStatus}'.`, 'error');
      }
      void fetchHistory();
    } catch (e: any) {
      showNotification(String(e?.message || 'تعذر اعتماد السند.'), 'error');
    } finally { setBusy(false); }
  };

  const cancelDraftLast = async () => {
    if (!lastEntryId || !canManage) return;
    const ok = window.confirm('إلغاء مسودة السند؟');
    if (!ok) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc('cancel_manual_journal_draft', { p_entry_id: lastEntryId, p_reason: 'إلغاء سند' } as any);
      if (error) throw error;
      await loadEntryMeta(lastEntryId);
      showNotification('تم إلغاء المسودة.', 'success');
      void fetchHistory();
    } catch (e: any) {
      showNotification(String(e?.message || 'تعذر إلغاء المسودة.'), 'error');
    } finally { setBusy(false); }
  };

  const voidLast = async () => {
    if (!lastEntryId || !canVoid) return;
    const reason = window.prompt('سبب الإبطال/العكس؟') || '';
    if (!reason.trim()) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc('void_journal_entry', { p_entry_id: lastEntryId, p_reason: reason.trim() } as any);
      if (error) throw error;
      await loadEntryMeta(lastEntryId);
      showNotification('تم إبطال/عكس السند.', 'success');
      void fetchHistory();
    } catch (e: any) {
      showNotification(String(e?.message || 'تعذر إبطال/عكس السند.'), 'error');
    } finally { setBusy(false); }
  };

  const printLast = async () => {
    if (!lastEntryId) return;
    try {
      const brand = {
        name: String((settings as any)?.cafeteriaName?.ar || (settings as any)?.cafeteriaName?.en || '').trim(),
        address: String((settings as any)?.address || '').trim(),
        contactNumber: String((settings as any)?.contactNumber || '').trim(),
        logoUrl: String((settings as any)?.logoUrl || '').trim(),
      };
      if (voucherType === 'receipt') await printReceiptVoucherByEntryId(lastEntryId, brand);
      else if (voucherType === 'journal') await printJournalVoucherByEntryId(lastEntryId, brand);
      else await printPaymentVoucherByEntryId(lastEntryId, brand);
    } catch (e: any) {
      showNotification(String(e?.message || 'تعذر الطباعة.'), 'error');
    }
  };

  // ═══ EXPORT CSV ═══
  const exportCsv = () => {
    if (history.length === 0) { showNotification('لا توجد بيانات للتصدير.', 'error'); return; }
    const headers = ['رقم الوثيقة', 'النوع', 'التاريخ', 'البيان', 'المبلغ', 'العملة', 'الحالة'];
    const csvRows = [
      headers.join(','),
      ...history.map(h => [
        h.documentNumber || h.id.slice(-8),
        eventLabel(h.sourceEvent),
        (() => { try { return new Date(h.entryDate).toLocaleDateString('en-GB'); } catch { return h.entryDate; } })(),
        `"${(h.memo || '').replace(/"/g, '""')}"`,
        h.totalDebit.toFixed(2),
        h.currency || baseCurrencyCode,
        statusLabel(h.status),
      ].join(','))
    ];
    const bom = '\uFEFF';
    const blob = new Blob([bom + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vouchers_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showNotification('تم تصدير الملف بنجاح.', 'success');
  };

  // ═══ EXPORT XLSX ═══
  const exportXlsx = () => {
    if (history.length === 0) { showNotification('لا توجد بيانات للتصدير.', 'error'); return; }
    // Build HTML table for Excel compatibility (no external lib needed)
    const rows = history.map(h => [
      h.documentNumber || h.id.slice(-8),
      eventLabel(h.sourceEvent),
      (() => { try { return new Date(h.entryDate).toLocaleDateString('ar-SA'); } catch { return h.entryDate; } })(),
      h.memo || '—',
      h.totalDebit,
      h.currency || baseCurrencyCode,
      statusLabel(h.status),
    ]);
    const headers = ['رقم الوثيقة', 'النوع', 'التاريخ', 'البيان', 'المبلغ', 'العملة', 'الحالة'];
    const table = `<table><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${
      rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')
    }</tbody></table>`;
    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="UTF-8"></head><body dir="rtl">${table}</body></html>`;
    const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vouchers_${new Date().toISOString().slice(0, 10)}.xls`;
    a.click();
    URL.revokeObjectURL(url);
    showNotification('تم تصدير ملف Excel بنجاح.', 'success');
  };

  // ═══ HELPERS ═══
  const paymentMethodLabel = (m: string) => {
    if (m === 'cash') return 'نقد';
    if (m === 'check') return 'شيك';
    if (m === 'bank_transfer') return 'تحويل بنكي';
    if (m === 'network') return 'شبكة';
    return m;
  };
  const voucherTypeLabel = useMemo(() => {
    if (voucherType === 'receipt') return 'سند قبض';
    if (voucherType === 'payment') return 'سند صرف';
    return 'سند قيد يومية';
  }, [voucherType]);
  const eventLabel = (e: string) => {
    if (e === 'receipt') return 'قبض';
    if (e === 'payment') return 'صرف';
    if (e === 'journal') return 'قيد';
    return e;
  };
  const statusLabel = (s: string, voidReason?: string) => {
    if (s === 'draft') return 'مسودة';
    if (s === 'pending_approval') return 'بانتظار الاعتماد';
    if (s === 'posted') return 'مُرحّل';
    if (s === 'voided') {
      // Distinguish between cancelled draft vs. truly voided posted entry
      if (voidReason === 'CANCEL_DRAFT' || voidReason?.includes('إلغاء')) return 'ملغاة';
      return 'مبطل';
    }
    if (s === 'rejected') return 'مرفوض';
    return s;
  };
  const statusColor = (s: string, voidReason?: string) => {
    if (s === 'draft') return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200';
    if (s === 'posted') return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200';
    if (s === 'voided') {
      if (voidReason === 'CANCEL_DRAFT' || voidReason?.includes('إلغاء')) return 'bg-gray-100 text-gray-600 dark:bg-gray-700/50 dark:text-gray-400';
      return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200';
    }
    if (s === 'pending_approval') return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200';
    if (s === 'rejected') return 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-200';
    return 'bg-gray-100 text-gray-800';
  };
  const fxSourceLabel = useMemo(() => {
    if (fxSource === 'system') return 'سعر النظام';
    if (fxSource === 'manual') return 'يدوي';
    return 'غير محدد';
  }, [fxSource]);

  const accountOptions = useMemo(() => accounts.map(a => ({
    value: a.code,
    label: `${a.code} — ${a.nameAr}${a.nameAr !== a.name ? ` (${a.name})` : ''}`,
    searchText: `${a.code} ${a.name} ${a.nameAr}`,
  })), [accounts]);

  if (!canView) {
    return <div className="p-8 text-center text-gray-500">لا تملك صلاحية عرض السندات.</div>;
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold dark:text-white">سندات (قبض / صرف / قيد يومية)</h1>
        <div className="text-sm text-gray-500 dark:text-gray-400">إنشاء سند يدوي متعدد الأسطر كمسودة ثم اعتماد.</div>
      </div>

      {loading ? <div className="text-xs text-gray-500 dark:text-gray-400">جاري التحميل...</div> : null}

      {!canManage ? (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-sm text-amber-900 dark:text-amber-200">
          وضع عرض فقط: تحتاج صلاحية accounting.manage لإنشاء السندات.
        </div>
      ) : null}

      {/* ═══ FORM ═══ */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 p-4 space-y-4">
        {/* Row 1: Type, Date, Payment Method, Cost Center */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">نوع السند</div>
            <select value={voucherType} onChange={(e) => setVoucherType(e.target.value as any)} className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
              <option value="receipt">سند قبض</option>
              <option value="payment">سند صرف</option>
              <option value="journal">سند قيد يومية</option>
            </select>
          </div>
          <div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">التاريخ</div>
            <input type="datetime-local" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 font-mono" />
          </div>
          <div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">طريقة الدفع</div>
            <select value={paymentMethod} onChange={(e) => { setPaymentMethod(e.target.value); setReferenceNumber(''); }} className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
              <option value="cash">نقد</option>
              <option value="check">شيك</option>
              <option value="bank_transfer">تحويل بنكي</option>
              <option value="network">شبكة</option>
            </select>
          </div>
          {(paymentMethod === 'check' || paymentMethod === 'bank_transfer') && (
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                {paymentMethod === 'check' ? 'رقم الشيك' : 'رقم الحوالة / المرجع'}
              </div>
              <input
                type="text"
                value={referenceNumber}
                onChange={(e) => setReferenceNumber(e.target.value)}
                placeholder={paymentMethod === 'check' ? 'مثال: 001234' : 'مثال: TRF-20260321'}
                className="w-full px-3 py-2 rounded-lg border border-blue-300 dark:border-blue-600 bg-blue-50 dark:bg-blue-900/20 font-mono text-sm"
              />
            </div>
          )}
          <div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">الحساب المالي الوجهة</div>
            <select
              value={destinationAccountCode}
              onChange={(e) => setDestinationAccountCode(e.target.value)}
              disabled={!needsDestination}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 disabled:opacity-60"
            >
              <option value="">(افتراضي)</option>
              {voucherDestinationOptions
                .filter((a) => !needsDestination || a.parentCode === destinationParentCode)
                .map((a) => (
                  <option key={a.id} value={a.code}>
                    {a.code} — {a.nameAr}{a.nameAr !== a.name ? ` (${a.name})` : ''}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">مركز تكلفة</div>
            <select value={costCenterId} onChange={(e) => setCostCenterId(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
              <option value="">—</option>
              {costCenters.map((c) => (
                <option key={c.id} value={c.id}>{c.name}{c.code ? ` (${c.code})` : ''}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Row 2: Memo */}
        <div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">البيان</div>
          <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="وصف المعاملة..." className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900" />
        </div>

        {/* Row 3: Currency / FX */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">العملة</div>
            <select value={currencyCode} onChange={(e) => { setCurrencyCode(e.target.value); setFxRate(''); setForeignAmount(''); setFxSource('unknown'); }} className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 font-mono">
              <option value="">{baseCurrencyCode}</option>
              {currencyOptions.filter((c) => c !== baseCurrencyCode).map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">سعر الصرف ({fxSourceLabel})</div>
            <input type="number" value={usingForeign ? fxRate : '1'} readOnly disabled={!usingForeign} className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 font-mono disabled:opacity-60" />
          </div>
          <div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">مبلغ أجنبي</div>
            <input type="number" value={foreignAmount} onChange={(e) => setForeignAmount(e.target.value)} disabled={!usingForeign} className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 font-mono disabled:opacity-60" />
          </div>
          {usingForeign && fx > 0 && fAmt > 0 && (
            <div className="flex items-end pb-2">
              <span className="text-xs text-gray-500 dark:text-gray-400 font-mono" dir="ltr">= {(fx * fAmt).toFixed(2)} {baseCurrencyCode}</span>
            </div>
          )}
        </div>

        {/* ═══ MULTI-LINE EDITOR ═══ */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-bold dark:text-white">سطور القيد</div>
            <div className="flex items-center gap-2">
              <span className={`text-xs font-mono px-2 py-0.5 rounded ${isBalanced ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200' : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200'}`}>
                مدين: {totalDebit.toFixed(2)} | دائن: {totalCredit.toFixed(2)} {isBalanced ? '✓' : '✗'}
              </span>
              <button type="button" onClick={addLine} className="px-3 py-1 rounded-lg bg-blue-600 text-white text-xs font-semibold">+ إضافة سطر</button>
            </div>
          </div>
          <div className="w-full overflow-visible pb-16">
            <table className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-lg">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-900/50 text-center">
                  <th className="py-2 px-2 font-semibold text-gray-600 dark:text-gray-300 w-8">#</th>
                  <th className="py-2 px-2 font-semibold text-gray-600 dark:text-gray-300 min-w-[200px]">الحساب</th>
                  <th className="py-2 px-2 font-semibold text-gray-600 dark:text-gray-300 min-w-[150px]">الطرف (اختياري)</th>
                  <th className="py-2 px-2 font-semibold text-gray-600 dark:text-gray-300 w-28">مدين</th>
                  <th className="py-2 px-2 font-semibold text-gray-600 dark:text-gray-300 w-28">دائن</th>
                  <th className="py-2 px-2 font-semibold text-gray-600 dark:text-gray-300 min-w-[120px]">بيان السطر</th>
                  <th className="py-2 px-2 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, idx) => (
                  <tr key={idx} className="border-t border-gray-100 dark:border-gray-700/50">
                    <td className="py-1 px-2 text-center text-xs text-gray-400">{idx + 1}</td>
                    <td className="py-1 px-1">
                      <SearchableSelect options={accountOptions} value={line.accountCode} onChange={(v) => updateLine(idx, 'accountCode', v)} placeholder="بحث بالكود أو الاسم..." />
                    </td>
                    <td className="py-1 px-1">
                      <select value={line.partyId} onChange={(e) => updateLine(idx, 'partyId', e.target.value)} className="w-full px-2 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm">
                        <option value="">—</option>
                        {parties.map(p => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="py-1 px-1">
                      <input type="number" value={line.debit} onChange={(e) => updateLine(idx, 'debit', e.target.value)} placeholder="0.00" className="w-full px-2 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 font-mono text-sm text-center" />
                    </td>
                    <td className="py-1 px-1">
                      <input type="number" value={line.credit} onChange={(e) => updateLine(idx, 'credit', e.target.value)} placeholder="0.00" className="w-full px-2 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 font-mono text-sm text-center" />
                    </td>
                    <td className="py-1 px-1">
                      <input value={line.memo} onChange={(e) => updateLine(idx, 'memo', e.target.value)} placeholder="ملاحظة..." className="w-full px-2 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm" />
                    </td>
                    <td className="py-1 px-1 text-center">
                      {lines.length > 2 && (
                        <button type="button" onClick={() => removeLine(idx)} className="text-red-500 hover:text-red-700 text-lg" title="حذف">×</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ═══ ATTACHMENT ═══ */}
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">مرفق (اختياري)</div>
            <input
              type="file"
              accept="image/*,.pdf,.doc,.docx"
              onChange={(e) => setAttachmentFile(e.target.files?.[0] || null)}
              className="w-full text-sm file:px-3 file:py-1.5 file:rounded-lg file:border file:border-gray-200 dark:file:border-gray-700 file:bg-white dark:file:bg-gray-900 file:text-sm file:font-semibold"
            />
          </div>
          {attachmentUrl && (
            <a href={attachmentUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 underline mt-4">عرض المرفق</a>
          )}
        </div>

        {/* ═══ SUBMIT ═══ */}
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={() => void createVoucher()} disabled={busy || !canManage || uploadingAttachment} className="px-5 py-2.5 rounded-lg bg-emerald-600 text-white font-semibold disabled:opacity-60">
            {busy || uploadingAttachment ? 'جارٍ التنفيذ...' : 'إنشاء سند (مسودة)'}
          </button>
        </div>
      </div>

      {/* ═══ LAST ENTRY ACTIONS ═══ */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm text-gray-700 dark:text-gray-200">
            آخر سند: <span className="font-mono" dir="ltr">{lastEntryId ? lastEntryId.slice(-8) : '—'}</span>
            {lastEntryStatus ? <span className="text-xs text-gray-500 dark:text-gray-400"> · {lastEntryStatus}</span> : null}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void printLast()} disabled={!lastEntryId} className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm disabled:opacity-60">طباعة</button>
            <button type="button" onClick={() => void approveLast()}
              disabled={!lastEntryId || busy || !canApprove || (lastEntryStatus !== 'draft' && lastEntryStatus !== 'pending_approval')}
              className={`px-3 py-2 rounded-lg text-white text-sm font-semibold disabled:opacity-60 ${
                lastEntryStatus === 'pending_approval' ? 'bg-green-600' : 'bg-blue-600'
              }`}>
              {lastEntryStatus === 'pending_approval' ? 'اعتماد وترحيل' : 'إرسال للاعتماد'}
            </button>
            <button type="button" onClick={() => void cancelDraftLast()} disabled={!lastEntryId || busy || !canManage} className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm disabled:opacity-60">إلغاء مسودة</button>
            <button type="button" onClick={() => void voidLast()} disabled={!lastEntryId || busy || !canVoid} className="px-3 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold disabled:opacity-60">إبطال/عكس</button>
          </div>
        </div>
      </div>

      {/* ═══ HISTORY ═══ */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold dark:text-white">سجل السندات</h2>
          <div className="flex items-center gap-2">
            <button type="button" onClick={exportXlsx} disabled={history.length === 0} className="px-3 py-1.5 rounded-lg border border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200 text-sm disabled:opacity-60">
              📊 Excel
            </button>
            <button type="button" onClick={exportCsv} disabled={history.length === 0} className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm disabled:opacity-60">
              📥 CSV
            </button>
            <button type="button" onClick={() => void fetchHistory()} disabled={historyLoading} className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm disabled:opacity-60">
              {historyLoading ? 'جارٍ...' : 'تحديث'}
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select value={historyFilter} onChange={(e) => setHistoryFilter(e.target.value as any)} className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm">
            <option value="all">كل الحالات</option>
            <option value="draft">مسودة</option>
            <option value="pending_approval">بانتظار الاعتماد</option>
            <option value="posted">مُرحّل</option>
            <option value="voided">مبطل / ملغاة</option>
          </select>
          <select value={historyTypeFilter} onChange={(e) => setHistoryTypeFilter(e.target.value as any)} className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm">
            <option value="all">كل الأنواع</option>
            <option value="receipt">سند قبض</option>
            <option value="payment">سند صرف</option>
            <option value="journal">قيد يومية</option>
          </select>
          {/* Date range filter */}
          <div className="flex items-center gap-1">
            <span className="text-xs text-gray-500 dark:text-gray-400">من:</span>
            <input type="date" value={historyDateFrom} onChange={(e) => setHistoryDateFrom(e.target.value)}
              className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm font-mono" />
          </div>
          <div className="flex items-center gap-1">
            <span className="text-xs text-gray-500 dark:text-gray-400">إلى:</span>
            <input type="date" value={historyDateTo} onChange={(e) => setHistoryDateTo(e.target.value)}
              className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm font-mono" />
          </div>
          {(historyDateFrom || historyDateTo) && (
            <button type="button" onClick={() => { setHistoryDateFrom(''); setHistoryDateTo(''); }}
              className="text-xs text-red-500 hover:text-red-700 px-2 py-1 rounded border border-red-200 dark:border-red-800">
              ✕ مسح الفترة
            </button>
          )}
          {historyPage > 1 && (
            <button type="button" onClick={() => { setHistoryPage(1); setExpandedHistoryEntryId(''); }}
              className="text-xs text-blue-600 hover:text-blue-700 px-2 py-1 rounded border border-blue-200 dark:border-blue-800">
              إرجاع لأول 100
            </button>
          )}
        </div>
        {historyLoading ? (
          <div className="text-xs text-gray-500 dark:text-gray-400 py-4 text-center">جاري تحميل السجل...</div>
        ) : history.length === 0 ? (
          <div className="text-sm text-gray-500 dark:text-gray-400 py-4 text-center">لا توجد سندات مسجلة.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b dark:border-gray-700 text-center">
                  <th className="py-2 px-2 font-semibold text-gray-600 dark:text-gray-300">رقم الوثيقة</th>
                  <th className="py-2 px-2 font-semibold text-gray-600 dark:text-gray-300">النوع</th>
                  <th className="py-2 px-2 font-semibold text-gray-600 dark:text-gray-300">التاريخ</th>
                  <th className="py-2 px-2 font-semibold text-gray-600 dark:text-gray-300">البيان</th>
                  <th className="py-2 px-2 font-semibold text-gray-600 dark:text-gray-300">المبلغ</th>
                  <th className="py-2 px-2 font-semibold text-gray-600 dark:text-gray-300">العملة</th>
                  <th className="py-2 px-2 font-semibold text-gray-600 dark:text-gray-300">السطور</th>
                  <th className="py-2 px-2 font-semibold text-gray-600 dark:text-gray-300">الحالة</th>
                  <th className="py-2 px-2 font-semibold text-gray-600 dark:text-gray-300">عمليات</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <Fragment key={h.id}>
                    <tr key={h.id} className="border-b dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/30 text-center">
                      <td className="py-2 px-2 font-mono text-xs" dir="ltr">{h.documentNumber || h.id.slice(-8)}</td>
                      <td className="py-2 px-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${h.sourceEvent === 'receipt' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200'
                          : h.sourceEvent === 'payment' ? 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-200'
                            : 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-200'
                          }`}>{eventLabel(h.sourceEvent)}</span>
                      </td>
                      <td className="py-2 px-2 font-mono text-xs" dir="ltr">
                        {(() => {
                          try {
                            const d = new Date(h.entryDate);
                            return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
                          } catch { return h.entryDate; }
                        })()}
                      </td>
                      <td className="py-2 px-2 text-gray-700 dark:text-gray-300 max-w-[200px] truncate">{h.memo && h.memo.length > 3 ? h.memo : '—'}</td>
                      <td className="py-2 px-2 font-mono font-bold" dir="ltr">
                        {h.totalDebit > 0 ? h.totalDebit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                      </td>
                      <td className="py-2 px-2 text-xs font-mono" dir="ltr">{h.currency || baseCurrencyCode}</td>
                      <td className="py-2 px-2 text-xs font-mono" dir="ltr">{h.lineCount}</td>
                      <td className="py-2 px-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${statusColor(h.status, h.voidReason)}`}>
                          {statusLabel(h.status, h.voidReason)}
                        </span>
                      </td>
                      <td className="py-2 px-2">
                        <div className="flex items-center justify-center gap-1">
                          <button type="button" onClick={() => setExpandedHistoryEntryId(expandedHistoryEntryId === h.id ? '' : h.id)} className="px-2 py-1 rounded text-xs border border-blue-200 dark:border-blue-700 text-blue-700 dark:text-blue-200 hover:bg-blue-50 dark:hover:bg-blue-900/20">
                            {expandedHistoryEntryId === h.id ? 'إخفاء' : 'تفاصيل'}
                          </button>
                          <button type="button" onClick={() => void printHistoryEntry(h.id, h.sourceEvent)} className="px-2 py-1 rounded text-xs border border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700">
                            طباعة
                          </button>
                          {(h.status === 'draft' || h.status === 'pending_approval') && canApprove ? (
                            <button type="button" onClick={() => void approveHistoryEntry(h.id, h.status)}
                              className={`px-2 py-1 rounded text-xs text-white hover:opacity-90 ${
                                h.status === 'draft' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-green-600 hover:bg-green-700'
                              }`}>
                              {h.status === 'draft' ? 'إرسال للاعتماد' : 'اعتماد وترحيل'}
                            </button>
                          ) : null}
                          {h.status === 'pending_approval' && canApprove ? (
                            <button type="button" onClick={async () => {
                              const reason = window.prompt('سبب الرفض؟');
                              if (!reason?.trim()) return;
                              const supabase = getSupabaseClient();
                              if (!supabase) return;
                              try {
                                const { error } = await supabase.rpc('reject_voucher', { p_entry_id: h.id, p_reason: reason.trim() } as any);
                                if (error) throw error;
                                showNotification('تم رفض السند وإعادته للمسودة.', 'success');
                                void fetchHistory();
                              } catch (e: any) { showNotification(String(e?.message || 'تعذر الرفض.'), 'error'); }
                            }} className="px-2 py-1 rounded text-xs bg-red-500 text-white hover:bg-red-600">
                              رفض
                            </button>
                          ) : null}
                          {h.status === 'pending_approval' && h.createdBy === userId ? (
                            <button type="button" onClick={async () => {
                              if (!window.confirm('سحب السند وإعادته للمسودة؟')) return;
                              const supabase = getSupabaseClient();
                              if (!supabase) return;
                              try {
                                const { error } = await supabase.rpc('recall_voucher', { p_entry_id: h.id } as any);
                                if (error) throw error;
                                showNotification('تم سحب السند وإعادته للمسودة.', 'success');
                                void fetchHistory();
                              } catch (e: any) { showNotification(String(e?.message || 'تعذر السحب.'), 'error'); }
                            }} className="px-2 py-1 rounded text-xs bg-gray-400 text-white hover:bg-gray-500">
                              سحب
                            </button>
                          ) : null}
                          {(h.status === 'draft' || h.status === 'posted') && canVoid ? (
                            <button type="button" onClick={() => void voidHistoryEntry(h.id)} className="px-2 py-1 rounded text-xs bg-red-600 text-white hover:bg-red-700">
                              إبطال
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                    {expandedHistoryEntryId === h.id ? (
                      <tr className="border-b dark:border-gray-700/50 bg-gray-50/70 dark:bg-gray-900/20">
                        <td colSpan={9} className="py-3 px-3">
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs mb-3">
                            <div className="px-2 py-1 rounded bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                              <span className="text-gray-500 dark:text-gray-400">مدين (أساسي): </span>
                              <span className="font-mono" dir="ltr">{h.baseDebit.toFixed(2)} {baseCurrencyCode}</span>
                            </div>
                            <div className="px-2 py-1 rounded bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                              <span className="text-gray-500 dark:text-gray-400">دائن (أساسي): </span>
                              <span className="font-mono" dir="ltr">{h.baseCredit.toFixed(2)} {baseCurrencyCode}</span>
                            </div>
                            <div className="px-2 py-1 rounded bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                              <span className="text-gray-500 dark:text-gray-400">منشئ السند: </span>
                              <span className="font-mono" dir="ltr">{h.createdBy ? h.createdBy.slice(0, 8) : '—'}</span>
                            </div>
                          </div>
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="border-b dark:border-gray-700 text-center">
                                  <th className="py-1 px-1">الحساب</th>
                                  <th className="py-1 px-1">الطرف</th>
                                  <th className="py-1 px-1">مدين</th>
                                  <th className="py-1 px-1">دائن</th>
                                  <th className="py-1 px-1">عملة</th>
                                  <th className="py-1 px-1">أجنبي</th>
                                  <th className="py-1 px-1">البيان</th>
                                </tr>
                              </thead>
                              <tbody>
                                {h.lines.map((ln, idx) => (
                                  <tr key={`${h.id}-${idx}`} className="border-b dark:border-gray-700/40 text-center">
                                    <td className="py-1 px-1">{ln.accountCode || '—'} {ln.accountName ? `— ${ln.accountName}` : ''}</td>
                                    <td className="py-1 px-1">{ln.partyName || '—'}</td>
                                    <td className="py-1 px-1 font-mono" dir="ltr">{ln.debit > 0 ? ln.debit.toFixed(2) : '—'}</td>
                                    <td className="py-1 px-1 font-mono" dir="ltr">{ln.credit > 0 ? ln.credit.toFixed(2) : '—'}</td>
                                    <td className="py-1 px-1 font-mono" dir="ltr">{ln.currency || baseCurrencyCode}</td>
                                    <td className="py-1 px-1 font-mono" dir="ltr">{ln.foreignAmount > 0 ? ln.foreignAmount.toFixed(2) : '—'}</td>
                                    <td className="py-1 px-1">{ln.memo || '—'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
          <span>المعروض الآن: {history.length} سند</span>
          <button
            type="button"
            onClick={() => setHistoryPage((p) => p + 1)}
            disabled={historyLoading || history.length < historyPage * 100}
            className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm disabled:opacity-60"
          >
            تحميل المزيد
          </button>
        </div>
      </div>
    </div>
  );
}
