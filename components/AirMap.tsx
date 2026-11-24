'use client';

import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  fetchWAQIMapBounds,
  WaqiBoundStation,
  extractCleanStationName,
  fetchWAQICityCompositeData,
  fetchWAQIStationByUid,
  enrichStationsWithPM25,
  getWAQIMapTileUrl,
} from '@/lib/services/waqi';
import { filterStationsForCity, getDistanceKm } from '@/lib/services/geo-filter';
import { CityMeta, StandardType, AirQualityRecord } from '@/lib/types';
import { useStandard } from '@/components/StandardContext';
import { convertIAQIToConcentration, evaluateAQI, getUSEvaluation } from '@/lib/aqi-calculator';
import { iso1A2Code } from '@rapideditor/country-coder';

const CARTO_KEY = process.env.NEXT_PUBLIC_CARTO_KEY || 'cb1_4bl6_1_dc1bbfd8426369beb577afe4';

export interface FocusCityInfo {
  name: string;
  aqi: number;
  level: string;
  stationName: string;
  stationUid: number;
  distKm?: number;
  stationCount?: number;
}

interface AirMapProps {
  showStations?: boolean;
  showHeatmap?: boolean;
  heatmapOpacity?: number;
  basemapTheme?: 'light' | 'dark';
  center?: [number, number];
  zoom?: number;
  focusCity?: CityMeta;
  onStationCountChange?: (
    count: number,
    loading: boolean,
    focusInfo?: FocusCityInfo
  ) => void;
}

function getBoxClassByAqi(aqi: number): string {
  if (isNaN(aqi) || aqi <= 0) return 'aqi-pin-nodata';
  if (aqi <= 50) return 'aqi-pin-good';
  if (aqi <= 100) return 'aqi-pin-moderate';
  if (aqi <= 150) return 'aqi-pin-usg';
  if (aqi <= 200) return 'aqi-pin-unhealthy';
  if (aqi <= 300) return 'aqi-pin-very-unhealthy';
  return 'aqi-pin-hazardous';
}

function getStationPinEvaluation(
  st: WaqiBoundStation,
  standard: StandardType,
  onlyPm25 = false
) {
  const rawAqi = parseInt(st.aqi, 10);
  if (isNaN(rawAqi) || rawAqi <= 0) {
    return {
      displayAqi: '-',
      boxClass: 'aqi-pin-nodata',
      levelText: '暂无数据',
      colorHex: '#64748b',
      pm25: undefined as number | undefined,
      isRealPm25: false,
    };
  }

  // 开启「只看 PM2.5」时：仅当该站点已有真实实测 PM2.5 时按 PM2.5 渲染；
  // 严禁乘以硬编码 0.3 或借用其他城市比例系数伪造！未补齐时诚实展示 WAQI 综合指数并标注。
  if (onlyPm25 && st.pm25 !== undefined && st.pm25 > 0) {
    const evalPm25 = evaluateAQI({ pm25: st.pm25 }, standard, true);
    return {
      displayAqi: String(evalPm25.aqi),
      boxClass: getBoxClassByAqi(evalPm25.aqi),
      levelText: evalPm25.level,
      colorHex: evalPm25.color,
      pm25: st.pm25,
      isRealPm25: true,
    };
  }

  const realPm25 = st.pm25 !== undefined && st.pm25 > 0 ? st.pm25 : undefined;

  if (standard === 'US') {
    const evaluation = getUSEvaluation(rawAqi);
    return {
      displayAqi: String(rawAqi),
      boxClass: getBoxClassByAqi(rawAqi),
      levelText: evaluation.level,
      colorHex: evaluation.color,
      pm25: realPm25,
      isRealPm25: realPm25 !== undefined,
    };
  } else {
    const estConc = realPm25 ?? convertIAQIToConcentration('pm25', rawAqi, 'US');
    const evalCN = evaluateAQI({ pm25: estConc }, 'CN');
    return {
      displayAqi: String(evalCN.aqi),
      boxClass: getBoxClassByAqi(evalCN.aqi),
      levelText: evalCN.level,
      colorHex: evalCN.color,
      pm25: realPm25,
      isRealPm25: realPm25 !== undefined,
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

function filterVisibleStationsByGrid(
  stations: WaqiBoundStation[],
  map: L.Map,
  zoom: number
): WaqiBoundStation[] {
  if (zoom >= 8) return stations;
  const cellSize = zoom <= 4 ? 38 : zoom <= 6 ? 28 : 18;

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

function findNearestStationForCity(
  city: CityMeta,
  stationPool: WaqiBoundStation[]
): (WaqiBoundStation & { distKm: number }) | null {
  const valid = stationPool
    .filter((s) => {
      const a = parseInt(s.aqi, 10);
      if (isNaN(a) || a <= 0 || a > 500) return false;
      const stCountry = iso1A2Code([s.lon, s.lat]);
      if (stCountry && city.country && city.country !== stCountry) return false;
      return true;
    })
    .map((s) => ({
      ...s,
      distKm: getDistanceKm(city.latitude, city.longitude, s.lat, s.lon),
    }))
    .filter((s) => s.distKm <= 35);

  const sorted = [...valid].sort((a, b) => a.distKm - b.distKm);
  return sorted[0] || null;
}

function buildStationDetailPopupHtml(
  st: WaqiBoundStation,
  rec: AirQualityRecord | null,
  standard: StandardType,
  onlyPm25: boolean,
  fallbackStyle: ReturnType<typeof getStationPinEvaluation>,
  loadingDetail = false
): string {
  const formattedTime = rec?.updateTime
    ? rec.updateTime.slice(5, 16)
    : st.station?.time
    ? new Date(st.station.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '实时';

  const ev = rec
    ? onlyPm25
      ? evaluateAQI({ pm25: rec.pollutants.pm25 }, standard, true)
      : standard === 'CN'
      ? rec.evaluationCN
      : rec.evaluationUS
    : null;

  const displayAqi = ev ? (ev.aqi > 0 ? String(ev.aqi) : '-') : fallbackStyle.displayAqi;
  const levelText = ev ? ev.level : fallbackStyle.levelText;
  const colorHex = ev ? ev.color : fallbackStyle.colorHex;

  const pollutantsGrid = rec
    ? `<div class="mt-2.5 grid grid-cols-3 gap-1.5 text-[10px]">
        ${[
          { label: 'PM2.5', val: rec.pollutants.pm25, unit: 'μg/m³' },
          { label: 'PM10', val: rec.pollutants.pm10, unit: 'μg/m³' },
          { label: 'O₃', val: rec.pollutants.o3, unit: 'μg/m³' },
          { label: 'NO₂', val: rec.pollutants.no2, unit: 'μg/m³' },
          { label: 'SO₂', val: rec.pollutants.so2, unit: 'μg/m³' },
          { label: 'CO', val: rec.pollutants.co, unit: 'mg/m³' },
        ]
          .filter((p) => p.val !== undefined && p.val > 0)
          .map(
            (p) => `<div class="bg-slate-50 rounded-md px-1.5 py-1 border border-slate-100">
              <div class="text-slate-400">${p.label}</div>
              <div class="font-mono font-bold text-slate-800">${p.val} <span class="font-normal text-[9px] text-slate-400">${p.unit}</span></div>
            </div>`
          )
          .join('')}
      </div>`
    : loadingDetail
    ? `<div class="mt-2 text-[11px] text-sky-600">正在拉取该站点六项分项实测...</div>`
    : fallbackStyle.pm25 !== undefined
    ? `<div class="text-[11px] text-slate-500 mt-1">实测 PM2.5: <span class="font-bold text-slate-700">${fallbackStyle.pm25} μg/m³</span></div>`
    : `<div class="text-[10px] text-slate-400 mt-1">${onlyPm25 ? '当前展示综合 AQI，正在按需拉取 PM2.5 实测' : '点击后已同步官方监测实况'}</div>`;

  return `
    <div class="p-3.5 min-w-[248px] max-w-[290px]">
      <div class="flex items-center justify-between pb-2 border-b border-slate-100">
        <span class="text-[11px] font-semibold tracking-wider text-slate-500 uppercase">官方实测站点 #${st.uid}</span>
        <span class="text-[10px] px-2 py-0.5 rounded-full font-bold" style="background-color: ${colorHex}20; color: ${colorHex};">
          ${escapeHtml(levelText)}
        </span>
      </div>
      <div class="mt-2.5">
        <h4 class="text-sm font-bold text-slate-900 leading-snug">${escapeHtml(st.station?.name || '实时空气质量站点')}</h4>
        <div class="mt-2 flex items-baseline space-x-2">
          <span class="text-2xl font-black text-slate-900">${displayAqi}</span>
          <span class="text-xs font-semibold text-slate-500">${onlyPm25 && (rec || fallbackStyle.isRealPm25) ? 'PM2.5 AQI' : '综合 AQI'}</span>
        </div>
        ${pollutantsGrid}
      </div>
      <div class="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
        <span>更新: ${escapeHtml(formattedTime)}</span>
        <span class="font-medium text-sky-600">WAQI 官方实测</span>
      </div>
    </div>
  `;
}

export default function AirMap({
  showStations = true,
  showHeatmap = false,
  heatmapOpacity = 0.55,
  basemapTheme = 'light',
  center = [35.0, 105.0],
  zoom = 4,
  focusCity,
  onStationCountChange,
}: AirMapProps) {
  const { standard, onlyPm25, cityCompositeRecords, reportCityCompositeRecord } = useStandard();
  const standardRef = useRef<StandardType>(standard);
  const onlyPm25Ref = useRef<boolean>(onlyPm25);
  const compositeRecordsRef = useRef<Record<string, AirQualityRecord>>(cityCompositeRecords);
  compositeRecordsRef.current = cityCompositeRecords;
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const basemapLayerRef = useRef<L.TileLayer | null>(null);
  const heatmapLayerRef = useRef<L.TileLayer | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const fetchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const enrichAbortRef = useRef<AbortController | null>(null);
  const stationCacheRef = useRef<Map<number, WaqiBoundStation>>(new Map());
  const stationDetailRecRef = useRef<Map<number, AirQualityRecord>>(new Map());
  const showStationsRef = useRef(showStations);
  const nearestStationRef = useRef<(WaqiBoundStation & { distKm: number }) | null>(null);
  const focusCityDataMap = useRef<Map<string, AirQualityRecord>>(new Map());

  useEffect(() => {
    standardRef.current = standard;
    onlyPm25Ref.current = onlyPm25;
  }, [standard, onlyPm25]);

  useEffect(() => {
    showStationsRef.current = showStations;
  }, [showStations]);

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
      const style = getStationPinEvaluation(st, standardRef.current, onlyPm25Ref.current);

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
      const cachedDetail = stationDetailRecRef.current.get(st.uid) || null;
      const initialPopupHtml = buildStationDetailPopupHtml(
        st,
        cachedDetail,
        standardRef.current,
        onlyPm25Ref.current,
        style,
        !cachedDetail
      );

      marker.bindPopup(initialPopupHtml, { maxWidth: 300, closeButton: false });

      // 点击测站弹窗时按需拉取真实六项分项实测（零伪造，按需请求）
      marker.on('popupopen', () => {
        const existing = stationDetailRecRef.current.get(st.uid);
        if (existing) {
          marker.setPopupContent(
            buildStationDetailPopupHtml(st, existing, standardRef.current, onlyPm25Ref.current, style, false)
          );
          return;
        }
        fetchWAQIStationByUid(st.uid)
          .then((rec) => {
            stationDetailRecRef.current.set(st.uid, rec);
            if (rec.pollutants.pm25 !== undefined) {
              stationCacheRef.current.set(st.uid, {
                ...st,
                pm25: rec.pollutants.pm25,
                pm25IaqiUS: rec.iaqiUS?.pm25,
                pm25IaqiCN: rec.iaqiCN?.pm25,
              });
            }
            marker.setPopupContent(
              buildStationDetailPopupHtml(st, rec, standardRef.current, onlyPm25Ref.current, style, false)
            );
          })
          .catch(() => {
            marker.setPopupContent(
              buildStationDetailPopupHtml(st, null, standardRef.current, onlyPm25Ref.current, style, false)
            );
          });
      });

      markersLayer.addLayer(marker);
    });

    onStationCountChange?.(displayStations.length, false);
  };

  // 微观缩放 (zoom >= 9) 且开启「只看 PM2.5」时，受控并发拉取视野内最多 15 个站点的真实 PM2.5
  const enrichViewportStationsIfNeeded = (stationsInView: WaqiBoundStation[]) => {
    const map = mapInstanceRef.current;
    if (!map || !onlyPm25Ref.current || map.getZoom() < 9) return;

    const missing = stationsInView.filter((s) => s.pm25 === undefined).slice(0, 15);
    if (missing.length === 0) return;

    if (enrichAbortRef.current) {
      enrichAbortRef.current.abort();
    }
    const controller = new AbortController();
    enrichAbortRef.current = controller;

    enrichStationsWithPM25(missing, { concurrency: 5, signal: controller.signal })
      .then((enriched) => {
        if (controller.signal.aborted || !mapInstanceRef.current) return;
        let updated = false;
        enriched.forEach((st) => {
          if (st.pm25 !== undefined) {
            stationCacheRef.current.set(st.uid, st);
            updated = true;
          }
        });
        if (updated && showStationsRef.current) {
          const bounds = mapInstanceRef.current.getBounds();
          const allInView: WaqiBoundStation[] = [];
          stationCacheRef.current.forEach((st) => {
            if (
              st.lat >= bounds.getSouth() &&
              st.lat <= bounds.getNorth() &&
              st.lon >= bounds.getWest() &&
              st.lon <= bounds.getEast()
            ) {
              allInView.push(st);
            }
          });
          renderStationsRef.current(allInView);
        }
      })
      .catch(() => {});
  };

  // 仅同步焦点城市的聚合状态信息给顶部控制栏，不在地图画布上额外叠加悬浮城市地标胶囊
  const syncFocusCityInfo = (
    station: (WaqiBoundStation & { distKm: number }) | null,
    city: CityMeta
  ) => {
    if (!station) {
      onStationCountChange?.(-1, false, {
        name: city.nameZh,
        aqi: 0,
        level: '暂无测站',
        stationName: '暂无在册测站',
        stationUid: 0,
      });
      return;
    }

    const cityRecord =
      compositeRecordsRef.current[city.id] || focusCityDataMap.current.get(city.id);

    const validCityStations = filterStationsForCity(
      Array.from(stationCacheRef.current.values()).filter((s) => {
        const a = parseInt(s.aqi, 10);
        return !isNaN(a) && a > 0 && a <= 500;
      }),
      city
    );

    const stationCount = cityRecord?.compositeStationCount ?? (validCityStations.length || 1);
    let aqiNum = 0;
    let levelText = '暂无实测';

    if (onlyPm25Ref.current) {
      const realPm25 = cityRecord?.pollutants.pm25;
      if (realPm25 !== undefined && realPm25 > 0) {
        const evalRes = evaluateAQI({ pm25: realPm25 }, standardRef.current, true);
        aqiNum = evalRes.aqi;
        levelText = evalRes.level;
      } else if (!cityRecord) {
        levelText = '聚合全城均值中';
      } else {
        levelText = '暂无 PM2.5 实测';
      }
    } else if (cityRecord) {
      const evalRes = standardRef.current === 'CN' ? cityRecord.evaluationCN : cityRecord.evaluationUS;
      aqiNum = evalRes.aqi;
      levelText = evalRes.level;
    } else {
      levelText = '聚合全城均值中';
    }

    const cleanName = extractCleanStationName(station.station?.name || '', city.nameZh);

    onStationCountChange?.(-1, false, {
      name: city.nameZh,
      aqi: aqiNum,
      level: levelText,
      stationName: cleanName,
      stationUid: station.uid,
      distKm: station.distKm,
      stationCount,
    });
  };

  const renderStationsRef = useRef(renderStations);
  renderStationsRef.current = renderStations;

  const syncFocusCityInfoRef = useRef(syncFocusCityInfo);
  syncFocusCityInfoRef.current = syncFocusCityInfo;

  const enrichViewportRef = useRef(enrichViewportStationsIfNeeded);
  enrichViewportRef.current = enrichViewportStationsIfNeeded;

  useEffect(() => {
    if (!mapContainerRef.current) return;

    let resizeObserver: ResizeObserver | null = null;

    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        center,
        zoom,
        zoomControl: true,
        zoomSnap: 1,
        zoomDelta: 1,
      });

      const baseUrl =
        basemapTheme === 'dark'
          ? `https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png?key=${CARTO_KEY}`
          : `https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png?key=${CARTO_KEY}`;

      basemapLayerRef.current = L.tileLayer(baseUrl, {
        attribution: '&copy; OpenStreetMap &copy; CARTO',
        maxZoom: 19,
        tileSize: 512,
        zoomOffset: -1,
      }).addTo(map);

      const markersLayer = L.layerGroup().addTo(map);
      markersLayerRef.current = markersLayer;

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

        try {
          const freshStations = await fetchWAQIMapBounds(minLat, minLng, maxLat, maxLng);
          freshStations.forEach((st: WaqiBoundStation) => {
            const prev = stationCacheRef.current.get(st.uid);
            stationCacheRef.current.set(st.uid, {
              ...st,
              pm25: prev?.pm25,
              pm25IaqiUS: prev?.pm25IaqiUS,
              pm25IaqiCN: prev?.pm25IaqiCN,
            });
          });

          const allInView: WaqiBoundStation[] = [];
          stationCacheRef.current.forEach((st) => {
            if (st.lat >= minLat && st.lat <= maxLat && st.lon >= minLng && st.lon <= maxLng) {
              allInView.push(st);
            }
          });

          renderStationsRef.current(allInView);
          enrichViewportRef.current(allInView);
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
        if (fetchTimeoutRef.current) clearTimeout(fetchTimeoutRef.current);
        fetchTimeoutRef.current = setTimeout(() => {
          syncStationsInViewport();
        }, 200);
      };

      map.on('moveend', handleMoveEnd);
      syncStationsInViewport();

      if (typeof ResizeObserver !== 'undefined' && mapContainerRef.current) {
        resizeObserver = new ResizeObserver(() => {
          map.invalidateSize();
        });
        resizeObserver.observe(mapContainerRef.current);
      }

      mapInstanceRef.current = map;
    }

    return () => {
      if (resizeObserver) resizeObserver.disconnect();
      if (fetchTimeoutRef.current) clearTimeout(fetchTimeoutRef.current);
      if (enrichAbortRef.current) enrichAbortRef.current.abort();
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // 响应浅色 / 深色底图切换
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (basemapLayerRef.current) {
      map.removeLayer(basemapLayerRef.current);
    }
    const baseUrl =
      basemapTheme === 'dark'
        ? `https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png?key=${CARTO_KEY}`
        : `https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png?key=${CARTO_KEY}`;
    basemapLayerRef.current = L.tileLayer(baseUrl, {
      attribution: '&copy; OpenStreetMap &copy; CARTO',
      maxZoom: 19,
      tileSize: 512,
      zoomOffset: -1,
    }).addTo(map);
    basemapLayerRef.current.bringToBack();
  }, [basemapTheme]);

  // 响应 WAQI 全球污染热力瓦片层开关与透明度
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (showHeatmap) {
      if (!heatmapLayerRef.current) {
        heatmapLayerRef.current = L.tileLayer(getWAQIMapTileUrl(), {
          opacity: heatmapOpacity,
          maxZoom: 16,
          zIndex: 400,
        }).addTo(map);
      } else {
        heatmapLayerRef.current.setOpacity(heatmapOpacity);
      }
    } else if (heatmapLayerRef.current) {
      map.removeLayer(heatmapLayerRef.current);
      heatmapLayerRef.current = null;
    }
  }, [showHeatmap, heatmapOpacity]);

  useEffect(() => {
    if (mapInstanceRef.current && center) {
      mapInstanceRef.current.flyTo(center, zoom || 9, {
        duration: 1.5,
        easeLinearity: 0.25,
      });
    }
  }, [center, zoom]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    const markersLayer = markersLayerRef.current;
    if (!map || !markersLayer) return;

    if (!showStations) {
      markersLayer.clearLayers();
      onStationCountChange?.(0, false);
    } else {
      const bounds = map.getBounds();
      const inView: WaqiBoundStation[] = [];
      stationCacheRef.current.forEach((st) => {
        if (
          st.lat >= bounds.getSouth() &&
          st.lat <= bounds.getNorth() &&
          st.lon >= bounds.getWest() &&
          st.lon <= bounds.getEast()
        ) {
          inView.push(st);
        }
      });
      if (inView.length > 0) {
        renderStationsRef.current(inView);
      }
    }
  }, [showStations]);

  useEffect(() => {
    standardRef.current = standard;
    onlyPm25Ref.current = onlyPm25;
    const map = mapInstanceRef.current;
    if (!map) return;

    const bounds = map.getBounds();
    const inView: WaqiBoundStation[] = [];
    stationCacheRef.current.forEach((st) => {
      if (
        st.lat >= bounds.getSouth() &&
        st.lat <= bounds.getNorth() &&
        st.lon >= bounds.getWest() &&
        st.lon <= bounds.getEast()
      ) {
        inView.push(st);
      }
    });

    if (inView.length > 0 && showStationsRef.current) {
      renderStationsRef.current(inView);
      enrichViewportRef.current(inView);
    }

    if (nearestStationRef.current && focusCity) {
      syncFocusCityInfoRef.current(nearestStationRef.current, focusCity);
    }
  }, [standard, onlyPm25, focusCity, cityCompositeRecords]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !focusCity) return;

    let isCancelled = false;
    nearestStationRef.current = null;

    const cachedNearest = findNearestStationForCity(
      focusCity,
      Array.from(stationCacheRef.current.values())
    );

    if (cachedNearest) {
      nearestStationRef.current = cachedNearest;
      syncFocusCityInfoRef.current(cachedNearest, focusCity);
    }

    const focusAbort = new AbortController();
    if (!compositeRecordsRef.current[focusCity.id] && !focusCityDataMap.current.has(focusCity.id)) {
      fetchWAQICityCompositeData(focusCity.id, focusAbort.signal)
        .then((rec: AirQualityRecord) => {
          if (isCancelled || !rec) return;
          focusCityDataMap.current.set(focusCity.id, rec);
          reportCityCompositeRecord(focusCity.id, rec);
          if (nearestStationRef.current) {
            syncFocusCityInfoRef.current(nearestStationRef.current, focusCity);
          }
        })
        .catch(() => {});
    }

    fetchWAQIMapBounds(
      focusCity.latitude - 0.35,
      focusCity.longitude - 0.35,
      focusCity.latitude + 0.35,
      focusCity.longitude + 0.35
    )
      .then((stations) => {
        if (isCancelled || !mapInstanceRef.current) return;
        stations.forEach((st) => {
          const prev = stationCacheRef.current.get(st.uid);
          stationCacheRef.current.set(st.uid, {
            ...st,
            pm25: prev?.pm25,
            pm25IaqiUS: prev?.pm25IaqiUS,
            pm25IaqiCN: prev?.pm25IaqiCN,
          });
        });

        const freshNearest = findNearestStationForCity(
          focusCity,
          Array.from(stationCacheRef.current.values())
        );
        nearestStationRef.current = freshNearest;
        syncFocusCityInfoRef.current(freshNearest, focusCity);
      })
      .catch((err) => {
        console.warn('[AirMap] Focus bounds lookup failed:', err);
      });

    return () => {
      isCancelled = true;
      focusAbort.abort();
    };
  }, [focusCity]);

  return (
    <div className="relative w-full h-full">
      <div
        ref={mapContainerRef}
        className="w-full h-full rounded-2xl overflow-hidden shadow-inner bg-slate-100"
        style={{ minHeight: '100%' }}
      />
    </div>
  );
}
