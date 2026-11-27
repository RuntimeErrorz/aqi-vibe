import type {
  AirQualityRecord,
  CityMeta,
  DataProvenance,
  ForecastData,
  ForecastDay,
  FreshnessMeta,
  ObservationTier,
  PollutantValues,
  ProviderId,
  StandardType,
  WeatherInfo,
} from '../types';
import type { HourlyTrendResult } from '../services/realtime-trend';

export type CanonicalStationId = `${ProviderId}:${string}`;

export interface ProviderSecrets {
  waqiTokens?: string[];
  qweatherHost?: string;
  qweatherApiKey?: string;
  qweatherJwt?: string;
  qweatherDeveloperId?: string;
  qweatherProjectId?: string;
  qweatherCredentialId?: string;
  qweatherPrivateKey?: string;
  openaqApiKey?: string;
}

export interface ProviderRuntimeContext {
  env: ProviderSecrets;
  fetchImpl: typeof fetch;
  nowMs: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxStations?: number;
  concurrency?: number;
  /** True when executing inside Cloudflare Worker or Node server (secrets available, no browser CORS) */
  isServer?: boolean;
  /** Optional origin for same-origin edge proxies when running in browser */
  origin?: string;
  /** Whether to enrich missing meteorological weather via free Open-Meteo current weather API */
  enrichWeather?: boolean;
  /** Hint from orchestrator that alternative observational backup providers exist for failover */
  hasBackupCandidate?: boolean;
}

export interface NormalizedStationSample {
  stationId: CanonicalStationId;
  providerId: ProviderId;
  rawId: string;
  /** Legacy numeric uid for WAQI compatibility; negative hash or 0 for non-WAQI stations */
  numericUid: number;
  name: string;
  latitude: number;
  longitude: number;
  isOfficial: boolean;
  freshness?: FreshnessMeta;
  pollutants: PollutantValues;
  weather?: WeatherInfo;
  /** Optional US AQI fallback when upstream only returns aggregate AQI (e.g. map/bounds) */
  rawUsAqi?: number;
  pm25IaqiUS?: number;
  pm25IaqiCN?: number;
  isOffline?: boolean;
}

export interface ProviderCitySnapshot {
  providerId: ProviderId;
  providerName: string;
  tier: ObservationTier;
  stations: NormalizedStationSample[];
  directCityReading?: NormalizedStationSample;
  forecast?: ForecastData;
  attributions?: Array<{ name: string; url?: string }>;
  subrequestsUsed: number;
  isOffline?: boolean;
}

export interface CityRealtimeCapability {
  fetchCitySnapshot(
    city: CityMeta,
    ctx: ProviderRuntimeContext
  ): Promise<ProviderCitySnapshot | null>;
}

export interface StationDetailCapability {
  fetchStationById(
    rawStationId: string,
    cityMeta: CityMeta | undefined,
    stationName: string | undefined,
    ctx: ProviderRuntimeContext
  ): Promise<AirQualityRecord | null>;
}

export interface MapBoundsCapability {
  fetchStationsInBounds(
    bbox: { minLat: number; minLon: number; maxLat: number; maxLon: number },
    ctx: ProviderRuntimeContext
  ): Promise<NormalizedStationSample[]>;
}

export interface HourlyTrendCapability {
  fetchHourlyTrend(
    query: {
      city: CityMeta;
      stationRawId?: string;
      standard: StandardType;
      hours?: number;
    },
    ctx: ProviderRuntimeContext
  ): Promise<HourlyTrendResult | null>;
}

export interface ForecastCapability {
  fetch5DayForecast(
    lat: number,
    lon: number,
    ctx: ProviderRuntimeContext,
    city?: CityMeta
  ): Promise<{ list: ForecastDay[]; source: string } | null>;
}

export interface MapTileCapability {
  getMapTileUrl(ctx: ProviderRuntimeContext): string;
}

export interface AirQualityProvider {
  readonly id: ProviderId;
  readonly name: string;
  readonly shortName: string;
  readonly tier: ObservationTier;
  readonly supportedCountries: readonly string[] | '*';
  /** Whether direct browser fetch is safe (CORS-enabled & no secret key exposure required) */
  readonly supportsBrowserDirect: boolean;

  isAvailable(ctx: ProviderRuntimeContext): boolean;

  realtime?: CityRealtimeCapability;
  stationDetail?: StationDetailCapability;
  bounds?: MapBoundsCapability;
  hourlyTrend?: HourlyTrendCapability;
  forecast?: ForecastCapability;
  mapTiles?: MapTileCapability;
}

export interface OrchestratedCityRealtimePayload {
  success: boolean;
  cityId: string;
  baseRecord: AirQualityRecord;
  stations: Array<{
    uid: number;
    stationId?: CanonicalStationId;
    providerId?: ProviderId;
    lat: number;
    lon: number;
    aqi: string;
    station: {
      name: string;
      time: string;
    };
    observedAtMs?: number;
    delayMinutes?: number;
    pm25?: number;
    pm25IaqiUS?: number;
    pm25IaqiCN?: number;
    pollutants?: PollutantValues;
    weather?: WeatherInfo;
  }>;
  compositeRecord: AirQualityRecord;
  totalOfficialStations: number;
  sampledStations: number;
  updatedAt: string;
  provenance: DataProvenance;
  freshness?: FreshnessMeta;
}

export type RoutingStrategy = 'region-freshness' | 'priority-only';

export interface OrchestratorOptions {
  strategy?: RoutingStrategy;
  /** Strategy A: trigger backup probe when primary observation delay exceeds this threshold (minutes) */
  staleThresholdMinutes?: number;
  /** Minimum freshness advantage (minutes) required for a backup source to replace a stale primary */
  minFreshnessImprovementMinutes?: number;
  /** Hard cap on backup providers probed per city call (protects Cloudflare 50-subrequest limit) */
  maxFallbackProbes?: number;
}
