'use client';

import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { fetchWAQIMapBounds, WaqiBoundStation } from '@/lib/services/waqi';

const CARTO_KEY = process.env.NEXT_PUBLIC_CARTO_KEY || 'cb1_4bl6_1_dc1bbfd8426369beb577afe4';

interface AirMapProps {
  showStations?: boolean;
  showWaqiTiles?: boolean;
  center?: [number, number];
  zoom?: number;
  onStationCountChange?: (count: number, loading: boolean) => void;
}

function getPinStyle(aqiNum: number) {
  if (isNaN(aqiNum) || aqiNum <= 50) {
    return {
      boxClass: 'aqi-pin-good',
      levelText: '优 (Good)',
      colorHex: '#009966',
    };
  }
  if (aqiNum <= 100) {
    return {
      boxClass: 'aqi-pin-moderate',
      levelText: '良 (Moderate)',
      colorHex: '#fac800',
    };
  }
  if (aqiNum <= 150) {
    return {
      boxClass: 'aqi-pin-usg',
      levelText: '轻度污染 (USG)',
      colorHex: '#ff7e00',
    };
  }
  if (aqiNum <= 200) {
    return {
      boxClass: 'aqi-pin-unhealthy',
      levelText: '中度污染 (Unhealthy)',
      colorHex: '#cc0033',
    };
  }
  if (aqiNum <= 300) {
    return {
      boxClass: 'aqi-pin-very-unhealthy',
      levelText: '重度污染 (Very Unhealthy)',
      colorHex: '#660099',
    };
  }
  return {
    boxClass: 'aqi-pin-hazardous',
    levelText: '严重污染 (Hazardous)',
    colorHex: '#7e0023',
  };
}

function escapeHtml(str: string): string {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * 屏幕空间网格抽稀：
 * 在宏观或中观缩放（Zoom 3~7）下，根据屏幕物理像素将密集重叠测站自适应精简，
 * 优先保留高污染值站点，确保无论宏观还是微观，所有徽章均清晰整洁、间距合理且 100% 矢量锐利。
 */
function filterVisibleStationsByGrid(
  stations: WaqiBoundStation[],
  map: L.Map,
  zoom: number
): WaqiBoundStation[] {
  if (zoom >= 8) {
    return stations; // 微观街区/城市级：全量展示，不进行抽稀
  }

  // 宏观网格单元像素大小 (px)：原版标牌紧凑精致 (24px 宽)，略微减小网格以呈现更丰富的站点
  const cellSize = zoom <= 4 ? 36 : zoom <= 6 ? 25 : 16;

  // 降序排序：高污染数值或有异常读数的测站优先被代表性展示
  const sorted = [...stations].sort((a, b) => {
    const aVal = parseInt(a.aqi, 10) || 0;
    const bVal = parseInt(b.aqi, 10) || 0;
    return bVal - aVal;
  });

  const grid = new Map<string, boolean>();
  const filtered: WaqiBoundStation[] = [];

  for (const st of sorted) {
    const pt = map.latLngToContainerPoint([st.lat, st.lon]);
    const gx = Math.floor(pt.x / cellSize);
    const gy = Math.floor(pt.y / cellSize);
    const key = `${gx},${gy}`;

    if (!grid.has(key)) {
      grid.set(key, true);
      filtered.push(st);
    }
  }

  return filtered;
}

export default function AirMap({
  showStations = true,
  center = [35.0, 105.0],
  zoom = 4,
  onStationCountChange,
}: AirMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const fetchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const stationCacheRef = useRef<Map<number, WaqiBoundStation>>(new Map());
  const showStationsRef = useRef(showStations);

  useEffect(() => {
    showStationsRef.current = showStations;
  }, [showStations]);

  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      // 1. 初始化 Leaflet 地图 (开启整数缩放锁定，杜绝次像素双线性插值模糊)
      const map = L.map(mapContainerRef.current, {
        center,
        zoom,
        zoomControl: true,
        zoomSnap: 1,
        zoomDelta: 1,
      });

      // 2. 底图：CARTO Voyager @2x 官方高清视网膜底图 (512px 视网膜切片 + zoomOffset: -1)
      L.tileLayer(
        `https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png?key=${CARTO_KEY}`,
        {
          attribution: '&copy; OpenStreetMap &copy; CARTO',
          maxZoom: 19,
          tileSize: 512,
          zoomOffset: -1,
        }
      ).addTo(map);

      // 3. 全局纯 CSS 矢量测站微标图层 (完美复刻原版 WAQI 标牌指针视觉风格)
      const markersLayer = L.layerGroup().addTo(map);
      markersLayerRef.current = markersLayer;

      // 渲染测站标记到地图
      const renderStations = (stationsToRender: WaqiBoundStation[]) => {
        if (!showStationsRef.current) {
          markersLayer.clearLayers();
          onStationCountChange?.(0, false);
          return;
        }

        const curZoom = map.getZoom();
        const displayStations = filterVisibleStationsByGrid(stationsToRender, map, curZoom);

        markersLayer.clearLayers();

        displayStations.forEach((st: WaqiBoundStation) => {
          const aqiVal = parseInt(st.aqi, 10);
          const style = getPinStyle(aqiVal);

          // 原版标牌指针拟真矢量标记 (针尖直指站点经纬度，高分屏超锐利)
          const icon = L.divIcon({
            className: 'aqi-pin-container',
            html: `
              <div class="aqi-vector-pin">
                <div class="aqi-pin-box ${style.boxClass}">
                  ${st.aqi || '-'}
                </div>
                <div class="aqi-pin-pole"></div>
              </div>
            `,
            iconSize: [28, 23],
            iconAnchor: [14, 23],
            popupAnchor: [0, -24],
          });

          const marker = L.marker([st.lat, st.lon], { icon });

          const formattedTime = st.station?.time
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
                <h4 class="text-sm font-bold text-slate-900 leading-snug">${escapeHtml(st.station?.name || '实时空气质量站点')}</h4>
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

        onStationCountChange?.(displayStations.length, false);
      };

      // 同步当前视口内的测站
      const syncStationsInViewport = async () => {
        if (!showStationsRef.current) {
          markersLayer.clearLayers();
          onStationCountChange?.(0, false);
          return;
        }

        const bounds = map.getBounds();
        const minLat = bounds.getSouth();
        const minLng = bounds.getWest();
        const maxLat = bounds.getNorth();
        const maxLng = bounds.getEast();

        // 优先使用内存缓存中的已有站点立即渲染（0 毫秒即时响应，平移无缝）
        const cachedStationsInView: WaqiBoundStation[] = [];
        stationCacheRef.current.forEach((st) => {
          if (st.lat >= minLat && st.lat <= maxLat && st.lon >= minLng && st.lon <= maxLng) {
            cachedStationsInView.push(st);
          }
        });

        if (cachedStationsInView.length > 0) {
          renderStations(cachedStationsInView);
        } else {
          onStationCountChange?.(0, true);
        }

        // 异步向官方接口请求最新高精站点
        try {
          const freshStations = await fetchWAQIMapBounds(minLat, minLng, maxLat, maxLng);
          
          freshStations.forEach((st: WaqiBoundStation) => {
            stationCacheRef.current.set(st.uid, st);
          });

          // 取当前视口内的最新站点全集重新渲染
          const allInView: WaqiBoundStation[] = [];
          stationCacheRef.current.forEach((st) => {
            if (st.lat >= minLat && st.lat <= maxLat && st.lon >= minLng && st.lon <= maxLng) {
              allInView.push(st);
            }
          });

          renderStations(allInView);
        } catch (e) {
          console.warn('[AirMap] Failed to sync bounds stations:', e);
          if (cachedStationsInView.length > 0) {
            renderStations(cachedStationsInView);
          } else {
            onStationCountChange?.(0, false);
          }
        }
      };

      const handleMoveEnd = () => {
        if (fetchTimeoutRef.current) {
          clearTimeout(fetchTimeoutRef.current);
        }
        fetchTimeoutRef.current = setTimeout(() => {
          syncStationsInViewport();
        }, 200);
      };

      map.on('moveend', handleMoveEnd);

      // 初次挂载加载可视区域站点
      syncStationsInViewport();

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

  // 响应开关切换
  useEffect(() => {
    const map = mapInstanceRef.current;
    const markersLayer = markersLayerRef.current;
    if (!map || !markersLayer) return;

    if (!showStations) {
      markersLayer.clearLayers();
      onStationCountChange?.(0, false);
    } else {
      // 重新触发一次渲染
      const bounds = map.getBounds();
      const minLat = bounds.getSouth();
      const minLng = bounds.getWest();
      const maxLat = bounds.getNorth();
      const maxLng = bounds.getEast();

      const inView: WaqiBoundStation[] = [];
      stationCacheRef.current.forEach((st) => {
        if (st.lat >= minLat && st.lat <= maxLat && st.lon >= minLng && st.lon <= maxLng) {
          inView.push(st);
        }
      });

      if (inView.length > 0) {
        const curZoom = map.getZoom();
        const displayStations = filterVisibleStationsByGrid(inView, map, curZoom);
        markersLayer.clearLayers();
        displayStations.forEach((st) => {
          const aqiVal = parseInt(st.aqi, 10);
          const style = getPinStyle(aqiVal);
          const icon = L.divIcon({
            className: 'aqi-pin-container',
            html: `
              <div class="aqi-vector-pin">
                <div class="aqi-pin-box ${style.boxClass}">
                  ${st.aqi || '-'}
                </div>
                <div class="aqi-pin-pole"></div>
              </div>
            `,
            iconSize: [28, 23],
            iconAnchor: [14, 23],
            popupAnchor: [0, -24],
          });
          const marker = L.marker([st.lat, st.lon], { icon });
          marker.bindPopup(`
            <div class="p-3.5 min-w-[240px] max-w-[280px]">
              <div class="flex items-center justify-between pb-2 border-b border-slate-100">
                <span class="text-[11px] font-semibold tracking-wider text-slate-500 uppercase">官方实测站点</span>
                <span class="text-[10px] px-2 py-0.5 rounded-full font-bold" style="background-color: ${style.colorHex}20; color: ${style.colorHex};">
                  ${style.levelText}
                </span>
              </div>
              <div class="mt-2.5">
                <h4 class="text-sm font-bold text-slate-900 leading-snug">${escapeHtml(st.station?.name || '实时空气质量站点')}</h4>
                <div class="mt-2 flex items-baseline space-x-2">
                  <span class="text-2xl font-black text-slate-900">${st.aqi}</span>
                  <span class="text-xs font-semibold text-slate-500">AQI 实时指数</span>
                </div>
              </div>
            </div>
          `, { maxWidth: 300, closeButton: false });
          markersLayer.addLayer(marker);
        });
        onStationCountChange?.(displayStations.length, false);
      }
    }
  }, [showStations]);

  return <div ref={mapContainerRef} className="w-full h-full rounded-2xl overflow-hidden" />;
}
