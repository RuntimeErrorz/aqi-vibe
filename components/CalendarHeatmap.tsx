'use client';

import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import ReactECharts from 'echarts-for-react';
import { Calendar, RotateCcw, Loader2 } from 'lucide-react';
import { StandardType, CalendarHeatmapDay } from '@/lib/types';

interface CalendarHeatmapProps {
  data: CalendarHeatmapDay[];
  year: number;
  standard: StandardType;
  cityName?: string;
  loadingDaily?: boolean;
  availableYears?: number[];
}

export const CalendarHeatmap: React.FC<CalendarHeatmapProps> = ({
  data,
  year,
  standard,
  cityName,
  loadingDaily = false,
  availableYears,
}) => {
  const [mounted, setMounted] = useState(false);
  const [filterRange, setFilterRange] = useState<[number, number]>([0, 300]);
  const echartsRef = useRef<ReactECharts>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // 当年份、城市、标准切换时，重置上下限为 [0, 300] 并重置 ECharts visualMap
  useEffect(() => {
    setFilterRange([0, 300]);
    const chartInstance = echartsRef.current?.getEchartsInstance();
    if (chartInstance) {
      try {
        chartInstance.dispatchAction({
          type: 'selectDataRange',
          selected: [0, 300],
        });
      } catch {
        // ignore
      }
    }
  }, [year, cityName, standard]);

  // 建立 O(1) 日期索引字典，避免鼠标移动时遍历大数组
  const dataMap = useMemo(() => {
    const map = new Map<string, CalendarHeatmapDay>();
    for (const item of data) {
      map.set(item.date, item);
    }
    return map;
  }, [data]);

  // 格式化为 ECharts calendar 系列数据: [date, aqi]
  const seriesData = useMemo(() => {
    return data.map((d) => [d.date, d.aqi]);
  }, [data]);

  // 统计在册总天数
  const totalDays = useMemo(() => {
    return data.filter((d) => d && typeof d.aqi === 'number' && !isNaN(d.aqi)).length;
  }, [data]);

  // 计算落在当前 visualMap 上下限区间内的天数与占比
  const { matchedDays, isFiltered } = useMemo(() => {
    const isMinAtEdge = filterRange[0] <= 0;
    const isMaxAtEdge = filterRange[1] >= 300;
    const filtered = !isMinAtEdge || !isMaxAtEdge;

    if (!filtered) {
      return { matchedDays: totalDays, isFiltered: false };
    }

    const count = data.filter((d) => {
      if (d.aqi === undefined || d.aqi === null || isNaN(d.aqi)) return false;
      const matchMin = isMinAtEdge ? true : d.aqi >= filterRange[0];
      const matchMax = isMaxAtEdge ? true : d.aqi <= filterRange[1];
      return matchMin && matchMax;
    }).length;

    return { matchedDays: count, isFiltered: true };
  }, [data, filterRange, totalDays]);

  const percentage = useMemo(() => {
    if (totalDays === 0) return '0.0';
    return ((matchedDays / totalDays) * 100).toFixed(1);
  }, [matchedDays, totalDays]);

  // 生成当前区间显示文本
  const rangeLabel = useMemo(() => {
    const min = filterRange[0];
    const max = filterRange[1];
    if (min <= 0 && max < 300) {
      return `AQI 0 ~ ${max}`;
    }
    if (min > 0 && max >= 300) {
      return `AQI ${min} ~ 300+`;
    }
    return `AQI ${min} ~ ${max}`;
  }, [filterRange]);

  // 捕获 ECharts visualMap 上下限拖拽变动事件
  const handleRangeChange = useCallback((params: any) => {
    if (!params) return;
    let rawMin: number | undefined;
    let rawMax: number | undefined;

    if (Array.isArray(params.selected) && params.selected.length >= 2) {
      rawMin = params.selected[0];
      rawMax = params.selected[1];
    } else if (Array.isArray(params.range) && params.range.length >= 2) {
      rawMin = params.range[0];
      rawMax = params.range[1];
    } else if (typeof params.min === 'number' && typeof params.max === 'number') {
      rawMin = params.min;
      rawMax = params.max;
    }

    if (rawMin !== undefined && rawMax !== undefined) {
      const min = Math.max(0, Math.min(rawMin, rawMax));
      const max = Math.max(min, Math.max(rawMin, rawMax));
      setFilterRange([Math.round(min), Math.round(max)]);
    }
  }, []);

  // 重置筛选区间为全量 0 ~ 300
  const handleResetRange = useCallback(() => {
    setFilterRange([0, 300]);
    const chartInstance = echartsRef.current?.getEchartsInstance();
    if (chartInstance) {
      try {
        chartInstance.dispatchAction({
          type: 'selectDataRange',
          selected: [0, 300],
        });
      } catch {
        // ignore
      }
    }
  }, []);

  const onEvents = useMemo(
    () => ({
      datarangeselected: handleRangeChange,
      dataRangeSelected: handleRangeChange,
      selectdatarange: handleRangeChange,
      selectDataRange: handleRangeChange,
      visualmapselected: handleRangeChange,
      visualMapSelected: handleRangeChange,
    }),
    [handleRangeChange]
  );

  const option = useMemo(() => {
    return {
      backgroundColor: 'transparent',
      tooltip: {
        position: 'top',
        backgroundColor: '#ffffff',
        borderColor: '#e2e8f0',
        borderWidth: 1,
        padding: 0,
        shadowBlur: 14,
        shadowColor: 'rgba(0,0,0,0.12)',
        textStyle: { color: '#0f172a', fontSize: 12 },
        formatter: (p: any) => {
          const item = dataMap.get(p.value[0]);
          if (!item) return '';
          const isGood = item.aqi <= 50;
          const primaryText = isGood ? '无 (空气清洁)' : (item.primaryPollutantName || item.primaryPollutant.toUpperCase());

          const fmtVal = (val?: number, unit = 'μg/m³') =>
            val !== undefined && val !== null
              ? `${val} <span style="font-size:10px;color:#64748b;font-weight:normal;">${unit}</span>`
              : '<span style="color:#cbd5e1;">--</span>';

          return `
            <div style="font-size: 12px; line-height: 1.5; padding: 10px 12px; min-width: 220px; font-family: system-ui, -apple-system, sans-serif;">
              <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #f1f5f9; padding-bottom: 6px; margin-bottom: 8px;">
                <span style="font-weight: 700; color: #0f172a; font-size: 13px;">${item.date}</span>
                <span style="font-size: 11px; padding: 1px 6px; border-radius: 9999px; background: ${item.color}20; color: ${item.color}; font-weight: 600;">
                  ${item.level}
                </span>
              </div>

              <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px;">
                <span style="color: #64748b; font-size: 11px;">AQI 指数</span>
                <span style="font-size: 16px; font-weight: 800; color: ${item.color};">${item.aqi}</span>
              </div>

              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; font-size: 11px;">
                <span style="color: #64748b;">首要污染物</span>
                <span style="font-weight: 600; color: #334155;">${primaryText}</span>
              </div>

              <div style="background: #f8fafc; border-radius: 8px; padding: 6px 8px; border: 1px solid #f1f5f9;">
                <div style="font-size: 10px; font-weight: 600; color: #94a3b8; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px;">六项实测浓度指标</div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px 10px; font-size: 11px;">
                  <div style="display: flex; justify-content: space-between;">
                    <span style="color: #64748b;">PM2.5:</span>
                    <span style="font-weight: 600; color: #1e293b;">${fmtVal(item.pm25)}</span>
                  </div>
                  <div style="display: flex; justify-content: space-between;">
                    <span style="color: #64748b;">PM10:</span>
                    <span style="font-weight: 600; color: #1e293b;">${fmtVal(item.pm10)}</span>
                  </div>
                  <div style="display: flex; justify-content: space-between;">
                    <span style="color: #64748b;">O₃:</span>
                    <span style="font-weight: 600; color: #1e293b;">${fmtVal(item.o3)}</span>
                  </div>
                  <div style="display: flex; justify-content: space-between;">
                    <span style="color: #64748b;">NO₂:</span>
                    <span style="font-weight: 600; color: #1e293b;">${fmtVal(item.no2)}</span>
                  </div>
                  <div style="display: flex; justify-content: space-between;">
                    <span style="color: #64748b;">SO₂:</span>
                    <span style="font-weight: 600; color: #1e293b;">${fmtVal(item.so2)}</span>
                  </div>
                  <div style="display: flex; justify-content: space-between;">
                    <span style="color: #64748b;">CO:</span>
                    <span style="font-weight: 600; color: #1e293b;">${fmtVal(item.co, 'mg/m³')}</span>
                  </div>
                </div>
              </div>
            </div>
          `;
        },
      },
      visualMap: {
        min: 0,
        max: 300,
        calculable: true,
        realtime: true,
        hoverLink: false,
        orient: 'horizontal',
        left: 'center',
        bottom: '0%',
        textStyle: { color: '#64748b', fontSize: 11 },
        inRange: {
          color: ['#10b981', '#eab308', '#f97316', '#ef4444', '#8b5cf6', '#7f1d1d'],
        },
        outOfRange: {
          color: '#e2e8f0',
          opacity: 0.25,
        },
      },
      calendar: {
        top: 30,
        left: 40,
        right: 30,
        cellSize: ['auto', 16],
        range: year.toString(),
        itemStyle: {
          color: '#f8fafc',
          borderWidth: 1.5,
          borderColor: '#ffffff',
        },
        splitLine: {
          show: true,
          lineStyle: {
            color: '#e2e8f0',
            width: 2,
            type: 'solid',
          },
        },
        yearLabel: { show: false },
        dayLabel: {
          firstDay: 1,
          nameMap: ['日', '一', '二', '三', '四', '五', '六'],
          color: '#94a3b8',
          fontSize: 10,
        },
        monthLabel: {
          nameMap: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'],
          color: '#475569',
          fontSize: 11,
        },
      },
      series: {
        type: 'heatmap',
        coordinateSystem: 'calendar',
        data: seriesData,
      },
    };
  }, [dataMap, seriesData, year]);

  const titleText = cityName ? `${cityName} ${year} 年逐日日历热力全景谱系` : `${year} 年逐日日历热力全景谱系`;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-base font-bold text-slate-900 flex items-center space-x-2">
          <Calendar className="w-4 h-4 text-sky-600" />
          <span>{titleText}</span>
        </h3>
        <div className="flex items-center space-x-2 text-xs">
          {loadingDaily && (
            <span className="flex items-center space-x-1 text-sky-600 mr-1">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>实测数据同步中...</span>
            </span>
          )}

          {/* 实时动态天数与区间联动展示 */}
          {totalDays > 0 &&
            (isFiltered ? (
              <div className="flex items-center space-x-2 px-2.5 py-1 rounded-full bg-sky-50 text-sky-700 border border-sky-200/80 font-medium transition-all shadow-sm">
                <span className="text-slate-500">{rangeLabel}:</span>
                <span className="font-extrabold text-sky-800">{matchedDays} 天</span>
                <span className="text-slate-400 text-[11px]">/ {totalDays} 天</span>
                <span className="px-1.5 py-0.5 rounded-md bg-sky-100 text-sky-700 text-[11px] font-bold">
                  {percentage}%
                </span>
                <button
                  type="button"
                  onClick={handleResetRange}
                  title="重置区间为全量 0 ~ 300"
                  className="ml-1 text-slate-400 hover:text-sky-600 transition-colors flex items-center"
                >
                  <RotateCcw className="w-3 h-3" />
                </button>
              </div>
            ) : (
              <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-slate-100/90 text-slate-600 font-medium">
                <span className="text-slate-400">全年在册</span>
                <span className="font-bold text-slate-800">{totalDays} 天</span>
              </div>
            ))}
        </div>
      </div>

      {!mounted ? (
        <div className="h-60 flex items-center justify-center text-slate-400 text-sm">
          <Loader2 className="w-4 h-4 animate-spin mr-2 text-sky-600" />
          <span>加载日历热力图中...</span>
        </div>
      ) : totalDays > 0 ? (
        <div className="w-full h-60">
          <ReactECharts
            ref={echartsRef}
            option={option}
            style={{ height: '100%', width: '100%' }}
            notMerge={false}
            lazyUpdate={true}
            shouldSetOption={(prevProps, currentProps) => prevProps.option !== currentProps.option}
            onEvents={onEvents}
          />
        </div>
      ) : (
        <div className="h-56 flex flex-col items-center justify-center text-slate-400 text-sm space-y-2">
          <Calendar className="w-8 h-8 text-slate-300" />
          <p>该城市在 {year} 年度暂无官方逐日实测归档记录</p>
          {availableYears && availableYears.length > 0 && (
            <p className="text-xs text-slate-400">
              请在上方下拉菜单中切换到该城市有实测记录的年份 ({availableYears.join(', ')})
            </p>
          )}
        </div>
      )}
    </div>
  );
};

