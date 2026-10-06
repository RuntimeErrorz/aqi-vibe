'use client';

import React, { useEffect, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import { AnnualTrend } from '@/lib/types';

interface AnnualTrendChartProps {
  data: AnnualTrend[];
  cityName: string;
}

export const AnnualTrendChart: React.FC<AnnualTrendChartProps> = ({ data, cityName }) => {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className="h-64 flex items-center justify-center text-slate-500 text-sm">加载趋势图表中...</div>;
  }

  const years = data.map((d) => d.year.toString());
  const pm25s = data.map((d) => d.pm25Avg);
  const goodRatios = data.map((d) => d.goodDaysRatio);
  const heavyDays = data.map((d) => d.heavyPollutionDays);

  const option = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#0f172a',
      borderColor: '#334155',
      textStyle: { color: '#f8fafc', fontSize: 12 },
    },
    legend: {
      data: ['年均 PM2.5 (μg/m³)', '优良天数比例 (%)', '重度污染天数 (天)'],
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
    yAxis: [
      {
        type: 'value',
        name: 'PM2.5 / 重污染天',
        splitLine: { lineStyle: { color: 'rgba(255, 255, 255, 0.05)' } },
        axisLabel: { color: '#64748b', fontSize: 10 },
      },
      {
        type: 'value',
        name: '优良率 (%)',
        min: 0,
        max: 100,
        splitLine: { show: false },
        axisLabel: { color: '#64748b', fontSize: 10 },
      },
    ],
    series: [
      {
        name: '优良天数比例 (%)',
        type: 'bar',
        yAxisIndex: 1,
        data: goodRatios,
        itemStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(16, 185, 129, 0.7)' },
              { offset: 1, color: 'rgba(16, 185, 129, 0.15)' },
            ],
          },
          borderRadius: [4, 4, 0, 0],
        },
      },
      {
        name: '年均 PM2.5 (μg/m³)',
        type: 'line',
        smooth: true,
        data: pm25s,
        itemStyle: { color: '#38bdf8' },
        lineStyle: { width: 3 },
      },
      {
        name: '重度污染天数 (天)',
        type: 'line',
        smooth: true,
        data: heavyDays,
        itemStyle: { color: '#ef4444' },
        lineStyle: { type: 'dashed', width: 2 },
      },
    ],
  };

  return (
    <div className="w-full h-80">
      <ReactECharts option={option} style={{ height: '100%', width: '100%' }} notMerge={true} />
    </div>
  );
};
