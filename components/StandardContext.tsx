'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { StandardType, AirQualityRecord } from '../lib/types';

export interface CachedCityAqiSummary {
  aqiCN: number;
  aqiUS: number;
  pm25AqiCN?: number;
  pm25AqiUS?: number;
  pm25?: number;
}

export const DEFAULT_FAVORITE_CITY_ID = 'cn-chengdu';
const STORAGE_KEY_FAVORITE_CITY = 'aqi_favorite_city_id_v1';
const STORAGE_KEY_WATCHLIST = 'aqi_watchlist_city_ids_v1';
const DEFAULT_WATCHLIST = ['cn-chengdu', 'cn-beijing', 'cn-shanghai', 'gl-tokyo', 'gl-london'];
const MAX_WATCHLIST = 8;

interface StandardContextProps {
  standard: StandardType;
  setStandard: (std: StandardType) => void;
  toggleStandard: () => void;
  onlyPm25: boolean;
  setOnlyPm25: (val: boolean) => void;
  toggleOnlyPm25: () => void;
  favoriteCityId: string;
  setFavoriteCityId: (cityId: string) => void;
  activeCityId: string;
  setActiveCityId: (cityId: string) => void;
  watchlistIds: string[];
  toggleWatchlistCity: (cityId: string) => void;
  removeWatchlistCity: (cityId: string) => void;
  cityCompositeRecords: Record<string, AirQualityRecord>;
  reportCityCompositeRecord: (cityId: string, record: AirQualityRecord) => void;
  rankingAqiMap: Record<string, CachedCityAqiSummary>;
  reportRankingCities: (
    items: Array<{
      id: string;
      aqi?: number;
      aqiCN?: number;
      aqiUS?: number;
      pm25AqiCN?: number;
      pm25AqiUS?: number;
      pm25?: number;
    }>
  ) => void;
  ensureRankingAqiLoaded: () => void;
  mounted: boolean;
}

const StandardContext = createContext<StandardContextProps>({
  standard: 'US',
  setStandard: () => {},
  toggleStandard: () => {},
  onlyPm25: true,
  setOnlyPm25: () => {},
  toggleOnlyPm25: () => {},
  favoriteCityId: DEFAULT_FAVORITE_CITY_ID,
  setFavoriteCityId: () => {},
  activeCityId: DEFAULT_FAVORITE_CITY_ID,
  setActiveCityId: () => {},
  watchlistIds: DEFAULT_WATCHLIST,
  toggleWatchlistCity: () => {},
  removeWatchlistCity: () => {},
  cityCompositeRecords: {},
  reportCityCompositeRecord: () => {},
  rankingAqiMap: {},
  reportRankingCities: () => {},
  ensureRankingAqiLoaded: () => {},
  mounted: false,
});

export const StandardProvider: React.FC<{
  children: React.ReactNode;
  initialStandard?: StandardType;
  initialOnlyPm25?: boolean;
}> = ({ children, initialStandard = 'US', initialOnlyPm25 = true }) => {
  const [standard, setStandardState] = useState<StandardType>(initialStandard);
  const [onlyPm25, setOnlyPm25State] = useState<boolean>(initialOnlyPm25);
  const [favoriteCityId, setFavoriteCityIdState] = useState<string>(DEFAULT_FAVORITE_CITY_ID);
  const [activeCityId, setActiveCityIdState] = useState<string>(DEFAULT_FAVORITE_CITY_ID);
  const [watchlistIds, setWatchlistIdsState] = useState<string[]>(DEFAULT_WATCHLIST);
  // 纯内存态实时多站均值同步表（严禁写入 localStorage，确保全站 Header 与首页数值 100% 同源）
  const [cityCompositeRecords, setCityCompositeRecords] = useState<Record<string, AirQualityRecord>>({});
  // 纯内存态实时排行快照索引（来自 Cloudflare /api/ranking/realtime 边缘缓存，用于搜索框即时展示已缓存 AQI）
  const [rankingAqiMap, setRankingAqiMap] = useState<Record<string, CachedCityAqiSummary>>({});
  const rankingLoadStartedRef = useRef<boolean>(false);
  const [mounted, setMounted] = useState<boolean>(false);

  const reportCityCompositeRecord = useCallback((cityId: string, record: AirQualityRecord) => {
    if (!cityId || !record) return;
    setCityCompositeRecords((prev) => ({ ...prev, [cityId]: record }));
  }, []);

  const reportRankingCities = useCallback(
    (
      items: Array<{
        id: string;
        aqi?: number;
        aqiCN?: number;
        aqiUS?: number;
        pm25AqiCN?: number;
        pm25AqiUS?: number;
        pm25?: number;
      }>
    ) => {
      if (!Array.isArray(items) || items.length === 0) return;
      const next: Record<string, CachedCityAqiSummary> = {};
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (!it || !it.id) continue;
        const aqiUS = it.aqiUS ?? it.aqi ?? 0;
        const aqiCN = it.aqiCN ?? it.aqi ?? 0;
        if (aqiUS <= 0 && aqiCN <= 0) continue;
        next[it.id] = {
          aqiCN,
          aqiUS,
          pm25AqiCN: it.pm25AqiCN,
          pm25AqiUS: it.pm25AqiUS,
          pm25: it.pm25,
        };
      }
      if (Object.keys(next).length > 0) {
        rankingLoadStartedRef.current = true;
        setRankingAqiMap(next);
      }
    },
    []
  );

  const ensureRankingAqiLoaded = useCallback(() => {
    if (typeof window === 'undefined' || rankingLoadStartedRef.current) return;
    rankingLoadStartedRef.current = true;
    fetch('/api/ranking/realtime')
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        const list = json?.global?.cleanest;
        if (Array.isArray(list) && list.length > 0) {
          reportRankingCities(list);
        } else {
          rankingLoadStartedRef.current = false;
        }
      })
      .catch(() => {
        rankingLoadStartedRef.current = false;
      });
  }, [reportRankingCities]);

  useEffect(() => {
    try {
      const savedStd = (localStorage.getItem('aqi_standard_v2') || localStorage.getItem('aqi_standard')) as StandardType;
      if (savedStd === 'CN' || savedStd === 'US') {
        if (savedStd !== standard) {
          setStandardState(savedStd);
        }
        document.cookie = `aqi_standard=${savedStd}; path=/; max-age=31536000; SameSite=Lax`;
      } else {
        localStorage.setItem('aqi_standard_v2', initialStandard);
        document.cookie = `aqi_standard=${initialStandard}; path=/; max-age=31536000; SameSite=Lax`;
      }

      const savedOnlyPm25 = localStorage.getItem('aqi_only_pm25_v2');
      if (savedOnlyPm25 !== null) {
        setOnlyPm25State(savedOnlyPm25 === 'true');
      } else {
        setOnlyPm25State(initialOnlyPm25);
        localStorage.setItem('aqi_only_pm25_v2', String(initialOnlyPm25));
      }

      const savedFavCity = localStorage.getItem(STORAGE_KEY_FAVORITE_CITY);
      if (savedFavCity && savedFavCity.trim().length > 0) {
        const fav = savedFavCity.trim();
        setFavoriteCityIdState(fav);
        setActiveCityIdState(fav);
      }

      const savedWatchlist = localStorage.getItem(STORAGE_KEY_WATCHLIST);
      if (savedWatchlist) {
        const parsed = JSON.parse(savedWatchlist);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setWatchlistIdsState(parsed.filter((id) => typeof id === 'string').slice(0, MAX_WATCHLIST));
        }
      }
    } catch {
      // ignore storage restrictions
    }
    setMounted(true);
  }, []);

  const setStandard = useCallback((std: StandardType) => {
    setStandardState(std);
    try {
      localStorage.setItem('aqi_standard_v2', std);
      localStorage.setItem('aqi_standard', std);
      document.cookie = `aqi_standard=${std}; path=/; max-age=31536000; SameSite=Lax`;
    } catch {}
  }, []);

  const toggleStandard = useCallback(() => {
    setStandardState((prev) => {
      const next: StandardType = prev === 'US' ? 'CN' : 'US';
      try {
        localStorage.setItem('aqi_standard_v2', next);
        localStorage.setItem('aqi_standard', next);
        document.cookie = `aqi_standard=${next}; path=/; max-age=31536000; SameSite=Lax`;
      } catch {}
      return next;
    });
  }, []);

  const setOnlyPm25 = useCallback((val: boolean) => {
    setOnlyPm25State(val);
    try {
      localStorage.setItem('aqi_only_pm25_v2', String(val));
      localStorage.setItem('aqi_only_pm25', String(val));
    } catch {}
  }, []);

  const toggleOnlyPm25 = useCallback(() => {
    setOnlyPm25State((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('aqi_only_pm25_v2', String(next));
        localStorage.setItem('aqi_only_pm25', String(next));
      } catch {}
      return next;
    });
  }, []);

  const setFavoriteCityId = useCallback((cityId: string) => {
    if (!cityId) return;
    setFavoriteCityIdState(cityId);
    try {
      localStorage.setItem(STORAGE_KEY_FAVORITE_CITY, cityId);
    } catch {}
    // 设为最爱城市时自动置顶加入关注列表
    setWatchlistIdsState((prev) => {
      const next = [cityId, ...prev.filter((id) => id !== cityId)].slice(0, MAX_WATCHLIST);
      try {
        localStorage.setItem(STORAGE_KEY_WATCHLIST, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  const setActiveCityId = useCallback((cityId: string) => {
    if (!cityId) return;
    setActiveCityIdState(cityId);
  }, []);

  const toggleWatchlistCity = useCallback((cityId: string) => {
    if (!cityId) return;
    setWatchlistIdsState((prev) => {
      let next: string[];
      if (prev.includes(cityId)) {
        if (prev.length <= 1) return prev;
        next = prev.filter((id) => id !== cityId);
      } else {
        next = [cityId, ...prev.filter((id) => id !== cityId)].slice(0, MAX_WATCHLIST);
      }
      try {
        localStorage.setItem(STORAGE_KEY_WATCHLIST, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  const removeWatchlistCity = useCallback((cityId: string) => {
    setWatchlistIdsState((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((id) => id !== cityId);
      try {
        localStorage.setItem(STORAGE_KEY_WATCHLIST, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  const contextValue = useMemo<StandardContextProps>(
    () => ({
      standard,
      setStandard,
      toggleStandard,
      onlyPm25,
      setOnlyPm25,
      toggleOnlyPm25,
      favoriteCityId,
      setFavoriteCityId,
      activeCityId,
      setActiveCityId,
      watchlistIds,
      toggleWatchlistCity,
      removeWatchlistCity,
      cityCompositeRecords,
      reportCityCompositeRecord,
      rankingAqiMap,
      reportRankingCities,
      ensureRankingAqiLoaded,
      mounted,
    }),
    [
      standard,
      setStandard,
      toggleStandard,
      onlyPm25,
      setOnlyPm25,
      toggleOnlyPm25,
      favoriteCityId,
      setFavoriteCityId,
      activeCityId,
      setActiveCityId,
      watchlistIds,
      toggleWatchlistCity,
      removeWatchlistCity,
      cityCompositeRecords,
      reportCityCompositeRecord,
      rankingAqiMap,
      reportRankingCities,
      ensureRankingAqiLoaded,
      mounted,
    ]
  );

  return (
    <StandardContext.Provider value={contextValue}>
      {children}
    </StandardContext.Provider>
  );
};

export const useStandard = () => useContext(StandardContext);
