'use client';

import React, { useEffect, useState } from 'react';
import ReactECharts from 'echarts-for-react';

interface CompareRadarChartProps {
  cities: { name: string; pm25: number; pm10: number; o3: number; no2: number; so2: number; co: number; color: string }[];
}

export const CompareRadarChart: React.FC<CompareRadarChartProps> = ({ cities }) => {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className="h-64 flex items-center justify-center text-slate-400 text-sm">加载雷达图中...</div>;
  }

  // 1. 动态自适应计算各维度上限（基于当前已选全部城市实测数据，预留约 25% 视觉呼吸空间）
  const maxPM25Val = Math.max(...cities.map((c) => c.pm25 || 0), 10);
  const maxPM10Val = Math.max(...cities.map((c) => c.pm10 || 0), 15);
  const maxO3Val = Math.max(...cities.map((c) => c.o3 || 0), 20);
  const maxNO2Val = Math.max(...cities.map((c) => c.no2 || 0), 10);
  const maxSO2Val = Math.max(...cities.map((c) => c.so2 || 0), 5);
  const maxCOVal = Math.max(...cities.map((c) => Number(c.co || 0) * 10), 5);

  const getNiceMax = (val: number, minFloor: number): number => {
    const raw = Math.max(val * 1.25, minFloor);
    if (raw <= 15) return Math.ceil(raw / 2) * 2;
    if (raw <= 50) return Math.ceil(raw / 5) * 5;
    if (raw <= 120) return Math.ceil(raw / 10) * 10;
    return Math.ceil(raw / 20) * 20;
  };

  const maxPM25 = getNiceMax(maxPM25Val, 20);
  const maxPM10 = getNiceMax(maxPM10Val, 30);
  const maxO3 = getNiceMax(maxO3Val, 40);
  const maxNO2 = getNiceMax(maxNO2Val, 20);
  const maxSO2 = getNiceMax(maxSO2Val, 10);
  const maxCO = getNiceMax(maxCOVal, 10);

  const seriesData = cities.map((c) => ({
    name: c.name,
    value: [c.pm25, c.pm10, c.o3, c.no2, c.so2, Number((c.co * 10).toFixed(1))],
    itemStyle: { color: c.color },
    lineStyle: { width: 2.5 },
    areaStyle: {
      color: c.color + '25',
    },
  }));

  const option = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item',
      backgroundColor: 'rgba(255, 255, 255, 0.98)',
      borderColor: '#e2e8f0',
      borderRadius: 12,
      padding: [10, 14],
      shadowBlur: 12,
      shadowColor: 'rgba(0,0,0,0.08)',
      textStyle: { color: '#0f172a', fontSize: 12 },
      formatter: (params: any) => {
        const val = params.value;
        const color = params.color;
        const name = params.name;
        return `
          <div style="font-weight: 700; margin-bottom: 6px; display: flex; align-items: center; gap: 6px;">
            <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background-color:${color};"></span>
            <span>${name} · 实测污染物构成</span>
          </div>
          <div style="font-size: 11px; line-height: 1.7; color: #475569;">
            <div>PM2.5: <b style="color: #0f172a;">${val[0]} μg/m³</b> <span style="color: #94a3b8;">(上限 ${maxPM25})</span></div>
            <div>PM10: <b style="color: #0f172a;">${val[1]} μg/m³</b> <span style="color: #94a3b8;">(上限 ${maxPM10})</span></div>
            <div>臭氧 O₃: <b style="color: #0f172a;">${val[2]} μg/m³</b> <span style="color: #94a3b8;">(上限 ${maxO3})</span></div>
            <div>二氧化氮 NO₂: <b style="color: #0f172a;">${val[3]} μg/m³</b> <span style="color: #94a3b8;">(上限 ${maxNO2})</span></div>
            <div>二氧化硫 SO₂: <b style="color: #0f172a;">${val[4]} μg/m³</b> <span style="color: #94a3b8;">(上限 ${maxSO2})</span></div>
            <div>一氧化碳 CO: <b style="color: #0f172a;">${(val[5] / 10).toFixed(1)} mg/m³</b> <span style="color: #94a3b8;">(上限 ${(maxCO / 10).toFixed(1)})</span></div>
          </div>
        `;
      },
    },
    legend: {
      type: 'scroll',
      data: cities.map((c) => c.name),
      top: 4,
      textStyle: { color: '#475569', fontSize: 11 },
      pageIconColor: '#7c3aed',
      pageTextStyle: { color: '#64748b', fontSize: 10 },
    },
    radar: {
      center: ['50%', '57%'],
      radius: '50%',
      indicator: [
        { name: 'PM2.5 (细颗粒物)', max: maxPM25 },
        { name: 'PM10 (可吸入颗粒)', max: maxPM10 },
        { name: '臭氧 O₃', max: maxO3 },
        { name: '二氧化氮 NO₂', max: maxNO2 },
        { name: '二氧化硫 SO₂', max: maxSO2 },
        { name: '一氧化碳 CO (×10)', max: maxCO },
      ],
      shape: 'polygon',
      splitNumber: 4,
      axisName: {
        color: '#475569',
        fontSize: 10.5,
        fontWeight: 'bold',
        padding: [2, 3],
      },
      splitLine: {
        lineStyle: {
          color: '#e2e8f0',
        },
      },
      splitArea: {
        show: true,
        areaStyle: {
          color: ['#ffffff', '#f8fafc'],
        },
      },
      axisLine: {
        lineStyle: {
          color: '#cbd5e1',
        },
      },
    },
    series: [
      {
        name: '污染物特征构成',
        type: 'radar',
        data: seriesData,
      },
    ],
  };

  return (
    <div className="w-full h-80 sm:h-96 md:h-[420px]">
      <ReactECharts option={option} style={{ height: '100%', width: '100%' }} notMerge={true} />
    </div>
  );
};
