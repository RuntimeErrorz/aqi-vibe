'use client';

import React, { useState, useEffect, useRef, Suspense } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { Globe2, Heart } from 'lucide-react';
import { CitySearchAutocomplete } from '@/components/CitySearchAutocomplete';
import { RealtimeRankingPanel, RankedCityItem } from '@/components/RealtimeRankingPanel';
import { CITIES_REGISTRY, findCity, DOMESTIC_CITY_COUNT, GLOBAL_CITY_COUNT } from '@/lib/constants/cities';
import { CityMeta } from '@/lib/types';
import { useStandard } from '@/components/StandardContext';
import { FocusCityInfo } from '@/components/AirMap';

const AirMap = dynamic(() => import('@/components/AirMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[440px] sm:h-[480px] lg:h-full rounded-2xl bg-white border border-slate-200 flex flex-col items-center justify-center text-slate-500 shadow-sm">
      <div className="w-8 h-8 border-2 border-sky-600 border-t-transparent rounded-full animate-spin mb-3"></div>
      <p className="text-xs sm:text-sm font-medium">正在加载全景瓦片底图与监测坐标...</p>
    </div>
  ),
});

function MapPageContent() {
  const { standard, favoriteCityId, setFavoriteCityId, activeCityId, setActiveCityId, mounted } = useStandard();
  const searchParams = useSearchParams();
  const cityParam = searchParams.get('city');
  const defaultCity = findCity(activeCityId) || findCity('cn-chengdu') || CITIES_REGISTRY[0];
  const favInitRef = useRef(false);
  const lastSyncedActiveIdRef = useRef<string | null>(null);

  const [focusCity, setFocusCity] = useState<CityMeta>(() => {
    if (cityParam) {
      const found = findCity(cityParam);
      if (found) return found;
    }
    return defaultCity;
  });
  const [focusCityInfo, setFocusCityInfo] = useState<FocusCityInfo | null>(null);
  const [mapCenter, setMapCenter] = useState<[number, number]>([focusCity.latitude, focusCity.longitude]);
  const [mapZoom, setMapZoom] = useState<number>(() => {
    const zParam = Number(searchParams.get('z'));
    return !isNaN(zParam) && zParam >= 3 && zParam <= 15 ? zParam : 10;
  });
  const [stationStatus, setStationStatus] = useState<{ count: number; loading: boolean }>({
    count: 0,
    loading: false,
  });

  // 挂载后若 URL 未指定 ?city=，自动飞抵全局 activeCityId / 最爱城市（带 lastSyncedActiveIdRef 防首帧双向回弹）
  useEffect(() => {
    if (!mounted || favInitRef.current) return;
    favInitRef.current = true;
    if (cityParam) {
      const found = findCity(cityParam);
      if (found) {
        lastSyncedActiveIdRef.current = found.id;
        if (found.id !== activeCityId) setActiveCityId(found.id);
      } else {
        lastSyncedActiveIdRef.current = focusCity.id;
      }
    } else {
      const targetCity = findCity(activeCityId) || findCity(favoriteCityId);
      if (targetCity && targetCity.id !== focusCity.id) {
        lastSyncedActiveIdRef.current = targetCity.id;
        setFocusCity(targetCity);
        setFocusCityInfo(null);
        setMapCenter([targetCity.latitude, targetCity.longitude]);
        setMapZoom(10);
      } else {
        lastSyncedActiveIdRef.current = focusCity.id;
      }
    }
  }, [mounted, favoriteCityId, cityParam]);

  // 响应 Header 全局城市切换器（仅在 activeCityId 真实变为新城市时飞抵，忽略首帧旧值回弹）
  useEffect(() => {
    if (!mounted || !favInitRef.current) return;
    if (activeCityId === lastSyncedActiveIdRef.current) return;
    lastSyncedActiveIdRef.current = activeCityId;
    const nextCity = findCity(activeCityId);
    if (nextCity && nextCity.id !== focusCity.id) {
      setFocusCity(nextCity);
      setFocusCityInfo(null);
      setMapCenter([nextCity.latitude, nextCity.longitude]);
      setMapZoom(10);
    }
  }, [activeCityId, mounted, focusCity.id]);

  // URL 深度链接同步 (?city=...&z=...)：仅在参数确实变化时调用 replaceState
  useEffect(() => {
    if (typeof window === 'undefined' || !mounted || !favInitRef.current) return;
    const url = new URL(window.location.href);
    const nextZ = String(mapZoom);
    if (url.searchParams.get('city') === focusCity.id && url.searchParams.get('z') === nextZ) {
      return;
    }
    url.searchParams.set('city', focusCity.id);
    url.searchParams.set('z', nextZ);
    window.history.replaceState({}, '', url.toString());
  }, [focusCity.id, mapZoom, mounted]);

  const handleSelectCity = (city: CityMeta) => {
    lastSyncedActiveIdRef.current = city.id;
    setFocusCity(city);
    setActiveCityId(city.id);
    setFocusCityInfo(null);
    setMapCenter([city.latitude, city.longitude]);
    setMapZoom(10);
  };

  const handleRankingSelectCity = (c: RankedCityItem) => {
    const meta: CityMeta = findCity(c.id) || {
      id: c.id,
      nameZh: c.nameZh,
      nameEn: c.nameEn,
      country: c.country,
      latitude: c.latitude,
      longitude: c.longitude,
      isDomestic: typeof c.isDomestic === 'boolean' ? c.isDomestic : ['CN', 'HK', 'MO', 'TW'].includes(c.country),
    };

    handleSelectCity(meta);
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  return (
    <div className="space-y-3 sm:space-y-3.5 flex-1 flex flex-col min-h-0">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-5 items-stretch flex-1 min-h-0 lg:h-[700px]">
        {/* 左侧：全景地图工作台（与右侧实时排行保持对称的头部节奏与图标语言） */}
        <div className="lg:col-span-6 glass-panel rounded-2xl flex flex-col min-w-0 min-h-0 h-auto lg:h-full">
          <div className="p-4 sm:p-5 space-y-3 border-b border-slate-100 shrink-0">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center space-x-2.5 shrink-0">
                <div className="w-8 h-8 rounded-xl bg-sky-50 border border-sky-100 text-sky-600 flex items-center justify-center shrink-0">
                  <Globe2 className="w-4 h-4" />
                </div>
                <div className="flex items-center space-x-2">
                  <h1 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight whitespace-nowrap">
                    全景空气质量
                  </h1>
                  <span
                    className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-500 border border-slate-200/80 text-[11px] font-medium leading-tight whitespace-nowrap"
                    title="全球站点数据来源：WAQI，地图底图来源：CartoDB"
                  >
                    WAQI
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-start sm:justify-end gap-1.5 text-xs flex-wrap w-full sm:w-auto">
                {/* 焦点城市状态徽章（切城加载中呈现柔和骨架占位，杜绝顶栏宽度跳动） */}
                {focusCityInfo ? (
                  <div
                    title={`${focusCityInfo.name}: ${
                      focusCityInfo.level.includes('暂无') || focusCityInfo.aqi <= 0
                        ? focusCityInfo.level
                        : `AQI ${focusCityInfo.aqi}`
                    }${
                      focusCityInfo.stationCount && focusCityInfo.stationCount > 1
                        ? ` · 全城 ${focusCityInfo.stationCount} 站实测均值`
                        : ''
                    }`}
                    className={`flex items-center space-x-1.5 px-2 py-1 rounded-xl border text-xs font-semibold shadow-2xs shrink-0 max-w-[185px] sm:max-w-[220px] ${
                      focusCityInfo.level.includes('暂无')
                        ? 'bg-slate-100 border-slate-300 text-slate-700'
                        : 'bg-sky-50 border-sky-200 text-sky-800'
                    }`}
                  >
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        focusCityInfo.level.includes('暂无') ? 'bg-slate-400' : 'bg-sky-500 animate-pulse'
                      }`}
                    />
                    <span className="truncate">
                      {focusCityInfo.name}:{' '}
                      {focusCityInfo.level.includes('暂无') || focusCityInfo.aqi <= 0
                        ? focusCityInfo.level
                        : `AQI ${focusCityInfo.aqi}`}
                      {focusCityInfo.stationCount && focusCityInfo.stationCount > 1
                        ? ` · ${focusCityInfo.stationCount}站均值`
                        : ''}
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-xl bg-slate-100 border border-slate-200 animate-pulse shrink-0">
                    <span className="w-2 h-2 rounded-full bg-slate-300" />
                    <span className="h-3 w-20 bg-slate-200 rounded inline-block" />
                  </div>
                )}

                {/* 视野内测站数 */}
                {stationStatus.loading ? (
                  <div className="flex items-center space-x-1 px-2 py-1 rounded-xl bg-slate-50 border border-slate-200 text-slate-600 font-medium shrink-0">
                    <div className="w-3 h-3 border-2 border-sky-600 border-t-transparent rounded-full animate-spin"></div>
                    <span className="hidden xs:inline">同步中</span>
                  </div>
                ) : stationStatus.count > 0 ? (
                  <div className="flex items-center space-x-1 px-2 py-1 rounded-xl bg-slate-100 border border-slate-200 text-slate-700 font-medium shrink-0 whitespace-nowrap">
                    <b>{stationStatus.count}</b>
                    <span>站</span>
                  </div>
                ) : null}
              </div>
            </div>

            {/* 城市检索飞抵搜索框 + 设为最爱城市 */}
            <div className="w-full flex items-center gap-2">
              <CitySearchAutocomplete
                selectedCity={focusCity}
                onSelectCity={handleSelectCity}
                placeholder={`定位国内 ${DOMESTIC_CITY_COUNT} 城市或全球 ${GLOBAL_CITY_COUNT} 城市并在地图上飞抵...`}
                className="flex-1 min-w-0"
                showCachedAqi={true}
              />
              {findCity(focusCity.id) && (
                <button
                  type="button"
                  onClick={() => setFavoriteCityId(focusCity.id)}
                  disabled={favoriteCityId === focusCity.id}
                  className={`inline-flex items-center space-x-1 px-2.5 py-2.5 rounded-xl text-xs font-bold border transition-all shrink-0 shadow-sm ${
                    favoriteCityId === focusCity.id
                      ? 'bg-rose-50 text-rose-600 border-rose-200 cursor-default'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 cursor-pointer'
                  }`}
                  title={
                    favoriteCityId === focusCity.id
                      ? '当前焦点城市已是您的默认最爱城市'
                      : `将 ${focusCity.nameZh} 设为最爱城市（城市实况与实时全景默认定位至此）`
                  }
                >
                  <Heart
                    className={`w-3.5 h-3.5 ${
                      favoriteCityId === focusCity.id ? 'fill-rose-500 text-rose-500' : ''
                    }`}
                  />
                  <span className="hidden sm:inline">
                    {favoriteCityId === focusCity.id ? '最爱城市' : '设为最爱'}
                  </span>
                </button>
              )}
            </div>
          </div>

          <div className="relative isolate z-10 w-full flex-1 min-h-[440px] sm:min-h-[480px] lg:min-h-0 rounded-b-2xl overflow-hidden">
            <AirMap
              center={mapCenter}
              zoom={mapZoom}
              focusCity={focusCity}
              onStationCountChange={(count, loading, focusInfo) => {
                if (focusInfo) setFocusCityInfo(focusInfo);
                if (count >= 0) setStationStatus({ count, loading });
              }}
            />

            {/* 底部浮动图例 (上移 36px 彻底避开移动端双行 Leaflet 版权条，零遮挡零折行) */}
            <div className="absolute bottom-9 sm:bottom-7 left-2 right-2 sm:left-2.5 sm:right-auto z-[1000] pointer-events-auto max-w-[calc(100%-1rem)]">
              <div className="bg-white/95 backdrop-blur-md rounded-xl border border-slate-200/90 shadow-lg px-2 py-1 flex items-center gap-1 text-[10px] font-bold overflow-x-auto no-scrollbar">
                <span className="text-slate-400 font-normal shrink-0 hidden sm:inline">AQI:</span>
                <div className="flex items-center gap-1 shrink-0">
                  {[
                    { name: '优', range: '0-50', bg: '#25a77b', text: '#fff' },
                    { name: '良', range: '51-100', bg: '#fee24f', text: '#1a1a1a' },
                    { name: standard === 'CN' ? '轻度' : '敏感', range: '101-150', bg: '#fea74f', text: '#fff' },
                    { name: standard === 'CN' ? '中度' : '不健康', range: '151-200', bg: '#d3254f', text: '#fff' },
                    { name: standard === 'CN' ? '重度' : '极差', range: '201-300', bg: '#8f3f97', text: '#fff' },
                    { name: standard === 'CN' ? '严重' : '危害', range: '>300', bg: '#7e0023', text: '#fff' },
                    { name: '无数据', range: '-', bg: '#64748b', text: '#fff' },
                  ].map((lvl) => (
                    <div
                      key={lvl.name}
                      className="flex items-center space-x-1 px-1.5 py-0.5 rounded shadow-2xs select-none whitespace-nowrap shrink-0"
                      style={{ backgroundColor: lvl.bg, color: lvl.text }}
                      title={`${lvl.name} (AQI ${lvl.range})`}
                    >
                      <span className="leading-none text-[9.5px] sm:text-[10px]">{lvl.name}</span>
                      <span className="opacity-80 text-[8.5px] hidden 2xl:inline leading-none font-normal">
                        {lvl.range}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 右侧：实时排行榜 */}
        <div className="lg:col-span-6 flex flex-col h-auto lg:h-full min-w-0 min-h-0">
          <RealtimeRankingPanel onSelectCity={handleRankingSelectCity} className="h-full" />
        </div>
      </div>
    </div>
  );
}

export default function MapPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[60vh] flex items-center justify-center text-slate-500 text-xs">
          正在加载全景地图...
        </div>
      }
    >
      <MapPageContent />
    </Suspense>
  );
}
