import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCashShift } from '../../contexts/CashShiftContext';
import { useAuth } from '../../contexts/AuthContext';
import * as Icons from '../../components/icons';
import { getSupabaseClient } from '../../supabase';

interface ShiftManagementModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const ShiftManagementModal: React.FC<ShiftManagementModalProps> = ({ isOpen, onClose }) => {
    const { currentShift, startShift, endShift, expectedCash, loading } = useCashShift();
    const { user } = useAuth();
    const supabase = getSupabaseClient();
    const navigate = useNavigate();

    const [amount, setAmount] = useState<string>('');
    const [notes, setNotes] = useState('');
    const [error, setError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [cashierLabel, setCashierLabel] = useState<string>('');

    // Reset form when modal opens or shift state changes
    useEffect(() => {
        if (isOpen) {
            setAmount('');
            setNotes('');
            setError('');
        }
    }, [isOpen, currentShift]);

    useEffect(() => {
        const resolveCashierLabel = async () => {
            const fallback = user?.fullName || user?.email || '';
            if (!currentShift || !currentShift.cashierId || !supabase) {
                setCashierLabel(fallback);
                return;
            }
            try {
                const { data, error } = await supabase
                    .from('admin_users')
                    .select('full_name, username, email')
                    .eq('auth_user_id', currentShift.cashierId)
                    .maybeSingle();
                if (error || !data) {
                    setCashierLabel(fallback);
                    return;
                }
                const label = String(data.full_name || data.username || data.email || fallback);
                setCashierLabel(label);
            } catch {
                setCashierLabel(fallback);
            }
        };
        resolveCashierLabel();
    }, [currentShift, user, supabase]);

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        const numAmount = parseFloat(amount);
        if (isNaN(numAmount) || numAmount < 0) {
            setError('يرجى إدخال مبلغ صحيح.');
            return;
        }

        const difference = isClosing ? (numAmount - expectedCash) : 0;

        if (isClosing && Math.abs(difference) > 0.01 && !notes.trim()) {
            setError('يوجد فرق في النقدية. يرجى كتابة سبب العجز/الزيادة في الملاحظات.');
            return;
        }

        setIsSubmitting(true);
        try {
            if (currentShift) {
                await endShift(numAmount, notes);
            } else {
                await startShift(numAmount);
            }
            onClose();
        } catch (err) {
            console.error(err);
            const raw = err instanceof Error ? err.message : '';
            setError(raw && /[\u0600-\u06FF]/.test(raw) ? raw : 'تعذر تحديث الوردية. حاول مرة أخرى.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const isClosing = !!currentShift;
    const difference = isClosing ? (parseFloat(amount || '0') - expectedCash) : 0;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200 max-h-[min(90dvh,calc(100dvh-2rem))] flex flex-col">

                {/* Header */}
                <div className="bg-gray-100 dark:bg-gray-700 p-4 flex justify-between items-center border-b dark:border-gray-600">
                    <h2 className="text-xl font-bold flex items-center gap-2 text-gray-800 dark:text-white">
                        <Icons.ClockIcon className="w-5 h-5 text-indigo-500" />
                        {isClosing ? 'إنهاء الوردية' : 'بدء الوردية'}
                    </h2>
                    <button onClick={onClose} className="p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-full transition-colors">
                        <Icons.XIcon className="w-5 h-5" />
                    </button>
                </div>

                {/* Body */}
                <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto">

                        {/* Info Section */}
                        <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg border border-blue-100 dark:border-blue-800">
                            <div className="flex justify-between items-center mb-2">
                                <span className="text-sm text-gray-500 dark:text-gray-400">الكاشير:</span>
                            <span className="font-semibold dark:text-gray-200">{cashierLabel}</span>
                            </div>
                            {isClosing && (
                                <>
                                    <div className="flex justify-between items-center mb-1">
                                        <span className="text-sm text-gray-500 dark:text-gray-400">وقت البدء:</span>
                                    <span className="font-mono text-xs dark:text-gray-300">{new Date(currentShift.openedAt).toLocaleString('ar-EG-u-nu-latn')}</span>
                                </div>
                                <div className="flex justify-between items-center mb-1">
                                    <span className="text-sm text-gray-500 dark:text-gray-400">عهدة البداية:</span>
                                    <span className="font-semibold text-green-600">{currentShift.startAmount.toFixed(2)}</span>
                                </div>
                                <div className="flex justify-between items-center border-t pt-2 mt-2 border-blue-200 dark:border-blue-700">
                                    <span className="text-base font-bold text-gray-700 dark:text-gray-300">النقد المتوقع:</span>
                                    <span className="text-xl font-bold text-indigo-600">{expectedCash.toFixed(2)}</span>
                                </div>
                            </>
                        )}
                    </div>

                    {/* Amount Input */}
                    <div>
                        <label className="block text-sm font-medium mb-1 dark:text-gray-300">
                            {isClosing ? 'النقد الفعلي بعد الجرد' : 'عهدة البداية'}
                        </label>
                        <div className="relative">
                            <Icons.MoneyIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                            <input
                                type="number"
                                step="0.01"
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                                min={0}
                                className="w-full pl-10 pr-4 py-3 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-lg font-mono dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                placeholder="0.00"
                                autoFocus
                                required
                            />
                        </div>
                    </div>

                    {/* Difference Warning (Closing only) */}
                    {isClosing && amount !== '' && Math.abs(difference) > 0.01 && (
                        <div className={`p-3 rounded-lg flex items-start gap-3 ${difference < 0 ? 'bg-red-50 text-red-700' : 'bg-yellow-50 text-yellow-700'}`}>
                            <Icons.InfoIcon className="w-5 h-5 shrink-0 mt-0.5" />
                            <div>
                                <p className="font-bold">تم رصد فرق</p>
                                <p className="text-sm">
                                    الفرق: <span dir="ltr">{difference > 0 ? '+' : ''}{difference.toFixed(2)}</span>
                                </p>
                                <p className="text-xs mt-1 opacity-80">
                                    {difference < 0 ? 'يوجد نقص نقدي.' : 'يوجد زيادة نقدية.'}
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Notes Input */}
                    <div>
                        <label className="block text-sm font-medium mb-1 dark:text-gray-300">
                            {isClosing && amount !== '' && Math.abs(difference) > 0.01 
                                ? 'سبب الفرق (مطلوب)' 
                                : 'ملاحظات (اختياري)'}
                        </label>
                        <textarea
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            className={`w-full p-3 border rounded-lg focus:ring-2 outline-none h-20 resize-none dark:bg-gray-700 dark:border-gray-600 dark:text-white ${
                                isClosing && amount !== '' && Math.abs(difference) > 0.01 && !notes.trim()
                                    ? 'border-red-500 focus:ring-red-500' 
                                    : 'focus:ring-indigo-500'
                            }`}
                            placeholder={isClosing && amount !== '' && Math.abs(difference) > 0.01 
                                ? "يرجى توضيح سبب العجز أو الزيادة..." 
                                : "اكتب ملاحظاتك حول الوردية..."}
                        />
                    </div>

                    {error && <p className="text-red-500 text-sm text-center">{error}</p>}

                    <button
                        type="submit"
                        disabled={isSubmitting || loading}
                        className={`w-full py-3 rounded-lg font-bold text-white shadow-lg transition-all transform active:scale-95
              ${isClosing
                                ? 'bg-red-500 hover:bg-red-600 shadow-red-500/30'
                                : 'bg-green-500 hover:bg-green-600 shadow-green-500/30'
                            } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                        {isSubmitting ? 'جاري التنفيذ...' : (isClosing ? 'إنهاء الوردية وإغلاق الصندوق' : 'بدء الوردية')}
                    </button>

                    {isClosing && (
                        <button
                            type="button"
                            onClick={() => {
                                onClose();
                                navigate('/admin/my-shift');
                            }}
                            className="w-full py-3 rounded-lg font-bold border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                        >
                            تفاصيل الوردية
                        </button>
                    )}
                </form>
            </div>
        </div>
    );
};

export default ShiftManagementModal;
