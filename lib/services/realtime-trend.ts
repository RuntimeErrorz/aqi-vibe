import { StandardType, ForecastDay } from '../types';
import { build24HourPointsFromWaqiObs, fetchWaqiHourlyDirect } from './waqi-decoder';

export interface HourlyTrendPoint {
  hour: string;
  fullTime?: string;
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
  forecast?: ForecastDay[];
}

/**
 * 过去 24~72 小时逐小时走势分析：
 * 100% 直连 WAQI 官方底层折线图时序流（差分解码），无任何 CAMS 或虚构模拟数据兜底。
 */
export async function fetch24HourHourlyTrend(
  lat: number,
  lng: number,
  standard: StandardType = 'US',
  currentAQI = 65,
  currentPM25 = 32,
  currentO3 = 40,
  updateTime?: string,
  stationIdx?: number
): Promise<HourlyTrendResult> {
  void lat;
  void lng;
  void currentAQI;
  void currentPM25;
  void currentO3;
  void updateTime;

  if (stationIdx) {
    const racers: Promise<HourlyTrendResult>[] = [];

    // 通道 1：同源 Cloudflare Worker 边缘缓存专线网关 (10分钟缓存，低延迟且绕开前端 CORS/直连慢节点)
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
          const edgePoints = build24HourPointsFromWaqiObs(obs, standard);
          if (edgePoints.length < 3) throw new Error('Insufficient edge points');
          return {
            points: edgePoints,
            isReal: true,
            source: '官方测站逐小时实测',
          };
        })()
      );
    }

    // 通道 2：前端直连 WAQI 官方底层双步鉴权与差分解码协议（与通道 1 并行竞速，谁先返回有效实测即采用谁）
    racers.push(
      (async () => {
        const directPoints = await fetchWaqiHourlyDirect(stationIdx, standard);
        if (!directPoints || directPoints.length < 3) {
          throw new Error('Insufficient direct points');
        }
        return {
          points: directPoints,
          isReal: true,
          source: '官方测站逐小时实测',
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
    source: '该站点暂无 WAQI 逐小时实测发布',
  };
}

/**
 * 获取未来 5 天基于 ECMWF / CAMS（欧洲中期天气预报中心数值扩散模型）的大气质量预报
 */
export async function fetch5DayForecast(lat: number, lng: number): Promise<ForecastDay[]> {
  try {
    const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lng}&hourly=pm2_5&forecast_days=6&timezone=auto`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4500) });
    if (!res.ok) return [];
    const data = await res.json();
    const times: string[] = data?.hourly?.time || [];
    const pm25Arr: (number | null)[] = data?.hourly?.pm2_5 || [];

    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const todayStr = `${y}-${m}-${d}`;

    const forecastMap: Record<string, number[]> = {};
    for (let i = 0; i < times.length; i++) {
      const dayStr = times[i].slice(0, 10);
      if (dayStr >= todayStr && pm25Arr[i] != null && !isNaN(pm25Arr[i]!)) {
        if (!forecastMap[dayStr]) forecastMap[dayStr] = [];
        forecastMap[dayStr].push(pm25Arr[i]!);
      }
    }

    return Object.entries(forecastMap).slice(0, 5).map(([day, vals]) => {
      const min = Math.round(Math.min(...vals));
      const max = Math.round(Math.max(...vals));
      const avg = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
      return { day, min, max, avg };
    });
  } catch {
    return [];
  }
}
