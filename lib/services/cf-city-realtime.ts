import { CITIES_REGISTRY, findCity } from '../constants/cities';
import type {
  AirQualityRecord,
  CityMeta,
  DataProvenance,
  FreshnessMeta,
  IAQIValues,
  PollutantValues,
} from '../types';
import {
  calculateCNIAQI,
  convertIAQIToConcentration,
  evaluateAQI,
  getUSEvaluation,
} from '../aqi-calculator';
import { iso1A2Code } from '@rapideditor/country-coder';
import {
  preferOfficialStations,
  StationCompositeSample,
} from './composite-aggregator';
import { DEFAULT_WAQI_TOKENS } from './cf-ranking-engine';
import {
  computeFreshness,
  extractUtcOffsetLabel,
  fetchCityRealtimeMultiSource,
  isSameSovereignCountry,
  parseObservedTimeMs,
  pruneStaleStations,
  RawEnvBag,
  resolveProviderSecrets,
  sortStationsByFreshnessAndDistance,
} from '../datasources';

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
  provenance?: DataProvenance;
  freshness?: FreshnessMeta;
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

export function parseWaqiStationResponse(
  data: any,
  cityMeta: CityMeta,
  nowMs = Date.now()
): AirQualityRecord {
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
    pm25:
      iaqiRaw.pm25?.v !== undefined
        ? convertIAQIToConcentration('pm25', iaqiRaw.pm25.v, 'US')
        : undefined,
    pm10:
      iaqiRaw.pm10?.v !== undefined
        ? convertIAQIToConcentration('pm10', iaqiRaw.pm10.v, 'US')
        : undefined,
    o3:
      iaqiRaw.o3?.v !== undefined
        ? convertIAQIToConcentration('o3', iaqiRaw.o3.v, 'US')
        : undefined,
    no2:
      iaqiRaw.no2?.v !== undefined
        ? convertIAQIToConcentration('no2', iaqiRaw.no2.v, 'US')
        : undefined,
    so2:
      iaqiRaw.so2?.v !== undefined
        ? convertIAQIToConcentration('so2', iaqiRaw.so2.v, 'US')
        : undefined,
    co:
      iaqiRaw.co?.v !== undefined
        ? convertIAQIToConcentration('co', iaqiRaw.co.v, 'US')
        : undefined,
  };

  const iaqiCN = calculateCNIAQI(pollutants);
  const geo = data.city?.geo || [cityMeta.latitude, cityMeta.longitude];
  const isNoLiveData = data.aqi === '-' || data.aqi === null || data.aqi === undefined;
  const obsMs = parseObservedTimeMs(data.time?.iso || data.time?.s, data.time?.tz);
  const tzLabel = extractUtcOffsetLabel(data.time?.tz || data.time?.iso);
  const freshness = computeFreshness(
    obsMs,
    nowMs,
    undefined,
    data.time?.iso || data.time?.s || undefined,
    tzLabel
  );
  const provenance: DataProvenance = {
    providerId: 'waqi',
    providerName: 'WAQI',
    tier: 'ground-official',
  };

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
    updateTime: data.time?.s || new Date(nowMs).toISOString(),
    pollutants,
    iaqi: iaqiUS,
    iaqiCN,
    iaqiUS,
    evaluationCN,
    evaluationUS,
    freshness,
    provenance,
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
 * 纯几何 Voronoi + 主权国家排他过滤（兼容港澳 HK/MO）+ 僵尸站剔除 + 新鲜度优先排序
 */
export function filterStationsEdge(
  rawStations: StationCompositeSample[],
  city: CityMeta,
  nowMs = Date.now()
): StationCompositeSample[] {
  const neighbors = CITIES_REGISTRY.filter(
    (c) =>
      c.id !== city.id &&
      getDistanceKm(c.latitude, c.longitude, city.latitude, city.longitude) <= 160
  );

  const kept: Array<{ st: StationCompositeSample; distKm: number; observedAtMs?: number }> = [];

  for (let i = 0; i < rawStations.length; i++) {
    const s = rawStations[i];
    if (typeof s.lat !== 'number' || typeof s.lon !== 'number') continue;
    const aqiNum = parseInt(s.aqi, 10);
    if (isNaN(aqiNum) || aqiNum <= 0 || aqiNum > 500) continue;

    const distToTarget = getDistanceKm(s.lat, s.lon, city.latitude, city.longitude);
    if (distToTarget > 35) continue;

    const stCountry = iso1A2Code([s.lon, s.lat]);
    if (!isSameSovereignCountry(stCountry, city.country)) continue;

    let nearerNeighbor = false;
    for (let j = 0; j < neighbors.length; j++) {
      const nb = neighbors[j];
      if (getDistanceKm(s.lat, s.lon, nb.latitude, nb.longitude) < distToTarget) {
        nearerNeighbor = true;
        break;
      }
    }
    if (!nearerNeighbor) {
      kept.push({
        st: s,
        distKm: distToTarget,
        observedAtMs: parseObservedTimeMs(s.station?.time) ?? undefined,
      });
    }
  }

  const officialOnly = preferOfficialStations(kept.map((k) => k.st));
  const officialSet = new Set(officialOnly);
  const officialEntries = kept.filter((k) => officialSet.has(k.st));
  const alive = pruneStaleStations(officialEntries, nowMs);
  const ranked = sortStationsByFreshnessAndDistance(alive);
  return ranked.map((k) => k.st);
}

/**
 * Cloudflare Worker 单城实况边缘加速聚合器（已升级为策略 A 多源无缝切源架构）：
 * - 按区域自动路由首选实测源（国内/港澳和风优先 / 北美与台湾 OpenAQ 优先 / 其余全球 WAQI 优先）
 * - 策略 A：主源延迟 > 90 分钟或离线时自动静默探测更鲜同等级备源并无缝替换
 * - 全程严守免费版 50 subrequests 硬红线，由外层 Edge Cache 缓存 5 分钟
 */
export async function fetchEdgeCityRealtimePayload(
  cityQuery: string,
  tokens: string[],
  fetchImpl: typeof fetch = fetch,
  rawEnv?: RawEnvBag
): Promise<EdgeCityRealtimeResult | null> {
  const city = findCity(cityQuery);
  if (!city) return null;

  const activeTokens = tokens.length > 0 ? tokens : [...DEFAULT_WAQI_TOKENS];
  // Never object-spread Cloudflare Worker `env` (bindings/secrets may be non-enumerable getters)
  const resolved = resolveProviderSecrets(rawEnv);
  const secrets = {
    ...resolved,
    waqiTokens: activeTokens.length > 0 ? activeTokens : resolved.waqiTokens,
  };

  return fetchCityRealtimeMultiSource(city, {
    secrets,
    fetchImpl,
    isServer: true,
    concurrency: EDGE_CONCURRENCY,
    maxStations: MAX_SAMPLED_STATIONS,
    timeoutMs: FETCH_TIMEOUT_MS,
  });
}
