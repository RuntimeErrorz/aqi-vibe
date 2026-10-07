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
} from 'lucide-react';

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
  onSelectCity: (city: {
    id: string;
    nameZh: string;
    nameEn: string;
    country: string;
    latitude: number;
    longitude: number;
  }) => void;
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
    <div className="flex items-center space-x-1.5 text-xs text-slate-500">
      <button
        onClick={() => onPageChange(Math.max(1, currentPage - 1))}
        disabled={currentPage <= 1}
        className="p-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed text-slate-600 transition-colors shadow-2xs cursor-pointer"
        title="上一页"
      >
        <ChevronLeft className="w-3.5 h-3.5" />
      </button>

      <span className="text-slate-400">{labelPrefix}第</span>
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
        className="w-11 px-1 py-0.5 text-center text-xs bg-white border border-slate-200 rounded-md font-bold text-slate-800 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500/20 shadow-2xs"
      />
      <span className="text-slate-400">/ {totalPages} 页</span>

      <button
        onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
        disabled={currentPage >= totalPages}
        className="p-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed text-slate-600 transition-colors shadow-2xs cursor-pointer"
        title="下一页"
      >
        <ChevronRight className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

export const RealtimeRankingPanel: React.FC<RealtimeRankingPanelProps> = ({ onSelectCity }) => {
  const { standard } = useStandard();
  const [scope, setScope] = useState<'global' | 'domestic'>('global');
  const [data, setData] = useState<RankingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 搜索框与即时下拉预览
  const [searchQuery, setSearchQuery] = useState('');
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  // 分页状态
  const [cleanPage, setCleanPage] = useState(1);
  const [pollutedPage, setPollutedPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(10);

  const fetchRankings = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ranking/realtime');
      if (!res.ok) throw new Error('同步实时排行失败');
      const json: RankingData = await res.json();
      if (json.success) {
        setData(json);
      } else {
        throw new Error('获取实时数据异常');
      }
    } catch (e: any) {
      setError(e.message || '网络连接超时');
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
  }, [scope, searchQuery, pageSize]);

  const activeCategory = scope === 'global' ? data?.global : data?.domestic;

  // 为当前所有城市赋予真实、固定的绝对名次 (1 .. N)，依据选定标准动态排序
  const allCitiesWithRank = useMemo<RankedCityWithOrder[]>(() => {
    const cleanest = activeCategory?.cleanest || [];
    // 依据选定标准进行升序排序 (AQI 越低越清新)
    const sorted = [...cleanest].sort((a, b) => {
      const valA = standard === 'CN' ? (a.aqiCN ?? a.aqi) : (a.aqiUS ?? a.aqi);
      const valB = standard === 'CN' ? (b.aqiCN ?? b.aqi) : (b.aqiUS ?? b.aqi);
      return valA - valB;
    });
    const total = sorted.length;
    return sorted.map((c, idx) => ({
      ...c,
      cleanRank: idx + 1,
      pollutedRank: total - idx,
    }));
  }, [activeCategory, standard]);

  // 即时搜索匹配列表（携带保留的绝对名次）
  const searchMatchedCities = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.trim().toLowerCase();
    return allCitiesWithRank.filter(
      (c) =>
        c.nameZh.toLowerCase().includes(q) ||
        c.nameEn.toLowerCase().includes(q) ||
        c.country.toLowerCase().includes(q) ||
        (c.province && c.province.toLowerCase().includes(q))
    );
  }, [allCitiesWithRank, searchQuery]);

  // 页面列表过滤后的数据
  const filteredCleanest = useMemo(() => {
    if (!searchQuery.trim()) return allCitiesWithRank;
    return searchMatchedCities;
  }, [allCitiesWithRank, searchMatchedCities, searchQuery]);

  const filteredPolluted = useMemo(() => {
    if (!searchQuery.trim()) {
      return [...allCitiesWithRank].reverse();
    }
    // 搜索时按当前标准下的污染程度降序排
    return [...searchMatchedCities].sort((a, b) => {
      const valA = standard === 'CN' ? (a.aqiCN ?? a.aqi) : (a.aqiUS ?? a.aqi);
      const valB = standard === 'CN' ? (b.aqiCN ?? b.aqi) : (b.aqiUS ?? b.aqi);
      return valB - valA;
    });
  }, [allCitiesWithRank, searchMatchedCities, searchQuery, standard]);

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
          className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-black shadow-xs shrink-0 ${
            isClean
              ? 'bg-amber-400 text-amber-950 ring-2 ring-amber-300/60'
              : 'bg-rose-500 text-white ring-2 ring-rose-300/60'
          }`}
        >
          1
        </span>
      );
    }
    if (rankNum === 2) {
      return (
        <span
          className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-black shadow-xs shrink-0 ${
            isClean ? 'bg-slate-300 text-slate-800' : 'bg-rose-400 text-white'
          }`}
        >
          2
        </span>
      );
    }
    if (rankNum === 3) {
      return (
        <span
          className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-black shadow-xs shrink-0 ${
            isClean ? 'bg-amber-600/30 text-amber-900' : 'bg-rose-300 text-rose-900'
          }`}
        >
          3
        </span>
      );
    }
    return (
      <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-slate-500 bg-slate-100 shrink-0">
        {rankNum}
      </span>
    );
  };

  return (
    <div id="realtime-ranking-section" className="glass-panel rounded-2xl p-5 sm:p-6 space-y-5">
      {/* 头部控制栏：标题、更新时间、范围 Tab、视图切换、搜索带预览、每页数量、刷新 */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 pb-4 border-b border-slate-100">
        <div className="space-y-1">
          <div className="flex items-center space-x-2 flex-wrap gap-y-1">
            <Trophy className="w-5 h-5 text-amber-500" />
            <h2 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight">
              实时空气质量榜
            </h2>
          </div>
          <p className="text-xs text-slate-500 flex items-center space-x-1.5 flex-wrap">
            <span>
              已聚合全球 {data?.totalStations ? `${data.totalStations}+` : '5,500+'} 个实测站 · 覆盖{' '}
              {scope === 'global' ? `${allCitiesWithRank.length} 座国际都会` : `${allCitiesWithRank.length} 座国内城市`}
            </span>
            {data?.updatedAt && (
              <span className="text-slate-400">
                · 更新于 {new Date(data.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </p>
        </div>

        {/* 右侧工具栏：即时搜索带预览 + 范围Tab + 视图切换 + 每页条数 + 刷新 */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* 即时搜索框与智能下拉预览面板 */}
          <div ref={searchContainerRef} className="relative flex-1 sm:flex-initial min-w-[200px] sm:min-w-[240px]">
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
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600 rounded-full"
                title="清空搜索"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}

            {/* 即时搜索下拉预览卡片：保留真实排位 + 实时指数 + 一键直达 */}
            {isPreviewOpen && searchQuery.trim() && (
              <div className="absolute left-0 right-0 sm:right-auto sm:w-[380px] top-full mt-1.5 z-50 bg-white rounded-2xl border border-slate-200/95 shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
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
                      const currentAqi = standard === 'CN' ? (c.aqiCN ?? c.aqi) : (c.aqiUS ?? c.aqi);
                      const evaluation = standard === 'CN' ? getCNEvaluation(currentAqi) : getUSEvaluation(currentAqi);
                      return (
                        <div
                          key={c.id}
                          onClick={() => handleSelectAndFly(c)}
                          className="px-3 py-2 flex items-center justify-between hover:bg-sky-50/80 cursor-pointer transition-colors group"
                        >
                          <div className="flex items-center space-x-2.5 min-w-0 pr-2">
                            {/* 保留真实排名徽标 */}
                            <span
                              className="px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 border tabular-nums bg-slate-100 text-slate-700 border-slate-200"
                              title={`在当前榜单中排名第 ${c.cleanRank}`}
                            >
                              #{c.cleanRank}
                            </span>
                            <span className="px-1 py-0.2 rounded bg-slate-100 text-slate-500 font-mono text-[9px] font-bold border border-slate-200 uppercase shrink-0">
                              {c.country}
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
                              <p className="text-[10px] text-slate-400 truncate mt-0.5">
                                {c.province ? `${c.province} · ` : ''}聚合 {c.stationsCount} 个测站
                                {c.pm25 !== undefined ? ` · PM2.5: ${c.pm25} μg/m³` : ''}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center space-x-2 shrink-0">
                            <div className="text-right">
                              <span className="text-sm font-black text-slate-900">{currentAqi}</span>
                              <span className="text-[9px] text-slate-400 ml-0.5">AQI</span>
                            </div>
                            <span
                              className="text-[10px] px-1.5 py-0.2 rounded font-bold"
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

          {/* 范围 Tab */}
          <div className="flex items-center p-0.5 bg-slate-100 rounded-xl border border-slate-200/80 text-xs font-semibold">
            <button
              onClick={() => setScope('global')}
              className={`px-3 py-1.5 rounded-lg transition-all flex items-center space-x-1 ${
                scope === 'global'
                  ? 'bg-white text-sky-700 shadow-2xs font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Globe className="w-3.5 h-3.5" />
              <span>全球都会</span>
            </button>
            <button
              onClick={() => setScope('domestic')}
              className={`px-3 py-1.5 rounded-lg transition-all flex items-center space-x-1 ${
                scope === 'domestic'
                  ? 'bg-white text-sky-700 shadow-2xs font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>中国 375 城</span>
            </button>
          </div>

          {/* 每页条数选择 */}
          <select
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            className="px-2 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700 font-semibold focus:outline-none focus:border-sky-500 shadow-2xs cursor-pointer"
          >
            <option value={10}>每页 10 条</option>
            <option value={20}>每页 20 条</option>
            <option value={50}>每页 50 条</option>
          </select>

          {/* 刷新按钮 */}
          <button
            onClick={fetchRankings}
            disabled={loading}
            className="p-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 hover:text-slate-900 transition-colors shadow-2xs disabled:opacity-50 cursor-pointer"
            title="手动刷新实时榜单"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-sky-600' : ''}`} />
          </button>
        </div>
      </div>

      {/* 内容区域 */}
      {loading && !data ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 py-6">
          {[1, 2].map((i) => (
            <div key={i} className="space-y-3 animate-pulse">
              <div className="h-4 w-36 bg-slate-200 rounded" />
              {[...Array(pageSize)].map((_, idx) => (
                <div key={idx} className="h-12 bg-slate-100 rounded-xl" />
              ))}
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="p-8 text-center space-y-2 text-slate-500 text-xs">
          <p className="text-rose-500 font-semibold">{error}</p>
          <button
            onClick={fetchRankings}
            className="px-3.5 py-1.5 rounded-lg bg-sky-50 text-sky-600 font-bold hover:bg-sky-100 transition-colors"
          >
            重新尝试拉取
          </button>
        </div>
      ) : (
        /* ========= 双榜并列（各自独立可输页码分页） ========= */
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* 左栏：最清新榜 */}
          <div className="flex flex-col justify-between rounded-2xl bg-gradient-to-b from-emerald-50/50 to-white/90 p-4 sm:p-5 border border-emerald-100/90 shadow-2xs space-y-3">
            <div>
              <div className="flex items-center justify-between pb-3 border-b border-emerald-100">
                <div className="flex items-center space-x-2">
                  <Leaf className="w-4 h-4 text-emerald-600" />
                  <h3 className="text-sm font-bold text-slate-900">
                    {scope === 'global' ? '全球空气最清新' : '全国空气最清新'}
                  </h3>
                  <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-100/80 px-2 py-0.5 rounded-md">
                    第 {(cleanPage - 1) * pageSize + 1} - {Math.min(cleanPage * pageSize, filteredCleanest.length)} 名
                  </span>
                </div>
                <span className="text-xs text-slate-400">共 {filteredCleanest.length} 城</span>
              </div>

              <div className="space-y-1.5 mt-3">
                {currentCleanList.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-400">未找到匹配的城市</div>
                ) : (
                  currentCleanList.map((c) => {
                    const currentAqi = standard === 'CN' ? (c.aqiCN ?? c.aqi) : (c.aqiUS ?? c.aqi);
                    const evaluation = standard === 'CN' ? getCNEvaluation(currentAqi) : getUSEvaluation(currentAqi);
                    return (
                      <div
                        key={c.id}
                        onClick={() => handleSelectAndFly(c)}
                        className="group flex items-center justify-between p-2.5 rounded-xl hover:bg-white hover:shadow-sm border border-transparent hover:border-emerald-200 transition-all cursor-pointer"
                      >
                        <div className="flex items-center space-x-3 min-w-0 pr-2">
                          {renderRankBadge(c.cleanRank, true)}
                          <div className="min-w-0">
                            <div className="flex items-center space-x-1.5">
                              <span className="font-bold text-sm text-slate-900 group-hover:text-sky-600 transition-colors truncate">
                                {c.nameZh}
                              </span>
                              <span className="text-xs text-slate-400 font-mono hidden sm:inline truncate">
                                ({c.nameEn})
                              </span>
                              <span className="text-[9px] px-1 py-0.2 rounded bg-slate-100 text-slate-500 font-bold border border-slate-200 uppercase shrink-0">
                                {c.country}
                              </span>
                            </div>
                            <p className="text-[10px] text-slate-400 mt-0.5 truncate">
                              {c.province ? `${c.province} · ` : ''}聚合 {c.stationsCount} 个测站
                              {c.pm25 !== undefined ? ` · PM2.5: ${c.pm25} μg/m³` : ''}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center space-x-2 shrink-0">
                          <div className="text-right">
                            <span className="text-sm font-black text-emerald-700">{currentAqi}</span>
                            <span className="text-[10px] text-slate-400 ml-0.5">AQI</span>
                          </div>
                          <span
                            className="text-[10px] px-2 py-0.5 rounded-md font-bold shrink-0"
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

            {/* 左栏底部分页器 (可直接输入页数) */}
            {cleanTotalPages > 1 && (
              <div className="flex items-center justify-between pt-3 border-t border-emerald-100 text-xs">
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

          {/* 右栏：最严峻榜 */}
          <div className="flex flex-col justify-between rounded-2xl bg-gradient-to-b from-rose-50/50 to-white/90 p-4 sm:p-5 border border-rose-100/90 shadow-2xs space-y-3">
            <div>
              <div className="flex items-center justify-between pb-3 border-b border-rose-100">
                <div className="flex items-center space-x-2">
                  <Flame className="w-4 h-4 text-rose-600" />
                  <h3 className="text-sm font-bold text-slate-900">
                    {scope === 'global' ? '全球污染最严峻' : '全国污染最严峻'}
                  </h3>
                  <span className="text-[11px] font-semibold text-rose-700 bg-rose-100/80 px-2 py-0.5 rounded-md">
                    第 {(pollutedPage - 1) * pageSize + 1} - {Math.min(pollutedPage * pageSize, filteredPolluted.length)} 名
                  </span>
                </div>
                <span className="text-xs text-slate-400">共 {filteredPolluted.length} 城</span>
              </div>

              <div className="space-y-1.5 mt-3">
                {currentPollutedList.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-400">未找到匹配的城市</div>
                ) : (
                  currentPollutedList.map((c) => {
                    const currentAqi = standard === 'CN' ? (c.aqiCN ?? c.aqi) : (c.aqiUS ?? c.aqi);
                    const evaluation = standard === 'CN' ? getCNEvaluation(currentAqi) : getUSEvaluation(currentAqi);
                    return (
                      <div
                        key={c.id}
                        onClick={() => handleSelectAndFly(c)}
                        className="group flex items-center justify-between p-2.5 rounded-xl hover:bg-white hover:shadow-sm border border-transparent hover:border-rose-200 transition-all cursor-pointer"
                      >
                        <div className="flex items-center space-x-3 min-w-0 pr-2">
                          {renderRankBadge(c.pollutedRank, false)}
                          <div className="min-w-0">
                            <div className="flex items-center space-x-1.5">
                              <span className="font-bold text-sm text-slate-900 group-hover:text-rose-600 transition-colors truncate">
                                {c.nameZh}
                              </span>
                              <span className="text-xs text-slate-400 font-mono hidden sm:inline truncate">
                                ({c.nameEn})
                              </span>
                              <span className="text-[9px] px-1 py-0.2 rounded bg-slate-100 text-slate-500 font-bold border border-slate-200 uppercase shrink-0">
                                {c.country}
                              </span>
                            </div>
                            <p className="text-[10px] text-slate-400 mt-0.5 truncate">
                              {c.province ? `${c.province} · ` : ''}聚合 {c.stationsCount} 个测站
                              {c.pm25 !== undefined ? ` · PM2.5: ${c.pm25} μg/m³` : ''}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center space-x-2 shrink-0">
                          <div className="text-right">
                            <span className="text-sm font-black text-rose-700">{currentAqi}</span>
                            <span className="text-[10px] text-slate-400 ml-0.5">AQI</span>
                          </div>
                          <span
                            className="text-[10px] px-2 py-0.5 rounded-md font-bold shrink-0"
                            style={{
                              backgroundColor: `${evaluation.color}15`,
                              color: evaluation.color,
                              border: `1px solid ${evaluation.color}35`,
                            }}
                          >
                            {evaluation.level}
                          </span>
                          <Navigation className="w-3.5 h-3.5 text-slate-300 group-hover:text-rose-600 group-hover:translate-x-0.5 transition-all" />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* 右栏底部分页器 (可直接输入页数) */}
            {pollutedTotalPages > 1 && (
              <div className="flex items-center justify-between pt-3 border-t border-rose-100 text-xs">
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
