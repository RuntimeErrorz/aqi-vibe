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
    return <div className="h-64 flex items-center justify-center text-slate-500 text-sm">加载雷达图中...</div>;
  }

  const seriesData = cities.map((c) => ({
    name: c.name,
    value: [c.pm25, c.pm10, c.o3, c.no2, c.so2, c.co * 10], // CO * 10 适应坐标比例
    itemStyle: { color: c.color },
    lineStyle: { width: 2 },
    areaStyle: {
      color: c.color + '25',
    },
  }));

  const option = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item',
      backgroundColor: '#0f172a',
      borderColor: '#334155',
      textStyle: { color: '#f8fafc', fontSize: 12 },
    },
    legend: {
      data: cities.map((c) => c.name),
      top: 0,
      textStyle: { color: '#94a3b8', fontSize: 11 },
    },
    radar: {
      indicator: [
        { name: 'PM2.5 (细颗粒物)', max: 120 },
        { name: 'PM10 (可吸入颗粒)', max: 180 },
        { name: '臭氧 O₃', max: 150 },
        { name: '二氧化氮 NO₂', max: 80 },
        { name: '二氧化硫 SO₂', max: 50 },
        { name: '一氧化碳 CO (×10)', max: 50 },
      ],
      shape: 'polygon',
      splitNumber: 4,
      axisName: {
        color: '#94a3b8',
        fontSize: 11,
      },
      splitLine: {
        lineStyle: {
          color: 'rgba(255, 255, 255, 0.08)',
        },
      },
      splitArea: {
        show: false,
      },
      axisLine: {
        lineStyle: {
          color: 'rgba(255, 255, 255, 0.1)',
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
    <div className="w-full h-80">
      <ReactECharts option={option} style={{ height: '100%', width: '100%' }} notMerge={true} />
    </div>
  );
};
