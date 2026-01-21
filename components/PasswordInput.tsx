import React, { useState } from 'react';
import { EyeIcon, EyeOffIcon, LockIcon } from './icons';

interface PasswordInputProps {
  id: string;
  name: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  required?: boolean;
}

const PasswordInput: React.FC<PasswordInputProps> = ({ id, name, value, onChange, placeholder, required }) => {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="relative">
        <span className="absolute inset-y-0 right-0 flex items-center pr-3 rtl:right-auto rtl:left-0 rtl:pr-0 rtl:pl-3 pointer-events-none">
            <LockIcon />
        </span>
      <input
        id={id}
        name={name}
        type={showPassword ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        required={required}
        className="w-full p-3 px-10 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition"
      />
      <button
        type="button"
        onClick={() => setShowPassword(!showPassword)}
        className="absolute inset-y-0 left-0 flex items-center pl-3 rtl:left-auto rtl:right-0 rtl:pl-0 rtl:pr-3 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
        aria-label={showPassword ? "Hide password" : "Show password"}
      >
        {showPassword ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  );
};

export default PasswordInput;