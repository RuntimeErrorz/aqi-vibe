'use client';

import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import { Layers, MapPin, Eye, Info, Globe2 } from 'lucide-react';

const AirMap = dynamic(() => import('@/components/AirMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[700px] rounded-2xl glass-panel flex flex-col items-center justify-center text-slate-400">
      <div className="w-8 h-8 border-2 border-sky-400 border-t-transparent rounded-full animate-spin mb-3"></div>
      <p className="text-sm">正在加载全景瓦片底图与监测站点坐标...</p>
    </div>
  ),
});

export default function MapPage() {
  const [showWaqiTiles, setShowWaqiTiles] = useState(true);
  const [showStations, setShowStations] = useState(true);

  return (
    <div className="space-y-4">
      {/* 顶部控制面板 */}
      <div className="glass-panel rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xl">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center space-x-2">
            <Globe2 className="w-5 h-5 text-sky-400" />
            <span>全球空气质量热力与国控站点全景地图</span>
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            加载 WAQI 实时热力瓦片图层 + 中国 2,026 国控微站打点，支持缩放查看微观街区与宏观跨国扩散。
          </p>
        </div>

        {/* 图层控制按钮 */}
        <div className="flex items-center space-x-3 text-xs">
          <button
            onClick={() => setShowWaqiTiles(!showWaqiTiles)}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg border transition-all ${
              showWaqiTiles
                ? 'bg-sky-500/20 text-sky-300 border-sky-500/40'
                : 'bg-slate-900 text-slate-400 border-slate-800'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>WAQI 热力瓦片层: {showWaqiTiles ? '已开启' : '已关闭'}</span>
          </button>

          <button
            onClick={() => setShowStations(!showStations)}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg border transition-all ${
              showStations
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                : 'bg-slate-900 text-slate-400 border-slate-800'
            }`}
          >
            <MapPin className="w-3.5 h-3.5" />
            <span>国控站点标记: {showStations ? '已开启' : '已关闭'}</span>
          </button>
        </div>
      </div>

      {/* 地图主体容器 */}
      <div className="relative w-full h-[720px] rounded-2xl overflow-hidden border border-slate-800 shadow-2xl">
        <AirMap showWaqiTiles={showWaqiTiles} showStations={showStations} />

        {/* 悬浮 AQI 色标图例 */}
        <div className="absolute bottom-6 right-6 z-[1000] glass-panel rounded-xl p-3 shadow-2xl text-xs space-y-1.5 border border-slate-700/80 pointer-events-auto">
          <div className="font-semibold text-slate-300 mb-1 flex items-center space-x-1">
            <Info className="w-3.5 h-3.5 text-sky-400" />
            <span>AQI 色阶图例</span>
          </div>
          <div className="flex items-center space-x-2">
            <span className="w-3 h-3 rounded-full bg-emerald-500"></span>
            <span className="text-slate-300">0 - 50 优 (Good)</span>
          </div>
          <div className="flex items-center space-x-2">
            <span className="w-3 h-3 rounded-full bg-yellow-500"></span>
            <span className="text-slate-300">51 - 100 良 (Moderate)</span>
          </div>
          <div className="flex items-center space-x-2">
            <span className="w-3 h-3 rounded-full bg-orange-500"></span>
            <span className="text-slate-300">101 - 150 轻度 (USG)</span>
          </div>
          <div className="flex items-center space-x-2">
            <span className="w-3 h-3 rounded-full bg-red-500"></span>
            <span className="text-slate-300">151 - 200 中度 (Unhealthy)</span>
          </div>
          <div className="flex items-center space-x-2">
            <span className="w-3 h-3 rounded-full bg-purple-500"></span>
            <span className="text-slate-300">201 - 300 重度 (Very Unhealthy)</span>
          </div>
          <div className="flex items-center space-x-2">
            <span className="w-3 h-3 rounded-full bg-rose-950"></span>
            <span className="text-slate-300">300+ 严重 (Hazardous)</span>
          </div>
        </div>
      </div>
    </div>
  );
}
