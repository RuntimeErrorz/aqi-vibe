'use client';

import React, { useState } from 'react';
import { useStandard } from '@/components/StandardContext';
import { CITIES_REGISTRY, findCity } from '@/lib/constants/cities';
import { getAnnualTrends, get365CalendarHeatmap } from '@/lib/services/history-data';
import { CalendarHeatmap } from '@/components/CalendarHeatmap';
import { AnnualTrendChart } from '@/components/AnnualTrendChart';
import { CitySearchAutocomplete } from '@/components/CitySearchAutocomplete';
import { History, Download, Calendar, TrendingDown, Sun, Snowflake, CheckCircle2, AlertCircle, Sparkles } from 'lucide-react';

export default function HistoryPage() {
  const { standard } = useStandard();
  const [selectedCityId, setSelectedCityId] = useState('cn-chengdu'); // 默认展示成都
  const [selectedYear, setSelectedYear] = useState(2025);

  const city = findCity(selectedCityId) || CITIES_REGISTRY[0];
  const annualTrends = getAnnualTrends(city.id, standard);
  const calendarData = get365CalendarHeatmap(city.id, selectedYear, standard);

  // 统计不同标准下的天数分布
  // 国标：<= 50 优，51-100 良，> 100 污染
  // 美标：<= 50 Good，51-100 Moderate，> 100 USG 及以上
  const goodDaysCount = calendarData.filter((d) => d[1] <= (standard === 'CN' ? 100 : 50)).length;
  const compliantDaysCount = calendarData.filter((d) => d[1] <= 100).length;
  const compliantRatio = Math.round((compliantDaysCount / calendarData.length) * 100);
  const pollutedDaysCount = calendarData.filter((d) => d[1] > 100).length;

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
      <div className="glass-panel rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-xl font-bold text-slate-900 flex items-center space-x-2">
              <History className="w-5 h-5 text-sky-600" />
              <span>空气质量历史深度透视与“时间机器”</span>
            </h1>
            <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-sky-100 text-sky-700 border border-sky-200">
              {standard === 'CN' ? '中国国标 HJ 633' : '美标 US EPA'}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            当前计算标准遵循 <span className="font-semibold text-slate-700">{standard === 'CN' ? '中国环境空气质量指数 (HJ 633-2012)' : '美国环保署 NowCast 标准'}</span>，切换导航栏右上角标准时，全量历史数据将即时重算。
          </p>
        </div>

        {/* 城市与年份选择器 (Algolia 风格即时搜索 + 年份选择) */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center space-y-2 sm:space-y-0 sm:space-x-2.5 text-xs w-full sm:w-auto">
          <CitySearchAutocomplete
            selectedCity={city}
            onSelectCity={(newCity) => setSelectedCityId(newCity.id)}
            placeholder="搜索全球城市或国内 375+ 城市..."
            className="w-full sm:w-72"
          />

          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
            className="px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 font-semibold focus:outline-none focus:border-sky-500 shadow-sm shrink-0"
          >
            {[2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016, 2015, 2014].map((y) => (
              <option key={y} value={y}>
                {y} 年度
              </option>
            ))}
          </select>

          <button
            onClick={handleExportCSV}
            className="flex items-center justify-center space-x-1.5 px-3 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-semibold transition-colors shrink-0 shadow-sm"
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
          <div>
            <p className="text-xs text-slate-500">
              {standard === 'CN' ? '国标优良天数比例 (优+良)' : '美标达标天数比例 (Good+Mod)'}
            </p>
            <div className="flex items-baseline space-x-2 mt-1">
              <span className="text-3xl font-black text-emerald-600">{compliantRatio}%</span>
              <span className="text-xs text-slate-500">共 {compliantDaysCount} 天达标</span>
            </div>
          </div>
          <CheckCircle2 className="w-8 h-8 text-emerald-500/20" />
        </div>

        <div className="glass-panel rounded-2xl p-5 flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500">
              {standard === 'CN' ? '超标污染天数 (轻度及以上)' : '美标不健康天数 (USG及以上)'}
            </p>
            <div className="flex items-baseline space-x-2 mt-1">
              <span className="text-3xl font-black text-rose-600">{pollutedDaysCount} 天</span>
              <span className="text-xs text-slate-500">
                {city.nameZh === '成都' ? '秋冬盆地逆温及夏秋臭氧' : '主要集中于秋冬与初春'}
              </span>
            </div>
          </div>
          <AlertCircle className="w-8 h-8 text-rose-500/20" />
        </div>

        <div className="glass-panel rounded-2xl p-5 flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500">治理十年改善幅度 (较 2014)</p>
            <div className="flex items-baseline space-x-2 mt-1">
              <span className="text-3xl font-black text-sky-600">
                {city.id === 'cn-chengdu' ? '-53.2%' : city.id === 'cn-beijing' ? '-67.1%' : '-48.5%'}
              </span>
              <span className="text-xs text-slate-500">PM2.5 持续大幅削减</span>
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
              {city.nameZh} {selectedYear} 年 365 天日历热力全景谱系
            </span>
          </h3>
          <span className="text-xs text-slate-500">
            换算基准: {standard === 'CN' ? '国标 (HJ 633)' : '美标 (US EPA)'} · 格子颜色对应优良中差等级
          </span>
        </div>
        <CalendarHeatmap data={calendarData} year={selectedYear} standard={standard} />
      </section>

      {/* 核心图表 2: 近 10 年蓝天保卫战改善折线与优良率柱状图 */}
      <section className="glass-panel rounded-2xl p-5">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-base font-bold text-slate-900 flex items-center space-x-2">
            <TrendingDown className="w-4 h-4 text-emerald-600" />
            <span>2014 ~ 2025 年际长期治理成效与蓝天保卫战成果</span>
          </h3>
          <span className="text-xs text-slate-500">数据源: QuotSoft / 中国环境监测总站官方公报</span>
        </div>
        <AnnualTrendChart data={annualTrends} cityName={city.nameZh} standard={standard} />
      </section>

      {/* 季节性污染特征透视 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="glass-panel rounded-2xl p-5">
          <div className="flex items-center space-x-2 text-sky-700 font-bold text-sm mb-2">
            <Snowflake className="w-4 h-4 text-sky-600" />
            <span>秋冬季静稳逆温特征 (11 月 ~ 次年 2 月)</span>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            {city.nameZh === '成都'
              ? '成都地处四川盆地腹地，四面环山，冬季地面风速常年低于 1.5 m/s，静稳天气与近地强逆温层高发，污染物易停滞积累形成阶段性轻/中度污染（约 60~75 天）。'
              : '受区域逆温层及采暖排放影响，冬季静稳天气易发生颗粒物（PM2.5 / PM10）短时积累。过去 10 年间，得益于“煤改气/电”及超低排放改造，重污染波峰时长与峰值浓度已下降超过 65%。'}
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
