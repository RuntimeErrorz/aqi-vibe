'use client';

import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import { Layers, Globe2 } from 'lucide-react';
import { CitySearchAutocomplete } from '@/components/CitySearchAutocomplete';
import { RealtimeRankingPanel, RankedCityItem } from '@/components/RealtimeRankingPanel';
import { CITIES_REGISTRY, findCity } from '@/lib/constants/cities';
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

export default function MapPage() {
  const { standard } = useStandard();
  const defaultCity = findCity('cn-chengdu') || CITIES_REGISTRY[0];
  const [showStations, setShowStations] = useState(true);
  const [focusCity, setFocusCity] = useState<CityMeta>(defaultCity);
  const [focusCityInfo, setFocusCityInfo] = useState<FocusCityInfo | null>(null);
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

  const handleRankingSelectCity = (c: RankedCityItem) => {
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
    <div className="space-y-3 sm:space-y-3.5 flex-1 flex flex-col min-h-0">
      {/* 顶部控制面板 */}
      <div className="glass-panel rounded-2xl p-3 sm:p-3.5 flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 sm:gap-4 shrink-0">
        <div className="flex items-center space-x-2">
          <Globe2 className="w-5 h-5 text-sky-600" />
          <h1 className="text-lg sm:text-xl font-bold text-slate-900">
            全景空气质量
          </h1>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 sm:gap-3 w-full lg:w-auto">
          {/* 即时城市检索飞抵 */}
          <CitySearchAutocomplete
            selectedCity={focusCity}
            onSelectCity={handleSelectCity}
            placeholder="定位国内 375 城市或全球 564 城市并在地图上飞抵..."
            className="w-full sm:w-80 md:w-96 lg:w-[480px]"
          />

          {/* 实时测站状态与矢量图层控制 */}
          <div className="flex items-center space-x-2 text-xs shrink-0 flex-wrap gap-y-1.5">
            {/* 焦点城市实测状态徽章 */}
            {focusCityInfo && (
              <div
                className={`flex items-center space-x-1.5 px-3 py-2 rounded-xl border text-xs font-semibold shadow-xs ${
                  focusCityInfo.level.includes('暂无实时')
                    ? 'bg-slate-100 border-slate-300 text-slate-700'
                    : 'bg-sky-50 border-sky-200 text-sky-800'
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    focusCityInfo.level.includes('暂无实时')
                      ? 'bg-slate-400'
                      : 'bg-sky-500 animate-pulse'
                  }`}
                />
                <span className="truncate max-w-[280px]">
                  {focusCityInfo.name}: {
                    focusCityInfo.level.includes('暂无')
                      ? `暂无在册测站`
                      : `AQI ${focusCityInfo.aqi}`
                  }
                  {focusCityInfo.stationName ? ` · 市中心站: ${focusCityInfo.stationName}` : ''}
                </span>
              </div>
            )}

            {/* 测站同步状态 */}
            {stationStatus.loading ? (
              <div className="flex items-center space-x-1.5 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-slate-600 font-medium">
                <div className="w-3 h-3 border-2 border-sky-600 border-t-transparent rounded-full animate-spin"></div>
                <span>同步测站中...</span>
              </div>
            ) : showStations && stationStatus.count > 0 ? (
              <div className="flex items-center space-x-1.5 px-3 py-2 rounded-xl bg-slate-100 border border-slate-200 text-slate-700 font-medium shadow-2xs">
                <span className="w-2 h-2 rounded-full bg-slate-400"></span>
                <span>视野内 {stationStatus.count} 测站</span>
              </div>
            ) : !showStations ? (
              <div className="flex items-center space-x-1.5 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-slate-500">
                <span>测站已隐藏</span>
              </div>
            ) : null}

            <button
              onClick={() => setShowStations(!showStations)}
              className={`flex items-center space-x-1.5 px-3 py-2 rounded-xl border transition-all font-semibold cursor-pointer ${
                showStations
                  ? 'bg-sky-50 text-sky-700 border-sky-200 shadow-sm'
                  : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>测站微标: {showStations ? '开启' : '关闭'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* 左右并列全景工作台容器：桌面端高度精确设定为 580px */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-5 items-stretch h-auto lg:h-[580px]">
        {/* 左侧：全景地图 (桌面端 6 列，精确 580px 饱满呈现) */}
        <div className="lg:col-span-6 relative isolate z-10 w-full h-[440px] sm:h-[480px] lg:h-full rounded-2xl overflow-hidden border border-slate-200 shadow-md">
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

            {/* 底部浮动图例 (在移动端自适应紧凑排布) */}
            <div className="absolute bottom-2.5 left-2.5 right-2.5 sm:left-auto sm:right-3 z-[1000] pointer-events-auto">
              <div className="bg-white/95 backdrop-blur-md rounded-xl border border-slate-200/90 shadow-lg px-2 sm:px-2.5 py-1.5 flex items-center justify-between sm:justify-start gap-1 sm:gap-2 text-[10px] sm:text-[11px] font-bold">
                <span className="text-slate-400 font-normal shrink-0 hidden xs:inline">AQI等级:</span>
                <div className="flex items-center gap-1 sm:gap-1.5 w-full sm:w-auto justify-between">
                  {[
                    { name: standard === 'CN' ? '优' : '优', range: '0-50', bg: '#25a77b', text: '#fff' },
                    { name: standard === 'CN' ? '良' : '良', range: '51-100', bg: '#fee24f', text: '#1a1a1a' },
                    { name: standard === 'CN' ? '轻度' : '敏感不适', range: '101-150', bg: '#fea74f', text: '#fff' },
                    { name: standard === 'CN' ? '中度' : '不健康', range: '151-200', bg: '#d3254f', text: '#fff' },
                    { name: standard === 'CN' ? '重度' : '非常不健康', range: '201-300', bg: '#8f3f97', text: '#fff' },
                    { name: standard === 'CN' ? '严重' : '严重危害', range: '>300', bg: '#7e0023', text: '#fff' },
                    { name: '无数据', range: '-', bg: '#64748b', text: '#fff' },
                  ].map((lvl) => (
                    <div
                      key={lvl.name}
                      className="flex items-center space-x-1 px-1.5 py-0.5 rounded shadow-2xs select-none"
                      style={{ backgroundColor: lvl.bg, color: lvl.text }}
                      title={`${lvl.name} (AQI ${lvl.range})`}
                    >
                      <span className="leading-none text-[9.5px] sm:text-[10px]">{lvl.name}</span>
                      <span className="opacity-80 text-[8.5px] hidden md:inline leading-none font-normal">
                        {lvl.range}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

        {/* 右侧：实时排行榜 (桌面端 6 列，严格与地图等高，面板内部独立平滑滚动) */}
        <div className="lg:col-span-6 flex flex-col h-auto lg:h-full min-h-0">
          <RealtimeRankingPanel onSelectCity={handleRankingSelectCity} className="h-full" />
        </div>
      </div>
    </div>
  );
}
