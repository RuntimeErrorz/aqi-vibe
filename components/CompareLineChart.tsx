'use client';

import React, { useEffect, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import { getAnnualTrends } from '@/lib/services/history-data';
import { useStandard } from './StandardContext';

interface CompareLineChartProps {
  cities: { id: string; name: string; color: string }[];
}

export const CompareLineChart: React.FC<CompareLineChartProps> = ({ cities }) => {
  const { standard } = useStandard();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className="h-64 flex items-center justify-center text-slate-400 text-sm">加载对比折线图中...</div>;
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
      data: cities.map((c) => c.name),
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
      data: years,
      axisLine: { lineStyle: { color: '#cbd5e1' } },
      axisLabel: { color: '#64748b', fontSize: 11 },
    },
    yAxis: {
      type: 'value',
      name: '年均 PM2.5 (μg/m³)',
      splitLine: { lineStyle: { color: '#f1f5f9' } },
      axisLabel: { color: '#64748b', fontSize: 10 },
    },
    series,
  };

  return (
    <div className="w-full h-80">
      <ReactECharts option={option} style={{ height: '100%', width: '100%' }} notMerge={true} />
    </div>
  );
};
