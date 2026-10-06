'use client';

import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { fetchWAQIMapBounds, WaqiBoundStation } from '@/lib/services/waqi';

const WAQI_TOKEN = process.env.NEXT_PUBLIC_WAQI_TOKEN || '50b0c272a11f35667dd0ef7de354d76e9560ac48';
const CARTO_KEY = process.env.NEXT_PUBLIC_CARTO_KEY || 'cb1_4bl6_1_dc1bbfd8426369beb577afe4';

interface AirMapProps {
  showWaqiTiles: boolean;
  center?: [number, number];
  zoom?: number;
  onStationCountChange?: (count: number, loading: boolean) => void;
}

function getPinStyle(aqiNum: number) {
  if (isNaN(aqiNum) || aqiNum <= 50) {
    return {
      boxClass: 'aqi-pin-good',
      arrowClass: 'aqi-arrow-good',
      levelText: '优 (Good)',
      colorHex: '#10b981',
    };
  }
  if (aqiNum <= 100) {
    return {
      boxClass: 'aqi-pin-moderate',
      arrowClass: 'aqi-arrow-moderate',
      levelText: '良 (Moderate)',
      colorHex: '#eab308',
    };
  }
  if (aqiNum <= 150) {
    return {
      boxClass: 'aqi-pin-usg',
      arrowClass: 'aqi-arrow-usg',
      levelText: '轻度污染 (USG)',
      colorHex: '#f97316',
    };
  }
  if (aqiNum <= 200) {
    return {
      boxClass: 'aqi-pin-unhealthy',
      arrowClass: 'aqi-arrow-unhealthy',
      levelText: '中度污染 (Unhealthy)',
      colorHex: '#ef4444',
    };
  }
  if (aqiNum <= 300) {
    return {
      boxClass: 'aqi-pin-very-unhealthy',
      arrowClass: 'aqi-arrow-very-unhealthy',
      levelText: '重度污染 (Very Unhealthy)',
      colorHex: '#a855f7',
    };
  }
  return {
    boxClass: 'aqi-pin-hazardous',
    arrowClass: 'aqi-arrow-hazardous',
    levelText: '严重污染 (Hazardous)',
    colorHex: '#881337',
  };
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export default function AirMap({
  showWaqiTiles,
  center = [35.0, 105.0],
  zoom = 4,
  onStationCountChange,
}: AirMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const waqiLayerRef = useRef<L.TileLayer | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const fetchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const showWaqiTilesRef = useRef(showWaqiTiles);

  useEffect(() => {
    showWaqiTilesRef.current = showWaqiTiles;
  }, [showWaqiTiles]);

  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      // 初始化 Leaflet 地图 (启用整数缩放，防止栅格切片发生次像素双线性插值模糊)
      const map = L.map(mapContainerRef.current, {
        center,
        zoom,
        zoomControl: true,
        zoomSnap: 1,
        zoomDelta: 1,
      });

      // 1. 底图：CARTO Voyager @2x 官方高清视网膜底图
      // 使用 512px 瓦片尺寸与 -1 缩放偏移，既保持文字标注清晰大字体，又获得原生 2 倍超高像素锐利度
      L.tileLayer(
        `https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png?key=${CARTO_KEY}`,
        {
          attribution: '&copy; OpenStreetMap &copy; CARTO',
          maxZoom: 19,
          tileSize: 512,
          zoomOffset: -1,
        }
      ).addTo(map);

      // 2. WAQI 宏观切片图层 (用于低缩放级别查看全球宏观分布)
      const waqiTile = L.tileLayer(
        `https://tiles.aqicn.org/tiles/usepa-aqi/{z}/{x}/{y}.png?token=${WAQI_TOKEN}`,
        {
          attribution: 'Air Quality Tiles &copy; <a href="https://waqi.info">WAQI</a>',
          opacity: 0.85,
          maxNativeZoom: 10,
          maxZoom: 18,
        }
      );
      waqiLayerRef.current = waqiTile;

      // 3. 矢量高精测站微标图层
      const markersLayer = L.layerGroup().addTo(map);
      markersLayerRef.current = markersLayer;

      // 动态更新可见区域测站
      const syncVisibleStations = async () => {
        const curZoom = map.getZoom();

        // 当处于中高缩放级 (>= 7 区域与城市街区级) 时，启用高精矢量测站，并隐藏易产生拉伸模糊的宏观位图瓦片
        if (curZoom >= 7) {
          if (map.hasLayer(waqiTile)) {
            map.removeLayer(waqiTile);
          }

          onStationCountChange?.(0, true);

          const bounds = map.getBounds();
          const minLat = bounds.getSouth();
          const minLng = bounds.getWest();
          const maxLat = bounds.getNorth();
          const maxLng = bounds.getEast();

          try {
            const stations = await fetchWAQIMapBounds(minLat, minLng, maxLat, maxLng);
            
            // 清理旧标记并重建矢量 HTML 微标 (纯 CSS 矢量绘制，任何屏幕任何缩放永不模糊)
            markersLayer.clearLayers();

            stations.forEach((st: WaqiBoundStation) => {
              const aqiVal = parseInt(st.aqi, 10);
              const style = getPinStyle(aqiVal);

              const icon = L.divIcon({
                className: 'aqi-pin-container',
                html: `
                  <div class="aqi-vector-pin">
                    <div class="aqi-pin-box ${style.boxClass}">
                      ${st.aqi || '-'}
                    </div>
                    <div class="aqi-pin-arrow ${style.arrowClass}"></div>
                  </div>
                `,
                iconSize: [36, 27],
                iconAnchor: [18, 27],
                popupAnchor: [0, -28],
              });

              const marker = L.marker([st.lat, st.lon], { icon });

              const formattedTime = st.station.time
                ? new Date(st.station.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : '实时';

              marker.bindPopup(`
                <div class="p-3.5 min-w-[240px] max-w-[280px]">
                  <div class="flex items-center justify-between pb-2 border-b border-slate-100">
                    <span class="text-[11px] font-semibold tracking-wider text-slate-500 uppercase">官方实测站点</span>
                    <span class="text-[10px] px-2 py-0.5 rounded-full font-bold" style="background-color: ${style.colorHex}20; color: ${style.colorHex};">
                      ${style.levelText}
                    </span>
                  </div>
                  <div class="mt-2.5">
                    <h4 class="text-sm font-bold text-slate-900 leading-snug">${escapeHtml(st.station.name)}</h4>
                    <div class="mt-2 flex items-baseline space-x-2">
                      <span class="text-2xl font-black text-slate-900">${st.aqi}</span>
                      <span class="text-xs font-semibold text-slate-500">AQI 实时指数</span>
                    </div>
                  </div>
                  <div class="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
                    <span>更新时间: ${formattedTime}</span>
                    <span class="font-medium text-sky-600">WAQI 官方数据</span>
                  </div>
                </div>
              `, { maxWidth: 300, closeButton: false });

              markersLayer.addLayer(marker);
            });

            onStationCountChange?.(stations.length, false);
          } catch (e) {
            console.warn('[AirMap] Failed to sync stations in bounds:', e);
            onStationCountChange?.(0, false);
          }
        } else {
          // 宏观缩放级 (< 7 全球/国家级)：清空密集矢量标注，根据开关恢复宏观瓦片
          markersLayer.clearLayers();
          onStationCountChange?.(0, false);

          if (showWaqiTilesRef.current && !map.hasLayer(waqiTile)) {
            waqiTile.addTo(map);
          }
        }
      };

      const handleMoveEnd = () => {
        if (fetchTimeoutRef.current) {
          clearTimeout(fetchTimeoutRef.current);
        }
        fetchTimeoutRef.current = setTimeout(() => {
          syncVisibleStations();
        }, 250);
      };

      map.on('moveend', handleMoveEnd);

      // 初次加载触发一次
      syncVisibleStations();

      mapInstanceRef.current = map;
    }

    return () => {
      if (fetchTimeoutRef.current) {
        clearTimeout(fetchTimeoutRef.current);
      }
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // 响应视图中心与缩放变更 (平滑飞行漫游)
  useEffect(() => {
    if (mapInstanceRef.current && center) {
      mapInstanceRef.current.flyTo(center, zoom || 9, {
        duration: 1.5,
        easeLinearity: 0.25,
      });
    }
  }, [center, zoom]);

  // 响应切换 WAQI 瓦片图层 (在宏观缩放下生效)
  useEffect(() => {
    const map = mapInstanceRef.current;
    const waqiTile = waqiLayerRef.current;
    if (!map || !waqiTile) return;

    if (map.getZoom() < 7) {
      if (showWaqiTiles) {
        if (!map.hasLayer(waqiTile)) {
          waqiTile.addTo(map);
        }
      } else {
        if (map.hasLayer(waqiTile)) {
          map.removeLayer(waqiTile);
        }
      }
    }
  }, [showWaqiTiles]);

  return <div ref={mapContainerRef} className="w-full h-full rounded-2xl overflow-hidden" />;
}
