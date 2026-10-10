'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useStandard } from '@/components/StandardContext';
import { getCNEvaluation, getUSEvaluation } from '@/lib/aqi-calculator';
import {
  Trophy,
  Flame,
  Leaf,
  Globe,
  Navigation,
  RefreshCw,
  Search,
  ChevronLeft,
  ChevronRight,
  X,
  Users,
} from 'lucide-react';
import { formatPopulation } from '@/lib/constants/cities';
import { getCountryInfo } from '@/lib/constants/countries';

export type PopulationTier = 'all' | '1000w' | '500w' | '100w' | '10w';

const POPULATION_THRESHOLDS: Record<PopulationTier, number> = {
  all: 0,
  '1000w': 10_000_000,
  '500w': 5_000_000,
  '100w': 1_000_000,
  '10w': 100_000,
};

export interface RankedCityItem {
  id: string;
  nameZh: string;
  nameEn: string;
  country: string;
  province?: string;
  latitude: number;
  longitude: number;
  isDomestic: boolean;
  aqi: number;
  aqiUS?: number;
  aqiCN?: number;
  pm25?: number;
  stationsCount: number;
  population?: number;
  repAqiUS?: number;
  repAqiCN?: number;
  repPm25?: number;
  repStationName?: string;
  repStationUid?: number;
}

export interface RankedCityWithOrder extends RankedCityItem {
  cleanRank: number; // 在最清新榜中的绝对排名
  pollutedRank: number; // 在最污染榜中的绝对排名
}

interface RankingData {
  success: boolean;
  updatedAt: string;
  totalStations: number;
  totalCities: number;
  domestic: {
    cleanest: RankedCityItem[];
    polluted: RankedCityItem[];
  };
  global: {
    cleanest: RankedCityItem[];
    polluted: RankedCityItem[];
  };
}

interface RealtimeRankingPanelProps {
  onSelectCity: (city: RankedCityItem) => void;
  className?: string;
}

/**
 * 通用可输入页码的分页跳转器
 */
const PageJumper: React.FC<{
  currentPage: number;
  totalPages: number;
  onPageChange: (p: number) => void;
  labelPrefix?: string;
}> = ({ currentPage, totalPages, onPageChange, labelPrefix = '' }) => {
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
    <div className="inline-flex items-center space-x-1.5 text-xs text-slate-500 select-none">
      <button
        type="button"
        onClick={() => onPageChange(Math.max(1, currentPage - 1))}
        disabled={currentPage <= 1}
        className="h-6 w-6 flex items-center justify-center p-0 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed text-slate-600 transition-colors shadow-2xs cursor-pointer shrink-0"
        title="上一页"
      >
        <ChevronLeft className="w-3.5 h-3.5" />
      </button>

      <span className="text-slate-400 text-[11px] leading-none flex items-center">{labelPrefix}第</span>
      <input
        type="number"
        min={1}
        max={totalPages}
        value={inputVal}
        onChange={(e) => setInputVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleCommit();
        }}
        onBlur={handleCommit}
        className="h-6 w-10 px-1 text-center text-xs leading-none bg-white border border-slate-200 rounded-lg font-bold text-slate-800 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500/20 shadow-2xs [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none tabular-nums"
      />
      <span className="text-slate-400 text-[11px] leading-none flex items-center">/ {totalPages} 页</span>

      <button
        type="button"
        onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
        disabled={currentPage >= totalPages}
        className="h-6 w-6 flex items-center justify-center p-0 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed text-slate-600 transition-colors shadow-2xs cursor-pointer shrink-0"
        title="下一页"
      >
        <ChevronRight className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

export const RealtimeRankingPanel: React.FC<RealtimeRankingPanelProps> = ({ onSelectCity, className }) => {
  const { standard } = useStandard();
  const [scope, setScope] = useState<'global' | 'domestic'>('global');
  const [data, setData] = useState<RankingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 搜索框与即时下拉预览
  const [searchQuery, setSearchQuery] = useState('');
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  // 分页状态与测站统计口径
  const [cleanPage, setCleanPage] = useState(1);
  const [pollutedPage, setPollutedPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(10);
  const [populationTier, setPopulationTier] = useState<PopulationTier>('all');
  const [metricMode, setMetricMode] = useState<'avg' | 'rep'>('avg'); // 'avg' = 全市多站均值, 'rep' = 官方代表站

  const fetchRankings = async (isManual?: boolean | unknown) => {
    setLoading(true);
    setError(null);
    try {
      // 直连同源服务端聚合接口 (Node.js 24 并发池 + 60s 极短防抖打闸，支持手动刷新直接穿透)
      const apiUrl = `/api/ranking/realtime${isManual === true ? '?refresh=true' : ''}`;
      const apiRes = await fetch(apiUrl);
      if (!apiRes.ok) {
        if (apiRes.status === 404) {
          // 纯静态站点导出托管兜底 (如 GitHub Pages 静态导出无 Node.js API 时动态按需加载)
          const { getRealtimeRanking } = await import('@/lib/services/realtime-ranking');
          const clientData = await getRealtimeRanking(isManual === true);
          if (clientData && clientData.success && clientData.totalCities > 0) {
            setData(clientData);
            return;
          }
        }
        throw new Error(`排行榜服务响应异常 (${apiRes.status})`);
      }
      const apiJson = (await apiRes.json()) as RankingData;
      if (apiJson && apiJson.success && apiJson.totalCities > 0) {
        setData(apiJson);
        return;
      }
      throw new Error('未获取到有效排行数据');
    } catch (err: any) {
      console.error('实时排行拉取或计算失败:', err);
      setError(err?.message || '获取实时排行失败，请检查网络后重试');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRankings();
  }, []);

  // 点击搜索外部自动关闭预览下拉
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setIsPreviewOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 重置分页
  useEffect(() => {
    setCleanPage(1);
    setPollutedPage(1);
  }, [scope, searchQuery, pageSize, populationTier, metricMode]);

  const activeCategory = scope === 'global' ? data?.global : data?.domestic;

  // 为当前所有城市赋予真实、固定的绝对名次 (1 .. N)，依据选定标准与测站口径(全市均值 vs 官方代表站)动态排序
  const allCitiesWithRank = useMemo<RankedCityWithOrder[]>(() => {
    const cleanest = activeCategory?.cleanest || [];
    const getVal = (c: RankedCityItem) => {
      if (metricMode === 'rep') {
        return standard === 'CN' ? (c.repAqiCN ?? c.aqiCN ?? c.aqi) : (c.repAqiUS ?? c.aqiUS ?? c.aqi);
      }
      return standard === 'CN' ? (c.aqiCN ?? c.aqi) : (c.aqiUS ?? c.aqi);
    };

    // 依据选定标准进行升序排序 (AQI 越低越清新)
    const sorted = [...cleanest].sort((a, b) => getVal(a) - getVal(b));
    const total = sorted.length;
    return sorted.map((c, idx) => ({
      ...c,
      cleanRank: idx + 1,
      pollutedRank: total - idx,
    }));
  }, [activeCategory, standard, metricMode]);

  // 人口规模阶梯过滤 (全部 / 1000万+ / 500万+ / 100万+ / 10万+)
  const populationFilteredCities = useMemo(() => {
    const threshold = POPULATION_THRESHOLDS[populationTier];
    if (threshold <= 0) return allCitiesWithRank;
    return allCitiesWithRank.filter((c) => (c.population ?? 0) >= threshold);
  }, [allCitiesWithRank, populationTier]);

  // 即时搜索匹配列表（携带保留的绝对名次）
  const searchMatchedCities = useMemo(() => {
    if (!searchQuery.trim()) return populationFilteredCities;
    const q = searchQuery.trim().toLowerCase();
    return populationFilteredCities.filter(
      (c) =>
        c.nameZh.toLowerCase().includes(q) ||
        c.nameEn.toLowerCase().includes(q) ||
        c.country.toLowerCase().includes(q) ||
        (c.province && c.province.toLowerCase().includes(q))
    );
  }, [populationFilteredCities, searchQuery]);

  // 页面列表过滤后的数据
  const filteredCleanest = useMemo(() => {
    return searchMatchedCities;
  }, [searchMatchedCities]);

  const currentFilteredStations = useMemo(() => {
    return filteredCleanest.reduce((sum, c) => sum + (c.stationsCount || 1), 0);
  }, [filteredCleanest]);

  const filteredPolluted = useMemo(() => {
    const getVal = (c: RankedCityItem) => {
      if (metricMode === 'rep') {
        return standard === 'CN' ? (c.repAqiCN ?? c.aqiCN ?? c.aqi) : (c.repAqiUS ?? c.aqiUS ?? c.aqi);
      }
      return standard === 'CN' ? (c.aqiCN ?? c.aqi) : (c.aqiUS ?? c.aqi);
    };

    if (!searchQuery.trim() && populationTier === 'all') {
      return [...allCitiesWithRank].reverse();
    }
    // 搜索或人口筛选时按当前标准下的污染程度降序排
    return [...searchMatchedCities].sort((a, b) => getVal(b) - getVal(a));
  }, [allCitiesWithRank, searchMatchedCities, searchQuery, populationTier, standard, metricMode]);


  // 双栏分页总页数与当前切片
  const cleanTotalPages = Math.max(1, Math.ceil(filteredCleanest.length / pageSize));
  const currentCleanList = filteredCleanest.slice((cleanPage - 1) * pageSize, cleanPage * pageSize);

  const pollutedTotalPages = Math.max(1, Math.ceil(filteredPolluted.length / pageSize));
  const currentPollutedList = filteredPolluted.slice(
    (pollutedPage - 1) * pageSize,
    pollutedPage * pageSize
  );

  const handleSelectAndFly = (c: RankedCityItem) => {
    onSelectCity(c);
    setIsPreviewOpen(false);
  };

  const renderRankBadge = (rankNum: number, isClean: boolean) => {
    if (rankNum === 1) {
      return (
        <span
          className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs font-black shadow-xs shrink-0 ${
            isClean
              ? 'bg-amber-400 text-amber-950 ring-1 ring-amber-300/80'
              : 'bg-rose-500 text-white ring-1 ring-rose-400/80'
          }`}
        >
          1
        </span>
      );
    }
    if (rankNum === 2) {
      return (
        <span
          className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs font-black shrink-0 ${
            isClean ? 'bg-slate-200 text-slate-800' : 'bg-rose-400 text-white'
          }`}
        >
          2
        </span>
      );
    }
    if (rankNum === 3) {
      return (
        <span
          className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs font-black shrink-0 ${
            isClean ? 'bg-amber-600/20 text-amber-900' : 'bg-rose-200 text-rose-900'
          }`}
        >
          3
        </span>
      );
    }
    return (
      <span className="w-6 h-6 rounded-lg flex items-center justify-center text-xs font-bold text-slate-500 bg-white/90 border border-slate-200/80 shrink-0">
        {rankNum}
      </span>
    );
  };

  return (
    <div id="realtime-ranking-section" className={`glass-panel rounded-2xl p-4 sm:p-4.5 lg:p-5 flex flex-col ${className || 'space-y-3.5'}`}>
      {/* 头部区域：第一行（标题 + 更新时间 + 快捷刷新），第二行（搜索 + 范围Tab + 人口筛选 + 分页大小） */}
      <div className="space-y-3 pb-3 border-b border-slate-100 shrink-0">
        {/* 第一行：标题与更新时间 */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-white shadow-2xs shrink-0">
              <Trophy className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight whitespace-nowrap">
                  实时排行
                </h2>
                {data && (
                  <span className="text-[10px] sm:text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200/80 hidden xs:inline-block">
                    {metricMode === 'rep'
                      ? (populationTier !== 'all' || searchQuery.trim()
                          ? `筛选 ${filteredCleanest.length} 官方代表站`
                          : `在测 ${activeCategory?.cleanest.length || 0} 官方代表站`)
                      : (populationTier !== 'all' || searchQuery.trim()
                          ? `筛选 ${filteredCleanest.length} 城 · ${currentFilteredStations} 站`
                          : `在测 ${activeCategory?.cleanest.length || 0} 城 · ${data.totalStations} 站`)}
                  </span>
                )}
              </div>
              {data?.updatedAt && (
                <p className="text-[11px] text-slate-400 font-normal">
                  更新于 {new Date(data.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center space-x-1.5 sm:space-x-2 shrink-0">
            {/* 测站口径切换开关：全市多站均值 vs 市中心基准站 */}
            <div className="flex items-center p-0.5 bg-slate-100 rounded-xl border border-slate-200/80 text-xs font-semibold shrink-0">
              <button
                type="button"
                onClick={() => setMetricMode('avg')}
                className={`px-2 py-1 rounded-lg transition-all flex items-center space-x-1 cursor-pointer text-[11px] sm:text-xs ${
                  metricMode === 'avg'
                    ? 'bg-white text-sky-700 shadow-2xs font-bold'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
                title="全市均值：统计都会区全域所有在册监测站的综合加权均值"
              >
                <span>全市均值</span>
              </button>
              <button
                type="button"
                onClick={() => setMetricMode('rep')}
                className={`px-2 py-1 rounded-lg transition-all flex items-center space-x-1 cursor-pointer text-[11px] sm:text-xs ${
                  metricMode === 'rep'
                    ? 'bg-white text-indigo-700 shadow-2xs font-bold'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
                title="市中心站：选取离市中心法定经纬度最近的在册核心基准站"
              >
                <span>市中心站</span>
              </button>
            </div>

            {/* 每页条数选择 */}
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="px-2.5 py-1.5 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 text-xs text-slate-700 font-semibold focus:outline-none focus:border-sky-500 shadow-2xs cursor-pointer shrink-0 transition-colors"
              title="设置每页显示数量"
            >
              <option value={10}>10条/页</option>
              <option value={20}>20条/页</option>
              <option value={50}>50条/页</option>
            </select>

            <button
              type="button"
              onClick={() => fetchRankings(true)}
              disabled={loading}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 hover:text-slate-900 transition-colors shadow-2xs disabled:opacity-50 cursor-pointer text-xs font-semibold shrink-0"
              title="手动刷新实时榜单"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-sky-600' : ''}`} />
              <span className="hidden sm:inline">刷新</span>
            </button>
          </div>
        </div>

        {/* 第二行：操作筛选工具栏 (换行呈现，杜绝横向挤压与溢出) */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-2.5 pt-0.5">
          {/* 即时搜索框与智能下拉预览面板 */}
          <div ref={searchContainerRef} className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onFocus={() => {
                if (searchQuery.trim()) setIsPreviewOpen(true);
              }}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setIsPreviewOpen(true);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setIsPreviewOpen(false);
              }}
              placeholder="搜索城市查实时排名..."
              className="w-full pl-8 pr-7 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-sky-500 focus:bg-white focus:ring-2 focus:ring-sky-500/10 transition-all shadow-2xs"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setIsPreviewOpen(false);
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600 rounded-full cursor-pointer"
                title="清空搜索"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}

            {/* 即时搜索下拉预览卡片：保留真实排位 + 实时指数 + 一键直达 */}
            {isPreviewOpen && searchQuery.trim() && (
              <div className="absolute left-0 right-0 sm:right-auto sm:w-[320px] max-w-[calc(100vw-2rem)] top-full mt-1.5 z-50 bg-white rounded-2xl border border-slate-200/95 shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
                <div className="px-3.5 py-2 bg-slate-50 border-b border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                  <span>
                    匹配到 <b className="text-slate-900">{searchMatchedCities.length}</b> 座城市
                  </span>
                  <span className="text-[10px] text-slate-400">点击直达飞抵地图</span>
                </div>

                <div className="max-h-72 overflow-y-auto divide-y divide-slate-100">
                  {searchMatchedCities.length === 0 ? (
                    <div className="p-6 text-center text-xs text-slate-400">
                      未找到与 &quot;{searchQuery}&quot; 匹配的在册城市
                    </div>
                  ) : (
                    searchMatchedCities.slice(0, 8).map((c) => {
                      const currentAqi = metricMode === 'rep'
                        ? (standard === 'CN' ? (c.repAqiCN ?? c.aqiCN ?? c.aqi) : (c.repAqiUS ?? c.aqiUS ?? c.aqi))
                        : (standard === 'CN' ? (c.aqiCN ?? c.aqi) : (c.aqiUS ?? c.aqi));
                      const currentPm25 = metricMode === 'rep' ? (c.repPm25 ?? c.pm25) : c.pm25;
                      const evaluation = standard === 'CN' ? getCNEvaluation(currentAqi) : getUSEvaluation(currentAqi);
                      const showProvince = !c.isDomestic && c.country !== 'CN' && Boolean(c.province);
                      const popPrefix = c.population ? `👥 ${formatPopulation(c.population)} · ` : '';
                      const stationDesc = metricMode === 'rep'
                        ? (c.repStationName ? `市中心站: ${c.repStationName}` : '市中心最近站')
                        : `${c.stationsCount} 站均值`;
                      const infoSubtitle = `${popPrefix}${showProvince ? `${c.province} · ` : ''}${stationDesc}${currentPm25 !== undefined ? ` · PM2.5: ${currentPm25} μg/m³` : ''}`;
                      const popFull = c.population ? ` · 常住人口: ${c.population.toLocaleString()} 人 (${formatPopulation(c.population)})` : '';
                      const fullTooltip = `${c.nameZh}${c.nameEn ? ` (${c.nameEn})` : ''} · ${getCountryInfo(c.country).nameZh}${showProvince ? ` · ${c.province}` : ''}${popFull} · ${stationDesc} · PM2.5: ${currentPm25 !== undefined ? `${currentPm25} μg/m³` : '暂无'} · 实时 AQI: ${currentAqi} (${evaluation.level})`;
                      return (
                        <div
                          key={c.id}
                          onClick={() => handleSelectAndFly(c)}
                          title={fullTooltip}
                          className="px-3 py-2 flex items-center justify-between hover:bg-sky-50/80 cursor-pointer transition-colors group"
                        >
                          <div className="flex items-center space-x-2.5 min-w-0 pr-2">
                            <span
                              className="px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 border tabular-nums bg-slate-100 text-slate-700 border-slate-200"
                              title={`在当前榜单中排名第 ${c.cleanRank}`}
                            >
                              #{c.cleanRank}
                            </span>
                            <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] font-semibold border border-slate-200/90 shrink-0 select-none">
                              {getCountryInfo(c.country).nameZh}
                            </span>
                            <div className="min-w-0">
                              <div className="flex items-center space-x-1">
                                <span
                                  title={`${c.nameZh}${c.nameEn ? ` (${c.nameEn})` : ''}`}
                                  className="font-bold text-xs text-slate-900 group-hover:text-sky-600 transition-colors truncate"
                                >
                                  {c.nameZh}
                                </span>
                                <span className="text-[10px] text-slate-400 font-mono truncate hidden sm:inline">
                                  ({c.nameEn})
                                </span>
                              </div>
                              <p title={fullTooltip} className="text-[10px] text-slate-400 truncate mt-0.5">
                                {infoSubtitle}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center space-x-2 shrink-0">
                            <div className="text-right">
                              <span className="text-sm font-black text-slate-900">{currentAqi}</span>
                              <span className="text-[9px] text-slate-400 ml-0.5">AQI</span>
                            </div>
                            <span
                              className="text-[10px] px-1.5 py-0.5 rounded font-bold whitespace-nowrap"
                              style={{
                                backgroundColor: `${evaluation.color}15`,
                                color: evaluation.color,
                                border: `1px solid ${evaluation.color}35`,
                              }}
                            >
                              {evaluation.level}
                            </span>
                            <Navigation className="w-3.5 h-3.5 text-slate-300 group-hover:text-sky-600 group-hover:translate-x-0.5 transition-all" />
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 范围 Tab (全球 / 国内) */}
          <div className="flex items-center p-0.5 bg-slate-100 rounded-xl border border-slate-200/80 text-xs font-semibold shrink-0">
            <button
              type="button"
              onClick={() => setScope('global')}
              className={`px-2.5 py-1.5 rounded-lg transition-all flex items-center space-x-1 cursor-pointer ${
                scope === 'global'
                  ? 'bg-white text-sky-700 shadow-2xs font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Globe className="w-3.5 h-3.5" />
              <span>全球</span>
            </button>
            <button
              type="button"
              onClick={() => setScope('domestic')}
              className={`px-2.5 py-1.5 rounded-lg transition-all flex items-center space-x-1 cursor-pointer ${
                scope === 'domestic'
                  ? 'bg-white text-sky-700 shadow-2xs font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>国内</span>
            </button>
          </div>

          {/* 人口规模手动筛选 */}
          <div className="flex items-center shrink-0">
            <div className="relative flex items-center">
              <Users className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 pointer-events-none" />
              <select
                value={populationTier}
                onChange={(e) => setPopulationTier(e.target.value as PopulationTier)}
                className={`pl-7 pr-2.5 py-1.5 rounded-xl border text-xs font-semibold focus:outline-none focus:border-sky-500 shadow-2xs cursor-pointer transition-colors ${
                  populationTier !== 'all'
                    ? 'bg-sky-50/90 text-sky-700 border-sky-300 font-bold ring-1 ring-sky-300/60'
                    : 'bg-slate-50 text-slate-700 border-slate-200'
                }`}
                title="按常住人口规模筛选城市"
              >
                <option value="all">不限人口</option>
                <option value="1000w">≥1000万 (超大城市)</option>
                <option value="500w">≥500万 (特大城市)</option>
                <option value="100w">≥100万 (重点都会)</option>
                <option value="10w">≥10万 (中等城市)</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* 内容区域 (支持在大屏下 flex-1 独立平滑纵向滚动) */}
      {loading && !data ? (
        <div className="grid grid-cols-1 xl:grid-cols-2 divide-y xl:divide-y-0 xl:divide-x divide-slate-100 py-4 flex-1 min-h-0 overflow-y-auto mt-3">
          {[1, 2].map((i) => (
            <div key={i} className={`space-y-2.5 ${i === 1 ? 'xl:pr-4 pb-4 xl:pb-0' : 'xl:pl-4 pt-4 xl:pt-0'}`}>
              <div className="h-4 w-36 bg-slate-200 rounded animate-pulse" />
              {[...Array(pageSize)].map((_, idx) => (
                <div key={idx} className="h-10 bg-slate-100 rounded-xl animate-pulse" />
              ))}
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="p-8 text-center space-y-2 text-slate-500 text-xs flex-1 flex flex-col items-center justify-center">
          <p className="text-rose-500 font-semibold">{error}</p>
          <button
            onClick={() => fetchRankings(true)}
            className="px-3.5 py-1.5 rounded-lg bg-sky-50 text-sky-600 font-bold hover:bg-sky-100 transition-colors cursor-pointer"
          >
            重新尝试拉取
          </button>
        </div>
      ) : (
        /* ========= 优雅微渐变双榜并列 (flex-1 独立内部平滑滚动) ========= */
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-2.5 sm:gap-3 flex-1 min-h-0 overflow-y-auto pr-0.5 custom-scrollbar mt-3">
          {/* 左半区：空气最清新榜 */}
          <div className="flex flex-col justify-between rounded-2xl bg-gradient-to-b from-emerald-50/60 via-emerald-50/20 to-white/95 p-2.5 sm:p-3 border border-emerald-100/90 shadow-2xs space-y-2">
            <div>
              {/* 子标题条 */}
              <div className="flex items-center justify-between pb-2 border-b border-emerald-100/80 px-1 flex-wrap gap-2">
                <div className="flex items-center space-x-1.5">
                  <Leaf className="w-4 h-4 text-emerald-600 shrink-0" />
                  <h3 className="text-sm font-bold text-slate-900">
                    {scope === 'global' ? '全球空气最清新' : '全国空气最清新'}
                  </h3>
                  <span className="text-[10px] sm:text-[11px] font-semibold text-emerald-700 bg-emerald-100/80 px-1.5 py-0.5 rounded-md">
                    第 {(cleanPage - 1) * pageSize + 1} - {Math.min(cleanPage * pageSize, filteredCleanest.length)} 名
                  </span>
                </div>
                <span className="text-xs text-slate-400">共 {filteredCleanest.length} 城</span>
              </div>

              {/* 列表行 */}
              <div className="space-y-1 mt-1.5">
                {currentCleanList.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-400">未找到匹配的城市</div>
                ) : (
                  currentCleanList.map((c) => {
                    const currentAqi = metricMode === 'rep'
                      ? (standard === 'CN' ? (c.repAqiCN ?? c.aqiCN ?? c.aqi) : (c.repAqiUS ?? c.aqiUS ?? c.aqi))
                      : (standard === 'CN' ? (c.aqiCN ?? c.aqi) : (c.aqiUS ?? c.aqi));
                    const currentPm25 = metricMode === 'rep' ? (c.repPm25 ?? c.pm25) : c.pm25;
                    const evaluation = standard === 'CN' ? getCNEvaluation(currentAqi) : getUSEvaluation(currentAqi);
                    const showProvince = !c.isDomestic && c.country !== 'CN' && Boolean(c.province);
                    const popPrefix = c.population ? `👥 ${formatPopulation(c.population)} · ` : '';
                    const stationDesc = metricMode === 'rep'
                      ? (c.repStationName ? `市中心站: ${c.repStationName}` : '市中心最近站')
                      : `${c.stationsCount} 站均值`;
                    const infoSubtitle = `${popPrefix}${showProvince ? `${c.province} · ` : ''}${stationDesc}${currentPm25 !== undefined ? ` · PM2.5: ${currentPm25} μg/m³` : ''}`;
                    const popFull = c.population ? ` · 常住人口: ${c.population.toLocaleString()} 人 (${formatPopulation(c.population)})` : '';
                    const fullTooltip = `${c.nameZh}${c.nameEn ? ` (${c.nameEn})` : ''} · ${getCountryInfo(c.country).nameZh}${showProvince ? ` · ${c.province}` : ''}${popFull} · ${stationDesc} · PM2.5: ${currentPm25 !== undefined ? `${currentPm25} μg/m³` : '暂无'} · 实时 AQI: ${currentAqi} (${evaluation.level})`;
                    return (
                      <div
                        key={c.id}
                        onClick={() => handleSelectAndFly(c)}
                        title={fullTooltip}
                        className="group flex items-center justify-between py-1.5 px-1 sm:px-1.5 rounded-xl hover:bg-white hover:shadow-xs border border-transparent hover:border-emerald-200/80 transition-all cursor-pointer"
                      >
                        <div className="flex items-center space-x-2 flex-1 min-w-0 pr-2">
                          {renderRankBadge(c.cleanRank, true)}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center space-x-1.5 flex-wrap">
                              <span
                                title={`${c.nameZh}${c.nameEn ? ` (${c.nameEn})` : ''} · ${getCountryInfo(c.country).nameZh}`}
                                className="font-semibold text-xs sm:text-[13.5px] text-slate-800 group-hover:text-emerald-700 transition-colors truncate"
                              >
                                {c.nameZh}
                              </span>
                              <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] font-semibold border border-slate-200/90 shrink-0 select-none">
                                {getCountryInfo(c.country).nameZh}
                              </span>
                            </div>
                            <p
                              title={fullTooltip}
                              className="text-[11px] text-slate-400 mt-0.5 truncate"
                            >
                              {infoSubtitle}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center space-x-1.5 shrink-0">
                          <div className="text-right">
                            <span className="text-sm sm:text-base font-bold text-emerald-700">{currentAqi}</span>
                            <span className="text-[9px] text-slate-400 ml-0.5">AQI</span>
                          </div>
                          <span
                            className="text-[11px] px-1.5 py-0.5 rounded-md font-bold shrink-0 whitespace-nowrap"
                            style={{
                              backgroundColor: `${evaluation.color}15`,
                              color: evaluation.color,
                              border: `1px solid ${evaluation.color}35`,
                            }}
                          >
                            {evaluation.level}
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* 左栏底部分页器 */}
            {cleanTotalPages > 1 && (
              <div className="flex items-center justify-between pt-2 border-t border-emerald-100/80 text-xs px-1 flex-wrap gap-2">
                <span className="text-slate-400">
                  共 {filteredCleanest.length} 项
                </span>
                <PageJumper
                  currentPage={cleanPage}
                  totalPages={cleanTotalPages}
                  onPageChange={setCleanPage}
                />
              </div>
            )}
          </div>

          {/* 右半区：污染最严峻榜 */}
          <div className="flex flex-col justify-between rounded-2xl bg-gradient-to-b from-rose-50/60 via-rose-50/20 to-white/95 p-2.5 sm:p-3 border border-rose-100/90 shadow-2xs space-y-2">
            <div>
              {/* 子标题条 */}
              <div className="flex items-center justify-between pb-2 border-b border-rose-100/80 px-1 flex-wrap gap-2">
                <div className="flex items-center space-x-1.5">
                  <Flame className="w-4 h-4 text-rose-600 shrink-0" />
                  <h3 className="text-sm font-bold text-slate-900">
                    {scope === 'global' ? '全球污染最严峻' : '全国污染最严峻'}
                  </h3>
                  <span className="text-[10px] sm:text-[11px] font-semibold text-rose-700 bg-rose-100/80 px-1.5 py-0.5 rounded-md">
                    第 {(pollutedPage - 1) * pageSize + 1} - {Math.min(pollutedPage * pageSize, filteredPolluted.length)} 名
                  </span>
                </div>
                <span className="text-xs text-slate-400">共 {filteredPolluted.length} 城</span>
              </div>

              {/* 列表行 */}
              <div className="space-y-1 mt-1.5">
                {currentPollutedList.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-400">未找到匹配的城市</div>
                ) : (
                  currentPollutedList.map((c) => {
                    const currentAqi = metricMode === 'rep'
                      ? (standard === 'CN' ? (c.repAqiCN ?? c.aqiCN ?? c.aqi) : (c.repAqiUS ?? c.aqiUS ?? c.aqi))
                      : (standard === 'CN' ? (c.aqiCN ?? c.aqi) : (c.aqiUS ?? c.aqi));
                    const currentPm25 = metricMode === 'rep' ? (c.repPm25 ?? c.pm25) : c.pm25;
                    const evaluation = standard === 'CN' ? getCNEvaluation(currentAqi) : getUSEvaluation(currentAqi);
                    const showProvince = !c.isDomestic && c.country !== 'CN' && Boolean(c.province);
                    const popPrefix = c.population ? `👥 ${formatPopulation(c.population)} · ` : '';
                    const stationDesc = metricMode === 'rep'
                      ? (c.repStationName ? `市中心站: ${c.repStationName}` : '市中心最近站')
                      : `${c.stationsCount} 站均值`;
                    const infoSubtitle = `${popPrefix}${showProvince ? `${c.province} · ` : ''}${stationDesc}${currentPm25 !== undefined ? ` · PM2.5: ${currentPm25} μg/m³` : ''}`;
                    const popFull = c.population ? ` · 常住人口: ${c.population.toLocaleString()} 人 (${formatPopulation(c.population)})` : '';
                    const fullTooltip = `${c.nameZh}${c.nameEn ? ` (${c.nameEn})` : ''} · ${getCountryInfo(c.country).nameZh}${showProvince ? ` · ${c.province}` : ''}${popFull} · ${stationDesc} · PM2.5: ${currentPm25 !== undefined ? `${currentPm25} μg/m³` : '暂无'} · 实时 AQI: ${currentAqi} (${evaluation.level})`;
                    return (
                      <div
                        key={c.id}
                        onClick={() => handleSelectAndFly(c)}
                        title={fullTooltip}
                        className="group flex items-center justify-between py-1.5 px-1 sm:px-1.5 rounded-xl hover:bg-white hover:shadow-xs border border-transparent hover:border-rose-200/80 transition-all cursor-pointer"
                      >
                        <div className="flex items-center space-x-2 flex-1 min-w-0 pr-2">
                          {renderRankBadge(c.pollutedRank, false)}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center space-x-1.5 flex-wrap">
                              <span
                                title={`${c.nameZh}${c.nameEn ? ` (${c.nameEn})` : ''} · ${getCountryInfo(c.country).nameZh}`}
                                className="font-semibold text-xs sm:text-[13.5px] text-slate-800 group-hover:text-rose-700 transition-colors truncate"
                              >
                                {c.nameZh}
                              </span>
                              <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] font-semibold border border-slate-200/90 shrink-0 select-none">
                                {getCountryInfo(c.country).nameZh}
                              </span>
                            </div>
                            <p
                              title={fullTooltip}
                              className="text-[11px] text-slate-400 mt-0.5 truncate"
                            >
                              {infoSubtitle}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center space-x-1.5 shrink-0">
                          <div className="text-right">
                            <span className="text-sm sm:text-base font-bold text-rose-700">{currentAqi}</span>
                            <span className="text-[9px] text-slate-400 ml-0.5">AQI</span>
                          </div>
                          <span
                            className="text-[11px] px-1.5 py-0.5 rounded-md font-bold shrink-0 whitespace-nowrap"
                            style={{
                              backgroundColor: `${evaluation.color}15`,
                              color: evaluation.color,
                              border: `1px solid ${evaluation.color}35`,
                            }}
                          >
                            {evaluation.level}
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* 右栏底部分页器 */}
            {pollutedTotalPages > 1 && (
              <div className="flex items-center justify-between pt-2 border-t border-rose-100/80 text-xs px-1 flex-wrap gap-2">
                <span className="text-slate-400">
                  共 {filteredPolluted.length} 项
                </span>
                <PageJumper
                  currentPage={pollutedPage}
                  totalPages={pollutedTotalPages}
                  onPageChange={setPollutedPage}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
