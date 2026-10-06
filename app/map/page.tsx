'use client';

import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import { Layers, Info, Globe2 } from 'lucide-react';
import { CitySearchAutocomplete } from '@/components/CitySearchAutocomplete';
import { CITIES_REGISTRY } from '@/lib/constants/cities';
import { CityMeta } from '@/lib/types';

const AirMap = dynamic(() => import('@/components/AirMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[700px] rounded-2xl bg-white border border-slate-200 flex flex-col items-center justify-center text-slate-500 shadow-sm">
      <div className="w-8 h-8 border-2 border-sky-600 border-t-transparent rounded-full animate-spin mb-3"></div>
      <p className="text-sm font-medium">正在加载全景瓦片底图与监测坐标...</p>
    </div>
  ),
});

export default function MapPage() {
  const [showStations, setShowStations] = useState(true);
  const [focusCity, setFocusCity] = useState<CityMeta>(CITIES_REGISTRY[0]);
  const [mapCenter, setMapCenter] = useState<[number, number]>([35.0, 105.0]);
  const [mapZoom, setMapZoom] = useState<number>(4);
  const [stationStatus, setStationStatus] = useState<{ count: number; loading: boolean }>({
    count: 0,
    loading: false,
  });

  const handleSelectCity = (city: CityMeta) => {
    setFocusCity(city);
    setMapCenter([city.latitude, city.longitude]);
    setMapZoom(10);
  };

  return (
    <div className="space-y-4">
      {/* 顶部控制面板 */}
      <div className="glass-panel rounded-2xl p-4 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center space-x-2">
            <Globe2 className="w-5 h-5 text-sky-600" />
            <span>全球空气质量实时全景地图</span>
          </h1>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full lg:w-auto">
          {/* 即时城市检索飞抵 */}
          <CitySearchAutocomplete
            selectedCity={focusCity}
            onSelectCity={handleSelectCity}
            placeholder="定位全球或国内任意城市并在地图上飞抵..."
            className="w-full sm:w-72"
          />

          {/* 实时测站状态指示器 */}
          <div className="flex items-center space-x-2 text-xs shrink-0">
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
              <span>测站图层: {showStations ? '开启' : '关闭'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* 地图主体容器 (isolate 隔离内部层级，确保无论内部 z-index 多大都不会遮挡顶部导航条) */}
      <div className="relative isolate z-10 w-full h-[720px] rounded-2xl overflow-hidden border border-slate-200 shadow-md">
        <AirMap
          center={mapCenter}
          zoom={mapZoom}
          showStations={showStations}
          onStationCountChange={(count, loading) => setStationStatus({ count, loading })}
        />

        {/* 悬浮 AQI 色标图例 */}
        <div className="absolute bottom-6 right-6 z-30 bg-white/95 backdrop-blur-md rounded-2xl p-4 shadow-xl text-xs space-y-1.5 border border-slate-200 pointer-events-auto">
          <div className="font-bold text-slate-900 mb-1 flex items-center space-x-1">
            <Info className="w-3.5 h-3.5 text-sky-600" />
            <span>AQI 色阶图例</span>
          </div>
          <div className="flex items-center space-x-2">
            <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: '#25a77b' }}></span>
            <span className="text-slate-700 font-medium">0 - 50 优 (Good)</span>
          </div>
          <div className="flex items-center space-x-2">
            <span className="w-3 h-3 rounded-full shrink-0 border border-amber-300" style={{ backgroundColor: '#fee24f' }}></span>
            <span className="text-slate-700 font-medium">51 - 100 良 (Moderate)</span>
          </div>
          <div className="flex items-center space-x-2">
            <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: '#fea74f' }}></span>
            <span className="text-slate-700 font-medium">101 - 150 轻度 (USG)</span>
          </div>
          <div className="flex items-center space-x-2">
            <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: '#d3254f' }}></span>
            <span className="text-slate-700 font-medium">151 - 200 中度 (Unhealthy)</span>
          </div>
          <div className="flex items-center space-x-2">
            <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: '#8f3f97' }}></span>
            <span className="text-slate-700 font-medium">201 - 300 重度 (Very Unhealthy)</span>
          </div>
          <div className="flex items-center space-x-2">
            <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: '#7e0023' }}></span>
            <span className="text-slate-700 font-medium">300+ 严重 (Hazardous)</span>
          </div>
        </div>
      </div>
    </div>
  );
}
