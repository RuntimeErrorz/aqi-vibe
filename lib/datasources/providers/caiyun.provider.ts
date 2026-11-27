import type { CityMeta, ForecastData, ForecastDay, PollutantValues, WeatherInfo } from '../../types';
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

const CAIYUN_BASE = 'https://api.caiyunapp.com/v2.6';

function createHttpError(status: number, message: string): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

function numOrUndef(v: unknown, decimals = 1): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  const f = Math.pow(10, decimals);
  return Math.round(v * f) / f;
}

function parseCaiyunPollutants(aq: any): PollutantValues {
  if (!aq || typeof aq !== 'object') return {};
  return {
    pm25: normalizePollutantUnit('pm25', typeof aq.pm25 === 'number' ? aq.pm25 : undefined, 'ug/m3'),
    pm10: normalizePollutantUnit('pm10', typeof aq.pm10 === 'number' ? aq.pm10 : undefined, 'ug/m3'),
    o3: normalizePollutantUnit('o3', typeof aq.o3 === 'number' ? aq.o3 : undefined, 'ug/m3'),
    no2: normalizePollutantUnit('no2', typeof aq.no2 === 'number' ? aq.no2 : undefined, 'ug/m3'),
    so2: normalizePollutantUnit('so2', typeof aq.so2 === 'number' ? aq.so2 : undefined, 'ug/m3'),
    co: normalizePollutantUnit('co', typeof aq.co === 'number' ? aq.co : undefined, 'mg/m3'),
  };
}

function parseCaiyunWeather(rt: any): WeatherInfo | undefined {
  if (!rt || typeof rt !== 'object') return undefined;
  const temp = numOrUndef(rt.temperature, 1);
  // Caiyun humidity is 0..1 ratio -> percentage 0..100
  const humidity =
    typeof rt.humidity === 'number' && Number.isFinite(rt.humidity)
      ? Math.round(rt.humidity <= 1 ? rt.humidity * 100 : rt.humidity)
      : undefined;
  // Caiyun wind.speed is km/h in metric -> convert to m/s
  const windSpeed =
    typeof rt.wind?.speed === 'number' && Number.isFinite(rt.wind.speed)
      ? numOrUndef(rt.wind.speed / 3.6, 1)
      : undefined;
  // Caiyun pressure is Pa -> convert to hPa
  const pressure =
    typeof rt.pressure === 'number' && Number.isFinite(rt.pressure)
      ? numOrUndef(rt.pressure > 2000 ? rt.pressure / 100 : rt.pressure, 1)
      : undefined;

  if (
    temp === undefined &&
    humidity === undefined &&
    windSpeed === undefined &&
    pressure === undefined
  ) {
    return undefined;
  }
  return { temp, humidity, windSpeed, pressure };
}

function parseCaiyunDailyForecast(daily: any): ForecastDay[] {
  const pm25Arr: any[] = Array.isArray(daily?.air_quality?.pm25) ? daily.air_quality.pm25 : [];
  const list: ForecastDay[] = [];
  for (const item of pm25Arr.slice(0, 5)) {
    const day = String(item?.date || '').slice(0, 10);
    const avg = Number(item?.avg);
    const min = Number(item?.min);
    const max = Number(item?.max);
    if (day.length === 10 && Number.isFinite(avg) && avg > 0) {
      list.push({
        day,
        avg: Math.round(avg),
        min: Number.isFinite(min) ? Math.round(min) : Math.round(avg),
        max: Number.isFinite(max) ? Math.round(max) : Math.round(avg),
      });
    }
  }
  return list;
}

/**
 * 彩云天气 (Caiyun Weather) API v2.6 Provider:
 * - Direct CNEMC + provincial station fusion in China, plus full 4-metric realtime weather
 * - Single `/weather?dailysteps=5` call returns 6 realtime pollutants + 4 weather metrics + 5-day PM2.5 forecast!
 * - Requires `CAIYUN_API_TOKEN` from dashboard.caiyunapp.com
 */
export const caiyunProvider: AirQualityProvider = {
  id: 'caiyun',
  name: '彩云天气空气质量',
  shortName: '彩云天气',
  tier: 'station-grid-fusion',
  supportedCountries: '*',
  supportsBrowserDirect: false, // Server/Edge only to protect CAIYUN_API_TOKEN

  isAvailable(ctx: ProviderRuntimeContext): boolean {
    return Boolean(ctx.env.caiyunToken);
  },

  realtime: {
    async fetchCitySnapshot(
      city: CityMeta,
      ctx: ProviderRuntimeContext
    ): Promise<ProviderCitySnapshot | null> {
      const token = ctx.env.caiyunToken;
      if (!token) return null;

      // Note: Caiyun URL coordinate order is {longitude},{latitude}
      const url = `${CAIYUN_BASE}/${encodeURIComponent(token)}/${city.longitude.toFixed(4)},${city.latitude.toFixed(4)}/weather?dailysteps=5&hourlysteps=1&lang=zh_CN&unit=metric:v2`;
      const res = await ctx.fetchImpl(url, {
        cache: 'no-store',
        signal: createTimeoutSignal(ctx.timeoutMs ?? 4500, ctx.signal),
      });
      if (res.status === 401 || res.status === 403 || res.status === 429) {
        throw createHttpError(res.status, `Caiyun HTTP ${res.status}`);
      }
      if (!res.ok) return null;

      const json = (await res.json()) as any;
      if (json?.status !== 'ok' || !json?.result?.realtime) return null;

      const rt = json.result.realtime;
      const pollutants = parseCaiyunPollutants(rt.air_quality);
      if (!hasValidPollutants(pollutants)) return null;

      // Align observation timestamp to server_time top-of-hour (or exact server_time)
      const serverMs = parseObservedTimeMs(json.server_time) ?? ctx.nowMs;
      const obsMs = Math.floor(serverMs / 3_600_000) * 3_600_000;
      const freshness = computeFreshness(obsMs, ctx.nowMs);
      const weather = parseCaiyunWeather(rt);

      const usAqiRaw =
        typeof rt.air_quality?.aqi?.usa === 'number' && rt.air_quality.aqi.usa > 0
          ? Math.round(rt.air_quality.aqi.usa)
          : evaluateAQI(pollutants, 'US').aqi;

      const canonicalId = `caiyun:${city.id}` as const;
      const directReading: NormalizedStationSample = {
        stationId: canonicalId,
        providerId: 'caiyun',
        rawId: city.id,
        numericUid: hashStationIdToUid(canonicalId),
        name: `${city.nameZh}彩云融合观测`,
        latitude: city.latitude,
        longitude: city.longitude,
        isOfficial: true,
        freshness,
        pollutants,
        weather,
        rawUsAqi: usAqiRaw,
        pm25IaqiUS: calculateUSIAQI(pollutants).pm25,
        pm25IaqiCN: calculateCNIAQI(pollutants).pm25,
      };

      const dailyPm25 = parseCaiyunDailyForecast(json.result.daily);
      const forecast: ForecastData | undefined =
        dailyPm25.length > 0 ? { pm25: dailyPm25 } : undefined;

      return {
        providerId: 'caiyun',
        providerName: '彩云天气',
        tier: 'station-grid-fusion',
        stations: [],
        directCityReading: directReading,
        forecast,
        attributions: [{ name: '彩云天气 Caiyun Weather', url: 'https://www.caiyunapp.com/' }],
        subrequestsUsed: 1,
      };
    },
  },

  forecast: {
    async fetch5DayForecast(lat, lon, ctx) {
      const token = ctx.env.caiyunToken;
      if (!token) return null;

      const url = `${CAIYUN_BASE}/${encodeURIComponent(token)}/${lon.toFixed(4)},${lat.toFixed(4)}/daily?dailysteps=5&lang=zh_CN&unit=metric:v2`;
      const res = await ctx.fetchImpl(url, {
        signal: createTimeoutSignal(ctx.timeoutMs ?? 4500, ctx.signal),
      });
      if (res.status === 401 || res.status === 403 || res.status === 429) {
        throw createHttpError(res.status, `Caiyun daily HTTP ${res.status}`);
      }
      if (!res.ok) return null;

      const json = (await res.json()) as any;
      if (json?.status !== 'ok') return null;

      const list = parseCaiyunDailyForecast(json.result?.daily);
      if (list.length === 0) return null;
      return {
        list,
        source: '彩云天气 AI 空气质量预报',
      };
    },
  },
};
