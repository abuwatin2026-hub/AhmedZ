import React from 'react';

interface ChartData {
  label: string;
  value: number;
}

interface HorizontalBarChartProps {
  data: ChartData[];
  title: string;
  unit?: string;
}

const HorizontalBarChart: React.FC<HorizontalBarChartProps> = ({ data, title, unit = '' }) => {
  const maxValue = Math.max(...data.map(d => d.value), 1); // Avoid division by zero
  const colors = [
    'bg-primary-500',
    'bg-primary-400',
    'bg-yellow-500',
    'bg-yellow-400',
    'bg-amber-500',
  ];

  return (
    <div className="h-full flex flex-col">
      <h3 className="text-lg font-bold text-gray-800 dark:text-white mb-4">{title}</h3>
      <div className="flex-grow space-y-4">
        {data.map((d, i) => (
          <div key={i} className="space-y-1 group">
            <div className="flex justify-between items-center text-sm">
              <span className="font-semibold text-gray-700 dark:text-gray-300 truncate pr-2">{d.label}</span>
              <span className="font-bold text-gray-800 dark:text-white">{d.value} <span className="text-xs text-gray-500">{unit}</span></span>
            </div>
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-4 overflow-hidden">
              <div
                className={`${colors[i % colors.length]} h-4 rounded-full transition-all duration-700 ease-out`}
                style={{ width: `${(d.value / maxValue) * 100}%` }}
              ></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default HorizontalBarChart;