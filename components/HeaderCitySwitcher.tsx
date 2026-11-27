'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  Search,
  ChevronDown,
  Heart,
  Star,
  X,
  MapPin,
  Globe,
  ChevronRight,
} from 'lucide-react';
import { useStandard } from './StandardContext';
import {
  CITIES_REGISTRY,
  findCity,
  searchCities,
  HOT_CITY_IDS,
  formatPopulation,
  DOMESTIC_CITY_COUNT,
  GLOBAL_CITY_COUNT,
} from '@/lib/constants/cities';
import { getCountryInfo } from '@/lib/constants/countries';
import { fetchWAQICityCompositeData } from '@/lib/services/waqi';
import { evaluateAQI, getCNEvaluation, getUSEvaluation } from '@/lib/aqi-calculator';
import { CityMeta } from '@/lib/types';

interface HeaderCitySwitcherProps {
  compact?: boolean;
}

export const HeaderCitySwitcher: React.FC<HeaderCitySwitcherProps> = ({ compact = false }) => {
  const pathname = usePathname();
  const router = useRouter();
  const {
    standard,
    onlyPm25,
    favoriteCityId,
    setFavoriteCityId,
    activeCityId,
    setActiveCityId,
    watchlistIds,
    toggleWatchlistCity,
    removeWatchlistCity,
    cityCompositeRecords,
    isCityCompositeFresh,
    reportCityCompositeRecord,
    rankingAqiMap,
    ensureRankingAqiLoaded,
    mounted,
  } = useStandard();

  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  // 失败记录带 60s 冷却时间，避免单次网络抖动导致整场会话永久锁死 "--"
  const [failedAtMap, setFailedAtMap] = useState<Record<string, number>>({});
  const inFlightIdsRef = useRef<Set<string>>(new Set());
  const FAILED_RETRY_TTL_MS = 60_000;

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const activeCity = useMemo(
    () => findCity(activeCityId) || findCity(favoriteCityId) || CITIES_REGISTRY[0],
    [activeCityId, favoriteCityId]
  );

  // 搜索结果（Algolia 风格即时响应）
  const searchResults = useMemo(() => {
    const q = query.trim();
    if (!q) return [];
    return searchCities(q, 8);
  }, [query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // ⌘K / Ctrl+K 全局快捷唤起城市面板
  useEffect(() => {
    const handleGlobalKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      } else if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleGlobalKey);
    return () => window.removeEventListener('keydown', handleGlobalKey);
  }, []);

  // 打开面板时自动聚焦输入框，并按需静默预载边缘排行快照用于搜索结果即时显示已缓存 AQI
  useEffect(() => {
    if (isOpen) {
      ensureRankingAqiLoaded();
      const timer = setTimeout(() => inputRef.current?.focus(), 20);
      return () => clearTimeout(timer);
    } else {
      setQuery('');
    }
  }, [isOpen, ensureRankingAqiLoaded]);

  // 点击外部关闭
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 统一采用「全城多站实测均值」口径：
  // 1. 若首页已计算并上报 cityCompositeRecords[id]，直接 0 请求复用，100% 与页面大字对齐；
  // 2. 否则按需拉取该城多站实测均值并写入全局内存同步表。
  useEffect(() => {
    if (!mounted) return;
    const controller = new AbortController();
    const idsToFetch = isOpen
      ? Array.from(new Set([activeCity.id, ...watchlistIds]))
      : pathname === '/'
      ? [] // 在首页时直接等待首页自身上报的全城均值，避免重复并发拉取
      : [activeCity.id];

    const now = Date.now();
    const missing = idsToFetch.filter((id) => {
      if (isCityCompositeFresh(id)) return false;
      const failedAt = failedAtMap[id];
      if (failedAt && now - failedAt < FAILED_RETRY_TTL_MS) return false;
      return !inFlightIdsRef.current.has(id);
    });
    if (missing.length === 0) return;

    missing.forEach((id) => inFlightIdsRef.current.add(id));

    Promise.allSettled(
      missing.map(async (id) => {
        const data = await fetchWAQICityCompositeData(id, controller.signal);
        return { id, data };
      })
    ).then((results) => {
      if (controller.signal.aborted) return;
      results.forEach((r, idx) => {
        const cid = missing[idx];
        inFlightIdsRef.current.delete(cid);
        if (r.status === 'fulfilled') {
          reportCityCompositeRecord(cid, r.value.data);
          setFailedAtMap((prev) => {
            if (!(cid in prev)) return prev;
            const next = { ...prev };
            delete next[cid];
            return next;
          });
        } else {
          setFailedAtMap((prev) => ({ ...prev, [cid]: Date.now() }));
        }
      });
    });

    return () => {
      controller.abort();
      missing.forEach((id) => inFlightIdsRef.current.delete(id));
    };
  }, [mounted, activeCity.id, watchlistIds, isOpen, pathname, isCityCompositeFresh, failedAtMap, reportCityCompositeRecord]);

  const getCityEval = (cid: string) => {
    const rec = cityCompositeRecords[cid];
    if (!rec) return null;
    if (onlyPm25) {
      const ev = evaluateAQI({ pm25: rec.pollutants.pm25 }, standard, true);
      return rec.isOffline ? { ...ev, color: '#64748b', textColor: '#ffffff', isOffline: true } : ev;
    }
    return standard === 'CN' ? rec.evaluationCN : rec.evaluationUS;
  };

  // 搜索结果即时读取已缓存 AQI：优先精确多站实测缓存 (cityCompositeRecords)，其次 Cloudflare 排行快照 (rankingAqiMap)
  const getSearchCachedEval = (cid: string) => {
    const exact = getCityEval(cid);
    if (exact && exact.aqi > 0) return exact;
    const snap = rankingAqiMap[cid];
    if (!snap) return null;
    const val = onlyPm25
      ? standard === 'CN'
        ? (snap.pm25AqiCN ?? snap.aqiCN)
        : (snap.pm25AqiUS ?? snap.aqiUS)
      : standard === 'CN'
      ? snap.aqiCN
      : snap.aqiUS;
    if (!val || val <= 0) return null;
    return standard === 'CN' ? getCNEvaluation(val) : getUSEvaluation(val);
  };

  const activeEval = getCityEval(activeCity.id);
  const isCurrentWatched = watchlistIds.includes(activeCity.id);
  const isCurrentFavorite = favoriteCityId === activeCity.id;

  const handleSelectCity = (city: CityMeta) => {
    setActiveCityId(city.id);
    setIsOpen(false);
    setQuery('');
    // 在 /compare 选城时跳转至首页实况；在 /、/map、/history 直接无刷新原地联动切换
    if (pathname === '/compare') {
      router.push(`/?city=${encodeURIComponent(city.id)}`);
    }
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (searchResults.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => (prev + 1) % searchResults.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => (prev - 1 + searchResults.length) % searchResults.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (searchResults[activeIndex]) {
        handleSelectCity(searchResults[activeIndex]);
      }
    }
  };

  return (
    <div ref={containerRef} className="relative">
      {/* Header 触发胶囊：融合当前城市、实测 AQI 徽章、快捷搜索入口 */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        title={`当前城市: ${activeCity.nameZh} (${activeCity.nameEn}) — 点击搜索城市或管理关注列表 (Ctrl+K)`}
        className={`group flex items-center space-x-1.5 rounded-xl border transition-all cursor-pointer select-none shadow-2xs text-xs ${
          isOpen
            ? 'bg-white border-sky-400 ring-2 ring-sky-500/15 text-slate-900'
            : 'bg-slate-50/90 hover:bg-white border-slate-200/90 hover:border-slate-300 text-slate-800'
        } ${compact ? 'px-2 py-1.5 max-w-[148px]' : 'px-2 lg:px-2.5 py-1.5 max-w-[148px] lg:max-w-none'}`}
      >
        <Search className="w-3.5 h-3.5 text-slate-400 group-hover:text-sky-600 transition-colors shrink-0" />

        <span className="inline-flex items-center space-x-1 min-w-0">
          {mounted && isCurrentFavorite && (
            <Heart className="w-2.5 h-2.5 fill-rose-500 text-rose-500 shrink-0" />
          )}
          <span className="font-bold text-slate-900 truncate max-w-[68px] sm:max-w-[96px]">
            {mounted ? activeCity.nameZh : '成都'}
          </span>
        </span>

        {mounted && activeEval && activeEval.aqi > 0 ? (
          <span
            className="px-1.5 py-0.5 rounded-md text-[10px] font-mono font-bold text-white leading-none shrink-0"
            style={{ backgroundColor: activeEval.color }}
          >
            {activeEval.aqi}
          </span>
        ) : (
          <span className="w-5 h-3.5 rounded bg-slate-200/70 animate-pulse inline-block shrink-0" />
        )}

        {!compact && (
          <kbd className="hidden xl:inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono font-semibold text-slate-400 bg-white border border-slate-200 rounded-md leading-none shrink-0">
            ⌘K
          </kbd>
        )}

        <ChevronDown
          className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-150 shrink-0 ${
            isOpen ? 'rotate-180 text-sky-600' : ''
          }`}
        />
      </button>

      {/* 下拉弹出面板：桌面吸附于触发胶囊下方，移动端居中全宽优雅浮层 */}
      {isOpen && (
        <>
          <div
            className="fixed inset-0 top-16 bg-slate-900/25 backdrop-blur-sm z-40 sm:hidden"
            onClick={() => setIsOpen(false)}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-label="城市检索与关注城市看板"
            className="fixed inset-x-3 top-[4.5rem] sm:absolute sm:inset-x-auto sm:left-0 sm:top-full sm:mt-2 z-50 w-auto sm:w-[440px] max-w-[calc(100vw-1.5rem)] rounded-2xl bg-white border border-slate-200 shadow-2xl shadow-slate-900/15 overflow-hidden"
          >
            {/* 顶部搜索框 */}
            <div className="p-2.5 border-b border-slate-100 bg-slate-50/60">
              <div className="relative flex items-center">
                <Search className="absolute left-3 w-4 h-4 text-slate-400 pointer-events-none" />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={handleInputKeyDown}
                  placeholder={`搜索国内 ${DOMESTIC_CITY_COUNT} 城 / 全球 ${GLOBAL_CITY_COUNT} 城 (如: 成都 / Tokyo)...`}
                  className="w-full pl-9 pr-8 py-2 rounded-xl bg-white border border-slate-200 text-xs sm:text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/15 font-medium"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => {
                      setQuery('');
                      inputRef.current?.focus();
                    }}
                    className="absolute right-2.5 p-1 text-slate-400 hover:text-slate-600 rounded-full cursor-pointer"
                    aria-label="清空搜索"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* 若正在输入关键词：展示即时匹配列表 */}
            {query.trim() ? (
              <div className="max-h-72 overflow-y-auto py-1 divide-y divide-slate-50">
                {searchResults.length > 0 ? (
                  searchResults.map((c, idx) => {
                    const isSelected = idx === activeIndex;
                    const countryInfo = getCountryInfo(c.country);
                    const isHot = HOT_CITY_IDS.includes(c.id);
                    const cachedEval = getSearchCachedEval(c.id);
                    return (
                      <div
                        key={c.id}
                        onMouseEnter={() => setActiveIndex(idx)}
                        onClick={() => handleSelectCity(c)}
                        className={`px-3.5 py-2 flex items-center justify-between cursor-pointer transition-colors ${
                          isSelected ? 'bg-sky-50/80 text-sky-900' : 'hover:bg-slate-50 text-slate-800'
                        }`}
                      >
                        <div className="flex items-center space-x-2.5 min-w-0 pr-2">
                          <div
                            className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                              c.isDomestic
                                ? 'bg-emerald-100 text-emerald-700'
                                : 'bg-purple-100 text-purple-700'
                            }`}
                          >
                            {c.isDomestic ? <MapPin className="w-3.5 h-3.5" /> : <Globe className="w-3.5 h-3.5" />}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center space-x-1.5">
                              <span className="font-bold text-xs sm:text-sm text-slate-900 truncate">{c.nameZh}</span>
                              <span className="text-[11px] text-slate-400 font-mono truncate">{c.nameEn}</span>
                              {isHot && (
                                <span className="px-1 py-0.5 rounded text-[9px] font-bold bg-amber-50 text-amber-600 border border-amber-200/80 shrink-0">
                                  热门
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-slate-500 flex items-center space-x-1 mt-0.5 truncate">
                              <span>{countryInfo.nameZh}</span>
                              {c.population && (
                                <span className="text-slate-400">· 👥 {formatPopulation(c.population)}</span>
                              )}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center space-x-1.5 shrink-0">
                          {cachedEval && cachedEval.aqi > 0 && (
                            <span
                              className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded-md text-[11px] font-bold font-mono tabular-nums shrink-0"
                              style={{
                                backgroundColor: cachedEval.color + '18',
                                color: cachedEval.color,
                                border: `1px solid ${cachedEval.color}35`,
                              }}
                              title={`当前实时 AQI ${cachedEval.aqi} (${cachedEval.level})`}
                            >
                              <span>{cachedEval.aqi}</span>
                              <span className="font-sans text-[10px] font-semibold hidden xs:inline">
                                {cachedEval.level}
                              </span>
                            </span>
                          )}
                          <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="p-6 text-center text-xs text-slate-400">
                    未找到与 &quot;{query}&quot; 匹配的官方监测城市
                  </div>
                )}
              </div>
            ) : (
              /* 默认态：当前城市快捷操作 + 我的关注城市实时看板 */
              <div className="p-3 space-y-3">
                {/* 当前城市快捷控制行 */}
                <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-slate-100">
                  <div className="min-w-0">
                    <div className="text-[10px] text-slate-400 font-medium">当前查看城市</div>
                    <div className="text-xs sm:text-sm font-bold text-slate-900 flex items-center space-x-1.5 truncate">
                      <span>{activeCity.nameZh}</span>
                      <span className="text-[11px] font-normal text-slate-400 font-mono truncate">
                        {activeCity.nameEn}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => toggleWatchlistCity(activeCity.id)}
                      className={`inline-flex items-center space-x-1 px-2 py-1 rounded-lg text-[11px] font-bold border transition-colors cursor-pointer ${
                        isCurrentWatched
                          ? 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100/70'
                          : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-sky-50 hover:text-sky-700'
                      }`}
                    >
                      <Star className={`w-3 h-3 ${isCurrentWatched ? 'fill-amber-400 text-amber-500' : ''}`} />
                      <span>{isCurrentWatched ? '已关注' : '关注'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setFavoriteCityId(activeCity.id)}
                      disabled={isCurrentFavorite}
                      className={`inline-flex items-center space-x-1 px-2 py-1 rounded-lg text-[11px] font-bold border transition-colors ${
                        isCurrentFavorite
                          ? 'bg-rose-50 text-rose-600 border-rose-200 cursor-default'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 cursor-pointer'
                      }`}
                      title="设为最爱城市（打开城市实况与实时全景默认展示）"
                    >
                      <Heart className={`w-3 h-3 ${isCurrentFavorite ? 'fill-rose-500 text-rose-500' : ''}`} />
                      <span>{isCurrentFavorite ? '最爱' : '设为最爱'}</span>
                    </button>
                  </div>
                </div>

                {/* 我的关注城市实时网格 */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-bold text-slate-500">我的关注城市 ({watchlistIds.length})</span>
                    <span className="text-[10px] text-slate-400">全城实测均值 · 红心为默认主城</span>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {watchlistIds.map((cid) => {
                      const city = findCity(cid);
                      if (!city) return null;
                      const ev = getCityEval(cid);
                      const rec = cityCompositeRecords[cid];
                      const isFailed = Boolean(failedAtMap[cid] && Date.now() - failedAtMap[cid] < FAILED_RETRY_TTL_MS);
                      const isActive = activeCity.id === cid;
                      const isFav = favoriteCityId === cid;

                      return (
                        <div
                          key={cid}
                          onClick={() => handleSelectCity(city)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              handleSelectCity(city);
                            }
                          }}
                          title={
                            rec
                              ? `${city.nameZh} · ${rec.sourceAttribution?.[0]?.name || '全城实测均值'}${
                                  rec.pollutants.pm25 !== undefined ? ` · PM2.5 ${rec.pollutants.pm25} μg/m³` : ''
                                }`
                              : city.nameZh
                          }
                          className={`group flex items-center justify-between px-2.5 py-2 rounded-xl border text-xs transition-all cursor-pointer ${
                            isActive
                              ? 'bg-sky-50/90 border-sky-300 text-sky-900 font-bold shadow-2xs'
                              : 'bg-white border-slate-200/80 hover:border-slate-300 hover:bg-slate-50 text-slate-700 font-medium'
                          }`}
                        >
                          <div className="flex items-center space-x-1.5 min-w-0 pr-1">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setFavoriteCityId(cid);
                              }}
                              title={isFav ? '当前最爱城市' : `将 ${city.nameZh} 设为最爱城市`}
                              aria-label={`将 ${city.nameZh} 设为最爱城市`}
                              className="p-0.5 rounded hover:bg-rose-50 cursor-pointer shrink-0"
                            >
                              <Heart
                                className={`w-3 h-3 transition-colors ${
                                  isFav
                                    ? 'fill-rose-500 text-rose-500'
                                    : 'text-slate-300 group-hover:text-rose-400'
                                }`}
                              />
                            </button>
                            <span className="truncate">{city.nameZh}</span>
                          </div>

                          <div className="flex items-center space-x-1 shrink-0">
                            {ev && ev.aqi > 0 ? (
                              <span
                                className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold text-white leading-none"
                                style={{ backgroundColor: ev.color }}
                              >
                                {ev.aqi}
                              </span>
                            ) : isFailed ? (
                              <span className="px-1 py-0.5 rounded text-[10px] bg-slate-100 text-slate-400 leading-none">
                                --
                              </span>
                            ) : (
                              <span className="w-6 h-3.5 rounded bg-slate-100 animate-pulse inline-block" />
                            )}

                            {watchlistIds.length > 1 && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeWatchlistCity(cid);
                                }}
                                aria-label={`移出关注 ${city.nameZh}`}
                                className="p-0.5 rounded text-slate-300 hover:text-slate-600 hover:bg-slate-200/70 opacity-60 group-hover:opacity-100 transition-opacity cursor-pointer"
                              >
                                <X className="w-2.5 h-2.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
