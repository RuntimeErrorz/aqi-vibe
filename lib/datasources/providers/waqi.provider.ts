import type { CityMeta, ForecastData, PollutantValues, WeatherInfo } from '../../types';
import {
  calculateCNIAQI,
  convertIAQIToConcentration,
  evaluateAQI,
} from '../../aqi-calculator';
import { extractStationMetricsFromIaqi } from '../../services/composite-aggregator';
import {
  build24HourPointsFromWaqiObs,
  fetchWaqiHourlyDirect,
} from '../../services/waqi-decoder';
import {
  computeFreshness,
  extractUtcOffsetLabel,
  formatLocalTimeForCityWithTz,
  getCityUtcOffsetMinutes,
  parseObservedTimeMs,
} from '../freshness';
import { filterAndRankStationsForCity } from '../orchestrator';
import { createTimeoutSignal } from '../units';
import type {
  AirQualityProvider,
  NormalizedStationSample,
  ProviderCitySnapshot,
  ProviderRuntimeContext,
} from '../types';

let tokenCursor = 0;

function pickToken(tokens: string[]): string {
  const tok = tokens[tokenCursor % tokens.length];
  tokenCursor = (tokenCursor + 1) % tokens.length;
  return tok;
}

// 24h cache mapping city.id -> WAQI reference station idx so 72h historical trend works seamlessly
// even when realtime snapshot is served by QWeather / Caiyun / OpenAQ (capability decoupling).
const cityWaqiIdxCache = new Map<string, { idx: number; expiresAtMs: number }>();

async function resolveWaqiStationIdxForCity(
  city: CityMeta,
  tokens: string[],
  ctx: ProviderRuntimeContext
): Promise<number | null> {
  const cached = cityWaqiIdxCache.get(city.id);
  if (cached && cached.expiresAtMs > ctx.nowMs) {
    return cached.idx;
  }

  if (tokens.length === 0) return null;
  const timeoutMs = ctx.timeoutMs ?? 4500;

  // 1. Fast 1-request resolution via registered WAQI slug
  const slug = city.waqiSlug || city.nameEn.toLowerCase();
  try {
    const res = await ctx.fetchImpl(
      `https://api.waqi.info/feed/${encodeURIComponent(slug)}/?token=${pickToken(tokens)}`,
      { cache: 'no-store', signal: createTimeoutSignal(timeoutMs, ctx.signal) }
    );
    if (res.ok) {
      const json = (await res.json()) as any;
      const idx = json?.data?.idx;
      if (json?.status === 'ok' && typeof idx === 'number' && idx > 0) {
        cityWaqiIdxCache.set(city.id, { idx, expiresAtMs: ctx.nowMs + 24 * 3600 * 1000 });
        return idx;
      }
    }
  } catch {
    // Fall through to bounds resolution
  }

  // 2. Fallback: single bounds query within ±0.35° selecting freshest official station
  try {
    const minLat = (city.latitude - 0.35).toFixed(4);
    const minLon = (city.longitude - 0.35).toFixed(4);
    const maxLat = (city.latitude + 0.35).toFixed(4);
    const maxLon = (city.longitude + 0.35).toFixed(4);
    const res = await ctx.fetchImpl(
      `https://api.waqi.info/v2/map/bounds?latlng=${minLat},${minLon},${maxLat},${maxLon}&token=${pickToken(tokens)}`,
      { cache: 'no-store', signal: createTimeoutSignal(timeoutMs, ctx.signal) }
    );
    if (res.ok) {
      const json = (await res.json()) as any;
      if (json?.status === 'ok' && Array.isArray(json.data)) {
        const normalized = json.data
          .map((item: any) => boundItemToNormalized(item, ctx.nowMs))
          .filter((x: NormalizedStationSample | null): x is NormalizedStationSample =>
            Boolean(x && !x.isOffline)
          );
        const ranked = filterAndRankStationsForCity(normalized, city, ctx.nowMs);
        if (ranked[0]?.numericUid > 0) {
          const idx = ranked[0].numericUid;
          cityWaqiIdxCache.set(city.id, { idx, expiresAtMs: ctx.nowMs + 24 * 3600 * 1000 });
          return idx;
        }
      }
    }
  } catch {}

  return null;
}

async function fetchWaqiHourlyWithFetch(
  stationIdx: number,
  standard: 'CN' | 'US',
  ctx: ProviderRuntimeContext,
  cityUtcOffsetMinutes?: number
) {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (ctx.signal?.aborted) return null;
    try {
      const uid = 'u' + (ctx.nowMs + attempt);
      const tokenRes = await ctx.fetchImpl(`https://api2.waqi.info/api/token/${stationIdx}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `key=-&uid=${uid}`,
        signal: createTimeoutSignal(7500, ctx.signal),
      });
      if (!tokenRes.ok) continue;
      const tokenJson = (await tokenRes.json()) as any;
      const token = tokenJson?.rxs?.obs?.[0]?.msg?.token;
      if (!token) continue;

      const feedUid = 'f' + (ctx.nowMs + attempt);
      const feedRes = await ctx.fetchImpl(`https://api2.waqi.info/api/feed/@${stationIdx}/aqi.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `key=-&token=${token}&uid=${feedUid}&rqc=2`,
        signal: createTimeoutSignal(8500, ctx.signal),
      });
      if (!feedRes.ok) continue;
      const feedJson = (await feedRes.json()) as any;
      const obs = feedJson?.rxs?.obs?.[0]?.msg?.obs;
      if (!obs || !obs.pm25) continue;

      const pts = build24HourPointsFromWaqiObs(obs, standard, cityUtcOffsetMinutes);
      if (pts.length >= 3) return pts;
    } catch {
      // Retry once on transient TLS / timeout hiccup
    }
  }
  return null;
}

function parseWaqiForecast(daily: any): ForecastData | undefined {
  if (!daily) return undefined;
  return {
    pm25: (daily.pm25 || []).map((f: any) => ({
      day: f.day,
      min: typeof f.min === 'number' ? convertIAQIToConcentration('pm25', f.min, 'US') : 0,
      max: typeof f.max === 'number' ? convertIAQIToConcentration('pm25', f.max, 'US') : 0,
      avg: typeof f.avg === 'number' ? convertIAQIToConcentration('pm25', f.avg, 'US') : 0,
    })),
    pm10: daily.pm10 || [],
    o3: daily.o3 || [],
    uvi: daily.uvi || [],
  };
}

function createHttpError(status: number, message: string): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

function boundItemToNormalized(item: any, nowMs: number): NormalizedStationSample | null {
  if (!item || typeof item.uid !== 'number') return null;
  if (typeof item.lat !== 'number' || typeof item.lon !== 'number') return null;

  const aqiNum = parseInt(String(item.aqi), 10);
  const isOffline = isNaN(aqiNum) || aqiNum <= 0 || aqiNum > 500;
  const obsMs = parseObservedTimeMs(item.station?.time);
  const freshness = computeFreshness(obsMs, nowMs);

  const pollutants: PollutantValues = {};
  if (!isOffline) {
    // Bounds response only carries aggregate US AQI; detail enrichment replaces this with real 6-pollutant readings
    pollutants.pm25 = convertIAQIToConcentration('pm25', aqiNum, 'US');
  }

  return {
    stationId: `waqi:${item.uid}`,
    providerId: 'waqi',
    rawId: String(item.uid),
    numericUid: item.uid,
    name: item.station?.name || `Station ${item.uid}`,
    latitude: item.lat,
    longitude: item.lon,
    isOfficial: item.uid > 0,
    freshness,
    pollutants,
    rawUsAqi: isOffline ? undefined : aqiNum,
    isOffline,
  };
}

function feedDataToNormalized(
  data: any,
  fallbackLat: number,
  fallbackLon: number,
  fallbackName: string,
  nowMs: number
): NormalizedStationSample {
  const uid = typeof data.idx === 'number' ? data.idx : 0;
  const geo = Array.isArray(data.city?.geo) ? data.city.geo : [fallbackLat, fallbackLon];
  const metrics = extractStationMetricsFromIaqi(data.iaqi);
  const obsMs = parseObservedTimeMs(data.time?.iso || data.time?.s, data.time?.tz);
  const tzLabel = extractUtcOffsetLabel(data.time?.tz || data.time?.iso);
  const freshness = computeFreshness(
    obsMs,
    nowMs,
    undefined,
    data.time?.iso || data.time?.s || undefined,
    tzLabel
  );
  const isOffline = data.aqi === '-' || data.aqi === null || data.aqi === undefined;
  const rawUsAqi = typeof data.aqi === 'number' && !isNaN(data.aqi) && data.aqi > 0 ? data.aqi : undefined;

  return {
    stationId: `waqi:${uid}`,
    providerId: 'waqi',
    rawId: String(uid),
    numericUid: uid,
    name: fallbackName || data.city?.name || `Station ${uid}`,
    latitude: typeof geo[0] === 'number' ? geo[0] : fallbackLat,
    longitude: typeof geo[1] === 'number' ? geo[1] : fallbackLon,
    isOfficial: uid > 0,
    freshness,
    pollutants: metrics.pollutants,
    weather: metrics.weather as WeatherInfo,
    rawUsAqi,
    pm25IaqiUS: metrics.pm25IaqiUS,
    pm25IaqiCN: metrics.pm25IaqiCN,
    isOffline,
  };
}

export const waqiProvider: AirQualityProvider = {
  id: 'waqi',
  name: 'WAQI 全球空气质量监测网',
  shortName: 'WAQI',
  tier: 'ground-official',
  supportedCountries: '*',
  supportsBrowserDirect: true,

  isAvailable(ctx: ProviderRuntimeContext): boolean {
    return Array.isArray(ctx.env.waqiTokens) && ctx.env.waqiTokens.length > 0;
  },

  bounds: {
    async fetchStationsInBounds(bbox, ctx): Promise<NormalizedStationSample[]> {
      const tokens = ctx.env.waqiTokens || [];
      if (tokens.length === 0) return [];
      const timeoutMs = ctx.timeoutMs ?? 5500;
      const url = `https://api.waqi.info/v2/map/bounds?latlng=${bbox.minLat.toFixed(4)},${bbox.minLon.toFixed(4)},${bbox.maxLat.toFixed(4)},${bbox.maxLon.toFixed(4)}&token=${pickToken(tokens)}`;

      const res = await ctx.fetchImpl(url, {
        cache: 'no-store',
        signal: createTimeoutSignal(timeoutMs, ctx.signal),
      });
      if (!res.ok) {
        throw createHttpError(res.status, `WAQI bounds HTTP ${res.status}`);
      }
      const json = (await res.json()) as any;
      if (json?.status !== 'ok' || !Array.isArray(json.data)) return [];

      const out: NormalizedStationSample[] = [];
      for (const item of json.data) {
        const normalized = boundItemToNormalized(item, ctx.nowMs);
        if (normalized) out.push(normalized);
      }
      return out;
    },
  },

  realtime: {
    async fetchCitySnapshot(city: CityMeta, ctx: ProviderRuntimeContext): Promise<ProviderCitySnapshot | null> {
      const tokens = ctx.env.waqiTokens || [];
      if (tokens.length === 0) return null;

      const timeoutMs = ctx.timeoutMs ?? 4500;
      const concurrency = Math.max(1, ctx.concurrency ?? (ctx.isServer ? 6 : 10));
      const maxStations = Math.max(1, ctx.maxStations ?? (ctx.isServer ? 12 : 20));
      let subrequestsUsed = 0;

      // Wave 1: 1 bounds request within ±0.35° (~35km urban boundary)
      const minLat = (city.latitude - 0.35).toFixed(4);
      const minLon = (city.longitude - 0.35).toFixed(4);
      const maxLat = (city.latitude + 0.35).toFixed(4);
      const maxLon = (city.longitude + 0.35).toFixed(4);
      const boundsUrl = `https://api.waqi.info/v2/map/bounds?latlng=${minLat},${minLon},${maxLat},${maxLon}&token=${pickToken(tokens)}`;

      let rawBoundStations: NormalizedStationSample[] = [];
      subrequestsUsed++;
      try {
        const res = await ctx.fetchImpl(boundsUrl, {
          cache: 'no-store',
          signal: createTimeoutSignal(timeoutMs, ctx.signal),
        });
        if (res.status === 429 || res.status === 401 || res.status === 403) {
          throw createHttpError(res.status, `WAQI bounds HTTP ${res.status}`);
        }
        if (res.ok) {
          const json = (await res.json()) as any;
          if (json?.status === 'ok' && Array.isArray(json.data)) {
            rawBoundStations = json.data
              .map((item: any) => boundItemToNormalized(item, ctx.nowMs))
              .filter((x: NormalizedStationSample | null): x is NormalizedStationSample =>
                Boolean(x && !x.isOffline)
              );
          }
        }
      } catch (err: any) {
        if (err?.status === 429 || err?.status === 401 || err?.status === 403) throw err;
        rawBoundStations = [];
      }

      // Pre-filter and rank by Freshness-First + Distance-Second BEFORE sampling detail feeds!
      // This ensures we prioritize the freshest official stations (e.g., Beijing 15:00 stations over 13:00 center).
      const rankedCandidates = filterAndRankStationsForCity(rawBoundStations, city, ctx.nowMs);

      // If zero active stations in bounds, honestly inspect official slug to detect offline status
      if (rankedCandidates.length === 0) {
        const slug = city.waqiSlug || city.nameEn.toLowerCase();
        subrequestsUsed++;
        const res = await ctx.fetchImpl(
          `https://api.waqi.info/feed/${encodeURIComponent(slug)}/?token=${pickToken(tokens)}`,
          {
            cache: 'no-store',
            signal: createTimeoutSignal(timeoutMs, ctx.signal),
          }
        );
        if (!res.ok) return null;
        const json = (await res.json()) as any;
        if (json?.status !== 'ok' || !json.data) return null;

        const direct = feedDataToNormalized(
          json.data,
          city.latitude,
          city.longitude,
          city.nameZh,
          ctx.nowMs
        );
        return {
          providerId: 'waqi',
          providerName: 'WAQI',
          tier: 'ground-official',
          stations: [],
          directCityReading: direct,
          forecast: parseWaqiForecast(json.data.forecast?.daily),
          attributions: json.data.attributions,
          subrequestsUsed,
          isOffline: direct.isOffline,
        };
      }

      // Wave 2: Enrich top N freshest official stations with full 6 pollutants + 4 weather metrics
      // Optimization: if Wave 1 already indicates the entire city is stale (>90m) AND a backup provider
      // is available, only enrich 1 center station so Strategy A immediately probes backups in parallel.
      const wave1Stale = Boolean(rankedCandidates[0]?.freshness?.isStale);
      const effectiveMax = wave1Stale && ctx.hasBackupCandidate ? 1 : maxStations;
      const sampleCount = Math.min(rankedCandidates.length, effectiveMax);
      const enriched: NormalizedStationSample[] = [...rankedCandidates];
      let forecast: ForecastData | undefined;
      let attributions: Array<{ name: string; url?: string }> | undefined;
      let cursor = 0;

      const worker = async () => {
        while (cursor < sampleCount) {
          if (ctx.signal?.aborted) return;
          const idx = cursor++;
          const st = rankedCandidates[idx];
          subrequestsUsed++;
          try {
            const url = `https://api.waqi.info/feed/@${st.numericUid}/?token=${pickToken(tokens)}`;
            const res = await ctx.fetchImpl(url, {
              cache: 'no-store',
              signal: createTimeoutSignal(timeoutMs, ctx.signal),
            });
            if (!res.ok) continue;
            const json = (await res.json()) as any;
            if (json?.status !== 'ok' || !json.data) continue;

            const detailed = feedDataToNormalized(
              json.data,
              st.latitude,
              st.longitude,
              st.name,
              ctx.nowMs
            );
            // Keep accurate bounds coordinates if feed omits geo
            enriched[idx] = {
              ...detailed,
              latitude: st.latitude,
              longitude: st.longitude,
              freshness: detailed.freshness ?? st.freshness,
            };

            if (idx === 0 || (!forecast && json.data.forecast?.daily)) {
              forecast = parseWaqiForecast(json.data.forecast?.daily) ?? forecast;
            }
            if (idx === 0 || (!attributions && Array.isArray(json.data.attributions))) {
              attributions = json.data.attributions ?? attributions;
            }
          } catch {
            // Single-station timeout gracefully skipped
          }
        }
      };

      await Promise.all(
        Array.from({ length: Math.min(concurrency, sampleCount) }, () => worker())
      );

      // Re-rank after detail enrichment because detail feeds contain exact tz-aware ISO timestamps
      const finalStations = filterAndRankStationsForCity(enriched, city, ctx.nowMs);
      if (finalStations.length === 0) return null;

      return {
        providerId: 'waqi',
        providerName: 'WAQI',
        tier: 'ground-official',
        stations: finalStations,
        directCityReading: finalStations[0],
        forecast,
        attributions: attributions || [
          { name: 'World Air Quality Index Project', url: 'https://waqi.info/' },
        ],
        subrequestsUsed,
        isOffline: finalStations.every((s) => s.isOffline),
      };
    },
  },

  hourlyTrend: {
    async fetchHourlyTrend(query, ctx) {
      let uid = query.stationRawId ? parseInt(query.stationRawId, 10) : NaN;
      if (!Number.isFinite(uid) || uid <= 0) {
        const resolved = await resolveWaqiStationIdxForCity(
          query.city,
          ctx.env.waqiTokens || [],
          ctx
        );
        if (!resolved) return null;
        uid = resolved;
      }

      const cityUtcOffsetMinutes = getCityUtcOffsetMinutes(
        ctx.nowMs,
        query.city.country,
        query.city.longitude,
        query.city.latitude
      );

      const racers: Promise<ReturnType<typeof build24HourPointsFromWaqiObs>>[] = [];

      if (ctx.origin && !ctx.isServer) {
        racers.push(
          (async () => {
            const res = await ctx.fetchImpl(`${ctx.origin}/api/waqi-hourly?idx=${uid}`, {
              signal: createTimeoutSignal(4500, ctx.signal),
            });
            if (!res.ok) throw new Error(`Edge HTTP ${res.status}`);
            const waqiJson = (await res.json()) as any;
            const obs = waqiJson?.rxs?.obs?.[0]?.msg?.obs;
            if (!obs || !obs.pm25) throw new Error('Empty edge obs');
            const pts = build24HourPointsFromWaqiObs(obs, query.standard, cityUtcOffsetMinutes);
            if (pts.length < 3) throw new Error('Insufficient edge points');
            return pts;
          })()
        );
      }

      racers.push(
        (async () => {
          const pts =
            ctx.fetchImpl === fetch && !ctx.isServer
              ? await fetchWaqiHourlyDirect(uid, query.standard, cityUtcOffsetMinutes)
              : await fetchWaqiHourlyWithFetch(uid, query.standard, ctx, cityUtcOffsetMinutes);
          if (!pts || pts.length < 3) throw new Error('Insufficient direct points');
          return pts;
        })()
      );

      try {
        const points = await Promise.any(racers);
        const cityTz = formatLocalTimeForCityWithTz(
          ctx.nowMs,
          query.city.country,
          query.city.longitude,
          query.city.latitude
        ).timezoneOffset;
        return {
          points,
          isReal: true,
          providerId: 'waqi',
          providerName: 'WAQI',
          timezoneOffset: cityTz,
          source: 'WAQI 官方测站 72h 逐小时实测',
        };
      } catch {
        return null;
      }
    },
  },

  mapTiles: {
    getMapTileUrl(ctx: ProviderRuntimeContext): string {
      const token = ctx.env.waqiTokens?.[0] || '';
      return `https://tiles.aqicn.org/tiles/usepa-aqi/{z}/{x}/{y}.png?token=${token}`;
    },
  },
};

export function evaluateSampleBriefAqi(sample: NormalizedStationSample): {
  cn: number;
  us: number;
} {
  const cn = evaluateAQI(sample.pollutants, 'CN').aqi;
  const us = evaluateAQI(sample.pollutants, 'US').aqi;
  return { cn, us };
}

export { calculateCNIAQI };
