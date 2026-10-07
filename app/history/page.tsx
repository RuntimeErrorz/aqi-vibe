'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useStandard } from '@/components/StandardContext';
import { CITIES_REGISTRY, findCity } from '@/lib/constants/cities';
import { getAnnualTrends, get365CalendarHeatmap, getCityAvailableYears, fetchCityDailyHistory, hasCityHistory } from '@/lib/services/history-data';
import { CalendarHeatmap } from '@/components/CalendarHeatmap';
import { AnnualTrendChart } from '@/components/AnnualTrendChart';
import { CitySearchAutocomplete } from '@/components/CitySearchAutocomplete';
import { History, Download, Calendar, TrendingDown, TrendingUp, CheckCircle2, AlertCircle, Loader2, Gauge } from 'lucide-react';
import { getCNEvaluation, getUSEvaluation } from '@/lib/aqi-calculator';

function HistoryPageContent() {
  const { standard } = useStandard();
  const searchParams = useSearchParams();
  const cityParam = searchParams.get('city');
  const yearParam = searchParams.get('year');

  const [selectedCityId, setSelectedCityId] = useState<string>(() => {
    if (cityParam) {
      const found = findCity(cityParam);
      if (found && hasCityHistory(found.id)) {
        return found.id;
      }
    }
    return 'cn-chengdu'; // 默认展示成都
  });

  const [selectedYear, setSelectedYear] = useState<number>(() => {
    if (yearParam) {
      const parsedYear = Number(yearParam);
      if (!isNaN(parsedYear)) return parsedYear;
    }
    return 2025;
  });

  const [dailyRecords, setDailyRecords] = useState<Record<string, any>>({});
  const [loadingDaily, setLoadingDaily] = useState(false);

  // 当 URL 参数变化时同步更新状态（如从排行榜点击不同城市或年份跳转过来）
  useEffect(() => {
    if (cityParam) {
      const found = findCity(cityParam);
      if (found && hasCityHistory(found.id)) {
        setSelectedCityId(found.id);
      }
    }
  }, [cityParam]);

  useEffect(() => {
    if (yearParam) {
      const parsedYear = Number(yearParam);
      if (!isNaN(parsedYear)) {
        setSelectedYear(parsedYear);
      }
    }
  }, [yearParam]);

  const rawCity = findCity(selectedCityId);
  const city = rawCity && hasCityHistory(rawCity.id) ? rawCity : (findCity('cn-chengdu') || CITIES_REGISTRY[0]);
  const annualTrends = getAnnualTrends(city.id, standard);
  const availableYears = getCityAvailableYears(city.id);

  // 当切换城市时，若当前选中的年份在目标城市中不存在，自动调整为该城市最新年份
  useEffect(() => {
    if (availableYears.length > 0 && !availableYears.includes(selectedYear)) {
      setSelectedYear(availableYears[0]);
    }
  }, [city.id, availableYears, selectedYear]);

  // 异步获取当前选中国内或全球城市的逐日实测全量历史
  useEffect(() => {
    let active = true;
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
  }, [city.id]);

  const calendarData = get365CalendarHeatmap(city.id, selectedYear, standard, dailyRecords);

  // 统计不同标准下的天数分布与年均 AQI（基于该年份实际有效实测天数）
  const validTotalDays = calendarData.length;
  const goodDaysCount = calendarData.filter((d) => d.aqi <= (standard === 'CN' ? 100 : 50)).length;
  const compliantDaysCount = calendarData.filter((d) => d.aqi <= 100).length;
  const compliantRatio = validTotalDays > 0 ? Math.round((compliantDaysCount / validTotalDays) * 100) : 0;
  const pollutedDaysCount = calendarData.filter((d) => d.aqi > 100).length;
  const avgAQI =
    validTotalDays > 0
      ? Math.round(calendarData.reduce((acc, d) => acc + d.aqi, 0) / validTotalDays)
      : (annualTrends.find((t) => t.year === selectedYear)?.aqiAvg ?? 0);

  const avgEvaluation = standard === 'CN' ? getCNEvaluation(avgAQI) : getUSEvaluation(avgAQI);

  // 动态计算选定年份较历史基准年（如 2014）与较上一年度（环比）的真实 PM2.5 治理成效
  const firstYearObj = annualTrends[0];
  const currentYearObj = annualTrends.find((t) => t.year === selectedYear);
  const prevYearObj = annualTrends.find((t) => t.year === selectedYear - 1);

  const firstYearPM25 = firstYearObj?.pm25Avg || 0;
  const currentYearPM25 =
    currentYearObj?.pm25Avg ??
    (validTotalDays > 0
      ? Math.round((calendarData.reduce((acc, d) => acc + (d.pm25 || 0), 0) / validTotalDays) * 10) / 10
      : 0);

  const isBaselineYear = Boolean(firstYearObj && selectedYear === firstYearObj.year);

  // 较基准年累积削减改善率
  const baselineRate =
    !isBaselineYear && firstYearPM25 > 0 && currentYearPM25 > 0
      ? (((currentYearPM25 - firstYearPM25) / firstYearPM25) * 100).toFixed(1)
      : null;

  // 较上一年环比变化率
  const yoyRate =
    prevYearObj && prevYearObj.pm25Avg > 0 && currentYearPM25 > 0
      ? (((currentYearPM25 - prevYearObj.pm25Avg) / prevYearObj.pm25Avg) * 100).toFixed(1)
      : null;

  // 导出 CSV 功能
  const handleExportCSV = () => {
    let csvContent = 'data:text/csv;charset=utf-8,\uFEFF';
    const stdLabel = standard === 'CN' ? '国标(HJ 633)' : '美标(US EPA)';
    csvContent += `日期,AQI(${stdLabel}),质量等级,首要污染物,PM2.5(ug/m3),PM10(ug/m3),O3(ug/m3),NO2(ug/m3),SO2(ug/m3),CO(mg/m3)\n`;
    calendarData.forEach((row) => {
      const primary = row.aqi <= 50 ? '无' : (row.primaryPollutantName || row.primaryPollutant || 'PM2.5');
      csvContent += `${row.date},${row.aqi},${row.level},${primary},${row.pm25 ?? '--'},${row.pm10 ?? '--'},${row.o3 ?? '--'},${row.no2 ?? '--'},${row.so2 ?? '--'},${row.co ?? '--'}\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `${city.nameZh}_${selectedYear}_空气质量历史统计_${standard}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      {/* 顶部控制栏 */}
      <div className="glass-panel rounded-2xl p-4 sm:p-5 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
        {/* 左侧简洁标题 */}
        <div className="flex items-center space-x-2 shrink-0">
          <History className="w-5 h-5 text-sky-600" />
          <h1 className="text-lg font-bold text-slate-900 tracking-tight">空气质量历史数据</h1>
        </div>

        {/* 城市与年份选择器 (给足横向宽度与呼吸空间) */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 text-xs flex-1 md:max-w-3xl justify-end">
          <CitySearchAutocomplete
            selectedCity={city}
            onSelectCity={(newCity) => setSelectedCityId(newCity.id)}
            placeholder="搜索国内 375 城市或全球 553 城市历史数据 (如: 成都 / 北京 / Tokyo / 巴黎)..."
            className="w-full sm:flex-1"
            filterCity={(c) => hasCityHistory(c.id)}
          />

          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
            className="px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 font-semibold focus:outline-none focus:border-sky-500 shadow-sm shrink-0 cursor-pointer hover:bg-slate-100 transition-colors"
          >
            {availableYears.map((y) => (
              <option key={y} value={y}>
                {y} 年度
              </option>
            ))}
          </select>

          <button
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

      {/* 年度总体成就 Scorecard: 4 卡片现代化权威看板 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* 卡片 1: 年度综合等效 AQI (独立大字显眼看板) */}
        <div className="glass-panel rounded-2xl p-5 flex items-center justify-between">
          <div className="flex-1 min-w-0 pr-3">
            <p className="text-xs text-slate-500 font-medium">年度综合等效 AQI</p>
            <div className="flex items-baseline space-x-2.5 mt-1.5">
              <span className="text-3xl font-black" style={{ color: avgEvaluation.color }}>
                {avgAQI}
              </span>
              <span
                className="text-[11px] px-2 py-0.5 rounded-md font-bold shrink-0"
                style={{ backgroundColor: `${avgEvaluation.color}18`, color: avgEvaluation.color }}
              >
                {avgEvaluation.level}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              全年在册实测均值 ({standard === 'CN' ? '国标 HJ 633' : '美标 US EPA'})
            </p>
          </div>
          <Gauge className="w-8 h-8 shrink-0" style={{ color: `${avgEvaluation.color}50` }} />
        </div>

        {/* 卡片 2: 优良/达标天数比例 */}
        <div className="glass-panel rounded-2xl p-5 flex items-center justify-between">
          <div className="flex-1 min-w-0 pr-3">
            <p className="text-xs text-slate-500 font-medium">
              {standard === 'CN' ? '国标优良天数比例 (优+良)' : '美标达标天数比例 (Good+Mod)'}
            </p>
            <div className="flex items-baseline space-x-2 mt-1.5">
              <span className="text-3xl font-black text-emerald-600">{compliantRatio}%</span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              共 {compliantDaysCount} 天达标 / 实测 {validTotalDays} 天
            </p>
          </div>
          <CheckCircle2 className="w-8 h-8 text-emerald-500/20 shrink-0" />
        </div>

        {/* 卡片 3: 超标污染天数 */}
        <div className="glass-panel rounded-2xl p-5 flex items-center justify-between">
          <div className="flex-1 min-w-0 pr-3">
            <p className="text-xs text-slate-500 font-medium">
              {standard === 'CN' ? '超标污染天数 (轻度及以上)' : '美标不健康天数 (USG及以上)'}
            </p>
            <div className="flex items-baseline space-x-2 mt-1.5">
              <span className="text-3xl font-black text-rose-600">{pollutedDaysCount} 天</span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              超标占比 {validTotalDays > 0 ? ((pollutedDaysCount / validTotalDays) * 100).toFixed(1) : 0}%
            </p>
          </div>
          <AlertCircle className="w-8 h-8 text-rose-500/20 shrink-0" />
        </div>

        {/* 卡片 4: 治理改善成效 (随选中年份动态联动) */}
        <div className="glass-panel rounded-2xl p-5 flex items-center justify-between">
          <div className="flex-1 min-w-0 pr-3">
            <p className="text-xs text-slate-500 font-medium">
              {isBaselineYear
                ? '治理监测基准'
                : `治理改善成效 ${firstYearObj ? `(较 ${firstYearObj.year})` : ''}`}
            </p>
            <div className="flex items-baseline space-x-2 mt-1.5">
              {isBaselineYear ? (
                <span className="text-2xl sm:text-3xl font-black text-slate-700">基准首年</span>
              ) : baselineRate !== null ? (
                <span
                  className={`text-3xl font-black ${
                    Number(baselineRate) <= 0 ? 'text-sky-600' : 'text-rose-600'
                  }`}
                >
                  {Number(baselineRate) > 0 ? `+${baselineRate}%` : `${baselineRate}%`}
                </span>
              ) : (
                <span className="text-3xl font-black text-slate-400">--</span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-1 truncate">
              {isBaselineYear ? (
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
            <Gauge className="w-8 h-8 text-slate-400/20 shrink-0" />
          ) : Number(baselineRate ?? 0) <= 0 ? (
            <TrendingDown className="w-8 h-8 text-sky-500/20 shrink-0" />
          ) : (
            <TrendingUp className="w-8 h-8 text-rose-500/20 shrink-0" />
          )}
        </div>
      </div>

      {/* 核心图表 1: 365 天时间机器日历热力图 */}
      <section className="glass-panel rounded-2xl p-5">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-base font-bold text-slate-900 flex items-center space-x-2">
            <Calendar className="w-4 h-4 text-sky-600" />
            <span>
              {city.nameZh} {selectedYear} 年逐日日历热力全景谱系
            </span>
          </h3>
          <div className="flex items-center space-x-2 text-xs text-slate-500">
            {loadingDaily && (
              <span className="flex items-center space-x-1 text-sky-600">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>实测数据同步中...</span>
              </span>
            )}
            <span>
              换算基准: {standard === 'CN' ? '中国国标 (HJ 633)' : '美标 (US EPA NowCast)'} · 格子颜色对应实测等级
            </span>
          </div>
        </div>
        {validTotalDays > 0 ? (
          <CalendarHeatmap data={calendarData} year={selectedYear} standard={standard} />
        ) : (
          <div className="h-56 flex flex-col items-center justify-center text-slate-400 text-sm space-y-2">
            <Calendar className="w-8 h-8 text-slate-300" />
            <p>该城市在 {selectedYear} 年度暂无官方逐日实测归档记录</p>
            <p className="text-xs text-slate-400">
              请在上方下拉菜单中切换到该城市有实测记录的年份 ({availableYears.join(', ')})
            </p>
          </div>
        )}
      </section>

      {/* 核心图表 2: 长期治理改善折线与优良率柱状图 */}
      <section className="glass-panel rounded-2xl p-5">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-base font-bold text-slate-900 flex items-center space-x-2">
            <TrendingDown className="w-4 h-4 text-emerald-600" />
            <span>
              {annualTrends.length > 0 ? `${annualTrends[0].year} ~ ${annualTrends[annualTrends.length - 1].year}` : ''} 年际长期治理成效与蓝天保卫战成果
            </span>
          </h3>
          <span className="text-xs text-slate-500">
            评价标准: {standard === 'CN' ? '中国国标 (HJ 633)' : '美标 (US EPA)'} · 基于真实实测数据按所选标准动态计算
          </span>
        </div>
        {annualTrends.length > 0 ? (
          <AnnualTrendChart data={annualTrends} cityName={city.nameZh} standard={standard} />
        ) : (
          <div className="h-64 flex items-center justify-center text-slate-400 text-sm">
            暂无该城市的长期年度实测记录
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
