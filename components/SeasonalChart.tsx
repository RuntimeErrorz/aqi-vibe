'use client';

import React, { useMemo, useState, useEffect } from 'react';
import ReactECharts from 'echarts-for-react';
import { CalendarRange, Layers } from 'lucide-react';
import { MonthlySeasonalStat } from '@/lib/services/history-data';

interface SeasonalChartProps {
  monthlySelectedYear: MonthlySeasonalStat[];
  monthlyAllYears: MonthlySeasonalStat[];
  selectedYear: number;
  cityName: string;
  loading?: boolean;
}

export const SeasonalChart: React.FC<SeasonalChartProps> = ({
  monthlySelectedYear,
  monthlyAllYears,
  selectedYear,
  cityName,
  loading = false,
}) => {
  const [mounted, setMounted] = useState(false);
  const [scope, setScope] = useState<'year' | 'all'>('all');

  useEffect(() => {
    setMounted(true);
  }, []);

  const activeData = scope === 'year' ? monthlySelectedYear : monthlyAllYears;
  const hasAnyData = activeData.some((m) => m.pm25Avg !== null || m.o3Avg !== null);

  const option = useMemo(() => {
    const months = activeData.map((d) => d.label);
    const pm25s = activeData.map((d) => d.pm25Avg);
    const o3s = activeData.map((d) => d.o3Avg);
    const hasO3 = o3s.some((v) => v !== null && v > 0);

    const series: any[] = [
      {
        name: '月均 PM2.5 (μg/m³)',
        type: 'bar',
        data: pm25s,
        barMaxWidth: 28,
        itemStyle: {
          borderRadius: [4, 4, 0, 0],
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(2, 132, 199, 0.85)' },
              { offset: 1, color: 'rgba(2, 132, 199, 0.28)' },
            ],
          },
        },
      },
    ];

    if (hasO3) {
      series.push({
        name: '月均臭氧 O₃ (μg/m³)',
        type: 'line',
        smooth: true,
        data: o3s,
        itemStyle: { color: '#9333ea' },
        lineStyle: { width: 2.5 },
        symbolSize: 6,
      });
    }

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#ffffff',
        borderColor: '#e2e8f0',
        textStyle: { color: '#0f172a', fontSize: 12 },
      },
      legend: {
        top: 0,
        textStyle: { color: '#475569', fontSize: 11 },
      },
      grid: { left: 8, right: 12, bottom: 8, top: 38, containLabel: true },
      xAxis: {
        type: 'category',
        data: months,
        axisLine: { lineStyle: { color: '#cbd5e1' } },
        axisLabel: { color: '#475569', fontSize: 11 },
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: '#f1f5f9' } },
        axisLabel: { color: '#64748b', fontSize: 10 },
      },
      series,
    };
  }, [activeData]);

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <h3 className="text-sm sm:text-base font-bold text-slate-900 flex items-center space-x-2">
          <CalendarRange className="w-4 h-4 text-purple-600" />
          <span>{cityName} · 12 个月季节污染律动（秋冬季颗粒物 vs 夏季臭氧）</span>
        </h3>

        <div className="inline-flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200/80 text-xs self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setScope('all')}
            className={`px-2.5 py-1 rounded-md font-semibold transition-all cursor-pointer flex items-center space-x-1 ${
              scope === 'all' ? 'bg-white text-sky-700 shadow-2xs' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Layers className="w-3 h-3" />
            <span>历年同期均值</span>
          </button>
          <button
            type="button"
            onClick={() => setScope('year')}
            className={`px-2.5 py-1 rounded-md font-semibold transition-all cursor-pointer ${
              scope === 'year' ? 'bg-white text-sky-700 shadow-2xs' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            仅 {selectedYear} 年
          </button>
        </div>
      </div>

      {!mounted || (loading && !hasAnyData) ? (
        <div className="w-full h-64 sm:h-72 rounded-xl bg-slate-50/80 border border-slate-100 p-4 flex flex-col justify-between animate-pulse">
          <div className="flex justify-center gap-4">
            <div className="h-3 w-24 bg-slate-200 rounded" />
            <div className="h-3 w-24 bg-slate-100 rounded" />
          </div>
          <div className="flex items-end justify-between gap-2.5 flex-1 pt-6 pb-2 px-2">
            {[68, 56, 48, 42, 36, 32, 30, 34, 40, 52, 64, 74].map((h, i) => (
              <div key={i} className="flex-1 rounded-t-md bg-slate-200/75" style={{ height: `${h}%` }} />
            ))}
          </div>
          <div className="flex justify-between px-2">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => (
              <div key={m} className="h-2.5 w-4 bg-slate-200/70 rounded" />
            ))}
          </div>
        </div>
      ) : !hasAnyData ? (
        <div className="h-56 flex items-center justify-center text-slate-400 text-xs bg-slate-50/50 rounded-xl border border-dashed border-slate-200">
          暂无该时间范围的逐月实测归档
        </div>
      ) : (
        <div className="w-full h-64 sm:h-72">
          <ReactECharts option={option} style={{ height: '100%', width: '100%' }} notMerge={true} />
        </div>
      )}
    </div>
  );
};
