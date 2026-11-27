import { StandardType, ForecastDay, ProviderId } from '../types';
import { build24HourPointsFromWaqiObs, fetchWaqiHourlyDirect } from './waqi-decoder';
import { fetch5DayForecastMultiSource, getCityUtcOffsetMinutes } from '../datasources';
import { findCity } from '../constants/cities';

export interface HourlyTrendPoint {
  hour: string;
  fullTime?: string;
  timestampMs?: number; // Exact UTC epoch milliseconds for uniform browser-timezone formatting
  aqi: number;
  pm25: number;   // μg/m³
  pm10?: number;  // μg/m³
  o3: number;     // μg/m³
  no2?: number;   // μg/m³
  so2?: number;   // μg/m³
  co?: number;    // mg/m³
  iaqi?: {
    pm25?: number;
    pm10?: number;
    o3?: number;
    no2?: number;
    so2?: number;
    co?: number;
  };
  isReal?: boolean;
}

export interface HourlyTrendResult {
  points: HourlyTrendPoint[];
  isReal: boolean;
  source: string;
  providerId?: ProviderId;
  providerName?: string;
  timezoneOffset?: string;
  forecast?: ForecastDay[];
}

/**
 * 过去 24~72 小时逐小时走势分析（已接入多数据源网关）：
 * 1. 优先请求同源 Cloudflare Worker `/api/hourly-trend` 多源网关（自动路由和风/香港环保署/WAQI/OpenAQ/Google AQ）
 * 2. 若本地 dev 无 Worker 或未命中，平滑并行竞速 WAQI 官方逐小时时序流
 * 绝不注入虚构或 CAMS 数值模拟曲线冒充地面实测。
 */
export async function fetch24HourHourlyTrend(
  lat: number,
  lng: number,
  standard: StandardType = 'US',
  currentAQI = 65,
  currentPM25 = 32,
  currentO3 = 40,
  updateTime?: string,
  stationIdx?: number,
  options?: { cityId?: string; providerId?: ProviderId; stationRawId?: string }
): Promise<HourlyTrendResult> {
  void lat;
  void lng;
  void currentAQI;
  void currentPM25;
  void currentO3;
  void updateTime;

  // 通道 0：当存在非 WAQI 活跃数据源或已传 cityId 时，优先走 Worker 多源小时流接口 (/api/hourly-trend)
  if (typeof window !== 'undefined' && window.location.origin && options?.cityId) {
    try {
      const params = new URLSearchParams({
        city: options.cityId,
        standard,
      });
      if (options.providerId) params.set('provider', options.providerId);
      if (options.stationRawId) {
        params.set('station', options.stationRawId);
      } else if (stationIdx) {
        params.set('station', String(stationIdx));
      }

      const res = await fetch(`${window.location.origin}/api/hourly-trend?${params.toString()}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const json = (await res.json()) as HourlyTrendResult;
        if (json && json.isReal && Array.isArray(json.points) && json.points.length >= 3) {
          return json;
        }
      }
    } catch {
      // 无 Worker 或网络波动时回落 WAQI 双通道
    }
  }

  if (stationIdx) {
    const cityMeta = options?.cityId ? findCity(options.cityId) : undefined;
    const cityOffsetMin = getCityUtcOffsetMinutes(
      Date.now(),
      cityMeta?.country,
      cityMeta?.longitude ?? lng,
      cityMeta?.latitude ?? lat
    );
    const racers: Promise<HourlyTrendResult>[] = [];

    // 通道 1：同源 Cloudflare Worker 边缘缓存专线网关 (10分钟缓存)
    if (typeof window !== 'undefined' && window.location.origin) {
      racers.push(
        (async () => {
          const edgeRes = await fetch(`${window.location.origin}/api/waqi-hourly?idx=${stationIdx}`, {
            signal: AbortSignal.timeout(4500),
          });
          if (!edgeRes.ok) throw new Error(`Edge HTTP ${edgeRes.status}`);
          const waqiJson = await edgeRes.json();
          const obs = waqiJson?.rxs?.obs?.[0]?.msg?.obs;
          if (!obs || !obs.pm25) throw new Error('Empty edge obs');
          const edgePoints = build24HourPointsFromWaqiObs(obs, standard, cityOffsetMin);
          if (edgePoints.length < 3) throw new Error('Insufficient edge points');
          return {
            points: edgePoints,
            isReal: true,
            providerId: 'waqi',
            providerName: 'WAQI',
            source: 'WAQI 官方测站逐小时实测',
          };
        })()
      );
    }

    // 通道 2：前端直连 WAQI 官方底层双步鉴权与差分解码协议
    racers.push(
      (async () => {
        const directPoints = await fetchWaqiHourlyDirect(stationIdx, standard, cityOffsetMin);
        if (!directPoints || directPoints.length < 3) {
          throw new Error('Insufficient direct points');
        }
        return {
          points: directPoints,
          isReal: true,
          providerId: 'waqi',
          providerName: 'WAQI',
          source: 'WAQI 官方测站逐小时实测',
        };
      })()
    );

    try {
      return await Promise.any(racers);
    } catch {
      // 双通道均无有效小时流，诚实返回空数据
    }
  }

  return {
    points: [],
    isReal: false,
    source: '该站点暂无逐小时实测发布',
  };
}

/**
 * 获取未来 5 天大气质量预报（能力解耦独立链）：
 * 1. 优先请求同源 Worker `/api/forecast`（自动启用彩云 AI 预报 / Open-Meteo ECMWF/CAMS 等）
 * 2. 本地 dev 无 Worker 时自动直连 Open-Meteo ECMWF/CAMS（免 Key 永久可用）
 */
export async function fetch5DayForecast(lat: number, lng: number): Promise<ForecastDay[]> {
  if (typeof window !== 'undefined' && window.location.origin) {
    try {
      const res = await fetch(
        `${window.location.origin}/api/forecast?lat=${lat.toFixed(4)}&lon=${lng.toFixed(4)}`,
        { signal: AbortSignal.timeout(4500) }
      );
      if (res.ok) {
        const json = (await res.json()) as { list?: ForecastDay[] };
        if (Array.isArray(json?.list) && json.list.length > 0) {
          return json.list;
        }
      }
    } catch {
      // Fall back to direct Open-Meteo
    }
  }

  try {
    const res = await fetch5DayForecastMultiSource(lat, lng);
    return res.list;
  } catch {
    return [];
  }
}
