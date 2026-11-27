import type { CityMeta, PollutantValues } from '../../types';
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

const MOENV_ENDPOINT = 'https://data.moenv.gov.tw/api/v2/aqx_p_432';
const SNAPSHOT_TTL_MS = 5 * 60 * 1000;

let cachedMoenvStations: { fetchedAtMs: number; stations: NormalizedStationSample[] } | null = null;

function createHttpError(status: number, message: string): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

function numVal(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '' || v === '-') return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Taiwan Ministry of Environment (MOENV) Official Real-Time Air Quality Provider (`AQX_P_432`):
 * - Covers all ~77 official government stations across Taiwan with 10-20 min hourly latency
 * - Requires free `MOENV_API_KEY` from data.moenv.gov.tw
 * - Note on units in MOENV AQX_P_432: pm2.5 & pm10 are μg/m³; o3, no2, so2 are ppb; co is ppm.
 */
export const twMoenvProvider: AirQualityProvider = {
  id: 'tw-moenv',
  name: '台湾环境部 MOENV',
  shortName: '台湾环境部',
  tier: 'ground-official',
  supportedCountries: ['TW'],
  supportsBrowserDirect: false,

  isAvailable(ctx: ProviderRuntimeContext): boolean {
    return Boolean(ctx.env.moenvApiKey);
  },

  realtime: {
    async fetchCitySnapshot(
      city: CityMeta,
      ctx: ProviderRuntimeContext
    ): Promise<ProviderCitySnapshot | null> {
      if (city.country.toUpperCase() !== 'TW' || !ctx.env.moenvApiKey) return null;

      let stations: NormalizedStationSample[];
      let subrequestsUsed = 0;

      if (cachedMoenvStations && ctx.nowMs - cachedMoenvStations.fetchedAtMs < SNAPSHOT_TTL_MS) {
        stations = cachedMoenvStations.stations;
      } else {
        subrequestsUsed = 1;
        const url = `${MOENV_ENDPOINT}?api_key=${encodeURIComponent(ctx.env.moenvApiKey)}&format=json&limit=200`;
        const res = await ctx.fetchImpl(url, {
          cache: 'no-store',
          signal: createTimeoutSignal(ctx.timeoutMs ?? 5500, ctx.signal),
        });
        if (res.status === 401 || res.status === 403 || res.status === 429) {
          throw createHttpError(res.status, `TW MOENV HTTP ${res.status}`);
        }
        if (!res.ok) return null;

        const json = (await res.json()) as any;
        const records: any[] = Array.isArray(json?.records) ? json.records : [];
        stations = [];

        for (const rec of records) {
          const lat = Number(rec?.latitude);
          const lon = Number(rec?.longitude);
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

          // Taiwan MOENV AQX_P_432 units: pm2.5/pm10 in μg/m³, o3/no2/so2 in ppb, co in ppm
          const pollutants: PollutantValues = {
            pm25: normalizePollutantUnit('pm25', numVal(rec['pm2.5']), 'ug/m3'),
            pm10: normalizePollutantUnit('pm10', numVal(rec.pm10), 'ug/m3'),
            o3: normalizePollutantUnit('o3', numVal(rec.o3), 'ppb'),
            no2: normalizePollutantUnit('no2', numVal(rec.no2), 'ppb'),
            so2: normalizePollutantUnit('so2', numVal(rec.so2), 'ppb'),
            co: normalizePollutantUnit('co', numVal(rec.co), 'ppm'),
          };
          if (!hasValidPollutants(pollutants)) continue;

          const obsMs = parseObservedTimeMs(rec.publishtime, '+08:00');
          const rawId = String(rec.siteid || rec.sitename || '');
          const canonicalId = `tw-moenv:${rawId}` as const;

          stations.push({
            stationId: canonicalId,
            providerId: 'tw-moenv',
            rawId,
            numericUid: hashStationIdToUid(canonicalId),
            name: rec.sitename ? `${rec.sitename}${rec.county ? ` (${rec.county})` : ''}` : rawId,
            latitude: lat,
            longitude: lon,
            isOfficial: true,
            freshness: computeFreshness(obsMs, ctx.nowMs),
            pollutants,
            rawUsAqi: numVal(rec.aqi) ?? evaluateAQI(pollutants, 'US').aqi,
            pm25IaqiUS: calculateUSIAQI(pollutants).pm25,
            pm25IaqiCN: calculateCNIAQI(pollutants).pm25,
          });
        }

        if (stations.length > 0) {
          cachedMoenvStations = { fetchedAtMs: ctx.nowMs, stations };
        }
      }

      if (stations.length === 0) return null;

      return {
        providerId: 'tw-moenv',
        providerName: '台湾环境部',
        tier: 'ground-official',
        stations,
        attributions: [
          { name: '台湾环境部空气质量监测网 (MOENV)', url: 'https://airtw.moenv.gov.tw/' },
        ],
        subrequestsUsed,
      };
    },
  },
};

export function clearTwMoenvCache(): void {
  cachedMoenvStations = null;
}
