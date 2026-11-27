import type { CityMeta, ForecastDay, PollutantValues } from '../../types';
import { calculateCNIAQI, calculateUSIAQI, evaluateAQI } from '../../aqi-calculator';
import {
  computeFreshness,
  hasValidPollutants,
  hashStationIdToUid,
  parseObservedTimeMs,
} from '../freshness';
import { createTimeoutSignal, normalizePollutantUnit } from '../units';
import type {
  AirQualityProvider,
  NormalizedStationSample,
  ProviderCitySnapshot,
  ProviderRuntimeContext,
} from '../types';

const OW_BASE = 'https://api.openweathermap.org/data/2.5/air_pollution';

function createHttpError(status: number, message: string): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

function parseOpenWeatherComponents(comp: any): PollutantValues {
  if (!comp || typeof comp !== 'object') return {};
  // OpenWeather returns ALL components in μg/m³ (so CO must convert μg/m³ -> mg/m³)
  return {
    pm25: normalizePollutantUnit('pm25', Number(comp.pm2_5), 'ug/m3'),
    pm10: normalizePollutantUnit('pm10', Number(comp.pm10), 'ug/m3'),
    o3: normalizePollutantUnit('o3', Number(comp.o3), 'ug/m3'),
    no2: normalizePollutantUnit('no2', Number(comp.no2), 'ug/m3'),
    so2: normalizePollutantUnit('so2', Number(comp.so2), 'ug/m3'),
    co: normalizePollutantUnit('co', Number(comp.co), 'ug/m3'),
  };
}

/**
 * OpenWeather Air Pollution API Provider:
 * - Free tier (1,000 calls/day), global coverage, all 6 pollutants in μg/m³
 * - Requires `OPENWEATHER_API_KEY`
 */
export const openweatherProvider: AirQualityProvider = {
  id: 'openweather',
  name: 'OpenWeather 空气质量',
  shortName: 'OpenWeather',
  tier: 'station-grid-fusion',
  supportedCountries: '*',
  supportsBrowserDirect: false,

  isAvailable(ctx: ProviderRuntimeContext): boolean {
    return Boolean(ctx.env.openweatherApiKey);
  },

  realtime: {
    async fetchCitySnapshot(
      city: CityMeta,
      ctx: ProviderRuntimeContext
    ): Promise<ProviderCitySnapshot | null> {
      const apiKey = ctx.env.openweatherApiKey;
      if (!apiKey) return null;

      const url = `${OW_BASE}?lat=${city.latitude.toFixed(4)}&lon=${city.longitude.toFixed(4)}&appid=${encodeURIComponent(apiKey)}`;
      const res = await ctx.fetchImpl(url, {
        cache: 'no-store',
        signal: createTimeoutSignal(ctx.timeoutMs ?? 4500, ctx.signal),
      });
      if (res.status === 401 || res.status === 403 || res.status === 429) {
        throw createHttpError(res.status, `OpenWeather HTTP ${res.status}`);
      }
      if (!res.ok) return null;

      const json = (await res.json()) as any;
      const entry = Array.isArray(json?.list) ? json.list[0] : null;
      if (!entry) return null;

      const pollutants = parseOpenWeatherComponents(entry.components);
      if (!hasValidPollutants(pollutants)) return null;

      const obsMs = parseObservedTimeMs(entry.dt);
      const canonicalId = `openweather:${city.id}` as const;

      const reading: NormalizedStationSample = {
        stationId: canonicalId,
        providerId: 'openweather',
        rawId: city.id,
        numericUid: hashStationIdToUid(canonicalId),
        name: `${city.nameZh} OpenWeather 融合观测`,
        latitude: city.latitude,
        longitude: city.longitude,
        isOfficial: true,
        freshness: computeFreshness(obsMs, ctx.nowMs),
        pollutants,
        rawUsAqi: evaluateAQI(pollutants, 'US').aqi,
        pm25IaqiUS: calculateUSIAQI(pollutants).pm25,
        pm25IaqiCN: calculateCNIAQI(pollutants).pm25,
      };

      return {
        providerId: 'openweather',
        providerName: 'OpenWeather',
        tier: 'station-grid-fusion',
        stations: [],
        directCityReading: reading,
        attributions: [{ name: 'OpenWeather Air Pollution API', url: 'https://openweathermap.org/' }],
        subrequestsUsed: 1,
      };
    },
  },

  forecast: {
    async fetch5DayForecast(lat, lon, ctx) {
      const apiKey = ctx.env.openweatherApiKey;
      if (!apiKey) return null;

      const url = `${OW_BASE}/forecast?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&appid=${encodeURIComponent(apiKey)}`;
      const res = await ctx.fetchImpl(url, {
        signal: createTimeoutSignal(ctx.timeoutMs ?? 4500, ctx.signal),
      });
      if (!res.ok) return null;

      const json = (await res.json()) as any;
      const items: any[] = Array.isArray(json?.list) ? json.list : [];
      if (items.length === 0) return null;

      const byDay: Record<string, number[]> = {};
      for (const item of items) {
        const ms = parseObservedTimeMs(item?.dt);
        const pm25 = Number(item?.components?.pm2_5);
        if (!ms || !Number.isFinite(pm25) || pm25 <= 0) continue;
        const day = new Date(ms).toISOString().slice(0, 10);
        if (!byDay[day]) byDay[day] = [];
        byDay[day].push(pm25);
      }

      const list: ForecastDay[] = Object.entries(byDay)
        .slice(0, 5)
        .map(([day, vals]) => ({
          day,
          min: Math.round(Math.min(...vals)),
          max: Math.round(Math.max(...vals)),
          avg: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length),
        }));

      if (list.length === 0) return null;
      return { list, source: 'OpenWeather 空气质量预报' };
    },
  },
};
