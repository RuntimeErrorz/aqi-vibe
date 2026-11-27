import type { CityMeta, PollutantValues } from '../../types';
import {
  calculateCNIAQI,
  calculateUSIAQI,
  convertIAQIToConcentration,
  evaluateAQI,
} from '../../aqi-calculator';
import {
  computeFreshness,
  hasValidPollutants,
  hashStationIdToUid,
  parseObservedTimeMs,
} from '../freshness';
import { createTimeoutSignal } from '../units';
import type {
  AirQualityProvider,
  NormalizedStationSample,
  ProviderCitySnapshot,
  ProviderRuntimeContext,
} from '../types';

const AIRNOW_URL = 'https://www.airnowapi.org/aq/observation/latLong/current/';

const US_TZ_OFFSETS: Record<string, string> = {
  EST: '-05:00',
  EDT: '-04:00',
  CST: '-06:00',
  CDT: '-05:00',
  MST: '-07:00',
  MDT: '-06:00',
  PST: '-08:00',
  PDT: '-07:00',
  AKST: '-09:00',
  AKDT: '-08:00',
  HST: '-10:00',
  AST: '-04:00',
  ADT: '-03:00',
  UTC: '+00:00',
  GMT: '+00:00',
};

function createHttpError(status: number, message: string): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

/**
 * US EPA AirNow Official Real-Time Provider:
 * - Direct official US & Canadian monitoring observations (latency typically <30 min)
 * - Distance capped at 21 miles (~34 km) to honor the 35 km hard boundary
 * - Requires free `AIRNOW_API_KEY` from docs.airnowapi.org
 */
export const airnowProvider: AirQualityProvider = {
  id: 'airnow',
  name: 'US EPA AirNow',
  shortName: 'AirNow',
  tier: 'ground-official',
  supportedCountries: ['US', 'CA', 'MX'],
  supportsBrowserDirect: false,

  isAvailable(ctx: ProviderRuntimeContext): boolean {
    return Boolean(ctx.env.airnowApiKey);
  },

  realtime: {
    async fetchCitySnapshot(
      city: CityMeta,
      ctx: ProviderRuntimeContext
    ): Promise<ProviderCitySnapshot | null> {
      const apiKey = ctx.env.airnowApiKey;
      if (!apiKey) return null;

      // 21 miles ≈ 33.8 km, strictly within the 35 km hard physical boundary
      const url = `${AIRNOW_URL}?format=application/json&latitude=${city.latitude.toFixed(4)}&longitude=${city.longitude.toFixed(4)}&distance=21&API_KEY=${encodeURIComponent(apiKey)}`;

      const res = await ctx.fetchImpl(url, {
        cache: 'no-store',
        signal: createTimeoutSignal(ctx.timeoutMs ?? 4500, ctx.signal),
      });
      if (res.status === 401 || res.status === 403 || res.status === 429) {
        throw createHttpError(res.status, `AirNow HTTP ${res.status}`);
      }
      if (!res.ok) return null;

      const items = (await res.json()) as any[];
      if (!Array.isArray(items) || items.length === 0) return null;

      // Group observations by ReportingArea + coordinates
      const groups = new Map<
        string,
        {
          area: string;
          state: string;
          lat: number;
          lon: number;
          latestMs: number;
          pollutants: PollutantValues;
          maxAqi: number;
        }
      >();

      for (const item of items) {
        const aqi = Number(item?.AQI);
        if (!Number.isFinite(aqi) || aqi <= 0 || aqi > 500) continue;

        const param = String(item?.ParameterName || '').toUpperCase().replace(/[^A-Z0-9.]/g, '');
        const area = String(item?.ReportingArea || city.nameEn).trim();
        const state = String(item?.StateCode || '').trim();
        const lat = Number(item?.Latitude);
        const lon = Number(item?.Longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

        const dateStr = String(item?.DateObserved || '').trim();
        const hourNum = Number(item?.HourObserved);
        const tzKey = String(item?.LocalTimeZone || 'UTC').trim().toUpperCase();
        const tzOffset = US_TZ_OFFSETS[tzKey] || '+00:00';
        const timeStr =
          dateStr && Number.isFinite(hourNum)
            ? `${dateStr} ${String(hourNum).padStart(2, '0')}:00:00`
            : undefined;
        const obsMs = parseObservedTimeMs(timeStr, tzOffset) ?? 0;

        const groupKey = `${area}|${lat.toFixed(3)},${lon.toFixed(3)}`;
        let group = groups.get(groupKey);
        if (!group) {
          group = { area, state, lat, lon, latestMs: obsMs, pollutants: {}, maxAqi: 0 };
          groups.set(groupKey, group);
        }
        if (obsMs > group.latestMs) group.latestMs = obsMs;
        if (aqi > group.maxAqi) group.maxAqi = aqi;

        if (param === 'PM2.5' || param === 'PM25') {
          group.pollutants.pm25 = convertIAQIToConcentration('pm25', aqi, 'US');
        } else if (param === 'PM10') {
          group.pollutants.pm10 = convertIAQIToConcentration('pm10', aqi, 'US');
        } else if (param === 'O3' || param === 'OZONE') {
          group.pollutants.o3 = convertIAQIToConcentration('o3', aqi, 'US');
        } else if (param === 'NO2') {
          group.pollutants.no2 = convertIAQIToConcentration('no2', aqi, 'US');
        } else if (param === 'SO2') {
          group.pollutants.so2 = convertIAQIToConcentration('so2', aqi, 'US');
        } else if (param === 'CO') {
          group.pollutants.co = convertIAQIToConcentration('co', aqi, 'US');
        }
      }

      const stations: NormalizedStationSample[] = [];
      groups.forEach((g, key) => {
        if (!hasValidPollutants(g.pollutants)) return;
        const canonicalId = `airnow:${key}` as const;
        stations.push({
          stationId: canonicalId,
          providerId: 'airnow',
          rawId: key,
          numericUid: hashStationIdToUid(canonicalId),
          name: g.state ? `${g.area}, ${g.state}` : g.area,
          latitude: g.lat,
          longitude: g.lon,
          isOfficial: true,
          freshness: computeFreshness(g.latestMs || null, ctx.nowMs),
          pollutants: g.pollutants,
          rawUsAqi: g.maxAqi || evaluateAQI(g.pollutants, 'US').aqi,
          pm25IaqiUS: calculateUSIAQI(g.pollutants).pm25,
          pm25IaqiCN: calculateCNIAQI(g.pollutants).pm25,
        });
      });

      if (stations.length === 0) return null;

      return {
        providerId: 'airnow',
        providerName: 'AirNow',
        tier: 'ground-official',
        stations,
        directCityReading: stations[0],
        attributions: [{ name: 'U.S. EPA AirNow', url: 'https://www.airnow.gov/' }],
        subrequestsUsed: 1,
      };
    },
  },
};
