import React from 'react';
import { AZTA_IDENTITY } from '../../../config/identity';

export interface GuaranteePrintData {
    guaranteeNumber: string;
    guaranteeType: string;
    guarantorName: string;
    guarantorIdNumber?: string | null;
    guarantorPhone?: string | null;
    guarantorAddress?: string | null;
    guarantorRelationship?: string | null;
    guaranteeAmount: number;
    currency: string;
    validFrom: string;
    validUntil?: string | null;
    specialTerms?: string | null;
    employeeName: string;
    employeeCode?: string | null;
}

interface Props {
    data: GuaranteePrintData;
    companyName?: string;
    companyPhone?: string;
    companyAddress?: string;
    logoUrl?: string;
    vatNumber?: string;
    printNumber?: number | null;
}

const GUARANTEE_TYPES: Record<string, string> = { personal: 'شخصي', financial: 'مالي', property: 'عيني' };

const fmt = (n: number) => { try { return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }); } catch { return String(n); } };
const fmtDate = (d?: string | null) => { if (!d) return '—'; try { return new Date(d).toLocaleDateString('ar-EG-u-nu-latn', { year: 'numeric', month: 'long', day: 'numeric' }); } catch { return d; } };

const PrintableGuarantee: React.FC<Props> = ({ data, companyName, companyPhone, companyAddress, logoUrl, vatNumber, printNumber }) => {
    const systemName = AZTA_IDENTITY.tradeNameAr;
    const resolvedName = companyName || '';
    const branchName = resolvedName.trim();
    const showBranch = Boolean(branchName) && branchName !== systemName.trim();
    const today = new Date().toLocaleDateString('ar-EG-u-nu-latn', { year: 'numeric', month: 'long', day: 'numeric' });

    return (
        <div className="bg-white relative font-sans print:w-full print:max-w-none print:m-0 print:p-0" dir="rtl">
            <style>{`
        @media print {
            @page { size: A4 portrait; margin: 8mm; }
            body { -webkit-print-color-adjust: exact; print-color-adjust: exact; margin: 0; padding: 0; background: white; overflow: visible !important; }
            * { box-sizing: border-box; overflow: visible !important; }
            .gt-doc { overflow: visible !important; }
        }
        .gt-doc {
            width: 100%; padding: 6mm 8mm 5mm 8mm;
            display: flex; flex-direction: column;
            font-family: 'Tajawal', 'Cairo', 'Dubai', sans-serif;
            color: #0F172A; line-height: 1.4;
            position: relative; background-color: #FAFAFA;
        }
        .gt-doc::before {
            content: ''; position: absolute;
            top: 2mm; bottom: 2mm; left: 2mm; right: 2mm;
            border: 1.5pt solid #7C1D1D;
            pointer-events: none; z-index: 50;
        }
        .gt-doc::after {
            content: ''; position: absolute;
            top: 3mm; bottom: 3mm; left: 3mm; right: 3mm;
            border: 0.5pt solid #D4AF37;
            pointer-events: none; z-index: 50;
        }
        .gt-watermark {
            position: absolute; top: 50%; left: 50%;
            transform: translate(-50%, -50%) rotate(-30deg);
            font-size: 8rem; font-weight: 900;
            color: #D4AF37; opacity: 0.03;
            white-space: nowrap; pointer-events: none; z-index: 1;
        }
        .gt-header {
            display: flex; justify-content: space-between; align-items: center;
            border-bottom: 2pt solid #7C1D1D; padding-bottom: 6px; margin-bottom: 10px;
        }
        .gt-brand { font-size: 18px; font-weight: 900; color: #0F172A; line-height: 1; }
        .gt-title { font-size: 22px; font-weight: 800; color: #7C1D1D; line-height: 0.9; letter-spacing: -0.5px; }
        .gt-title-sub { font-size: 8px; font-weight: 800; letter-spacing: 1.5px; color: #0F172A; text-transform: uppercase; border-top: 0.5pt solid #D4AF37; padding-top: 2px; margin-top: 2px; text-align: center; }
        .gt-section-title {
            font-size: 14px; font-weight: 800; color: #7C1D1D;
            border-bottom: 2px solid #D4AF3744; padding-bottom: 4px;
            margin: 14px 0 8px;
        }
        .gt-table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
        .gt-table td {
            padding: 5px 10px; font-size: 12px; border-bottom: 0.5pt solid #E5E7EB;
        }
        .gt-table tr:nth-child(even) td { background: #F9FAFB; }
        .gt-table .gt-label { width: 38%; font-weight: 600; color: #374151; background: #FDF2F2; }
        .gt-pledge-box {
            background: #FDF2F2; border: 2px solid #7C1D1D33; border-radius: 8px;
            padding: 14px; font-size: 12px; line-height: 2; color: #374151; margin-top: 10px;
        }
        .gt-pledge-title {
            font-weight: 800; color: #7C1D1D; margin-bottom: 6px; font-size: 13px;
        }
        .gt-signatures {
            display: flex; justify-content: space-between; margin-top: 20px;
            padding-top: 14px; border-top: 2px solid #D4AF3744; flex-wrap: wrap; gap: 10px;
        }
        .gt-sig-box {
            text-align: center; width: 30%; border: 1px solid #E5E7EB;
            border-radius: 8px; padding: 12px 8px;
        }
        .gt-sig-title { font-weight: 700; font-size: 11px; color: #7C1D1D; margin-bottom: 4px; }
        .gt-sig-line { border-bottom: 1px dashed #9CA3AF; margin: 26px 0 8px; }
        .gt-sig-label { font-size: 10px; color: #6B7280; margin-top: 4px; }
        .gt-footer {
            margin-top: auto; text-align: center; font-size: 7px; color: #4B5563;
            padding-top: 6px; display: flex; flex-direction: column; align-items: center; gap: 1px;
        }
        .gt-footer-line { width: 40px; height: 0.5pt; background: #D4AF37; margin: 1px 0; }
        .gt-gold { color: #D4AF37; }
        .gt-copy-badge {
            position: absolute; top: 4mm; left: 4mm;
            background: #7C1D1D; color: #D4AF37; font-size: 7px; font-weight: 800;
            padding: 1px 6px; border-radius: 2px; z-index: 60;
        }
        .gt-special-terms {
            border: 0.5pt dashed #D4AF37; background: #FFFBEB; border-radius: 6px;
            padding: 10px 14px; font-size: 12px; white-space: pre-wrap; line-height: 1.8; color: #374151;
        }
      `}</style>

            <div className="gt-doc" style={{ fontFamily: 'Tajawal, Cairo, sans-serif' }}>
                <div className="gt-watermark">{AZTA_IDENTITY.tradeNameAr}</div>

                {printNumber != null && printNumber > 0 && (
                    <div className="gt-copy-badge">نسخة #{printNumber}</div>
                )}

                {/* HEADER */}
                <div className="gt-header" style={{ position: 'relative', zIndex: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        {logoUrl && (
                            <div style={{ background: 'white', padding: '3px', border: '0.5pt solid #E5E7EB' }}>
                                <img src={logoUrl} alt="" style={{ height: '50px', width: 'auto', objectFit: 'contain' }} />
                            </div>
                        )}
                        <div>
                            <div className="gt-brand">{systemName}</div>
                            {showBranch && <span style={{ fontSize: '9px', color: '#64748B' }}>({branchName})</span>}
                            <div style={{ marginTop: '3px', display: 'flex', gap: '8px', fontSize: '7px', color: '#64748B', fontWeight: 700 }}>
                                {companyAddress && <span dir="ltr">Add: <span style={{ color: '#0F172A' }}>{companyAddress}</span></span>}
                                {companyPhone && <span dir="ltr">TEL: <span style={{ color: '#0F172A' }}>{companyPhone}</span></span>}
                                {vatNumber && <span dir="ltr">VAT: <span style={{ color: '#0F172A' }}>{vatNumber}</span></span>}
                            </div>
                        </div>
                    </div>
                    <div style={{ textAlign: 'center', flexShrink: 0 }}>
                        <div className="gt-title">ضمان / كفالة موظف</div>
                        <div className="gt-title-sub">EMPLOYEE GUARANTEE FORM</div>
                    </div>
                </div>

                {/* META */}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#6B7280', marginBottom: '8px', position: 'relative', zIndex: 10 }}>
                    <span>رقم الضمان: <strong style={{ color: '#0F172A' }}>{data.guaranteeNumber || '____________'}</strong></span>
                    <span>التاريخ: <strong style={{ color: '#0F172A' }}>{today}</strong></span>
                </div>

                {/* EMPLOYEE DATA */}
                <div className="gt-section-title" style={{ position: 'relative', zIndex: 10 }}>أولاً: بيانات الموظف (المكفول)</div>
                <table className="gt-table" style={{ position: 'relative', zIndex: 10 }}>
                    <tbody>
                        <tr><td className="gt-label">اسم الموظف</td><td>{data.employeeName || '________________________'}</td></tr>
                        <tr><td className="gt-label">رقم الموظف</td><td>{data.employeeCode || '________'}</td></tr>
                    </tbody>
                </table>

                {/* GUARANTOR DATA */}
                <div className="gt-section-title" style={{ position: 'relative', zIndex: 10 }}>ثانياً: بيانات الكفيل / الضامن</div>
                <table className="gt-table" style={{ position: 'relative', zIndex: 10 }}>
                    <tbody>
                        <tr><td className="gt-label">الاسم الكامل</td><td>{data.guarantorName || '________________________'}</td></tr>
                        <tr><td className="gt-label">رقم الهوية / الجواز</td><td>{data.guarantorIdNumber || '________________________'}</td></tr>
                        <tr><td className="gt-label">رقم الهاتف</td><td>{data.guarantorPhone || '________________________'}</td></tr>
                        <tr><td className="gt-label">العنوان الدائم</td><td>{data.guarantorAddress || '________________________'}</td></tr>
                        <tr><td className="gt-label">صلة القرابة بالموظف</td><td>{data.guarantorRelationship || '________________________'}</td></tr>
                    </tbody>
                </table>

                {/* GUARANTEE DETAILS */}
                <div className="gt-section-title" style={{ position: 'relative', zIndex: 10 }}>ثالثاً: تفاصيل الضمان</div>
                <table className="gt-table" style={{ position: 'relative', zIndex: 10 }}>
                    <tbody>
                        <tr><td className="gt-label">نوع الضمان</td><td>{GUARANTEE_TYPES[data.guaranteeType] || data.guaranteeType || '________________________'}</td></tr>
                        <tr><td className="gt-label">مبلغ الضمان</td><td>{data.guaranteeAmount ? <>{fmt(data.guaranteeAmount)} {data.currency}</> : '________________________'}</td></tr>
                        <tr><td className="gt-label">ساري من تاريخ</td><td>{data.validFrom ? fmtDate(data.validFrom) : '________________________'}</td></tr>
                        <tr><td className="gt-label">ساري حتى تاريخ</td><td>{data.validUntil ? fmtDate(data.validUntil) : '________________________'}</td></tr>
                    </tbody>
                </table>

                {/* SPECIAL TERMS */}
                {data.specialTerms && (
                    <>
                        <div className="gt-section-title" style={{ position: 'relative', zIndex: 10 }}>رابعاً: شروط خاصة</div>
                        <div className="gt-special-terms" style={{ position: 'relative', zIndex: 10 }}>{data.specialTerms}</div>
                    </>
                )}

                {/* PLEDGE */}
                <div className="gt-pledge-box" style={{ position: 'relative', zIndex: 10 }}>
                    <div className="gt-pledge-title">📋 إقرار وتعهد الكفيل:</div>
                    <div>أقر أنا الموقع أدناه بأنني أتعهد بكفالة الموظف المذكور أعلاه كفالة كاملة غير مشروطة، وأقر بالآتي:</div>
                    <div style={{ marginTop: '6px', paddingRight: '12px' }}>
                        1. أنني مسؤول مسؤولية كاملة عن أي التزامات مالية تترتب على الموظف تجاه المنشأة.<br />
                        2. أنني أتعهد بإحضار الموظف في حال تغيبه عن العمل دون إذن مسبق.<br />
                        3. أنني مسؤول عن تعويض المنشأة عن أي ضرر أو خسارة يسببها الموظف.<br />
                        4. أن هذا الضمان ساري المفعول طوال مدة عمل الموظف لدى المنشأة ما لم يُلغَ خطياً.
                    </div>
                </div>

                {/* SIGNATURES — inline styles guarantee layout even if CSS classes don't load */}
                <div className="gt-signatures" style={{
                    display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px',
                    marginTop: '20px', paddingTop: '14px', borderTop: '2px solid rgba(212,175,55,0.27)',
                    position: 'relative', zIndex: 10
                }}>
                    <div className="gt-sig-box" style={{
                        textAlign: 'center', width: '30%', border: '1px solid #E5E7EB',
                        borderRadius: '8px', padding: '12px 8px'
                    }}>
                        <div className="gt-sig-title" style={{ fontWeight: 700, fontSize: '11px', color: '#7C1D1D', marginBottom: '4px' }}>صاحب العمل</div>
                        <div className="gt-sig-line" style={{ borderBottom: '1px dashed #9CA3AF', margin: '26px 0 8px' }}></div>
                        <div className="gt-sig-label" style={{ fontSize: '10px', color: '#6B7280', marginTop: '4px' }}>التوقيع والختم</div>
                        <div className="gt-sig-label" style={{ fontSize: '10px', color: '#6B7280', marginTop: '4px' }}>___ / ___ / ______</div>
                    </div>
                    <div className="gt-sig-box" style={{
                        textAlign: 'center', width: '30%', border: '1px solid #E5E7EB',
                        borderRadius: '8px', padding: '12px 8px'
                    }}>
                        <div className="gt-sig-title" style={{ fontWeight: 700, fontSize: '11px', color: '#7C1D1D', marginBottom: '4px' }}>الموظف (المكفول)</div>
                        <div className="gt-sig-line" style={{ borderBottom: '1px dashed #9CA3AF', margin: '26px 0 8px' }}></div>
                        <div className="gt-sig-label" style={{ fontSize: '10px', color: '#6B7280', marginTop: '4px' }}>التوقيع</div>
                        <div className="gt-sig-label" style={{ fontSize: '10px', color: '#6B7280', marginTop: '4px' }}>___ / ___ / ______</div>
                    </div>
                    <div className="gt-sig-box" style={{
                        textAlign: 'center', width: '30%', border: '1px solid #E5E7EB',
                        borderRadius: '8px', padding: '12px 8px'
                    }}>
                        <div className="gt-sig-title" style={{ fontWeight: 700, fontSize: '11px', color: '#7C1D1D', marginBottom: '4px' }}>الكفيل / الضامن</div>
                        <div className="gt-sig-line" style={{ borderBottom: '1px dashed #9CA3AF', margin: '26px 0 8px' }}></div>
                        <div className="gt-sig-label" style={{ fontSize: '10px', color: '#6B7280', marginTop: '4px' }}>التوقيع وبصمة الإبهام</div>
                        <div className="gt-sig-label" style={{ fontSize: '10px', color: '#6B7280', marginTop: '4px' }}>___ / ___ / ______</div>
                    </div>
                </div>

                {/* FOOTER */}
                <div className="gt-footer" style={{ position: 'relative', zIndex: 10 }}>
                    <div className="gt-footer-line"></div>
                    <div className="gt-gold" style={{ fontWeight: 700, fontSize: '8px', marginTop: '2px' }}>نموذج نظام مرخص — LICENSED SYSTEM FORM</div>
                    <div style={{ color: '#94A3B8' }}>{AZTA_IDENTITY.tradeNameAr}</div>
                    <div dir="ltr" style={{ fontSize: '6px', color: '#94A3B8' }}>{new Date().toLocaleString('en-GB')}</div>
                </div>
            </div>
        </div>
    );
};

export default PrintableGuarantee;
