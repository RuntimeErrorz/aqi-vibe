import type {
  AirQualityRecord,
  CityMeta,
  PollutantValues,
  StandardType,
  WeatherInfo,
} from '../types';
import {
  calculateCNIAQI,
  calculatePM25AQI,
  calculateUSIAQI,
  convertIAQIToConcentration,
  evaluateAQI,
} from '../aqi-calculator';
import { filterSpatialOutliersByValue, getDistanceKm } from '../utils/common';

export interface StationCompositeSample {
  uid: number;
  providerId?: string;
  lat: number;
  lon: number;
  aqi: string;
  station: {
    name: string;
    time: string;
  };
  pm25?: number;
  pm25IaqiUS?: number;
  pm25IaqiCN?: number;
  pollutants?: PollutantValues;
  weather?: WeatherInfo;
}

/**
 * 官方监测站优先过滤：
 * 在 WAQI 体系中 uid > 0 为政府环保署参考站，uid < 0 为民间廉价微感器（仅含 PM2.5/PM10 且常漂移）。
 * 只要同城存在官方正 uid 监测站，严格只采用官方参考站；仅当偏远地区全城无官方站时回退使用微感器。
 */
export function preferOfficialStations<T extends { uid: number }>(stations: T[]): T[] {
  const official = stations.filter((s) => s.uid > 0);
  return official.length > 0 ? official : stations;
}

/**
 * 从 WAQI 单站原始 iaqi 对象提取完整 6 项物理污染物浓度 + 4 项气象指标
 */
export function extractStationMetricsFromIaqi(iaqiRaw: Record<string, { v?: number } | undefined> | undefined): {
  pollutants: PollutantValues;
  weather: WeatherInfo;
  pm25?: number;
  pm25IaqiUS?: number;
  pm25IaqiCN?: number;
} {
  const raw = iaqiRaw || {};
  const toConc = (key: keyof PollutantValues) => {
    const v = raw[key]?.v;
    if (v === undefined || v === null || isNaN(v)) return undefined;
    return convertIAQIToConcentration(key, v, 'US');
  };

  const pollutants: PollutantValues = {
    pm25: toConc('pm25'),
    pm10: toConc('pm10'),
    o3: toConc('o3'),
    no2: toConc('no2'),
    so2: toConc('so2'),
    co: toConc('co'),
  };

  const numOrUndef = (v: unknown, decimals = 1): number | undefined => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
    const f = Math.pow(10, decimals);
    return Math.round(v * f) / f;
  };

  const weather: WeatherInfo = {
    temp: numOrUndef(raw.t?.v, 1),
    humidity: numOrUndef(raw.h?.v, 0),
    windSpeed: numOrUndef(raw.w?.v, 1),
    pressure: numOrUndef(raw.p?.v, 1),
  };

  const pm25IaqiUS =
    typeof raw.pm25?.v === 'number' && !isNaN(raw.pm25.v) ? Math.round(raw.pm25.v) : undefined;
  const pm25 = pollutants.pm25;
  const pm25IaqiCN =
    pm25 !== undefined && pm25 > 0 ? calculatePM25AQI(pm25, 'CN') : undefined;

  return { pollutants, weather, pm25, pm25IaqiUS, pm25IaqiCN };
}

function averagePositive(values: Array<number | undefined>, decimals = 1): number | undefined {
  const valid = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0);
  if (valid.length === 0) return undefined;
  const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
  const factor = Math.pow(10, decimals);
  return Math.round(mean * factor) / factor;
}

function averageFinite(values: Array<number | undefined>, decimals = 1): number | undefined {
  const valid = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (valid.length === 0) return undefined;
  const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
  const factor = Math.pow(10, decimals);
  return Math.round(mean * factor) / factor;
}

/**
 * 全城多站全项均值聚合器（单一事实源 SSOT）：
 * - 对已采样的全部有效站点分别计算 PM2.5 / PM10 / O3 / NO2 / SO2 / CO 空间算术均值（缺项跳过、绝不填 0）
 * - 对气温 / 湿度 / 风速 / 气压同样做多站空间均值，彻底消除因单站缺某项导致全城显示 `--` 的问题
 */
export function aggregateCompositeRecord(
  baseRecord: AirQualityRecord,
  stations: StationCompositeSample[],
  targetCity: CityMeta,
  standard: StandardType = 'CN',
  onlyPm25 = false
): AirQualityRecord {
  // 若 stations 携带了 providerId（例如和风主卡片附带 WAQI 辅助子站列表），严格只聚合与主源同源的站点，绝不让旧源子站污染最新主卡片
  const baseProviderId = baseRecord.provenance?.providerId;
  const sameSourceStations = baseProviderId
    ? stations.filter((s) => !s.providerId || s.providerId === baseProviderId)
    : stations;
  const pool = filterSpatialOutliersByValue(
    preferOfficialStations(sameSourceStations),
    (s) => s.pollutants?.pm25 ?? s.pm25
  );

  const pollutants: PollutantValues = {
    pm25:
      averagePositive(pool.map((s) => s.pollutants?.pm25 ?? s.pm25), 1) ??
      baseRecord.pollutants.pm25,
    pm10:
      averagePositive(pool.map((s) => s.pollutants?.pm10), 1) ??
      baseRecord.pollutants.pm10,
    o3:
      averagePositive(pool.map((s) => s.pollutants?.o3), 1) ??
      baseRecord.pollutants.o3,
    no2:
      averagePositive(pool.map((s) => s.pollutants?.no2), 1) ??
      baseRecord.pollutants.no2,
    so2:
      averagePositive(pool.map((s) => s.pollutants?.so2), 1) ??
      baseRecord.pollutants.so2,
    co:
      averagePositive(pool.map((s) => s.pollutants?.co), 2) ??
      baseRecord.pollutants.co,
  };

  const weather: WeatherInfo = {
    temp: averageFinite(pool.map((s) => s.weather?.temp), 1) ?? baseRecord.weather?.temp,
    humidity: averageFinite(pool.map((s) => s.weather?.humidity), 0) ?? baseRecord.weather?.humidity,
    windSpeed: averageFinite(pool.map((s) => s.weather?.windSpeed), 1) ?? baseRecord.weather?.windSpeed,
    pressure: averageFinite(pool.map((s) => s.weather?.pressure), 1) ?? baseRecord.weather?.pressure,
  };

  let evalCN = evaluateAQI(pollutants, 'CN', onlyPm25);
  let evalUS = evaluateAQI(pollutants, 'US', onlyPm25);
  const iaqiCN = calculateCNIAQI(pollutants);
  const iaqiUS = calculateUSIAQI(pollutants);

  const sampledStations = pool.filter(
    (s) =>
      (s.pollutants?.pm25 !== undefined && s.pollutants.pm25 > 0) ||
      (s.pm25 !== undefined && s.pm25 > 0) ||
      (s.pollutants?.pm10 !== undefined && s.pollutants.pm10 > 0) ||
      (s.pollutants?.o3 !== undefined && s.pollutants.o3 > 0)
  );

  // AGENTS.md §9.1: 若全城无活跃实测站且基准站已标记离线，严格保留离线灰色降级语义
  const isOffline = Boolean(baseRecord.isOffline && sampledStations.length === 0);
  if (isOffline) {
    evalCN = {
      ...evalCN,
      color: '#64748b',
      textColor: '#ffffff',
      isOffline: true,
    };
    evalUS = {
      ...evalUS,
      color: '#64748b',
      textColor: '#ffffff',
      isOffline: true,
    };
  }

  let compositeCentroid: [number, number] = [targetCity.latitude, targetCity.longitude];
  const centroidPool = sampledStations.length >= 2 ? sampledStations : pool;
  if (centroidPool.length >= 2) {
    const avgLat = centroidPool.reduce((sum, s) => sum + s.lat, 0) / centroidPool.length;
    const avgLon = centroidPool.reduce((sum, s) => sum + s.lon, 0) / centroidPool.length;
    if (getDistanceKm(avgLat, avgLon, targetCity.latitude, targetCity.longitude) <= 15) {
      compositeCentroid = [avgLat, avgLon];
    }
  }

  return {
    ...baseRecord,
    country: baseRecord.country || targetCity.country || 'CN',
    id: `${targetCity.id}-composite`,
    name: targetCity.nameZh,
    nameEn: targetCity.nameEn,
    isOffline,
    pollutants,
    weather,
    iaqi: standard === 'CN' ? iaqiCN : iaqiUS,
    iaqiCN,
    iaqiUS,
    evaluationUS: evalUS,
    evaluationCN: evalCN,
    compositeStationCount: isOffline ? 0 : (sampledStations.length || pool.length || 1),
    compositeCentroid,
  };
}
