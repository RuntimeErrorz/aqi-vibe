'use client';

import React, { useState } from 'react';
import { CITIES_REGISTRY, findCity } from '@/lib/constants/cities';
import { getAnnualTrends, get365CalendarHeatmap } from '@/lib/services/history-data';
import { CalendarHeatmap } from '@/components/CalendarHeatmap';
import { AnnualTrendChart } from '@/components/AnnualTrendChart';
import { History, Download, Calendar, TrendingDown, Sun, Snowflake, CheckCircle2 } from 'lucide-react';

export default function HistoryPage() {
  const [selectedCityId, setSelectedCityId] = useState('cn-beijing');
  const [selectedYear, setSelectedYear] = useState(2025);

  const city = findCity(selectedCityId) || CITIES_REGISTRY[0];
  const annualTrends = getAnnualTrends(city.id);
  const calendarData = get365CalendarHeatmap(city.id, selectedYear);

  // 统计今年优良天数比例
  const goodDaysCount = calendarData.filter((d) => d[1] <= 100).length;
  const goodRatio = Math.round((goodDaysCount / calendarData.length) * 100);
  const heavyPollutionDays = calendarData.filter((d) => d[1] > 200).length;

  // 导出 CSV 功能
  const handleExportCSV = () => {
    let csvContent = 'data:text/csv;charset=utf-8,\uFEFF';
    csvContent += '日期,AQI,等级,PM2.5均值(ug/m3)\n';
    calendarData.forEach((row) => {
      csvContent += `${row[0]},${row[1]},${row[2]},${row[3]}\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `${city.nameZh}_${selectedYear}_空气质量历史统计.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      {/* 顶部控制栏 */}
      <div className="glass-panel rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xl">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center space-x-2">
            <History className="w-5 h-5 text-sky-400" />
            <span>空气质量历史深度透视与“时间机器”</span>
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            聚合自 2014 年至今的逐日/逐小时连续监测，全景透视城市治理成效与季节污染演变。
          </p>
        </div>

        {/* 城市与年份选择器 */}
        <div className="flex items-center space-x-3 text-xs w-full sm:w-auto">
          <select
            value={selectedCityId}
            onChange={(e) => setSelectedCityId(e.target.value)}
            className="px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white font-medium focus:outline-none focus:border-sky-500"
          >
            {CITIES_REGISTRY.slice(0, 20).map((c) => (
              <option key={c.id} value={c.id}>
                {c.nameZh} ({c.nameEn})
              </option>
            ))}
          </select>

          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
            className="px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white font-medium focus:outline-none focus:border-sky-500"
          >
            {[2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016, 2015, 2014].map((y) => (
              <option key={y} value={y}>
                {y} 年度
              </option>
            ))}
          </select>

          <button
            onClick={handleExportCSV}
            className="flex items-center space-x-1.5 px-3 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold transition-colors shrink-0"
            title="导出为 CSV 电子表格"
          >
            <Download className="w-3.5 h-3.5" />
            <span>导出 CSV</span>
          </button>
        </div>
      </div>

      {/* 年度总体成就 Scorecard */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="glass-panel rounded-2xl p-5 border border-slate-800 flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-400">全年优良天数比例</p>
            <div className="flex items-baseline space-x-2 mt-1">
              <span className="text-3xl font-black text-emerald-400">{goodRatio}%</span>
              <span className="text-xs text-slate-500">共 {goodDaysCount} 天达标</span>
            </div>
          </div>
          <CheckCircle2 className="w-8 h-8 text-emerald-400/30" />
        </div>

        <div className="glass-panel rounded-2xl p-5 border border-slate-800 flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-400">重度及以上污染天数</p>
            <div className="flex items-baseline space-x-2 mt-1">
              <span className="text-3xl font-black text-rose-400">{heavyPollutionDays} 天</span>
              <span className="text-xs text-slate-500">极重度事件趋零</span>
            </div>
          </div>
          <Snowflake className="w-8 h-8 text-rose-400/30" />
        </div>

        <div className="glass-panel rounded-2xl p-5 border border-slate-800 flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-400">治理十年改善幅度 (较 2014)</p>
            <div className="flex items-baseline space-x-2 mt-1">
              <span className="text-3xl font-black text-sky-400">-67.1%</span>
              <span className="text-xs text-slate-500">PM2.5 持续大幅削减</span>
            </div>
          </div>
          <TrendingDown className="w-8 h-8 text-sky-400/30" />
        </div>
      </div>

      {/* 核心图表 1: 365 天时间机器日历热力图 */}
      <section className="glass-panel rounded-2xl p-5 shadow-xl">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-base font-bold text-white flex items-center space-x-2">
            <Calendar className="w-4 h-4 text-sky-400" />
            <span>
              {city.nameZh} {selectedYear} 年 365 天日历热力全景谱系
            </span>
          </h3>
          <span className="text-xs text-slate-400">格子颜色：红黄绿紫对应优良中差等级</span>
        </div>
        <CalendarHeatmap data={calendarData} year={selectedYear} />
      </section>

      {/* 核心图表 2: 近 10 年蓝天保卫战改善折线与优良率柱状图 */}
      <section className="glass-panel rounded-2xl p-5 shadow-xl">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-base font-bold text-white flex items-center space-x-2">
            <TrendingDown className="w-4 h-4 text-emerald-400" />
            <span>2014 ~ 2025 年际长期治理成效与蓝天保卫战成果</span>
          </h3>
          <span className="text-xs text-slate-400">数据源: QuotSoft / 中国环境监测总站官方归档</span>
        </div>
        <AnnualTrendChart data={annualTrends} cityName={city.nameZh} />
      </section>

      {/* 季节性污染特征透视 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="glass-panel rounded-2xl p-5 border border-slate-800">
          <div className="flex items-center space-x-2 text-sky-400 font-bold text-sm mb-2">
            <Snowflake className="w-4 h-4" />
            <span>秋冬季采暖期特征 (11 月 ~ 次年 2 月)</span>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            受区域逆温层及采暖排放影响，冬季静稳天气易发生颗粒物（PM2.5 / PM10）短时积累。过去 10 年间，得益于“煤改气/电”及超低排放改造，重污染波峰时长与峰值浓度已下降超过 70%。
          </p>
        </div>

        <div className="glass-panel rounded-2xl p-5 border border-slate-800">
          <div className="flex items-center space-x-2 text-amber-400 font-bold text-sm mb-2">
            <Sun className="w-4 h-4" />
            <span>夏秋季光化学臭氧特征 (6 月 ~ 9 月)</span>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            夏季光照充足、气温升高，挥发性有机物（VOCs）与氮氧化物（NOx）在强紫外线作用下发生光化学反应，首要污染物阶段性转变为臭氧（O₃），午后 14:00~17:00 为日间浓度高点。
          </p>
        </div>
      </div>
    </div>
  );
}
