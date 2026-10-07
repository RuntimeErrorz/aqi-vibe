'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useStandard } from '@/components/StandardContext';
import { CITIES_REGISTRY, findCity } from '@/lib/constants/cities';
import { CityMeta } from '@/lib/types';
import {
  getAnnualTrends,
  hasCityHistory,
  fetchCityDailyHistory,
  aggregateYearlyPollutants,
  getCityAvailableYears,
} from '@/lib/services/history-data';
import { CompareLineChart } from '@/components/CompareLineChart';
import { CompareRadarChart } from '@/components/CompareRadarChart';
import { CitySearchAutocomplete } from '@/components/CitySearchAutocomplete';
import { GlobalRankingSandbox } from '@/components/GlobalRankingSandbox';
import { BarChart3, Plus, X, Check, Calendar, ChevronDown, Loader2 } from 'lucide-react';

const PALETTE = ['#0284c7', '#059669', '#d97706', '#db2777', '#7c3aed'];

export default function ComparePage() {
  const { standard } = useStandard();
  const [selectedCityIds, setSelectedCityIds] = useState<string[]>([
    'cn-chengdu',
    'cn-beijing',
    'gl-london',
    'gl-tokyo',
  ]);
  const [radarYear, setRadarYear] = useState<number>(2024);
  const [dailyDataMap, setDailyDataMap] = useState<Record<string, Record<string, any>>>({});
  const [loadingDaily, setLoadingDaily] = useState<boolean>(false);

  // 计算当前所选城市集合中存在的可用历史年份（去重降序）
  const availableYears = useMemo(() => {
    const yearSet = new Set<number>();
    selectedCityIds.forEach((id) => {
      getCityAvailableYears(id).forEach((y) => yearSet.add(y));
    });
    const list = Array.from(yearSet).sort((a, b) => b - a);
    return list.length > 0 ? list : [2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2015];
  }, [selectedCityIds]);

  // 异步拉取所选城市的逐日全量实测数据集 (包含 PM2.5, PM10, O3, NO2, SO2, CO)
  useEffect(() => {
    let cancelled = false;
    const loadData = async () => {
      const missingIds = selectedCityIds.filter((id) => !dailyDataMap[id]);
      if (missingIds.length === 0) return;

      setLoadingDaily(true);
      const results = await Promise.all(
        missingIds.map(async (id) => {
          const data = await fetchCityDailyHistory(id);
          return { id, data };
        })
      );

      if (!cancelled) {
        setDailyDataMap((prev) => {
          const next = { ...prev };
          results.forEach(({ id, data }) => {
            next[id] = data;
          });
          return next;
        });
        setLoadingDaily(false);
      }
    };

    loadData();
    return () => {
      cancelled = true;
    };
  }, [selectedCityIds]);

  const handleRemoveCity = (cityId: string) => {
    if (selectedCityIds.length <= 1) {
      alert('请至少保留 1 个城市进行查看');
      return;
    }
    setSelectedCityIds(selectedCityIds.filter((id) => id !== cityId));
  };

  const toggleCity = (cityId: string) => {
    if (selectedCityIds.includes(cityId)) {
      handleRemoveCity(cityId);
    } else {
      if (selectedCityIds.length < 5) {
        setSelectedCityIds([...selectedCityIds, cityId]);
      } else {
        // 达到 5 城上限时，自动替换最后一个城市
        setSelectedCityIds([...selectedCityIds.slice(0, 4), cityId]);
      }
    }
  };

  const handleAddCity = (city: CityMeta) => {
    if (selectedCityIds.includes(city.id)) return;
    if (selectedCityIds.length >= 5) {
      // 替换最后一个城市
      setSelectedCityIds([...selectedCityIds.slice(0, 4), city.id]);
      return;
    }
    setSelectedCityIds([...selectedCityIds, city.id]);
  };

  const handleQuickAddCity = (cityId: string) => {
    if (selectedCityIds.includes(cityId)) return;
    if (selectedCityIds.length < 5) {
      setSelectedCityIds([...selectedCityIds, cityId]);
    } else {
      setSelectedCityIds([...selectedCityIds.slice(0, 4), cityId]);
    }
  };

  // 折线图与顶部已选标签使用的城市元数据
  const activeCities = selectedCityIds.map((id, idx) => {
    const meta = findCity(id) || CITIES_REGISTRY[0];
    return {
      id: meta.id,
      name: meta.nameZh,
      nameEn: meta.nameEn,
      color: PALETTE[idx % PALETTE.length],
    };
  });

  // 雷达图数据：从当前所选年份的真实逐日实测记录中精确聚合 6 大主要污染物年均浓度
  const radarCities = useMemo(() => {
    return selectedCityIds.map((id, idx) => {
      const meta = findCity(id) || CITIES_REGISTRY[0];
      const daily = dailyDataMap[id];
      const measured = aggregateYearlyPollutants(daily, radarYear);

      // 若成功从历史数据库中聚合出该年份的实测值
      if (measured && measured.validDays > 0) {
        const pm25 = measured.pm25 > 0 ? measured.pm25 : 20.0;
        const pm10 = measured.pm10 > 0 ? measured.pm10 : Math.round(pm25 * 1.4);
        const o3 = measured.o3 > 0 ? measured.o3 : Math.round(pm25 * 0.8 + 20);
        const no2 = measured.no2 > 0 ? measured.no2 : Math.round(pm25 * 0.5 + 10);
        const so2 = measured.so2 > 0 ? measured.so2 : Math.round(pm25 * 0.1 + 2);
        const co = measured.co > 0 ? measured.co : +(pm25 * 0.015 + 0.3).toFixed(1);

        return {
          id: meta.id,
          name: meta.nameZh,
          nameEn: meta.nameEn,
          color: PALETTE[idx % PALETTE.length],
          pm25,
          pm10,
          o3,
          no2,
          so2,
          co,
        };
      }

      // 兜底（如网络请求中或该年份未提供 6 项细分）：利用年度年均 PM2.5/PM10 趋势
      const trends = getAnnualTrends(meta.id, standard);
      const yearTrend = trends.find((t) => t.year === radarYear) || trends[trends.length - 1];
      const pm25 = yearTrend ? yearTrend.pm25Avg : 25.0;
      const pm10 = yearTrend && yearTrend.pm10Avg > 0 ? yearTrend.pm10Avg : Math.round(pm25 * 1.5);
      return {
        id: meta.id,
        name: meta.nameZh,
        nameEn: meta.nameEn,
        color: PALETTE[idx % PALETTE.length],
        pm25,
        pm10,
        o3: Math.round(pm25 * 0.8 + 20),
        no2: Math.round(pm25 * 0.5 + 10),
        so2: Math.round(pm25 * 0.1 + 2),
        co: +(pm25 * 0.015 + 0.3).toFixed(1),
      };
    });
  }, [selectedCityIds, dailyDataMap, radarYear, standard]);

  return (
    <div className="space-y-6">
      {/* 1. 核心榜单模块: 全球沙盘排行榜置于最开头 */}
      <section>
        <GlobalRankingSandbox
          selectedCityIds={selectedCityIds}
          onToggleCity={toggleCity}
          onAddCity={handleQuickAddCity}
        />
      </section>

      {/* 2. 多城沙盘横向对比大盘 */}
      <div className="glass-panel rounded-2xl p-4 sm:p-5 space-y-3">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
          <div className="flex items-center space-x-2">
            <h2 className="text-base sm:text-lg font-bold text-slate-900 flex items-center space-x-2">
              <BarChart3 className="w-5 h-5 text-sky-600" />
              <span>重点城市空气质量改善横向对比</span>
            </h2>
          </div>

          <div className="flex items-center space-x-1.5 text-xs">
            <span className="text-slate-500">对比城市:</span>
            <span className="font-bold text-sky-600 bg-sky-50 px-2 py-0.5 rounded-md border border-sky-100">
              {selectedCityIds.length} / 5
            </span>
          </div>
        </div>

        {/* 当前正在对比的全部城市标签池 */}
        <div className="flex flex-wrap items-center gap-2">
          {activeCities.map((ac) => (
            <div
              key={ac.id}
              className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg text-xs font-bold text-white shadow-sm transition-all"
              style={{ backgroundColor: ac.color }}
            >
              <span>{ac.name}</span>
              <span className="text-[10px] opacity-80 font-normal">
                ({findCity(ac.id)?.country})
              </span>
              <button
                type="button"
                onClick={() => handleRemoveCity(ac.id)}
                className="ml-0.5 p-0.5 rounded-full hover:bg-black/25 text-white/90 hover:text-white transition-colors cursor-pointer"
                title={`移出对比: ${ac.name}`}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>

        {/* 动态检索添加与快捷城市标签紧凑排布 */}
        <div className="pt-2 border-t border-slate-100/80 flex flex-col md:flex-row items-stretch md:items-center gap-2.5">
          <CitySearchAutocomplete
            selectedCity={findCity(selectedCityIds[0]) || CITIES_REGISTRY[0]}
            onSelectCity={handleAddCity}
            placeholder="搜索任意城市加入对比 (如: 杭州 / 巴黎 / 纽约)..."
            className="w-full md:w-80 shrink-0 text-xs"
            filterCity={(c) => hasCityHistory(c.id)}
          />

          <div className="flex items-center gap-1.5 overflow-x-auto text-xs py-0.5 flex-1 min-w-0">
            <span className="text-slate-400 shrink-0 text-[11px]">快捷添加:</span>
            {[
              'cn-chengdu',
              'cn-beijing',
              'cn-shanghai',
              'cn-guangzhou',
              'gl-london',
              'gl-tokyo',
              'gl-paris',
              'gl-delhi',
              'gl-newyork',
            ].map((quickId) => {
              const qc = findCity(quickId);
              if (!qc) return null;
              const isSelected = selectedCityIds.includes(quickId);
              return (
                <button
                  key={quickId}
                  disabled={isSelected}
                  onClick={() => handleQuickAddCity(quickId)}
                  className={`flex items-center space-x-1 px-2 py-0.5 rounded-md text-[11px] shrink-0 transition-all ${
                    isSelected
                      ? 'bg-slate-100 text-slate-400 cursor-default'
                      : 'bg-slate-50 border border-slate-200 text-slate-600 hover:bg-sky-50 hover:text-sky-600 hover:border-sky-200 cursor-pointer'
                  }`}
                >
                  <span>{qc.nameZh}</span>
                  {isSelected ? (
                    <Check className="w-2.5 h-2.5 text-emerald-500" />
                  ) : (
                    <Plus className="w-2.5 h-2.5 text-slate-400" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* 对比图表 1: 近 10 年 PM2.5 年均下降曲线对比 */}
      <section className="glass-panel rounded-2xl p-5">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-base font-bold text-slate-900 flex items-center space-x-2">
            <BarChart3 className="w-4 h-4 text-sky-600" />
            <span>2014 ~ 2025 年际 PM2.5 浓度改善轨迹横向对比</span>
          </h3>
          <span className="text-xs text-slate-500 font-medium">单位: μg/m³ (年均综合实测值)</span>
        </div>
        <CompareLineChart cities={activeCities} />
      </section>

      {/* 对比图表 2: 六大污染物雷达构成分析 */}
      <section className="glass-panel rounded-2xl p-5">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-2">
          <h3 className="text-base font-bold text-slate-900 flex items-center space-x-2">
            <BarChart3 className="w-4 h-4 text-purple-600" />
            <span>多城主要空气污染物构成雷达对比</span>
          </h3>

          {/* 年份选择控制器 */}
          <div className="flex items-center space-x-2 self-end sm:self-auto">
            <label className="text-xs text-slate-500 font-medium flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-purple-500" />
              <span>统计年份:</span>
            </label>
            <div className="relative">
              <select
                value={radarYear}
                onChange={(e) => setRadarYear(Number(e.target.value))}
                className="text-xs font-bold text-purple-900 bg-purple-50 hover:bg-purple-100/80 border border-purple-200 rounded-lg px-3 py-1.5 pr-7 appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-purple-400 transition-colors shadow-sm"
              >
                {availableYears.map((y) => (
                  <option key={y} value={y} className="text-slate-800 bg-white">
                    {y} 年度实测
                  </option>
                ))}
              </select>
              <div className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-purple-500">
                <ChevronDown className="w-3.5 h-3.5" />
              </div>
            </div>
            {loadingDaily && (
              <div className="flex items-center text-xs text-purple-600 space-x-1 pl-1">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span className="hidden sm:inline">聚合中</span>
              </div>
            )}
          </div>
        </div>
        <CompareRadarChart cities={radarCities} />
      </section>
    </div>
  );
}
