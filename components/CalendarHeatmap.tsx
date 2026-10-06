'use client';

import React, { useEffect, useState } from 'react';
import ReactECharts from 'echarts-for-react';

interface CalendarHeatmapProps {
  data: [string, number, string, number][]; // [date, aqi, level, pm25]
  year: number;
}

export const CalendarHeatmap: React.FC<CalendarHeatmapProps> = ({ data, year }) => {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className="h-64 flex items-center justify-center text-slate-500 text-sm">加载日历热力图中...</div>;
  }

  // 格式化为 ECharts calendar 系列数据: [date, aqi]
  const seriesData = data.map(([date, aqi]) => [date, aqi]);

  const option = {
    backgroundColor: 'transparent',
    tooltip: {
      position: 'top',
      backgroundColor: '#0f172a',
      borderColor: '#334155',
      textStyle: { color: '#f8fafc', fontSize: 12 },
      formatter: (p: any) => {
        const item = data.find((d) => d[0] === p.value[0]);
        if (!item) return '';
        return `
          <div style="font-size: 12px; line-height: 1.6;">
            <b>${item[0]}</b><br/>
            AQI: <span style="font-weight: bold; color: #38bdf8">${item[1]}</span> (${item[2]})<br/>
            PM2.5 均值: <b>${item[3]} μg/m³</b>
          </div>
        `;
      },
    },
    visualMap: {
      min: 0,
      max: 250,
      calculable: true,
      orient: 'horizontal',
      left: 'center',
      bottom: '0%',
      textStyle: { color: '#94a3b8', fontSize: 11 },
      inRange: {
        color: ['#10b981', '#eab308', '#f97316', '#ef4444', '#8b5cf6', '#7f1d1d'],
      },
    },
    calendar: {
      top: 30,
      left: 40,
      right: 30,
      cellSize: ['auto', 16],
      range: year.toString(),
      itemStyle: {
        color: '#1e293b',
        borderWidth: 1.5,
        borderColor: '#0f172a',
      },
      splitLine: {
        show: true,
        lineStyle: {
          color: '#334155',
          width: 1.5,
          type: 'solid',
        },
      },
      yearLabel: { show: false },
      dayLabel: {
        firstDay: 1,
        nameMap: ['日', '一', '二', '三', '四', '五', '六'],
        color: '#64748b',
        fontSize: 10,
      },
      monthLabel: {
        nameMap: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'],
        color: '#94a3b8',
        fontSize: 11,
      },
    },
    series: {
      type: 'heatmap',
      coordinateSystem: 'calendar',
      data: seriesData,
    },
  };

  return (
    <div className="w-full h-56">
      <ReactECharts option={option} style={{ height: '100%', width: '100%' }} notMerge={true} />
    </div>
  );
};
