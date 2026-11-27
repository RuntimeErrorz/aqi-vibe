import type { CityMeta, ForecastDay, PollutantValues } from '../../types';
import { calculateCNIAQI, calculateUSIAQI, evaluateAQI } from '../../aqi-calculator';
import type { HourlyTrendPoint } from '../../services/realtime-trend';
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

const GOOGLE_AQ_BASE = 'https://airquality.googleapis.com/v1';

function createHttpError(status: number, message: string): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

function parseGooglePollutants(rawList: any[]): PollutantValues {
  const pollutants: PollutantValues = {};
  if (!Array.isArray(rawList)) return pollutants;

  for (const item of rawList) {
    const code = String(item?.code || '').toLowerCase();
    const val = Number(item?.concentration?.value);
    const units = item?.concentration?.units as string | undefined;
    if (!Number.isFinite(val) || val < 0) continue;

    if (code === 'pm25') {
      pollutants.pm25 = normalizePollutantUnit('pm25', val, units);
    } else if (code === 'pm10') {
      pollutants.pm10 = normalizePollutantUnit('pm10', val, units);
    } else if (code === 'o3') {
      pollutants.o3 = normalizePollutantUnit('o3', val, units);
    } else if (code === 'no2') {
      pollutants.no2 = normalizePollutantUnit('no2', val, units);
    } else if (code === 'so2') {
      pollutants.so2 = normalizePollutantUnit('so2', val, units);
    } else if (code === 'co') {
      pollutants.co = normalizePollutantUnit('co', val, units);
    }
  }
  return pollutants;
}

/**
 * Google Maps Platform Air Quality API Provider:
 * - 500m × 500m high-resolution global fusion across 100+ countries (including CN, US, EU, JP, KR)
 * - Supports real-time currentConditions, 24h history, and 96h forecast
 * - Requires `GOOGLE_AQ_API_KEY` (10,000 free requests/month)
 */
export const googleAqProvider: AirQualityProvider = {
  id: 'google-aq',
  name: 'Google Air Quality',
  shortName: 'Google AQ',
  tier: 'station-grid-fusion',
  supportedCountries: '*',
  supportsBrowserDirect: false,

  isAvailable(ctx: ProviderRuntimeContext): boolean {
    return Boolean(ctx.env.googleAqApiKey);
  },

  realtime: {
    async fetchCitySnapshot(
      city: CityMeta,
      ctx: ProviderRuntimeContext
    ): Promise<ProviderCitySnapshot | null> {
      const apiKey = ctx.env.googleAqApiKey;
      if (!apiKey) return null;

      const res = await ctx.fetchImpl(
        `${GOOGLE_AQ_BASE}/currentConditions:lookup?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            location: { latitude: city.latitude, longitude: city.longitude },
            extraComputations: ['POLLUTANT_CONCENTRATION', 'LOCAL_AQI'],
            universalAqi: true,
          }),
          signal: createTimeoutSignal(ctx.timeoutMs ?? 4500, ctx.signal),
        }
      );

      if (res.status === 401 || res.status === 403 || res.status === 429) {
        throw createHttpError(res.status, `Google AQ HTTP ${res.status}`);
      }
      if (!res.ok) return null;

      const json = (await res.json()) as any;
      const pollutants = parseGooglePollutants(json?.pollutants);
      if (!hasValidPollutants(pollutants)) return null;

      const obsMs = parseObservedTimeMs(json?.dateTime);
      const canonicalId = `google-aq:${city.id}` as const;

      const reading: NormalizedStationSample = {
        stationId: canonicalId,
        providerId: 'google-aq',
        rawId: city.id,
        numericUid: hashStationIdToUid(canonicalId),
        name: `${city.nameZh}城区 500m 融合观测`,
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
        providerId: 'google-aq',
        providerName: 'Google AQ',
        tier: 'station-grid-fusion',
        stations: [],
        directCityReading: reading,
        attributions: [{ name: 'Google Air Quality API', url: 'https://developers.google.com/maps/documentation/air-quality' }],
        subrequestsUsed: 1,
      };
    },
  },

  hourlyTrend: {
    async fetchHourlyTrend(query, ctx) {
      const apiKey = ctx.env.googleAqApiKey;
      if (!apiKey) return null;

      const res = await ctx.fetchImpl(
        `${GOOGLE_AQ_BASE}/history:lookup?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            location: { latitude: query.city.latitude, longitude: query.city.longitude },
            hours: Math.min(query.hours ?? 24, 48),
            extraComputations: ['POLLUTANT_CONCENTRATION'],
          }),
          signal: createTimeoutSignal(ctx.timeoutMs ?? 5000, ctx.signal),
        }
      );
      if (res.status === 401 || res.status === 403 || res.status === 429) {
        throw createHttpError(res.status, `Google AQ history HTTP ${res.status}`);
      }
      if (!res.ok) return null;

      const json = (await res.json()) as any;
      const hoursInfo: any[] = Array.isArray(json?.hoursInfo) ? json.hoursInfo : [];
      if (hoursInfo.length < 3) return null;

      const sorted = [...hoursInfo].sort(
        (a, b) => (parseObservedTimeMs(a?.dateTime) ?? 0) - (parseObservedTimeMs(b?.dateTime) ?? 0)
      );

      const points: HourlyTrendPoint[] = [];
      for (const h of sorted) {
        const pollutants = parseGooglePollutants(h?.pollutants);
        if (!hasValidPollutants(pollutants)) continue;
        const ms = parseObservedTimeMs(h?.dateTime);
        if (!ms) continue;
        const d = new Date(ms);
        const pad = (n: number) => String(n).padStart(2, '0');
        const hour = `${pad(d.getHours())}:00`;
        const fullTime = `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hour}`;
        const ev = evaluateAQI(pollutants, query.standard);
        const iaqi =
          query.standard === 'CN' ? calculateCNIAQI(pollutants) : calculateUSIAQI(pollutants);

        points.push({
          hour,
          fullTime,
          aqi: ev.aqi,
          pm25: pollutants.pm25 ?? 0,
          pm10: pollutants.pm10,
          o3: pollutants.o3 ?? 0,
          no2: pollutants.no2,
          so2: pollutants.so2,
          co: pollutants.co,
          iaqi,
          isReal: true,
        });
      }

      if (points.length < 3) return null;
      return {
        points: points.slice(-24),
        isReal: true,
        source: 'Google AQ 逐小时融合观测',
      };
    },
  },

  forecast: {
    async fetch5DayForecast(lat, lon, ctx) {
      const apiKey = ctx.env.googleAqApiKey;
      if (!apiKey) return null;

      const startIso = new Date(ctx.nowMs + 3600 * 1000).toISOString();
      const endIso = new Date(ctx.nowMs + 95 * 3600 * 1000).toISOString();
      const res = await ctx.fetchImpl(
        `${GOOGLE_AQ_BASE}/forecast:lookup?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            location: { latitude: lat, longitude: lon },
            period: { startTime: startIso, endTime: endIso },
            extraComputations: ['POLLUTANT_CONCENTRATION'],
          }),
          signal: createTimeoutSignal(ctx.timeoutMs ?? 5000, ctx.signal),
        }
      );
      if (!res.ok) return null;

      const json = (await res.json()) as any;
      const hourly: any[] = Array.isArray(json?.hourlyForecasts) ? json.hourlyForecasts : [];
      if (hourly.length === 0) return null;

      const byDay: Record<string, number[]> = {};
      for (const h of hourly) {
        const day = String(h?.dateTime || '').slice(0, 10);
        const pollutants = parseGooglePollutants(h?.pollutants);
        if (day.length === 10 && pollutants.pm25 && pollutants.pm25 > 0) {
          if (!byDay[day]) byDay[day] = [];
          byDay[day].push(pollutants.pm25);
        }
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
      return { list, source: 'Google Air Quality 预报' };
    },
  },
};
