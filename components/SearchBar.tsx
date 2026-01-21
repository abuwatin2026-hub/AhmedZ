import React from 'react';

const SearchIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
    </svg>
);

interface SearchBarProps {
    searchTerm: string;
    onSearchChange: (value: string) => void;
}

const SearchBar: React.FC<SearchBarProps> = ({ searchTerm, onSearchChange }) => {

    return (
        <div className="w-full">
            <div className="relative">
                <span className="absolute inset-y-0 right-0 flex items-center pr-4 rtl:right-auto rtl:left-0 rtl:pr-0 rtl:pl-4 pointer-events-none">
                    <SearchIcon />
                </span>
                <input
                    type="text"
                    placeholder={'ابحث عن منتج غذائي...'}
                    value={searchTerm}
                    onChange={(e) => onSearchChange(e.target.value)}
                    className="w-full p-4 pr-12 rtl:pl-12 rtl:pr-4 text-lg border-2 border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition"
                />
            </div>
        </div>
    );
};

export default SearchBar;
