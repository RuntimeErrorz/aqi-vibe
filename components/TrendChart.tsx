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
    return <div className="h-64 flex items-center justify-center text-slate-400 text-sm">加载图表中...</div>;
  }

  const hours = data.map((d) => d.hour);
  const aqiVals = data.map((d) => d.aqi);
  const pm25Vals = data.map((d) => d.pm25);
  const o3Vals = data.map((d) => d.o3);

  const option = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#ffffff',
      borderColor: '#e2e8f0',
      shadowBlur: 10,
      shadowColor: 'rgba(0,0,0,0.08)',
      textStyle: { color: '#0f172a', fontSize: 12 },
    },
    legend: {
      data: ['AQI 指数', 'PM2.5 (μg/m³)', '臭氧 O₃ (μg/m³)'],
      top: 0,
      textStyle: { color: '#475569', fontSize: 12 },
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
      axisLine: { lineStyle: { color: '#cbd5e1' } },
      axisLabel: { color: '#64748b', fontSize: 11 },
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: '#f1f5f9' } },
      axisLabel: { color: '#64748b', fontSize: 10 },
    },
    series: [
      {
        name: 'AQI 指数',
        type: 'line',
        smooth: true,
        data: aqiVals,
        itemStyle: { color: '#0284c7' },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(2, 132, 199, 0.25)' },
              { offset: 1, color: 'rgba(2, 132, 199, 0.00)' },
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
        itemStyle: { color: '#9333ea' },
      },
    ],
  };

  return (
    <div className="w-full h-72">
      <ReactECharts option={option} style={{ height: '100%', width: '100%' }} notMerge={true} />
    </div>
  );
};
