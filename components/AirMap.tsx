'use client';

import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { fetchWAQIMapBounds, WaqiBoundStation, getDistanceKm, extractCleanStationName } from '@/lib/services/waqi';
import { CityMeta, StandardType } from '@/lib/types';
import { useStandard } from '@/components/StandardContext';
import { convertIAQIToConcentration, evaluateAQI, getCNEvaluation, getUSEvaluation } from '@/lib/aqi-calculator';
import { iso1A2Code } from '@rapideditor/country-coder';

const CARTO_KEY = process.env.NEXT_PUBLIC_CARTO_KEY || 'cb1_4bl6_1_dc1bbfd8426369beb577afe4';
const WAQI_TOKEN = process.env.NEXT_PUBLIC_WAQI_TOKEN || '50b0c272a11f35667dd0ef7de354d76e9560ac48';

export interface FocusCityInfo {
  name: string;
  aqi: number;
  level: string;
  stationName: string;
  stationUid: number;
  distKm?: number;
}

interface AirMapProps {
  showStations?: boolean;
  center?: [number, number];
  zoom?: number;
  focusCity?: CityMeta;
  onStationCountChange?: (
    count: number,
    loading: boolean,
    focusInfo?: FocusCityInfo
  ) => void;
}

function getStationPinEvaluation(rawAqi: number, standard: StandardType) {
  if (isNaN(rawAqi) || rawAqi <= 0) {
    return {
      displayAqi: '-',
      boxClass: 'aqi-pin-nodata',
      levelText: '暂无数据',
      colorHex: '#64748b',
      pm25: undefined as number | undefined,
    };
  }

  if (standard === 'US') {
    const evaluation = getUSEvaluation(rawAqi);
    let boxClass = 'aqi-pin-good';
    if (rawAqi <= 50) boxClass = 'aqi-pin-good';
    else if (rawAqi <= 100) boxClass = 'aqi-pin-moderate';
    else if (rawAqi <= 150) boxClass = 'aqi-pin-usg';
    else if (rawAqi <= 200) boxClass = 'aqi-pin-unhealthy';
    else if (rawAqi <= 300) boxClass = 'aqi-pin-very-unhealthy';
    else boxClass = 'aqi-pin-hazardous';

    return {
      displayAqi: String(rawAqi),
      boxClass,
      levelText: evaluation.level,
      colorHex: evaluation.color,
      pm25: undefined as number | undefined,
    };
  } else {
    // 国标 HJ 633-2012: 从 WAQI 美标 IAQI 逆算物理质量浓度，再折算国标 AQI 与级别
    const pm25 = convertIAQIToConcentration('pm25', rawAqi, 'US');
    const evalCN = evaluateAQI({ pm25 }, 'CN');
    const cnAqi = evalCN.aqi;

    let boxClass = 'aqi-pin-good';
    if (cnAqi <= 50) boxClass = 'aqi-pin-good';
    else if (cnAqi <= 100) boxClass = 'aqi-pin-moderate';
    else if (cnAqi <= 150) boxClass = 'aqi-pin-usg';
    else if (cnAqi <= 200) boxClass = 'aqi-pin-unhealthy';
    else if (cnAqi <= 300) boxClass = 'aqi-pin-very-unhealthy';
    else boxClass = 'aqi-pin-hazardous';

    return {
      displayAqi: String(cnAqi),
      boxClass,
      levelText: evalCN.level,
      colorHex: evalCN.color,
      pm25,
    };
  }
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

  // 宏观网格单元像素大小 (px)：自适应匹配放大后的标牌 (28px 宽)，确保间距适度且无过度重叠
  const cellSize = zoom <= 4 ? 38 : zoom <= 6 ? 28 : 18;

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

/**
 * 纯几何物理球面距离选取离市中心最近的在册核心基准站：
 * 规则与排行榜 (realtime-ranking.ts) 100% 同源对齐
 */
function findNearestStationForCity(
  city: CityMeta,
  stationPool: WaqiBoundStation[]
): (WaqiBoundStation & { distKm: number }) | null {
  const valid = stationPool
    .filter((s) => {
      const a = parseInt(s.aqi, 10);
      if (isNaN(a) || a <= 0 || a > 500) return false;
      // 纯经纬度主权国家排他：防止紧邻国境线双子城出现跨国抢站
      const stCountry = iso1A2Code([s.lon, s.lat]);
      if (stCountry && city.country && city.country !== stCountry) return false;
      return true;
    })
    .map((s) => ({
      ...s,
      distKm: getDistanceKm(city.latitude, city.longitude, s.lat, s.lon),
    }))
    .filter((s) => s.distKm <= 35);

  // 严格按距城市中心物理几何球面距离升序排序，第一名为市中心核心基准站 (与排行榜、城市实况 100% 规则对齐)
  const sorted = [...valid].sort((a, b) => a.distKm - b.distKm);
  return sorted[0] || null;
}

export default function AirMap({
  showStations = true,
  center = [35.0, 105.0],
  zoom = 4,
  focusCity,
  onStationCountChange,
}: AirMapProps) {
  const { standard } = useStandard();
  const standardRef = useRef<StandardType>(standard);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const focusMarkerLayerRef = useRef<L.LayerGroup | null>(null);
  const fetchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const stationCacheRef = useRef<Map<number, WaqiBoundStation>>(new Map());
  const showStationsRef = useRef(showStations);
  const nearestStationRef = useRef<(WaqiBoundStation & { distKm: number }) | null>(null);

  useEffect(() => {
    standardRef.current = standard;
  }, [standard]);

  useEffect(() => {
    showStationsRef.current = showStations;
  }, [showStations]);

  // 渲染测站标记到地图（支持国标/美标自适应）
  const renderStations = (stationsToRender: WaqiBoundStation[]) => {
    const map = mapInstanceRef.current;
    const markersLayer = markersLayerRef.current;
    if (!map || !markersLayer) return;

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
      const style = getStationPinEvaluation(aqiVal, standardRef.current);

      // 原版标牌指针拟真矢量标记 (针尖直指站点经纬度，高分屏超锐利)
      const icon = L.divIcon({
        className: 'aqi-pin-container',
        html: `
          <div class="aqi-vector-pin">
            <div class="aqi-pin-box ${style.boxClass}">
              ${style.displayAqi}
            </div>
            <div class="aqi-pin-pole"></div>
          </div>
        `,
        iconSize: [32, 27],
        iconAnchor: [16, 27],
        popupAnchor: [0, -28],
      });

      const marker = L.marker([st.lat, st.lon], { icon });

      const formattedTime = st.station?.time
        ? new Date(st.station.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : '实时';

      const pm25Html = style.pm25 !== undefined ? `<div class="text-[11px] text-slate-500 mt-1">PM2.5: <span class="font-bold text-slate-700">${style.pm25} μg/m³</span></div>` : '';

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
              <span class="text-2xl font-black text-slate-900">${style.displayAqi}</span>
              <span class="text-xs font-semibold text-slate-500">AQI 实时指数</span>
            </div>
            ${pm25Html}
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

  // 渲染市中心核心基准站地标（纯几何最短距离同源计算）
  const renderFocusMarker = (
    station: (WaqiBoundStation & { distKm: number }) | null,
    city: CityMeta
  ) => {
    const layer = focusMarkerLayerRef.current;
    if (!layer || !mapInstanceRef.current) return;

    layer.clearLayers();

    if (!station) {
      const style = {
        displayAqi: '-',
        boxClass: 'aqi-pin-nodata',
        levelText: '暂无测站',
        colorHex: '#64748b',
      };
      const initialHtml = `
        <div class="aqi-focus-city-pin">
          <div class="aqi-focus-badge ${style.boxClass} shadow-xl ring-2 ring-white">
            <span class="font-black text-xs tracking-tight">${escapeHtml(city.nameZh)}</span>
            <span class="mx-1 opacity-60 font-normal">|</span>
            <span class="font-black text-xs">-</span>
          </div>
          <div class="aqi-focus-pin-pole"></div>
        </div>
      `;
      const marker = L.marker([city.latitude, city.longitude], {
        icon: L.divIcon({
          className: 'aqi-focus-container',
          html: initialHtml,
          iconSize: [96, 42],
          iconAnchor: [48, 42],
          popupAnchor: [0, -44],
        }),
        zIndexOffset: 3000,
      });
      layer.addLayer(marker);
      onStationCountChange?.(-1, false, {
        name: city.nameZh,
        aqi: 0,
        level: '暂无测站',
        stationName: '暂无在册测站',
        stationUid: 0,
      });
      return;
    }

    const rawAqi = parseInt(station.aqi, 10);
    const pm25 = convertIAQIToConcentration('pm25', rawAqi, 'US');
    const aqiNum = standardRef.current === 'CN'
      ? evaluateAQI({ pm25 }, 'CN').aqi
      : rawAqi;
    const style = getStationPinEvaluation(aqiNum, standardRef.current);
    const cleanName = extractCleanStationName(station.station?.name || '', city.nameZh);
    const distText = station.distKm < 1 ? '<1km' : `${station.distKm.toFixed(1)}km`;

    const updatedHtml = `
      <div class="aqi-focus-city-pin">
        <div class="aqi-focus-badge ${style.boxClass} shadow-xl ring-2 ring-white">
          <span class="font-black text-xs tracking-tight">${escapeHtml(city.nameZh)}</span>
          <span class="mx-1 opacity-60 font-normal">|</span>
          <span class="font-black text-xs">${aqiNum}</span>
        </div>
        <div class="aqi-focus-pin-pole"></div>
        <div class="aqi-focus-pulse" style="border-color: ${style.colorHex};"></div>
      </div>
    `;

    const activeIcon = L.divIcon({
      className: 'aqi-focus-container',
      html: updatedHtml,
      iconSize: [96, 42],
      iconAnchor: [48, 42],
      popupAnchor: [0, -44],
    });

    const activeMarker = L.marker([city.latitude, city.longitude], {
      icon: activeIcon,
      zIndexOffset: 3000,
    });

    const formattedTime = station.station?.time
      ? new Date(station.station.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '刚刚';

    activeMarker.bindPopup(`
      <div class="p-3 text-slate-800 min-w-[240px]">
        <div class="flex items-center justify-between gap-2 pb-1.5 border-b border-slate-100">
          <div class="font-black text-sm text-slate-900">${escapeHtml(city.nameZh)} (${escapeHtml(city.nameEn)})</div>
          <span class="text-xs font-mono font-bold px-1.5 py-0.5 rounded text-white" style="background-color: ${style.colorHex};">AQI ${aqiNum}</span>
        </div>
        <div class="mt-2 text-xs space-y-1">
          <div class="flex items-center justify-between text-slate-600">
            <span class="text-slate-400">市中心基准站:</span>
            <span class="font-bold text-slate-800">${escapeHtml(cleanName)} (${distText})</span>
          </div>
          <div class="flex items-center justify-between text-slate-600">
            <span class="text-slate-400">综合级别:</span>
            <span class="font-bold" style="color: ${style.colorHex}">${style.levelText}</span>
          </div>
          <div class="flex items-center justify-between text-slate-600">
            <span class="text-slate-400">实测 PM2.5:</span>
            <span class="font-mono font-bold text-slate-800">${pm25} μg/m³</span>
          </div>
          <div class="flex items-center justify-between text-slate-400 text-[10px] pt-1 border-t border-slate-100">
            <span>更新时间: ${formattedTime}</span>
            <span>站号 #${station.uid}</span>
          </div>
        </div>
      </div>
    `, { maxWidth: 280, closeButton: false });

    layer.addLayer(activeMarker);

    onStationCountChange?.(-1, false, {
      name: city.nameZh,
      aqi: aqiNum,
      level: style.levelText,
      stationName: cleanName,
      stationUid: station.uid,
      distKm: station.distKm,
    });
  };

  const renderStationsRef = useRef(renderStations);
  renderStationsRef.current = renderStations;

  const renderFocusMarkerRef = useRef(renderFocusMarker);
  renderFocusMarkerRef.current = renderFocusMarker;

  useEffect(() => {
    if (!mapContainerRef.current) return;

    let resizeObserver: ResizeObserver | null = null;

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

      // 3. 专属主城市焦点地标矢量图层 (独立图层，置顶显示，纯矢量微标)
      const focusMarkerLayer = L.layerGroup().addTo(map);
      focusMarkerLayerRef.current = focusMarkerLayer;

      // 4. 全局纯 CSS 矢量测站微标图层 (周围国控/海外微站散点，100% 矢量指针)
      const markersLayer = L.layerGroup().addTo(map);
      markersLayerRef.current = markersLayer;

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
          renderStationsRef.current(cachedStationsInView);
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

          renderStationsRef.current(allInView);
        } catch (e) {
          console.warn('[AirMap] Failed to sync bounds stations:', e);
          if (cachedStationsInView.length > 0) {
            renderStationsRef.current(cachedStationsInView);
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

      // 5. 监听容器尺寸自适应变化 (与右侧榜单卡片高度联动，零间隙自适应)
      if (typeof ResizeObserver !== 'undefined' && mapContainerRef.current) {
        resizeObserver = new ResizeObserver(() => {
          map.invalidateSize();
        });
        resizeObserver.observe(mapContainerRef.current);
      }

      mapInstanceRef.current = map;
    }

    return () => {
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
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
        renderStationsRef.current(inView);
      }
    }
  }, [showStations]);

  // 响应标准切换：重新渲染视野内测站微标与焦点城市微标
  useEffect(() => {
    standardRef.current = standard;
    const map = mapInstanceRef.current;
    if (!map) return;

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

    if (inView.length > 0 && showStationsRef.current) {
      renderStationsRef.current(inView);
    }

    if (nearestStationRef.current && focusCity) {
      renderFocusMarkerRef.current(nearestStationRef.current, focusCity);
    }
  }, [standard, focusCity]);

  // 响应焦点城市变更：计算距该城市市中心经纬度最近的在册核心站点并渲染地标
  useEffect(() => {
    const map = mapInstanceRef.current;
    const layer = focusMarkerLayerRef.current;
    if (!map || !layer || !focusCity) return;

    layer.clearLayers();
    nearestStationRef.current = null;

    // 1. 优先从已有在册站点缓存中查找市中心最近站立即渲染 (0 毫秒即时展示)
    const cachedNearest = findNearestStationForCity(
      focusCity,
      Array.from(stationCacheRef.current.values())
    );

    if (cachedNearest) {
      nearestStationRef.current = cachedNearest;
      renderFocusMarkerRef.current(cachedNearest, focusCity);
    } else {
      const initialHtml = `
        <div class="aqi-focus-city-pin">
          <div class="aqi-focus-badge bg-sky-600 text-white shadow-xl">
            <span class="font-extrabold text-xs tracking-tight">${escapeHtml(focusCity.nameZh)}</span>
            <span class="w-1.5 h-1.5 rounded-full bg-white animate-ping ml-1"></span>
          </div>
          <div class="aqi-focus-pin-pole"></div>
        </div>
      `;

      const initialIcon = L.divIcon({
        className: 'aqi-focus-container',
        html: initialHtml,
        iconSize: [88, 38],
        iconAnchor: [44, 38],
        popupAnchor: [0, -40],
      });

      const tempMarker = L.marker([focusCity.latitude, focusCity.longitude], {
        icon: initialIcon,
        zIndexOffset: 3000,
      });
      layer.addLayer(tempMarker);
    }

    // 2. 异步向 bounds 网格切片接口请求该城市中心周边 ±0.35° 范围站点，精准补全最近站
    let isCancelled = false;
    fetchWAQIMapBounds(
      focusCity.latitude - 0.35,
      focusCity.longitude - 0.35,
      focusCity.latitude + 0.35,
      focusCity.longitude + 0.35
    )
      .then((stations) => {
        if (isCancelled || !layer || !mapInstanceRef.current) return;
        stations.forEach((st) => stationCacheRef.current.set(st.uid, st));

        const freshNearest = findNearestStationForCity(
          focusCity,
          Array.from(stationCacheRef.current.values())
        );
        nearestStationRef.current = freshNearest;
        renderFocusMarkerRef.current(freshNearest, focusCity);
      })
      .catch((err) => {
        console.warn('[AirMap] Failed to sync focus city nearest station:', err);
        if (!isCancelled && !cachedNearest) {
          renderFocusMarkerRef.current(null, focusCity);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [focusCity]);

  return <div ref={mapContainerRef} className="w-full h-full rounded-2xl overflow-hidden" />;
}
