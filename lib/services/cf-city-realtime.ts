import { CITIES_REGISTRY, findCity } from '../constants/cities';
import type { AirQualityRecord, CityMeta, IAQIValues, PollutantValues } from '../types';
import {
  calculateCNIAQI,
  convertIAQIToConcentration,
  evaluateAQI,
  getUSEvaluation,
} from '../aqi-calculator';
import { iso1A2Code } from '@rapideditor/country-coder';
import {
  aggregateCompositeRecord,
  extractStationMetricsFromIaqi,
  preferOfficialStations,
  StationCompositeSample,
} from './composite-aggregator';
import { DEFAULT_WAQI_TOKENS } from './cf-ranking-engine';

const EDGE_CONCURRENCY = 6; // 精确贴合 Cloudflare Workers 单调用 6 并发外连上限
const MAX_SAMPLED_STATIONS = 12; // 长尾冷查采样距市中心最近 12 个官方站（2 轮并发 ≈ 2.2s，<= 13 subrequests）
const FETCH_TIMEOUT_MS = 4500;

export interface EdgeCityRealtimeResult {
  success: boolean;
  cityId: string;
  baseRecord: AirQualityRecord;
  stations: StationCompositeSample[];
  compositeRecord: AirQualityRecord;
  totalOfficialStations: number;
  sampledStations: number;
  updatedAt: string;
}

function getDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function createTimeoutSignal(ms: number): AbortSignal | undefined {
  if (typeof AbortSignal !== 'undefined' && typeof (AbortSignal as any).timeout === 'function') {
    return (AbortSignal as any).timeout(ms);
  }
  return undefined;
}

export function parseWaqiStationResponse(data: any, cityMeta: CityMeta): AirQualityRecord {
  const iaqiRaw = data.iaqi || {};
  const iaqiUS: IAQIValues = {
    pm25: iaqiRaw.pm25?.v !== undefined ? Math.round(iaqiRaw.pm25.v) : undefined,
    pm10: iaqiRaw.pm10?.v !== undefined ? Math.round(iaqiRaw.pm10.v) : undefined,
    o3: iaqiRaw.o3?.v !== undefined ? Math.round(iaqiRaw.o3.v) : undefined,
    no2: iaqiRaw.no2?.v !== undefined ? Math.round(iaqiRaw.no2.v) : undefined,
    so2: iaqiRaw.so2?.v !== undefined ? Math.round(iaqiRaw.so2.v) : undefined,
    co: iaqiRaw.co?.v !== undefined ? Math.round(iaqiRaw.co.v) : undefined,
  };

  const pollutants: PollutantValues = {
    pm25: iaqiRaw.pm25?.v !== undefined ? convertIAQIToConcentration('pm25', iaqiRaw.pm25.v, 'US') : undefined,
    pm10: iaqiRaw.pm10?.v !== undefined ? convertIAQIToConcentration('pm10', iaqiRaw.pm10.v, 'US') : undefined,
    o3: iaqiRaw.o3?.v !== undefined ? convertIAQIToConcentration('o3', iaqiRaw.o3.v, 'US') : undefined,
    no2: iaqiRaw.no2?.v !== undefined ? convertIAQIToConcentration('no2', iaqiRaw.no2.v, 'US') : undefined,
    so2: iaqiRaw.so2?.v !== undefined ? convertIAQIToConcentration('so2', iaqiRaw.so2.v, 'US') : undefined,
    co: iaqiRaw.co?.v !== undefined ? convertIAQIToConcentration('co', iaqiRaw.co.v, 'US') : undefined,
  };

  const iaqiCN = calculateCNIAQI(pollutants);
  const geo = data.city?.geo || [cityMeta.latitude, cityMeta.longitude];
  const isNoLiveData = data.aqi === '-' || data.aqi === null || data.aqi === undefined;

  let evaluationCN = evaluateAQI(pollutants, 'CN');
  let evaluationUS = evaluateAQI(pollutants, 'US');

  if (isNoLiveData) {
    const lastAqiCN = evaluationCN.aqi || 0;
    const lastAqiUS = evaluationUS.aqi || 0;
    evaluationCN = {
      ...evaluationCN,
      aqi: lastAqiCN,
      level: lastAqiCN > 0 ? evaluationCN.level : '暂无数据',
      levelEn: lastAqiCN > 0 ? evaluationCN.levelEn : 'No Data',
      color: '#64748b',
      textColor: '#ffffff',
      isOffline: true,
    };
    evaluationUS = {
      ...evaluationUS,
      aqi: lastAqiUS,
      level: lastAqiUS > 0 ? evaluationUS.level : 'No Data',
      levelEn: lastAqiUS > 0 ? evaluationUS.levelEn : 'No Data',
      color: '#64748b',
      textColor: '#ffffff',
      isOffline: true,
    };
  } else if (evaluationUS.aqi === 0 && typeof data.aqi === 'number' && !isNaN(data.aqi)) {
    const officialAqi = Math.round(data.aqi);
    evaluationUS = getUSEvaluation(officialAqi, evaluationUS.primaryPollutant);
  }

  return {
    id: cityMeta.id,
    name: cityMeta.nameZh,
    nameEn: cityMeta.nameEn,
    country: cityMeta.country,
    isDomestic: Boolean(cityMeta.isDomestic),
    isOffline: isNoLiveData,
    stationIdx: typeof data.idx === 'number' ? data.idx : undefined,
    latitude: geo[0] || cityMeta.latitude,
    longitude: geo[1] || cityMeta.longitude,
    updateTime: data.time?.s || new Date().toISOString(),
    pollutants,
    iaqi: iaqiUS,
    iaqiCN,
    iaqiUS,
    evaluationCN,
    evaluationUS,
    weather: {
      temp: iaqiRaw.t?.v,
      humidity: iaqiRaw.h?.v,
      windSpeed: iaqiRaw.w?.v,
      pressure: iaqiRaw.p?.v,
    },
    forecast: data.forecast?.daily
      ? {
          pm25: (data.forecast.daily.pm25 || []).map((f: any) => ({
            day: f.day,
            min: typeof f.min === 'number' ? convertIAQIToConcentration('pm25', f.min, 'US') : 0,
            max: typeof f.max === 'number' ? convertIAQIToConcentration('pm25', f.max, 'US') : 0,
            avg: typeof f.avg === 'number' ? convertIAQIToConcentration('pm25', f.avg, 'US') : 0,
          })),
          pm10: data.forecast.daily.pm10 || [],
          o3: data.forecast.daily.o3 || [],
          uvi: data.forecast.daily.uvi || [],
        }
      : undefined,
  };
}

/**
 * 纯几何 Voronoi + 主权国家排他过滤（先做 35km 物理粗筛再查 country-coder，将 CPU 压至 < 2ms）
 */
export function filterStationsEdge(rawStations: StationCompositeSample[], city: CityMeta): StationCompositeSample[] {
  const neighbors = CITIES_REGISTRY.filter(
    (c) => c.id !== city.id && getDistanceKm(c.latitude, c.longitude, city.latitude, city.longitude) <= 160
  );

  const kept: Array<{ st: StationCompositeSample; distKm: number }> = [];

  for (let i = 0; i < rawStations.length; i++) {
    const s = rawStations[i];
    if (typeof s.lat !== 'number' || typeof s.lon !== 'number') continue;
    const aqiNum = parseInt(s.aqi, 10);
    if (isNaN(aqiNum) || aqiNum <= 0 || aqiNum > 500) continue;

    const distToTarget = getDistanceKm(s.lat, s.lon, city.latitude, city.longitude);
    if (distToTarget > 35) continue;

    const stCountry = iso1A2Code([s.lon, s.lat]);
    if (stCountry && city.country && city.country !== stCountry) continue;

    let nearerNeighbor = false;
    for (let j = 0; j < neighbors.length; j++) {
      const nb = neighbors[j];
      if (getDistanceKm(s.lat, s.lon, nb.latitude, nb.longitude) < distToTarget) {
        nearerNeighbor = true;
        break;
      }
    }
    if (!nearerNeighbor) {
      kept.push({ st: s, distKm: distToTarget });
    }
  }

  kept.sort((a, b) => a.distKm - b.distKm);
  return preferOfficialStations(kept.map((k) => k.st));
}

/**
 * Cloudflare Worker 单城实况边缘加速聚合器：
 * - Wave 1：1 次 map/bounds 获取城市全部在册官方监测站（严格剔除民间负 uid 微感器）
 * - Wave 2：6 并发 + 5-Token 轮询拉取距市中心最近的最多 20 个官方站完整 6 项污染物 + 4 项气象
 * - 零 KV 消耗，全程 <= 21 subrequests（严守免费版 50 上限），由外层 Edge Cache 缓存 3 分钟实现 <100ms 秒开
 */
export async function fetchEdgeCityRealtimePayload(
  cityQuery: string,
  tokens: string[],
  fetchImpl: typeof fetch = fetch
): Promise<EdgeCityRealtimeResult | null> {
  const city = findCity(cityQuery);
  if (!city) return null;

  const activeTokens = tokens.length > 0 ? tokens : [...DEFAULT_WAQI_TOKENS];
  let tokenIdx = 0;
  const nextToken = () => activeTokens[tokenIdx++ % activeTokens.length];

  // Wave 1: 单次 bounds 请求
  const minLat = (city.latitude - 0.35).toFixed(4);
  const minLon = (city.longitude - 0.35).toFixed(4);
  const maxLat = (city.latitude + 0.35).toFixed(4);
  const maxLon = (city.longitude + 0.35).toFixed(4);
  const boundsUrl = `https://api.waqi.info/v2/map/bounds?latlng=${minLat},${minLon},${maxLat},${maxLon}&token=${nextToken()}`;

  let stations: StationCompositeSample[] = [];
  try {
    const res = await fetchImpl(boundsUrl, { signal: createTimeoutSignal(FETCH_TIMEOUT_MS) });
    if (res.ok) {
      const json = (await res.json()) as any;
      if (json?.status === 'ok' && Array.isArray(json.data)) {
        stations = filterStationsEdge(json.data, city);
      }
    }
  } catch {
    stations = [];
  }

  // 若无活跃站，回落官方 slug 检查离线状态
  if (stations.length === 0) {
    const slug = city.waqiSlug || city.nameEn.toLowerCase();
    try {
      const res = await fetchImpl(
        `https://api.waqi.info/feed/${encodeURIComponent(slug)}/?token=${nextToken()}`,
        { signal: createTimeoutSignal(FETCH_TIMEOUT_MS) }
      );
      if (!res.ok) return null;
      const json = (await res.json()) as any;
      if (json?.status !== 'ok' || !json.data) return null;
      const baseRecord = parseWaqiStationResponse(json.data, city);
      return {
        success: true,
        cityId: city.id,
        baseRecord,
        stations: [],
        compositeRecord: baseRecord,
        totalOfficialStations: 0,
        sampledStations: 0,
        updatedAt: new Date().toISOString(),
      };
    } catch {
      return null;
    }
  }

  // Wave 2: 最多拉取距市中心最近 20 个官方站完整详情（6 并发，5-Token 轮询）
  const sampleCount = Math.min(stations.length, MAX_SAMPLED_STATIONS);
  const enriched: StationCompositeSample[] = [...stations];
  let baseRecord: AirQualityRecord | null = null;
  let cursor = 0;

  const worker = async () => {
    while (cursor < sampleCount) {
      const idx = cursor++;
      const st = stations[idx];
      try {
        const url = `https://api.waqi.info/feed/@${st.uid}/?token=${nextToken()}`;
        const res = await fetchImpl(url, { signal: createTimeoutSignal(FETCH_TIMEOUT_MS) });
        if (!res.ok) continue;
        const json = (await res.json()) as any;
        if (json?.status !== 'ok' || !json.data) continue;

        const metrics = extractStationMetricsFromIaqi(json.data.iaqi);
        enriched[idx] = {
          ...st,
          pm25: metrics.pm25,
          pm25IaqiUS: metrics.pm25IaqiUS,
          pm25IaqiCN: metrics.pm25IaqiCN,
          pollutants: metrics.pollutants,
          weather: metrics.weather,
        };

        if (idx === 0) {
          baseRecord = parseWaqiStationResponse(json.data, city);
        }
      } catch {
        // 单站超时或异常静默跳过，避免拖慢整城响应
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(EDGE_CONCURRENCY, sampleCount) }, () => worker()));

  // 若 stations[0] 偶发超时，降级取第一个成功返回详情的官方站作为基准元数据
  if (!baseRecord) {
    const fallbackIdx = enriched.findIndex((s) => s.pollutants && (s.pollutants.pm25 || s.pollutants.pm10));
    if (fallbackIdx < 0) return null;
    const fb = enriched[fallbackIdx];
    const pollutants = fb.pollutants || {};
    const iaqiCN = calculateCNIAQI(pollutants);
    baseRecord = {
      id: city.id,
      name: city.nameZh,
      nameEn: city.nameEn,
      country: city.country,
      isDomestic: Boolean(city.isDomestic),
      stationIdx: fb.uid,
      latitude: fb.lat,
      longitude: fb.lon,
      updateTime: fb.station?.time || new Date().toISOString(),
      pollutants,
      iaqi: iaqiCN,
      iaqiCN,
      evaluationCN: evaluateAQI(pollutants, 'CN'),
      evaluationUS: evaluateAQI(pollutants, 'US'),
      weather: fb.weather,
    };
  }

  const compositeRecord = aggregateCompositeRecord(baseRecord, enriched, city, 'CN', false);

  return {
    success: true,
    cityId: city.id,
    baseRecord,
    stations: enriched,
    compositeRecord,
    totalOfficialStations: stations.length,
    sampledStations: compositeRecord.compositeStationCount || sampleCount,
    updatedAt: new Date().toISOString(),
  };
}
