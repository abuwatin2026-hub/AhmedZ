import { useCallback, useEffect, useMemo, useState } from 'react';
import { renderToString } from 'react-dom/server';
import { getSupabaseClient } from '../../supabase';
import { useToast } from '../../contexts/ToastContext';
import { useSettings } from '../../contexts/SettingsContext';
import { useAuth } from '../../contexts/AuthContext';
import PageLoader from '../../components/PageLoader';
import { printContent } from '../../utils/printUtils';
import { sharePdf } from '../../utils/export';
import PrintableContract, { ContractPrintData } from '../../components/admin/documents/PrintableContract';
import PrintableGuarantee, { GuaranteePrintData } from '../../components/admin/documents/PrintableGuarantee';

/* ── types ── */
type Employee = { id: string; full_name: string; employee_code?: string | null; monthly_salary: number; currency: string };

type Contract = {
  id: string; employee_id: string; contract_number?: string | null;
  contract_type: string; start_date: string; end_date?: string | null;
  job_title?: string | null; department?: string | null; work_location?: string | null;
  salary: number; currency: string;
  salary_breakdown: Record<string, number>;
  probation_days: number; working_hours_per_day: number; working_days_per_week: number;
  vacation_days_annual: number; special_terms?: string | null;
  status: string; notes?: string | null; created_at: string;
};

type Guarantee = {
  id: string; employee_id: string; guarantee_number?: string | null;
  guarantee_type: string; guarantor_name: string;
  guarantor_id_number?: string | null; guarantor_phone?: string | null;
  guarantor_address?: string | null; guarantor_relationship?: string | null;
  guarantee_amount: number; currency: string;
  valid_from: string; valid_until?: string | null;
  special_terms?: string | null; status: string; notes?: string | null; created_at: string;
};

type HrApprovalRow = {
  id: string;
  document_type: 'contract' | 'guarantee';
  document_id: string;
  action: string;
  from_status?: string | null;
  to_status?: string | null;
  comment?: string | null;
  signature_name?: string | null;
  performed_at: string;
};
type PrintMode = 'full' | 'compact';

const STATUS_LABELS: Record<string, string> = {
  draft: 'مسودة',
  under_review: 'قيد المراجعة',
  approved: 'معتمد',
  signed: 'موقّع',
  active: 'نشط',
  expired: 'منتهي',
  terminated: 'مُنهى',
  released: 'مُحرَّر',
  archived: 'مؤرشف',
};
const CONTRACT_TYPES: Record<string, string> = { definite: 'محدد المدة', indefinite: 'غير محدد المدة', probation: 'تحت التجربة', part_time: 'دوام جزئي' };
const GUARANTEE_TYPES: Record<string, string> = { personal: 'شخصي', financial: 'مالي', property: 'عيني' };
const statusColor = (s: string) => {
  if (s === 'draft') return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300';
  if (s === 'under_review') return 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300';
  if (s === 'approved') return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300';
  if (s === 'signed' || s === 'active') return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300';
  if (s === 'archived' || s === 'released') return 'bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
  if (s === 'expired' || s === 'terminated') return 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300';
  return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
};
const fmtDate = (d?: string | null) => { if (!d) return '—'; try { return new Date(d).toLocaleDateString('ar-EG-u-nu-latn'); } catch { return d; } };
const fmtMoney = (n: number) => { try { return Number(n || 0).toLocaleString('ar-EG-u-nu-latn', { minimumFractionDigits: 0, maximumFractionDigits: 2 }); } catch { return String(n); } };
const ymd = (d?: Date) => { const x = d || new Date(); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };

/* ── Print helpers (async with tracking) ── */

/* ── Main Screen ── */
export default function EmployeeHRScreen() {
  const { showNotification } = useToast();
  const { settings } = useSettings();
  const { hasPermission } = useAuth();
  const [tab, setTab] = useState<'contracts' | 'guarantees'>('contracts');
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [guarantees, setGuarantees] = useState<Guarantee[]>([]);
  const [filterEmployee, setFilterEmployee] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');

  /* modal state — contracts */
  const [cModalOpen, setCModalOpen] = useState(false);
  const [editingContract, setEditingContract] = useState<Contract | null>(null);
  const emptyContract = (): Partial<Contract> => ({ contract_type: 'indefinite', start_date: ymd(), salary: 0, currency: 'YER', salary_breakdown: {}, probation_days: 90, working_hours_per_day: 8, working_days_per_week: 6, vacation_days_annual: 30, status: 'draft' });
  const [cForm, setCForm] = useState<Record<string, any>>(emptyContract());
  const [bdKey, setBdKey] = useState(''); const [bdVal, setBdVal] = useState(0);

  /* modal state — guarantees */
  const [gModalOpen, setGModalOpen] = useState(false);
  const [editingGuarantee, setEditingGuarantee] = useState<Guarantee | null>(null);
  const emptyGuarantee = (): Partial<Guarantee> => ({ guarantee_type: 'personal', guarantor_name: '', guarantee_amount: 0, currency: 'YER', valid_from: ymd(), status: 'active' });
  const [gForm, setGForm] = useState<Record<string, any>>(emptyGuarantee());
  const [historyOpenKey, setHistoryOpenKey] = useState<string>('');
  const [approvalsByKey, setApprovalsByKey] = useState<Record<string, HrApprovalRow[]>>({});
  const canManageHr = hasPermission('hr.contracts.manage') || hasPermission('expenses.manage') || hasPermission('accounting.manage');
  const canApproveHr = hasPermission('hr.contracts.approve') || hasPermission('accounting.approve');
  const canViewHr = hasPermission('hr.contracts.view') || canManageHr || canApproveHr;

  const brand = useMemo(() => ({
    name: (settings.cafeteriaName?.ar || settings.cafeteriaName?.en || '').trim(),
    address: (settings.address || '').trim(),
    contactNumber: (settings.contactNumber || '').trim(),
    logoUrl: (settings.logoUrl || '').trim(),
  }), [settings]);

  const exportRenderedHtmlPdf = async (html: string, title: string, filename: string) => {
    const hostId = `hr-doc-pdf-export-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
    const host = document.createElement('div');
    host.id = hostId;
    host.style.cssText = 'position:fixed;left:-10000px;top:0;width:210mm;max-width:210mm;background:#fff;z-index:-1;opacity:1;pointer-events:none;contain:layout style paint;';
    host.innerHTML = html;
    document.body.appendChild(host);
    try {
      await new Promise((r) => setTimeout(r, 60));
      return await sharePdf(hostId, title, filename, {
        unit: 'mm',
        pageFormat: 'a4',
        scale: 2.8,
        headerHeight: 0,
        footerHeight: 0,
        headerTitle: '',
        headerSubtitle: '',
        footerText: '',
        pageNumbers: false,
      });
    } finally {
      try { if (host.parentNode) host.parentNode.removeChild(host); } catch { }
    }
  };

  /* ── Async print: contract ── */
  const handlePrintContract = async (c: Contract, mode: PrintMode = 'full') => {
    const s = getSupabaseClient();
    const emp = employees.find(e => e.id === c.employee_id);
    let pn: number | null = null;
    if (s) {
      try {
        const { data } = await s.rpc('track_document_print', { p_source_table: 'employee_contracts', p_source_id: c.id, p_template: 'PrintableContract' });
        pn = typeof data === 'number' ? data : null;
      } catch { /* ignore tracking errors */ }
    }
    const contractData: ContractPrintData = {
      contractNumber: c.contract_number || '',
      contractType: c.contract_type,
      startDate: c.start_date,
      endDate: c.end_date,
      jobTitle: c.job_title,
      department: c.department,
      workLocation: c.work_location,
      salary: c.salary,
      currency: c.currency,
      salaryBreakdown: c.salary_breakdown || {},
      probationDays: c.probation_days,
      workingHoursPerDay: c.working_hours_per_day,
      workingDaysPerWeek: c.working_days_per_week,
      vacationDaysAnnual: c.vacation_days_annual,
      specialTerms: c.special_terms,
      employeeName: emp?.full_name || '',
      employeeCode: emp?.employee_code,
    };
    const html = renderToString(
      <PrintableContract data={contractData} companyName={brand.name} companyPhone={brand.contactNumber} companyAddress={brand.address} logoUrl={brand.logoUrl} printNumber={pn} printMode={mode} />
    );
    printContent(html, `عقد عمل (${mode === 'compact' ? 'مضغوطة' : 'كاملة'}) — ${emp?.full_name || ''}`, { page: 'A4', includeAppStyles: false });
  };

  const handleExportContractPdf = async (c: Contract, mode: PrintMode = 'full') => {
    const s = getSupabaseClient();
    const emp = employees.find(e => e.id === c.employee_id);
    let pn: number | null = null;
    if (s) {
      try {
        const { data } = await s.rpc('track_document_print', { p_source_table: 'employee_contracts', p_source_id: c.id, p_template: 'PrintableContractPDF' });
        pn = typeof data === 'number' ? data : null;
      } catch { }
    }
    const contractData: ContractPrintData = {
      contractNumber: c.contract_number || '',
      contractType: c.contract_type,
      startDate: c.start_date,
      endDate: c.end_date,
      jobTitle: c.job_title,
      department: c.department,
      workLocation: c.work_location,
      salary: c.salary,
      currency: c.currency,
      salaryBreakdown: c.salary_breakdown || {},
      probationDays: c.probation_days,
      workingHoursPerDay: c.working_hours_per_day,
      workingDaysPerWeek: c.working_days_per_week,
      vacationDaysAnnual: c.vacation_days_annual,
      specialTerms: c.special_terms,
      employeeName: emp?.full_name || '',
      employeeCode: emp?.employee_code,
    };
    const html = renderToString(
      <PrintableContract data={contractData} companyName={brand.name} companyPhone={brand.contactNumber} companyAddress={brand.address} logoUrl={brand.logoUrl} printNumber={pn} printMode={mode} />
    );
    const ok = await exportRenderedHtmlPdf(
      html,
      `عقد عمل ${mode === 'compact' ? 'مضغوط' : 'كامل'}`,
      `employee_contract_${(emp?.employee_code || c.id || '').toString().slice(-8)}_${mode}.pdf`
    );
    showNotification(ok ? 'تم تصدير PDF بنجاح' : 'تعذر تصدير PDF', ok ? 'success' : 'error');
  };

  /* ── Async print: guarantee ── */
  const handlePrintGuarantee = async (g: Guarantee, mode: PrintMode = 'full') => {
    const s = getSupabaseClient();
    const emp = employees.find(e => e.id === g.employee_id);
    let pn: number | null = null;
    if (s) {
      try {
        const { data } = await s.rpc('track_document_print', { p_source_table: 'employee_guarantees', p_source_id: g.id, p_template: 'PrintableGuarantee' });
        pn = typeof data === 'number' ? data : null;
      } catch { /* ignore tracking errors */ }
    }
    const guaranteeData: GuaranteePrintData = {
      guaranteeNumber: g.guarantee_number || '',
      guaranteeType: g.guarantee_type,
      guarantorName: g.guarantor_name,
      guarantorIdNumber: g.guarantor_id_number,
      guarantorPhone: g.guarantor_phone,
      guarantorAddress: g.guarantor_address,
      guarantorRelationship: g.guarantor_relationship,
      guaranteeAmount: g.guarantee_amount,
      currency: g.currency,
      validFrom: g.valid_from,
      validUntil: g.valid_until,
      specialTerms: g.special_terms,
      employeeName: emp?.full_name || '',
      employeeCode: emp?.employee_code,
    };
    const html = renderToString(
      <PrintableGuarantee data={guaranteeData} companyName={brand.name} companyPhone={brand.contactNumber} companyAddress={brand.address} logoUrl={brand.logoUrl} printNumber={pn} printMode={mode} />
    );
    printContent(html, `ضمان موظف (${mode === 'compact' ? 'مضغوطة' : 'كاملة'}) — ${emp?.full_name || ''}`, { page: 'A4', includeAppStyles: false });
  };

  const handleExportGuaranteePdf = async (g: Guarantee, mode: PrintMode = 'full') => {
    const s = getSupabaseClient();
    const emp = employees.find(e => e.id === g.employee_id);
    let pn: number | null = null;
    if (s) {
      try {
        const { data } = await s.rpc('track_document_print', { p_source_table: 'employee_guarantees', p_source_id: g.id, p_template: 'PrintableGuaranteePDF' });
        pn = typeof data === 'number' ? data : null;
      } catch { }
    }
    const guaranteeData: GuaranteePrintData = {
      guaranteeNumber: g.guarantee_number || '',
      guaranteeType: g.guarantee_type,
      guarantorName: g.guarantor_name,
      guarantorIdNumber: g.guarantor_id_number,
      guarantorPhone: g.guarantor_phone,
      guarantorAddress: g.guarantor_address,
      guarantorRelationship: g.guarantor_relationship,
      guaranteeAmount: g.guarantee_amount,
      currency: g.currency,
      validFrom: g.valid_from,
      validUntil: g.valid_until,
      specialTerms: g.special_terms,
      employeeName: emp?.full_name || '',
      employeeCode: emp?.employee_code,
    };
    const html = renderToString(
      <PrintableGuarantee data={guaranteeData} companyName={brand.name} companyPhone={brand.contactNumber} companyAddress={brand.address} logoUrl={brand.logoUrl} printNumber={pn} printMode={mode} />
    );
    const ok = await exportRenderedHtmlPdf(
      html,
      `ضمان موظف ${mode === 'compact' ? 'مضغوط' : 'كامل'}`,
      `employee_guarantee_${(emp?.employee_code || g.id || '').toString().slice(-8)}_${mode}.pdf`
    );
    showNotification(ok ? 'تم تصدير PDF بنجاح' : 'تعذر تصدير PDF', ok ? 'success' : 'error');
  };

  /* ── Print blank contract template ── */
  const handlePrintBlankContract = (mode: PrintMode = 'full') => {
    const blankData: ContractPrintData = {
      contractNumber: '',
      contractType: 'indefinite',
      startDate: '',
      endDate: null,
      jobTitle: null,
      department: null,
      workLocation: null,
      salary: 0,
      currency: 'YER',
      salaryBreakdown: {},
      probationDays: 90,
      workingHoursPerDay: 8,
      workingDaysPerWeek: 6,
      vacationDaysAnnual: 30,
      specialTerms: null,
      employeeName: '',
      employeeCode: null,
    };
    const html = renderToString(
      <PrintableContract data={blankData} companyName={brand.name} companyPhone={brand.contactNumber} companyAddress={brand.address} logoUrl={brand.logoUrl} printMode={mode} />
    );
    printContent(html, `نموذج عقد عمل فارغ (${mode === 'compact' ? 'مضغوطة' : 'كاملة'})`, { page: 'A4', includeAppStyles: false });
  };

  const handleExportBlankContractPdf = async (mode: PrintMode = 'full') => {
    const blankData: ContractPrintData = {
      contractNumber: '',
      contractType: 'indefinite',
      startDate: '',
      endDate: null,
      jobTitle: null,
      department: null,
      workLocation: null,
      salary: 0,
      currency: 'YER',
      salaryBreakdown: {},
      probationDays: 90,
      workingHoursPerDay: 8,
      workingDaysPerWeek: 6,
      vacationDaysAnnual: 30,
      specialTerms: null,
      employeeName: '',
      employeeCode: null,
    };
    const html = renderToString(
      <PrintableContract data={blankData} companyName={brand.name} companyPhone={brand.contactNumber} companyAddress={brand.address} logoUrl={brand.logoUrl} printMode={mode} />
    );
    const ok = await exportRenderedHtmlPdf(html, `نموذج عقد عمل فارغ ${mode === 'compact' ? 'مضغوط' : 'كامل'}`, `blank_employee_contract_${mode}.pdf`);
    showNotification(ok ? 'تم تصدير PDF بنجاح' : 'تعذر تصدير PDF', ok ? 'success' : 'error');
  };

  /* ── Print blank guarantee template ── */
  const handlePrintBlankGuarantee = (mode: PrintMode = 'full') => {
    const blankData: GuaranteePrintData = {
      guaranteeNumber: '',
      guaranteeType: 'personal',
      guarantorName: '',
      guarantorIdNumber: null,
      guarantorPhone: null,
      guarantorAddress: null,
      guarantorRelationship: null,
      guaranteeAmount: 0,
      currency: 'YER',
      validFrom: '',
      validUntil: null,
      specialTerms: null,
      employeeName: '',
      employeeCode: null,
    };
    const html = renderToString(
      <PrintableGuarantee data={blankData} companyName={brand.name} companyPhone={brand.contactNumber} companyAddress={brand.address} logoUrl={brand.logoUrl} printMode={mode} />
    );
    printContent(html, `نموذج ضمان موظف فارغ (${mode === 'compact' ? 'مضغوطة' : 'كاملة'})`, { page: 'A4', includeAppStyles: false });
  };

  const handleExportBlankGuaranteePdf = async (mode: PrintMode = 'full') => {
    const blankData: GuaranteePrintData = {
      guaranteeNumber: '',
      guaranteeType: 'personal',
      guarantorName: '',
      guarantorIdNumber: null,
      guarantorPhone: null,
      guarantorAddress: null,
      guarantorRelationship: null,
      guaranteeAmount: 0,
      currency: 'YER',
      validFrom: '',
      validUntil: null,
      specialTerms: null,
      employeeName: '',
      employeeCode: null,
    };
    const html = renderToString(
      <PrintableGuarantee data={blankData} companyName={brand.name} companyPhone={brand.contactNumber} companyAddress={brand.address} logoUrl={brand.logoUrl} printMode={mode} />
    );
    const ok = await exportRenderedHtmlPdf(html, `نموذج ضمان موظف فارغ ${mode === 'compact' ? 'مضغوط' : 'كامل'}`, `blank_employee_guarantee_${mode}.pdf`);
    showNotification(ok ? 'تم تصدير PDF بنجاح' : 'تعذر تصدير PDF', ok ? 'success' : 'error');
  };

  const loadAll = useCallback(async () => {
    const s = getSupabaseClient(); if (!s) { setLoading(false); return; }
    setLoading(true);
    try {
      const [{ data: e }, { data: c }, { data: g }] = await Promise.all([
        s.from('payroll_employees').select('id,full_name,employee_code,monthly_salary,currency').order('full_name'),
        s.from('employee_contracts').select('*').order('created_at', { ascending: false }),
        s.from('employee_guarantees').select('*').order('created_at', { ascending: false }),
      ]);
      setEmployees((e || []).map((x: any) => ({ id: x.id, full_name: x.full_name, employee_code: x.employee_code, monthly_salary: Number(x.monthly_salary || 0), currency: x.currency || 'YER' })));
      setContracts((c || []).map((x: any) => ({ ...x, salary: Number(x.salary || 0), probation_days: Number(x.probation_days || 90), working_hours_per_day: Number(x.working_hours_per_day || 8), working_days_per_week: Number(x.working_days_per_week || 6), vacation_days_annual: Number(x.vacation_days_annual || 30), salary_breakdown: x.salary_breakdown || {} })));
      setGuarantees((g || []).map((x: any) => ({ ...x, guarantee_amount: Number(x.guarantee_amount || 0) })));
    } catch (e: any) { showNotification(e?.message || 'خطأ', 'error'); }
    finally { setLoading(false); }
  }, [showNotification]);

  useEffect(() => { void loadAll(); }, [loadAll]);

  const empName = (id: string) => employees.find(e => e.id === id)?.full_name || '—';
  const statusOptionsContracts = ['draft', 'under_review', 'approved', 'signed', 'active', 'expired', 'terminated', 'archived'];
  const statusOptionsGuarantees = ['draft', 'under_review', 'approved', 'signed', 'active', 'expired', 'released', 'archived'];

  const openApprovalHistory = async (documentType: 'contract' | 'guarantee', documentId: string) => {
    const key = `${documentType}:${documentId}`;
    if (historyOpenKey === key) {
      setHistoryOpenKey('');
      return;
    }
    setHistoryOpenKey(key);
    if (approvalsByKey[key]) return;
    const s = getSupabaseClient(); if (!s) return;
    try {
      const { data, error } = await s
        .from('hr_document_approvals')
        .select('id,document_type,document_id,action,from_status,to_status,comment,signature_name,performed_at')
        .eq('document_type', documentType)
        .eq('document_id', documentId)
        .order('performed_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      setApprovalsByKey(prev => ({ ...prev, [key]: Array.isArray(data) ? data as HrApprovalRow[] : [] }));
    } catch (e: any) {
      showNotification(e?.message || 'تعذر تحميل سجل الاعتماد', 'error');
    }
  };

  const transitionDocument = async (documentType: 'contract' | 'guarantee', documentId: string, action: string) => {
    const s = getSupabaseClient(); if (!s) return;
    const requiresSignature = action === 'sign';
    const signatureName = requiresSignature ? (window.prompt('أدخل اسم الموقّع') || '').trim() : '';
    if (requiresSignature && !signatureName) {
      showNotification('الاسم التوقيعي مطلوب لإتمام التوقيع', 'error');
      return;
    }
    const comment = (window.prompt('ملاحظة الإجراء (اختياري)') || '').trim();
    try {
      const { error } = await s.rpc('hr_transition_employee_document', {
        p_document_type: documentType,
        p_document_id: documentId,
        p_action: action,
        p_comment: comment || null,
        p_signature_name: signatureName || null,
      });
      if (error) throw error;
      await loadAll();
      setApprovalsByKey(prev => {
        const next = { ...prev };
        delete next[`${documentType}:${documentId}`];
        return next;
      });
      showNotification('تم تنفيذ الإجراء بنجاح', 'success');
    } catch (e: any) {
      showNotification(e?.message || 'فشل تنفيذ الإجراء', 'error');
    }
  };

  /* ── Contract CRUD ── */
  const openCModal = (c?: Contract) => {
    if (c) { setEditingContract(c); setCForm({ ...c }); } else { setEditingContract(null); setCForm(emptyContract()); }
    setCModalOpen(true);
  };
  const saveContract = async () => {
    if (!canManageHr) { showNotification('ليس لديك صلاحية إدارة العقود.', 'error'); return; }
    const s = getSupabaseClient(); if (!s) return;
    const p: any = { ...cForm }; delete p.id; delete p.created_at;
    if (!p.employee_id) { showNotification('اختر الموظف', 'error'); return; }
    if (!p.start_date) { showNotification('أدخل تاريخ بداية العقد', 'error'); return; }
    if (p.end_date && p.end_date < p.start_date) { showNotification('تاريخ انتهاء العقد يجب أن يكون بعد تاريخ البداية', 'error'); return; }
    if ((Number(p.salary) || 0) < 0) { showNotification('الراتب لا يمكن أن يكون سالبًا', 'error'); return; }
    if ((Number(p.working_hours_per_day) || 0) <= 0) { showNotification('ساعات العمل اليومية يجب أن تكون أكبر من صفر', 'error'); return; }
    const wd = Number(p.working_days_per_week) || 0;
    if (wd <= 0 || wd > 7) { showNotification('أيام العمل الأسبوعية يجب أن تكون بين 1 و 7', 'error'); return; }
    if ((Number(p.vacation_days_annual) || 0) < 0) { showNotification('الإجازة السنوية لا يمكن أن تكون سالبة', 'error'); return; }
    if ((Number(p.probation_days) || 0) < 0) { showNotification('فترة التجربة لا يمكن أن تكون سالبة', 'error'); return; }
    const salaryBreakdown = Object.entries(p.salary_breakdown || {}).reduce((acc: Record<string, number>, [k, v]) => {
      const key = String(k || '').trim();
      const val = Number(v || 0);
      if (!key) return acc;
      if (val < 0) return acc;
      acc[key] = val;
      return acc;
    }, {});
    p.salary_breakdown = salaryBreakdown;
    p.currency = String(p.currency || 'YER').trim().toUpperCase() || 'YER';
    p.contract_number = String(p.contract_number || '').trim().toUpperCase() || null;
    p.job_title = String(p.job_title || '').trim() || null;
    p.department = String(p.department || '').trim() || null;
    p.work_location = String(p.work_location || '').trim() || null;
    p.special_terms = String(p.special_terms || '').trim() || null;
    p.notes = String(p.notes || '').trim() || null;
    try {
      if (editingContract) { const { error } = await s.from('employee_contracts').update(p).eq('id', editingContract.id); if (error) throw error; }
      else { const { error } = await s.from('employee_contracts').insert(p); if (error) throw error; }
      setCModalOpen(false); await loadAll(); showNotification('تم الحفظ', 'success');
    } catch (e: any) { showNotification(e?.message || 'خطأ', 'error'); }
  };
  const deleteContract = async (id: string) => {
    if (!canManageHr) { showNotification('ليس لديك صلاحية حذف العقود.', 'error'); return; }
    if (!window.confirm('حذف هذا العقد؟')) return;
    const s = getSupabaseClient(); if (!s) return;
    try { const { error } = await s.from('employee_contracts').delete().eq('id', id); if (error) throw error; await loadAll(); showNotification('تم الحذف', 'success'); }
    catch (e: any) { showNotification(e?.message || 'خطأ', 'error'); }
  };

  /* ── Guarantee CRUD ── */
  const openGModal = (g?: Guarantee) => {
    if (g) { setEditingGuarantee(g); setGForm({ ...g }); } else { setEditingGuarantee(null); setGForm(emptyGuarantee()); }
    setGModalOpen(true);
  };
  const saveGuarantee = async () => {
    if (!canManageHr) { showNotification('ليس لديك صلاحية إدارة الضمانات.', 'error'); return; }
    const s = getSupabaseClient(); if (!s) return;
    const p: any = { ...gForm }; delete p.id; delete p.created_at;
    if (!p.employee_id) { showNotification('اختر الموظف', 'error'); return; }
    if (!p.guarantor_name?.trim()) { showNotification('أدخل اسم الكفيل', 'error'); return; }
    if (!p.valid_from) { showNotification('أدخل تاريخ بداية الضمان', 'error'); return; }
    if (p.valid_until && p.valid_until < p.valid_from) { showNotification('تاريخ نهاية الضمان يجب أن يكون بعد تاريخ البداية', 'error'); return; }
    if ((Number(p.guarantee_amount) || 0) < 0) { showNotification('مبلغ الضمان لا يمكن أن يكون سالبًا', 'error'); return; }
    p.currency = String(p.currency || 'YER').trim().toUpperCase() || 'YER';
    p.guarantee_number = String(p.guarantee_number || '').trim().toUpperCase() || null;
    p.guarantor_name = String(p.guarantor_name || '').trim();
    p.guarantor_id_number = String(p.guarantor_id_number || '').trim() || null;
    p.guarantor_phone = String(p.guarantor_phone || '').trim() || null;
    p.guarantor_address = String(p.guarantor_address || '').trim() || null;
    p.guarantor_relationship = String(p.guarantor_relationship || '').trim() || null;
    p.special_terms = String(p.special_terms || '').trim() || null;
    p.notes = String(p.notes || '').trim() || null;
    try {
      if (editingGuarantee) { const { error } = await s.from('employee_guarantees').update(p).eq('id', editingGuarantee.id); if (error) throw error; }
      else { const { error } = await s.from('employee_guarantees').insert(p); if (error) throw error; }
      setGModalOpen(false); await loadAll(); showNotification('تم الحفظ', 'success');
    } catch (e: any) { showNotification(e?.message || 'خطأ', 'error'); }
  };
  const deleteGuarantee = async (id: string) => {
    if (!canManageHr) { showNotification('ليس لديك صلاحية حذف الضمانات.', 'error'); return; }
    if (!window.confirm('حذف هذا الضمان؟')) return;
    const s = getSupabaseClient(); if (!s) return;
    try { const { error } = await s.from('employee_guarantees').delete().eq('id', id); if (error) throw error; await loadAll(); showNotification('تم الحذف', 'success'); }
    catch (e: any) { showNotification(e?.message || 'خطأ', 'error'); }
  };

  /* ── Filtered lists ── */
  const filteredContracts = useMemo(() => contracts.filter(c => {
    if (filterEmployee && c.employee_id !== filterEmployee) return false;
    if (filterStatus !== 'all' && c.status !== filterStatus) return false;
    return true;
  }), [contracts, filterEmployee, filterStatus]);

  const filteredGuarantees = useMemo(() => guarantees.filter(g => {
    if (filterEmployee && g.employee_id !== filterEmployee) return false;
    if (filterStatus !== 'all' && g.status !== filterStatus) return false;
    return true;
  }), [guarantees, filterEmployee, filterStatus]);

  if (loading) return <PageLoader />;

  /* ── Salary breakdown helpers ── */
  const addBdEntry = () => {
    if (!bdKey.trim()) return;
    if ((Number(bdVal) || 0) < 0) return;
    setCForm(prev => ({ ...prev, salary_breakdown: { ...(prev.salary_breakdown || {}), [bdKey.trim()]: bdVal } }));
    setBdKey(''); setBdVal(0);
  };
  const removeBdEntry = (k: string) => {
    const next = { ...(cForm.salary_breakdown || {}) }; delete next[k];
    setCForm(prev => ({ ...prev, salary_breakdown: next }));
  };

  /* ── On employee select (for contracts) auto-fill salary ── */
  const onEmployeeSelectContract = (eid: string) => {
    const emp = employees.find(e => e.id === eid);
    setCForm(prev => ({ ...prev, employee_id: eid, salary: emp?.monthly_salary || prev.salary, currency: emp?.currency || prev.currency }));
  };

  const INPUT = 'w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm';
  const BTN = 'px-4 py-2 rounded-lg font-semibold text-sm';

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold dark:text-white">عقود وضمانات الموظفين</h1>
          <div className="text-sm text-gray-500 dark:text-gray-400">إدارة عقود التوظيف وضمانات الموظفين مع إمكانية الطباعة</div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setTab('contracts')} className={`${BTN} ${tab === 'contracts' ? 'bg-gray-900 text-white' : 'border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200'}`}>عقود التوظيف</button>
          <button type="button" onClick={() => setTab('guarantees')} className={`${BTN} ${tab === 'guarantees' ? 'bg-gray-900 text-white' : 'border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200'}`}>الضمانات</button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 p-4 flex flex-col md:flex-row gap-3">
        <select value={filterEmployee} onChange={e => setFilterEmployee(e.target.value)} className={INPUT + ' md:max-w-xs'}>
          <option value="">كل الموظفين</option>
          {employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className={INPUT + ' md:max-w-[180px]'}>
          <option value="all">كل الحالات</option>
          {(tab === 'contracts' ? statusOptionsContracts : statusOptionsGuarantees).map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
        </select>
        <div className="flex-1" />
        <button type="button" onClick={() => tab === 'contracts' ? handlePrintBlankContract('full') : handlePrintBlankGuarantee('full')}
          className={`${BTN} bg-amber-600 text-white`}
          title={tab === 'contracts' ? 'طباعة نموذج عقد فارغ نسخة كاملة' : 'طباعة نموذج ضمان فارغ نسخة كاملة'}
        >🖨️ {tab === 'contracts' ? 'نموذج عقد كامل' : 'نموذج ضمان كامل'}</button>
        <button type="button" onClick={() => tab === 'contracts' ? handlePrintBlankContract('compact') : handlePrintBlankGuarantee('compact')}
          className={`${BTN} bg-blue-600 text-white`}
          title={tab === 'contracts' ? 'طباعة نموذج عقد فارغ نسخة مضغوطة' : 'طباعة نموذج ضمان فارغ نسخة مضغوطة'}
        >🖨️ {tab === 'contracts' ? 'نموذج عقد مضغوط' : 'نموذج ضمان مضغوط'}</button>
        <button type="button" onClick={() => tab === 'contracts' ? void handleExportBlankContractPdf('full') : void handleExportBlankGuaranteePdf('full')}
          className={`${BTN} bg-indigo-600 text-white`}
          title={tab === 'contracts' ? 'تصدير PDF نموذج عقد فارغ نسخة كاملة' : 'تصدير PDF نموذج ضمان فارغ نسخة كاملة'}
        >PDF {tab === 'contracts' ? 'عقد كامل' : 'ضمان كامل'}</button>
        <button type="button" onClick={() => tab === 'contracts' ? void handleExportBlankContractPdf('compact') : void handleExportBlankGuaranteePdf('compact')}
          className={`${BTN} bg-sky-700 text-white`}
          title={tab === 'contracts' ? 'تصدير PDF نموذج عقد فارغ نسخة مضغوطة' : 'تصدير PDF نموذج ضمان فارغ نسخة مضغوطة'}
        >PDF {tab === 'contracts' ? 'عقد مضغوط' : 'ضمان مضغوط'}</button>
        <button type="button" disabled={!canManageHr} onClick={() => tab === 'contracts' ? openCModal() : openGModal()} className={`${BTN} bg-emerald-600 text-white disabled:opacity-60`}>{tab === 'contracts' ? '+ عقد جديد' : '+ ضمان جديد'}</button>
      </div>
      {!canManageHr && canViewHr && <div className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">وضع قراءة فقط: صلاحية الإدارة غير متاحة لهذا الحساب.</div>}

      {/* ═══ CONTRACTS TAB ═══ */}
      {tab === 'contracts' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 overflow-x-auto">
          <table className="min-w-[900px] w-full text-right">
            <thead className="bg-gray-50 dark:bg-gray-700/50">
              <tr>
                {['الموظف', 'نوع العقد', 'المسمى', 'البداية', 'النهاية', 'الراتب', 'الحالة', 'إجراءات'].map(h => <th key={h} className="p-3 text-xs font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700 last:border-r-0">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {filteredContracts.length === 0 ? <tr><td colSpan={8} className="p-8 text-center text-gray-500">لا توجد عقود.</td></tr> :
                filteredContracts.map(c => (
                  <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                    <td className="p-3 text-sm dark:text-gray-200 border-r dark:border-gray-700">{empName(c.employee_id)}</td>
                    <td className="p-3 text-sm dark:text-gray-200 border-r dark:border-gray-700">{CONTRACT_TYPES[c.contract_type] || c.contract_type}</td>
                    <td className="p-3 text-sm dark:text-gray-200 border-r dark:border-gray-700">{c.job_title || '—'}</td>
                    <td className="p-3 text-sm dark:text-gray-200 border-r dark:border-gray-700">{fmtDate(c.start_date)}</td>
                    <td className="p-3 text-sm dark:text-gray-200 border-r dark:border-gray-700">{fmtDate(c.end_date)}</td>
                    <td className="p-3 text-sm font-mono dark:text-gray-200 border-r dark:border-gray-700" dir="ltr">{fmtMoney(c.salary)} {c.currency}</td>
                    <td className="p-3 text-sm border-r dark:border-gray-700"><span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColor(c.status)}`}>{STATUS_LABELS[c.status] || c.status}</span></td>
                    <td className="p-3 text-sm space-x-1 rtl:space-x-reverse">
                      <button onClick={() => void handlePrintContract(c, 'full')} className="px-2 py-1 rounded bg-blue-600 text-white text-xs font-semibold">طباعة كاملة</button>
                      <button onClick={() => void handlePrintContract(c, 'compact')} className="px-2 py-1 rounded bg-sky-700 text-white text-xs font-semibold">طباعة مضغوطة</button>
                      <button onClick={() => void handleExportContractPdf(c, 'full')} className="px-2 py-1 rounded bg-indigo-700 text-white text-xs font-semibold">PDF كامل</button>
                      <button onClick={() => void handleExportContractPdf(c, 'compact')} className="px-2 py-1 rounded bg-cyan-700 text-white text-xs font-semibold">PDF مضغوط</button>
                      <button disabled={!canManageHr} onClick={() => openCModal(c)} className="px-2 py-1 rounded bg-gray-700 text-white text-xs font-semibold disabled:opacity-60">تعديل</button>
                      <button disabled={!canManageHr} onClick={() => deleteContract(c.id)} className="px-2 py-1 rounded bg-red-600 text-white text-xs font-semibold disabled:opacity-60">حذف</button>
                      {canManageHr && c.status === 'draft' && <button onClick={() => void transitionDocument('contract', c.id, 'submit_review')} className="px-2 py-1 rounded bg-indigo-600 text-white text-xs font-semibold">إرسال للمراجعة</button>}
                      {canApproveHr && c.status === 'under_review' && <button onClick={() => void transitionDocument('contract', c.id, 'approve')} className="px-2 py-1 rounded bg-emerald-600 text-white text-xs font-semibold">اعتماد</button>}
                      {canApproveHr && (c.status === 'under_review' || c.status === 'approved') && <button onClick={() => void transitionDocument('contract', c.id, 'return_draft')} className="px-2 py-1 rounded bg-amber-600 text-white text-xs font-semibold">إرجاع لمسودة</button>}
                      {canApproveHr && c.status === 'approved' && <button onClick={() => void transitionDocument('contract', c.id, 'sign')} className="px-2 py-1 rounded bg-fuchsia-700 text-white text-xs font-semibold">توقيع</button>}
                      {canManageHr && c.status === 'signed' && <button onClick={() => void transitionDocument('contract', c.id, 'activate')} className="px-2 py-1 rounded bg-green-700 text-white text-xs font-semibold">تفعيل</button>}
                      {canManageHr && (c.status === 'active' || c.status === 'signed') && <button onClick={() => void transitionDocument('contract', c.id, 'expire')} className="px-2 py-1 rounded bg-slate-700 text-white text-xs font-semibold">إنهاء تلقائي</button>}
                      {canManageHr && c.status === 'active' && <button onClick={() => void transitionDocument('contract', c.id, 'terminate')} className="px-2 py-1 rounded bg-orange-700 text-white text-xs font-semibold">إنهاء تعاقد</button>}
                      {canManageHr && ['signed', 'active', 'expired', 'terminated'].includes(c.status) && <button onClick={() => void transitionDocument('contract', c.id, 'archive')} className="px-2 py-1 rounded bg-zinc-700 text-white text-xs font-semibold">أرشفة</button>}
                      <button onClick={() => void openApprovalHistory('contract', c.id)} className="px-2 py-1 rounded bg-white border border-gray-300 text-gray-700 text-xs font-semibold">سجل الاعتماد</button>
                      {historyOpenKey === `contract:${c.id}` && (
                        <div className="mt-2 p-2 rounded bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 space-y-1">
                          {(approvalsByKey[`contract:${c.id}`] || []).length === 0 ? (
                            <div className="text-[11px] text-gray-500">لا توجد إجراءات بعد.</div>
                          ) : (
                            (approvalsByKey[`contract:${c.id}`] || []).map(a => (
                              <div key={a.id} className="text-[11px] text-gray-700 dark:text-gray-300">
                                <span className="font-semibold">{a.action}</span>
                                <span> — {STATUS_LABELS[a.from_status || ''] || (a.from_status || '—')} → {STATUS_LABELS[a.to_status || ''] || (a.to_status || '—')}</span>
                                <span> — {fmtDate(a.performed_at)}</span>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ═══ GUARANTEES TAB ═══ */}
      {tab === 'guarantees' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 overflow-x-auto">
          <table className="min-w-[900px] w-full text-right">
            <thead className="bg-gray-50 dark:bg-gray-700/50">
              <tr>
                {['الموظف', 'الكفيل', 'النوع', 'المبلغ', 'من', 'إلى', 'الحالة', 'إجراءات'].map(h => <th key={h} className="p-3 text-xs font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700 last:border-r-0">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {filteredGuarantees.length === 0 ? <tr><td colSpan={8} className="p-8 text-center text-gray-500">لا توجد ضمانات.</td></tr> :
                filteredGuarantees.map(g => (
                  <tr key={g.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                    <td className="p-3 text-sm dark:text-gray-200 border-r dark:border-gray-700">{empName(g.employee_id)}</td>
                    <td className="p-3 text-sm dark:text-gray-200 border-r dark:border-gray-700">{g.guarantor_name}</td>
                    <td className="p-3 text-sm dark:text-gray-200 border-r dark:border-gray-700">{GUARANTEE_TYPES[g.guarantee_type] || g.guarantee_type}</td>
                    <td className="p-3 text-sm font-mono dark:text-gray-200 border-r dark:border-gray-700" dir="ltr">{fmtMoney(g.guarantee_amount)} {g.currency}</td>
                    <td className="p-3 text-sm dark:text-gray-200 border-r dark:border-gray-700">{fmtDate(g.valid_from)}</td>
                    <td className="p-3 text-sm dark:text-gray-200 border-r dark:border-gray-700">{fmtDate(g.valid_until)}</td>
                    <td className="p-3 text-sm border-r dark:border-gray-700"><span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColor(g.status)}`}>{STATUS_LABELS[g.status] || g.status}</span></td>
                    <td className="p-3 text-sm space-x-1 rtl:space-x-reverse">
                      <button onClick={() => void handlePrintGuarantee(g, 'full')} className="px-2 py-1 rounded bg-blue-600 text-white text-xs font-semibold">طباعة كاملة</button>
                      <button onClick={() => void handlePrintGuarantee(g, 'compact')} className="px-2 py-1 rounded bg-sky-700 text-white text-xs font-semibold">طباعة مضغوطة</button>
                      <button onClick={() => void handleExportGuaranteePdf(g, 'full')} className="px-2 py-1 rounded bg-indigo-700 text-white text-xs font-semibold">PDF كامل</button>
                      <button onClick={() => void handleExportGuaranteePdf(g, 'compact')} className="px-2 py-1 rounded bg-cyan-700 text-white text-xs font-semibold">PDF مضغوط</button>
                      <button disabled={!canManageHr} onClick={() => openGModal(g)} className="px-2 py-1 rounded bg-gray-700 text-white text-xs font-semibold disabled:opacity-60">تعديل</button>
                      <button disabled={!canManageHr} onClick={() => deleteGuarantee(g.id)} className="px-2 py-1 rounded bg-red-600 text-white text-xs font-semibold disabled:opacity-60">حذف</button>
                      {canManageHr && g.status === 'draft' && <button onClick={() => void transitionDocument('guarantee', g.id, 'submit_review')} className="px-2 py-1 rounded bg-indigo-600 text-white text-xs font-semibold">إرسال للمراجعة</button>}
                      {canApproveHr && g.status === 'under_review' && <button onClick={() => void transitionDocument('guarantee', g.id, 'approve')} className="px-2 py-1 rounded bg-emerald-600 text-white text-xs font-semibold">اعتماد</button>}
                      {canApproveHr && (g.status === 'under_review' || g.status === 'approved') && <button onClick={() => void transitionDocument('guarantee', g.id, 'return_draft')} className="px-2 py-1 rounded bg-amber-600 text-white text-xs font-semibold">إرجاع لمسودة</button>}
                      {canApproveHr && g.status === 'approved' && <button onClick={() => void transitionDocument('guarantee', g.id, 'sign')} className="px-2 py-1 rounded bg-fuchsia-700 text-white text-xs font-semibold">توقيع</button>}
                      {canManageHr && g.status === 'signed' && <button onClick={() => void transitionDocument('guarantee', g.id, 'activate')} className="px-2 py-1 rounded bg-green-700 text-white text-xs font-semibold">تفعيل</button>}
                      {canManageHr && (g.status === 'active' || g.status === 'signed') && <button onClick={() => void transitionDocument('guarantee', g.id, 'expire')} className="px-2 py-1 rounded bg-slate-700 text-white text-xs font-semibold">إنهاء تلقائي</button>}
                      {canManageHr && g.status === 'active' && <button onClick={() => void transitionDocument('guarantee', g.id, 'release')} className="px-2 py-1 rounded bg-orange-700 text-white text-xs font-semibold">إخلاء الضمان</button>}
                      {canManageHr && ['signed', 'active', 'expired', 'released'].includes(g.status) && <button onClick={() => void transitionDocument('guarantee', g.id, 'archive')} className="px-2 py-1 rounded bg-zinc-700 text-white text-xs font-semibold">أرشفة</button>}
                      <button onClick={() => void openApprovalHistory('guarantee', g.id)} className="px-2 py-1 rounded bg-white border border-gray-300 text-gray-700 text-xs font-semibold">سجل الاعتماد</button>
                      {historyOpenKey === `guarantee:${g.id}` && (
                        <div className="mt-2 p-2 rounded bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 space-y-1">
                          {(approvalsByKey[`guarantee:${g.id}`] || []).length === 0 ? (
                            <div className="text-[11px] text-gray-500">لا توجد إجراءات بعد.</div>
                          ) : (
                            (approvalsByKey[`guarantee:${g.id}`] || []).map(a => (
                              <div key={a.id} className="text-[11px] text-gray-700 dark:text-gray-300">
                                <span className="font-semibold">{a.action}</span>
                                <span> — {STATUS_LABELS[a.from_status || ''] || (a.from_status || '—')} → {STATUS_LABELS[a.to_status || ''] || (a.to_status || '—')}</span>
                                <span> — {fmtDate(a.performed_at)}</span>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ═══ CONTRACT MODAL ═══ */}
      {cModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="p-4 border-b dark:border-gray-700 flex justify-between items-center sticky top-0 bg-white dark:bg-gray-800 z-10">
              <h2 className="text-lg font-bold dark:text-white">{editingContract ? 'تعديل عقد' : 'عقد توظيف جديد'}</h2>
              <button onClick={() => setCModalOpen(false)} className="text-gray-500 hover:text-gray-700 text-2xl leading-none">&times;</button>
            </div>
            <div className="p-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div><label className="text-xs text-gray-500 mb-1 block">الموظف *</label>
                  <select value={cForm.employee_id || ''} onChange={e => onEmployeeSelectContract(e.target.value)} className={INPUT}>
                    <option value="">اختر الموظف</option>
                    {employees.map(e => <option key={e.id} value={e.id}>{e.full_name} {e.employee_code ? `(${e.employee_code})` : ''}</option>)}
                  </select>
                </div>
                <div><label className="text-xs text-gray-500 mb-1 block">رقم العقد</label><input value={cForm.contract_number || ''} onChange={e => setCForm(p => ({ ...p, contract_number: e.target.value }))} className={INPUT} placeholder="يُملأ تلقائياً أو يدوياً" /></div>
                <div><label className="text-xs text-gray-500 mb-1 block">نوع العقد</label>
                  <select value={cForm.contract_type || 'indefinite'} onChange={e => setCForm(p => ({ ...p, contract_type: e.target.value }))} className={INPUT}>
                    {Object.entries(CONTRACT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div><label className="text-xs text-gray-500 mb-1 block">الحالة</label>
                  <select value={cForm.status || 'draft'} onChange={e => setCForm(p => ({ ...p, status: e.target.value }))} className={INPUT}>
                    {statusOptionsContracts.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                  </select>
                </div>
                <div><label className="text-xs text-gray-500 mb-1 block">تاريخ البداية *</label><input type="date" value={cForm.start_date || ''} onChange={e => setCForm(p => ({ ...p, start_date: e.target.value }))} className={INPUT} /></div>
                <div><label className="text-xs text-gray-500 mb-1 block">تاريخ النهاية</label><input type="date" value={cForm.end_date || ''} onChange={e => setCForm(p => ({ ...p, end_date: e.target.value || null }))} className={INPUT} /></div>
                <div><label className="text-xs text-gray-500 mb-1 block">المسمى الوظيفي</label><input value={cForm.job_title || ''} onChange={e => setCForm(p => ({ ...p, job_title: e.target.value }))} className={INPUT} /></div>
                <div><label className="text-xs text-gray-500 mb-1 block">القسم / الإدارة</label><input value={cForm.department || ''} onChange={e => setCForm(p => ({ ...p, department: e.target.value }))} className={INPUT} /></div>
                <div><label className="text-xs text-gray-500 mb-1 block">موقع العمل</label><input value={cForm.work_location || ''} onChange={e => setCForm(p => ({ ...p, work_location: e.target.value }))} className={INPUT} /></div>
                <div><label className="text-xs text-gray-500 mb-1 block">الراتب الأساسي</label><input type="number" value={cForm.salary ?? 0} onChange={e => setCForm(p => ({ ...p, salary: Number(e.target.value) }))} className={INPUT} /></div>
                <div><label className="text-xs text-gray-500 mb-1 block">فترة التجربة (يوم)</label><input type="number" value={cForm.probation_days ?? 90} onChange={e => setCForm(p => ({ ...p, probation_days: Number(e.target.value) }))} className={INPUT} /></div>
                <div><label className="text-xs text-gray-500 mb-1 block">الإجازة السنوية (يوم)</label><input type="number" value={cForm.vacation_days_annual ?? 30} onChange={e => setCForm(p => ({ ...p, vacation_days_annual: Number(e.target.value) }))} className={INPUT} /></div>
                <div><label className="text-xs text-gray-500 mb-1 block">ساعات العمل/يوم</label><input type="number" value={cForm.working_hours_per_day ?? 8} onChange={e => setCForm(p => ({ ...p, working_hours_per_day: Number(e.target.value) }))} className={INPUT} /></div>
                <div><label className="text-xs text-gray-500 mb-1 block">أيام العمل/أسبوع</label><input type="number" value={cForm.working_days_per_week ?? 6} onChange={e => setCForm(p => ({ ...p, working_days_per_week: Number(e.target.value) }))} className={INPUT} /></div>
              </div>

              {/* Salary breakdown */}
              <div>
                <label className="text-xs text-gray-500 mb-1 block">تفاصيل الراتب (بدلات)</label>
                <div className="flex gap-2 mb-2">
                  <input placeholder="اسم البدل (سكن، نقل...)" value={bdKey} onChange={e => setBdKey(e.target.value)} className={INPUT + ' flex-1'} />
                  <input type="number" placeholder="المبلغ" value={bdVal || ''} onChange={e => setBdVal(Number(e.target.value))} className={INPUT + ' w-32'} />
                  <button type="button" onClick={addBdEntry} className={`${BTN} bg-emerald-600 text-white`}>+</button>
                </div>
                {Object.entries(cForm.salary_breakdown || {}).map(([k, v]) => (
                  <div key={k} className="flex items-center gap-2 text-sm mb-1">
                    <span className="flex-1 dark:text-gray-200">{k}: {fmtMoney(Number(v))}</span>
                    <button type="button" onClick={() => removeBdEntry(k)} className="text-red-500 text-xs">حذف</button>
                  </div>
                ))}
              </div>

              <div><label className="text-xs text-gray-500 mb-1 block">شروط خاصة</label><textarea rows={3} value={cForm.special_terms || ''} onChange={e => setCForm(p => ({ ...p, special_terms: e.target.value }))} className={INPUT} /></div>
              <div><label className="text-xs text-gray-500 mb-1 block">ملاحظات</label><textarea rows={2} value={cForm.notes || ''} onChange={e => setCForm(p => ({ ...p, notes: e.target.value }))} className={INPUT} /></div>

              <div className="flex justify-end gap-3 pt-2 border-t dark:border-gray-700">
                <button type="button" onClick={() => setCModalOpen(false)} className={`${BTN} border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300`}>إلغاء</button>
                <button type="button" disabled={!canManageHr} onClick={() => void saveContract()} className={`${BTN} bg-emerald-600 text-white disabled:opacity-60`}>حفظ العقد</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ GUARANTEE MODAL ═══ */}
      {gModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="p-4 border-b dark:border-gray-700 flex justify-between items-center sticky top-0 bg-white dark:bg-gray-800 z-10">
              <h2 className="text-lg font-bold dark:text-white">{editingGuarantee ? 'تعديل ضمان' : 'ضمان جديد'}</h2>
              <button onClick={() => setGModalOpen(false)} className="text-gray-500 hover:text-gray-700 text-2xl leading-none">&times;</button>
            </div>
            <div className="p-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div><label className="text-xs text-gray-500 mb-1 block">الموظف *</label>
                  <select value={gForm.employee_id || ''} onChange={e => setGForm(p => ({ ...p, employee_id: e.target.value }))} className={INPUT}>
                    <option value="">اختر الموظف</option>
                    {employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
                  </select>
                </div>
                <div><label className="text-xs text-gray-500 mb-1 block">رقم الضمان</label><input value={gForm.guarantee_number || ''} onChange={e => setGForm(p => ({ ...p, guarantee_number: e.target.value }))} className={INPUT} /></div>
                <div><label className="text-xs text-gray-500 mb-1 block">نوع الضمان</label>
                  <select value={gForm.guarantee_type || 'personal'} onChange={e => setGForm(p => ({ ...p, guarantee_type: e.target.value }))} className={INPUT}>
                    {Object.entries(GUARANTEE_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div><label className="text-xs text-gray-500 mb-1 block">الحالة</label>
                  <select value={gForm.status || 'active'} onChange={e => setGForm(p => ({ ...p, status: e.target.value }))} className={INPUT}>
                    {statusOptionsGuarantees.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                  </select>
                </div>
              </div>
              <h3 className="text-sm font-bold dark:text-white border-b dark:border-gray-700 pb-1 mt-2">بيانات الكفيل</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div><label className="text-xs text-gray-500 mb-1 block">اسم الكفيل *</label><input value={gForm.guarantor_name || ''} onChange={e => setGForm(p => ({ ...p, guarantor_name: e.target.value }))} className={INPUT} /></div>
                <div><label className="text-xs text-gray-500 mb-1 block">رقم هوية الكفيل</label><input value={gForm.guarantor_id_number || ''} onChange={e => setGForm(p => ({ ...p, guarantor_id_number: e.target.value }))} className={INPUT} /></div>
                <div><label className="text-xs text-gray-500 mb-1 block">هاتف الكفيل</label><input value={gForm.guarantor_phone || ''} onChange={e => setGForm(p => ({ ...p, guarantor_phone: e.target.value }))} className={INPUT} /></div>
                <div><label className="text-xs text-gray-500 mb-1 block">صلة القرابة</label><input value={gForm.guarantor_relationship || ''} onChange={e => setGForm(p => ({ ...p, guarantor_relationship: e.target.value }))} className={INPUT} /></div>
                <div className="md:col-span-2"><label className="text-xs text-gray-500 mb-1 block">عنوان الكفيل</label><input value={gForm.guarantor_address || ''} onChange={e => setGForm(p => ({ ...p, guarantor_address: e.target.value }))} className={INPUT} /></div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div><label className="text-xs text-gray-500 mb-1 block">مبلغ الضمان</label><input type="number" value={gForm.guarantee_amount ?? 0} onChange={e => setGForm(p => ({ ...p, guarantee_amount: Number(e.target.value) }))} className={INPUT} /></div>
                <div><label className="text-xs text-gray-500 mb-1 block">العملة</label><input value={gForm.currency || 'YER'} onChange={e => setGForm(p => ({ ...p, currency: e.target.value.toUpperCase() }))} className={INPUT} /></div>
                <div><label className="text-xs text-gray-500 mb-1 block">ساري من</label><input type="date" value={gForm.valid_from || ''} onChange={e => setGForm(p => ({ ...p, valid_from: e.target.value }))} className={INPUT} /></div>
                <div><label className="text-xs text-gray-500 mb-1 block">ساري حتى</label><input type="date" value={gForm.valid_until || ''} onChange={e => setGForm(p => ({ ...p, valid_until: e.target.value || null }))} className={INPUT} /></div>
              </div>
              <div><label className="text-xs text-gray-500 mb-1 block">شروط خاصة</label><textarea rows={3} value={gForm.special_terms || ''} onChange={e => setGForm(p => ({ ...p, special_terms: e.target.value }))} className={INPUT} /></div>
              <div><label className="text-xs text-gray-500 mb-1 block">ملاحظات</label><textarea rows={2} value={gForm.notes || ''} onChange={e => setGForm(p => ({ ...p, notes: e.target.value }))} className={INPUT} /></div>

              <div className="flex justify-end gap-3 pt-2 border-t dark:border-gray-700">
                <button type="button" onClick={() => setGModalOpen(false)} className={`${BTN} border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300`}>إلغاء</button>
                <button type="button" disabled={!canManageHr} onClick={() => void saveGuarantee()} className={`${BTN} bg-emerald-600 text-white disabled:opacity-60`}>حفظ الضمان</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
