import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useImport } from '../../contexts/ImportContext';
import { ImportShipment } from '../../types';
import { Plus, Package, FileText, Check } from '../../components/icons';

const ImportShipmentsScreen: React.FC = () => {
    const navigate = useNavigate();
    const { shipments, loading, fetchShipments, deleteShipment } = useImport();
    const [filter, setFilter] = useState<string>('all');

    useEffect(() => {
        fetchShipments();
    }, [fetchShipments]);

    const getStatusBadge = (status: ImportShipment['status']) => {
        const statusConfig: Record<ImportShipment['status'], { label: string; color: string }> = {
            draft: { label: 'مسودة', color: 'bg-gray-100 text-gray-800' },
            ordered: { label: 'تم الطلب', color: 'bg-blue-100 text-blue-800' },
            shipped: { label: 'قيد الشحن', color: 'bg-yellow-100 text-yellow-800' },
            at_customs: { label: 'في الجمارك', color: 'bg-orange-100 text-orange-800' },
            cleared: { label: 'تم التخليص', color: 'bg-green-100 text-green-800' },
            delivered: { label: 'تم التسليم', color: 'bg-green-600 text-white' },
            cancelled: { label: 'ملغي', color: 'bg-red-100 text-red-800' }
        };
        const config = statusConfig[status];
        return (
            <span className={`px-2 py-1 rounded-full text-xs font-medium ${config.color}`}>
                {config.label}
            </span>
        );
    };

    const filteredShipments = shipments.filter((s: ImportShipment) => {
        if (filter === 'all') return true;
        return s.status === filter;
    });

    const handleDelete = async (id: string) => {
        if (window.confirm('هل أنت متأكد من حذف هذه الشحنة؟')) {
            await deleteShipment(id);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <div className="text-lg">جاري التحميل...</div>
            </div>
        );
    }

    return (
        <div className="p-6 max-w-7xl mx-auto">
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-3xl font-bold">إدارة الشحنات المستوردة</h1>
                <button
                    onClick={() => navigate('/admin/import-shipments/new')}
                    className="bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-blue-700"
                >
                    <Plus className="w-5 h-5" />
                    شحنة جديدة
                </button>
            </div>

            {/* Filters */}
            <div className="mb-6 flex gap-2 flex-wrap">
                {['all', 'draft', 'ordered', 'shipped', 'at_customs', 'cleared', 'delivered'].map(status => (
                    <button
                        key={status}
                        onClick={() => setFilter(status)}
                        className={`px-4 py-2 rounded-lg ${filter === status
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                            }`}
                    >
                        {status === 'all' ? 'الكل' : getStatusBadge(status as any).props.children}
                    </button>
                ))}
            </div>

            {/* Shipments List */}
            <div className="grid gap-4">
                {filteredShipments.length === 0 ? (
                    <div className="text-center py-12 bg-gray-50 rounded-lg">
                        <Package className="w-16 h-16 mx-auto text-gray-400 mb-4" />
                        <p className="text-gray-600">لا توجد شحنات</p>
                    </div>
                ) : (
                    filteredShipments.map((shipment: ImportShipment) => (
                        <div
                            key={shipment.id}
                            className="bg-white border rounded-lg p-4 hover:shadow-md transition-shadow cursor-pointer"
                            onClick={() => navigate(`/admin/import-shipments/${shipment.id}`)}
                        >
                            <div className="flex justify-between items-start mb-3">
                                <div>
                                    <h3 className="text-lg font-semibold">{shipment.referenceNumber}</h3>
                                    <p className="text-sm text-gray-600">
                                        {shipment.originCountry && `من: ${shipment.originCountry}`}
                                    </p>
                                </div>
                                {getStatusBadge(shipment.status)}
                            </div>

                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                                {shipment.shippingCarrier && (
                                    <div className="flex items-center gap-2">
                                        <Package className="w-4 h-4 text-gray-400" />
                                        <span>{shipment.shippingCarrier}</span>
                                    </div>
                                )}
                                {shipment.trackingNumber && (
                                    <div className="flex items-center gap-2">
                                        <FileText className="w-4 h-4 text-gray-400" />
                                        <span>{shipment.trackingNumber}</span>
                                    </div>
                                )}
                                {shipment.expectedArrivalDate && (
                                    <div className="text-gray-600">
                                        الوصول المتوقع: {new Date(shipment.expectedArrivalDate).toLocaleDateString('ar-EG-u-nu-latn')}
                                    </div>
                                )}
                                {shipment.actualArrivalDate && (
                                    <div className="flex items-center gap-2 text-green-600">
                                        <Check className="w-4 h-4" />
                                        <span>وصل في {new Date(shipment.actualArrivalDate).toLocaleDateString('ar-EG-u-nu-latn')}</span>
                                    </div>
                                )}
                            </div>

                            <div className="mt-3 flex gap-2">
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        navigate(`/admin/import-shipments/${shipment.id}`);
                                    }}
                                    className="text-blue-600 hover:underline text-sm"
                                >
                                    عرض التفاصيل
                                </button>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleDelete(shipment.id);
                                    }}
                                    className="text-red-600 hover:underline text-sm"
                                >
                                    حذف
                                </button>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};

export default ImportShipmentsScreen;
