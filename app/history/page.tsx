'use client';

import React, { useState, useEffect, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useStandard } from '@/components/StandardContext';
import { CITIES_REGISTRY, findCity, DOMESTIC_CITY_COUNT, GLOBAL_CITY_COUNT } from '@/lib/constants/cities';
import {
  getAnnualTrends,
  get365CalendarHeatmap,
  getCityAvailableYears,
  fetchCityDailyHistory,
  hasCityHistory,
  isHistorySummaryLoaded,
  loadHistorySummary,
  aggregateMonthlySeasonality,
} from '@/lib/services/history-data';
import { CalendarHeatmap } from '@/components/CalendarHeatmap';
import { AnnualTrendChart } from '@/components/AnnualTrendChart';
import { SeasonalChart } from '@/components/SeasonalChart';
import { CitySearchAutocomplete } from '@/components/CitySearchAutocomplete';
import {
  History,
  Download,
  TrendingDown,
  TrendingUp,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Gauge,
} from 'lucide-react';
import { getCNEvaluation, getUSEvaluation, calculatePM25AQI } from '@/lib/aqi-calculator';

function HistoryPageContent() {
  const { standard, onlyPm25, favoriteCityId, activeCityId, setActiveCityId, mounted } = useStandard();
  const searchParams = useSearchParams();
  const cityParam = searchParams.get('city');
  const yearParam = searchParams.get('year');

  const [summaryReady, setSummaryReady] = useState(() => isHistorySummaryLoaded());
  const [initReady, setInitReady] = useState(false);
  const [selectedCityId, setSelectedCityId] = useState<string>(() => {
    if (cityParam) {
      const found = findCity(cityParam);
      if (found) return found.id;
    }
    const active = findCity(activeCityId);
    if (active) return active.id;
    return 'cn-chengdu';
  });
  const initStartedRef = React.useRef(false);

  // 挂载且摘要就绪后，单次完成初始城市对齐（避免在 URL replaceState 前后与 cityParam 形成双向循环）
  useEffect(() => {
    if (!mounted || !summaryReady || initStartedRef.current) return;
    initStartedRef.current = true;
    if (cityParam) {
      const found = findCity(cityParam);
      if (found && hasCityHistory(found.id)) {
        setSelectedCityId(found.id);
        if (found.id !== activeCityId) setActiveCityId(found.id);
      }
    } else {
      const targetId = hasCityHistory(activeCityId) ? activeCityId : favoriteCityId;
      if (targetId && hasCityHistory(targetId)) {
        setSelectedCityId(targetId);
      }
    }
    setInitReady(true);
  }, [mounted, summaryReady, cityParam, activeCityId, favoriteCityId, setActiveCityId]);

  // 响应 Header 全局城市切换器
  useEffect(() => {
    if (!initReady || !summaryReady) return;
    if (activeCityId && activeCityId !== selectedCityId && hasCityHistory(activeCityId)) {
      setSelectedCityId(activeCityId);
    }
  }, [activeCityId, initReady, summaryReady, selectedCityId]);

  const [selectedYear, setSelectedYear] = useState<number>(() => {
    if (yearParam) {
      const parsedYear = Number(yearParam);
      if (!isNaN(parsedYear)) return parsedYear;
    }
    return 2025;
  });

  const [dailyRecords, setDailyRecords] = useState<Record<string, any>>({});
  const [loadingDaily, setLoadingDaily] = useState(false);

  // 异步按需加载 1.8MB history_summary.json（绝不静态打包进 JS）
  useEffect(() => {
    if (!isHistorySummaryLoaded()) {
      loadHistorySummary().then(() => setSummaryReady(true));
    }
  }, []);

  useEffect(() => {
    if (yearParam && !initReady) {
      const parsedYear = Number(yearParam);
      if (!isNaN(parsedYear)) {
        setSelectedYear(parsedYear);
      }
    }
  }, [yearParam, initReady]);

  const rawCity = findCity(selectedCityId);
  const city =
    rawCity && (!summaryReady || hasCityHistory(rawCity.id))
      ? rawCity
      : findCity('cn-chengdu') || CITIES_REGISTRY[0];

  const annualTrends = useMemo(
    () => (summaryReady ? getAnnualTrends(city.id, standard, onlyPm25) : []),
    [summaryReady, city.id, standard, onlyPm25]
  );

  const availableYears = useMemo(
    () => (summaryReady ? getCityAvailableYears(city.id) : []),
    [summaryReady, city.id]
  );

  // 切换城市时若年份不存在则自动对齐最新年份
  useEffect(() => {
    if (availableYears.length > 0 && !availableYears.includes(selectedYear)) {
      setSelectedYear(availableYears[0]);
    }
  }, [city.id, availableYears, selectedYear]);

  // URL 深度链接同步 (?city=...&year=...)：仅在初始化完成后且 URL 确实不一致时才更新，杜绝 replaceState 乒乓循环
  useEffect(() => {
    if (typeof window === 'undefined' || !summaryReady || !initReady) return;
    const url = new URL(window.location.href);
    const nextYearStr = String(selectedYear);
    if (url.searchParams.get('city') === city.id && url.searchParams.get('year') === nextYearStr) {
      return;
    }
    url.searchParams.set('city', city.id);
    url.searchParams.set('year', nextYearStr);
    window.history.replaceState({}, '', url.toString());
  }, [city.id, selectedYear, summaryReady, initReady]);

  // 异步获取逐日实测全量历史：切换城市时立即清空旧城市逐日记录，彻底杜绝旧城市日历/季节图残留
  useEffect(() => {
    if (!summaryReady) return;
    let active = true;
    setDailyRecords({});
    setLoadingDaily(true);
    fetchCityDailyHistory(city.id).then((daily) => {
      if (active) {
        setDailyRecords(daily);
        setLoadingDaily(false);
      }
    });
    return () => {
      active = false;
    };
  }, [city.id, summaryReady]);

  const calendarData = useMemo(
    () => get365CalendarHeatmap(city.id, selectedYear, standard, dailyRecords, onlyPm25),
    [city.id, selectedYear, standard, dailyRecords, onlyPm25]
  );

  const monthlySelectedYear = useMemo(
    () => aggregateMonthlySeasonality(dailyRecords, standard, onlyPm25, selectedYear),
    [dailyRecords, standard, onlyPm25, selectedYear]
  );

  const monthlyAllYears = useMemo(
    () => aggregateMonthlySeasonality(dailyRecords, standard, onlyPm25),
    [dailyRecords, standard, onlyPm25]
  );

  const firstYearObj = annualTrends[0];
  const currentYearObj = annualTrends.find((t) => t.year === selectedYear);
  const prevYearObj = annualTrends.find((t) => t.year === selectedYear - 1);

  const validTotalDays = calendarData.length > 0 ? calendarData.length : (currentYearObj?.daysCount ?? 0);
  const compliantDaysCount =
    calendarData.length > 0
      ? calendarData.filter((d) => d.aqi > 0 && d.aqi <= 100).length
      : Math.max(0, validTotalDays - (currentYearObj?.pollutedDays ?? 0));
  const compliantRatio =
    calendarData.length > 0 && validTotalDays > 0
      ? Math.round((compliantDaysCount / validTotalDays) * 100)
      : (currentYearObj?.goodDaysRatio ?? 0);
  const pollutedDaysCount =
    calendarData.length > 0
      ? calendarData.filter((d) => d.aqi > 100).length
      : (currentYearObj?.pollutedDays ?? 0);

  const firstYearPM25 = firstYearObj?.pm25Avg || 0;
  const validPm25Days = calendarData.filter((d) => typeof d.pm25 === 'number' && d.pm25 > 0);
  const currentYearPM25 =
    currentYearObj?.pm25Avg ??
    (validPm25Days.length > 0
      ? Math.round((validPm25Days.reduce((acc, d) => acc + (d.pm25 as number), 0) / validPm25Days.length) * 10) / 10
      : 0);

  const validAqiDays = calendarData.filter((d) => typeof d.aqi === 'number' && d.aqi > 0);
  const dailyAvgAQI =
    validAqiDays.length > 0
      ? Math.round(validAqiDays.reduce((acc, d) => acc + d.aqi, 0) / validAqiDays.length)
      : (currentYearObj?.aqiAvg ?? 0);

  const avgAQI = onlyPm25
    ? currentYearPM25 > 0
      ? calculatePM25AQI(currentYearPM25, standard, 'daily')
      : dailyAvgAQI
    : dailyAvgAQI;

  const avgEvaluation = standard === 'CN' ? getCNEvaluation(avgAQI) : getUSEvaluation(avgAQI);
  const isBaselineYear = Boolean(firstYearObj && selectedYear === firstYearObj.year);

  const baselineRate =
    !isBaselineYear && firstYearPM25 > 0 && currentYearPM25 > 0
      ? (((currentYearPM25 - firstYearPM25) / firstYearPM25) * 100).toFixed(1)
      : null;

  const yoyRate =
    prevYearObj && prevYearObj.pm25Avg > 0 && currentYearPM25 > 0
      ? (((currentYearPM25 - prevYearObj.pm25Avg) / prevYearObj.pm25Avg) * 100).toFixed(1)
      : null;

  // 安全可靠的 Blob CSV 导出（支持大文件、特殊字符与防 Excel 公式注入转义）
  const handleExportCSV = () => {
    const csvCell = (val: unknown) => {
      const str = String(val ?? '--');
      const safe = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
      return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    const rows = [
      '日期,AQI,质量等级,首要污染物,PM2.5(ug/m3),PM10(ug/m3),O3(ug/m3),NO2(ug/m3),SO2(ug/m3),CO(mg/m3)',
      ...calendarData.map((row) => {
        const primary = row.aqi <= 50 ? '无' : (row.primaryPollutantName || row.primaryPollutant || 'PM2.5');
        return [
          csvCell(row.date),
          row.aqi,
          csvCell(row.level),
          csvCell(primary),
          row.pm25 ?? '--',
          row.pm10 ?? '--',
          row.o3 ?? '--',
          row.no2 ?? '--',
          row.so2 ?? '--',
          row.co ?? '--',
        ].join(',');
      }),
    ];

    const blob = new Blob(['\uFEFF' + rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${city.nameZh}_${selectedYear}_空气质量历史统计_${standard}${onlyPm25 ? '_仅PM2.5' : ''}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* 顶部控制栏 */}
      <div className="glass-panel rounded-2xl p-4 sm:p-5 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
        <div className="flex items-center space-x-2 shrink-0">
          <History className="w-5 h-5 text-sky-600" />
          <h1 className="text-lg font-bold text-slate-900 tracking-tight">空气质量历史数据</h1>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 text-xs flex-1 md:max-w-3xl justify-end">
          <CitySearchAutocomplete
            selectedCity={city}
            onSelectCity={(newCity) => {
              setSelectedCityId(newCity.id);
              setActiveCityId(newCity.id);
            }}
            placeholder={`搜索国内 ${DOMESTIC_CITY_COUNT} 城市或全球 ${GLOBAL_CITY_COUNT} 城市历史档案 (如: 成都 / 北京 / Tokyo)...`}
            className="w-full sm:flex-1"
            filterCity={(c) => !summaryReady || hasCityHistory(c.id)}
          />

          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
            aria-label="选择统计年份"
            className="px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 font-semibold focus:outline-none focus:border-sky-500 shadow-sm shrink-0 cursor-pointer hover:bg-slate-100 transition-colors"
          >
            {availableYears.map((y) => (
              <option key={y} value={y}>
                {y} 年度
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={handleExportCSV}
            disabled={calendarData.length === 0}
            className="flex items-center justify-center space-x-1.5 px-3.5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-semibold transition-colors shrink-0 shadow-sm cursor-pointer"
            title="导出为 CSV 电子表格"
          >
            <Download className="w-3.5 h-3.5" />
            <span>导出 CSV</span>
          </button>
        </div>
      </div>

      {/* 年度总体成就 Scorecard */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="glass-panel rounded-2xl p-4 sm:p-5 flex items-center justify-between">
          <div className="flex-1 min-w-0 pr-3">
            <p className="text-xs text-slate-500 font-medium">年度综合等效 AQI</p>
            <div className="flex items-baseline space-x-2 mt-1 sm:mt-1.5 min-h-[32px]">
              {!mounted || !summaryReady ? (
                <span className="h-7 w-20 bg-slate-200/70 rounded-md animate-pulse inline-block" />
              ) : (
                <>
                  <span className="text-2xl sm:text-3xl font-black" style={{ color: avgEvaluation.color }}>
                    {avgAQI}
                  </span>
                  <span
                    className="text-[10px] sm:text-[11px] px-1.5 sm:px-2 py-0.5 rounded-md font-bold shrink-0"
                    style={{ backgroundColor: `${avgEvaluation.color}18`, color: avgEvaluation.color }}
                  >
                    {avgEvaluation.level}
                  </span>
                </>
              )}
            </div>
            <p className="text-[11px] sm:text-xs text-slate-400 mt-1">
              {onlyPm25 ? '基于年均 PM2.5 浓度折算' : '全年在册日均实测均值'}
            </p>
          </div>
          <Gauge className="w-7 h-7 sm:w-8 sm:h-8 shrink-0" style={{ color: `${avgEvaluation.color}50` }} />
        </div>

        <div className="glass-panel rounded-2xl p-4 sm:p-5 flex items-center justify-between">
          <div className="flex-1 min-w-0 pr-3">
            <p className="text-xs text-slate-500 font-medium">优良天数比例</p>
            <div className="flex items-baseline space-x-2 mt-1 sm:mt-1.5 min-h-[32px]">
              {!mounted || !summaryReady ? (
                <span className="h-7 w-16 bg-slate-200/70 rounded-md animate-pulse inline-block" />
              ) : (
                <span className="text-2xl sm:text-3xl font-black text-emerald-600">{compliantRatio}%</span>
              )}
            </div>
            <p className="text-[11px] sm:text-xs text-slate-500 mt-1">
              {!mounted || !summaryReady ? (
                <span className="h-3.5 w-28 bg-slate-100 rounded animate-pulse inline-block" />
              ) : (
                `共 ${compliantDaysCount} 天达标 / 实测 ${validTotalDays} 天`
              )}
            </p>
          </div>
          <CheckCircle2 className="w-7 h-7 sm:w-8 sm:h-8 text-emerald-500/20 shrink-0" />
        </div>

        <div className="glass-panel rounded-2xl p-4 sm:p-5 flex items-center justify-between">
          <div className="flex-1 min-w-0 pr-3">
            <p className="text-xs text-slate-500 font-medium">超标污染天数</p>
            <div className="flex items-baseline space-x-2 mt-1 sm:mt-1.5 min-h-[32px]">
              {!mounted || !summaryReady ? (
                <span className="h-7 w-16 bg-slate-200/70 rounded-md animate-pulse inline-block" />
              ) : (
                <span className="text-2xl sm:text-3xl font-black text-rose-600">{pollutedDaysCount} 天</span>
              )}
            </div>
            <p className="text-[11px] sm:text-xs text-slate-500 mt-1">
              {!mounted || !summaryReady ? (
                <span className="h-3.5 w-24 bg-slate-100 rounded animate-pulse inline-block" />
              ) : (
                `超标占比 ${validTotalDays > 0 ? ((pollutedDaysCount / validTotalDays) * 100).toFixed(1) : 0}%`
              )}
            </p>
          </div>
          <AlertCircle className="w-7 h-7 sm:w-8 sm:h-8 text-rose-500/20 shrink-0" />
        </div>

        <div className="glass-panel rounded-2xl p-4 sm:p-5 flex items-center justify-between">
          <div className="flex-1 min-w-0 pr-3">
            <p className="text-xs text-slate-500 font-medium">
              {isBaselineYear ? '治理监测基准' : `治理改善成效 ${firstYearObj ? `(较 ${firstYearObj.year})` : ''}`}
            </p>
            <div className="flex items-baseline space-x-2 mt-1 sm:mt-1.5 min-h-[32px]">
              {!mounted || !summaryReady ? (
                <span className="h-7 w-16 bg-slate-200/70 rounded-md animate-pulse inline-block" />
              ) : isBaselineYear ? (
                <span className="text-xl sm:text-2xl md:text-3xl font-black text-slate-700">基准首年</span>
              ) : baselineRate !== null ? (
                <span
                  className={`text-2xl sm:text-3xl font-black ${
                    Number(baselineRate) <= 0 ? 'text-sky-600' : 'text-rose-600'
                  }`}
                >
                  {Number(baselineRate) > 0 ? `+${baselineRate}%` : `${baselineRate}%`}
                </span>
              ) : (
                <span className="text-2xl sm:text-3xl font-black text-slate-400">--</span>
              )}
            </div>
            <p className="text-[11px] sm:text-xs text-slate-500 mt-1 truncate">
              {!mounted || !summaryReady ? (
                <span className="h-3.5 w-28 bg-slate-100 rounded animate-pulse inline-block" />
              ) : isBaselineYear ? (
                `起始首年 PM2.5: ${firstYearPM25} μg/m³`
              ) : firstYearObj && currentYearPM25 > 0 ? (
                <span>
                  {firstYearPM25} → {currentYearPM25} μg/m³
                  {yoyRate !== null && (
                    <span className="ml-1 text-slate-400 font-normal">
                      (环比{Number(yoyRate) > 0 ? `+${yoyRate}` : yoyRate}%)
                    </span>
                  )}
                </span>
              ) : (
                'PM2.5 真实演进轨迹'
              )}
            </p>
          </div>
          {isBaselineYear ? (
            <Gauge className="w-7 h-7 sm:w-8 sm:h-8 text-slate-400/20 shrink-0" />
          ) : Number(baselineRate ?? 0) <= 0 ? (
            <TrendingDown className="w-7 h-7 sm:w-8 sm:h-8 text-sky-500/20 shrink-0" />
          ) : (
            <TrendingUp className="w-7 h-7 sm:w-8 sm:h-8 text-rose-500/20 shrink-0" />
          )}
        </div>
      </div>

      {/* 核心图表 1: 365 天时间机器日历热力图 */}
      <section className="glass-panel rounded-2xl p-4 sm:p-5">
        <CalendarHeatmap
          data={calendarData}
          year={selectedYear}
          standard={standard}
          onlyPm25={onlyPm25}
          cityName={city.nameZh}
          loadingDaily={loadingDaily || !summaryReady}
          availableYears={availableYears}
        />
      </section>

      {/* 核心图表 2: 12 个月季节污染律动 */}
      <section className="glass-panel rounded-2xl p-4 sm:p-5">
        <SeasonalChart
          monthlySelectedYear={monthlySelectedYear}
          monthlyAllYears={monthlyAllYears}
          selectedYear={selectedYear}
          cityName={city.nameZh}
          loading={loadingDaily || !summaryReady}
        />
      </section>

      {/* 核心图表 3: 长期治理改善折线与优良率柱状图 */}
      <section className="glass-panel rounded-2xl p-4 sm:p-5">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm sm:text-base font-bold text-slate-900 flex items-center space-x-2">
            <TrendingDown className="w-4 h-4 text-emerald-600" />
            <span>
              {annualTrends.length > 0
                ? `${annualTrends[0].year} ~ ${annualTrends[annualTrends.length - 1].year} 年际长期趋势`
                : '年际趋势'}
            </span>
          </h3>
        </div>
        {annualTrends.length > 0 ? (
          <AnnualTrendChart data={annualTrends} cityName={city.nameZh} standard={standard} onlyPm25={onlyPm25} />
        ) : (
          <div className="h-64 flex items-center justify-center text-slate-400 text-sm">
            {!summaryReady ? '正在加载年度历史统计...' : '暂无该城市的长期年度实测记录'}
          </div>
        )}
      </section>
    </div>
  );
}

export default function HistoryPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[60vh] flex flex-col items-center justify-center space-y-3">
          <Loader2 className="w-8 h-8 animate-spin text-sky-600" />
          <p className="text-xs text-slate-500 font-medium">正在加载空气质量历史数据...</p>
        </div>
      }
    >
      <HistoryPageContent />
    </Suspense>
  );
}
