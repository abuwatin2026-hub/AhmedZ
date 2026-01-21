import React from 'react';

interface ChartData {
  label: string;
  value: number;
}

interface BarChartProps {
  data: ChartData[];
  title: string;
  currency?: string;
}

const BarChart: React.FC<BarChartProps> = ({ data, title, currency = '' }) => {
  const maxValue = Math.max(...data.map(d => d.value), 1); // Avoid division by zero

  return (
    <div className="h-full flex flex-col">
      <h3 className="text-lg font-bold text-gray-800 dark:text-white mb-4">{title}</h3>
      <div className="flex-grow overflow-x-auto">
        <div className="min-w-max flex items-end gap-3 pt-4 border-l border-b border-gray-200 dark:border-gray-600 px-2 rtl:border-l-0 rtl:border-r">
          {data.map((d, i) => (
            <div key={i} className="w-10 sm:w-12 flex flex-col items-center gap-2 group">
              <div className="relative w-full h-full flex items-end">
                <div
                  className="w-full bg-primary-400 dark:bg-primary-500 rounded-t-md transition-all duration-500 ease-out group-hover:bg-primary-500 dark:group-hover:bg-primary-400"
                  style={{ height: `${(d.value / maxValue) * 100}%` }}
                >
                  <div className="absolute -top-8 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-gray-800 dark:bg-gray-900 text-white text-xs font-bold py-1 px-2 rounded-md whitespace-nowrap">
                    {d.value.toFixed(2)} {currency}
                  </div>
                </div>
              </div>
              <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 whitespace-nowrap">{d.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default BarChart;
