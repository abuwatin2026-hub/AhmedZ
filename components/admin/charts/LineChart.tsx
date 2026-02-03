import React from 'react';

interface DataPoint {
    label: string;
    value: number;
}

interface LineChartProps {
    data: DataPoint[];
    title: string;
    unit?: string;
    color?: string;
    showArea?: boolean;
}

const LineChart: React.FC<LineChartProps> = ({
    data,
    title,
    unit = '',
    color = '#f97316',
    showArea = true
}) => {
    if (!data || data.length === 0) {
        return (
            <div className="p-8 text-center text-gray-500 dark:text-gray-400">
                لا توجد بيانات لعرضها
            </div>
        );
    }

    const maxValue = Math.max(...data.map(d => d.value), 1);
    const minValue = Math.min(...data.map(d => d.value), 0);
    const range = maxValue - minValue || 1;

    const chartHeight = 200;
    const chartWidth = 100; // percentage
    const padding = { top: 20, right: 10, bottom: 30, left: 50 };

    // Calculate points for the line
    const points = data.map((point, index) => {
        const x = (index / (data.length - 1 || 1)) * chartWidth;
        const y = chartHeight - ((point.value - minValue) / range) * (chartHeight - padding.top - padding.bottom);
        return { x, y, value: point.value, label: point.label };
    });

    // Create SVG path for the line
    const linePath = points
        .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x}% ${point.y}`)
        .join(' ');

    // Create SVG path for the area (if enabled)
    const areaPath = showArea
        ? `${linePath} L ${points[points.length - 1].x}% ${chartHeight} L 0% ${chartHeight} Z`
        : '';

    return (
        <div className="w-full">
            <h3 className="text-lg font-semibold mb-4 dark:text-white">{title}</h3>
            <div className="relative" style={{ height: `${chartHeight + padding.bottom}px` }}>
                <svg
                    className="w-full h-full"
                    viewBox={`0 0 ${chartWidth} ${chartHeight + padding.bottom}`}
                    preserveAspectRatio="none"
                >
                    {/* Grid lines */}
                    {[0, 0.25, 0.5, 0.75, 1].map((fraction, i) => {
                        const y = chartHeight - fraction * (chartHeight - padding.top - padding.bottom);
                        const value = minValue + fraction * range;
                        return (
                            <g key={i}>
                                <line
                                    x1="0"
                                    y1={y}
                                    x2={chartWidth}
                                    y2={y}
                                    stroke="currentColor"
                                    strokeWidth="0.1"
                                    className="text-gray-300 dark:text-gray-600"
                                    strokeDasharray="2,2"
                                />
                                <text
                                    x="-2"
                                    y={y}
                                    fontSize="3"
                                    fill="currentColor"
                                    className="text-gray-500 dark:text-gray-400"
                                    textAnchor="end"
                                    dominantBaseline="middle"
                                >
                                    {value.toFixed(0)}{unit ? ` ${unit}` : ''}
                                </text>
                            </g>
                        );
                    })}

                    {/* Area fill */}
                    {showArea && (
                        <path
                            d={areaPath}
                            fill={color}
                            fillOpacity="0.1"
                        />
                    )}

                    {/* Line */}
                    <path
                        d={linePath}
                        fill="none"
                        stroke={color}
                        strokeWidth="0.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />

                    {/* Points */}
                    {points.map((point, index) => (
                        <g key={index}>
                            <circle
                                cx={`${point.x}%`}
                                cy={point.y}
                                r="1"
                                fill={color}
                                className="hover:r-2 transition-all cursor-pointer"
                            />
                            <title>{`${point.label}: ${point.value.toFixed(2)} ${unit}`}</title>
                        </g>
                    ))}
                </svg>

                {/* X-axis labels */}
                <div className="absolute bottom-0 left-0 right-0 flex justify-between px-2">
                    {data.map((point, index) => {
                        // Show only first, middle, and last labels to avoid crowding
                        const shouldShow = index === 0 || index === Math.floor(data.length / 2) || index === data.length - 1;
                        return shouldShow ? (
                            <span
                                key={index}
                                className="text-xs text-gray-500 dark:text-gray-400"
                                style={{ transform: 'translateX(-50%)' }}
                            >
                                {point.label}
                            </span>
                        ) : null;
                    })}
                </div>
            </div>

            {/* Legend */}
            <div className="mt-4 flex items-center justify-center gap-2 text-sm">
                <div className="flex items-center gap-2">
                    <div
                        className="w-4 h-1 rounded"
                        style={{ backgroundColor: color }}
                    />
                    <span className="text-gray-600 dark:text-gray-300">
                        {title} ({unit})
                    </span>
                </div>
            </div>
        </div>
    );
};

export default LineChart;
