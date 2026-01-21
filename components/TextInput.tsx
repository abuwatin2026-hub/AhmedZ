import React from 'react';

interface TextInputProps {
  id: string;
  name: string;
  type?: 'text' | 'email' | 'tel' | 'number' | 'url';
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  required?: boolean;
  icon?: React.ReactNode;
  disabled?: boolean;
}

const TextInput: React.FC<TextInputProps> = ({
  id,
  name,
  type = 'text',
  value,
  onChange,
  placeholder,
  required,
  icon,
  disabled,
}) => {
  return (
    <div className="relative">
      {icon && (
        <span className="absolute inset-y-0 right-0 flex items-center pr-3 rtl:right-auto rtl:left-0 rtl:pr-0 rtl:pl-3 pointer-events-none">
            {icon}
        </span>
      )}
      <input
        id={id}
        name={name}
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        className="w-full p-3 pr-10 rtl:pl-10 rtl:pr-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition disabled:bg-gray-200 dark:disabled:bg-gray-800 disabled:cursor-not-allowed"
      />
    </div>
  );
};

export default TextInput;