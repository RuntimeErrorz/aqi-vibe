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
      {/* 左右并列全景工作台容器：左侧为地图工作台 (含专属等宽控制栏)，右侧为顶格实时排行榜 (独占充裕空间) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-5 items-stretch flex-1 min-h-0 lg:h-[700px]">
        {/* 左侧：全景地图工作台 (lg:col-span-6，控制栏与地图宽度完全一致) */}
        <div className="lg:col-span-6 flex flex-col gap-2.5 sm:gap-3 min-h-0 h-auto lg:h-full">
          {/* 全景地图专属头部控制卡片 (与地图完全等宽) */}
          <div className="glass-panel rounded-2xl p-3 sm:p-3.5 flex flex-col gap-2.5 shrink-0">
            {/* 第一行：全景空气质量标题 + 旁边并排紧随三个胶囊 (右对齐) */}
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center space-x-2 shrink-0">
                <Globe2 className="w-5 h-5 text-sky-600" />
                <h1 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight whitespace-nowrap">
                  全景空气质量
                </h1>
              </div>

              {/* 三个胶囊放在标题旁边，靠右对齐 */}
              <div className="flex items-center justify-end gap-1.5 sm:gap-2 text-xs shrink-0 flex-nowrap overflow-x-auto no-scrollbar">
                {/* 胶囊 1：焦点城市实测状态徽章 */}
                {focusCityInfo && (
                  <div
                    title={`${focusCityInfo.name}: ${
                      focusCityInfo.level.includes('暂无') ? '暂无在册测站' : `AQI ${focusCityInfo.aqi}`
                    }${
                      focusCityInfo.stationName && !focusCityInfo.stationName.includes('暂无')
                        ? ` · 市中心站: ${focusCityInfo.stationName}`
                        : ''
                    }`}
                    className={`flex items-center space-x-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-semibold shadow-2xs shrink-0 max-w-[140px] xs:max-w-[170px] sm:max-w-[210px] ${
                      focusCityInfo.level.includes('暂无实时')
                        ? 'bg-slate-100 border-slate-300 text-slate-700'
                        : 'bg-sky-50 border-sky-200 text-sky-800'
                    }`}
                  >
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        focusCityInfo.level.includes('暂无实时')
                          ? 'bg-slate-400'
                          : 'bg-sky-500 animate-pulse'
                      }`}
                    />
                    <span className="truncate">
                      {focusCityInfo.name}: {
                        focusCityInfo.level.includes('暂无')
                          ? `暂无在册测站`
                          : `AQI ${focusCityInfo.aqi}`
                      }
                      {focusCityInfo.stationName && !focusCityInfo.stationName.includes('暂无')
                        ? ` · 市中心站: ${focusCityInfo.stationName}`
                        : ''}
                    </span>
                  </div>
                )}

                {/* 胶囊 2：测站同步状态 / 视野内测站数 */}
                {stationStatus.loading ? (
                  <div className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-600 font-medium shadow-2xs shrink-0">
                    <div className="w-3 h-3 border-2 border-sky-600 border-t-transparent rounded-full animate-spin"></div>
                    <span className="hidden xs:inline">同步中</span>
                  </div>
                ) : showStations && stationStatus.count > 0 ? (
                  <div className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-xl bg-slate-100 border border-slate-200 text-slate-700 font-medium shadow-2xs shrink-0 whitespace-nowrap">
                    <span className="w-2 h-2 rounded-full bg-slate-400"></span>
                    <span>
                      <span className="hidden sm:inline">视野内 </span>
                      <b>{stationStatus.count}</b> 测站
                    </span>
                  </div>
                ) : !showStations ? (
                  <div className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-500 shadow-2xs shrink-0 whitespace-nowrap">
                    <span>测站已隐藏</span>
                  </div>
                ) : null}

                {/* 胶囊 3：测站徽标切换开关 */}
                <button
                  type="button"
                  onClick={() => setShowStations(!showStations)}
                  className={`flex items-center space-x-1.5 px-2.5 py-1.5 rounded-xl border transition-all font-semibold cursor-pointer text-xs shrink-0 whitespace-nowrap ${
                    showStations
                      ? 'bg-sky-50 text-sky-700 border-sky-200 shadow-2xs'
                      : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                  }`}
                  title="开启或关闭全景地图上的在册监测站点徽标打点"
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span className="hidden xs:inline">测站徽标: {showStations ? '开启' : '关闭'}</span>
                  <span className="xs:hidden">徽标: {showStations ? '开' : '关'}</span>
                </button>
              </div>
            </div>

            {/* 第二行：城市检索飞抵搜索框 (占满与地图等宽的完整宽度) */}
            <div className="w-full">
              <CitySearchAutocomplete
                selectedCity={focusCity}
                onSelectCity={handleSelectCity}
                placeholder="定位国内 375 城市或全球 564 城市并在地图上飞抵..."
                className="w-full"
              />
            </div>
          </div>

          {/* 下方：全景地图本身 (flex-1 自动撑满剩余纵向空间) */}
          <div className="relative isolate z-10 w-full flex-1 min-h-[440px] sm:min-h-[480px] lg:min-h-0 rounded-2xl overflow-hidden border border-slate-200 shadow-md">
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
        </div>

        {/* 右侧：实时排行榜 (lg:col-span-6，顶格起步，完全独占完整的垂直空间与宽度) */}
        <div className="lg:col-span-6 flex flex-col h-auto lg:h-full min-h-0">
          <RealtimeRankingPanel onSelectCity={handleRankingSelectCity} className="h-full" />
        </div>
      </div>
    </div>
  );
}

