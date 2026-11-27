import type { FreshnessMeta, PollutantValues } from '../types';

export const DEFAULT_STALE_THRESHOLD_MIN = 90;
export const ZOMBIE_STATION_THRESHOLD_MIN = 240; // 4 hours
export const FRESH_STATION_WINDOW_MIN = 60; // Stations within 1h of city's freshest station share top priority

/**
 * Normalize sovereign country code comparison.
 * Fixes @rapideditor/country-coder returning "CN" for Hong Kong / Macau coordinates
 * while cities.ts labels Hong Kong as "HK" and Macau as "MO".
 * Physical 35km + Voronoi boundary still strictly separates HK/MO from Shenzhen/Zhuhai.
 */
export function isSameSovereignCountry(
  stationCountry: string | undefined | null,
  cityCountry: string | undefined | null
): boolean {
  if (!stationCountry || !cityCountry) return true;
  const s = stationCountry.toUpperCase();
  const c = cityCountry.toUpperCase();
  if (s === c) return true;
  if ((c === 'HK' || c === 'MO') && s === 'CN') return true;
  if ((s === 'HK' || s === 'MO') && c === 'CN') return true;
  return false;
}

/**
 * Parse heterogeneous upstream observation timestamps into UTC epoch milliseconds.
 * Handles:
 * - ISO-8601 with tz: "2026-11-27T15:00:00+08:00", "2026-11-27T07:00:00Z"
 * - RFC-2822 (HK EPD): "Fri, 27 Nov 2026 15:00:00 +0800"
 * - Local naive strings with explicit tz offset: ("2026-11-27 12:00:00", "+08:00")
 * - Taiwan MOENV naive CST strings: "2026-11-27 15:00"
 */
export function parseObservedTimeMs(
  rawTime: string | number | undefined | null,
  tzOffset?: string
): number | null {
  if (rawTime === undefined || rawTime === null) return null;
  if (typeof rawTime === 'number') {
    if (!Number.isFinite(rawTime) || rawTime <= 0) return null;
    // Detect unix seconds vs milliseconds
    return rawTime < 1e12 ? rawTime * 1000 : rawTime;
  }

  const trimmed = rawTime.trim();
  if (!trimmed) return null;

  // Already has explicit timezone designator (Z, +HH:MM, -HH:MM, +HHMM, GMT)
  const hasTz = /(?:Z|[+-]\d{2}:?\d{2}|GMT|UTC)$/i.test(trimmed);
  if (hasTz) {
    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  // Naive "YYYY-MM-DD HH:mm(:ss)?" with known timezone offset
  const normalized = trimmed.replace(/\//g, '-').replace(' ', 'T');
  if (tzOffset && /^[+-]\d{2}:?\d{2}$/.test(tzOffset.trim())) {
    const tz = tzOffset.trim().includes(':')
      ? tzOffset.trim()
      : `${tzOffset.trim().slice(0, 3)}:${tzOffset.trim().slice(3)}`;
    const parsed = Date.parse(`${normalized}${tz}`);
    if (Number.isFinite(parsed)) return parsed;
  }

  // Fallback: parse as-is (local runtime TZ or ISO date)
  const fallback = Date.parse(normalized);
  return Number.isFinite(fallback) ? fallback : null;
}

export function computeFreshness(
  observedAtMs: number | null | undefined,
  nowMs = Date.now(),
  staleThresholdMin = DEFAULT_STALE_THRESHOLD_MIN,
  observedAtLocal?: string
): FreshnessMeta | undefined {
  if (!observedAtMs || !Number.isFinite(observedAtMs)) return undefined;
  // Clamp tiny negative clock skews (<= 15 min) to 0
  const rawDiffMin = Math.round((nowMs - observedAtMs) / 60_000);
  const delayMinutes = rawDiffMin < 0 && rawDiffMin >= -15 ? 0 : Math.max(0, rawDiffMin);

  return {
    observedAtMs,
    observedAtIso: new Date(observedAtMs).toISOString(),
    ...(observedAtLocal ? { observedAtLocal } : {}),
    delayMinutes,
    isStale: delayMinutes > staleThresholdMin,
    fetchedAtMs: nowMs,
  };
}

/**
 * Format UTC epoch milliseconds into city local wall-clock time "YYYY-MM-DD HH:mm:ss".
 * Uses authoritative country offsets for fixed-offset Asian/major zones, and longitude solar-zone
 * approximation for multi-zone countries when upstream did not provide a local wall-clock string.
 */
const FIXED_COUNTRY_UTC_OFFSET_HOURS: Record<string, number> = {
  CN: 8,
  HK: 8,
  MO: 8,
  TW: 8,
  SG: 8,
  MY: 8,
  PH: 8,
  JP: 9,
  KR: 9,
  TH: 7,
  VN: 7,
  IN: 5.5,
  GB: 0,
  IE: 0,
  PT: 0,
  FR: 1,
  DE: 1,
  IT: 1,
  ES: 1,
  NL: 1,
  BE: 1,
  CH: 1,
  AT: 1,
  PL: 1,
  SE: 1,
  NO: 1,
  AE: 4,
  SA: 3,
  TR: 3,
};

export function formatLocalTimeForCity(
  observedAtMs: number,
  country?: string,
  longitude?: number
): string {
  const code = (country || '').toUpperCase();
  let offsetHours: number;
  if (code in FIXED_COUNTRY_UTC_OFFSET_HOURS) {
    offsetHours = FIXED_COUNTRY_UTC_OFFSET_HOURS[code];
  } else if (typeof longitude === 'number' && Number.isFinite(longitude)) {
    offsetHours = Math.round(longitude / 15);
  } else {
    offsetHours = 8;
  }

  const shifted = new Date(observedAtMs + offsetHours * 3600 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(
    shifted.getUTCDate()
  )} ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(
    shifted.getUTCSeconds()
  )}`;
}

/**
 * Format local-friendly display string "YYYY-MM-DD HH:mm:ss" preserving explicit tz if given.
 */
export function formatDisplayTimeFromIso(isoOrLocal: string): string {
  if (!isoOrLocal) return '';
  const match = isoOrLocal.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2})?)/);
  if (match) {
    const timePart = match[2].length === 5 ? `${match[2]}:00` : match[2];
    return `${match[1]} ${timePart}`;
  }
  const ms = Date.parse(isoOrLocal);
  if (!Number.isFinite(ms)) return isoOrLocal;
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
}

/**
 * Concise delay badge formatter for UI presentation.
 * Returns null when data is fresh (delay < 90 min).
 */
export function formatDelayBadge(
  freshness?: FreshnessMeta
): { label: string; severity: 'mild' | 'severe'; title: string } | null {
  if (!freshness || freshness.delayMinutes < DEFAULT_STALE_THRESHOLD_MIN) {
    return null;
  }
  const mins = freshness.delayMinutes;
  let durationText: string;
  if (mins >= 24 * 60) {
    const days = Math.floor(mins / (24 * 60));
    durationText = `${days}天`;
  } else {
    const hours = Math.round((mins / 60) * 10) / 10;
    const rounded = hours >= 2 ? `${Math.round(hours)}h` : `${hours}h`;
    durationText = rounded;
  }

  return {
    label: `延迟 ${durationText}`,
    severity: mins >= 150 ? 'severe' : 'mild',
    title: `该测站最新观测距今约 ${mins} 分钟（原始观测时间 ${freshness.observedAtIso}）`,
  };
}

/**
 * Eliminate stale zombie stations (e.g., 42h old frozen sensors in Chicago)
 * without discarding an entire city if all stations share an upstream delay (e.g., Chengdu at 12:00).
 */
export function pruneStaleStations<T extends { observedAtMs?: number | null }>(
  stations: T[],
  nowMs = Date.now(),
  zombieThresholdMin = ZOMBIE_STATION_THRESHOLD_MIN
): T[] {
  if (stations.length <= 1) return stations;

  const timed = stations.filter(
    (s) => typeof s.observedAtMs === 'number' && Number.isFinite(s.observedAtMs)
  );
  if (timed.length === 0) return stations;

  const freshestMs = Math.max(...timed.map((s) => s.observedAtMs as number));
  const freshestDelayMin = (nowMs - freshestMs) / 60_000;

  // Case 1: City has fresh/moderately recent stations (<= 150m old) -> strictly drop >4h zombie stations
  if (freshestDelayMin <= 150) {
    const kept = stations.filter((s) => {
      if (typeof s.observedAtMs !== 'number' || !Number.isFinite(s.observedAtMs)) return true;
      const delayMin = (nowMs - s.observedAtMs) / 60_000;
      return delayMin <= zombieThresholdMin;
    });
    return kept.length > 0 ? kept : stations;
  }

  // Case 2: Whole city is lagged -> keep stations within 2h of the city's freshest observation
  const kept = stations.filter((s) => {
    if (typeof s.observedAtMs !== 'number' || !Number.isFinite(s.observedAtMs)) return true;
    return freshestMs - s.observedAtMs <= 120 * 60_000;
  });
  return kept.length > 0 ? kept : stations;
}

/**
 * Sort stations with Freshness-First + Distance-Second priority:
 * Stations within FRESH_STATION_WINDOW_MIN (60 min) of the city's freshest station
 * are prioritized ahead of lagged stations; within each tier, closest to city center wins.
 * Eliminates the "single lagged center station drags down whole city timestamp" defect
 * (e.g., Beijing 13:00 center vs 15:00 city median; Taipei 11:00 center vs 15:00 fresh stations).
 */
export function sortStationsByFreshnessAndDistance<
  T extends { observedAtMs?: number | null; distKm: number }
>(stations: T[]): T[] {
  if (stations.length <= 1) return [...stations];

  const validTimes = stations
    .map((s) => s.observedAtMs)
    .filter((t): t is number => typeof t === 'number' && Number.isFinite(t));

  if (validTimes.length === 0) {
    return [...stations].sort((a, b) => a.distKm - b.distKm);
  }

  const freshestMs = Math.max(...validTimes);
  const windowMs = FRESH_STATION_WINDOW_MIN * 60_000;

  return [...stations].sort((a, b) => {
    const aFresh =
      typeof a.observedAtMs === 'number' && freshestMs - a.observedAtMs <= windowMs;
    const bFresh =
      typeof b.observedAtMs === 'number' && freshestMs - b.observedAtMs <= windowMs;
    if (aFresh !== bFresh) return aFresh ? -1 : 1;

    // If neither is in the freshest window, prefer newer observation bucket (per hour) before distance
    if (!aFresh && !bFresh) {
      const aBucket = typeof a.observedAtMs === 'number' ? Math.floor(a.observedAtMs / windowMs) : -1;
      const bBucket = typeof b.observedAtMs === 'number' ? Math.floor(b.observedAtMs / windowMs) : -1;
      if (aBucket !== bBucket) return bBucket - aBucket;
    }

    return a.distKm - b.distKm;
  });
}

/**
 * Check whether a pollutant concentration object has at least one valid positive measurement.
 */
export function hasValidPollutants(p?: PollutantValues): boolean {
  if (!p) return false;
  return Boolean(
    (p.pm25 !== undefined && p.pm25 > 0) ||
      (p.pm10 !== undefined && p.pm10 > 0) ||
      (p.o3 !== undefined && p.o3 > 0) ||
      (p.no2 !== undefined && p.no2 > 0) ||
      (p.so2 !== undefined && p.so2 > 0) ||
      (p.co !== undefined && p.co > 0)
  );
}

/**
 * Deterministic positive/negative hash for generating numeric compatibility IDs for non-WAQI stations.
 */
export function hashStationIdToUid(canonicalId: string): number {
  let hash = 2166136261;
  for (let i = 0; i < canonicalId.length; i++) {
    hash ^= canonicalId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  // Keep positive 31-bit non-zero integer in high namespace (>= 100_000_000) so it never collides with WAQI uids
  return 100_000_000 + (Math.abs(hash) % 800_000_000);
}
