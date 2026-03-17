import React from 'react';
import { AZTA_IDENTITY } from '../../../config/identity';

export interface ContractPrintData {
    contractNumber: string;
    contractType: string;
    startDate: string;
    endDate?: string | null;
    jobTitle?: string | null;
    department?: string | null;
    workLocation?: string | null;
    salary: number;
    currency: string;
    salaryBreakdown: Record<string, number>;
    probationDays: number;
    workingHoursPerDay: number;
    workingDaysPerWeek: number;
    vacationDaysAnnual: number;
    specialTerms?: string | null;
    employeeName: string;
    employeeCode?: string | null;
}

interface Props {
    data: ContractPrintData;
    companyName?: string;
    companyPhone?: string;
    companyAddress?: string;
    logoUrl?: string;
    vatNumber?: string;
    printNumber?: number | null;
}

const CONTRACT_TYPES: Record<string, string> = { definite: 'محدد المدة', indefinite: 'غير محدد المدة', probation: 'تحت التجربة', part_time: 'دوام جزئي' };

const fmt = (n: number) => { try { return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }); } catch { return String(n); } };
const fmtDate = (d?: string | null) => { if (!d) return '—'; try { return new Date(d).toLocaleDateString('ar-EG-u-nu-latn', { year: 'numeric', month: 'long', day: 'numeric' }); } catch { return d; } };

const PrintableContract: React.FC<Props> = ({ data, companyName, companyPhone, companyAddress, logoUrl, vatNumber, printNumber }) => {
    const systemName = AZTA_IDENTITY.tradeNameAr;
    const resolvedName = companyName || '';
    const branchName = resolvedName.trim();
    const showBranch = Boolean(branchName) && branchName !== systemName.trim();
    const today = new Date().toLocaleDateString('ar-EG-u-nu-latn', { year: 'numeric', month: 'long', day: 'numeric' });
    const bd = data.salaryBreakdown || {};
    const totalSalary = data.salary + Object.values(bd).reduce((s, v) => s + Number(v || 0), 0);

    return (
        <div className="bg-white relative font-sans print:w-full print:max-w-none print:m-0 print:p-0" dir="rtl">
            <style>{`
        @media print {
            @page { size: A4 portrait; margin: 8mm; }
            body { -webkit-print-color-adjust: exact; print-color-adjust: exact; margin: 0; padding: 0; background: white; overflow: visible !important; }
            * { box-sizing: border-box; overflow: visible !important; }
            .ct-doc { overflow: visible !important; }
            .ct-sig-table { page-break-inside: avoid !important; }
        }
        .ct-doc {
            width: 100%; padding: 4mm 6mm 3mm 6mm;
            font-family: 'Tajawal', 'Cairo', 'Dubai', sans-serif;
            color: #0F172A; line-height: 1.3;
            position: relative; background-color: #FAFAFA;
        }
        .ct-doc::before {
            content: ''; position: absolute;
            top: 2mm; bottom: 2mm; left: 2mm; right: 2mm;
            border: 1.5pt solid #1E3A8A;
            pointer-events: none; z-index: 50;
        }
        .ct-doc::after {
            content: ''; position: absolute;
            top: 3mm; bottom: 3mm; left: 3mm; right: 3mm;
            border: 0.5pt solid #D4AF37;
            pointer-events: none; z-index: 50;
        }
        .ct-watermark {
            position: absolute; top: 50%; left: 50%;
            transform: translate(-50%, -50%) rotate(-30deg);
            font-size: 8rem; font-weight: 900;
            color: #D4AF37; opacity: 0.03;
            white-space: nowrap; pointer-events: none; z-index: 1;
        }
        .ct-header {
            display: flex; justify-content: space-between; align-items: center;
            border-bottom: 2pt solid #1E3A8A; padding-bottom: 4px; margin-bottom: 6px;
        }
        .ct-brand { font-size: 16px; font-weight: 900; color: #0F172A; line-height: 1; }
        .ct-title { font-size: 20px; font-weight: 800; color: #D4AF37; line-height: 0.9; letter-spacing: -0.5px; }
        .ct-title-sub { font-size: 7px; font-weight: 800; letter-spacing: 1.5px; color: #0F172A; text-transform: uppercase; border-top: 0.5pt solid #D4AF37; padding-top: 2px; margin-top: 2px; text-align: center; }
        .ct-section-title {
            font-size: 12px; font-weight: 800; color: #1E3A8A;
            border-bottom: 1px solid #D4AF3744; padding-bottom: 2px;
            margin: 6px 0 4px;
        }
        .ct-table { width: 100%; border-collapse: collapse; margin-bottom: 6px; }
        .ct-table th {
            background: #0F172A; color: #fff; padding: 3px 8px;
            font-size: 10px; font-weight: 600; text-align: right; border: none;
        }
        .ct-table td {
            padding: 3px 8px; font-size: 11px; border-bottom: 0.5pt solid #E5E7EB;
        }
        .ct-table tr:nth-child(even) td { background: #F9FAFB; }
        .ct-table .ct-label { width: 38%; font-weight: 600; color: #374151; background: #F3F4F6; }
        .ct-table .ct-total td { background: #1E3A8A !important; color: #fff; font-weight: 700; font-size: 12px; }
        .ct-preamble {
            background: #F3F4F6; border: 0.5pt solid #E5E7EB; border-radius: 4px;
            padding: 5px 10px; font-size: 11px; line-height: 1.6; color: #374151; margin-bottom: 6px;
        }
        .ct-clause { font-size: 11px; line-height: 1.6; color: #374151; padding: 0 4px; margin-bottom: 4px; }
        .ct-clause div { margin-bottom: 2px; }
        .ct-signatures {
            display: flex; justify-content: space-between; margin-top: 10px;
            padding-top: 8px; border-top: 2px solid #D4AF3744;
        }
        .ct-sig-box {
            text-align: center; width: 45%; border: 1px solid #E5E7EB;
            border-radius: 6px; padding: 8px 8px;
        }
        .ct-sig-title { font-weight: 700; font-size: 11px; color: #1E3A8A; margin-bottom: 3px; }
        .ct-sig-line { border-bottom: 1px dashed #9CA3AF; margin: 20px 0 6px; }
        .ct-sig-label { font-size: 9px; color: #6B7280; margin-top: 3px; }
        .ct-footer {
            margin-top: 4px; text-align: center; font-size: 7px; color: #4B5563;
            padding-top: 4px; display: flex; flex-direction: column; align-items: center; gap: 1px;
        }
        .ct-footer-line { width: 40px; height: 0.5pt; background: #D4AF37; margin: 1px 0; }
        .ct-gold { color: #D4AF37; }
        .ct-copy-badge {
            position: absolute; top: 4mm; left: 4mm;
            background: #0F172A; color: #D4AF37; font-size: 7px; font-weight: 800;
            padding: 1px 6px; border-radius: 2px; z-index: 60;
        }
        .ct-special-terms {
            border: 0.5pt dashed #D4AF37; background: #FFFBEB; border-radius: 4px;
            padding: 5px 10px; font-size: 11px; white-space: pre-wrap; line-height: 1.6; color: #374151;
        }
        .ct-note-box {
            background: #F0FFF4; border: 1px solid #86EFAC; border-radius: 4px;
            padding: 5px 8px; font-size: 10px; color: #166534; text-align: center; line-height: 1.6; margin-top: 6px;
        }
        .ct-sig-table { page-break-inside: avoid; width: 100%; border-collapse: collapse; margin-top: 10px; border-top: 2px solid rgba(212,175,55,0.27); }
      `}</style>

            <div className="ct-doc" style={{ fontFamily: 'Tajawal, Cairo, sans-serif' }}>
                <div className="ct-watermark">{AZTA_IDENTITY.tradeNameAr}</div>

                {printNumber != null && printNumber > 0 && (
                    <div className="ct-copy-badge">نسخة #{printNumber}</div>
                )}

                {/* HEADER */}
                <div className="ct-header" style={{ position: 'relative', zIndex: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        {logoUrl && (
                            <div style={{ background: 'white', padding: '3px', border: '0.5pt solid #E5E7EB' }}>
                                <img src={logoUrl} alt="" style={{ height: '50px', width: 'auto', objectFit: 'contain' }} />
                            </div>
                        )}
                        <div>
                            <div className="ct-brand">{systemName}</div>
                            {showBranch && <span style={{ fontSize: '9px', color: '#64748B' }}>({branchName})</span>}
                            <div style={{ marginTop: '3px', display: 'flex', gap: '8px', fontSize: '7px', color: '#64748B', fontWeight: 700 }}>
                                {companyAddress && <span dir="ltr">Add: <span style={{ color: '#0F172A' }}>{companyAddress}</span></span>}
                                {companyPhone && <span dir="ltr">TEL: <span style={{ color: '#0F172A' }}>{companyPhone}</span></span>}
                                {vatNumber && <span dir="ltr">VAT: <span style={{ color: '#0F172A' }}>{vatNumber}</span></span>}
                            </div>
                        </div>
                    </div>
                    <div style={{ textAlign: 'center', flexShrink: 0 }}>
                        <div className="ct-title">عقد عمل</div>
                        <div className="ct-title-sub">EMPLOYMENT CONTRACT</div>
                    </div>
                </div>

                {/* META */}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#6B7280', marginBottom: '8px', position: 'relative', zIndex: 10 }}>
                    <span>رقم العقد: <strong style={{ color: '#0F172A' }}>{data.contractNumber || '____________'}</strong></span>
                    <span>التاريخ: <strong style={{ color: '#0F172A' }}>{today}</strong></span>
                </div>

                {/* PREAMBLE */}
                <div className="ct-preamble" style={{ position: 'relative', zIndex: 10 }}>
                    تمّ الاتفاق بين <strong className="ct-gold">{resolvedName || '_______________'}</strong> (ويُشار إليه بـ<strong>الطرف الأول / صاحب العمل</strong>) وبين السيد/ة <strong className="ct-gold">{data.employeeName || '_______________'}</strong> (ويُشار إليه بـ<strong>الطرف الثاني / الموظف</strong>) على الشروط والأحكام التالية:
                </div>

                {/* SECTION 1: APPOINTMENT */}
                <div className="ct-section-title" style={{ position: 'relative', zIndex: 10 }}>البند الأول: بيانات التعيين</div>
                <table className="ct-table" style={{ position: 'relative', zIndex: 10 }}>
                    <tbody>
                        <tr><td className="ct-label">المسمى الوظيفي</td><td>{data.jobTitle || '________________________'}</td></tr>
                        <tr><td className="ct-label">القسم / الإدارة</td><td>{data.department || '________________________'}</td></tr>
                        <tr><td className="ct-label">موقع العمل</td><td>{data.workLocation || '________________________'}</td></tr>
                        <tr><td className="ct-label">نوع العقد</td><td>{CONTRACT_TYPES[data.contractType] || data.contractType}</td></tr>
                        <tr><td className="ct-label">تاريخ المباشرة</td><td>{data.startDate ? fmtDate(data.startDate) : '________________________'}</td></tr>
                        <tr><td className="ct-label">تاريخ انتهاء العقد</td><td>{data.endDate ? fmtDate(data.endDate) : '________________________'}</td></tr>
                        <tr><td className="ct-label">فترة التجربة</td><td>{data.probationDays} يوم</td></tr>
                    </tbody>
                </table>

                {/* SECTION 2: SALARY */}
                <div className="ct-section-title" style={{ position: 'relative', zIndex: 10 }}>البند الثاني: المقابل المالي</div>
                <table className="ct-table" style={{ position: 'relative', zIndex: 10 }}>
                    <tbody>
                        <tr><td className="ct-label">الراتب الأساسي</td><td>{data.salary ? <>{fmt(data.salary)} {data.currency}</> : '________________________'}</td></tr>
                        {Object.entries(bd).map(([k, v]) => (
                            <tr key={k}><td className="ct-label">{k}</td><td>{fmt(Number(v))} {data.currency}</td></tr>
                        ))}
                        <tr className="ct-total"><td style={{ padding: '6px 10px' }}>إجمالي الراتب الشهري</td><td style={{ padding: '6px 10px' }}>{totalSalary ? <>{fmt(totalSalary)} {data.currency}</> : '________________________'}</td></tr>
                    </tbody>
                </table>

                {/* SECTION 3: WORKING HOURS */}
                <div className="ct-section-title" style={{ position: 'relative', zIndex: 10 }}>البند الثالث: ساعات العمل والإجازات</div>
                <table className="ct-table" style={{ position: 'relative', zIndex: 10 }}>
                    <tbody>
                        <tr><td className="ct-label">ساعات العمل اليومية</td><td>{data.workingHoursPerDay} ساعة</td></tr>
                        <tr><td className="ct-label">أيام العمل الأسبوعية</td><td>{data.workingDaysPerWeek} أيام</td></tr>
                        <tr><td className="ct-label">الإجازة السنوية</td><td>{data.vacationDaysAnnual} يوماً مدفوعة الأجر</td></tr>
                    </tbody>
                </table>

                {/* SECTION 4: OBLIGATIONS */}
                <div className="ct-section-title" style={{ position: 'relative', zIndex: 10 }}>البند الرابع: الالتزامات العامة</div>
                <div className="ct-clause" style={{ position: 'relative', zIndex: 10 }}>
                    <div>1. يلتزم الطرف الثاني بأداء العمل المكلف به بأمانة وإخلاص والمحافظة على أسرار العمل.</div>
                    <div>2. يلتزم الطرف الثاني بالحضور والانصراف في المواعيد المحددة والالتزام بلوائح وأنظمة العمل.</div>
                    <div>3. يلتزم الطرف الأول بدفع الراتب في نهاية كل شهر ميلادي وتوفير بيئة عمل آمنة.</div>
                    <div>4. يحق لأي من الطرفين إنهاء العقد بموجب إشعار خطي مدته 30 يوماً.</div>
                    <div>5. في حال العقد محدد المدة، يتجدد تلقائياً لمدة مماثلة ما لم يُخطر أحد الطرفين الآخر.</div>
                    <div>6. تُطبق أحكام قانون العمل اليمني فيما لم يرد بشأنه نص في هذا العقد.</div>
                </div>

                {/* SECTION 5: SPECIAL TERMS */}
                {data.specialTerms && (
                    <>
                        <div className="ct-section-title" style={{ position: 'relative', zIndex: 10 }}>البند الخامس: شروط وأحكام خاصة</div>
                        <div className="ct-special-terms" style={{ position: 'relative', zIndex: 10 }}>{data.specialTerms}</div>
                    </>
                )}

                <div className="ct-note-box" style={{ position: 'relative', zIndex: 10 }}>
                    حُرر هذا العقد من نسختين أصليتين لكل طرف نسخة للعمل بموجبها.
                </div>

                {/* SIGNATURES — inline-block layout: immune to any flex overrides */}
                <div style={{
                    width: '100%',
                    marginTop: '10px',
                    paddingTop: '8px',
                    borderTop: '2px solid rgba(212,175,55,0.27)',
                    textAlign: 'center',
                    fontSize: 0,
                } as React.CSSProperties}>
                    <div style={{ display: 'inline-block', width: '47%', textAlign: 'center', border: '1px solid #E5E7EB', borderRadius: '6px', padding: '8px', boxSizing: 'border-box', verticalAlign: 'top', fontSize: '11px', marginLeft: '2%' }}>
                        <div style={{ fontWeight: 700, fontSize: '11px', color: '#1E3A8A', marginBottom: '3px' }}>الطرف الأول (صاحب العمل)</div>
                        <div style={{ borderBottom: '1px dashed #9CA3AF', margin: '20px 0 6px' }}></div>
                        <div style={{ fontSize: '9px', color: '#6B7280', marginTop: '3px' }}>الاسم: ________________________</div>
                        <div style={{ fontSize: '9px', color: '#6B7280', marginTop: '3px' }}>التوقيع والختم</div>
                        <div style={{ fontSize: '9px', color: '#6B7280', marginTop: '3px' }}>التاريخ: ___ / ___ / ______</div>
                    </div>
                    <div style={{ display: 'inline-block', width: '47%', textAlign: 'center', border: '1px solid #E5E7EB', borderRadius: '6px', padding: '8px', boxSizing: 'border-box', verticalAlign: 'top', fontSize: '11px', marginRight: '2%' }}>
                        <div style={{ fontWeight: 700, fontSize: '11px', color: '#1E3A8A', marginBottom: '3px' }}>الطرف الثاني (الموظف)</div>
                        <div style={{ borderBottom: '1px dashed #9CA3AF', margin: '20px 0 6px' }}></div>
                        <div style={{ fontSize: '9px', color: '#6B7280', marginTop: '3px' }}>الاسم: ________________________</div>
                        <div style={{ fontSize: '9px', color: '#6B7280', marginTop: '3px' }}>رقم الهوية: ____________________</div>
                        <div style={{ fontSize: '9px', color: '#6B7280', marginTop: '3px' }}>التاريخ: ___ / ___ / ______</div>
                    </div>
                </div>

                {/* FOOTER */}
                <div className="ct-footer" style={{ position: 'relative', zIndex: 10, textAlign: 'center', fontSize: '7px', color: '#4B5563', paddingTop: '4px', marginTop: '4px' }}>
                    <div className="ct-footer-line"></div>
                    <div className="ct-gold" style={{ fontWeight: 700, fontSize: '8px', marginTop: '2px' }}>نموذج نظام مرخص — LICENSED SYSTEM FORM</div>
                    <div style={{ color: '#94A3B8' }}>{AZTA_IDENTITY.tradeNameAr}</div>
                    <div dir="ltr" style={{ fontSize: '6px', color: '#94A3B8' }}>{new Date().toLocaleString('en-GB')}</div>
                </div>
            </div>
        </div>
    );
};

export default PrintableContract;
