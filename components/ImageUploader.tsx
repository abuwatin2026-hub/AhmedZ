import React, { useState, useRef, DragEvent } from 'react';
import { compressImage, isValidImageType, isValidImageSize } from '../utils/imageUtils';
import { ImageIcon, UploadIcon, XIcon } from './icons';

interface ImageUploaderProps {
    value?: string; // Base64 string
    onChange: (base64: string) => void;
    maxSizeMB?: number;
    maxWidth?: number;
    maxHeight?: number;
    quality?: number;
    label?: string;
    aspectRatio?: string; // e.g., "16/9", "1/1", "4/3"
    className?: string;
}

const ImageUploader: React.FC<ImageUploaderProps> = ({
    value,
    onChange,
    maxSizeMB = 5,
    maxWidth = 800,
    maxHeight = 800,
    quality = 0.8,
    label = 'رفع صورة',
    aspectRatio,
    className = '',
}) => {
    const [isDragging, setIsDragging] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [error, setError] = useState<string>('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFile = async (file: File) => {
        setError('');
        setIsProcessing(true);

        try {
            // التحقق من نوع الملف
            if (!isValidImageType(file)) {
                throw new Error('نوع الملف غير مدعوم. يرجى رفع صورة (JPG, PNG, WebP)');
            }

            // التحقق من حجم الملف
            if (!isValidImageSize(file, maxSizeMB)) {
                throw new Error(`حجم الملف كبير جداً. الحد الأقصى ${maxSizeMB}MB`);
            }

            // ضغط الصورة
            const compressedBase64 = await compressImage(file, {
                maxWidth,
                maxHeight,
                quality,
                outputFormat: 'image/jpeg',
            });

            onChange(compressedBase64);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'حدث خطأ أثناء رفع الصورة');
        } finally {
            setIsProcessing(false);
        }
    };

    const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setIsDragging(false);
    };

    const handleDrop = (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setIsDragging(false);

        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleFile(files[0]);
        }
    };

    const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (files && files.length > 0) {
            handleFile(files[0]);
        }
    };

    const handleRemove = () => {
        onChange('');
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const handleClick = () => {
        fileInputRef.current?.click();
    };

    return (
        <div className={`space-y-2 ${className}`}>
            {label && (
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    {label}
                </label>
            )}

            <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={!value ? handleClick : undefined}
                className={`
          relative border-2 border-dashed rounded-lg transition-all duration-200
          ${isDragging ? 'border-orange-500 bg-orange-50 dark:bg-orange-900/20' : 'border-gray-300 dark:border-gray-600'}
          ${!value ? 'cursor-pointer hover:border-orange-400 hover:bg-gray-50 dark:hover:bg-gray-800' : ''}
          ${value ? 'p-2' : 'p-8'}
        `}
                style={aspectRatio ? { aspectRatio } : undefined}
            >
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/jpg,image/png,image/webp"
                    onChange={handleFileInputChange}
                    className="hidden"
                />

                {isProcessing ? (
                    <div className="flex flex-col items-center justify-center h-full space-y-3">
                        <div className="w-12 h-12 border-4 border-orange-500 border-t-transparent rounded-full animate-spin"></div>
                        <p className="text-sm text-gray-600 dark:text-gray-400">جاري معالجة الصورة...</p>
                    </div>
                ) : value ? (
                    <div className="relative group">
                        <img
                            src={value}
                            alt="Preview"
                            className="w-full h-full object-cover rounded-lg"
                        />
                        <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-50 transition-all duration-200 rounded-lg flex items-center justify-center">
                            <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex gap-2">
                                <button
                                    type="button"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleClick();
                                    }}
                                    className="p-3 bg-white dark:bg-gray-800 rounded-full shadow-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition"
                                    title="تغيير الصورة"
                                >
                                    <UploadIcon className="w-5 h-5 text-gray-700 dark:text-gray-300" />
                                </button>
                                <button
                                    type="button"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleRemove();
                                    }}
                                    className="p-3 bg-red-500 rounded-full shadow-lg hover:bg-red-600 transition"
                                    title="حذف الصورة"
                                >
                                    <XIcon className="w-5 h-5 text-white" />
                                </button>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center space-y-3 text-center">
                        <div className="w-16 h-16 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center">
                            <ImageIcon className="w-8 h-8 text-gray-400 dark:text-gray-500" />
                        </div>
                        <div>
                            <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                                اضغط لرفع صورة أو اسحبها هنا
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                JPG, PNG, WebP (حتى {maxSizeMB}MB)
                            </p>
                        </div>
                    </div>
                )}
            </div>

            {error && (
                <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                    <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
                </div>
            )}

            {value && !isProcessing && (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                    ✓ تم رفع الصورة بنجاح
                </p>
            )}
        </div>
    );
};

export default ImageUploader;
