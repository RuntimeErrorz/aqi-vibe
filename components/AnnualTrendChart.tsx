'use client';

import React, { useEffect, useMemo, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import { AnnualTrend, StandardType } from '@/lib/types';
import { calculatePM25AQI } from '@/lib/aqi-calculator';
import { escapeHtml } from '@/lib/utils/common';

interface AnnualTrendChartProps {
  data: AnnualTrend[];
  cityName: string;
  standard: StandardType;
  onlyPm25?: boolean;
}

export const AnnualTrendChart: React.FC<AnnualTrendChartProps> = ({ data, cityName, standard, onlyPm25 = false }) => {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const option = useMemo(() => {
    const years = data.map((d) => d.year.toString());
    const pm25s = data.map((d) => d.pm25Avg);
    const goodRatios = data.map((d) => d.goodDaysRatio);
    const pollutedDays = data.map((d) => d.pollutedDays ?? d.heavyPollutionDays);

    const ratioLabel = '优良天数比例 (%)';
    const pollutedLabel = '超标污染天数 (AQI>100, 天)';
    const aqiLabel = '年均 AQI';
    const aqiAvgs = data.map((d) =>
      onlyPm25
        ? d.pm25Avg > 0
          ? calculatePM25AQI(d.pm25Avg, standard, 'daily')
          : null
        : d.aqiAvg ?? null
    );

    return {
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
          const dataIndex = params[0].dataIndex;
          const cur = data[dataIndex];
          let html = `<div class="font-bold text-slate-900 border-b border-slate-100 pb-1 mb-1.5">${escapeHtml(cityName)} · ${cur.year} 年度</div>`;
          params.forEach((p: any) => {
            html += `<div class="flex items-center justify-between gap-4 py-0.5 text-xs">
              <span class="flex items-center gap-1.5">${p.marker} <span class="text-slate-600">${p.seriesName}</span></span>
              <span class="font-bold text-slate-900">${p.value}</span>
            </div>`;
          });
          if (cur.heavyPollutionDays !== undefined) {
            const subInfo = `其中重度污染: ${cur.heavyPollutionDays} 天`;
            html += `<div class="text-[11px] text-slate-500 mt-1.5 pt-1.5 border-t border-slate-100">${subInfo}</div>`;
          }
          return html;
        },
      },
      legend: {
        type: 'scroll',
        data: ['年均 PM2.5 (μg/m³)', aqiLabel, ratioLabel, pollutedLabel],
        top: 0,
        textStyle: { color: '#475569', fontSize: 11 },
        pageIconColor: '#0284c7',
        pageTextStyle: { color: '#64748b', fontSize: 10 },
      },
      grid: {
        left: 6,
        right: 6,
        bottom: 6,
        top: 40,
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: years,
        axisLine: { lineStyle: { color: '#cbd5e1' } },
        axisLabel: { color: '#475569', fontSize: 10, interval: 'auto' },
      },
      yAxis: [
        {
          type: 'value',
          splitLine: { lineStyle: { color: '#f1f5f9' } },
          axisLabel: { color: '#64748b', fontSize: 10 },
        },
        {
          type: 'value',
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
                { offset: 0, color: standard === 'CN' ? 'rgba(16, 185, 129, 0.85)' : 'rgba(2, 132, 199, 0.85)' },
                { offset: 1, color: standard === 'CN' ? 'rgba(16, 185, 129, 0.25)' : 'rgba(2, 132, 199, 0.25)' },
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
          lineStyle: { width: 2.5 },
        },
        {
          name: aqiLabel,
          type: 'line',
          smooth: true,
          data: aqiAvgs,
          itemStyle: { color: '#f59e0b' },
          lineStyle: { width: 2.5 },
        },
        {
          name: pollutedLabel,
          type: 'line',
          smooth: true,
          data: pollutedDays,
          itemStyle: { color: '#ef4444' },
          lineStyle: { width: 2.5 },
        },
      ],
    };
  }, [data, cityName, standard, onlyPm25]);

  if (!mounted) {
    return (
      <div className="w-full h-72 sm:h-80 rounded-xl bg-slate-50/70 border border-slate-100 p-4 flex flex-col justify-between animate-pulse">
        <div className="flex justify-center gap-4">
          <div className="h-3 w-20 bg-slate-200 rounded" />
          <div className="h-3 w-20 bg-slate-100 rounded" />
          <div className="h-3 w-20 bg-slate-100 rounded" />
        </div>
        <div className="flex items-end justify-between gap-3 flex-1 pt-6 pb-2 px-4">
          {[55, 62, 68, 74, 78, 82, 85, 88].map((h, i) => (
            <div key={i} className="flex-1 rounded-t-md bg-slate-200/70" style={{ height: `${h}%` }} />
          ))}
        </div>
        <div className="flex justify-between px-4">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <div key={i} className="h-2.5 w-7 bg-slate-200/70 rounded" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-72 sm:h-80">
      <ReactECharts option={option} style={{ height: '100%', width: '100%' }} notMerge={true} />
    </div>
  );
};
