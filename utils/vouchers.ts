import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { getSupabaseClient } from '../supabase';
import { printContent } from './printUtils';
import { amountToArabicWords } from './amountWordsAr';
import PrintableReceiptVoucher from '../components/admin/vouchers/PrintableReceiptVoucher';
import PrintablePaymentVoucher from '../components/admin/vouchers/PrintablePaymentVoucher';
import PrintableJournalVoucher from '../components/admin/vouchers/PrintableJournalVoucher';
import type { VoucherLine } from '../components/admin/vouchers/PrintableVoucherBase';

type Brand = {
  name?: string;
  address?: string;
  contactNumber?: string;
  logoUrl?: string;
  branchName?: string;
  branchCode?: string;
};

const fmtTime = (iso: string) => {
  try {
    return new Date(iso).toLocaleString('ar-EG-u-nu-latn');
  } catch {
    return iso;
  }
};

const fetchJournalEntryWithLines = async (entryId: string) => {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase غير مهيأ.');

  const { data: entry, error: eErr } = await supabase
    .from('journal_entries')
    .select('id,entry_date,memo,document_id,source_table,source_id,source_event,branch_id,company_id')
    .eq('id', entryId)
    .maybeSingle();
  if (eErr) throw eErr;
  if (!entry) throw new Error('القيد غير موجود.');

  const documentId = String((entry as any).document_id || '');
  if (!documentId) throw new Error('القيد غير مرتبط بوثيقة محاسبية.');

  const { data: docNumber, error: dnErr } = await supabase.rpc('ensure_accounting_document_number', { p_document_id: documentId });
  if (dnErr) throw dnErr;

  const { data: lines, error: lErr } = await supabase
    .from('journal_lines')
    .select('debit,credit,line_memo,account_id,chart_of_accounts(code,name)')
    .eq('journal_entry_id', entryId)
    .order('id', { ascending: true });
  if (lErr) throw lErr;

  const mappedLines: VoucherLine[] = (Array.isArray(lines) ? lines : []).map((l: any) => ({
    accountCode: String(l?.chart_of_accounts?.code || ''),
    accountName: String(l?.chart_of_accounts?.name || ''),
    debit: Number(l?.debit || 0),
    credit: Number(l?.credit || 0),
    memo: l?.line_memo ?? null,
  }));

  return {
    entry: entry as any,
    documentId,
    documentNumber: String(docNumber || ''),
    lines: mappedLines,
  };
};

export const printReceiptVoucherByPaymentId = async (paymentId: string, brand?: Brand) => {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase غير مهيأ.');

  const pid = String(paymentId || '').trim();
  if (!pid) throw new Error('معرف الدفعة غير صالح.');

  const { data: pay, error: pErr } = await supabase
    .from('payments')
    .select('id,direction,method,amount,currency,occurred_at,reference_table,reference_id,branch_id')
    .eq('id', pid)
    .maybeSingle();
  if (pErr) throw pErr;
  if (!pay) throw new Error('الدفعة غير موجودة.');
  if (String((pay as any).direction || '') !== 'in') throw new Error('هذه ليست دفعة قبض.');

  const { data: entryRow, error: jeErr } = await supabase
    .from('journal_entries')
    .select('id')
    .eq('source_table', 'payments')
    .eq('source_id', pid)
    .order('entry_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (jeErr) throw jeErr;
  const entryId = String((entryRow as any)?.id || '');
  if (!entryId) throw new Error('تعذر العثور على القيد المرتبط بهذه الدفعة.');

  const bundle = await fetchJournalEntryWithLines(entryId);
  const amount = Number((pay as any).amount || 0);
  const currency = String((pay as any).currency || '').toUpperCase() || '';
  const data = {
    voucherNumber: bundle.documentNumber,
    status: 'Posted',
    referenceId: pid,
    date: fmtTime(String((pay as any).occurred_at || bundle.entry.entry_date || '')),
    memo: String(bundle.entry.memo || '').trim() || null,
    currency,
    amount,
    amountWords: amountToArabicWords(amount, currency === 'YER' ? 'ريال' : 'عملة'),
    lines: bundle.lines,
  };

  const html = renderToString(createElement(PrintableReceiptVoucher as any, { data, brand }));
  printContent(html, `سند قبض #${bundle.documentNumber}`);
  await supabase.rpc('mark_accounting_document_printed', { p_document_id: bundle.documentId, p_template: 'PrintableReceiptVoucher' });
};

export const printPaymentVoucherByPaymentId = async (paymentId: string, brand?: Brand) => {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase غير مهيأ.');

  const pid = String(paymentId || '').trim();
  if (!pid) throw new Error('معرف الدفعة غير صالح.');

  const { data: pay, error: pErr } = await supabase
    .from('payments')
    .select('id,direction,method,amount,currency,occurred_at,reference_table,reference_id,branch_id')
    .eq('id', pid)
    .maybeSingle();
  if (pErr) throw pErr;
  if (!pay) throw new Error('الدفعة غير موجودة.');
  if (String((pay as any).direction || '') !== 'out') throw new Error('هذه ليست دفعة صرف.');

  const { data: entryRow, error: jeErr } = await supabase
    .from('journal_entries')
    .select('id')
    .eq('source_table', 'payments')
    .eq('source_id', pid)
    .order('entry_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (jeErr) throw jeErr;
  const entryId = String((entryRow as any)?.id || '');
  if (!entryId) throw new Error('تعذر العثور على القيد المرتبط بهذه الدفعة.');

  const bundle = await fetchJournalEntryWithLines(entryId);
  const amount = Number((pay as any).amount || 0);
  const currency = String((pay as any).currency || '').toUpperCase() || '';
  const data = {
    voucherNumber: bundle.documentNumber,
    status: 'Posted',
    referenceId: pid,
    date: fmtTime(String((pay as any).occurred_at || bundle.entry.entry_date || '')),
    memo: String(bundle.entry.memo || '').trim() || null,
    currency,
    amount,
    amountWords: amountToArabicWords(amount, currency === 'YER' ? 'ريال' : 'عملة'),
    lines: bundle.lines,
  };

  const html = renderToString(createElement(PrintablePaymentVoucher as any, { data, brand }));
  printContent(html, `سند صرف #${bundle.documentNumber}`);
  await supabase.rpc('mark_accounting_document_printed', { p_document_id: bundle.documentId, p_template: 'PrintablePaymentVoucher' });
};

export const printJournalVoucherByEntryId = async (entryId: string, brand?: Brand) => {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase غير مهيأ.');

  const id = String(entryId || '').trim();
  if (!id) throw new Error('معرف القيد غير صالح.');

  const bundle = await fetchJournalEntryWithLines(id);
  const total = bundle.lines.reduce((s, l) => s + Number(l.debit || 0), 0);
  const data = {
    voucherNumber: bundle.documentNumber,
    status: 'Posted',
    referenceId: id,
    date: fmtTime(String(bundle.entry.entry_date || '')),
    memo: String(bundle.entry.memo || '').trim() || null,
    currency: 'YER',
    amount: total,
    amountWords: amountToArabicWords(total, 'ريال'),
    lines: bundle.lines,
  };

  const html = renderToString(createElement(PrintableJournalVoucher as any, { data, brand }));
  printContent(html, `قيد يومية #${bundle.documentNumber}`);
  await supabase.rpc('mark_accounting_document_printed', { p_document_id: bundle.documentId, p_template: 'PrintableJournalVoucher' });
};

