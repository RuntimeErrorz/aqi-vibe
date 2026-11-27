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
  observedAtLocal?: string,
  timezoneOffset?: string
): FreshnessMeta | undefined {
  if (!observedAtMs || !Number.isFinite(observedAtMs)) return undefined;
  // Clamp tiny negative clock skews (<= 15 min) to 0
  const rawDiffMin = Math.round((nowMs - observedAtMs) / 60_000);
  const delayMinutes = rawDiffMin < 0 && rawDiffMin >= -15 ? 0 : Math.max(0, rawDiffMin);
  const derivedTz = timezoneOffset || extractUtcOffsetLabel(observedAtLocal);

  return {
    observedAtMs,
    observedAtIso: new Date(observedAtMs).toISOString(),
    ...(observedAtLocal ? { observedAtLocal } : {}),
    ...(derivedTz ? { timezoneOffset: derivedTz } : {}),
    delayMinutes,
    isStale: delayMinutes > staleThresholdMin,
    fetchedAtMs: nowMs,
  };
}

/**
 * Normalize an explicit ISO-8601 offset or tz string (e.g. "+08:00", "-05:00", "Z", "GMT+11", "2026-11-27T04:00:00-05:00")
 * into a concise human-readable label like "UTC+8", "UTC-5", "UTC+5:30", "UTC+0".
 */
export function extractUtcOffsetLabel(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (/^(?:Z|UTC|GMT)$/i.test(trimmed) || trimmed.endsWith('Z')) return 'UTC+0';

  const gmtMatch = trimmed.match(/(?:GMT|UTC)([+-])(\d{1,2})(?::?(\d{2}))?$/i);
  if (gmtMatch) {
    const sign = gmtMatch[1];
    const hours = parseInt(gmtMatch[2], 10);
    const mins = gmtMatch[3] ? parseInt(gmtMatch[3], 10) : 0;
    if (hours === 0 && mins === 0) return 'UTC+0';
    return mins > 0 ? `UTC${sign}${hours}:${String(mins).padStart(2, '0')}` : `UTC${sign}${hours}`;
  }

  const isoMatch = trimmed.match(/([+-])(\d{2}):?(\d{2})$/);
  if (isoMatch) {
    const sign = isoMatch[1];
    const hours = parseInt(isoMatch[2], 10);
    const mins = parseInt(isoMatch[3], 10);
    if (hours === 0 && mins === 0) return 'UTC+0';
    return mins > 0 ? `UTC${sign}${hours}:${String(mins).padStart(2, '0')}` : `UTC${sign}${hours}`;
  }

  return undefined;
}

/**
 * Parse a "UTC+8" / "UTC-5" / "UTC+5:30" label into signed offset minutes.
 */
export function parseUtcOffsetLabelMinutes(label?: string | null): number | null {
  if (!label) return null;
  const m = label.trim().match(/^UTC([+-])(\d{1,2})(?::(\d{2}))?$/i);
  if (!m) return null;
  const sign = m[1] === '-' ? -1 : 1;
  const h = parseInt(m[2], 10);
  const min = m[3] ? parseInt(m[3], 10) : 0;
  return sign * (h * 60 + min);
}

/**
 * Authoritative IANA timezones for single-zone countries (handles DST automatically via Intl.DateTimeFormat).
 */
const SINGLE_ZONE_COUNTRY_IANA: Record<string, string> = {
  CN: 'Asia/Shanghai',
  HK: 'Asia/Hong_Kong',
  MO: 'Asia/Macau',
  TW: 'Asia/Taipei',
  SG: 'Asia/Singapore',
  MY: 'Asia/Kuala_Lumpur',
  PH: 'Asia/Manila',
  JP: 'Asia/Tokyo',
  KR: 'Asia/Seoul',
  TH: 'Asia/Bangkok',
  VN: 'Asia/Ho_Chi_Minh',
  KH: 'Asia/Phnom_Penh',
  LA: 'Asia/Vientiane',
  MM: 'Asia/Yangon',
  BD: 'Asia/Dhaka',
  NP: 'Asia/Kathmandu',
  IN: 'Asia/Kolkata',
  LK: 'Asia/Colombo',
  PK: 'Asia/Karachi',
  IR: 'Asia/Tehran',
  AE: 'Asia/Dubai',
  SA: 'Asia/Riyadh',
  QA: 'Asia/Qatar',
  KW: 'Asia/Kuwait',
  IL: 'Asia/Jerusalem',
  TR: 'Europe/Istanbul',
  GB: 'Europe/London',
  IE: 'Europe/Dublin',
  PT: 'Europe/Lisbon',
  FR: 'Europe/Paris',
  DE: 'Europe/Berlin',
  IT: 'Europe/Rome',
  ES: 'Europe/Madrid',
  NL: 'Europe/Amsterdam',
  BE: 'Europe/Brussels',
  CH: 'Europe/Zurich',
  AT: 'Europe/Vienna',
  PL: 'Europe/Warsaw',
  CZ: 'Europe/Prague',
  HU: 'Europe/Budapest',
  SE: 'Europe/Stockholm',
  NO: 'Europe/Oslo',
  DK: 'Europe/Copenhagen',
  FI: 'Europe/Helsinki',
  GR: 'Europe/Athens',
  RO: 'Europe/Bucharest',
  UA: 'Europe/Kyiv',
  EG: 'Africa/Cairo',
  ZA: 'Africa/Johannesburg',
  NG: 'Africa/Lagos',
  KE: 'Africa/Nairobi',
  MA: 'Africa/Casablanca',
  NZ: 'Pacific/Auckland',
  AR: 'America/Argentina/Buenos_Aires',
  CL: 'America/Santiago',
  CO: 'America/Bogota',
  PE: 'America/Lima',
};

/**
 * Resolve an IANA timezone for a city using country code + coordinates.
 * Automatically captures DST rules (US EDT/EST, EU CEST/CET, UK BST/GMT, AU AEDT/AEST, NZ NZDT/NZST).
 */
export function resolveCityIanaTimezone(
  country?: string,
  longitude?: number,
  latitude?: number
): string | null {
  const code = (country || '').toUpperCase();
  if (code in SINGLE_ZONE_COUNTRY_IANA) {
    return SINGLE_ZONE_COUNTRY_IANA[code];
  }

  const lon = typeof longitude === 'number' && Number.isFinite(longitude) ? longitude : undefined;
  const lat = typeof latitude === 'number' && Number.isFinite(latitude) ? latitude : undefined;

  if (code === 'US' && lon !== undefined) {
    if (lon < -150) return 'Pacific/Honolulu';
    if (lon < -130) return 'America/Anchorage';
    if (lon < -114.5) return 'America/Los_Angeles';
    if (lon < -102) return 'America/Denver';
    if (lon < -85.5) return 'America/Chicago';
    return 'America/New_York';
  }
  if (code === 'CA' && lon !== undefined) {
    if (lon < -119) return 'America/Vancouver';
    if (lon < -102) return 'America/Edmonton';
    if (lon < -90) return 'America/Winnipeg';
    if (lon < -66) return 'America/Toronto';
    return 'America/Halifax';
  }
  if (code === 'AU' && lon !== undefined) {
    if (lon < 129) return 'Australia/Perth';
    if (lon < 141) return lat !== undefined && lat > -26 ? 'Australia/Darwin' : 'Australia/Adelaide';
    return lat !== undefined && lat > -28.5 ? 'Australia/Brisbane' : 'Australia/Sydney';
  }
  if (code === 'RU' && lon !== undefined) {
    if (lon < 52) return 'Europe/Moscow';
    if (lon < 74) return 'Asia/Yekaterinburg';
    if (lon < 105) return 'Asia/Novosibirsk';
    if (lon < 126) return 'Asia/Irkutsk';
    return 'Asia/Vladivostok';
  }
  if (code === 'BR' && lon !== undefined) {
    if (lon < -53) return 'America/Manaus';
    return 'America/Sao_Paulo';
  }
  if (code === 'MX' && lon !== undefined) {
    if (lon < -112) return 'America/Tijuana';
    if (lon < -105) return 'America/Hermosillo';
    return 'America/Mexico_City';
  }
  if (code === 'ID' && lon !== undefined) {
    if (lon < 115) return 'Asia/Jakarta';
    if (lon < 128) return 'Asia/Makassar';
    return 'Asia/Jayapura';
  }

  return null;
}

/**
 * Format UTC epoch milliseconds into city local wall-clock time "YYYY-MM-DD HH:mm:ss"
 * AND dynamic UTC offset label (e.g. "UTC+11" for Sydney in summer, "UTC-5" for NYC in winter).
 */
export function formatLocalTimeForCityWithTz(
  observedAtMs: number,
  country?: string,
  longitude?: number,
  latitude?: number
): { localTime: string; timezoneOffset: string } {
  const iana = resolveCityIanaTimezone(country, longitude, latitude);
  if (iana) {
    try {
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: iana,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
        timeZoneName: 'shortOffset',
      }).formatToParts(new Date(observedAtMs));

      const get = (t: string) => parts.find((p) => p.type === t)?.value || '00';
      const y = get('year');
      const m = get('month');
      const d = get('day');
      const rawH = get('hour');
      const h = rawH === '24' ? '00' : rawH;
      const min = get('minute');
      const s = get('second');
      const tzPart = parts.find((p) => p.type === 'timeZoneName')?.value;
      const timezoneOffset = extractUtcOffsetLabel(tzPart) || 'UTC+0';

      return {
        localTime: `${y}-${m}-${d} ${h}:${min}:${s}`,
        timezoneOffset,
      };
    } catch {
      // Fallback to longitude offset if runtime ICU lacks a zone
    }
  }

  const offsetHours =
    typeof longitude === 'number' && Number.isFinite(longitude)
      ? Math.round(longitude / 15)
      : 8;
  const shifted = new Date(observedAtMs + offsetHours * 3600 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const sign = offsetHours >= 0 ? '+' : '';
  return {
    localTime: `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(
      shifted.getUTCDate()
    )} ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(
      shifted.getUTCSeconds()
    )}`,
    timezoneOffset: `UTC${sign}${offsetHours}`,
  };
}

export function formatLocalTimeForCity(
  observedAtMs: number,
  country?: string,
  longitude?: number,
  latitude?: number
): string {
  return formatLocalTimeForCityWithTz(observedAtMs, country, longitude, latitude).localTime;
}

/**
 * Validate whether an upstream `observedAtLocal` string's timezone offset is plausible for the city.
 * Guards against upstream bugs (e.g. OpenAQ returning "+00:00" UTC as `datetime.local` for a UTC+8 or UTC-5 city).
 */
export function isPlausibleLocalOffsetForCity(
  observedAtLocal: string | undefined | null,
  observedAtMs: number,
  country?: string,
  longitude?: number,
  latitude?: number
): boolean {
  if (!observedAtLocal) return false;
  const upstreamLabel = extractUtcOffsetLabel(observedAtLocal);
  const upstreamMin = parseUtcOffsetLabelMinutes(upstreamLabel);
  if (upstreamMin === null) return true; // Naive local string with no offset -> trust upstream wall clock

  const expected = formatLocalTimeForCityWithTz(observedAtMs, country, longitude, latitude);
  const expectedMin = parseUtcOffsetLabelMinutes(expected.timezoneOffset);
  if (expectedMin === null) return true;

  // Allow up to 90 min difference for border cities / half-hour zones; reject > 2h discrepancy (e.g. UTC+0 vs UTC-5)
  return Math.abs(upstreamMin - expectedMin) <= 90;
}

/**
 * Format an observed UTC timestamp in the user's own browser local timezone for clear hover tooltips.
 */
export function formatInUserLocalTime(observedAtMs: number): { localTime: string; timezoneOffset: string } {
  const d = new Date(observedAtMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  const offsetMin = -d.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const absMin = Math.abs(offsetMin);
  const h = Math.floor(absMin / 60);
  const m = absMin % 60;
  const timezoneOffset =
    h === 0 && m === 0
      ? 'UTC+0'
      : m > 0
      ? `UTC${sign}${h}:${pad(m)}`
      : `UTC${sign}${h}`;
  return {
    localTime: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
      d.getHours()
    )}:${pad(d.getMinutes())}`,
    timezoneOffset,
  };
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
