'use client';

import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import { Layers, MapPin, Info, Globe2 } from 'lucide-react';
import { CitySearchAutocomplete } from '@/components/CitySearchAutocomplete';
import { CITIES_REGISTRY } from '@/lib/constants/cities';
import { CityMeta } from '@/lib/types';

const AirMap = dynamic(() => import('@/components/AirMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[700px] rounded-2xl bg-white border border-slate-200 flex flex-col items-center justify-center text-slate-500 shadow-sm">
      <div className="w-8 h-8 border-2 border-sky-600 border-t-transparent rounded-full animate-spin mb-3"></div>
      <p className="text-sm font-medium">正在加载全景瓦片底图与监测站点坐标...</p>
    </div>
  ),
});

export default function MapPage() {
  const [showWaqiTiles, setShowWaqiTiles] = useState(true);
  const [showStations, setShowStations] = useState(true);
  const [focusCity, setFocusCity] = useState<CityMeta>(CITIES_REGISTRY[0]);
  const [mapCenter, setMapCenter] = useState<[number, number]>([35.0, 105.0]);
  const [mapZoom, setMapZoom] = useState<number>(4);

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
            <span>全球空气质量热力与国控站点全景地图</span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            加载 WAQI 实时热力瓦片图层 + 中国 2,026 国控微站打点，支持缩放查看微观街区与宏观跨国扩散。
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full lg:w-auto">
          {/* 即时城市检索飞抵 */}
          <CitySearchAutocomplete
            selectedCity={focusCity}
            onSelectCity={handleSelectCity}
            placeholder="定位全球或国内任意城市并在地图上飞抵..."
            className="w-full sm:w-72"
          />

          {/* 图层控制按钮 */}
          <div className="flex items-center space-x-2 text-xs shrink-0">
            <button
              onClick={() => setShowWaqiTiles(!showWaqiTiles)}
              className={`flex items-center space-x-1.5 px-3 py-2 rounded-xl border transition-all font-semibold ${
                showWaqiTiles
                  ? 'bg-sky-50 text-sky-700 border-sky-200 shadow-sm'
                  : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>热力瓦片: {showWaqiTiles ? '开启' : '关闭'}</span>
            </button>

            <button
              onClick={() => setShowStations(!showStations)}
              className={`flex items-center space-x-1.5 px-3 py-2 rounded-xl border transition-all font-semibold ${
                showStations
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200 shadow-sm'
                  : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
              }`}
            >
              <MapPin className="w-3.5 h-3.5" />
              <span>国控站点: {showStations ? '开启' : '关闭'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* 地图主体容器 */}
      <div className="relative w-full h-[720px] rounded-2xl overflow-hidden border border-slate-200 shadow-md">
        <AirMap
          center={mapCenter}
          zoom={mapZoom}
          showWaqiTiles={showWaqiTiles}
          showStations={showStations}
        />

        {/* 悬浮 AQI 色标图例 */}
        <div className="absolute bottom-6 right-6 z-[1000] bg-white/95 backdrop-blur-md rounded-2xl p-4 shadow-xl text-xs space-y-1.5 border border-slate-200 pointer-events-auto">
          <div className="font-bold text-slate-900 mb-1 flex items-center space-x-1">
            <Info className="w-3.5 h-3.5 text-sky-600" />
            <span>AQI 色阶图例</span>
          </div>
          <div className="flex items-center space-x-2">
            <span className="w-3 h-3 rounded-full bg-emerald-500"></span>
            <span className="text-slate-700 font-medium">0 - 50 优 (Good)</span>
          </div>
          <div className="flex items-center space-x-2">
            <span className="w-3 h-3 rounded-full bg-yellow-500"></span>
            <span className="text-slate-700 font-medium">51 - 100 良 (Moderate)</span>
          </div>
          <div className="flex items-center space-x-2">
            <span className="w-3 h-3 rounded-full bg-orange-500"></span>
            <span className="text-slate-700 font-medium">101 - 150 轻度 (USG)</span>
          </div>
          <div className="flex items-center space-x-2">
            <span className="w-3 h-3 rounded-full bg-red-500"></span>
            <span className="text-slate-700 font-medium">151 - 200 中度 (Unhealthy)</span>
          </div>
          <div className="flex items-center space-x-2">
            <span className="w-3 h-3 rounded-full bg-purple-500"></span>
            <span className="text-slate-700 font-medium">201 - 300 重度 (Very Unhealthy)</span>
          </div>
          <div className="flex items-center space-x-2">
            <span className="w-3 h-3 rounded-full bg-rose-950"></span>
            <span className="text-slate-700 font-medium">300+ 严重 (Hazardous)</span>
          </div>
        </div>
      </div>
    </div>
  );
}
