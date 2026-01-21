import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
    onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
    hasError: boolean;
    error?: Error;
    errorInfo?: ErrorInfo;
}

/**
 * Error Boundary Component
 * يلتقط الأخطاء في شجرة المكونات ويعرض واجهة بديلة
 */
class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        // تسجيل الخطأ
        console.error('Error caught by ErrorBoundary:', error, errorInfo);

        // حفظ معلومات الخطأ في الحالة
        this.setState({
            error,
            errorInfo,
        });

        // استدعاء callback إذا كان موجوداً
        if (this.props.onError) {
            this.props.onError(error, errorInfo);
        }

        // في الإنتاج: إرسال إلى خدمة تتبع الأخطاء
        if (import.meta.env.PROD) {
            // TODO: إرسال إلى Sentry أو خدمة مشابهة
            // Sentry.captureException(error, { contexts: { react: { componentStack: errorInfo.componentStack } } });
        }
    }

    handleReset = () => {
        this.setState({ hasError: false, error: undefined, errorInfo: undefined });
    };

    handleReload = () => {
        window.location.reload();
    };

    render() {
        if (this.state.hasError) {
            // إذا كان هناك fallback مخصص
            if (this.props.fallback) {
                return this.props.fallback;
            }

            // واجهة الخطأ الافتراضية
            return (
                <div className="min-h-dvh flex items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
                    <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-lg shadow-xl p-8 text-center">
                        <div className="mb-6">
                            <svg
                                className="mx-auto h-16 w-16 text-red-500"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                            >
                                <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                                />
                            </svg>
                        </div>

                        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
                            عذراً، حدث خطأ غير متوقع
                        </h2>

                        <p className="text-gray-600 dark:text-gray-400 mb-6">
                            نعتذر عن الإزعاج. حدث خطأ أثناء تحميل هذه الصفحة.
                        </p>

                        {import.meta.env.DEV && this.state.error && (
                            <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 rounded-lg text-left">
                                <p className="text-sm font-mono text-red-800 dark:text-red-300 break-all">
                                    {this.state.error.toString()}
                                </p>
                                {this.state.errorInfo && (
                                    <details className="mt-2">
                                        <summary className="text-sm text-red-700 dark:text-red-400 cursor-pointer">
                                            عرض التفاصيل
                                        </summary>
                                        <pre className="mt-2 text-xs text-red-600 dark:text-red-400 overflow-auto max-h-40">
                                            {this.state.errorInfo.componentStack}
                                        </pre>
                                    </details>
                                )}
                            </div>
                        )}

                        <div className="flex gap-3 justify-center">
                            <button
                                onClick={this.handleReset}
                                className="px-6 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                            >
                                المحاولة مرة أخرى
                            </button>
                            <button
                                onClick={this.handleReload}
                                className="px-6 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors"
                            >
                                إعادة تحميل الصفحة
                            </button>
                        </div>

                        <div className="mt-6">
                            <a
                                href="/"
                                className="text-sm text-orange-600 hover:text-orange-700 dark:text-orange-400 dark:hover:text-orange-300"
                            >
                                ← العودة إلى الصفحة الرئيسية
                            </a>
                        </div>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
