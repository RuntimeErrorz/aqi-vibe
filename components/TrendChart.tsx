'use client';

import React, { useEffect, useState } from 'react';
import ReactECharts from 'echarts-for-react';

interface TrendChartProps {
  data: { hour: string; aqi: number; pm25: number; o3: number; isReal?: boolean }[];
  city: string;
  isReal?: boolean;
}

export const TrendChart: React.FC<TrendChartProps> = ({ data, city, isReal = true }) => {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || !data || data.length === 0) {
    return (
      <div className="h-64 flex flex-col items-center justify-center text-slate-400 text-sm space-y-2">
        <div className="w-5 h-5 border-2 border-sky-600 border-t-transparent rounded-full animate-spin"></div>
        <span>同步 24 小时逐小时时序数据中...</span>
      </div>
    );
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
      formatter: (params: any) => {
        if (!Array.isArray(params) || params.length === 0) return '';
        const idx = params[0].dataIndex;
        const isLatest = idx === hours.length - 1;
        const hourLabel = params[0].name;
        let html = `<div style="font-weight: bold; margin-bottom: 6px; display:flex; align-items:center; justify-content:space-between; gap:8px;">
          <span>${hourLabel}</span>
          ${
            isLatest
              ? '<span style="color:#0284c7; font-size:11px; background:#f0f9ff; padding:1px 6px; border-radius:4px; border:1px solid #bae6fd;">当前最新实测</span>'
              : isReal
              ? '<span style="color:#059669; font-size:10px; background:#ecfdf5; padding:1px 5px; border-radius:3px; border:1px solid #a7f3d0;">高频真实实测</span>'
              : '<span style="color:#64748b; font-size:10px; background:#f1f5f9; padding:1px 5px; border-radius:3px;">日内规律反推</span>'
          }
        </div>`;
        params.forEach((p: any) => {
          html += `<div style="display:flex; justify-content:space-between; gap:16px; font-size:12px; line-height:1.7;">
            <span style="color:#64748b;">${p.marker} ${p.seriesName}:</span>
            <span style="font-weight:bold; color:#0f172a;">${p.value}</span>
          </div>`;
        });
        return html;
      },
    },
    legend: {
      data: ['AQI 指数', 'PM2.5', '臭氧 O₃'],
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
        name: 'PM2.5',
        type: 'line',
        smooth: true,
        data: pm25Vals,
        itemStyle: { color: '#f59e0b' },
      },
      {
        name: '臭氧 O₃',
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
