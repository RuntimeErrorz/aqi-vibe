import type { CityMeta, ForecastDay, ProviderId, StandardType } from '../types';
import type { HourlyTrendResult } from '../services/realtime-trend';
import { DataSourceOrchestrator, filterAndRankStationsForCity, getRealtimeChainForCountry } from './orchestrator';
import { ProviderRegistry, RawEnvBag, resolveProviderSecrets } from './registry';
import type {
  OrchestratedCityRealtimePayload,
  OrchestratorOptions,
  ProviderRuntimeContext,
  ProviderSecrets,
} from './types';
import { waqiProvider } from './providers/waqi.provider';
import { qweatherProvider } from './providers/qweather.provider';
import { openaqProvider } from './providers/openaq.provider';
import { openMeteoProvider } from './providers/openmeteo.provider';

export function createDefaultProviderRegistry(): ProviderRegistry {
  const registry = new ProviderRegistry();
  registry.register(qweatherProvider);
  registry.register(waqiProvider);
  registry.register(openaqProvider);
  registry.register(openMeteoProvider);
  return registry;
}

export const defaultProviderRegistry = createDefaultProviderRegistry();
export const defaultOrchestrator = new DataSourceOrchestrator(defaultProviderRegistry, {
  strategy: 'region-freshness', // Strategy A: Region-aware + >90m freshness auto-failover
  staleThresholdMinutes: 90,
  minFreshnessImprovementMinutes: 30,
  maxFallbackProbes: 2,
});

export const PROVIDER_SHORT_LABELS: Record<ProviderId, string> = {
  waqi: 'WAQI',
  qweather: '和风天气',
  openaq: 'OpenAQ',
  'open-meteo': 'ECMWF CAMS',
};

export function createRuntimeContext(options?: {
  rawEnv?: RawEnvBag;
  secrets?: ProviderSecrets;
  fetchImpl?: typeof fetch;
  nowMs?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxStations?: number;
  concurrency?: number;
  isServer?: boolean;
  origin?: string;
}): ProviderRuntimeContext {
  const isServer = options?.isServer ?? typeof window === 'undefined';
  const rawFetch = options?.fetchImpl ?? fetch;
  // IMPORTANT: Wrap fetch in an arrow function so calling `ctx.fetchImpl(...)` never passes `this = ctx`,
  // which throws `TypeError: Illegal invocation` in Cloudflare Workers (workerd)!
  const boundFetch: typeof fetch = (input, init) => {
    if (isServer && init && 'cache' in init) {
      // Cloudflare Workers workerd throws on `cache: 'no-store'` in RequestInit
      const { cache: _ignoredCache, ...rest } = init;
      return rawFetch(input, rest);
    }
    return rawFetch(input, init);
  };

  return {
    env: options?.secrets ?? resolveProviderSecrets(options?.rawEnv),
    fetchImpl: boundFetch,
    nowMs: options?.nowMs ?? Date.now(),
    signal: options?.signal,
    timeoutMs: options?.timeoutMs,
    maxStations: options?.maxStations,
    concurrency: options?.concurrency,
    isServer,
    enrichWeather: !options?.fetchImpl || options.fetchImpl === fetch,
    origin:
      options?.origin ??
      (typeof window !== 'undefined' && window.location?.origin ? window.location.origin : undefined),
  };
}

/**
 * Unified multi-source city realtime query (Strategy A).
 */
export async function fetchCityRealtimeMultiSource(
  city: CityMeta,
  ctxOptions?: Parameters<typeof createRuntimeContext>[0],
  orchestratorOptions?: OrchestratorOptions
): Promise<OrchestratedCityRealtimePayload | null> {
  const ctx = createRuntimeContext(ctxOptions);
  return defaultOrchestrator.fetchCityRealtime(city, ctx, orchestratorOptions);
}

/**
 * Unified multi-source 24-72h hourly trend query.
 */
export async function fetchHourlyTrendMultiSource(
  query: {
    city: CityMeta;
    preferredProviderId?: ProviderId;
    stationRawId?: string;
    standard: StandardType;
    hours?: number;
  },
  ctxOptions?: Parameters<typeof createRuntimeContext>[0]
): Promise<HourlyTrendResult> {
  const ctx = createRuntimeContext(ctxOptions);
  return defaultOrchestrator.fetchHourlyTrend(query, ctx);
}

/**
 * Unified multi-source 5-day forecast query (WAQI station dispersion primary -> Open-Meteo CAMS -> QWeather).
 */
export async function fetch5DayForecastMultiSource(
  lat: number,
  lon: number,
  ctxOptions?: Parameters<typeof createRuntimeContext>[0],
  city?: CityMeta
): Promise<{ list: ForecastDay[]; source: string }> {
  const ctx = createRuntimeContext(ctxOptions);
  return defaultOrchestrator.fetch5DayForecast(lat, lon, ctx, city);
}

export {
  DataSourceOrchestrator,
  ProviderRegistry,
  resolveProviderSecrets,
  filterAndRankStationsForCity,
  getRealtimeChainForCountry,
};
export type { RawEnvBag };
export * from './types';
export * from './freshness';
export * from './units';
