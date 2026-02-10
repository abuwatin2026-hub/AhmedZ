import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getSupabaseClient } from '../../../supabase';
import * as Icons from '../../../components/icons';

type AgingRow = {
  party_id: string;
  current: number;
  days_1_30: number;
  days_31_60: number;
  days_61_90: number;
  days_91_plus: number;
  total_outstanding: number;
};

const PartyAgingReportsScreen: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'ar' | 'ap'>('ar');
  const [ar, setAr] = useState<AgingRow[]>([]);
  const [ap, setAp] = useState<AgingRow[]>([]);
  const [partyNames, setPartyNames] = useState<Record<string, string>>({});

  const load = async () => {
    setLoading(true);
    try {
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error('supabase not available');

      const [{ data: arData, error: arErr }, { data: apData, error: apErr }] = await Promise.all([
        supabase.from('party_ar_aging_summary').select('*'),
        supabase.from('party_ap_aging_summary').select('*'),
      ]);
      if (arErr) throw arErr;
      if (apErr) throw apErr;

      const arRows = (Array.isArray(arData) ? arData : []) as any as AgingRow[];
      const apRows = (Array.isArray(apData) ? apData : []) as any as AgingRow[];
      setAr(arRows);
      setAp(apRows);

      const ids = Array.from(new Set([...arRows.map((r) => r.party_id), ...apRows.map((r) => r.party_id)].filter(Boolean)));
      if (ids.length > 0) {
        const { data: pData } = await supabase.from('financial_parties').select('id,name').in('id', ids);
        const map: Record<string, string> = {};
        (Array.isArray(pData) ? pData : []).forEach((r: any) => {
          map[String(r.id)] = String(r.name || '—');
        });
        setPartyNames(map);
      } else {
        setPartyNames({});
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const rows = useMemo(() => (tab === 'ar' ? ar : ap).slice().sort((a, b) => (Number(b.total_outstanding) || 0) - (Number(a.total_outstanding) || 0)), [tab, ar, ap]);

  if (loading) return <div className="p-8 text-center text-gray-500">جاري التحميل...</div>;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-l from-primary-600 to-gold-500">
          تقرير أعمار الديون للأطراف
        </h1>
        <Link
          to="/admin/financial-parties"
          className="bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-gray-50 dark:hover:bg-gray-700 shadow-lg border border-gray-100 dark:border-gray-700"
        >
          <Icons.CustomersIcon className="w-5 h-5" />
          <span>الأطراف</span>
        </Link>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-100 dark:border-gray-700 p-3 mb-4 flex items-center gap-2">
        <button
          onClick={() => setTab('ar')}
          className={`px-4 py-2 rounded-lg text-sm ${tab === 'ar' ? 'bg-primary-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200'}`}
        >
          ذمم مدينة (AR)
        </button>
        <button
          onClick={() => setTab('ap')}
          className={`px-4 py-2 rounded-lg text-sm ${tab === 'ap' ? 'bg-primary-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200'}`}
        >
          ذمم دائنة (AP)
        </button>
        <button
          onClick={() => void load()}
          className="ml-auto bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 px-3 py-2 rounded-lg flex items-center gap-2 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-100 dark:border-gray-700"
        >
          <Icons.ReportIcon className="w-5 h-5" />
          <span>تحديث</span>
        </button>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-100 dark:border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right">
            <thead className="bg-gray-50 dark:bg-gray-700/50">
              <tr>
                <th className="p-4 text-sm font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">الطرف</th>
                <th className="p-4 text-sm font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">حالي</th>
                <th className="p-4 text-sm font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">1-30</th>
                <th className="p-4 text-sm font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">31-60</th>
                <th className="p-4 text-sm font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">61-90</th>
                <th className="p-4 text-sm font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">91+</th>
                <th className="p-4 text-sm font-semibold text-gray-600 dark:text-gray-300">الإجمالي</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-gray-500 dark:text-gray-400">
                    لا توجد بيانات.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.party_id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                    <td className="p-4 font-medium dark:text-white border-r dark:border-gray-700">
                      <div className="flex items-center justify-between gap-2">
                        <span>{partyNames[r.party_id] || '—'}</span>
                        <div className="flex items-center gap-3">
                          <Link
                            to={`/admin/financial-parties/${r.party_id}?print=1`}
                            className="text-primary-700 dark:text-primary-300 hover:underline text-xs"
                            title="طباعة كشف الحساب"
                          >
                            طباعة
                          </Link>
                          <Link
                            to={`/admin/financial-parties/${r.party_id}`}
                            className="text-primary-700 dark:text-primary-300 hover:underline text-xs"
                            title="عرض كشف الحساب"
                          >
                            كشف الحساب
                          </Link>
                          <Link
                            to={`/admin/settlements?partyId=${encodeURIComponent(r.party_id)}`}
                            className="text-primary-700 dark:text-primary-300 hover:underline text-xs"
                            title="فتح التسويات للطرف"
                          >
                            تسوية
                          </Link>
                          <Link
                            to={`/admin/advances?partyId=${encodeURIComponent(r.party_id)}`}
                            className="text-primary-700 dark:text-primary-300 hover:underline text-xs"
                            title="فتح الدفعات المسبقة للطرف"
                          >
                            دفعات
                          </Link>
                        </div>
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 font-mono" dir="ltr">{r.party_id}</div>
                    </td>
                    <td className="p-4 border-r dark:border-gray-700 font-mono" dir="ltr">{Number(r.current || 0).toFixed(2)}</td>
                    <td className="p-4 border-r dark:border-gray-700 font-mono" dir="ltr">{Number(r.days_1_30 || 0).toFixed(2)}</td>
                    <td className="p-4 border-r dark:border-gray-700 font-mono" dir="ltr">{Number(r.days_31_60 || 0).toFixed(2)}</td>
                    <td className="p-4 border-r dark:border-gray-700 font-mono" dir="ltr">{Number(r.days_61_90 || 0).toFixed(2)}</td>
                    <td className="p-4 border-r dark:border-gray-700 font-mono" dir="ltr">{Number(r.days_91_plus || 0).toFixed(2)}</td>
                    <td className="p-4 font-mono" dir="ltr">{Number(r.total_outstanding || 0).toFixed(2)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default PartyAgingReportsScreen;
