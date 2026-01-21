
import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
// import { useSettings } from '../../contexts/SettingsContext';

// Icons
const SalesIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>;
const ProductIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" /></svg>;
const CustomerIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.653-.124-1.282-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.653.124-1.282.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm-9 3a2 2 0 11-4 0 2 2 0 014 0z" /></svg>;

interface ReportCardProps {
    title: string;
    description: string;
    icon: React.ReactNode;
    linkTo: string;
}

const ReportCard: React.FC<ReportCardProps> = ({ title, description, icon, linkTo }) => {
    // const { t } = useSettings();
    return (
        <Link to={linkTo} className="block group">
            <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-lg transition-all duration-300 hover:shadow-2xl hover:-translate-y-2">
                <div className="flex items-start justify-between">
                    <div className="space-y-2">
                        <h2 className="text-xl font-bold text-gray-900 dark:text-white group-hover:text-orange-500">{title}</h2>
                        <p className="text-gray-500 dark:text-gray-400 text-sm">{description}</p>
                    </div>
                    <div className="transform transition-transform duration-300 group-hover:scale-110">
                        {icon}
                    </div>
                </div>
                <div className="mt-6">
                    <span className="font-semibold text-sm text-orange-500">عرض التقرير &rarr;</span>
                </div>
            </div>
        </Link>
    );
};


const ReportsScreen: React.FC = () => {
    // const { t } = useSettings();
    const { hasPermission } = useAuth();
    const canViewAccounting = hasPermission('accounting.view');

    const reports = useMemo(() => ([
        {
            title: 'تقرير المبيعات',
            description: 'تحليل شامل للمبيعات والأرباح',
            icon: <SalesIcon />,
            linkTo: '/admin/reports/sales',
        },
        {
            title: 'تقرير المنتجات',
            description: 'أداء المنتجات والمخزون',
            icon: <ProductIcon />,
            linkTo: '/admin/reports/products',
        },
        {
            title: 'تقرير العملاء',
            description: 'سلوك العملاء ونمو القاعدة',
            icon: <CustomerIcon />,
            linkTo: '/admin/reports/customers',
        },
        ...(canViewAccounting ? [{
            title: 'التقارير المالية',
            description: 'دفتر الأستاذ والقوائم وأعمار الذمم',
            icon: <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v.01M12 18v-1m0 1v.01M4 6h16M4 18h16" /></svg>,
            linkTo: '/admin/accounting',
        }] : []),
        {
            title: 'تقرير المشتريات',
            description: 'سجل أوامر الشراء والموردين',
            icon: <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-teal-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>,
            linkTo: '/admin/purchases',
        },
        {
            title: 'تقرير الورديات',
            description: 'حركة الصندوق والفروقات النقدية',
            icon: <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v.01M12 6v-1h4v1M7 7h1M7 7h1M7 7v1M7 7v1m0-1H6m1 0H6m1 0v-1m0 1v-1m10 1h1M17 7h-1m1 0v-1m0 1v-1m0 1h1m-1 0h1m-1 0v1m0-1v1" /></svg>,
            linkTo: '/admin/shift-reports',
        },
    ]), [canViewAccounting]);

    return (
        <div className="animate-fade-in space-y-8">
            <div>
                <h1 className="text-3xl font-bold dark:text-white">مركز التقارير</h1>
                <p className="mt-2 text-lg text-gray-500 dark:text-gray-400">نظرة عامة على أداء المتجر</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                {reports.map((report, index) => (
                    <ReportCard
                        key={index}
                        title={report.title}
                        description={report.description}
                        icon={report.icon}
                        linkTo={report.linkTo}
                    />
                ))}
            </div>
        </div>
    );
};

export default ReportsScreen;
