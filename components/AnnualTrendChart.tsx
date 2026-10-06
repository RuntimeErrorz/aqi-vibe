'use client';

import React, { useEffect, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import { AnnualTrend, StandardType } from '@/lib/types';

interface AnnualTrendChartProps {
  data: AnnualTrend[];
  cityName: string;
  standard: StandardType;
}

export const AnnualTrendChart: React.FC<AnnualTrendChartProps> = ({ data, cityName, standard }) => {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className="h-80 flex items-center justify-center text-slate-400 text-sm">加载趋势图表中...</div>;
  }

  const years = data.map((d) => d.year.toString());
  const pm25s = data.map((d) => d.pm25Avg);
  const goodRatios = data.map((d) => d.goodDaysRatio);
  const heavyDays = data.map((d) => d.heavyPollutionDays);

  const ratioLabel = standard === 'CN' ? '国标优良天数比例 (%)' : '美标达标天数比例 (%)';

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
      data: ['年均 PM2.5 (μg/m³)', ratioLabel, '重度污染天数 (天)'],
      top: 0,
      textStyle: { color: '#475569', fontSize: 12 },
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '5%',
      top: '16%',
      containLabel: true,
    },
    xAxis: {
      type: 'category',
      data: years,
      axisLine: { lineStyle: { color: '#cbd5e1' } },
      axisLabel: { color: '#475569', fontSize: 11 },
    },
    yAxis: [
      {
        type: 'value',
        name: 'PM2.5 / 重污染天',
        splitLine: { lineStyle: { color: '#f1f5f9' } },
        axisLabel: { color: '#64748b', fontSize: 10 },
      },
      {
        type: 'value',
        name: '达标率 (%)',
        min: 0,
        max: 100,
        splitLine: { show: false },
        axisLabel: { color: '#64748b', fontSize: 10 },
      },
    ],
    series: [
      {
        name: ratioLabel,
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
              { offset: 0, color: 'rgba(16, 185, 129, 0.85)' },
              { offset: 1, color: 'rgba(16, 185, 129, 0.25)' },
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
        itemStyle: { color: '#0284c7' },
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
