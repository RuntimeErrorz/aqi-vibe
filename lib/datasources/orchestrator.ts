import { iso1A2Code } from '@rapideditor/country-coder';
import { CITIES_REGISTRY } from '../constants/cities';
import type {
  AirQualityRecord,
  CityMeta,
  DataProvenance,
  ForecastDay,
  FreshnessMeta,
  ObservationTier,
  ProviderId,
  StandardType,
} from '../types';
import {
  calculateCNIAQI,
  calculateUSIAQI,
  convertIAQIToConcentration,
  evaluateAQI,
  getUSEvaluation,
} from '../aqi-calculator';
import {
  aggregateCompositeRecord,
  StationCompositeSample,
} from '../services/composite-aggregator';
import type { HourlyTrendResult } from '../services/realtime-trend';
import {
  computeFreshness,
  DEFAULT_STALE_THRESHOLD_MIN,
  extractUtcOffsetLabel,
  formatDisplayTimeFromIso,
  formatLocalTimeForCityWithTz,
  hasValidPollutants,
  isPlausibleLocalOffsetForCity,
  isSameSovereignCountry,
  pruneStaleStations,
  sortStationsByFreshnessAndDistance,
} from './freshness';
import { createTimeoutSignal } from './units';
import { getDistanceKm, mergeWeatherInfo } from '../utils/common';
import { ProviderRegistry } from './registry';
import type {
  AirQualityProvider,
  NormalizedStationSample,
  OrchestratedCityRealtimePayload,
  OrchestratorOptions,
  ProviderCitySnapshot,
  ProviderRuntimeContext,
} from './types';
import type { WeatherInfo } from '../types';

const MAX_CITY_RADIUS_KM = 35.0;
const DEFAULT_MIN_IMPROVEMENT_MIN = 30;
const DEFAULT_MAX_FALLBACK_PROBES = 2;

const TIER_PRIORITY: Record<ObservationTier, number> = {
  'ground-official': 3,
  'station-grid-fusion': 2,
  'numerical-model': 1,
};

/**
 * Strategy A Region-Aware Observational Routing Chains:
 * - Strictly observational providers only (numerical-model Open-Meteo is NEVER mixed into realtime).
 * - Unconfigured providers (missing API key) are skipped in O(1) without network calls.
 */
const REALTIME_CHAINS_BY_REGION: Record<string, readonly ProviderId[]> = {
  CN: ['qweather', 'waqi', 'openaq'],
  HK: ['qweather', 'waqi', 'openaq'],
  MO: ['qweather', 'waqi', 'openaq'],
  TW: ['openaq', 'qweather', 'waqi'],
  US: ['openaq', 'waqi', 'qweather'],
  CA: ['openaq', 'waqi', 'qweather'],
  DEFAULT: ['waqi', 'openaq', 'qweather'],
};

// Decoupled past 24~72h historical trend chains: even when realtime switches to QWeather,
// past 3-day observed AQI seamlessly continues via WAQI 72h / OpenAQ 72h.
const HOURLY_CHAINS_BY_REGION: Record<string, readonly ProviderId[]> = {
  TW: ['openaq', 'waqi'],
  DEFAULT: ['waqi', 'openaq'],
};

// Decoupled 5-day forecast chain: WAQI station dispersion model primary -> Open-Meteo ECMWF/CAMS -> QWeather fallback
const FORECAST_CHAIN: readonly ProviderId[] = [
  'waqi',
  'open-meteo',
  'qweather',
];

export function getRealtimeChainForCountry(country?: string): readonly ProviderId[] {
  const code = (country || '').toUpperCase();
  return REALTIME_CHAINS_BY_REGION[code] || REALTIME_CHAINS_BY_REGION.DEFAULT;
}

/**
 * Unified AGENTS.md §9 spatial & freshness filter applied across ALL providers:
 * 1. Hard 35km physical distance boundary
 * 2. Sovereign country match (with HK/MO <-> CN compatibility)
 * 3. Geometric Voronoi nearest-city exclusion (0 string heuristics)
 * 4. Official reference stations prioritized over community micro-sensors
 * 5. Zombie station pruning (>4h stale dropped when fresher stations exist)
 * 6. Freshness-first + distance-second sorting
 */
export function filterAndRankStationsForCity(
  rawStations: NormalizedStationSample[],
  city: CityMeta,
  nowMs: number,
  allCities: CityMeta[] = CITIES_REGISTRY
): NormalizedStationSample[] {
  if (!rawStations || rawStations.length === 0) return [];

  const neighbors = allCities.filter(
    (c) =>
      c.id !== city.id &&
      getDistanceKm(c.latitude, c.longitude, city.latitude, city.longitude) <= 160
  );

  const spatiallyValid: Array<{ sample: NormalizedStationSample; distKm: number; observedAtMs?: number }> = [];

  for (const s of rawStations) {
    if (typeof s.latitude !== 'number' || typeof s.longitude !== 'number') continue;
    if (!hasValidPollutants(s.pollutants) && !(s.rawUsAqi && s.rawUsAqi > 0 && s.rawUsAqi <= 500)) {
      continue;
    }

    const distToTarget = getDistanceKm(s.latitude, s.longitude, city.latitude, city.longitude);
    if (distToTarget > MAX_CITY_RADIUS_KM) continue;

    const stCountry = iso1A2Code([s.longitude, s.latitude]);
    if (!isSameSovereignCountry(stCountry, city.country)) continue;

    let nearerNeighbor = false;
    for (let j = 0; j < neighbors.length; j++) {
      const nb = neighbors[j];
      if (getDistanceKm(s.latitude, s.longitude, nb.latitude, nb.longitude) < distToTarget) {
        nearerNeighbor = true;
        break;
      }
    }
    if (nearerNeighbor) continue;

    spatiallyValid.push({
      sample: s,
      distKm: distToTarget,
      observedAtMs: s.freshness?.observedAtMs,
    });
  }

  if (spatiallyValid.length === 0) return [];

  // Official stations strictly preferred when present
  const official = spatiallyValid.filter((x) => x.sample.isOfficial);
  const pool = official.length > 0 ? official : spatiallyValid;

  // Eliminate >4h stale zombie sensors when city has active fresh sensors
  const alive = pruneStaleStations(pool, nowMs);

  // Freshness-first (within 60 min of city's freshest station), then closest to city center
  const ranked = sortStationsByFreshnessAndDistance(alive);
  return ranked.map((x) => x.sample);
}

function buildRecordFromSample(
  sample: NormalizedStationSample,
  city: CityMeta,
  provenance: DataProvenance,
  snapshot: ProviderCitySnapshot
): AirQualityRecord {
  const pollutants = sample.pollutants || {};
  const iaqiCN = calculateCNIAQI(pollutants);
  const iaqiUS = calculateUSIAQI(pollutants);

  let evaluationCN = evaluateAQI(pollutants, 'CN');
  let evaluationUS = evaluateAQI(pollutants, 'US');
  const isOffline = Boolean(sample.isOffline || snapshot.isOffline);

  if (isOffline) {
    const lastCN = evaluationCN.aqi || 0;
    const lastUS = evaluationUS.aqi || 0;
    evaluationCN = {
      ...evaluationCN,
      aqi: lastCN,
      level: lastCN > 0 ? evaluationCN.level : '暂无数据',
      levelEn: lastCN > 0 ? evaluationCN.levelEn : 'No Data',
      color: '#64748b',
      textColor: '#ffffff',
      isOffline: true,
    };
    evaluationUS = {
      ...evaluationUS,
      aqi: lastUS,
      level: lastUS > 0 ? evaluationUS.level : 'No Data',
      levelEn: lastUS > 0 ? evaluationUS.levelEn : 'No Data',
      color: '#64748b',
      textColor: '#ffffff',
      isOffline: true,
    };
  } else if (evaluationUS.aqi === 0 && sample.rawUsAqi && sample.rawUsAqi > 0) {
    evaluationUS = getUSEvaluation(Math.round(sample.rawUsAqi), evaluationUS.primaryPollutant);
    const estPm25 = convertIAQIToConcentration('pm25', sample.rawUsAqi, 'US');
    evaluationCN = evaluateAQI({ pm25: estPm25 }, 'CN');
  }

  const obsMs = sample.freshness?.observedAtMs;
  const fallbackCityTime = formatLocalTimeForCityWithTz(
    obsMs || Date.now(),
    city.country,
    city.longitude,
    city.latitude
  );
  const canUseUpstreamLocal = Boolean(
    sample.freshness?.observedAtLocal &&
      (!obsMs ||
        isPlausibleLocalOffsetForCity(
          sample.freshness.observedAtLocal,
          obsMs,
          city.country,
          city.longitude,
          city.latitude
        ))
  );
  const updateTime = canUseUpstreamLocal
    ? formatDisplayTimeFromIso(sample.freshness!.observedAtLocal!)
    : fallbackCityTime.localTime;
  const timezoneOffset = canUseUpstreamLocal
    ? sample.freshness?.timezoneOffset ||
      extractUtcOffsetLabel(sample.freshness?.observedAtLocal) ||
      fallbackCityTime.timezoneOffset
    : fallbackCityTime.timezoneOffset;
  const resolvedFreshness: FreshnessMeta | undefined = sample.freshness
    ? {
        ...sample.freshness,
        timezoneOffset,
      }
    : undefined;

  return {
    id: city.id,
    name: city.nameZh,
    nameEn: city.nameEn,
    country: city.country,
    isDomestic: Boolean(city.isDomestic),
    isOffline,
    stationIdx: sample.providerId === 'waqi' ? sample.numericUid : undefined,
    latitude: Number.isFinite(sample.latitude) ? sample.latitude : city.latitude,
    longitude: Number.isFinite(sample.longitude) ? sample.longitude : city.longitude,
    updateTime,
    pollutants,
    iaqi: iaqiUS,
    iaqiCN,
    iaqiUS,
    evaluationCN,
    evaluationUS,
    weather: sample.weather,
    forecast: snapshot.forecast,
    sourceAttribution: snapshot.attributions,
    freshness: resolvedFreshness,
    provenance,
  };
}

function toStationCompositeSample(sample: NormalizedStationSample): StationCompositeSample & {
  stationId: NormalizedStationSample['stationId'];
  providerId: ProviderId;
  observedAtMs?: number;
  delayMinutes?: number;
} {
  const usEval = hasValidPollutants(sample.pollutants)
    ? evaluateAQI(sample.pollutants, 'US')
    : null;
  const aqiVal =
    sample.rawUsAqi && sample.rawUsAqi > 0
      ? Math.round(sample.rawUsAqi)
      : usEval?.aqi || 0;

  return {
    uid: sample.numericUid,
    stationId: sample.stationId,
    providerId: sample.providerId,
    lat: sample.latitude,
    lon: sample.longitude,
    aqi: aqiVal > 0 ? String(aqiVal) : '-',
    station: {
      name: sample.name,
      time: sample.freshness?.observedAtIso || '',
    },
    observedAtMs: sample.freshness?.observedAtMs,
    delayMinutes: sample.freshness?.delayMinutes,
    pm25: sample.pollutants.pm25,
    pm25IaqiUS: sample.pm25IaqiUS ?? calculateUSIAQI(sample.pollutants).pm25,
    pm25IaqiCN: sample.pm25IaqiCN ?? calculateCNIAQI(sample.pollutants).pm25,
    pollutants: sample.pollutants,
    weather: sample.weather,
  };
}

interface EvaluatedCandidate {
  snapshot: ProviderCitySnapshot;
  stations: NormalizedStationSample[];
  representative: NormalizedStationSample;
  freshness?: FreshnessMeta;
  isOffline: boolean;
}

function evaluateSnapshot(
  snapshot: ProviderCitySnapshot,
  city: CityMeta,
  nowMs: number
): EvaluatedCandidate | null {
  const rankedStations = filterAndRankStationsForCity(snapshot.stations, city, nowMs);
  const representative = rankedStations[0] || snapshot.directCityReading;
  if (!representative) return null;

  // Compute representative freshness: prefer freshest station in ranked list or direct reading
  const observedMs =
    representative.freshness?.observedAtMs ??
    snapshot.directCityReading?.freshness?.observedAtMs;
  const freshness =
    representative.freshness ??
    (observedMs ? computeFreshness(observedMs, nowMs) : undefined);

  const isOffline = Boolean(
    snapshot.isOffline ||
      (representative.isOffline && rankedStations.every((s) => s.isOffline))
  );

  return {
    snapshot,
    stations: rankedStations,
    representative,
    freshness,
    isOffline,
  };
}

/**
 * Determine if `challenger` should replace `incumbent` under Strategy A (Freshness-First).
 */
function shouldSwitchToChallenger(
  incumbent: EvaluatedCandidate,
  challenger: EvaluatedCandidate,
  staleThresholdMin: number,
  minImprovementMin: number
): boolean {
  // Live always beats offline
  if (incumbent.isOffline && !challenger.isOffline) return true;
  if (!incumbent.isOffline && challenger.isOffline) return false;

  const incDelay = incumbent.freshness?.delayMinutes;
  const chalDelay = challenger.freshness?.delayMinutes;
  const incEstimated = Boolean(incumbent.freshness?.isEstimatedTime);
  const chalEstimated = Boolean(challenger.freshness?.isEstimatedTime);

  // If challenger has a valid timestamp and incumbent does not
  if (incDelay === undefined && chalDelay !== undefined) return true;
  if (incDelay !== undefined && chalDelay === undefined) return false;

  // Fairness rule for providers without explicit upstream timestamps (e.g. QWeather v1):
  // Never let an estimated timestamp unfairly displace a verified, fresh (<= 90m) official observation!
  if (incDelay !== undefined && chalDelay !== undefined) {
    const incVerifiedFresh = !incEstimated && incDelay <= staleThresholdMin;
    const chalVerifiedFresh = !chalEstimated && chalDelay <= staleThresholdMin;
    if (incVerifiedFresh && chalEstimated) return false;
    if (incEstimated && chalVerifiedFresh) return true;

    // Incumbent is stale (> 90m) and challenger is fresh (<= 90m) -> definitely switch!
    if (incDelay > staleThresholdMin && chalDelay <= staleThresholdMin) {
      return true;
    }
    // Challenger is significantly fresher (>= 30m newer) -> switch!
    if (incDelay - chalDelay >= minImprovementMin) {
      return true;
    }
    // Incumbent is significantly fresher -> keep incumbent
    if (chalDelay - incDelay >= minImprovementMin) {
      return false;
    }
  }

  // Tie-breaker when freshness is similar (<30m diff): prefer higher observation tier, then more stations
  const incTier = TIER_PRIORITY[incumbent.snapshot.tier];
  const chalTier = TIER_PRIORITY[challenger.snapshot.tier];
  if (chalTier !== incTier) return chalTier > incTier;

  return challenger.stations.length > incumbent.stations.length;
}

/**
 * Best-effort meteorological weather enrichment (temp/humidity/wind/pressure ONLY — NEVER touches AQI/pollutants)
 * via free keyless Open-Meteo Weather API when the winning AQI provider (e.g. QWeather AQ / OpenAQ / HK EPD)
 * does not return meteorological parameters.
 */
async function fetchOpenMeteoCurrentWeather(
  lat: number,
  lon: number,
  ctx: ProviderRuntimeContext
): Promise<WeatherInfo | undefined> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,surface_pressure&wind_speed_unit=ms`;
    const res = await ctx.fetchImpl(url, {
      signal: createTimeoutSignal(1200, ctx.signal),
    });
    if (!res.ok) return undefined;
    const json = (await res.json()) as any;
    const cur = json?.current;
    if (!cur || typeof cur !== 'object') return undefined;

    const round = (v: unknown, d = 1) =>
      typeof v === 'number' && Number.isFinite(v)
        ? Math.round(v * Math.pow(10, d)) / Math.pow(10, d)
        : undefined;

    const weather: WeatherInfo = {
      temp: round(cur.temperature_2m, 1),
      humidity: round(cur.relative_humidity_2m, 0),
      windSpeed: round(cur.wind_speed_10m, 1),
      pressure: round(cur.surface_pressure, 1),
    };
    return weather.temp !== undefined || weather.humidity !== undefined ? weather : undefined;
  } catch {
    return undefined;
  }
}

export class DataSourceOrchestrator {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly defaultOptions: OrchestratorOptions = {}
  ) {}

  private async querySingleProvider(
    provider: AirQualityProvider,
    city: CityMeta,
    ctx: ProviderRuntimeContext
  ): Promise<{
    evaluated: EvaluatedCandidate | null;
    failReason?: 'offline' | 'error' | 'rate-limited';
  }> {
    try {
      const snapshot = await provider.realtime!.fetchCitySnapshot(city, ctx);
      if (!snapshot) {
        return { evaluated: null, failReason: 'offline' };
      }
      this.registry.breaker.recordSuccess(provider.id);
      const evaluated = evaluateSnapshot(snapshot, city, ctx.nowMs);
      if (!evaluated) {
        return { evaluated: null, failReason: 'offline' };
      }
      return { evaluated };
    } catch (err: any) {
      const status = typeof err?.status === 'number' ? err.status : undefined;
      console.warn(`[Orchestrator] ${provider.id} failed for ${city.id}:`, err?.message || err);
      this.registry.breaker.recordFailure(provider.id, {
        status,
        message: err?.message,
        nowMs: ctx.nowMs,
      });
      return {
        evaluated: null,
        failReason: status === 429 ? 'rate-limited' : 'error',
      };
    }
  }

  /**
   * Fetch multi-source city realtime snapshot using Strategy A (Turbo):
   * - Step 1: Query region-primary provider; if live & fresh (<= 90m), return immediately (0 extra subrequests).
   * - Step 2: If primary fails/offline/stale (> 90m), probe up to `maxFallbackProbes` backups IN PARALLEL
   *   and pick the freshest high-tier observational winner, cutting cold failover latency in half.
   * - Step 3: Enrich missing meteorological weather (temp/humidity/wind/pressure) via keyless Open-Meteo Weather.
   */
  async fetchCityRealtime(
    city: CityMeta,
    ctx: ProviderRuntimeContext,
    options?: OrchestratorOptions
  ): Promise<OrchestratedCityRealtimePayload | null> {
    const strategy = options?.strategy ?? this.defaultOptions.strategy ?? 'region-freshness';
    const staleThresholdMin =
      options?.staleThresholdMinutes ??
      this.defaultOptions.staleThresholdMinutes ??
      DEFAULT_STALE_THRESHOLD_MIN;
    const minImprovementMin =
      options?.minFreshnessImprovementMinutes ??
      this.defaultOptions.minFreshnessImprovementMinutes ??
      DEFAULT_MIN_IMPROVEMENT_MIN;
    const maxFallbackProbes =
      options?.maxFallbackProbes ??
      this.defaultOptions.maxFallbackProbes ??
      DEFAULT_MAX_FALLBACK_PROBES;

    const preferredOrder = getRealtimeChainForCountry(city.country);
    const candidates = this.registry.resolveCandidates(
      preferredOrder,
      city.country,
      ctx,
      'realtime'
    );

    if (candidates.length === 0) return null;

    let best: EvaluatedCandidate | null = null;
    let firstAttemptInfo:
      | {
          providerId: ProviderId;
          reason: 'stale' | 'offline' | 'error' | 'rate-limited' | 'unsupported';
          delayMinutes?: number;
        }
      | undefined;

    // 1. Primary attempt (hint if backup providers exist so primary can fast-fail when already stale)
    // For weatherless primaries (QWeather / OpenAQ / HK EPD), kick off free Open-Meteo weather in parallel (0ms added RTT)
    const primary = candidates[0];
    const primaryCtx: ProviderRuntimeContext =
      candidates.length > 1 ? { ...ctx, hasBackupCandidate: true } : ctx;
    const allowWeatherEnrich = ctx.enrichWeather ?? !ctx.isServer;
    const weatherPromise: Promise<WeatherInfo | undefined> | null =
      allowWeatherEnrich && primary.id !== 'waqi'
        ? fetchOpenMeteoCurrentWeather(city.latitude, city.longitude, ctx)
        : null;
    const primaryOutcome = await this.querySingleProvider(primary, city, primaryCtx);

    let needBackup = true;
    if (primaryOutcome.evaluated) {
      best = primaryOutcome.evaluated;
      const delayMin = best.freshness?.delayMinutes ?? 0;
      const isAcceptable =
        !best.isOffline &&
        (strategy === 'priority-only' || delayMin <= staleThresholdMin);

      if (isAcceptable) {
        needBackup = false; // Fast path: primary is live & fresh!
      } else {
        firstAttemptInfo = {
          providerId: primary.id,
          reason: best.isOffline ? 'offline' : 'stale',
          delayMinutes: best.freshness?.delayMinutes,
        };
      }
    } else {
      firstAttemptInfo = {
        providerId: primary.id,
        reason: primaryOutcome.failReason || 'offline',
      };
    }

    // 2. Parallel backup probing when primary failed, offline, or stale (> 90m)
    if (needBackup && !ctx.signal?.aborted && candidates.length > 1 && maxFallbackProbes > 0) {
      const backups = candidates.slice(1, 1 + maxFallbackProbes);
      const backupOutcomes = await Promise.all(
        backups.map((provider) => this.querySingleProvider(provider, city, ctx))
      );

      for (const outcome of backupOutcomes) {
        if (!outcome.evaluated) continue;
        if (!best) {
          best = outcome.evaluated;
        } else if (
          shouldSwitchToChallenger(best, outcome.evaluated, staleThresholdMin, minImprovementMin)
        ) {
          best = outcome.evaluated;
        }
      }

      // If all parallel backups failed and we still have no result, try any remaining candidates
      if (!best && candidates.length > 1 + maxFallbackProbes) {
        for (let i = 1 + maxFallbackProbes; i < candidates.length; i++) {
          if (ctx.signal?.aborted) break;
          const outcome = await this.querySingleProvider(candidates[i], city, ctx);
          if (outcome.evaluated) {
            best = outcome.evaluated;
            break;
          }
        }
      }
    }

    if (!best) return null;

    const provenance: DataProvenance = {
      providerId: best.snapshot.providerId,
      providerName: best.snapshot.providerName,
      tier: best.snapshot.tier,
      ...(firstAttemptInfo && firstAttemptInfo.providerId !== best.snapshot.providerId
        ? { fallbackFrom: firstAttemptInfo }
        : {}),
    };

    const baseRecord = buildRecordFromSample(
      best.representative,
      city,
      provenance,
      best.snapshot
    );
    const resolvedFreshness = baseRecord.freshness ?? best.freshness;

    const compositeStations = best.stations.map(toStationCompositeSample);
    let compositeRecord =
      compositeStations.length > 0
        ? {
            ...aggregateCompositeRecord(baseRecord, compositeStations, city, 'CN', false),
            freshness: resolvedFreshness,
            provenance,
          }
        : {
            ...baseRecord,
            id: `${city.id}-composite`,
            compositeStationCount: 1,
            freshness: resolvedFreshness,
            provenance,
          };

    // 2.5 若主源为 1x1km 融合源且未返回国控子站列表（如和风天气），按需花 1 次 WAQI bounds 补齐本地官方微站列表
    // （所有辅助微站明确标注 providerId: 'waqi'，绝不混入或污染和风主卡片的 compositeRecord 均值！）
    let finalStations = compositeStations;
    if (
      finalStations.length === 0 &&
      best.snapshot.providerId !== 'waqi' &&
      !ctx.signal?.aborted &&
      ctx.env.waqiTokens &&
      ctx.env.waqiTokens.length > 0
    ) {
      const waqiProv = this.registry.get('waqi');
      if (waqiProv?.bounds && waqiProv.isAvailable(ctx) && !this.registry.breaker.isOpen('waqi', ctx.nowMs)) {
        try {
          const boundRaw = await waqiProv.bounds.fetchStationsInBounds(
            {
              minLat: city.latitude - 0.35,
              minLon: city.longitude - 0.35,
              maxLat: city.latitude + 0.35,
              maxLon: city.longitude + 0.35,
            },
            { ...ctx, timeoutMs: 2200 }
          );
          const rankedAux = filterAndRankStationsForCity(
            boundRaw.filter((s) => !s.isOffline),
            city,
            ctx.nowMs
          );
          if (rankedAux.length > 0) {
            finalStations = rankedAux.map(toStationCompositeSample);
          }
        } catch {
          // 辅助微站补齐失败不影响主实况卡片
        }
      }
    }

    // 3. Best-effort free meteorological weather enrichment when AQI provider omits temp/humidity/wind/pressure
    const shouldEnrichWeather =
      allowWeatherEnrich &&
      compositeRecord.weather?.temp === undefined &&
      !ctx.signal?.aborted;

    if (shouldEnrichWeather) {
      const liveWeather = await (weatherPromise ??
        fetchOpenMeteoCurrentWeather(city.latitude, city.longitude, ctx));
      if (liveWeather) {
        baseRecord.weather = mergeWeatherInfo(liveWeather, baseRecord.weather);
        compositeRecord = {
          ...compositeRecord,
          weather: mergeWeatherInfo(liveWeather, compositeRecord.weather),
        };
      }
    }

    return {
      success: true,
      cityId: city.id,
      baseRecord,
      stations: finalStations,
      compositeRecord,
      totalOfficialStations: finalStations.length,
      sampledStations:
        compositeRecord.compositeStationCount || Math.max(1, finalStations.length),
      updatedAt: new Date(ctx.nowMs).toISOString(),
      provenance,
      freshness: resolvedFreshness,
    };
  }

  /**
   * Fetch 24~72h real hourly trend: prioritizes the active realtime provider first,
   * then seamlessly falls back across other configured hourly-capable providers.
   */
  async fetchHourlyTrend(
    query: {
      city: CityMeta;
      preferredProviderId?: ProviderId;
      stationRawId?: string;
      standard: StandardType;
      hours?: number;
    },
    ctx: ProviderRuntimeContext
  ): Promise<HourlyTrendResult> {
    const regionOrder =
      HOURLY_CHAINS_BY_REGION[(query.city.country || '').toUpperCase()] ||
      HOURLY_CHAINS_BY_REGION.DEFAULT;

    const ordered: ProviderId[] = query.preferredProviderId
      ? [query.preferredProviderId, ...regionOrder]
      : [...regionOrder];

    const candidates = this.registry.resolveCandidates(
      ordered,
      query.city.country,
      ctx,
      'hourlyTrend'
    );

    for (const provider of candidates) {
      if (ctx.signal?.aborted) break;
      try {
        const res = await provider.hourlyTrend!.fetchHourlyTrend(
          {
            city: query.city,
            // Only forward stationRawId to the matching provider
            stationRawId:
              provider.id === query.preferredProviderId ? query.stationRawId : undefined,
            standard: query.standard,
            hours: query.hours,
          },
          ctx
        );
        if (res && res.points.length >= 3) {
          this.registry.breaker.recordSuccess(provider.id);
          const fallbackTz = formatLocalTimeForCityWithTz(
            ctx.nowMs,
            query.city.country,
            query.city.longitude,
            query.city.latitude
          ).timezoneOffset;
          return {
            ...res,
            providerId: res.providerId ?? provider.id,
            providerName: res.providerName ?? provider.shortName,
            timezoneOffset: res.timezoneOffset ?? fallbackTz,
          };
        }
      } catch (err: any) {
        this.registry.breaker.recordFailure(provider.id, {
          status: typeof err?.status === 'number' ? err.status : undefined,
          message: err?.message,
          nowMs: ctx.nowMs,
        });
      }
    }

    return {
      points: [],
      isReal: false,
      source: '该站点暂无逐小时实测发布',
    };
  }

  /**
   * Fetch 5-day air quality forecast (WAQI station dispersion primary, Open-Meteo CAMS / QWeather fallback).
   */
  async fetch5DayForecast(
    lat: number,
    lon: number,
    ctx: ProviderRuntimeContext,
    city?: CityMeta
  ): Promise<{ list: ForecastDay[]; source: string }> {
    const candidates = this.registry.resolveCandidates(FORECAST_CHAIN, city?.country, ctx, 'forecast');

    for (const provider of candidates) {
      if (ctx.signal?.aborted) break;
      try {
        const result = await provider.forecast!.fetch5DayForecast(lat, lon, ctx, city);
        if (result && result.list.length > 0) {
          this.registry.breaker.recordSuccess(provider.id);
          return result;
        }
      } catch (err: any) {
        this.registry.breaker.recordFailure(provider.id, {
          status: typeof err?.status === 'number' ? err.status : undefined,
          message: err?.message,
          nowMs: ctx.nowMs,
        });
      }
    }

    return { list: [], source: '官方预报暂未发布' };
  }
}
