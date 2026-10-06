'use client';

import React, { useState, useMemo } from 'react';
import { useStandard } from './StandardContext';
import {
  getAllCitiesRanking,
  getAllCountriesRanking,
  CityRankingItem,
  CountryRankingItem,
} from '@/lib/services/history-data';
import { COUNTRIES_META } from '@/lib/constants/countries';
import {
  Trophy,
  Medal,
  Globe,
  Filter,
  Search,
  ArrowUpDown,
  TrendingDown,
  TrendingUp,
  Plus,
  Check,
  Building2,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Layers,
  Flame,
  Leaf,
  Calendar,
} from 'lucide-react';
import Link from 'next/link';

interface GlobalRankingSandboxProps {
  selectedCityIds: string[];
  onToggleCity: (cityId: string) => void;
  onAddCity: (cityId: string) => void;
}

type TabType = 'cities' | 'countries';
type GeoScope = 'all' | 'domestic' | 'international';
type RankMode = 'cleanest' | 'polluted' | 'improved';
type SortMetric = 'aqi' | 'pm25' | 'pm10' | 'goodRatio' | 'heavyDays';

const AVAILABLE_YEARS = [2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019];

export function GlobalRankingSandbox({
  selectedCityIds,
  onToggleCity,
  onAddCity,
}: GlobalRankingSandboxProps) {
  const { standard } = useStandard();

  // 当前主 Tab: 城市榜单 vs 国家榜单
  const [activeTab, setActiveTab] = useState<TabType>('cities');

  // 筛选与控制参数
  const [selectedYear, setSelectedYear] = useState<number>(2025);
  const [geoScope, setGeoScope] = useState<GeoScope>('all');
  const [selectedCountry, setSelectedCountry] = useState<string>('ALL');
  const [rankMode, setRankMode] = useState<RankMode>('cleanest');
  const [sortMetric, setSortMetric] = useState<SortMetric>('aqi');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // 分页状态
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(15);

  // 1. 获取基础数据
  const rawCities = useMemo(() => {
    return getAllCitiesRanking(selectedYear, standard);
  }, [selectedYear, standard]);

  const rawCountries = useMemo(() => {
    return getAllCountriesRanking(selectedYear, standard);
  }, [selectedYear, standard]);

  // 2. 统计并收集可选国家列表（按纳入城市数量排序）
  const countryOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of rawCities) {
      counts.set(c.country, (counts.get(c.country) || 0) + 1);
    }
    const arr = Array.from(counts.entries()).map(([code, count]) => {
      const meta = COUNTRIES_META[code] || { nameZh: code, flag: '🌐' };
      return {
        code,
        nameZh: meta.nameZh,
        flag: meta.flag,
        count,
      };
    });
    // 中国与美国排前列，其余按城市数量降序
    return arr.sort((a, b) => {
      if (a.code === 'CN') return -1;
      if (b.code === 'CN') return 1;
      return b.count - a.count;
    });
  }, [rawCities]);

  // 3. 过滤并排序城市榜单
  const filteredCities = useMemo(() => {
    let list = [...rawCities];

    // 地理范围过滤
    if (geoScope === 'domestic') {
      list = list.filter((c) => c.isDomestic);
    } else if (geoScope === 'international') {
      list = list.filter((c) => !c.isDomestic);
    }

    // 特定国家单选过滤
    if (selectedCountry !== 'ALL') {
      list = list.filter((c) => c.country === selectedCountry);
    }

    // 关键词搜索过滤
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (c) =>
          c.nameZh.toLowerCase().includes(q) ||
          c.nameEn.toLowerCase().includes(q) ||
          c.countryZh.toLowerCase().includes(q) ||
          (c.province && c.province.toLowerCase().includes(q))
      );
    }

    // 排序逻辑
    list.sort((a, b) => {
      if (rankMode === 'improved') {
        // 改善幅度排序（负值越大改善越多）
        const aImp = a.improvementRate ?? 999;
        const bImp = b.improvementRate ?? 999;
        return aImp - bImp;
      }

      let valA = a.aqiAvg;
      let valB = b.aqiAvg;

      if (sortMetric === 'pm25') {
        valA = a.pm25Avg;
        valB = b.pm25Avg;
      } else if (sortMetric === 'pm10') {
        valA = a.pm10Avg;
        valB = b.pm10Avg;
      } else if (sortMetric === 'goodRatio') {
        valA = a.goodDaysRatio;
        valB = b.goodDaysRatio;
      } else if (sortMetric === 'heavyDays') {
        valA = a.heavyPollutionDays;
        valB = b.heavyPollutionDays;
      }

      if (rankMode === 'cleanest') {
        // 优良率越高越好，其他越低越好
        return sortMetric === 'goodRatio' ? valB - valA : valA - valB;
      } else {
        // 污染最重榜
        return sortMetric === 'goodRatio' ? valA - valB : valB - valA;
      }
    });

    return list;
  }, [rawCities, geoScope, selectedCountry, searchQuery, rankMode, sortMetric]);

  // 4. 过滤并排序国家榜单
  const filteredCountries = useMemo(() => {
    let list = [...rawCountries];

    // 关键词搜索
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (c) =>
          c.nameZh.toLowerCase().includes(q) ||
          c.nameEn.toLowerCase().includes(q) ||
          c.countryCode.toLowerCase().includes(q)
      );
    }

    list.sort((a, b) => {
      let valA = a.aqiAvg;
      let valB = b.aqiAvg;

      if (sortMetric === 'pm25') {
        valA = a.pm25Avg;
        valB = b.pm25Avg;
      } else if (sortMetric === 'pm10') {
        valA = a.pm10Avg;
        valB = b.pm10Avg;
      } else if (sortMetric === 'goodRatio') {
        valA = a.goodDaysRatioAvg;
        valB = b.goodDaysRatioAvg;
      }

      if (rankMode === 'cleanest' || rankMode === 'improved') {
        return sortMetric === 'goodRatio' ? valB - valA : valA - valB;
      } else {
        return sortMetric === 'goodRatio' ? valA - valB : valB - valA;
      }
    });

    return list;
  }, [rawCountries, searchQuery, rankMode, sortMetric]);

  // 分页计算
  const totalItems = activeTab === 'cities' ? filteredCities.length : filteredCountries.length;
  const totalPages = Math.ceil(totalItems / pageSize) || 1;
  const paginatedCities = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredCities.slice(start, start + pageSize);
  }, [filteredCities, currentPage, pageSize]);

  const paginatedCountries = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredCountries.slice(start, start + pageSize);
  }, [filteredCountries, currentPage, pageSize]);

  // 切换筛选时自动重置回第 1 页
  const handleFilterChange = () => {
    setCurrentPage(1);
  };

  // 奖牌样式辅助
  const renderRankBadge = (rank: number) => {
    if (rank === 1) {
      return (
        <span className="flex items-center justify-center w-7 h-7 rounded-full bg-amber-400 text-amber-950 font-black text-xs shadow-md shadow-amber-300/40">
          🥇 1
        </span>
      );
    }
    if (rank === 2) {
      return (
        <span className="flex items-center justify-center w-7 h-7 rounded-full bg-slate-300 text-slate-800 font-black text-xs shadow-md shadow-slate-300/40">
          🥈 2
        </span>
      );
    }
    if (rank === 3) {
      return (
        <span className="flex items-center justify-center w-7 h-7 rounded-full bg-amber-600/80 text-white font-black text-xs shadow-md shadow-amber-600/30">
          🥉 3
        </span>
      );
    }
    return (
      <span className="flex items-center justify-center w-7 h-7 rounded-full bg-slate-100 text-slate-600 font-semibold text-xs border border-slate-200">
        {rank}
      </span>
    );
  };

  // AQI 等级标签
  const renderAqiLevelTag = (aqi: number) => {
    let label = '优 (Good)';
    let colorClass = 'bg-emerald-50 text-emerald-700 border-emerald-200';

    if (standard === 'CN') {
      if (aqi <= 50) {
        label = '优';
        colorClass = 'bg-emerald-50 text-emerald-700 border-emerald-200';
      } else if (aqi <= 100) {
        label = '良';
        colorClass = 'bg-amber-50 text-amber-700 border-amber-200';
      } else if (aqi <= 150) {
        label = '轻度污染';
        colorClass = 'bg-orange-50 text-orange-700 border-orange-200';
      } else if (aqi <= 200) {
        label = '中度污染';
        colorClass = 'bg-rose-50 text-rose-700 border-rose-200';
      } else {
        label = '重度污染';
        colorClass = 'bg-purple-50 text-purple-700 border-purple-200';
      }
    } else {
      if (aqi <= 50) {
        label = 'Good';
        colorClass = 'bg-emerald-50 text-emerald-700 border-emerald-200';
      } else if (aqi <= 100) {
        label = 'Moderate';
        colorClass = 'bg-amber-50 text-amber-700 border-amber-200';
      } else if (aqi <= 150) {
        label = 'USG (超标)';
        colorClass = 'bg-orange-50 text-orange-700 border-orange-200';
      } else if (aqi <= 200) {
        label = 'Unhealthy';
        colorClass = 'bg-rose-50 text-rose-700 border-rose-200';
      } else {
        label = 'Very Unhealthy';
        colorClass = 'bg-purple-50 text-purple-700 border-purple-200';
      }
    }

    return (
      <span className={`px-2 py-0.5 rounded-md text-[11px] font-semibold border ${colorClass}`}>
        {label}
      </span>
    );
  };

  return (
    <div className="glass-panel rounded-2xl p-5 space-y-5">
      {/* 头部标题与主 Tab 切换 */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 pb-4">
        <div>
          <div className="flex items-center space-x-2">
            <Trophy className="w-5 h-5 text-amber-500" />
            <h2 className="text-lg font-bold text-slate-900">
              全球与多国空气质量多维全景排行榜
            </h2>
            <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-sky-100 text-sky-700 border border-sky-200">
              {standard === 'CN' ? 'HJ 633 国标' : 'US EPA 美标'}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            覆盖全球 90+ 国家与地区、920+ 座官方监测城市，支持跨国对比与一键加入沙盘
          </p>
        </div>

        {/* 城市榜 vs 国家榜 切换器 */}
        <div className="flex items-center bg-slate-100/80 p-1 rounded-xl self-start md:self-auto border border-slate-200/60">
          <button
            onClick={() => {
              setActiveTab('cities');
              handleFilterChange();
            }}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              activeTab === 'cities'
                ? 'bg-white text-sky-700 shadow-sm shadow-slate-200'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Building2 className="w-3.5 h-3.5" />
            <span>城市精细榜 (928城)</span>
          </button>
          <button
            onClick={() => {
              setActiveTab('countries');
              handleFilterChange();
            }}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              activeTab === 'countries'
                ? 'bg-white text-sky-700 shadow-sm shadow-slate-200'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Globe className="w-3.5 h-3.5" />
            <span>国家/地区综合榜 (93国)</span>
          </button>
        </div>
      </div>

      {/* 综合多维筛选工具栏 */}
      <div className="bg-slate-50/70 rounded-xl p-3.5 border border-slate-200/60 space-y-3">
        {/* 第一行筛选器：地理范围、国家单选、榜单模式、年份 */}
        <div className="flex flex-wrap items-center gap-2.5 text-xs">
          {/* 地理范围单选（仅城市榜有效） */}
          {activeTab === 'cities' && (
            <div className="flex items-center bg-white rounded-lg p-0.5 border border-slate-200">
              <button
                onClick={() => {
                  setGeoScope('all');
                  handleFilterChange();
                }}
                className={`px-2.5 py-1 rounded-md font-semibold transition-all ${
                  geoScope === 'all'
                    ? 'bg-sky-600 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                全部全球
              </button>
              <button
                onClick={() => {
                  setGeoScope('domestic');
                  handleFilterChange();
                }}
                className={`px-2.5 py-1 rounded-md font-semibold transition-all ${
                  geoScope === 'domestic'
                    ? 'bg-sky-600 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                中国国内 (375+)
              </button>
              <button
                onClick={() => {
                  setGeoScope('international');
                  handleFilterChange();
                }}
                className={`px-2.5 py-1 rounded-md font-semibold transition-all ${
                  geoScope === 'international'
                    ? 'bg-sky-600 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                海外国际 (530+)
              </button>
            </div>
          )}

          {/* 特定国家快捷筛选下拉 */}
          {activeTab === 'cities' && (
            <div className="flex items-center space-x-1 bg-white px-2.5 py-1 rounded-lg border border-slate-200">
              <Globe className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <select
                value={selectedCountry}
                onChange={(e) => {
                  setSelectedCountry(e.target.value);
                  handleFilterChange();
                }}
                className="bg-transparent font-semibold text-slate-700 focus:outline-none cursor-pointer"
              >
                <option value="ALL">全部国家 / 地区 (93国)</option>
                {countryOptions.map((co) => (
                  <option key={co.code} value={co.code}>
                    {co.flag} {co.nameZh} ({co.count}城)
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* 榜单类型选择：红榜（最清洁）vs 黑榜（污染重）vs 改善先锋 */}
          <div className="flex items-center bg-white rounded-lg p-0.5 border border-slate-200">
            <button
              onClick={() => {
                setRankMode('cleanest');
                handleFilterChange();
              }}
              className={`flex items-center space-x-1 px-2.5 py-1 rounded-md font-semibold transition-all ${
                rankMode === 'cleanest'
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Leaf className="w-3 h-3" />
              <span>空气最佳榜</span>
            </button>
            <button
              onClick={() => {
                setRankMode('polluted');
                handleFilterChange();
              }}
              className={`flex items-center space-x-1 px-2.5 py-1 rounded-md font-semibold transition-all ${
                rankMode === 'polluted'
                  ? 'bg-rose-600 text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Flame className="w-3 h-3" />
              <span>污染关注榜</span>
            </button>
            {activeTab === 'cities' && (
              <button
                onClick={() => {
                  setRankMode('improved');
                  handleFilterChange();
                }}
                className={`flex items-center space-x-1 px-2.5 py-1 rounded-md font-semibold transition-all ${
                  rankMode === 'improved'
                    ? 'bg-sky-600 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <TrendingDown className="w-3 h-3" />
                <span>治理改善先锋榜</span>
              </button>
            )}
          </div>

          {/* 归档年份单选 */}
          <div className="flex items-center space-x-1 bg-white px-2.5 py-1 rounded-lg border border-slate-200 ml-auto">
            <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <select
              value={selectedYear}
              onChange={(e) => {
                setSelectedYear(Number(e.target.value));
                handleFilterChange();
              }}
              className="bg-transparent font-semibold text-slate-700 focus:outline-none cursor-pointer"
            >
              {AVAILABLE_YEARS.map((y) => (
                <option key={y} value={y}>
                  {y} 年度 {y === 2026 ? '(进行中)' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* 第二行筛选器：指标排序选择、即时搜索框、单页数量 */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 text-xs">
          {/* 指标排序维度 */}
          <div className="flex items-center space-x-2">
            <span className="text-slate-400 font-medium flex items-center space-x-1">
              <ArrowUpDown className="w-3 h-3" />
              <span>排序依据:</span>
            </span>
            <div className="flex items-center space-x-1.5">
              {[
                { key: 'aqi', label: '综合 AQI' },
                { key: 'pm25', label: 'PM2.5 均值' },
                { key: 'pm10', label: 'PM10 均值' },
                { key: 'goodRatio', label: '达标优良率' },
                ...(activeTab === 'cities' ? [{ key: 'heavyDays', label: '重污染天数' }] : []),
              ].map((m) => (
                <button
                  key={m.key}
                  onClick={() => {
                    setSortMetric(m.key as SortMetric);
                    handleFilterChange();
                  }}
                  className={`px-2 py-0.5 rounded-md font-semibold transition-colors ${
                    sortMetric === m.key
                      ? 'bg-slate-800 text-white'
                      : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* 即时搜索框 */}
          <div className="relative flex-1 max-w-xs">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                handleFilterChange();
              }}
              placeholder={
                activeTab === 'cities'
                  ? '模糊搜索城市名 / 省份 / 国家...'
                  : '搜索国家名称 / 代码...'
              }
              className="w-full pl-8 pr-3 py-1 bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-sky-500 placeholder:text-slate-400 text-xs"
            />
          </div>
        </div>
      </div>

      {/* 榜单统计信息条 */}
      <div className="flex items-center justify-between text-xs text-slate-500 px-1">
        <div>
          <span>共筛选出 </span>
          <span className="font-bold text-slate-900">{totalItems}</span>
          <span> 个{activeTab === 'cities' ? '城市' : '国家/地区'}</span>
          {activeTab === 'cities' && (
            <span className="ml-2 text-slate-400">
              · 点击右侧按钮可直接将其纳入上方多城沙盘对比
            </span>
          )}
        </div>
        <div className="flex items-center space-x-2">
          <span>每页显示:</span>
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setCurrentPage(1);
            }}
            className="bg-slate-50 border border-slate-200 rounded-md px-1.5 py-0.5 text-xs text-slate-700"
          >
            <option value={10}>10 条</option>
            <option value={15}>15 条</option>
            <option value={30}>30 条</option>
            <option value={50}>50 条</option>
          </select>
        </div>
      </div>

      {/* 榜单表格展示 */}
      {activeTab === 'cities' ? (
        <div className="overflow-x-auto rounded-xl border border-slate-200/80 shadow-sm bg-white">
          <table className="w-full text-left text-xs text-slate-700">
            <thead className="bg-slate-50/80 text-[11px] font-bold text-slate-500 uppercase tracking-wider border-b border-slate-200">
              <tr>
                <th className="py-3 px-3 w-16 text-center">排名</th>
                <th className="py-3 px-3">城市 / 国家</th>
                <th className="py-3 px-3">综合 AQI ({standard === 'CN' ? '国标' : '美标'})</th>
                <th className="py-3 px-3">PM2.5 年均 (μg/m³)</th>
                <th className="py-3 px-3">PM10 年均 (μg/m³)</th>
                <th className="py-3 px-3">优良达标率</th>
                <th className="py-3 px-3">改善幅度 (较基准)</th>
                <th className="py-3 px-3 text-right">沙盘操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginatedCities.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    未找到符合当前筛选条件的官方监测城市
                  </td>
                </tr>
              ) : (
                paginatedCities.map((item, idx) => {
                  const globalRank = (currentPage - 1) * pageSize + idx + 1;
                  const isSelectedInSandbox = selectedCityIds.includes(item.id);

                  return (
                    <tr
                      key={item.id}
                      className={`hover:bg-sky-50/40 transition-colors ${
                        isSelectedInSandbox ? 'bg-sky-50/30' : ''
                      }`}
                    >
                      {/* 排名 */}
                      <td className="py-3 px-3 text-center">
                        <div className="flex justify-center">{renderRankBadge(globalRank)}</div>
                      </td>

                      {/* 城市与国家 */}
                      <td className="py-3 px-3">
                        <div className="flex items-center space-x-2">
                          <span className="text-base">{item.countryFlag}</span>
                          <div>
                            <div className="flex items-center space-x-1.5">
                              <Link
                                href={`/history?city=${item.id}&year=${item.year}`}
                                className="font-bold text-slate-900 hover:text-sky-600 transition-colors"
                              >
                                {item.nameZh}
                              </Link>
                              <span className="text-[10px] text-slate-400">({item.nameEn})</span>
                            </div>
                            <div className="text-[10px] text-slate-500">
                              {item.province ? `${item.province} · ` : ''}
                              {item.countryZh}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* 综合 AQI */}
                      <td className="py-3 px-3">
                        <div className="flex items-center space-x-2">
                          <span className="text-sm font-black text-slate-900">{item.aqiAvg}</span>
                          {renderAqiLevelTag(item.aqiAvg)}
                        </div>
                      </td>

                      {/* PM2.5 */}
                      <td className="py-3 px-3 font-semibold text-slate-800">
                        {item.pm25Avg}
                      </td>

                      {/* PM10 */}
                      <td className="py-3 px-3 text-slate-600 font-medium">
                        {item.pm10Avg > 0 ? item.pm10Avg : '-'}
                      </td>

                      {/* 优良达标率 */}
                      <td className="py-3 px-3">
                        <div className="flex items-center space-x-2">
                          <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-emerald-500 rounded-full"
                              style={{ width: `${Math.min(100, item.goodDaysRatio)}%` }}
                            />
                          </div>
                          <span className="font-bold text-emerald-700">
                            {item.goodDaysRatio}%
                          </span>
                        </div>
                      </td>

                      {/* 历史改善幅度 */}
                      <td className="py-3 px-3">
                        {item.improvementRate !== null ? (
                          <div className="flex items-center space-x-1">
                            {item.improvementRate < 0 ? (
                              <>
                                <TrendingDown className="w-3.5 h-3.5 text-emerald-600" />
                                <span className="font-bold text-emerald-600">
                                  {item.improvementRate}%
                                </span>
                              </>
                            ) : (
                              <>
                                <TrendingUp className="w-3.5 h-3.5 text-rose-500" />
                                <span className="font-bold text-rose-500">
                                  +{item.improvementRate}%
                                </span>
                              </>
                            )}
                            <span className="text-[10px] text-slate-400">
                              (自{item.earliestYear})
                            </span>
                          </div>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>

                      {/* 加入沙盘按钮 */}
                      <td className="py-3 px-3 text-right">
                        <button
                          onClick={() => onToggleCity(item.id)}
                          className={`inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                            isSelectedInSandbox
                              ? 'bg-sky-600 text-white shadow-sm'
                              : 'bg-slate-100 hover:bg-sky-100 text-slate-700 hover:text-sky-700 border border-slate-200'
                          }`}
                        >
                          {isSelectedInSandbox ? (
                            <>
                              <Check className="w-3 h-3" />
                              <span>已在沙盘</span>
                            </>
                          ) : (
                            <>
                              <Plus className="w-3 h-3" />
                              <span>对比</span>
                            </>
                          )}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      ) : (
        /* 国家聚合榜单 */
        <div className="overflow-x-auto rounded-xl border border-slate-200/80 shadow-sm bg-white">
          <table className="w-full text-left text-xs text-slate-700">
            <thead className="bg-slate-50/80 text-[11px] font-bold text-slate-500 uppercase tracking-wider border-b border-slate-200">
              <tr>
                <th className="py-3 px-3 w-16 text-center">排名</th>
                <th className="py-3 px-3">国家 / 地区</th>
                <th className="py-3 px-3">纳入监测城市数</th>
                <th className="py-3 px-3">全国平均 AQI ({standard === 'CN' ? '国标' : '美标'})</th>
                <th className="py-3 px-3">PM2.5 全国均值 (μg/m³)</th>
                <th className="py-3 px-3">平均优良达标率</th>
                <th className="py-3 px-3">最清洁代表城市</th>
                <th className="py-3 px-3">污染最重代表城市</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginatedCountries.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    未找到符合条件的国家或地区
                  </td>
                </tr>
              ) : (
                paginatedCountries.map((cItem, idx) => {
                  const globalRank = (currentPage - 1) * pageSize + idx + 1;

                  return (
                    <tr key={cItem.countryCode} className="hover:bg-sky-50/40 transition-colors">
                      {/* 排名 */}
                      <td className="py-3 px-3 text-center">
                        <div className="flex justify-center">{renderRankBadge(globalRank)}</div>
                      </td>

                      {/* 国家 */}
                      <td className="py-3 px-3">
                        <div className="flex items-center space-x-2">
                          <span className="text-xl">{cItem.flag}</span>
                          <div>
                            <span className="font-bold text-slate-900 text-sm">
                              {cItem.nameZh}
                            </span>
                            <div className="text-[10px] text-slate-400">{cItem.nameEn}</div>
                          </div>
                        </div>
                      </td>

                      {/* 城市数量 */}
                      <td className="py-3 px-3 font-semibold text-slate-700">
                        {cItem.cityCount} 座城市
                      </td>

                      {/* 全国平均 AQI */}
                      <td className="py-3 px-3">
                        <div className="flex items-center space-x-2">
                          <span className="text-sm font-black text-slate-900">{cItem.aqiAvg}</span>
                          {renderAqiLevelTag(cItem.aqiAvg)}
                        </div>
                      </td>

                      {/* 全国 PM2.5 均值 */}
                      <td className="py-3 px-3 font-semibold text-slate-800">
                        {cItem.pm25Avg}
                      </td>

                      {/* 平均达标率 */}
                      <td className="py-3 px-3">
                        <span className="font-bold text-emerald-700">
                          {cItem.goodDaysRatioAvg}%
                        </span>
                      </td>

                      {/* 最清洁城市 */}
                      <td className="py-3 px-3">
                        <button
                          onClick={() => onAddCity(cItem.cleanestCity.id)}
                          className="flex items-center space-x-1.5 hover:text-sky-600 font-semibold"
                          title="点击加入对比沙盘"
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          <span>{cItem.cleanestCity.nameZh}</span>
                          <span className="text-[10px] text-slate-400">
                            (AQI {cItem.cleanestCity.aqiAvg})
                          </span>
                        </button>
                      </td>

                      {/* 污染最重城市 */}
                      <td className="py-3 px-3">
                        <button
                          onClick={() => onAddCity(cItem.worstCity.id)}
                          className="flex items-center space-x-1.5 hover:text-rose-600 font-semibold"
                          title="点击加入对比沙盘"
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                          <span>{cItem.worstCity.nameZh}</span>
                          <span className="text-[10px] text-slate-400">
                            (AQI {cItem.worstCity.aqiAvg})
                          </span>
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* 分页控制栏 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2 text-xs">
          <div className="text-slate-500">
            第 <span className="font-bold text-slate-800">{currentPage}</span> / {totalPages} 页
          </div>
          <div className="flex items-center space-x-1">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
              className="flex items-center space-x-1 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed font-semibold text-slate-700 transition-colors shadow-sm"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>上一页</span>
            </button>
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
              className="flex items-center space-x-1 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed font-semibold text-slate-700 transition-colors shadow-sm"
            >
              <span>下一页</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
