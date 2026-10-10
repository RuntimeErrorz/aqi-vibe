'use client';

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useStandard } from './StandardContext';
import {
  getAllCitiesRanking,
  getAllCountriesRanking,
  CityRankingItem,
  CountryRankingItem,
} from '@/lib/services/history-data';
import { COUNTRIES_META } from '@/lib/constants/countries';
import { getCNEvaluation, getUSEvaluation } from '@/lib/aqi-calculator';
import {
  Trophy,
  Globe,
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  TrendingDown,
  TrendingUp,
  Plus,
  Check,
  Building2,
  Calendar,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  X,
  Leaf,
  Flame,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface GlobalRankingSandboxProps {
  selectedCityIds: string[];
  onToggleCity: (cityId: string) => void;
  onAddCity: (cityId: string) => void;
}

type TabType = 'cities' | 'countries';
type GeoScope = 'all' | 'domestic' | 'international';
type SortMetric = 'aqi' | 'pm25' | 'pm10' | 'goodRatio' | 'heavyDays' | 'improved';
type SortOrder = 'asc' | 'desc';

const AVAILABLE_YEARS = [2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019];

interface PageJumperProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (p: number) => void;
}

const PageJumper: React.FC<PageJumperProps> = ({ currentPage, totalPages, onPageChange }) => {
  const [inputVal, setInputVal] = useState(String(currentPage));

  useEffect(() => {
    setInputVal(String(currentPage));
  }, [currentPage]);

  const handleCommit = () => {
    const val = parseInt(inputVal, 10);
    if (!isNaN(val) && val >= 1 && val <= totalPages) {
      onPageChange(val);
    } else {
      setInputVal(String(currentPage));
    }
  };

  return (
    <div className="inline-flex items-center space-x-1.5 text-xs text-slate-600 select-none">
      <button
        type="button"
        onClick={() => onPageChange(Math.max(1, currentPage - 1))}
        disabled={currentPage <= 1}
        className="h-7 flex items-center space-x-1 px-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed font-medium text-slate-700 transition-colors shadow-2xs cursor-pointer shrink-0"
        title="上一页"
      >
        <ChevronLeft className="w-3.5 h-3.5" />
        <span className="hidden sm:inline text-xs leading-none">上一页</span>
      </button>

      <div className="inline-flex items-center space-x-1 px-1">
        <span className="text-slate-400 text-xs leading-none flex items-center">第</span>
        <input
          type="number"
          min={1}
          max={Math.max(1, totalPages)}
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleCommit();
          }}
          onBlur={handleCommit}
          className="h-7 w-12 px-1 text-center text-xs leading-none bg-white border border-slate-200 rounded-lg font-bold text-slate-800 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500/20 shadow-2xs [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none tabular-nums"
        />
        <span className="text-slate-400 text-xs leading-none flex items-center">/ {totalPages} 页</span>
      </div>

      <button
        type="button"
        onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
        disabled={currentPage >= totalPages}
        className="h-7 flex items-center space-x-1 px-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed font-medium text-slate-700 transition-colors shadow-2xs cursor-pointer shrink-0"
        title="下一页"
      >
        <span className="hidden sm:inline text-xs leading-none">下一页</span>
        <ChevronRight className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

export function GlobalRankingSandbox({
  selectedCityIds,
  onToggleCity,
  onAddCity,
}: GlobalRankingSandboxProps) {
  const { standard, mounted } = useStandard();
  const router = useRouter();

  // 当前主 Tab: 城市榜单 vs 国家榜单
  const [activeTab, setActiveTab] = useState<TabType>('cities');

  // 筛选与控制参数
  const [selectedYear, setSelectedYear] = useState<number>(2025);
  const [geoScope, setGeoScope] = useState<GeoScope>('all');
  const [selectedCountry, setSelectedCountry] = useState<string>('ALL');
  const [sortMetric, setSortMetric] = useState<SortMetric>('aqi');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');

  type RankMode = 'cleanest' | 'polluted' | 'improved';

  const rankMode: RankMode =
    sortMetric === 'improved'
      ? 'improved'
      : sortMetric === 'aqi' && sortOrder === 'desc'
      ? 'polluted'
      : 'cleanest';

  const setRankMode = (mode: RankMode) => {
    if (mode === 'cleanest') {
      setSortMetric('aqi');
      setSortOrder('asc');
    } else if (mode === 'polluted') {
      setSortMetric('aqi');
      setSortOrder('desc');
    } else if (mode === 'improved') {
      setSortMetric('improved');
      setSortOrder('asc');
    }
  };

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isSearchPreviewOpen, setIsSearchPreviewOpen] = useState<boolean>(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  // 分页状态
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(15);

  // 点击外部自动关闭搜索即时下拉面板
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setIsSearchPreviewOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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

  // 3. 基础范围过滤与全量客观排序（在关键词搜索前确立真实权威排名）
  const sortedCitiesWithRank = useMemo(() => {
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

    // 权威排序逻辑
    list.sort((a, b) => {
      let diff = 0;
      if (sortMetric === 'improved') {
        const aImp = a.improvementRate ?? 999;
        const bImp = b.improvementRate ?? 999;
        diff = aImp - bImp;
      } else if (sortMetric === 'pm25') {
        diff = a.pm25Avg - b.pm25Avg;
      } else if (sortMetric === 'pm10') {
        diff = a.pm10Avg - b.pm10Avg;
      } else if (sortMetric === 'goodRatio') {
        diff = b.goodDaysRatio - a.goodDaysRatio; // 优良率默认高者在前
      } else if (sortMetric === 'heavyDays') {
        diff = a.heavyPollutionDays - b.heavyPollutionDays;
      } else {
        // 'aqi'
        diff = a.aqiAvg - b.aqiAvg;
      }

      return sortOrder === 'asc' ? diff : -diff;
    });

    // 赋予每座城市在当前全量榜单中的客观权威名次 (1 ~ N)
    return list.map((item, index) => ({
      ...item,
      rank: index + 1,
    }));
  }, [rawCities, geoScope, selectedCountry, sortMetric, sortOrder]);

  // 4. 应用关键词搜索过滤城市（保留城市既有权威排名，不重置为1）
  const filteredCities = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sortedCitiesWithRank;

    return sortedCitiesWithRank.filter(
      (c) =>
        c.nameZh.toLowerCase().includes(q) ||
        c.nameEn.toLowerCase().includes(q) ||
        c.countryZh.toLowerCase().includes(q) ||
        (c.province && c.province.toLowerCase().includes(q))
    );
  }, [sortedCitiesWithRank, searchQuery]);

  // 5. 排序国家榜单并确立全量客观权威排名
  const sortedCountriesWithRank = useMemo(() => {
    let list = [...rawCountries];

    list.sort((a, b) => {
      let diff = 0;
      if (sortMetric === 'pm25') {
        diff = a.pm25Avg - b.pm25Avg;
      } else if (sortMetric === 'pm10') {
        diff = a.pm10Avg - b.pm10Avg;
      } else if (sortMetric === 'goodRatio') {
        diff = b.goodDaysRatioAvg - a.goodDaysRatioAvg;
      } else {
        // 'aqi'
        diff = a.aqiAvg - b.aqiAvg;
      }

      return sortOrder === 'asc' ? diff : -diff;
    });

    return list.map((cItem, index) => ({
      ...cItem,
      rank: index + 1,
    }));
  }, [rawCountries, sortMetric, sortOrder]);

  // 6. 关键词搜索过滤国家榜单（保留国家既有权威排名）
  const filteredCountries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sortedCountriesWithRank;

    return sortedCountriesWithRank.filter(
      (c) =>
        c.nameZh.toLowerCase().includes(q) ||
        c.nameEn.toLowerCase().includes(q) ||
        c.countryCode.toLowerCase().includes(q)
    );
  }, [sortedCountriesWithRank, searchQuery]);

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

  // 切换城市/国家 Tab 时同步清理指标
  const handleTabSwitch = (tab: TabType) => {
    setActiveTab(tab);
    if (tab === 'countries' && (sortMetric === 'heavyDays' || sortMetric === 'improved')) {
      setSortMetric('aqi');
      setSortOrder('asc');
    }
    handleFilterChange();
  };

  // 点击排序指标：若再次点击当前指标则翻转顺序（正序/逆序），若点击新指标则激活新指标
  const handleSortMetricClick = (metric: SortMetric) => {
    if (sortMetric === metric) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortMetric(metric);
      setSortOrder('asc');
    }
    handleFilterChange();
  };

  // 统一规范的排名展示（移除前三名特殊的金银铜与奖牌 Emoji 表示）
  const renderRankBadge = (rank: number) => {
    return (
      <span className="inline-flex items-center justify-center min-w-[28px] h-6 px-1.5 rounded-md bg-slate-100 text-slate-700 font-bold text-xs sm:text-[13px] tabular-nums border border-slate-200/80">
        {rank}
      </span>
    );
  };

  // AQI 等级标签
  const renderAqiLevelTag = (aqi: number) => {
    const evalResult = standard === 'CN' ? getCNEvaluation(aqi) : getUSEvaluation(aqi);
    let colorClass = 'bg-emerald-50 text-emerald-700 border-emerald-200';

    if (aqi <= 50) {
      colorClass = 'bg-emerald-50 text-emerald-700 border-emerald-200';
    } else if (aqi <= 100) {
      colorClass = 'bg-amber-50 text-amber-700 border-amber-200';
    } else if (aqi <= 150) {
      colorClass = 'bg-orange-50 text-orange-700 border-orange-200';
    } else if (aqi <= 200) {
      colorClass = 'bg-rose-50 text-rose-700 border-rose-200';
    } else if (aqi <= 300) {
      colorClass = 'bg-purple-50 text-purple-700 border-purple-200';
    } else {
      colorClass = 'bg-rose-950/10 text-rose-900 border-rose-300';
    }

    return (
      <span className={`px-2 py-0.5 rounded-md text-xs font-bold border ${colorClass}`}>
        {evalResult.level}
      </span>
    );
  };

  return (
    <div className="glass-panel rounded-2xl p-4 sm:p-5 space-y-3.5">
      {/* 头部标题与主 Tab 切换 */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-100 pb-3">
        <div>
          <div className="flex items-center space-x-2">
            <Trophy className="w-5 h-5 text-amber-500" />
            <h2 className="text-lg font-bold text-slate-900">
              全球与多国空气质量多维全景排行榜
            </h2>
          </div>
        </div>

        {/* 城市榜 vs 国家榜 切换器 */}
        <div className="w-full sm:w-auto grid grid-cols-2 sm:flex sm:items-center bg-slate-100/80 p-1 rounded-xl border border-slate-200/60">
          <button
            onClick={() => handleTabSwitch('cities')}
            className={`flex items-center justify-center space-x-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              activeTab === 'cities'
                ? 'bg-white text-sky-700 shadow-sm shadow-slate-200'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Building2 className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">城市精细榜 (928城)</span>
          </button>
          <button
            onClick={() => handleTabSwitch('countries')}
            className={`flex items-center justify-center space-x-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              activeTab === 'countries'
                ? 'bg-white text-sky-700 shadow-sm shadow-slate-200'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Globe className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">国家/地区综合榜 (93国)</span>
          </button>
        </div>
      </div>

      {/* 综合多维筛选工具栏 */}
      <div className="bg-slate-50/70 rounded-xl p-3 border border-slate-200/60 space-y-2.5">
        {/* 第一行筛选器：地理范围、国家单选、年份 */}
        <div className="flex flex-wrap items-center gap-2.5 text-xs">
          {/* 地理范围单选（仅城市榜有效） */}
          {activeTab === 'cities' && (
            <div className="flex items-center bg-white rounded-lg p-0.5 border border-slate-200 max-w-full overflow-x-auto">
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
                中国国内 (375)
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
                海外国际 (564)
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
                    {co.code} · {co.nameZh} ({co.count}城)
                  </option>
                ))}
              </select>
            </div>
          )}

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

        {/* 第二行筛选器：指标排序与正反序切换、即时预览搜索框 */}
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
          {/* 指标排序维度与顺序翻转 */}
          <div className="flex flex-wrap items-center gap-1.5">
            {(activeTab === 'cities'
              ? [
                  { key: 'aqi', label: '综合 AQI' },
                  { key: 'pm25', label: 'PM2.5 均值' },
                  { key: 'pm10', label: 'PM10 均值' },
                  { key: 'goodRatio', label: '达标优良率' },
                  { key: 'heavyDays', label: '重污染天数' },
                  { key: 'improved', label: '治理改善' },
                ]
              : [
                  { key: 'aqi', label: '全国综合 AQI' },
                  { key: 'pm25', label: 'PM2.5 均值' },
                  { key: 'pm10', label: 'PM10 均值' },
                  { key: 'goodRatio', label: '平均优良率' },
                ]
            ).map((m) => {
              const isActive = sortMetric === m.key;
              return (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => handleSortMetricClick(m.key as SortMetric)}
                  className={`flex items-center space-x-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    isActive
                      ? 'bg-sky-600 text-white shadow-sm ring-1 ring-sky-600/20'
                      : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                  title={
                    isActive
                      ? `当前按【${m.label}】${
                          sortOrder === 'asc' ? '正序 (优良/低值在前)' : '逆序 (污染/高值在前)'
                        }，再次点击直接切换顺序`
                      : `按【${m.label}】排序`
                  }
                >
                  <span>{m.label}</span>
                  {isActive && (
                    <span className="flex items-center text-white ml-0.5">
                      {sortOrder === 'asc' ? (
                        <ArrowUp className="w-3.5 h-3.5 stroke-[2.5]" />
                      ) : (
                        <ArrowDown className="w-3.5 h-3.5 stroke-[2.5]" />
                      )}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* 即时搜索框与预览悬浮下拉面板 */}
          <div ref={searchContainerRef} className="relative w-full sm:w-auto flex-1 min-w-0 sm:min-w-[240px] max-w-sm">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onFocus={() => {
                if (searchQuery.trim()) setIsSearchPreviewOpen(true);
              }}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setIsSearchPreviewOpen(true);
                handleFilterChange();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setIsSearchPreviewOpen(false);
              }}
              placeholder={
                activeTab === 'cities'
                  ? geoScope === 'domestic'
                    ? '搜索国内 375 城市查排名 (如: 成都 / 北京)...'
                    : geoScope === 'international'
                    ? '搜索海外 564 城市查排名 (如: 伦敦 / 东京)...'
                    : '搜索全球 939 城市查排名 (如: 成都 / 纽约)...'
                  : '搜索国家名称 / 代码 (如: 中国 / CN)...'
              }
              className="w-full pl-8 pr-8 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/10 placeholder:text-slate-400 text-xs shadow-sm"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setIsSearchPreviewOpen(false);
                  handleFilterChange();
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600 rounded-full cursor-pointer"
                title="清空搜索"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}

            {/* 即时搜索智能预览卡片面板 */}
            {isSearchPreviewOpen && searchQuery.trim() && (
              <div className="absolute left-0 right-0 sm:right-auto sm:w-[420px] max-w-[calc(100vw-2rem)] top-full mt-1.5 z-50 bg-white rounded-xl border border-slate-200/90 shadow-2xl overflow-hidden animate-in fade-in duration-100">
                <div className="px-3 py-1.5 bg-slate-50 border-b border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                  <span>
                    找到 <b className="text-slate-900">{totalItems}</b> 个符合条件的{activeTab === 'cities' ? '城市' : '国家/地区'}
                  </span>
                  <span className="text-[10px] text-slate-400">点击直达定位</span>
                </div>

                <div className="max-h-72 overflow-y-auto divide-y divide-slate-100">
                  {activeTab === 'cities' ? (
                    filteredCities.slice(0, 6).length > 0 ? (
                      filteredCities.slice(0, 6).map((c) => (
                        <div
                          key={c.id}
                          onClick={() => {
                            setSearchQuery(c.nameZh);
                            setIsSearchPreviewOpen(false);
                          }}
                          className="px-3 py-2 flex items-center justify-between hover:bg-sky-50/70 cursor-pointer transition-colors group"
                        >
                          <div className="flex items-center space-x-2 min-w-0">
                            <span className="min-w-[28px] h-5 px-1 flex items-center justify-center shrink-0 rounded bg-slate-100 text-slate-700 font-bold text-[11px] border border-slate-200 tabular-nums">
                              #{c.rank}
                            </span>
                            <span className="px-1.5 py-0.5 flex items-center justify-center shrink-0 rounded bg-slate-100 text-slate-700 text-[10px] font-semibold border border-slate-200/90 select-none">
                              {c.countryZh}
                            </span>
                            <div className="min-w-0">
                              <div className="flex items-center space-x-1">
                                <span className="font-bold text-xs text-slate-900 group-hover:text-sky-600 transition-colors truncate">
                                  {c.nameZh}
                                </span>
                                <span className="text-[10px] text-slate-400 font-mono truncate">
                                  ({c.nameEn})
                                </span>
                              </div>
                              {!c.isDomestic && c.country !== 'CN' && c.province && (
                                <div className="text-[10px] text-slate-500 truncate">
                                  {c.province}
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center space-x-2 shrink-0">
                            <div className="text-right">
                              <div className="text-xs font-black text-slate-900">AQI {c.aqiAvg}</div>
                              <div className="text-[10px] text-slate-400">PM2.5 {c.pm25Avg}</div>
                            </div>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onToggleCity(c.id);
                              }}
                              className={`p-1 rounded-md text-xs transition-colors cursor-pointer ${
                                selectedCityIds.includes(c.id)
                                  ? 'bg-sky-100 text-sky-700'
                                  : 'bg-slate-100 text-slate-600 hover:bg-sky-50 hover:text-sky-600'
                              }`}
                              title={selectedCityIds.includes(c.id) ? '已加入沙盘，点击移出' : '加入沙盘对比'}
                            >
                              {selectedCityIds.includes(c.id) ? (
                                <Check className="w-3.5 h-3.5 text-sky-600" />
                              ) : (
                                <Plus className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="py-4 text-center text-xs text-slate-400">无匹配城市</div>
                    )
                  ) : (
                    filteredCountries.slice(0, 6).length > 0 ? (
                      filteredCountries.slice(0, 6).map((co) => (
                        <div
                          key={co.countryCode}
                          onClick={() => {
                            setSearchQuery(co.nameZh);
                            setIsSearchPreviewOpen(false);
                          }}
                          className="px-3 py-2 flex items-center justify-between hover:bg-sky-50/70 cursor-pointer transition-colors group"
                        >
                          <div className="flex items-center space-x-2 min-w-0">
                            <span className="min-w-[28px] h-5 px-1 flex items-center justify-center shrink-0 rounded bg-slate-100 text-slate-700 font-bold text-[11px] border border-slate-200 tabular-nums">
                              #{co.rank}
                            </span>
                            <span className="text-base flex items-center justify-center shrink-0 select-none">
                              {co.flag}
                            </span>
                            <div>
                              <div className="font-bold text-xs text-slate-900 group-hover:text-sky-600 transition-colors">
                                {co.nameZh} ({co.nameEn})
                              </div>
                              <div className="text-[10px] text-slate-500">
                                纳入 {co.cityCount} 城 · 最清洁: {co.cleanestCity.nameZh}
                              </div>
                            </div>
                          </div>

                          <div className="text-right shrink-0">
                            <div className="text-xs font-black text-slate-900">AQI {co.aqiAvg}</div>
                            <div className="text-[10px] text-slate-400">PM2.5 {co.pm25Avg}</div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="py-4 text-center text-xs text-slate-400">无匹配国家</div>
                    )
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 搜索提示（未搜索时不占任何高度，彻底消除多余空隙） */}
      {searchQuery.trim() && (
        <div className="text-xs text-slate-500 px-1 py-0.5">
          已找到 <span className="font-bold text-sky-600">{totalItems}</span> 个符合条件的对象
        </div>
      )}

      {/* 榜单表格展示 */}
      {activeTab === 'cities' ? (
        <div className="overflow-x-auto rounded-xl border border-slate-200/80 shadow-sm bg-white custom-scrollbar">
          <table className="w-full min-w-[780px] text-left text-sm text-slate-700">
            <thead className="bg-slate-50/90 text-xs sm:text-[13px] font-bold text-slate-600 uppercase tracking-wider border-b border-slate-200">
              <tr>
                <th className="py-3.5 px-3 w-14 text-center whitespace-nowrap">排名</th>
                <th className="py-3.5 px-3 min-w-[180px] whitespace-nowrap">城市 / 国家</th>
                <th className="py-3.5 px-3 min-w-[110px] whitespace-nowrap">综合 AQI</th>
                <th className="py-3.5 px-3 min-w-[120px] whitespace-nowrap">PM2.5 年均 (μg/m³)</th>
                <th className="py-3.5 px-3 min-w-[120px] whitespace-nowrap">PM10 年均 (μg/m³)</th>
                <th className="py-3.5 px-3 min-w-[130px] whitespace-nowrap">优良达标率</th>
                <th className="py-3.5 px-3 min-w-[140px] whitespace-nowrap">改善幅度 (较基准)</th>
                <th className="py-3.5 px-3 min-w-[90px] text-right whitespace-nowrap">沙盘操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {!mounted ? (
                [...Array(pageSize)].map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td className="py-3.5 px-3 text-center"><div className="h-6 w-6 bg-slate-100 rounded mx-auto" /></td>
                    <td className="py-3.5 px-3"><div className="h-5 w-32 bg-slate-100 rounded" /></td>
                    <td className="py-3.5 px-3"><div className="h-5 w-16 bg-slate-100 rounded" /></td>
                    <td className="py-3.5 px-3"><div className="h-5 w-12 bg-slate-100 rounded" /></td>
                    <td className="py-3.5 px-3"><div className="h-5 w-12 bg-slate-100 rounded" /></td>
                    <td className="py-3.5 px-3"><div className="h-5 w-14 bg-slate-100 rounded" /></td>
                    <td className="py-3.5 px-3"><div className="h-5 w-16 bg-slate-100 rounded" /></td>
                    <td className="py-3.5 px-3 text-right"><div className="h-6 w-12 bg-slate-100 rounded ml-auto" /></td>
                  </tr>
                ))
              ) : paginatedCities.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    <div className="space-y-1.5">
                      <div className="text-sm">未找到符合当前筛选条件的官方监测城市</div>
                      {geoScope !== 'all' && searchQuery.trim() && (
                        <div>
                          <button
                            type="button"
                            onClick={() => {
                              setGeoScope('all');
                              setSelectedCountry('ALL');
                            }}
                            className="text-xs text-sky-600 hover:text-sky-700 underline cursor-pointer"
                          >
                            当前处于「{geoScope === 'domestic' ? '中国国内' : '国际海外'}」范围，点击切换为「全部全球」搜索
                          </button>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                paginatedCities.map((item) => {
                  const rank = item.rank;
                  const isSelectedInSandbox = selectedCityIds.includes(item.id);

                  return (
                    <tr
                      key={item.id}
                      onClick={() => router.push(`/history?city=${item.id}&year=${item.year}`)}
                      className={`hover:bg-sky-50/60 cursor-pointer transition-colors group ${
                        isSelectedInSandbox ? 'bg-sky-50/20' : ''
                      }`}
                      title="点击跳转查看该城市历史数据"
                    >
                      {/* 排名 */}
                      <td className="py-3.5 px-3 text-center whitespace-nowrap">
                        <div className="flex justify-center">{renderRankBadge(rank)}</div>
                      </td>

                      {/* 城市与国家 */}
                      <td className="py-3.5 px-3 whitespace-nowrap">
                        <div className="flex items-center space-x-2.5">
                          {/* 中文国家徽标 */}
                          <span
                            className="px-2 py-0.5 flex items-center justify-center shrink-0 rounded bg-slate-100 text-slate-700 text-xs font-semibold border border-slate-200/90 select-none whitespace-nowrap"
                            title={`${item.countryZh} (${item.country})`}
                          >
                            {item.countryZh}
                          </span>
                          <div className="min-w-0">
                            <div className="flex items-center space-x-1.5">
                              <span className="font-bold text-sm sm:text-base text-slate-900 group-hover:text-sky-600 transition-colors inline-flex items-center space-x-1 whitespace-nowrap">
                                <span>{item.nameZh}</span>
                                <ExternalLink className="w-3.5 h-3.5 text-slate-400 group-hover:text-sky-600 transition-colors" />
                              </span>
                              <span className="text-xs text-slate-500 whitespace-nowrap">({item.nameEn})</span>
                            </div>
                            {!item.isDomestic && item.country !== 'CN' && item.province && (
                              <div className="text-xs text-slate-500 truncate whitespace-nowrap font-medium">
                                {item.province}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* 综合 AQI */}
                      <td className="py-3.5 px-3 whitespace-nowrap">
                        <div className="flex items-center space-x-2">
                          <span className="text-base sm:text-lg font-black text-slate-900">{item.aqiAvg}</span>
                          {renderAqiLevelTag(item.aqiAvg)}
                        </div>
                      </td>

                      {/* PM2.5 */}
                      <td className="py-3.5 px-3 text-sm sm:text-[15px] font-bold text-slate-800 whitespace-nowrap">
                        {item.pm25Avg}
                      </td>

                      {/* PM10 */}
                      <td className="py-3.5 px-3 text-sm sm:text-[15px] text-slate-700 font-semibold whitespace-nowrap">
                        {item.pm10Avg > 0 ? item.pm10Avg : '-'}
                      </td>

                      {/* 优良达标率 */}
                      <td className="py-3.5 px-3 whitespace-nowrap">
                        <div className="flex items-center space-x-2">
                          <div className="w-16 h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-emerald-500 rounded-full"
                              style={{ width: `${Math.min(100, item.goodDaysRatio)}%` }}
                            />
                          </div>
                          <span className="font-extrabold text-sm sm:text-base text-emerald-700">
                            {item.goodDaysRatio}%
                          </span>
                        </div>
                      </td>

                      {/* 历史改善幅度 */}
                      <td className="py-3.5 px-3 whitespace-nowrap">
                        {item.improvementRate !== null ? (
                          <div className="flex items-center space-x-1 whitespace-nowrap">
                            {item.improvementRate < 0 ? (
                              <>
                                <TrendingDown className="w-4 h-4 text-emerald-600 shrink-0" />
                                <span className="font-extrabold text-sm sm:text-base text-emerald-600">
                                  {item.improvementRate}%
                                </span>
                              </>
                            ) : (
                              <>
                                <TrendingUp className="w-4 h-4 text-rose-500 shrink-0" />
                                <span className="font-extrabold text-sm sm:text-base text-rose-500">
                                  +{item.improvementRate}%
                                </span>
                              </>
                            )}
                            <span className="text-xs text-slate-400 whitespace-nowrap">
                              (自{item.earliestYear})
                            </span>
                          </div>
                        ) : (
                          <span className="text-slate-400 text-sm">-</span>
                        )}
                      </td>

                      {/* 加入沙盘按钮 */}
                      <td className="py-3 px-3 text-right whitespace-nowrap">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleCity(item.id);
                          }}
                          className={`inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-all ${
                            isSelectedInSandbox
                              ? 'bg-sky-600 text-white shadow-sm'
                              : 'bg-slate-100 hover:bg-sky-100 text-slate-700 hover:text-sky-700 border border-slate-200'
                          }`}
                        >
                          {isSelectedInSandbox ? (
                            <>
                              <Check className="w-3 h-3 shrink-0" />
                              <span className="whitespace-nowrap">已在沙盘</span>
                            </>
                          ) : (
                            <>
                              <Plus className="w-3 h-3 shrink-0" />
                              <span className="whitespace-nowrap">对比</span>
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
        <div className="overflow-x-auto rounded-xl border border-slate-200/80 shadow-sm bg-white custom-scrollbar">
          <table className="w-full min-w-[780px] text-left text-sm text-slate-700">
            <thead className="bg-slate-50/90 text-xs sm:text-[13px] font-bold text-slate-600 uppercase tracking-wider border-b border-slate-200">
              <tr>
                <th className="py-3.5 px-3 w-14 text-center whitespace-nowrap">排名</th>
                <th className="py-3.5 px-3 min-w-[150px] whitespace-nowrap">国家 / 地区</th>
                <th className="py-3.5 px-3 min-w-[120px] whitespace-nowrap">纳入监测城市数</th>
                <th className="py-3.5 px-3 min-w-[110px] whitespace-nowrap">全国平均 AQI</th>
                <th className="py-3.5 px-3 min-w-[130px] whitespace-nowrap">PM2.5 全国均值 (μg/m³)</th>
                <th className="py-3.5 px-3 min-w-[110px] whitespace-nowrap">平均优良达标率</th>
                <th className="py-3.5 px-3 min-w-[170px] whitespace-nowrap">最清洁代表城市</th>
                <th className="py-3.5 px-3 min-w-[170px] whitespace-nowrap">污染最重代表城市</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {!mounted ? (
                [...Array(pageSize)].map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td className="py-3.5 px-3 text-center"><div className="h-6 w-6 bg-slate-100 rounded mx-auto" /></td>
                    <td className="py-3.5 px-3"><div className="h-5 w-32 bg-slate-100 rounded" /></td>
                    <td className="py-3.5 px-3"><div className="h-5 w-16 bg-slate-100 rounded" /></td>
                    <td className="py-3.5 px-3"><div className="h-5 w-12 bg-slate-100 rounded" /></td>
                    <td className="py-3.5 px-3"><div className="h-5 w-12 bg-slate-100 rounded" /></td>
                    <td className="py-3.5 px-3"><div className="h-5 w-14 bg-slate-100 rounded" /></td>
                    <td className="py-3.5 px-3"><div className="h-5 w-16 bg-slate-100 rounded" /></td>
                    <td className="py-3.5 px-3 text-right"><div className="h-6 w-12 bg-slate-100 rounded ml-auto" /></td>
                  </tr>
                ))
              ) : paginatedCountries.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    <span className="text-sm">未找到符合条件的国家或地区</span>
                  </td>
                </tr>
              ) : (
                paginatedCountries.map((cItem) => {
                  const rank = cItem.rank;

                  return (
                    <tr key={cItem.countryCode} className="hover:bg-sky-50/40 transition-colors">
                      {/* 排名 */}
                      <td className="py-3.5 px-3 text-center whitespace-nowrap">
                        <div className="flex justify-center">{renderRankBadge(rank)}</div>
                      </td>

                      {/* 国家 */}
                      <td className="py-3.5 px-3 whitespace-nowrap">
                        <div className="flex items-center space-x-2.5">
                          <span
                            className="text-lg flex items-center justify-center shrink-0 select-none"
                            title={`${cItem.nameZh} (${cItem.countryCode})`}
                          >
                            {cItem.flag}
                          </span>
                          <div>
                            <span className="font-bold text-slate-900 text-sm sm:text-base whitespace-nowrap">
                              {cItem.nameZh}
                            </span>
                            <div className="text-xs text-slate-400 whitespace-nowrap">{cItem.nameEn}</div>
                          </div>
                        </div>
                      </td>

                      {/* 城市数量 */}
                      <td className="py-3.5 px-3 font-semibold text-slate-800 text-sm sm:text-[15px] whitespace-nowrap">
                        {cItem.cityCount} 座城市
                      </td>

                      {/* 全国平均 AQI */}
                      <td className="py-3.5 px-3 whitespace-nowrap">
                        <div className="flex items-center space-x-2">
                          <span className="text-base sm:text-lg font-black text-slate-900">{cItem.aqiAvg}</span>
                          {renderAqiLevelTag(cItem.aqiAvg)}
                        </div>
                      </td>

                      {/* 全国 PM2.5 均值 */}
                      <td className="py-3.5 px-3 font-bold text-slate-800 text-sm sm:text-[15px] whitespace-nowrap">
                        {cItem.pm25Avg}
                      </td>

                      {/* 平均达标率 */}
                      <td className="py-3.5 px-3 whitespace-nowrap">
                        <span className="font-extrabold text-sm sm:text-base text-emerald-700">
                          {cItem.goodDaysRatioAvg}%
                        </span>
                      </td>

                      {/* 最清洁城市 */}
                      <td className="py-3.5 px-3 whitespace-nowrap">
                        <div className="flex items-center space-x-2 whitespace-nowrap">
                          <Link
                            href={`/history?city=${cItem.cleanestCity.id}&year=${selectedYear}`}
                            className="flex items-center space-x-1.5 hover:text-sky-600 font-bold group/c1 text-slate-800 text-sm whitespace-nowrap"
                            title="点击跳转查看该城市历史数据"
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                            <span className="group-hover/c1:underline whitespace-nowrap">{cItem.cleanestCity.nameZh}</span>
                            <span className="text-xs text-slate-400 whitespace-nowrap font-normal">
                              (AQI {cItem.cleanestCity.aqiAvg})
                            </span>
                            <ExternalLink className="w-3 h-3 text-slate-400 group-hover/c1:text-sky-600 shrink-0" />
                          </Link>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onAddCity(cItem.cleanestCity.id);
                            }}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 hover:bg-sky-100 text-slate-600 transition-colors shrink-0 whitespace-nowrap cursor-pointer"
                            title="加入对比沙盘"
                          >
                            +对比
                          </button>
                        </div>
                      </td>

                      {/* 污染最重城市 */}
                      <td className="py-3 px-3 whitespace-nowrap">
                        <div className="flex items-center space-x-2 whitespace-nowrap">
                          <Link
                            href={`/history?city=${cItem.worstCity.id}&year=${selectedYear}`}
                            className="flex items-center space-x-1.5 hover:text-rose-600 font-semibold group/c2 text-slate-800 whitespace-nowrap"
                            title="点击跳转查看该城市历史数据"
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0" />
                            <span className="group-hover/c2:underline whitespace-nowrap">{cItem.worstCity.nameZh}</span>
                            <span className="text-[10px] text-slate-400 whitespace-nowrap">
                              (AQI {cItem.worstCity.aqiAvg})
                            </span>
                            <ExternalLink className="w-2.5 h-2.5 text-slate-400 group-hover/c2:text-rose-600 shrink-0" />
                          </Link>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onAddCity(cItem.worstCity.id);
                            }}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 hover:bg-sky-100 text-slate-600 transition-colors shrink-0 whitespace-nowrap cursor-pointer"
                            title="加入对比沙盘"
                          >
                            +对比
                          </button>
                        </div>
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
      <div className="flex flex-col sm:flex-row items-center justify-between gap-2 pt-2 text-xs text-slate-500">
        <div className="flex items-center space-x-2">
          <span>
            共 <span className="font-bold text-slate-800">{totalItems}</span> {activeTab === 'cities' ? '城' : '国'}
          </span>
          <span className="text-slate-300">·</span>
          <div className="flex items-center space-x-1">
            <span>每页:</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="bg-slate-50 border border-slate-200 rounded px-1.5 py-0.5 text-xs text-slate-700 cursor-pointer"
            >
              <option value={10}>10条</option>
              <option value={15}>15条</option>
              <option value={30}>30条</option>
              <option value={50}>50条</option>
            </select>
          </div>
        </div>

        <PageJumper
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
        />
      </div>
    </div>
  );
}
