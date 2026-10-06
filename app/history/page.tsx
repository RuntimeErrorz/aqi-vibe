'use client';

import React, { useState, useEffect } from 'react';
import { useStandard } from '@/components/StandardContext';
import { CITIES_REGISTRY, findCity } from '@/lib/constants/cities';
import { getAnnualTrends, get365CalendarHeatmap, getCityAvailableYears, fetchCityDailyHistory } from '@/lib/services/history-data';
import { CalendarHeatmap } from '@/components/CalendarHeatmap';
import { AnnualTrendChart } from '@/components/AnnualTrendChart';
import { CitySearchAutocomplete } from '@/components/CitySearchAutocomplete';
import { History, Download, Calendar, TrendingDown, Sun, Snowflake, CheckCircle2, AlertCircle, Sparkles, Loader2 } from 'lucide-react';

export default function HistoryPage() {
  const { standard } = useStandard();
  const [selectedCityId, setSelectedCityId] = useState('cn-chengdu'); // 默认展示成都
  const [selectedYear, setSelectedYear] = useState(2025);
  const [dailyRecords, setDailyRecords] = useState<Record<string, any>>({});
  const [loadingDaily, setLoadingDaily] = useState(false);

  const city = findCity(selectedCityId) || CITIES_REGISTRY[0];
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
  const goodDaysCount = calendarData.filter((d) => d[1] <= (standard === 'CN' ? 100 : 50)).length;
  const compliantDaysCount = calendarData.filter((d) => d[1] <= 100).length;
  const compliantRatio = validTotalDays > 0 ? Math.round((compliantDaysCount / validTotalDays) * 100) : 0;
  const pollutedDaysCount = calendarData.filter((d) => d[1] > 100).length;
  const avgAQI =
    validTotalDays > 0
      ? Math.round(calendarData.reduce((acc, d) => acc + d[1], 0) / validTotalDays)
      : (annualTrends.find((t) => t.year === selectedYear)?.aqiAvg ?? 0);

  // 动态计算该城市历史第一年到最近一年的真实 PM2.5 削减改善幅度
  const firstYearObj = annualTrends[0];
  const lastYearObj = annualTrends[annualTrends.length - 1];
  const firstYearPM25 = firstYearObj?.pm25Avg || 0;
  const lastYearPM25 = lastYearObj?.pm25Avg || 0;
  const reductionRate =
    firstYearPM25 > 0 ? (((lastYearPM25 - firstYearPM25) / firstYearPM25) * 100).toFixed(1) : '0';

  // 导出 CSV 功能
  const handleExportCSV = () => {
    let csvContent = 'data:text/csv;charset=utf-8,\uFEFF';
    const stdLabel = standard === 'CN' ? '国标(HJ 633)' : '美标(US EPA)';
    csvContent += `日期,AQI(${stdLabel}),质量等级,PM2.5均值(ug/m3)\n`;
    calendarData.forEach((row) => {
      csvContent += `${row[0]},${row[1]},${row[2]},${row[3]}\n`;
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
          <h1 className="text-lg font-bold text-slate-900 tracking-tight">空气质量历史“时间机器”</h1>
        </div>

        {/* 城市与年份选择器 (给足横向宽度与呼吸空间) */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 text-xs flex-1 md:max-w-3xl justify-end">
          <CitySearchAutocomplete
            selectedCity={city}
            onSelectCity={(newCity) => setSelectedCityId(newCity.id)}
            placeholder="搜索全球 90+ 国家或城市 (如: 美国 / 日本 / 英国 / 成都 / 巴黎)..."
            className="w-full sm:flex-1"
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

      {/* 标准说明横幅 */}
      <div className="p-3.5 rounded-xl bg-sky-50 border border-sky-100 flex items-center justify-between text-xs text-sky-900">
        <div className="flex items-center space-x-2">
          <Sparkles className="w-4 h-4 text-sky-600 shrink-0" />
          <span>
            {standard === 'CN' ? (
              <>
                <b>国标模式</b>：优良天数门槛为 <b>AQI ≤ 100</b>（包含一级优与二级良，对应 PM2.5 ≤ 75 μg/m³）。
              </>
            ) : (
              <>
                <b>美标模式</b>：US EPA 标准限值更严苛，<b>Good (优)</b> 仅对应 PM2.5 ≤ 12 μg/m³，<b>Moderate (良)</b> 对应 PM2.5 ≤ 35.4 μg/m³，超过 35.4 即进入不健康超标区间。
              </>
            )}
          </span>
        </div>
      </div>

      {/* 年度总体成就 Scorecard */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="glass-panel rounded-2xl p-5 flex items-center justify-between">
          <div className="flex-1 min-w-0 pr-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-500">
                {standard === 'CN' ? '国标优良天数比例 (优+良)' : '美标达标天数比例 (Good+Mod)'}
              </p>
              <span className="text-[11px] px-2 py-0.5 rounded-full font-bold bg-sky-50 text-sky-700 border border-sky-200 shrink-0">
                年均 AQI: {avgAQI}
              </span>
            </div>
            <div className="flex items-baseline space-x-2 mt-1">
              <span className="text-3xl font-black text-emerald-600">{compliantRatio}%</span>
              <span className="text-xs text-slate-500">共 {compliantDaysCount} 天达标 / 实测 {validTotalDays} 天</span>
            </div>
          </div>
          <CheckCircle2 className="w-8 h-8 text-emerald-500/20 shrink-0" />
        </div>

        <div className="glass-panel rounded-2xl p-5 flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500">
              {standard === 'CN' ? '超标污染天数 (轻度及以上)' : '美标不健康天数 (USG及以上)'}
            </p>
            <div className="flex items-baseline space-x-2 mt-1">
              <span className="text-3xl font-black text-rose-600">{pollutedDaysCount} 天</span>
              <span className="text-xs text-slate-500">
                {city.isDomestic ? '主要分布于秋冬逆温及夏秋臭氧' : '主要受局地扩散与季节排放影响'}
              </span>
            </div>
          </div>
          <AlertCircle className="w-8 h-8 text-rose-500/20" />
        </div>

        <div className="glass-panel rounded-2xl p-5 flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500">
              治理成效改善幅度 {firstYearObj ? `(较 ${firstYearObj.year})` : ''}
            </p>
            <div className="flex items-baseline space-x-2 mt-1">
              <span className="text-3xl font-black text-sky-600">
                {Number(reductionRate) > 0 ? `+${reductionRate}%` : `${reductionRate}%`}
              </span>
              <span className="text-xs text-slate-500">
                {firstYearObj && lastYearObj
                  ? `${firstYearObj.pm25Avg} → ${lastYearObj.pm25Avg} μg/m³`
                  : 'PM2.5 真实演进轨迹'}
              </span>
            </div>
          </div>
          <TrendingDown className="w-8 h-8 text-sky-500/20" />
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

      {/* 季节性污染特征透视 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="glass-panel rounded-2xl p-5">
          <div className="flex items-center space-x-2 text-sky-700 font-bold text-sm mb-2">
            <Snowflake className="w-4 h-4 text-sky-600" />
            <span>秋冬季静稳逆温特征 (11 月 ~ 次年 2 月)</span>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            {city.isDomestic
              ? '受区域近地逆温层及冬季气象扩散条件减弱影响，静稳天气易发生颗粒物短时积累。过去数年间超低排放改造与清洁取暖工程实施后，峰值浓度与超标天数已显著下降。'
              : '国际大都市在冬季受取暖排放与静稳天气共同作用，颗粒物（PM2.5 / PM10）呈周期性波峰，夏季扩散条件通常优于冬季。'}
          </p>
        </div>

        <div className="glass-panel rounded-2xl p-5">
          <div className="flex items-center space-x-2 text-amber-700 font-bold text-sm mb-2">
            <Sun className="w-4 h-4 text-amber-600" />
            <span>夏秋季光化学臭氧特征 (6 月 ~ 9 月)</span>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            夏季光照充足、气温升高，挥发性有机物（VOCs）与氮氧化物（NOx）在强紫外线作用下发生光化学反应，首要污染物阶段性转变为臭氧（O₃），午后 14:00~17:00 为日间浓度高点。
          </p>
        </div>
      </div>
    </div>
  );
}
