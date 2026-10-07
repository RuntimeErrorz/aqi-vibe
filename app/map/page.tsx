'use client';

import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import { Layers, Globe2, Trophy } from 'lucide-react';
import { CitySearchAutocomplete } from '@/components/CitySearchAutocomplete';
import { RealtimeRankingPanel } from '@/components/RealtimeRankingPanel';
import { CITIES_REGISTRY, findCity } from '@/lib/constants/cities';
import { CityMeta } from '@/lib/types';
import { useStandard } from '@/components/StandardContext';

const AirMap = dynamic(() => import('@/components/AirMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[540px] rounded-2xl bg-white border border-slate-200 flex flex-col items-center justify-center text-slate-500 shadow-sm">
      <div className="w-8 h-8 border-2 border-sky-600 border-t-transparent rounded-full animate-spin mb-3"></div>
      <p className="text-sm font-medium">正在加载全景瓦片底图与监测坐标...</p>
    </div>
  ),
});

export default function MapPage() {
  const { standard } = useStandard();
  const defaultCity = findCity('cn-chengdu') || CITIES_REGISTRY[0];
  const [showStations, setShowStations] = useState(true);
  const [focusCity, setFocusCity] = useState<CityMeta>(defaultCity);
  const [focusCityInfo, setFocusCityInfo] = useState<{ name: string; aqi: number; level: string } | null>(null);
  const [mapCenter, setMapCenter] = useState<[number, number]>([defaultCity.latitude, defaultCity.longitude]);
  const [mapZoom, setMapZoom] = useState<number>(10);
  const [stationStatus, setStationStatus] = useState<{ count: number; loading: boolean }>({
    count: 0,
    loading: false,
  });

  const handleSelectCity = (city: CityMeta) => {
    setFocusCity(city);
    setFocusCityInfo(null);
    setMapCenter([city.latitude, city.longitude]);
    setMapZoom(10);
  };

  const handleRankingSelectCity = (c: {
    id: string;
    nameZh: string;
    nameEn: string;
    country: string;
    latitude: number;
    longitude: number;
  }) => {
    const meta: CityMeta = findCity(c.id) || {
      id: c.id,
      nameZh: c.nameZh,
      nameEn: c.nameEn,
      country: c.country,
      latitude: c.latitude,
      longitude: c.longitude,
      isDomestic: c.country === 'CN',
    };
    handleSelectCity(meta);
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  return (
    <div className="space-y-4">
      {/* 顶部控制面板 */}
      <div className="glass-panel rounded-2xl p-4 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center space-x-2">
            <Globe2 className="w-5 h-5 text-sky-600" />
            <span>全景空气质量</span>
          </h1>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full lg:w-auto">
          {/* 即时城市检索飞抵 */}
          <CitySearchAutocomplete
            selectedCity={focusCity}
            onSelectCity={handleSelectCity}
            placeholder="定位国内 375 城市或全球 564 城市并在地图上飞抵..."
            className="w-full sm:w-96 md:w-[480px] lg:w-[540px]"
          />

          {/* 实时测站状态与矢量图层控制 */}
          <div className="flex items-center space-x-2 text-xs shrink-0 flex-wrap gap-y-1">
            {stationStatus.loading ? (
              <div className="flex items-center space-x-1.5 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-slate-600 font-medium">
                <div className="w-3 h-3 border-2 border-sky-600 border-t-transparent rounded-full animate-spin"></div>
                <span>同步测站中...</span>
              </div>
            ) : stationStatus.count > 0 ? (
              <div className="flex items-center space-x-1.5 px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 font-semibold shadow-xs">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                <span>已同步 {stationStatus.count} 个高清测站</span>
              </div>
            ) : focusCityInfo ? (
              <div className="flex items-center space-x-1.5 px-3 py-2 rounded-xl bg-sky-50 border border-sky-200 text-sky-700 font-semibold shadow-xs">
                <span className="w-2 h-2 rounded-full bg-sky-500 animate-pulse"></span>
                <span>
                  已同步 {focusCityInfo.name} 实测站 (AQI: {focusCityInfo.aqi} · {focusCityInfo.level})
                </span>
              </div>
            ) : (
              <div className="flex items-center space-x-1.5 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-slate-500">
                <span>测站已隐藏</span>
              </div>
            )}

            <button
              onClick={() => setShowStations(!showStations)}
              className={`flex items-center space-x-1.5 px-3.5 py-2 rounded-xl border transition-all font-semibold cursor-pointer ${
                showStations
                  ? 'bg-sky-50 text-sky-700 border-sky-200 shadow-sm'
                  : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>测站微标: {showStations ? '开启' : '关闭'}</span>
            </button>

            <a
              href="#realtime-ranking-section"
              className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 transition-all font-semibold shadow-2xs"
            >
              <Trophy className="w-3.5 h-3.5 text-amber-600" />
              <span>实时风云榜</span>
            </a>
          </div>
        </div>
      </div>

      {/* 地图主体容器 (isolate 隔离内部层级，确保无论内部 z-index 多大都不会遮挡顶部导航条) */}
      <div className="relative isolate z-10 w-full h-[540px] rounded-2xl overflow-hidden border border-slate-200 shadow-md">
        <AirMap
          center={mapCenter}
          zoom={mapZoom}
          focusCity={focusCity}
          showStations={showStations}
          onStationCountChange={(count, loading, focusInfo) => {
            if (focusInfo) {
              setFocusCityInfo(focusInfo);
            }
            if (count >= 0) {
              setStationStatus({ count, loading });
            }
          }}
        />
      </div>

      {/* 全球与国内空气质量实时风云榜 */}
      <RealtimeRankingPanel onSelectCity={handleRankingSelectCity} />
    </div>
  );
}
