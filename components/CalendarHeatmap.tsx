'use client';

import React, { useEffect, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import { StandardType } from '@/lib/types';

interface CalendarHeatmapProps {
  data: [string, number, string, number, string][]; // [date, aqi, level, pm25, color]
  year: number;
  standard: StandardType;
}

export const CalendarHeatmap: React.FC<CalendarHeatmapProps> = ({ data, year, standard }) => {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className="h-56 flex items-center justify-center text-slate-400 text-sm">加载日历热力图中...</div>;
  }

  // 格式化为 ECharts calendar 系列数据: [date, aqi]
  const seriesData = data.map(([date, aqi]) => [date, aqi]);

  const option = {
    backgroundColor: 'transparent',
    tooltip: {
      position: 'top',
      backgroundColor: '#ffffff',
      borderColor: '#e2e8f0',
      shadowBlur: 10,
      shadowColor: 'rgba(0,0,0,0.08)',
      textStyle: { color: '#0f172a', fontSize: 12 },
      formatter: (p: any) => {
        const item = data.find((d) => d[0] === p.value[0]);
        if (!item) return '';
        const stdLabel = standard === 'CN' ? '国标 HJ 633' : '美标 US EPA';
        return `
          <div style="font-size: 12px; line-height: 1.6; padding: 2px 4px;">
            <div style="font-weight: bold; color: #1e293b; margin-bottom: 2px;">${item[0]}</div>
            <div>AQI 指数 (${stdLabel}): <span style="font-weight: bold; color: ${item[4]}">${item[1]}</span></div>
            <div>质量等级: <span style="font-weight: 600; color: ${item[4]}">${item[2]}</span></div>
            <div>PM2.5 实测浓度: <b>${item[3]} μg/m³</b></div>
          </div>
        `;
      },
    },
    visualMap: {
      min: 0,
      max: standard === 'CN' ? 250 : 300,
      calculable: true,
      orient: 'horizontal',
      left: 'center',
      bottom: '0%',
      textStyle: { color: '#64748b', fontSize: 11 },
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
        color: '#f8fafc',
        borderWidth: 1.5,
        borderColor: '#ffffff',
      },
      splitLine: {
        show: true,
        lineStyle: {
          color: '#e2e8f0',
          width: 2,
          type: 'solid',
        },
      },
      yearLabel: { show: false },
      dayLabel: {
        firstDay: 1,
        nameMap: ['日', '一', '二', '三', '四', '五', '六'],
        color: '#94a3b8',
        fontSize: 10,
      },
      monthLabel: {
        nameMap: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'],
        color: '#475569',
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
