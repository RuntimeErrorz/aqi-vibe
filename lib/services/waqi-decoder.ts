import { HourlyTrendPoint } from './realtime-trend';
import { StandardType } from '../types';
import { convertIAQIToConcentration, calculateCNIAQI } from '../aqi-calculator';
import { createTimeoutSignal } from '../datasources/units';

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
  // Parse wall-clock string strictly in UTC calendar space so Worker (TZ=UTC) and browsers in any
  // timezone/DST spring-forward hour never shift or corrupt WAQI's city-local hourly timestamps.
  const m = obsItem.s.trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  const startTime = m
    ? Date.UTC(
        Number(m[1]),
        Number(m[2]) - 1,
        Number(m[3]),
        Number(m[4]),
        Number(m[5]),
        Number(m[6] || 0)
      )
    : new Date(obsItem.s.replace(/\//g, '-').replace(' ', 'T')).getTime();
  if (!Number.isFinite(startTime)) return [];
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
  standard: StandardType,
  cityUtcOffsetMinutes?: number
): HourlyTrendPoint[] {
  if (!obs) return [];

  const pm25Series = decodeWaqiObsSeries(obs.pm25);
  const o3Series = decodeWaqiObsSeries(obs.o3);
  const pm10Series = decodeWaqiObsSeries(obs.pm10);
  const no2Series = decodeWaqiObsSeries(obs.no2);
  const so2Series = decodeWaqiObsSeries(obs.so2);
  const coSeries = decodeWaqiObsSeries(obs.co);

  // 兼容仅发布 PM10 / O3 / NO2 而无 PM2.5 的欧美/日本监测站：以 PM2.5 为主轴，缺失时回落其余有效序列的合并时间轴
  const allTimestamps =
    pm25Series.length > 0
      ? pm25Series.map((s) => s.timestamp)
      : Array.from(
          new Set([
            ...pm10Series.map((s) => s.timestamp),
            ...o3Series.map((s) => s.timestamp),
            ...no2Series.map((s) => s.timestamp),
            ...so2Series.map((s) => s.timestamp),
            ...coSeries.map((s) => s.timestamp),
          ])
        ).sort((a, b) => a - b);

  if (allTimestamps.length === 0) return [];

  // 提取过去最多 72 个小时（3天）的实测点位，支持前端 24h / 48h / 72h 灵活回溯
  const timestampsToProcess = allTimestamps.slice(-72);

  // 构建时间戳映射表
  const pm25Map = new Map(pm25Series.map((s) => [s.timestamp, s.value]));
  const o3Map = new Map(o3Series.map((s) => [s.timestamp, s.value]));
  const pm10Map = new Map(pm10Series.map((s) => [s.timestamp, s.value]));
  const no2Map = new Map(no2Series.map((s) => [s.timestamp, s.value]));
  const so2Map = new Map(so2Series.map((s) => [s.timestamp, s.value]));
  const coMap = new Map(coSeries.map((s) => [s.timestamp, s.value]));

  const points: HourlyTrendPoint[] = [];

  for (const ts of timestampsToProcess) {
    const d = new Date(ts);
    const hourLabel = String(d.getUTCHours()).padStart(2, '0') + ':00';
    const dayLabel = `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    const fullTimeLabel = `${dayLabel} ${hourLabel}`;

    // WAQI 解码出来的数值是原生美标 IAQI 分指数，忽略非正异常值
    const rawPm25 = pm25Map.get(ts);
    const rawO3 = o3Map.get(ts);
    const rawPm10 = pm10Map.get(ts);
    const rawNo2 = no2Map.get(ts);
    const rawSo2 = so2Map.get(ts);
    const rawCo = coMap.get(ts);

    const usIaqiPm25 = rawPm25 !== undefined && rawPm25 > 0 ? Math.round(rawPm25) : undefined;
    const usIaqiO3 = rawO3 !== undefined && rawO3 > 0 ? Math.round(rawO3) : undefined;
    const usIaqiPm10 = rawPm10 !== undefined && rawPm10 > 0 ? Math.round(rawPm10) : undefined;
    const usIaqiNo2 = rawNo2 !== undefined && rawNo2 > 0 ? Math.round(rawNo2) : undefined;
    const usIaqiSo2 = rawSo2 !== undefined && rawSo2 > 0 ? Math.round(rawSo2) : undefined;
    const usIaqiCo = rawCo !== undefined && rawCo > 0 ? Math.round(rawCo) : undefined;

    // 将美标 IAQI 逆运算还原为客观物理质量浓度 (PM2.5/PM10/O3/NO2/SO2 为 μg/m³，CO 为 mg/m³)
    const concPm25 = usIaqiPm25 !== undefined ? convertIAQIToConcentration('pm25', usIaqiPm25, 'US') : 0;
    const concO3 = usIaqiO3 !== undefined ? convertIAQIToConcentration('o3', usIaqiO3, 'US') : undefined;
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
        (v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0
      );
      aqiVal = iaqiList.length > 0 ? Math.max(...iaqiList) : 0;
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
      // 单次计算各分项国标 IAQI，再取最大值作为综合 AQI（避免重复计算）
      iaqiResult = calculateCNIAQI({
        pm25: concPm25 > 0 ? concPm25 : undefined,
        pm10: concPm10 && concPm10 > 0 ? concPm10 : undefined,
        o3: concO3 && concO3 > 0 ? concO3 : undefined,
        no2: concNo2 && concNo2 > 0 ? concNo2 : undefined,
        so2: concSo2 && concSo2 > 0 ? concSo2 : undefined,
        co: concCo && concCo > 0 ? concCo : undefined,
      });
      const cnVals = Object.values(iaqiResult).filter(
        (v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0
      );
      aqiVal = cnVals.length > 0 ? Math.max(...cnVals) : 0;
    }

    if (aqiVal <= 0) continue;

    points.push({
      hour: hourLabel,
      fullTime: fullTimeLabel,
      ...(typeof cityUtcOffsetMinutes === 'number' && Number.isFinite(cityUtcOffsetMinutes)
        ? { timestampMs: ts - cityUtcOffsetMinutes * 60_000 }
        : {}),
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
    });
  }

  return points;
}

/**
 * Shared WAQI two-step session handshake against api2.waqi.info.
 * Used uniformly by Worker proxy, waqi.provider.ts, and browser direct fallback.
 */
export async function fetchWaqiHourlyRawText(
  stationIdx: number | string,
  options?: {
    fetchImpl?: typeof fetch;
    nowMs?: number;
    tokenTimeoutMs?: number;
    feedTimeoutMs?: number;
    signal?: AbortSignal;
  }
): Promise<{ ok: true; text: string } | { ok: false; status: number; error: string }> {
  const idxStr = String(stationIdx).trim();
  if (!/^-?\d+$/.test(idxStr)) {
    return { ok: false, status: 400, error: 'Invalid station idx' };
  }
  const doFetch = options?.fetchImpl ?? fetch;
  const nowMs = options?.nowMs ?? Date.now();
  const uid = 'u' + nowMs;

  const tokenRes = await doFetch(`https://api2.waqi.info/api/token/${idxStr}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `key=-&uid=${uid}`,
    signal: createTimeoutSignal(options?.tokenTimeoutMs ?? 5000, options?.signal),
  });
  if (!tokenRes.ok) {
    return { ok: false, status: 502, error: `Token fetch error: ${tokenRes.status}` };
  }

  const tokenJson = (await tokenRes.json()) as any;
  const token = tokenJson?.rxs?.obs?.[0]?.msg?.token;
  if (!token) {
    return { ok: false, status: 502, error: 'Failed to acquire WAQI token' };
  }

  const feedUid = 'f' + nowMs;
  const feedRes = await doFetch(`https://api2.waqi.info/api/feed/@${idxStr}/aqi.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `key=-&token=${encodeURIComponent(String(token))}&uid=${feedUid}&rqc=2`,
    signal: createTimeoutSignal(options?.feedTimeoutMs ?? 6000, options?.signal),
  });
  if (!feedRes.ok) {
    return { ok: false, status: 502, error: `WAQI status ${feedRes.status}` };
  }

  return { ok: true, text: await feedRes.text() };
}

/**
 * 从 WAQI 官方底层接口直接获取并解码过去 24~72 小时的真实逐小时实测
 */
export async function fetchWaqiHourlyDirect(
  stationIdx: number,
  standard: StandardType,
  cityUtcOffsetMinutes?: number
): Promise<HourlyTrendPoint[] | null> {
  try {
    const raw = await fetchWaqiHourlyRawText(stationIdx);
    if (!raw.ok) return null;
    const feedJson = JSON.parse(raw.text);
    const obs = feedJson?.rxs?.obs?.[0]?.msg?.obs;
    if (!obs || (!obs.pm25 && !obs.pm10 && !obs.o3 && !obs.no2)) return null;

    const points = build24HourPointsFromWaqiObs(obs, standard, cityUtcOffsetMinutes);
    return points.length > 0 ? points : null;
  } catch (err) {
    console.warn('Failed to fetch/decode WAQI hourly directly:', err);
    return null;
  }
}
