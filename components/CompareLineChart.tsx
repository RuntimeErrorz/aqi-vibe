'use client';

import React, { useEffect, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import { getAnnualTrends } from '@/lib/services/history-data';

interface CompareLineChartProps {
  cities: { id: string; name: string; color: string }[];
}

export const CompareLineChart: React.FC<CompareLineChartProps> = ({ cities }) => {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className="h-64 flex items-center justify-center text-slate-500 text-sm">加载对比折线图中...</div>;
  }

  const years = [2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025].map(String);

  const series = cities.map((c) => {
    const trends = getAnnualTrends(c.id);
    return {
      name: c.name,
      type: 'line',
      smooth: true,
      data: trends.map((t) => t.pm25Avg),
      itemStyle: { color: c.color },
      lineStyle: { width: 3 },
    };
  });

  const option = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#0f172a',
      borderColor: '#334155',
      textStyle: { color: '#f8fafc', fontSize: 12 },
    },
    legend: {
      data: cities.map((c) => c.name),
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
      data: years,
      axisLine: { lineStyle: { color: '#334155' } },
      axisLabel: { color: '#94a3b8', fontSize: 11 },
    },
    yAxis: {
      type: 'value',
      name: '年均 PM2.5 (μg/m³)',
      splitLine: { lineStyle: { color: 'rgba(255, 255, 255, 0.05)' } },
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
