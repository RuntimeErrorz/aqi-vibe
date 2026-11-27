'use client';

import React, { useEffect, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import { Activity } from 'lucide-react';
import { HourlyTrendPoint } from '@/lib/services/realtime-trend';
import { useStandard } from './StandardContext';
import { calculatePM25AQI } from '@/lib/aqi-calculator';
import {
  formatBrowserLocalChartTime,
  parseUtcOffsetLabelMinutes,
} from '@/lib/datasources/freshness';

interface TrendChartProps {
  data: HourlyTrendPoint[];
  city: string;
  isReal?: boolean;
  loading?: boolean;
  timezoneOffset?: string;
}

const DEFAULT_SELECTED_MAP: Record<string, boolean> = {
  'AQI 综合指数': true,
  'PM2.5 (μg/m³)': true,
  '臭氧 O₃ (μg/m³)': false,
  'PM10 (μg/m³)': false,
  '二氧化氮 NO₂ (μg/m³)': false,
  '二氧化硫 SO₂ (μg/m³)': false,
  '一氧化碳 CO (mg/m³)': false,
};

export const TrendChart: React.FC<TrendChartProps> = ({
  data,
  isReal = true,
  loading = false,
  timezoneOffset,
}) => {
  const { standard, onlyPm25 } = useStandard();
  const [mounted, setMounted] = useState(false);
  const [selectedHours, setSelectedHours] = useState<number>(24);
  const [selectedMap, setSelectedMap] = useState<Record<string, boolean>>(DEFAULT_SELECTED_MAP);

  useEffect(() => {
    setMounted(true);
    try {
      const savedHours = localStorage.getItem('aqi_trend_hours_selected');
      if (savedHours) {
        const num = parseInt(savedHours, 10);
        if ([24, 48, 72].includes(num)) {
          setSelectedHours(num);
        }
      }
    } catch {}

    try {
      const saved = localStorage.getItem('aqi_trend_legend_selected_v3');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') {
          setSelectedMap((prev) => ({ ...prev, ...parsed }));
        }
      }
    } catch {
      // 忽略存储读取异常
    }
  }, []);

  const handleRangeChange = (h: number) => {
    setSelectedHours(h);
    try {
      localStorage.setItem('aqi_trend_hours_selected', String(h));
    } catch {}
  };

  if (!mounted || loading) {
    return (
      <div className="w-full space-y-3 animate-pulse">
        <div className="flex items-center justify-between pt-0.5">
          <div className="flex items-center gap-2">
            <div className="h-4 w-20 bg-slate-200/80 rounded" />
            <div className="h-4 w-20 bg-slate-100 rounded" />
            <div className="h-4 w-16 bg-slate-100 rounded hidden sm:block" />
          </div>
          <div className="h-6 w-36 bg-slate-100 rounded-lg" />
        </div>
        <div className="w-full h-64 sm:h-72 rounded-xl bg-slate-50/80 border border-slate-100 p-4 flex flex-col justify-between">
          <div className="space-y-4">
            <div className="h-px w-full bg-slate-200/60" />
            <div className="h-px w-full bg-slate-200/60" />
            <div className="h-px w-full bg-slate-200/60" />
          </div>
          <div className="flex items-end justify-between gap-2 h-32 px-2">
            {[42, 58, 65, 50, 74, 82, 68, 55, 48, 60, 72, 64].map((h, i) => (
              <div
                key={i}
                className="flex-1 rounded-t-md bg-slate-200/70"
                style={{ height: `${h}%` }}
              />
            ))}
          </div>
          <div className="flex items-center justify-between pt-2">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-2.5 w-8 bg-slate-200/70 rounded" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="h-64 flex flex-col items-center justify-center text-slate-400 text-xs space-y-2 bg-slate-50/50 rounded-xl border border-dashed border-slate-200">
        <Activity className="w-6 h-6 text-slate-300" />
        <span>该监测点暂未发布逐小时历史时序，已在上表完整呈现当前最新实测物理值</span>
      </div>
    );
  }

  // 根据当前选择的时间跨度截取实测数据，并将所有时间点统一换算为当前浏览器本地时区
  const fallbackSourceOffsetMin = parseUtcOffsetLabelMinutes(timezoneOffset);
  const activePoints = data.slice(-selectedHours).map((d) => {
    if (typeof d.timestampMs === 'number' && Number.isFinite(d.timestampMs)) {
      const local = formatBrowserLocalChartTime(d.timestampMs);
      return { ...d, hour: local.hour, fullTime: local.fullTime };
    }
    // 兼容旧边缘缓存中尚未带 timestampMs 的点位：用来源时区偏移折算至浏览器本地时区
    if (fallbackSourceOffsetMin !== null && d.fullTime) {
      const m = d.fullTime.match(/^(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
      if (m) {
        const nowYear = new Date().getFullYear();
        const wallUtcMs = Date.UTC(
          nowYear,
          Number(m[1]) - 1,
          Number(m[2]),
          Number(m[3]),
          Number(m[4])
        );
        const epochMs = wallUtcMs - fallbackSourceOffsetMin * 60_000;
        const local = formatBrowserLocalChartTime(epochMs);
        return { ...d, hour: local.hour, fullTime: local.fullTime };
      }
    }
    return d;
  });
  const hours = activePoints.map((d) => (selectedHours > 24 && d.fullTime ? d.fullTime : d.hour));
  const aqiSeriesName = onlyPm25 ? 'PM2.5 AQI 指数' : 'AQI 综合指数';
  const aqiVals = activePoints.map((d) => {
    if (onlyPm25) {
      return calculatePM25AQI(d.pm25, standard);
    }
    return d.aqi;
  });
  const pm25Vals = activePoints.map((d) => d.pm25);
  const pm10Vals = activePoints.map((d) => d.pm10 ?? null);
  const o3Vals = activePoints.map((d) => d.o3 ?? null);
  const no2Vals = activePoints.map((d) => d.no2 ?? null);
  const so2Vals = activePoints.map((d) => d.so2 ?? null);
  const coVals = activePoints.map((d) => d.co ?? null);

  const hasO3 = activePoints.some((d) => d.o3 !== undefined && d.o3 > 0);
  const hasPm10 = activePoints.some((d) => d.pm10 !== undefined && d.pm10 > 0);
  const hasNo2 = activePoints.some((d) => d.no2 !== undefined && d.no2 > 0);
  const hasSo2 = activePoints.some((d) => d.so2 !== undefined && d.so2 > 0);
  const hasCo = activePoints.some((d) => d.co !== undefined && d.co > 0);

  const legendData = [aqiSeriesName, 'PM2.5 (μg/m³)'];
  if (hasO3) legendData.push('臭氧 O₃ (μg/m³)');
  if (hasPm10) legendData.push('PM10 (μg/m³)');
  if (hasNo2) legendData.push('二氧化氮 NO₂ (μg/m³)');
  if (hasSo2) legendData.push('二氧化硫 SO₂ (μg/m³)');
  if (hasCo) legendData.push('一氧化碳 CO (mg/m³)');

  const series: any[] = [
    {
      name: aqiSeriesName,
      type: 'line',
      smooth: true,
      data: aqiVals,
      itemStyle: { color: '#0284c7' },
      areaStyle: {
        color: {
          type: 'linear',
          x: 0,
          y: 0,
          x2: 0,
          y2: 1,
          colorStops: [
            { offset: 0, color: 'rgba(2, 132, 199, 0.25)' },
            { offset: 1, color: 'rgba(2, 132, 199, 0.00)' },
          ],
        },
      },
    },
    {
      name: 'PM2.5 (μg/m³)',
      type: 'line',
      smooth: true,
      data: pm25Vals,
      itemStyle: { color: '#f59e0b' },
    },
    {
      name: 'PM10 (μg/m³)',
      type: 'line',
      smooth: true,
      data: pm10Vals,
      itemStyle: { color: '#0ea5e9' },
    },
    {
      name: '臭氧 O₃ (μg/m³)',
      type: 'line',
      smooth: true,
      data: o3Vals,
      itemStyle: { color: '#9333ea' },
    },
    {
      name: '二氧化氮 NO₂ (μg/m³)',
      type: 'line',
      smooth: true,
      data: no2Vals,
      itemStyle: { color: '#ec4899' },
    },
    {
      name: '二氧化硫 SO₂ (μg/m³)',
      type: 'line',
      smooth: true,
      data: so2Vals,
      itemStyle: { color: '#10b981' },
    },
    {
      name: '一氧化碳 CO (mg/m³)',
      type: 'line',
      smooth: true,
      data: coVals,
      itemStyle: { color: '#6366f1' },
    },
  ];

  const option = {
    animation: true,
    animationDuration: 250, // 初始入场动画压缩至 250ms（干脆利索）
    animationDurationUpdate: 200, // 切换 24/48/72 小时或点击指标时 200ms 快速平滑响应
    animationEasing: 'cubicOut',
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
        const idx = params[0].dataIndex;
        const isLatest = idx === hours.length - 1;
        const item = activePoints[idx];
        const timeDisplay = item?.fullTime || params[0].name;

        let html = `<div style="font-weight: bold; margin-bottom: 6px; display:flex; align-items:center; justify-content:space-between; gap:8px;">
          <span>${timeDisplay}</span>
          ${
            isLatest
              ? '<span style="color:#0284c7; font-size:11px; background:#f0f9ff; padding:1px 6px; border-radius:4px; border:1px solid #bae6fd;">当前最新实测</span>'
              : isReal
              ? '<span style="color:#059669; font-size:10px; background:#ecfdf5; padding:1px 5px; border-radius:3px; border:1px solid #a7f3d0;">官方真实实测</span>'
              : ''
          }
        </div>`;

        const activeSeries = new Set(params.map((p: any) => p.seriesName));

        // AQI 指数大行（兼容综合全项与「只看 PM2.5」模式，均在勾选时精准显示当前口径数值）
        if (activeSeries.has(aqiSeriesName)) {
          const displayedAqi = aqiVals[idx];
          html += `<div style="display:flex; justify-content:space-between; gap:16px; font-size:12px; line-height:1.7; font-weight:bold; border-bottom:1px solid #f1f5f9; padding-bottom:4px; margin-bottom:4px;">
            <span style="color:#0284c7;">● ${aqiSeriesName}:</span>
            <span style="color:#0f172a; font-size:13px;">${displayedAqi}</span>
          </div>`;
        }

        // 六大污染物实测物理浓度列表 (仅展示图表上当前勾选激活的指标)
        const pols = [
          { seriesName: 'PM2.5 (μg/m³)', name: 'PM2.5', val: item.pm25, unit: 'μg/m³', color: '#f59e0b', iaqi: item.iaqi?.pm25 },
          { seriesName: 'PM10 (μg/m³)', name: 'PM10', val: item.pm10, unit: 'μg/m³', color: '#0ea5e9', iaqi: item.iaqi?.pm10 },
          { seriesName: '臭氧 O₃ (μg/m³)', name: '臭氧 O₃', val: item.o3, unit: 'μg/m³', color: '#9333ea', iaqi: item.iaqi?.o3 },
          { seriesName: '二氧化氮 NO₂ (μg/m³)', name: '二氧化氮 NO₂', val: item.no2, unit: 'μg/m³', color: '#ec4899', iaqi: item.iaqi?.no2 },
          { seriesName: '二氧化硫 SO₂ (μg/m³)', name: '二氧化硫 SO₂', val: item.so2, unit: 'μg/m³', color: '#10b981', iaqi: item.iaqi?.so2 },
          { seriesName: '一氧化碳 CO (mg/m³)', name: '一氧化碳 CO', val: item.co, unit: 'mg/m³', color: '#6366f1', iaqi: item.iaqi?.co },
        ];

        pols.forEach((p) => {
          // 仅当用户在图例中勾选该指标，且该数值存在有效时，才在 Tooltip 中呈现
          if (activeSeries.has(p.seriesName) && p.val !== undefined && p.val !== null && p.val > 0) {
            const iaqiStr = p.iaqi !== undefined ? `<span style="color:#94a3b8; font-size:10px; margin-left:4px;">(IAQI ${p.iaqi})</span>` : '';
            html += `<div style="display:flex; justify-content:space-between; gap:16px; font-size:12px; line-height:1.6;">
              <span style="color:${p.color};">● ${p.name}:</span>
              <span style="font-weight:600; color:#0f172a;">${p.val} ${p.unit} ${iaqiStr}</span>
            </div>`;
          }
        });

        return html;
      },
    },
    legend: {
      type: 'scroll',
      data: legendData,
      selected: {
        ...selectedMap,
        [aqiSeriesName]:
          selectedMap[aqiSeriesName] ??
          selectedMap['AQI 综合指数'] ??
          selectedMap['PM2.5 AQI 指数'] ??
          true,
      },
      top: 0,
      textStyle: { color: '#475569', fontSize: 11 },
      pageIconColor: '#0284c7',
      pageTextStyle: { color: '#64748b', fontSize: 10 },
    },
    grid: {
      left: 6,
      right: 12,
      bottom: 6,
      top: 38,
      containLabel: true,
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: hours,
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

  const onEvents = {
    legendselectchanged: (params: any) => {
      if (params && params.selected) {
        setSelectedMap(params.selected);
        try {
          localStorage.setItem('aqi_trend_legend_selected_v3', JSON.stringify(params.selected));
        } catch {
          // 忽略
        }
      }
    },
  };

  return (
    <div className="w-full space-y-2">
      <div className="flex items-center justify-end pt-0.5">
        <div className="flex items-center space-x-1 bg-slate-100 p-0.5 rounded-lg border border-slate-200/80">
          {[24, 48, 72].map((h) => (
            <button
              key={h}
              onClick={() => handleRangeChange(h)}
              className={`px-2.5 py-0.5 text-xs font-semibold rounded-md transition-all ${
                selectedHours === h
                  ? 'bg-white text-sky-700 shadow-2xs font-bold'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {h}小时
            </button>
          ))}
        </div>
      </div>

      <div className="w-full h-64 sm:h-72">
        <ReactECharts
          option={option}
          onEvents={onEvents}
          style={{ height: '100%', width: '100%' }}
          notMerge={true}
        />
      </div>
    </div>
  );
};
