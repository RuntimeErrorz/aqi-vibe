import { HourlyTrendPoint } from './history-data';
import { StandardType } from '../types';
import { evaluateAQI } from '../aqi-calculator';

export interface WaqiObsSeries {
  e?: number;
  s: string; // 基准时间，如 "2026-10-07 15:00:00"
  d?: number; // 步长秒数，通常 3600
  m?: number; // 刻度除数 (PM2.5/PM10 为 1，SO2/气温为 10)
  v: (number | [number, number])[];
}

/**
 * WAQI 官方前端折线图底层差分解码算法 (反编译自 aqicn.org bundle.min.js AqiGraphFactory)
 */
export function decodeWaqiObsSeries(obsItem?: WaqiObsSeries): { timestamp: number; value: number }[] {
  if (!obsItem || !obsItem.s || !Array.isArray(obsItem.v)) return [];
  const o = 1000 * (obsItem.d || 3600);
  const startTime = new Date(obsItem.s.replace(/\//g, '-').replace(' ', 'T')).getTime();
  const u = obsItem.m || 1;

  let l = startTime;
  const c: { t: number; v: number }[] = [];

  obsItem.v.forEach((e, idx) => {
    if (idx === 0 && typeof e === 'number') {
      c.push({ t: l, v: e });
    } else if (Array.isArray(e)) {
      l += 1000 * e[1];
      c.push({ t: l, v: e[0] });
    } else if (typeof e === 'number') {
      l -= o;
      c.push({ t: l, v: e });
    }
  });

  let d = 0;
  c.forEach((t) => {
    t.v += d;
    d = t.v;
    t.v /= u;
  });

  c.sort((a, b) => a.t - b.t);

  return c.map((t) => ({
    timestamp: t.t,
    value: Math.round(t.v * 10) / 10,
  }));
}

/**
 * 基于反编译出的 WAQI 官方底层实测流，解码提取过去 24 小时的真实逐小时数据
 */
export function build24HourPointsFromWaqiObs(
  obs: Record<string, WaqiObsSeries>,
  standard: StandardType
): HourlyTrendPoint[] {
  if (!obs || !obs.pm25) return [];

  const pm25Series = decodeWaqiObsSeries(obs.pm25);
  const o3Series = decodeWaqiObsSeries(obs.o3);
  const pm10Series = decodeWaqiObsSeries(obs.pm10);
  const no2Series = decodeWaqiObsSeries(obs.no2);
  const so2Series = decodeWaqiObsSeries(obs.so2);
  const coSeries = decodeWaqiObsSeries(obs.co);

  if (pm25Series.length === 0) return [];

  // 截取过去 24 个小时
  const last24 = pm25Series.slice(-24);

  // 构建时间戳映射表
  const o3Map = new Map(o3Series.map((s) => [s.timestamp, s.value]));
  const pm10Map = new Map(pm10Series.map((s) => [s.timestamp, s.value]));
  const no2Map = new Map(no2Series.map((s) => [s.timestamp, s.value]));
  const so2Map = new Map(so2Series.map((s) => [s.timestamp, s.value]));
  const coMap = new Map(coSeries.map((s) => [s.timestamp, s.value]));

  return last24.map((pt) => {
    const d = new Date(pt.timestamp);
    const hourLabel = String(d.getHours()).padStart(2, '0') + ':00';
    const p25 = pt.value;
    const ozone = o3Map.get(pt.timestamp) ?? 0;
    const p10 = pm10Map.get(pt.timestamp) ?? 0;
    const n2 = no2Map.get(pt.timestamp) ?? 0;
    const s2 = so2Map.get(pt.timestamp) ?? 0;
    const coVal = coMap.get(pt.timestamp) ?? 0.5;

    const evalRes = evaluateAQI(
      {
        pm25: p25 > 0 ? p25 : undefined,
        pm10: p10 > 0 ? p10 : undefined,
        o3: ozone > 0 ? ozone : undefined,
        no2: n2 > 0 ? n2 : undefined,
        so2: s2 > 0 ? s2 : undefined,
        co: coVal > 0 ? coVal : undefined,
      },
      standard
    );

    return {
      hour: hourLabel,
      aqi: evalRes.aqi,
      pm25: Math.round(p25),
      o3: Math.round(ozone),
      isReal: true,
    };
  });
}

/**
 * 从 WAQI 官方底层接口直接获取并解码过去 24 小时的真实逐小时实测
 * 反编译自 aqicn.org bundle.min.js 底层通信协议：
 * 1. 动态生成 uid 向 https://api2.waqi.info/api/token/${stationIdx} 请求会话 Token
 * 2. 携带 token 向 https://api2.waqi.info/api/feed/@${stationIdx}/aqi.json POST 请求包含 obs 差分序列的真实时序
 * 3. 运行前缀和累加差分解码算法，100% 还原物理实测
 */
export async function fetchWaqiHourlyDirect(
  stationIdx: number,
  standard: StandardType
): Promise<HourlyTrendPoint[] | null> {
  try {
    const uid = 'u' + Date.now();
    const tokenRes = await fetch(`https://api2.waqi.info/api/token/${stationIdx}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `key=-&uid=${uid}`,
      signal: AbortSignal.timeout(5000),
    });

    if (!tokenRes.ok) return null;
    const tokenJson = await tokenRes.json();
    const token = tokenJson?.rxs?.obs?.[0]?.msg?.token;
    if (!token) return null;

    const feedUid = 'f' + Date.now();
    const feedRes = await fetch(`https://api2.waqi.info/api/feed/@${stationIdx}/aqi.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `key=-&token=${token}&uid=${feedUid}&rqc=2`,
      signal: AbortSignal.timeout(6000),
    });

    if (!feedRes.ok) return null;
    const feedJson = await feedRes.json();
    const obs = feedJson?.rxs?.obs?.[0]?.msg?.obs;
    if (!obs || !obs.pm25) return null;

    const points = build24HourPointsFromWaqiObs(obs, standard);
    return points.length >= 12 ? points : null;
  } catch (err) {
    console.warn('Failed to fetch/decode WAQI hourly directly:', err);
    return null;
  }
}
