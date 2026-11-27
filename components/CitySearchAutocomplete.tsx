'use client';

import React, { useState, useEffect, useRef } from 'react';
import { CityMeta } from '@/lib/types';
import { searchCities, HOT_CITY_IDS, formatPopulation, DOMESTIC_CITY_COUNT, GLOBAL_CITY_COUNT } from '@/lib/constants/cities';
import { getCountryInfo } from '@/lib/constants/countries';
import { useStandard } from '@/components/StandardContext';
import { evaluateAQI, getCNEvaluation, getUSEvaluation } from '@/lib/aqi-calculator';
import { Search, MapPin, Globe, X, ChevronRight } from 'lucide-react';

interface CitySearchAutocompleteProps {
  selectedCity: CityMeta;
  onSelectCity: (city: CityMeta) => void;
  placeholder?: string;
  className?: string;
  filterCity?: (city: CityMeta) => boolean;
  showCachedAqi?: boolean;
}

export const CitySearchAutocomplete: React.FC<CitySearchAutocompleteProps> = ({
  selectedCity,
  onSelectCity,
  placeholder = '搜索国家或城市 (如: 美国 / 日本 / 英国 / 成都 / 巴黎 / Tokyo)...',
  className = '',
  filterCity,
  showCachedAqi = false,
}) => {
  const { standard, onlyPm25, cityCompositeRecords, isCityCompositeFresh, rankingAqiMap, ensureRankingAqiLoaded } = useStandard();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CityMeta[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showCachedAqi && isOpen) {
      ensureRankingAqiLoaded();
    }
  }, [showCachedAqi, isOpen, ensureRankingAqiLoaded]);

  const getCachedEval = (cid: string) => {
    if (!showCachedAqi) return null;
    const rec = isCityCompositeFresh(cid) ? cityCompositeRecords[cid] : undefined;
    if (rec) {
      if (onlyPm25) {
        const ev = evaluateAQI({ pm25: rec.pollutants.pm25 }, standard, true);
        if (ev && ev.aqi > 0) {
          return rec.isOffline ? { ...ev, color: '#64748b', textColor: '#ffffff', isOffline: true } : ev;
        }
      } else {
        const ev = standard === 'CN' ? rec.evaluationCN : rec.evaluationUS;
        if (ev && ev.aqi > 0) return ev;
      }
    }
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

  // 随着 query 变化即时检索 (Algolia 风格响应)
  useEffect(() => {
    const limit = query.trim() ? 8 : 10;
    const list = searchCities(query, limit, filterCity);
    setResults(list);
    setActiveIndex(0);
  }, [query, filterCity]);

  // 点击外部自动关闭
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (city: CityMeta) => {
    onSelectCity(city);
    setQuery('');
    setIsOpen(false);
    inputRef.current?.blur();
  };

  // 键盘快捷键导航
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        setIsOpen(true);
      }
      return;
    }

    if (e.key === 'Escape') {
      setIsOpen(false);
      return;
    }

    if (results.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => (prev + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => (prev - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[activeIndex]) {
        handleSelect(results[activeIndex]);
      }
    }
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* 搜索输入框 */}
      <div className="relative flex items-center">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={isOpen}
          aria-autocomplete="list"
          aria-label="搜索城市或国家"
          value={isOpen ? query : `${selectedCity.nameZh} (${selectedCity.nameEn})`}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!isOpen) setIsOpen(true);
          }}
          onFocus={() => {
            setIsOpen(true);
            setQuery('');
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="w-full pl-10 pr-10 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-sky-500 focus:bg-white focus:ring-2 focus:ring-sky-500/20 transition-all font-medium shadow-sm"
        />

        {/* 清空按钮 / 状态图标 */}
        {query && (
          <button
            onClick={() => {
              setQuery('');
              inputRef.current?.focus();
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 rounded-full"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Algolia 风格即时预览悬浮下拉面板 */}
      {isOpen && (
        <div className="absolute left-0 right-0 w-full min-w-0 sm:min-w-[460px] max-w-[calc(100vw-2rem)] top-full mt-2 z-[100] bg-white rounded-2xl border border-slate-200/90 shadow-2xl overflow-hidden">
          <div className="p-2 border-b border-slate-100 flex items-center justify-between text-[10px] sm:text-[11px] text-slate-400 px-3">
            <span className="truncate mr-2">
              {query.trim()
                ? '支持直接输入国家、省份或城市 (如: 美国 / 日本 / 英国 / 成都)'
                : '热门代表城市 (点击直接切换，或键入搜索任意城市)'}
            </span>
            <span className="hidden sm:inline shrink-0">按 ↑↓ 选择，Enter 确认</span>
          </div>

          <div className="max-h-72 overflow-y-auto py-1" role="listbox" aria-label="城市匹配列表">
            {results.length > 0 ? (
              results.map((c, idx) => {
                const isSelected = activeIndex === idx;
                const countryInfo = getCountryInfo(c.country);
                const isHot = HOT_CITY_IDS.includes(c.id);

                return (
                  <div
                    key={c.id}
                    role="option"
                    aria-selected={isSelected}
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={() => handleSelect(c)}
                    className={`px-3 sm:px-3.5 py-2 sm:py-2.5 flex items-center justify-between cursor-pointer transition-colors ${
                      isSelected ? 'bg-sky-50/80 text-sky-900' : 'hover:bg-slate-50 text-slate-800'
                    }`}
                  >
                    <div className="flex items-center space-x-2.5 sm:space-x-3 min-w-0 pr-2">
                      <div
                        className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                          c.isDomestic
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-purple-100 text-purple-700'
                        }`}
                      >
                        {c.isDomestic ? (
                          <MapPin className="w-3.5 h-3.5" />
                        ) : (
                          <Globe className="w-3.5 h-3.5" />
                        )}
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center space-x-1.5 flex-wrap">
                          <span className="font-bold text-sm text-slate-900 truncate">{c.nameZh}</span>
                          <span className="text-xs text-slate-500 font-mono truncate">{c.nameEn}</span>
                          {isHot && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-600 border border-amber-200/80 shrink-0">
                              热门
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-500 flex items-center space-x-1.5 mt-0.5 truncate">
                          <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] font-semibold border border-slate-200/90 shrink-0 select-none">
                            {countryInfo.nameZh}
                          </span>
                          {!c.isDomestic && c.country !== 'CN' && c.province && (
                            <span className="truncate text-slate-500">· {c.province}</span>
                          )}
                          {c.population && (
                            <span
                              className="text-slate-400 font-normal truncate"
                              title={`常住人口: ${c.population.toLocaleString()} 人`}
                            >
                              · 👥 {formatPopulation(c.population)}
                            </span>
                          )}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center space-x-1.5 sm:space-x-2 shrink-0">
                      {(() => {
                        const cachedEval = getCachedEval(c.id);
                        if (cachedEval && cachedEval.aqi > 0) {
                          return (
                            <span
                              className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md text-[11px] font-bold font-mono tabular-nums shrink-0"
                              style={{
                                backgroundColor: cachedEval.color + '18',
                                color: cachedEval.color,
                                border: `1px solid ${cachedEval.color}35`,
                              }}
                              title={`当前实时 AQI ${cachedEval.aqi} (${cachedEval.level})`}
                            >
                              <span>AQI {cachedEval.aqi}</span>
                              <span className="font-sans text-[10px] font-semibold hidden xs:inline">
                                · {cachedEval.level}
                              </span>
                            </span>
                          );
                        }
                        return (
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border hidden xs:inline-block ${
                              c.isDomestic
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : 'bg-purple-50 text-purple-700 border-purple-200'
                            }`}
                          >
                            {c.isDomestic ? `国内 ${DOMESTIC_CITY_COUNT} 城` : `全球 ${GLOBAL_CITY_COUNT} 城`}
                          </span>
                        );
                      })()}
                      <ChevronRight className="w-4 h-4 text-slate-300" />
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="p-4 text-center text-xs text-slate-400">
                <MapPin className="w-4 h-4 mx-auto mb-1 text-slate-300" />
                未找到与 &quot;{query}&quot; 匹配的官方监测城市
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
