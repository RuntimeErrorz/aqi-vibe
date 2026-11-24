'use client';

import React, { useEffect, useState } from 'react';
import ReactECharts from 'echarts-for-react';

export interface RadarCityMetric {
  name: string;
  pm25: number | null;
  pm10: number | null;
  o3: number | null;
  no2: number | null;
  so2: number | null;
  co: number | null;
  color: string;
  hasAnyData?: boolean;
}

interface CompareRadarChartProps {
  cities: RadarCityMetric[];
  loading?: boolean;
}

export const CompareRadarChart: React.FC<CompareRadarChartProps> = ({ cities, loading = false }) => {
  const [mounted, setMounted] = useState(false);
  const [isCompact, setIsCompact] = useState(false);

  useEffect(() => {
    setMounted(true);
    const updateSize = () => setIsCompact(window.innerWidth < 560);
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  if (!mounted || loading) {
    return (
      <div className="w-full h-80 sm:h-[360px] rounded-xl bg-slate-50/70 border border-slate-100 p-4 flex flex-col items-center justify-center gap-4 animate-pulse">
        <div className="flex items-center gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-3 w-12 bg-slate-200 rounded" />
          ))}
        </div>
        <div className="w-48 h-48 rounded-full border-2 border-dashed border-slate-200 flex items-center justify-center">
          <div className="w-32 h-32 rounded-full border border-slate-200/80 flex items-center justify-center">
            <div className="w-16 h-16 rounded-full bg-slate-200/60" />
          </div>
        </div>
      </div>
    );
  }

  const measuredCities = cities.filter(
    (c) =>
      c.pm25 !== null ||
      c.pm10 !== null ||
      c.o3 !== null ||
      c.no2 !== null ||
      c.so2 !== null ||
      c.co !== null
  );

  if (measuredCities.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-slate-400 text-xs bg-slate-50/50 rounded-xl border border-dashed border-slate-200">
        当前所选城市在该年份暂无六项污染物实测归档（严格遵循无数据如实报告原则，不进行系数估算）
      </div>
    );
  }

  // 动态自适应计算各维度上限（仅基于真实实测数据）
  const maxPM25Val = Math.max(...measuredCities.map((c) => c.pm25 ?? 0), 10);
  const maxPM10Val = Math.max(...measuredCities.map((c) => c.pm10 ?? 0), 15);
  const maxO3Val = Math.max(...measuredCities.map((c) => c.o3 ?? 0), 20);
  const maxNO2Val = Math.max(...measuredCities.map((c) => c.no2 ?? 0), 10);
  const maxSO2Val = Math.max(...measuredCities.map((c) => c.so2 ?? 0), 5);
  const maxCOVal = Math.max(...measuredCities.map((c) => (c.co !== null ? c.co * 10 : 0)), 5);

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

  const cityByName = new Map(measuredCities.map((c) => [c.name, c]));

  const seriesData = measuredCities.map((c) => ({
    name: c.name,
    value: [
      c.pm25 ?? 0,
      c.pm10 ?? 0,
      c.o3 ?? 0,
      c.no2 ?? 0,
      c.so2 ?? 0,
      c.co !== null ? Number((c.co * 10).toFixed(1)) : 0,
    ],
    itemStyle: { color: c.color },
    lineStyle: { width: 2.5 },
    areaStyle: {
      color: c.color + '25',
    },
  }));

  const fmtVal = (v: number | null, unit: string) =>
    v !== null && v > 0
      ? `<b style="color: #0f172a;">${v} ${unit}</b>`
      : `<span style="color: #94a3b8; font-style: italic;">暂无实测</span>`;

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
        const color = params.color;
        const name = params.name;
        const city = cityByName.get(name);
        if (!city) return '';
        return `
          <div style="font-weight: 700; margin-bottom: 6px; display: flex; align-items: center; gap: 6px;">
            <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background-color:${color};"></span>
            <span>${name} · 实测污染物构成</span>
          </div>
          <div style="font-size: 11px; line-height: 1.7; color: #475569;">
            <div>PM2.5: ${fmtVal(city.pm25, 'μg/m³')} <span style="color: #94a3b8;">(刻度上限 ${maxPM25})</span></div>
            <div>PM10: ${fmtVal(city.pm10, 'μg/m³')} <span style="color: #94a3b8;">(刻度上限 ${maxPM10})</span></div>
            <div>臭氧 O₃: ${fmtVal(city.o3, 'μg/m³')} <span style="color: #94a3b8;">(刻度上限 ${maxO3})</span></div>
            <div>二氧化氮 NO₂: ${fmtVal(city.no2, 'μg/m³')} <span style="color: #94a3b8;">(刻度上限 ${maxNO2})</span></div>
            <div>二氧化硫 SO₂: ${fmtVal(city.so2, 'μg/m³')} <span style="color: #94a3b8;">(刻度上限 ${maxSO2})</span></div>
            <div>一氧化碳 CO: ${fmtVal(city.co, 'mg/m³')} <span style="color: #94a3b8;">(刻度上限 ${(maxCO / 10).toFixed(1)})</span></div>
          </div>
        `;
      },
    },
    legend: {
      type: 'scroll',
      data: measuredCities.map((c) => c.name),
      top: 4,
      textStyle: { color: '#475569', fontSize: 11 },
      pageIconColor: '#7c3aed',
      pageTextStyle: { color: '#64748b', fontSize: 10 },
    },
    radar: {
      center: ['50%', '56%'],
      radius: isCompact ? '52%' : '56%',
      indicator: [
        { name: 'PM2.5', max: maxPM25 },
        { name: 'PM10', max: maxPM10 },
        { name: '臭氧 O₃', max: maxO3 },
        { name: 'NO₂', max: maxNO2 },
        { name: 'SO₂', max: maxSO2 },
        { name: 'CO×10', max: maxCO },
      ],
      shape: 'polygon',
      splitNumber: 4,
      axisNameGap: 10,
      axisName: {
        color: '#475569',
        fontSize: 11,
        fontWeight: 'bold',
        padding: [2, 3],
      },
      splitLine: { lineStyle: { color: '#e2e8f0' } },
      splitArea: { show: true, areaStyle: { color: ['#ffffff', '#f8fafc'] } },
      axisLine: { lineStyle: { color: '#cbd5e1' } },
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
    <div className="w-full h-80 sm:h-[360px]">
      <ReactECharts option={option} style={{ height: '100%', width: '100%' }} notMerge={true} />
    </div>
  );
};
