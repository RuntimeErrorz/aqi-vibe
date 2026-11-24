'use client';

import React, { useState, useEffect, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useStandard } from '@/components/StandardContext';
import { CITIES_REGISTRY, findCity } from '@/lib/constants/cities';
import { getCountryInfo } from '@/lib/constants/countries';
import { CityMeta } from '@/lib/types';
import {
  getAnnualTrends,
  hasCityHistory,
  fetchCityDailyHistory,
  aggregateYearlyPollutants,
  getCityAvailableYears,
  isHistorySummaryLoaded,
  loadHistorySummary,
} from '@/lib/services/history-data';
import { CompareLineChart } from '@/components/CompareLineChart';
import { CompareRadarChart, RadarCityMetric } from '@/components/CompareRadarChart';
import { CitySearchAutocomplete } from '@/components/CitySearchAutocomplete';
import { GlobalRankingSandbox } from '@/components/GlobalRankingSandbox';
import { BarChart3, Plus, X, Check, Calendar, Loader2 } from 'lucide-react';

const PALETTE = ['#0284c7', '#059669', '#d97706', '#db2777', '#7c3aed'];
const DEFAULT_CITIES = ['cn-chengdu', 'cn-beijing', 'gl-london', 'gl-tokyo'];

function ComparePageContent() {
  const { standard } = useStandard();
  const searchParams = useSearchParams();
  const [summaryReady, setSummaryReady] = useState(() => isHistorySummaryLoaded());

  const [selectedCityIds, setSelectedCityIds] = useState<string[]>(() => {
    const citiesParam = searchParams.get('cities');
    if (citiesParam) {
      const parsed = citiesParam
        .split(',')
        .map((id) => findCity(id.trim())?.id)
        .filter((id): id is string => Boolean(id));
      const unique = Array.from(new Set(parsed)).slice(0, 5);
      if (unique.length > 0) return unique;
    }
    return DEFAULT_CITIES;
  });

  const [radarYear, setRadarYear] = useState<number>(() => {
    const yParam = Number(searchParams.get('year'));
    return !isNaN(yParam) && yParam >= 2014 && yParam <= 2030 ? yParam : 2025;
  });

  const [dailyDataMap, setDailyDataMap] = useState<Record<string, Record<string, any>>>({});
  const [loadingDaily, setLoadingDaily] = useState<boolean>(false);

  useEffect(() => {
    if (!isHistorySummaryLoaded()) {
      loadHistorySummary().then(() => setSummaryReady(true));
    }
  }, []);

  // URL 深度链接同步 (?cities=...&year=...)：仅在参数确实变化时调用 replaceState
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const nextCities = selectedCityIds.join(',');
    const nextYear = String(radarYear);
    if (url.searchParams.get('cities') === nextCities && url.searchParams.get('year') === nextYear) {
      return;
    }
    url.searchParams.set('cities', nextCities);
    url.searchParams.set('year', nextYear);
    window.history.replaceState({}, '', url.toString());
  }, [selectedCityIds, radarYear]);

  const availableYears = useMemo(() => {
    if (!summaryReady) return [2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019];
    const yearSet = new Set<number>();
    selectedCityIds.forEach((id) => {
      getCityAvailableYears(id).forEach((y) => yearSet.add(y));
    });
    const list = Array.from(yearSet).sort((a, b) => b - a);
    return list.length > 0 ? list : [2025, 2024, 2023, 2022, 2021, 2020, 2019];
  }, [selectedCityIds, summaryReady]);

  useEffect(() => {
    if (!summaryReady) return;
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
  }, [selectedCityIds, summaryReady]);

  const handleRemoveCity = (cityId: string) => {
    if (selectedCityIds.length <= 1) return;
    setSelectedCityIds(selectedCityIds.filter((id) => id !== cityId));
  };

  const toggleCity = (cityId: string) => {
    if (selectedCityIds.includes(cityId)) {
      handleRemoveCity(cityId);
    } else if (selectedCityIds.length < 5) {
      setSelectedCityIds([...selectedCityIds, cityId]);
    } else {
      setSelectedCityIds([...selectedCityIds.slice(0, 4), cityId]);
    }
  };

  const handleAddCity = (city: CityMeta) => {
    if (selectedCityIds.includes(city.id)) return;
    if (selectedCityIds.length >= 5) {
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

  const activeCities = selectedCityIds.map((id, idx) => {
    const meta = findCity(id) || CITIES_REGISTRY[0];
    return {
      id: meta.id,
      name: meta.nameZh,
      nameEn: meta.nameEn,
      color: PALETTE[idx % PALETTE.length],
    };
  });

  // 雷达图数据：100% 严格基于真实逐日归档聚合，严禁按系数公式伪造缺失的 O3 / NO2 / SO2 / CO！
  const radarCities: RadarCityMetric[] = useMemo(() => {
    return selectedCityIds.map((id, idx) => {
      const meta = findCity(id) || CITIES_REGISTRY[0];
      const daily = dailyDataMap[id];
      const measured = aggregateYearlyPollutants(daily, radarYear);

      if (measured && measured.validDays > 0) {
        return {
          name: meta.nameZh,
          color: PALETTE[idx % PALETTE.length],
          pm25: measured.pm25,
          pm10: measured.pm10,
          o3: measured.o3,
          no2: measured.no2,
          so2: measured.so2,
          co: measured.co,
          hasAnyData: true,
        };
      }

      // 逐日文件加载中时，仅展示汇总中已真实存在的 PM2.5 / PM10，其余气态项诚实置 null，绝不捏造
      const trends = summaryReady ? getAnnualTrends(meta.id, standard) : [];
      const yearTrend = trends.find((t) => t.year === radarYear);
      return {
        name: meta.nameZh,
        color: PALETTE[idx % PALETTE.length],
        pm25: yearTrend && yearTrend.pm25Avg > 0 ? yearTrend.pm25Avg : null,
        pm10: yearTrend && yearTrend.pm10Avg > 0 ? yearTrend.pm10Avg : null,
        o3: null,
        no2: null,
        so2: null,
        co: null,
        hasAnyData: Boolean(yearTrend && (yearTrend.pm25Avg > 0 || yearTrend.pm10Avg > 0)),
      };
    });
  }, [selectedCityIds, dailyDataMap, radarYear, standard, summaryReady]);

  return (
    <div className="space-y-6">
      {/* 1. 全球历史榜单沙盘 */}
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

        <div className="flex flex-wrap items-center gap-2">
          {activeCities.map((ac) => (
            <div
              key={ac.id}
              className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg text-xs font-bold text-white shadow-sm transition-all"
              style={{ backgroundColor: ac.color }}
            >
              <span>{ac.name}</span>
              <span className="text-[10px] opacity-85 font-normal">
                ({getCountryInfo(findCity(ac.id)?.country || '').nameZh})
              </span>
              {selectedCityIds.length > 1 && (
                <button
                  type="button"
                  onClick={() => handleRemoveCity(ac.id)}
                  className="ml-0.5 p-0.5 rounded-full hover:bg-black/25 text-white/90 hover:text-white transition-colors cursor-pointer"
                  title={`移出对比: ${ac.name}`}
                  aria-label={`移出对比 ${ac.name}`}
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="pt-2 border-t border-slate-100/80 flex flex-col md:flex-row items-stretch md:items-center gap-2.5">
          <CitySearchAutocomplete
            selectedCity={findCity(selectedCityIds[0]) || CITIES_REGISTRY[0]}
            onSelectCity={handleAddCity}
            placeholder="搜索任意城市加入对比 (如: 杭州 / 巴黎 / 纽约)..."
            className="w-full md:w-80 shrink-0 text-xs"
            filterCity={(c) => !summaryReady || hasCityHistory(c.id)}
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

      {/* 对比图表双栏并排：左侧折线轨迹 (7列) + 右侧六项雷达构成 (5列)，桌面等高并列，移动端自动上下堆叠 */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-6 items-stretch">
        {/* 对比图表 1: 近 10 年 PM2.5 年均下降曲线对比 */}
        <section className="lg:col-span-7 glass-panel rounded-2xl p-4 sm:p-5 flex flex-col min-w-0">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-2 mb-3">
            <h3 className="text-sm sm:text-base font-bold text-slate-900 flex items-center space-x-2">
              <BarChart3 className="w-4 h-4 text-sky-600 shrink-0" />
              <span>年际 PM2.5 浓度改善轨迹对比</span>
            </h3>
            <span className="text-[11px] sm:text-xs text-slate-500 font-medium whitespace-nowrap">
              单位: μg/m³ (年均综合实测)
            </span>
          </div>
          <div className="flex-1 flex flex-col justify-center">
            <CompareLineChart cities={activeCities} />
          </div>
        </section>

        {/* 对比图表 2: 六大污染物雷达构成分析 */}
        <section className="lg:col-span-5 glass-panel rounded-2xl p-4 sm:p-5 flex flex-col min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h3 className="text-sm sm:text-base font-bold text-slate-900 flex items-center space-x-2">
              <BarChart3 className="w-4 h-4 text-purple-600 shrink-0" />
              <span>污染物实测构成雷达</span>
            </h3>

            <div className="flex items-center space-x-1.5">
              <Calendar className="w-3.5 h-3.5 text-purple-500 shrink-0" />
              <select
                value={radarYear}
                onChange={(e) => setRadarYear(Number(e.target.value))}
                aria-label="选择雷达图统计年份"
                className="text-xs font-bold text-purple-900 bg-purple-50 hover:bg-purple-100/80 border border-purple-200 rounded-lg px-2.5 py-1 cursor-pointer focus:outline-none focus:ring-2 focus:ring-purple-400 transition-colors shadow-sm"
              >
                {availableYears.map((y) => (
                  <option key={y} value={y} className="text-slate-800 bg-white">
                    {y} 年度
                  </option>
                ))}
              </select>
              {loadingDaily && <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-600 shrink-0" />}
            </div>
          </div>
          <div className="flex-1 flex flex-col justify-center">
            <CompareRadarChart cities={radarCities} loading={loadingDaily || !summaryReady} />
          </div>
        </section>
      </div>
    </div>
  );
}

export default function ComparePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[60vh] flex flex-col items-center justify-center space-y-3">
          <Loader2 className="w-8 h-8 animate-spin text-sky-600" />
          <p className="text-xs text-slate-500 font-medium">正在加载全球对比沙盘...</p>
        </div>
      }
    >
      <ComparePageContent />
    </Suspense>
  );
}
