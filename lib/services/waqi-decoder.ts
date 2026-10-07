import { HourlyTrendPoint } from './history-data';
import { StandardType } from '../types';
import { evaluateAQI, convertIAQIToConcentration, calculateCNIAQI } from '../aqi-calculator';

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
 * 注意：WAQI obs 序列解码后的数值原生为【美标 (US EPA NowCast) IAQI 分指数】
 * 严禁将其误当做微克质量浓度二次带入 evaluateAQI，否则会导致 72 被二次放大为 159！
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

  // 提取过去最多 72 个小时（3天）的实测点位，支持前端 24h / 48h / 72h 灵活回溯
  const seriesToProcess = pm25Series.slice(-72);

  // 构建时间戳映射表
  const o3Map = new Map(o3Series.map((s) => [s.timestamp, s.value]));
  const pm10Map = new Map(pm10Series.map((s) => [s.timestamp, s.value]));
  const no2Map = new Map(no2Series.map((s) => [s.timestamp, s.value]));
  const so2Map = new Map(so2Series.map((s) => [s.timestamp, s.value]));
  const coMap = new Map(coSeries.map((s) => [s.timestamp, s.value]));

  return seriesToProcess.map((pt) => {
    const d = new Date(pt.timestamp);
    const hourLabel = String(d.getHours()).padStart(2, '0') + ':00';
    const dayLabel = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const fullTimeLabel = `${dayLabel} ${hourLabel}`;
    
    // WAQI 解码出来的数值是原生美标 IAQI 分指数
    const usIaqiPm25 = Math.round(pt.value);
    const usIaqiO3 = Math.round(o3Map.get(pt.timestamp) ?? 0);
    const rawPm10 = pm10Map.get(pt.timestamp);
    const rawNo2 = no2Map.get(pt.timestamp);
    const rawSo2 = so2Map.get(pt.timestamp);
    const rawCo = coMap.get(pt.timestamp);

    const usIaqiPm10 = rawPm10 !== undefined && rawPm10 > 0 ? Math.round(rawPm10) : undefined;
    const usIaqiNo2 = rawNo2 !== undefined && rawNo2 > 0 ? Math.round(rawNo2) : undefined;
    const usIaqiSo2 = rawSo2 !== undefined && rawSo2 > 0 ? Math.round(rawSo2) : undefined;
    const usIaqiCo = rawCo !== undefined && rawCo > 0 ? Math.round(rawCo) : undefined;

    // 将美标 IAQI 逆运算还原为客观物理质量浓度 (PM2.5/PM10/O3/NO2/SO2 为 μg/m³，CO 为 mg/m³)
    const concPm25 = convertIAQIToConcentration('pm25', usIaqiPm25, 'US');
    const concO3 = convertIAQIToConcentration('o3', usIaqiO3, 'US');
    const concPm10 = usIaqiPm10 !== undefined ? convertIAQIToConcentration('pm10', usIaqiPm10, 'US') : undefined;
    const concNo2 = usIaqiNo2 !== undefined ? convertIAQIToConcentration('no2', usIaqiNo2, 'US') : undefined;
    const concSo2 = usIaqiSo2 !== undefined ? convertIAQIToConcentration('so2', usIaqiSo2, 'US') : undefined;
    const concCo = usIaqiCo !== undefined ? convertIAQIToConcentration('co', usIaqiCo, 'US') : undefined;

    let aqiVal: number;
    let iaqiResult: { pm25?: number; pm10?: number; o3?: number; no2?: number; so2?: number; co?: number };

    if (standard === 'US') {
      // 1. 美标体系 (WAQI 官方原生):
      // 总 AQI 等于各项美标分指数的最大值：AQI = max(IAQI_pm25, IAQI_o3, ...)
      const iaqiList = [usIaqiPm25, usIaqiO3, usIaqiPm10, usIaqiNo2, usIaqiSo2, usIaqiCo].filter(
        (v): v is number => typeof v === 'number' && !isNaN(v)
      );
      aqiVal = Math.max(...iaqiList);
      iaqiResult = {
        pm25: usIaqiPm25,
        pm10: usIaqiPm10,
        o3: usIaqiO3,
        no2: usIaqiNo2,
        so2: usIaqiSo2,
        co: usIaqiCo,
      };
    } else {
      // 2. 中国国标体系 (HJ 633-2012):
      // 基于客观物理质量浓度严格计算国标分指数与总 AQI
      const evalCN = evaluateAQI(
        {
          pm25: concPm25 > 0 ? concPm25 : undefined,
          pm10: concPm10 && concPm10 > 0 ? concPm10 : undefined,
          o3: concO3 > 0 ? concO3 : undefined,
          no2: concNo2 && concNo2 > 0 ? concNo2 : undefined,
          so2: concSo2 && concSo2 > 0 ? concSo2 : undefined,
          co: concCo && concCo > 0 ? concCo : undefined,
        },
        'CN'
      );
      aqiVal = evalCN.aqi;
      iaqiResult = calculateCNIAQI({
        pm25: concPm25,
        pm10: concPm10,
        o3: concO3,
        no2: concNo2,
        so2: concSo2,
        co: concCo,
      });
    }

    return {
      hour: hourLabel,
      fullTime: fullTimeLabel,
      aqi: aqiVal,
      // 客观物理质量浓度（微克 μg/m³，CO 为 mg/m³）
      pm25: concPm25,
      pm10: concPm10,
      o3: concO3,
      no2: concNo2,
      so2: concSo2,
      co: concCo,
      iaqi: iaqiResult,
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
    return points.length >= 3 ? points : (points.length > 0 ? points : null);
  } catch (err) {
    console.warn('Failed to fetch/decode WAQI hourly directly:', err);
    return null;
  }
}
