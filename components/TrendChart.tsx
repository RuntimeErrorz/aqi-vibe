'use client';

import React, { useEffect, useState } from 'react';
import ReactECharts from 'echarts-for-react';

interface TrendChartProps {
  data: { hour: string; aqi: number; pm25: number; o3: number }[];
  city: string;
}

export const TrendChart: React.FC<TrendChartProps> = ({ data, city }) => {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className="h-64 flex items-center justify-center text-slate-500 text-sm">加载图表中...</div>;
  }

  const hours = data.map((d) => d.hour);
  const aqiVals = data.map((d) => d.aqi);
  const pm25Vals = data.map((d) => d.pm25);
  const o3Vals = data.map((d) => d.o3);

  const option = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#0f172a',
      borderColor: '#334155',
      textStyle: { color: '#f8fafc', fontSize: 12 },
    },
    legend: {
      data: ['AQI 指数', 'PM2.5 (μg/m³)', '臭氧 O₃ (μg/m³)'],
      top: 0,
      textStyle: { color: '#94a3b8', fontSize: 11 },
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '5%',
      top: '18%',
      containLabel: true,
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: hours,
      axisLine: { lineStyle: { color: '#334155' } },
      axisLabel: { color: '#64748b', fontSize: 10 },
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: 'rgba(255, 255, 255, 0.05)' } },
      axisLabel: { color: '#64748b', fontSize: 10 },
    },
    series: [
      {
        name: 'AQI 指数',
        type: 'line',
        smooth: true,
        data: aqiVals,
        itemStyle: { color: '#38bdf8' },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(56, 189, 248, 0.35)' },
              { offset: 1, color: 'rgba(56, 189, 248, 0.00)' },
            ],
          },
        },
      },
      {
        name: 'PM2.5 (μg/m³)',
        type: 'line',
        smooth: true,
        data: pm25Vals,
        itemStyle: { color: '#f59e0b' },
      },
      {
        name: '臭氧 O₃ (μg/m³)',
        type: 'line',
        smooth: true,
        data: o3Vals,
        itemStyle: { color: '#a855f7' },
      },
    ],
  };

  return (
    <div className="w-full h-72">
      <ReactECharts option={option} style={{ height: '100%', width: '100%' }} notMerge={true} />
    </div>
  );
};
