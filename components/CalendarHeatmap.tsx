'use client';

import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import ReactECharts from 'echarts-for-react';
import {
  Calendar,
  RotateCcw,
  Loader2,
  Sparkles,
  Leaf,
  Flame,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { StandardType, CalendarHeatmapDay } from '@/lib/types';
import { PaginationJumper } from './PaginationJumper';

interface CalendarHeatmapProps {
  data: CalendarHeatmapDay[];
  year: number;
  standard: StandardType;
  onlyPm25?: boolean;
  cityName?: string;
  loadingDaily?: boolean;
  availableYears?: number[];
}

const PageJumper: React.FC<{
  currentPage: number;
  totalPages: number;
  onPageChange: (p: number) => void;
  labelPrefix?: string;
}> = (props) => <PaginationJumper {...props} compact={true} />;

function formatDateMeta(dateStr: string) {
  const parts = dateStr.split('-');
  const monthStr = parts[1] || '01';
  const dayStr = parts[2] || '01';
  const dateObj = new Date(dateStr + 'T00:00:00');
  const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const weekDay = !isNaN(dateObj.getTime()) ? weekDays[dateObj.getDay()] : '';
  const monthNum = parseInt(monthStr, 10);
  let season = '春季';
  if (monthNum >= 3 && monthNum <= 5) season = '春季';
  else if (monthNum >= 6 && monthNum <= 8) season = '夏季';
  else if (monthNum >= 9 && monthNum <= 11) season = '秋季';
  else season = '冬季';

  return {
    monthDay: `${monthStr}月${dayStr}日`,
    weekDay,
    season,
  };
}

function renderRankBadge(rankNum: number, isClean: boolean) {
  if (rankNum === 1) {
    return (
      <span
        className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-black shadow-2xs shrink-0 ${
          isClean
            ? 'bg-emerald-500 text-white ring-2 ring-emerald-300/60'
            : 'bg-rose-600 text-white ring-2 ring-rose-300/60'
        }`}
      >
        1
      </span>
    );
  }
  if (rankNum === 2) {
    return (
      <span
        className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-black shadow-2xs shrink-0 ${
          isClean ? 'bg-emerald-400 text-white' : 'bg-rose-500 text-white'
        }`}
      >
        2
      </span>
    );
  }
  if (rankNum === 3) {
    return (
      <span
        className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-black shadow-2xs shrink-0 ${
          isClean ? 'bg-emerald-300 text-emerald-950 font-bold' : 'bg-rose-400 text-white'
        }`}
      >
        3
      </span>
    );
  }
  return (
    <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-slate-500 bg-slate-100 shrink-0 tabular-nums">
      {rankNum}
    </span>
  );
}

export const CalendarHeatmap: React.FC<CalendarHeatmapProps> = ({
  data,
  year,
  standard,
  onlyPm25 = false,
  cityName,
  loadingDaily = false,
  availableYears,
}) => {
  const [mounted, setMounted] = useState(false);
  const [filterRange, setFilterRange] = useState<[number, number]>([0, 300]);
  const [activeThumb, setActiveThumb] = useState<'min' | 'max' | null>(null);
  const echartsRef = useRef<ReactECharts>(null);
  const sliderTrackRef = useRef<HTMLDivElement>(null);

  const [pageSize, setPageSize] = useState<number>(5);
  const [bestPage, setBestPage] = useState<number>(1);
  const [worstPage, setWorstPage] = useState<number>(1);

  useEffect(() => {
    setMounted(true);
  }, []);

  // 当年份、城市、页面大小变化时，重置分页到第 1 页
  useEffect(() => {
    setBestPage(1);
    setWorstPage(1);
  }, [year, cityName, pageSize]);

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

  // 过滤有效数据并排序极值天气
  const validDays = useMemo(() => {
    return data.filter((d) => d && typeof d.aqi === 'number' && !isNaN(d.aqi) && d.aqi > 0);
  }, [data]);

  // 天气最好 (最清新) 排序：AQI 升序，相同按 PM2.5 升序
  const bestDays = useMemo(() => {
    return [...validDays].sort((a, b) => {
      if (a.aqi !== b.aqi) return a.aqi - b.aqi;
      return (a.pm25 ?? 0) - (b.pm25 ?? 0);
    });
  }, [validDays]);

  // 天气最差 (污染最重) 排序：AQI 降序，相同按 PM2.5 降序
  const worstDays = useMemo(() => {
    return [...validDays].sort((a, b) => {
      if (a.aqi !== b.aqi) return b.aqi - a.aqi;
      return (b.pm25 ?? 0) - (a.pm25 ?? 0);
    });
  }, [validDays]);

  // 分页数据切片
  const bestTotalPages = Math.max(1, Math.ceil(bestDays.length / pageSize));
  const worstTotalPages = Math.max(1, Math.ceil(worstDays.length / pageSize));

  const paginatedBest = useMemo(() => {
    const start = (bestPage - 1) * pageSize;
    return bestDays.slice(start, start + pageSize);
  }, [bestDays, bestPage, pageSize]);

  const paginatedWorst = useMemo(() => {
    const start = (worstPage - 1) * pageSize;
    return worstDays.slice(start, start + pageSize);
  }, [worstDays, worstPage, pageSize]);

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

  // 向 ECharts 实例派发范围高亮/过滤动作
  const dispatchRangeToEcharts = useCallback((range: [number, number]) => {
    const chartInstance = echartsRef.current?.getEchartsInstance();
    if (chartInstance) {
      try {
        chartInstance.dispatchAction({
          type: 'selectDataRange',
          selected: range,
        });
      } catch {
        // ignore
      }
    }
  }, []);

  // 重置筛选区间为全量 0 ~ 300
  const handleResetRange = useCallback(() => {
    setFilterRange([0, 300]);
    dispatchRangeToEcharts([0, 300]);
  }, [dispatchRangeToEcharts]);

  // 根据数值更新区间并通知 ECharts
  const updateRangeByVal = useCallback((val: number, thumb: 'min' | 'max') => {
    setFilterRange((prev) => {
      let next: [number, number];
      if (thumb === 'min') {
        next = [Math.min(val, prev[1]), prev[1]];
      } else {
        next = [prev[0], Math.max(val, prev[0])];
      }
      dispatchRangeToEcharts(next);
      return next;
    });
  }, [dispatchRangeToEcharts]);

  // 点击轨道任意位置，智能就近吸附手柄 (告别点不到)
  const handleTrackPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!sliderTrackRef.current) return;
    const rect = sliderTrackRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const val = Math.round(ratio * 300);
    const distMin = Math.abs(val - filterRange[0]);
    const distMax = Math.abs(val - filterRange[1]);
    const thumb = distMin <= distMax ? 'min' : 'max';
    setActiveThumb(thumb);
    updateRangeByVal(val, thumb);
  }, [filterRange, updateRangeByVal]);

  // 拖动手柄手势处理 (Pointer Capture 全局捕获，28px 极大点击热区，100% 灵敏不脱手)
  const handleThumbPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>, thumb: 'min' | 'max') => {
    e.preventDefault();
    e.stopPropagation();
    setActiveThumb(thumb);
    const target = e.currentTarget;
    try {
      target.setPointerCapture(e.pointerId);
    } catch {}

    const onPointerMove = (moveEvent: PointerEvent) => {
      if (!sliderTrackRef.current) return;
      const rect = sliderTrackRef.current.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (moveEvent.clientX - rect.left) / rect.width));
      const val = Math.round(ratio * 300);
      updateRangeByVal(val, thumb);
    };

    const onPointerUp = (upEvent: PointerEvent) => {
      try {
        target.releasePointerCapture(upEvent.pointerId);
      } catch {}
      target.removeEventListener('pointermove', onPointerMove);
      target.removeEventListener('pointerup', onPointerUp);
      target.removeEventListener('pointercancel', onPointerUp);
      setActiveThumb(null);
    };

    target.addEventListener('pointermove', onPointerMove);
    target.addEventListener('pointerup', onPointerUp);
    target.addEventListener('pointercancel', onPointerUp);
  }, [updateRangeByVal]);

  const getAqiColor = (aqi: number) => {
    if (aqi <= 50) return '#10b981';
    if (aqi <= 100) return '#eab308';
    if (aqi <= 150) return '#f97316';
    if (aqi <= 200) return '#ef4444';
    if (aqi <= 300) return '#8b5cf6';
    return '#7f1d1d';
  };

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
        show: true,
        trigger: 'item',
        appendToBody: true,
        confine: false,
        extraCssText: 'pointer-events: none; z-index: 99999; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.15), 0 8px 10px -6px rgba(0, 0, 0, 0.1); border-radius: 8px;',
        position: (
          point: [number, number],
          params: any,
          dom: any,
          rect: any,
          size: { contentSize: [number, number]; viewSize: [number, number] }
        ) => {
          const [x, y] = point;
          const [boxWidth, boxHeight] = size?.contentSize || [220, 135];

          // 1. 水平居中于鼠标悬停的方格
          let posX = x - boxWidth / 2;

          // 2. 垂直方向：按用户要求整体往上移动，浮于方格正上方 12px，彻底避免遮挡鼠标与方格
          let posY = y - boxHeight - 12;

          // 若页面滚动至极端顶部（上方视口空间不足），则平滑降级至方格下方 22px
          if (typeof window !== 'undefined') {
            try {
              const chartDom = echartsRef.current?.getEchartsInstance()?.getDom();
              if (chartDom) {
                const chartTop = chartDom.getBoundingClientRect().top;
                if (chartTop + posY < 8) {
                  posY = y + 22;
                }
              }
            } catch {}
          }

          return [posX, posY];
        },
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
                <span style="color: #64748b; font-size: 11px;">${onlyPm25 ? 'PM2.5 IAQI (单项)' : 'AQI 指数'}</span>
                <span style="font-size: 16px; font-weight: 800; color: ${item.color};">${item.aqi}</span>
              </div>

              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; font-size: 11px;">
                <span style="color: #64748b;">${onlyPm25 ? '关注指标' : '首要污染物'}</span>
                <span style="font-weight: 600; color: #334155;">${onlyPm25 ? 'PM2.5 (细颗粒物)' : primaryText}</span>
              </div>

              <div style="background: #f8fafc; border-radius: 8px; padding: 6px 8px; border: 1px solid #f1f5f9;">
                <div style="font-size: 10px; font-weight: 600; color: #94a3b8; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px;">六项实测浓度指标</div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px 10px; font-size: 11px;">
                  <div style="display: flex; justify-content: space-between; ${onlyPm25 ? 'background: #e0f2fe; padding: 1px 4px; border-radius: 4px;' : ''}">
                    <span style="color: ${onlyPm25 ? '#0369a1' : '#64748b'}; font-weight: ${onlyPm25 ? '700' : 'normal'};">PM2.5:</span>
                    <span style="font-weight: 700; color: ${onlyPm25 ? '#0284c7' : '#1e293b'};">${fmtVal(item.pm25)}</span>
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
        show: false,
        min: 0,
        max: 300,
        range: filterRange,
        calculable: true,
        realtime: true,
        hoverLink: false,
        orient: 'horizontal',
        left: 'center',
        bottom: 4,
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
        top: 18,
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
  }, [dataMap, seriesData, year, onlyPm25, filterRange]);

  // 按用户要求规范命名：{城市名} {年份} 年 空气质量详情
  const titleText = cityName ? `${cityName} ${year} 年 空气质量详情` : `${year} 年 空气质量详情`;

  const renderDayRow = (
    item: CalendarHeatmapDay,
    index: number,
    isClean: boolean,
    currentPage: number
  ) => {
    const actualRank = (currentPage - 1) * pageSize + index + 1;
    const meta = formatDateMeta(item.date);

    return (
      <div
        key={item.date}
        className={`p-3 rounded-xl border transition-all flex items-center justify-between gap-2.5 sm:gap-3 group shadow-2xs ${
          isClean
            ? 'bg-emerald-50/20 border-emerald-100/90 hover:border-emerald-300 hover:bg-emerald-50/50'
            : 'bg-rose-50/20 border-rose-100/90 hover:border-rose-300 hover:bg-rose-50/50'
        }`}
      >
        {/* 左侧：排名徽标 + 日期 + 星期/季节 + 污染物指标 */}
        <div className="flex items-center space-x-2.5 min-w-0 flex-1">
          {renderRankBadge(actualRank, isClean)}
          <div className="min-w-0 flex-1">
            {/* 日期栏：强制单行不换行，杜绝字词垂直折叠 */}
            <div className="flex items-center space-x-1.5 whitespace-nowrap shrink-0">
              <span className="font-bold text-xs sm:text-sm text-slate-900 group-hover:text-sky-600 transition-colors whitespace-nowrap shrink-0">
                {meta.monthDay}
              </span>
              <span className="text-[11px] font-medium text-slate-500 whitespace-nowrap shrink-0">
                {meta.weekDay}
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-medium whitespace-nowrap shrink-0">
                {meta.season}
              </span>
            </div>

            {/* 污染物浓度明细 */}
            <div className="text-[11px] text-slate-400 flex items-center space-x-1.5 sm:space-x-2 mt-0.5 flex-wrap">
              <span className="whitespace-nowrap">
                PM2.5: <b className="text-slate-600 font-semibold">{item.pm25 ?? '--'}</b>
              </span>
              {item.pm10 !== undefined && (
                <span className="whitespace-nowrap">
                  · PM10: <b className="text-slate-600 font-semibold">{item.pm10}</b>
                </span>
              )}
              {item.o3 !== undefined && (
                <span className="whitespace-nowrap">
                  · O₃: <b className="text-slate-600 font-semibold">{item.o3}</b>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* 右侧：AQI 大字 + 等级胶囊 + 首要污染物 */}
        <div className="flex items-center space-x-2 shrink-0 text-right pl-1">
          <div className="shrink-0">
            <div className="flex items-baseline justify-end space-x-1">
              <span className="text-sm sm:text-base font-black text-slate-900">
                {item.aqi}
              </span>
              <span className="text-[10px] text-slate-400 font-semibold">AQI</span>
            </div>
            {item.primaryPollutantName && item.aqi > 50 && (
              <div className="text-[10px] text-slate-400 truncate max-w-[80px] sm:max-w-[120px] whitespace-nowrap">
                首要: {item.primaryPollutantName}
              </div>
            )}
          </div>
          <span
            className="text-[10px] sm:text-xs px-2 py-0.5 rounded-md font-bold whitespace-nowrap shrink-0"
            style={{
              backgroundColor: `${item.color}15`,
              color: item.color,
              border: `1px solid ${item.color}35`,
            }}
          >
            {item.level}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div>
      {/* 1. 顶部标题、居中双端彩虹滑块、右侧天数统计 (三栏网格架构，滑块绝对居中，右侧宽度变动零干扰) */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] items-center gap-3 mb-2">
        {/* 左列：标题与实测状态 */}
        <div className="flex items-center space-x-2 shrink-0 min-w-0 justify-self-start">
          <Calendar className="w-4 h-4 text-sky-600 shrink-0" />
          <h3 className="text-sm sm:text-base font-bold text-slate-900 truncate">{titleText}</h3>
          {loadingDaily && (
            <span className="flex items-center space-x-1 text-sky-600 text-xs shrink-0 ml-1">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>同步中...</span>
            </span>
          )}
        </div>

        {/* 中列：居中的双端彩虹滑块 (在卡片水平正中心绝对居中，物理锁定，不受右侧任何宽度变动影响，拖拽零抖动) */}
        <div className="flex items-center justify-center justify-self-center">
          <div className="flex items-center space-x-2 bg-slate-50/90 hover:bg-slate-100/60 border border-slate-200/90 rounded-full px-3 py-1.5 shadow-2xs select-none transition-colors">
            <span className="text-[11px] font-bold text-slate-400 shrink-0">AQI:</span>
            <span
              className="font-mono text-[11px] font-bold text-slate-500 tabular-nums cursor-pointer hover:text-sky-600 transition-colors shrink-0"
              onClick={() => updateRangeByVal(0, 'min')}
              title="点击将左侧下限重置为 0"
            >
              0
            </span>
            <div
              ref={sliderTrackRef}
              className="relative w-36 sm:w-44 md:w-52 h-2 rounded-full cursor-pointer select-none touch-none shrink-0"
              style={{
                background:
                  'linear-gradient(to right, #10b981 0%, #eab308 20%, #f97316 40%, #ef4444 60%, #8b5cf6 80%, #7f1d1d 100%)',
              }}
              onPointerDown={handleTrackPointerDown}
              title="点击轨道或拖动左右手柄筛选日历 AQI 区间"
            >
              {/* 左侧非选中区间遮罩 */}
              <div
                className="absolute left-0 top-0 bottom-0 bg-slate-200/85 rounded-l-full pointer-events-none transition-all duration-75"
                style={{ width: `${(filterRange[0] / 300) * 100}%` }}
              />
              {/* 右侧非选中区间遮罩 */}
              <div
                className="absolute right-0 top-0 bottom-0 bg-slate-200/85 rounded-r-full pointer-events-none transition-all duration-75"
                style={{ width: `${100 - (filterRange[1] / 300) * 100}%` }}
              />

              {/* 左滑块 (Min Thumb) - 带有 28px 透明外围热区，100% 灵敏 */}
              <div
                role="slider"
                aria-valuenow={filterRange[0]}
                tabIndex={0}
                className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-7 h-7 flex items-center justify-center cursor-ew-resize touch-none focus:outline-none"
                style={{
                  left: `${(filterRange[0] / 300) * 100}%`,
                  zIndex: activeThumb === 'min' ? 30 : 20,
                }}
                onPointerDown={(e) => handleThumbPointerDown(e, 'min')}
                title={`当前下限: AQI ${filterRange[0]} (可左右拖动或点击轨道)`}
              >
                {activeThumb === 'min' && (
                  <div className="absolute -top-6 left-1/2 -translate-x-1/2 px-1.5 py-0.5 bg-slate-900 text-white text-[10px] font-bold rounded shadow pointer-events-none tabular-nums whitespace-nowrap">
                    {filterRange[0]}
                  </div>
                )}
                <div
                  className="w-2.5 h-4.5 rounded-full bg-white shadow-md border-2 transition-transform hover:scale-110 active:scale-125 pointer-events-none"
                  style={{ borderColor: getAqiColor(filterRange[0]) }}
                />
              </div>

              {/* 右滑块 (Max Thumb) - 带有 28px 透明外围热区，100% 灵敏 */}
              <div
                role="slider"
                aria-valuenow={filterRange[1]}
                tabIndex={0}
                className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-7 h-7 flex items-center justify-center cursor-ew-resize touch-none focus:outline-none"
                style={{
                  left: `${(filterRange[1] / 300) * 100}%`,
                  zIndex: activeThumb === 'max' ? 30 : 20,
                }}
                onPointerDown={(e) => handleThumbPointerDown(e, 'max')}
                title={`当前上限: AQI ${filterRange[1]} (可左右拖动或点击轨道)`}
              >
                {activeThumb === 'max' && (
                  <div className="absolute -top-6 left-1/2 -translate-x-1/2 px-1.5 py-0.5 bg-slate-900 text-white text-[10px] font-bold rounded shadow pointer-events-none tabular-nums whitespace-nowrap">
                    {filterRange[1]}
                  </div>
                )}
                <div
                  className="w-2.5 h-4.5 rounded-full bg-white shadow-md border-2 transition-transform hover:scale-110 active:scale-125 pointer-events-none"
                  style={{ borderColor: getAqiColor(filterRange[1]) }}
                />
              </div>
            </div>
            <span
              className="font-mono text-[11px] font-bold text-slate-500 tabular-nums cursor-pointer hover:text-sky-600 transition-colors shrink-0"
              onClick={() => updateRangeByVal(300, 'max')}
              title="点击将右侧上限重置为 300"
            >
              300
            </span>
          </div>
        </div>

        {/* 右列：天数统计徽标 (靠右对齐，固定最小宽度与等宽数字，彻底消除宽度抖动) */}
        <div className="flex items-center justify-self-end text-xs shrink-0">
          {totalDays > 0 &&
            (isFiltered ? (
              <div className="flex items-center space-x-2 px-3 py-1.5 rounded-full bg-sky-50 text-sky-700 border border-sky-200/80 font-medium transition-all shadow-2xs min-w-[220px] justify-between">
                <span className="text-slate-500 font-mono text-[11px] tabular-nums shrink-0">{rangeLabel}:</span>
                <span className="font-extrabold text-sky-800 font-mono tabular-nums shrink-0">{matchedDays} 天</span>
                <span className="text-slate-400 text-[11px] font-mono tabular-nums shrink-0">/ {totalDays} 天</span>
                <span className="px-1.5 py-0.5 rounded-md bg-sky-100 text-sky-700 text-[11px] font-bold font-mono tabular-nums shrink-0">
                  {percentage}%
                </span>
                <button
                  type="button"
                  onClick={handleResetRange}
                  title="重置区间为全量 0 ~ 300"
                  className="text-slate-400 hover:text-sky-600 transition-colors flex items-center cursor-pointer p-0.5 shrink-0"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div className="flex items-center space-x-2 px-3 py-1.5 rounded-full bg-slate-100/90 text-slate-600 font-medium min-w-[220px] justify-between">
                <span className="text-slate-500 font-mono text-[11px] shrink-0">全年在册:</span>
                <span className="font-extrabold text-slate-800 font-mono tabular-nums shrink-0">{totalDays} 天</span>
                <span className="text-slate-400 text-[11px] font-mono tabular-nums shrink-0">/ {totalDays} 天</span>
                <span className="px-1.5 py-0.5 rounded-md bg-slate-200/80 text-slate-700 text-[11px] font-bold font-mono tabular-nums shrink-0">
                  100%
                </span>
                <span className="w-3.5 h-3.5 invisible shrink-0" />
              </div>
            ))}
        </div>
      </div>

      {/* 2. 365 天日历矩阵热力全景图 (加载期呈现 1:1 鱼骨占位，绝不误闪暂无记录或残留旧城) */}
      {!mounted || (loadingDaily && totalDays === 0) ? (
        <div className="space-y-2.5 py-2 animate-pulse">
          <div className="h-[142px] w-full rounded-xl bg-slate-50/90 border border-slate-100 p-3 flex flex-col justify-between">
            <div className="flex justify-between px-4">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => (
                <div key={m} className="h-2.5 w-5 bg-slate-200/80 rounded" />
              ))}
            </div>
            <div className="grid grid-cols-12 gap-1.5 flex-1 py-2">
              {Array.from({ length: 48 }).map((_, idx) => (
                <div key={idx} className="rounded-xs bg-slate-200/60 h-full" />
              ))}
            </div>
          </div>
        </div>
      ) : totalDays > 0 ? (
        <div className="w-full overflow-x-auto pb-1 custom-scrollbar">
          <div className="min-w-[760px] h-[142px]">
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
        </div>
      ) : (
        <div className="h-44 flex flex-col items-center justify-center text-slate-400 text-sm space-y-2">
          <Calendar className="w-8 h-8 text-slate-300" />
          <p>该城市在 {year} 年度暂无官方逐日实测归档记录</p>
          {availableYears && availableYears.length > 0 && (
            <p className="text-xs text-slate-400">
              请在上方下拉菜单中切换到该城市有实测记录的年份 ({availableYears.join(', ')})
            </p>
          )}
        </div>
      )}

      {/* 3. 年度空气质量极值天气排行：最好与最差天数并列对比与翻页控制 */}
      {totalDays > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-200/80 space-y-4">
          {/* 排行模块控制头部：标题与每页条数选择 */}
          <div className="flex items-center justify-between gap-3 pb-1">
            <div className="flex items-center space-x-2">
              <Sparkles className="w-4 h-4 text-amber-500 shrink-0" />
              <h4 className="text-sm sm:text-base font-bold text-slate-900 tracking-tight">
                年度空气质量极值天气排行
              </h4>
            </div>

            {/* 每页条数下拉 */}
            <div className="flex items-center space-x-2 text-xs">
              <span className="text-slate-400 font-medium text-[11px] hidden xs:inline">展示规格:</span>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="px-2.5 py-1 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700 font-semibold focus:outline-none focus:border-sky-500 shadow-2xs cursor-pointer hover:bg-slate-100 transition-colors"
              >
                <option value={5}>每页 5 天</option>
                <option value={10}>每页 10 天</option>
                <option value={20}>每页 20 天</option>
              </select>
            </div>
          </div>

          {/* 并列对比视图 (左右两栏，拉开间距增强独立视觉区分) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-7 lg:gap-8">
            {/* 左栏：空气最优天气榜 */}
            <div className="space-y-3 p-3.5 sm:p-4 rounded-2xl bg-gradient-to-b from-emerald-50/50 via-slate-50/60 to-white/95 border border-emerald-100/90 shadow-2xs">
              <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-emerald-100/80">
                <div className="flex items-center space-x-1.5 min-w-0">
                  <Leaf className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span className="font-bold text-xs sm:text-sm text-slate-900 truncate">
                    空气最清新天气榜 (最好)
                  </span>
                  <span className="text-[10px] text-emerald-700 font-bold bg-emerald-100/80 px-1.5 py-0.5 rounded shrink-0">
                    最低 AQI {bestDays[0]?.aqi ?? '--'}
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                {paginatedBest.map((item, idx) =>
                  renderDayRow(item, idx, true, bestPage)
                )}
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-emerald-100/60 text-[11px] text-slate-400 flex-wrap gap-2">
                <span>
                  第 {(bestPage - 1) * pageSize + 1} ~{' '}
                  {Math.min(bestPage * pageSize, bestDays.length)} 天 / 共{' '}
                  {bestDays.length} 天
                </span>
                <PageJumper
                  currentPage={bestPage}
                  totalPages={bestTotalPages}
                  onPageChange={setBestPage}
                />
              </div>
            </div>

            {/* 右栏：污染最严重天气榜 */}
            <div className="space-y-3 p-3.5 sm:p-4 rounded-2xl bg-gradient-to-b from-rose-50/50 via-slate-50/60 to-white/95 border border-rose-100/90 shadow-2xs">
              <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-rose-100/80">
                <div className="flex items-center space-x-1.5 min-w-0">
                  <Flame className="w-4 h-4 text-rose-500 shrink-0" />
                  <span className="font-bold text-xs sm:text-sm text-slate-900 truncate">
                    污染最严重天气榜 (最差)
                  </span>
                  <span className="text-[10px] text-rose-700 font-bold bg-rose-100/80 px-1.5 py-0.5 rounded shrink-0">
                    最高 AQI {worstDays[0]?.aqi ?? '--'}
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                {paginatedWorst.map((item, idx) =>
                  renderDayRow(item, idx, false, worstPage)
                )}
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-rose-100/60 text-[11px] text-slate-400 flex-wrap gap-2">
                <span>
                  第 {(worstPage - 1) * pageSize + 1} ~{' '}
                  {Math.min(worstPage * pageSize, worstDays.length)} 天 / 共{' '}
                  {worstDays.length} 天
                </span>
                <PageJumper
                  currentPage={worstPage}
                  totalPages={worstTotalPages}
                  onPageChange={setWorstPage}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
