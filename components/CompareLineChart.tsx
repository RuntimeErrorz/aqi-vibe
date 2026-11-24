'use client';

import React, { useEffect, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import { getAnnualTrends, isHistorySummaryLoaded, loadHistorySummary } from '@/lib/services/history-data';
import { useStandard } from './StandardContext';

interface CompareLineChartProps {
  cities: { id: string; name: string; color: string }[];
}

export const CompareLineChart: React.FC<CompareLineChartProps> = ({ cities }) => {
  const { standard } = useStandard();
  const [mounted, setMounted] = useState(false);
  const [summaryReady, setSummaryReady] = useState(() => isHistorySummaryLoaded());

  useEffect(() => {
    setMounted(true);
    if (!isHistorySummaryLoaded()) {
      loadHistorySummary().then(() => setSummaryReady(true));
    }
  }, []);

  if (!mounted || !summaryReady) {
    return (
      <div className="w-full h-80 sm:h-[360px] rounded-xl bg-slate-50/70 border border-slate-100 p-4 flex flex-col justify-between animate-pulse">
        <div className="flex justify-center gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-3 w-12 bg-slate-200 rounded" />
          ))}
        </div>
        <div className="flex-1 flex flex-col justify-around py-4">
          <div className="h-px w-full bg-slate-200/70" />
          <div className="h-px w-full bg-slate-200/70" />
          <div className="h-px w-full bg-slate-200/70" />
          <div className="h-px w-full bg-slate-200/70" />
        </div>
        <div className="flex justify-between px-2">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-2.5 w-8 bg-slate-200/70 rounded" />
          ))}
        </div>
      </div>
    );
  }

  // 收集所选对比城市中实际存在的全部年份并升序排列
  const allYears = Array.from(
    new Set(cities.flatMap((c) => getAnnualTrends(c.id, standard).map((t) => t.year)))
  ).sort((a, b) => a - b);
  const years = (allYears.length > 0 ? allYears : [2019, 2020, 2021, 2022, 2023, 2024, 2025]).map(String);

  const series = cities.map((c) => {
    const trends = getAnnualTrends(c.id, standard);
    const trendMap = new Map(trends.map((t) => [t.year, t.pm25Avg]));
    return {
      name: c.name,
      type: 'line',
      smooth: true,
      connectNulls: true,
      data: years.map((y) => trendMap.get(Number(y)) ?? null),
      itemStyle: { color: c.color },
      lineStyle: { width: 3 },
    };
  });

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
      type: 'scroll',
      data: cities.map((c) => c.name),
      top: 0,
      textStyle: { color: '#475569', fontSize: 11 },
      pageIconColor: '#0284c7',
      pageTextStyle: { color: '#64748b', fontSize: 10 },
    },
    grid: {
      left: 6,
      right: 8,
      bottom: 6,
      top: 38,
      containLabel: true,
    },
    xAxis: {
      type: 'category',
      data: years,
      axisLine: { lineStyle: { color: '#cbd5e1' } },
      axisLabel: { color: '#64748b', fontSize: 10, interval: 'auto' },
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: '#f1f5f9' } },
      axisLabel: { color: '#64748b', fontSize: 10 },
    },
    series,
  };

  return (
    <div className="w-full h-80 sm:h-[360px]">
      <ReactECharts option={option} style={{ height: '100%', width: '100%' }} notMerge={true} />
    </div>
  );
};
