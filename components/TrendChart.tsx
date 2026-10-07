'use client';

import React, { useEffect, useState } from 'react';
import ReactECharts from 'echarts-for-react';

interface TrendChartProps {
  data: {
    hour: string;
    aqi: number;
    pm25: number;
    pm10?: number;
    o3: number;
    no2?: number;
    so2?: number;
    co?: number;
    iaqi?: {
      pm25?: number;
      pm10?: number;
      o3?: number;
      no2?: number;
      so2?: number;
      co?: number;
    };
    isReal?: boolean;
  }[];
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
  const pm10Vals = data.map((d) => d.pm10 ?? null);
  const o3Vals = data.map((d) => d.o3);
  const no2Vals = data.map((d) => d.no2 ?? null);
  const so2Vals = data.map((d) => d.so2 ?? null);
  const coVals = data.map((d) => d.co ?? null);

  const hasPm10 = data.some((d) => d.pm10 !== undefined && d.pm10 > 0);
  const hasNo2 = data.some((d) => d.no2 !== undefined && d.no2 > 0);
  const hasSo2 = data.some((d) => d.so2 !== undefined && d.so2 > 0);
  const hasCo = data.some((d) => d.co !== undefined && d.co > 0);

  const legendData = ['AQI 综合指数', 'PM2.5 (μg/m³)', '臭氧 O₃ (μg/m³)'];
  if (hasPm10) legendData.push('PM10 (μg/m³)');
  if (hasNo2) legendData.push('二氧化氮 NO₂ (μg/m³)');
  if (hasSo2) legendData.push('二氧化硫 SO₂ (μg/m³)');
  if (hasCo) legendData.push('一氧化碳 CO (mg/m³)');

  const selectedMap: Record<string, boolean> = {
    'AQI 综合指数': true,
    'PM2.5 (μg/m³)': true,
    'PM10 (μg/m³)': hasPm10,
    '臭氧 O₃ (μg/m³)': true,
    '二氧化氮 NO₂ (μg/m³)': false,
    '二氧化硫 SO₂ (μg/m³)': false,
    '一氧化碳 CO (mg/m³)': false,
  };

  const series: any[] = [
    {
      name: 'AQI 综合指数',
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
      name: 'PM10 (μg/m³)',
      type: 'line',
      smooth: true,
      data: pm10Vals,
      itemStyle: { color: '#0ea5e9' },
    },
    {
      name: '臭氧 O₃ (μg/m³)',
      type: 'line',
      smooth: true,
      data: o3Vals,
      itemStyle: { color: '#9333ea' },
    },
    {
      name: '二氧化氮 NO₂ (μg/m³)',
      type: 'line',
      smooth: true,
      data: no2Vals,
      itemStyle: { color: '#ec4899' },
    },
    {
      name: '二氧化硫 SO₂ (μg/m³)',
      type: 'line',
      smooth: true,
      data: so2Vals,
      itemStyle: { color: '#10b981' },
    },
    {
      name: '一氧化碳 CO (mg/m³)',
      type: 'line',
      smooth: true,
      data: coVals,
      itemStyle: { color: '#6366f1' },
    },
  ];

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
        const item = data[idx];

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

        // AQI 综合大行
        html += `<div style="display:flex; justify-content:space-between; gap:16px; font-size:12px; line-height:1.7; font-weight:bold; border-bottom:1px solid #f1f5f9; padding-bottom:4px; margin-bottom:4px;">
          <span style="color:#0284c7;">● AQI 综合指数:</span>
          <span style="color:#0f172a; font-size:13px;">${item.aqi}</span>
        </div>`;

        // 六大污染物实测物理浓度列表 (μg/m³ 与 mg/m³)，并附带分指数 IAQI
        const pols = [
          { name: 'PM2.5', val: item.pm25, unit: 'μg/m³', color: '#f59e0b', iaqi: item.iaqi?.pm25 },
          { name: 'PM10', val: item.pm10, unit: 'μg/m³', color: '#0ea5e9', iaqi: item.iaqi?.pm10 },
          { name: '臭氧 O₃', val: item.o3, unit: 'μg/m³', color: '#9333ea', iaqi: item.iaqi?.o3 },
          { name: '二氧化氮 NO₂', val: item.no2, unit: 'μg/m³', color: '#ec4899', iaqi: item.iaqi?.no2 },
          { name: '二氧化硫 SO₂', val: item.so2, unit: 'μg/m³', color: '#10b981', iaqi: item.iaqi?.so2 },
          { name: '一氧化碳 CO', val: item.co, unit: 'mg/m³', color: '#6366f1', iaqi: item.iaqi?.co },
        ];

        pols.forEach((p) => {
          if (p.val !== undefined && p.val > 0) {
            const iaqiStr = p.iaqi !== undefined ? `<span style="color:#94a3b8; font-size:10px; margin-left:4px;">(IAQI ${p.iaqi})</span>` : '';
            html += `<div style="display:flex; justify-content:space-between; gap:16px; font-size:12px; line-height:1.6;">
              <span style="color:${p.color};">● ${p.name}:</span>
              <span style="font-weight:600; color:#0f172a;">${p.val} ${p.unit} ${iaqiStr}</span>
            </div>`;
          }
        });

        return html;
      },
    },
    legend: {
      data: legendData,
      selected: selectedMap,
      top: 0,
      textStyle: { color: '#475569', fontSize: 11 },
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
    series,
  };

  return (
    <div className="w-full h-72">
      <ReactECharts option={option} style={{ height: '100%', width: '100%' }} notMerge={true} />
    </div>
  );
};
