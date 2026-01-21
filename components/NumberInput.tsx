import React, { useRef, useEffect } from 'react';

interface NumberInputProps {
    id: string;
    name: string;
    value: number;
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    min?: number;
    max?: number;
    step?: number;
    placeholder?: string;
    disabled?: boolean;
    label?: string;
    className?: string;
}

const NumberInput: React.FC<NumberInputProps> = ({
    id,
    name,
    value,
    onChange,
    min = 0,
    max,
    step = 1,
    placeholder,
    disabled,
    className = '',
}) => {
    const inputRef = useRef<HTMLInputElement>(null);

    // Prevent scroll wheel from changing number
    useEffect(() => {
        const handleWheel = (e: WheelEvent) => {
            if (document.activeElement === inputRef.current) {
                e.preventDefault();
            }
        };
        const currentInput = inputRef.current;
        if (currentInput) {
            currentInput.addEventListener('wheel', handleWheel, { passive: false });
        }
        return () => {
            if (currentInput) {
                currentInput.removeEventListener('wheel', handleWheel);
            }
        };
    }, []);

    const handleIncrement = () => {
        if (disabled) return;
        const currentValue = Number(value) || 0;
        const newValue = currentValue + step;
        if (max !== undefined && newValue > max) return;

        // Create a synthetic event
        const event = {
            target: {
                name,
                value: Number.isInteger(step) ? newValue.toString() : newValue.toFixed(4), // Precision handling
                type: 'number',
            },
        } as unknown as React.ChangeEvent<HTMLInputElement>;

        onChange(event);
    };

    const handleDecrement = () => {
        if (disabled) return;
        const currentValue = Number(value) || 0;
        const newValue = currentValue - step;
        if (min !== undefined && newValue < min) return;

        // Create a synthetic event
        const event = {
            target: {
                name,
                value: Number.isInteger(step) ? newValue.toString() : newValue.toFixed(4),
                type: 'number',
            },
        } as unknown as React.ChangeEvent<HTMLInputElement>;

        onChange(event);
    };

    return (
        <div className={`flex items-center rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 overflow-hidden focus-within:ring-2 focus-within:ring-gold-500 focus-within:border-gold-500 transition shadow-sm ${className}`}>
            <button
                type="button"
                onClick={handleDecrement}
                disabled={disabled || (min !== undefined && value <= min)}
                className="w-12 h-12 flex items-center justify-center bg-gray-100 dark:bg-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-500 disabled:opacity-50 disabled:cursor-not-allowed border-l border-gray-200 dark:border-gray-500 rtl:border-l-0 rtl:border-r transition active:bg-gray-300 dark:active:bg-gray-400 touch-manipulation"
                aria-label="Decrease"
            >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M20 12H4" />
                </svg>
            </button>

            <input
                ref={inputRef}
                id={id}
                name={name}
                type="number"
                inputMode="decimal"
                value={value}
                onChange={onChange}
                min={min}
                max={max}
                step={step}
                placeholder={placeholder}
                disabled={disabled}
                className="w-full h-12 p-2 text-center bg-transparent border-none focus:ring-0 text-gray-900 dark:text-white font-bold text-lg appearance-none"
                style={{ MozAppearance: 'textfield' }} // Hide spinner in Firefox
            />

            <button
                type="button"
                onClick={handleIncrement}
                disabled={disabled || (max !== undefined && value >= max)}
                className="w-12 h-12 flex items-center justify-center bg-gray-100 dark:bg-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-500 disabled:opacity-50 disabled:cursor-not-allowed border-r border-gray-200 dark:border-gray-500 rtl:border-r-0 rtl:border-l transition active:bg-gray-300 dark:active:bg-gray-400 touch-manipulation"
                aria-label="Increase"
            >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                </svg>
            </button>
        </div>
    );
};

export default NumberInput;
