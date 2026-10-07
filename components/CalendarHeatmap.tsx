'use client';

import React, { useEffect, useState, useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { StandardType, CalendarHeatmapDay } from '@/lib/types';

interface CalendarHeatmapProps {
  data: CalendarHeatmapDay[];
  year: number;
  standard: StandardType;
}

export const CalendarHeatmap: React.FC<CalendarHeatmapProps> = ({ data, year, standard }) => {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // 建立 O(1) 日期索引字典，避免鼠标移动时遍历大数组
  const dataMap = useMemo(() => {
    const map = new Map<string, CalendarHeatmapDay>();
    for (const item of data) {
      map.set(item.date, item);
    }
    return map;
  }, [data]);

  if (!mounted) {
    return <div className="h-60 flex items-center justify-center text-slate-400 text-sm">加载日历热力图中...</div>;
  }

  // 格式化为 ECharts calendar 系列数据: [date, aqi]
  const seriesData = data.map((d) => [d.date, d.aqi]);

  const option = {
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
        const stdLabel = standard === 'CN' ? '国标 HJ 633' : '美标 US EPA';
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
              <span style="color: #64748b; font-size: 11px;">AQI 指数 (${stdLabel})</span>
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
      max: standard === 'CN' ? 250 : 300,
      calculable: true,
      hoverLink: false, // 禁用联动游标小球，纯粹保留左右手柄的上下限区间筛选功能
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

  return (
    <div className="w-full h-60">
      <ReactECharts option={option} style={{ height: '100%', width: '100%' }} notMerge={true} />
    </div>
  );
};

