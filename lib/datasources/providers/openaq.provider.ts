import type { CityMeta, PollutantValues } from '../../types';
import { calculateCNIAQI, calculateUSIAQI, evaluateAQI } from '../../aqi-calculator';
import type { HourlyTrendPoint } from '../../services/realtime-trend';
import {
  computeFreshness,
  extractUtcOffsetLabel,
  formatLocalTimeForCityWithTz,
  hasValidPollutants,
  hashStationIdToUid,
  isPlausibleLocalOffsetForCity,
  parseObservedTimeMs,
} from '../freshness';
import { createTimeoutSignal, normalizePollutantUnit } from '../units';
import { createHttpError } from '../../utils/common';
import type {
  AirQualityProvider,
  NormalizedStationSample,
  ProviderCitySnapshot,
  ProviderRuntimeContext,
} from '../types';

const OPENAQ_BASE = 'https://api.openaq.org/v3';

function mapOpenAqParam(paramName: string): keyof PollutantValues | null {
  const p = paramName.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (p === 'pm25') return 'pm25';
  if (p === 'pm10') return 'pm10';
  if (p === 'o3') return 'o3';
  if (p === 'no2') return 'no2';
  if (p === 'so2') return 'so2';
  if (p === 'co') return 'co';
  return null;
}

/**
 * OpenAQ API v3 Provider:
 * - Aggregates 100% physical ground reference stations globally (US AirNow, EU EEA, UK DEFRA, AU, JP, KR)
 * - Native physical concentrations & UTC timestamps, plus 24-72h sensor hourly measurements
 * - Requires free `OPENAQ_API_KEY` (60 req/min free tier)
 */
export const openaqProvider: AirQualityProvider = {
  id: 'openaq',
  name: 'OpenAQ 开放监测网络',
  shortName: 'OpenAQ',
  tier: 'ground-official',
  supportedCountries: '*',
  supportsBrowserDirect: false,

  isAvailable(ctx: ProviderRuntimeContext): boolean {
    return Boolean(ctx.env.openaqApiKey);
  },

  realtime: {
    async fetchCitySnapshot(
      city: CityMeta,
      ctx: ProviderRuntimeContext
    ): Promise<ProviderCitySnapshot | null> {
      const apiKey = ctx.env.openaqApiKey;
      if (!apiKey) return null;

      const headers = { 'X-API-Key': apiKey, Accept: 'application/json' };
      const timeoutMs = ctx.timeoutMs ?? 5000;
      let subrequestsUsed = 0;

      // OpenAQ v3 radius limit is 25,000m (25km), well inside our 35km hard boundary
      const locUrl = `${OPENAQ_BASE}/locations?coordinates=${city.latitude.toFixed(4)},${city.longitude.toFixed(4)}&radius=25000&limit=12`;
      subrequestsUsed++;
      const locRes = await ctx.fetchImpl(locUrl, {
        headers,
        signal: createTimeoutSignal(timeoutMs, ctx.signal),
      });
      if (locRes.status === 401 || locRes.status === 403 || locRes.status === 429) {
        throw createHttpError(locRes.status, `OpenAQ locations HTTP ${locRes.status}`);
      }
      if (!locRes.ok) return null;

      const locJson = (await locRes.json()) as any;
      const locations: any[] = Array.isArray(locJson?.results) ? locJson.results : [];
      if (locations.length === 0) return null;

      // Pre-filter out locations whose last update is already older than 24h (avoids wasted subrequests on stale EEA feeds)
      const freshLocs = locations.filter((loc) => {
        const lastMs = parseObservedTimeMs(loc?.datetimeLast?.utc);
        if (!lastMs) return true;
        return ctx.nowMs - lastMs <= 24 * 3600 * 1000;
      });
      if (freshLocs.length === 0) return null;

      // Prefer reference-grade (isMonitor === true) stations with recent datetimeLast
      const sortedLocs = [...freshLocs].sort((a, b) => {
        const aMon = a?.isMonitor ? 1 : 0;
        const bMon = b?.isMonitor ? 1 : 0;
        if (aMon !== bMon) return bMon - aMon;
        const aMs = parseObservedTimeMs(a?.datetimeLast?.utc) ?? 0;
        const bMs = parseObservedTimeMs(b?.datetimeLast?.utc) ?? 0;
        return bMs - aMs;
      });

      const maxFetch = Math.min(sortedLocs.length, ctx.isServer ? 6 : 8);
      const stations: NormalizedStationSample[] = [];

      await Promise.all(
        sortedLocs.slice(0, maxFetch).map(async (loc) => {
          const locId = loc?.id;
          if (!locId) return;

          // Build sensorId -> { parameter, units } lookup map from location metadata
          const sensorMeta = new Map<number, { key: keyof PollutantValues; units: string }>();
          if (Array.isArray(loc.sensors)) {
            for (const s of loc.sensors) {
              const key = mapOpenAqParam(String(s?.parameter?.name || ''));
              if (key && typeof s.id === 'number') {
                sensorMeta.set(s.id, { key, units: String(s?.parameter?.units || '') });
              }
            }
          }

          subrequestsUsed++;
          try {
            const latestRes = await ctx.fetchImpl(`${OPENAQ_BASE}/locations/${locId}/latest`, {
              headers,
              signal: createTimeoutSignal(timeoutMs, ctx.signal),
            });
            if (!latestRes.ok) return;
            const latestJson = (await latestRes.json()) as any;
            const measurements: any[] = Array.isArray(latestJson?.results) ? latestJson.results : [];

            const pollutants: PollutantValues = {};
            const keyLatestMs: Partial<Record<keyof PollutantValues, number>> = {};
            let latestMs = 0;
            let latestLocal: string | undefined;

            for (const m of measurements) {
              const paramName = String(m?.parameter?.name || '');
              const meta = sensorMeta.get(m?.sensorsId);
              const key = meta?.key || mapOpenAqParam(paramName);
              const unit = m?.parameter?.units || meta?.units || '';
              if (!key) continue;

              const normalizedVal = normalizePollutantUnit(key, Number(m?.value), unit);
              if (normalizedVal === undefined || normalizedVal <= 0) continue;

              const obsMs = parseObservedTimeMs(m?.datetime?.utc || m?.datetime?.local);
              // Only accept measurements within 24h (and not >15m in the future) to prevent legacy/bogus sensor contamination
              if (!obsMs || ctx.nowMs - obsMs > 24 * 3600 * 1000 || obsMs - ctx.nowMs > 15 * 60 * 1000) {
                continue;
              }
              if ((keyLatestMs[key] ?? 0) <= obsMs) {
                keyLatestMs[key] = obsMs;
                pollutants[key] = normalizedVal;
              }
              if (obsMs > latestMs) {
                latestMs = obsMs;
                latestLocal = typeof m?.datetime?.local === 'string' ? m.datetime.local : undefined;
              }
            }

            if (!hasValidPollutants(pollutants)) return;

            const lat = Number(loc?.coordinates?.latitude ?? city.latitude);
            const lon = Number(loc?.coordinates?.longitude ?? city.longitude);
            const useUpstreamLocal =
              latestMs > 0 &&
              isPlausibleLocalOffsetForCity(latestLocal, latestMs, city.country, lon, lat);
            const fallbackLocal =
              latestMs > 0 ? formatLocalTimeForCityWithTz(latestMs, city.country, lon, lat) : null;
            const resolvedLocal = useUpstreamLocal ? latestLocal : fallbackLocal?.localTime;
            const resolvedTz = useUpstreamLocal
              ? extractUtcOffsetLabel(latestLocal) || fallbackLocal?.timezoneOffset
              : fallbackLocal?.timezoneOffset;

            const canonicalId = `openaq:${locId}` as const;
            stations.push({
              stationId: canonicalId,
              providerId: 'openaq',
              rawId: String(locId),
              numericUid: hashStationIdToUid(canonicalId),
              name: loc.name || loc.locality || `OpenAQ #${locId}`,
              latitude: lat,
              longitude: lon,
              isOfficial: Boolean(loc.isMonitor ?? true),
              freshness: computeFreshness(latestMs || null, ctx.nowMs, undefined, resolvedLocal, resolvedTz),
              pollutants,
              rawUsAqi: evaluateAQI(pollutants, 'US').aqi,
              pm25IaqiUS: calculateUSIAQI(pollutants).pm25,
              pm25IaqiCN: calculateCNIAQI(pollutants).pm25,
            });
          } catch {
            // Skip failed station cleanly
          }
        })
      );

      if (stations.length === 0) return null;

      return {
        providerId: 'openaq',
        providerName: 'OpenAQ',
        tier: 'ground-official',
        stations,
        attributions: [{ name: 'OpenAQ Global Air Quality Data', url: 'https://openaq.org/' }],
        subrequestsUsed,
      };
    },
  },

  hourlyTrend: {
    async fetchHourlyTrend(query, ctx) {
      const apiKey = ctx.env.openaqApiKey;
      if (!apiKey) return null;

      const headers = { 'X-API-Key': apiKey, Accept: 'application/json' };
      const timeoutMs = ctx.timeoutMs ?? 5000;

      let pm25SensorId: number | null = null;
      let stationLabel = query.city.nameZh;
      let stationLat = query.city.latitude;
      let stationLon = query.city.longitude;

      // 1. If a specific OpenAQ location ID was requested, inspect its sensors directly first
      if (query.stationRawId && /^\d+$/.test(query.stationRawId)) {
        try {
          const singleRes = await ctx.fetchImpl(`${OPENAQ_BASE}/locations/${query.stationRawId}`, {
            headers,
            signal: createTimeoutSignal(timeoutMs, ctx.signal),
          });
          if (singleRes.ok) {
            const singleJson = (await singleRes.json()) as any;
            const loc = Array.isArray(singleJson?.results) ? singleJson.results[0] : null;
            const pm25Sensor = Array.isArray(loc?.sensors)
              ? loc.sensors.find((s: any) => mapOpenAqParam(String(s?.parameter?.name || '')) === 'pm25')
              : null;
            if (pm25Sensor?.id) {
              pm25SensorId = pm25Sensor.id;
              stationLabel = loc.name || stationLabel;
              stationLat = Number(loc?.coordinates?.latitude ?? stationLat);
              stationLon = Number(loc?.coordinates?.longitude ?? stationLon);
            }
          }
        } catch {
          // Fall through to coordinate search
        }
      }

      // 2. Otherwise find the freshest reference-grade location within 25km with an active pm25 sensor
      if (!pm25SensorId) {
        const locUrl = `${OPENAQ_BASE}/locations?coordinates=${query.city.latitude.toFixed(4)},${query.city.longitude.toFixed(4)}&radius=25000&limit=12`;
        const locRes = await ctx.fetchImpl(locUrl, {
          headers,
          signal: createTimeoutSignal(timeoutMs, ctx.signal),
        });
        if (!locRes.ok) return null;

        const locJson = (await locRes.json()) as any;
        const locations: any[] = Array.isArray(locJson?.results) ? locJson.results : [];
        const freshSorted = locations
          .filter((loc) => {
            const lastMs = parseObservedTimeMs(loc?.datetimeLast?.utc);
            return !lastMs || ctx.nowMs - lastMs <= 24 * 3600 * 1000;
          })
          .sort((a, b) => {
            const aMon = a?.isMonitor ? 1 : 0;
            const bMon = b?.isMonitor ? 1 : 0;
            if (aMon !== bMon) return bMon - aMon;
            const aMs = parseObservedTimeMs(a?.datetimeLast?.utc) ?? 0;
            const bMs = parseObservedTimeMs(b?.datetimeLast?.utc) ?? 0;
            return bMs - aMs;
          });

        for (const loc of freshSorted) {
          if (!Array.isArray(loc?.sensors)) continue;
          const pm25Sensor = loc.sensors.find(
            (s: any) => mapOpenAqParam(String(s?.parameter?.name || '')) === 'pm25'
          );
          if (pm25Sensor?.id) {
            pm25SensorId = pm25Sensor.id;
            stationLabel = loc.name || stationLabel;
            stationLat = Number(loc?.coordinates?.latitude ?? stationLat);
            stationLon = Number(loc?.coordinates?.longitude ?? stationLon);
            break;
          }
        }
      }

      if (!pm25SensorId) return null;

      // Request up to 78 hours so 24h / 48h / 72h UI toggles all have full real observations
      const dateFrom = new Date(ctx.nowMs - 78 * 3600 * 1000).toISOString();
      const hoursRes = await ctx.fetchImpl(
        `${OPENAQ_BASE}/sensors/${pm25SensorId}/hours?datetime_from=${encodeURIComponent(dateFrom)}&limit=80`,
        {
          headers,
          signal: createTimeoutSignal(timeoutMs, ctx.signal),
        }
      );
      if (!hoursRes.ok) return null;

      const hoursJson = (await hoursRes.json()) as any;
      const results: any[] = Array.isArray(hoursJson?.results) ? hoursJson.results : [];
      if (results.length < 3) return null;

      const points: HourlyTrendPoint[] = [];
      let timezoneOffset: string | undefined;

      for (const r of results) {
        const pm25 = normalizePollutantUnit('pm25', Number(r?.value), r?.parameter?.units);
        if (pm25 === undefined || pm25 <= 0) continue;

        const rawLocal = String(r?.period?.datetimeTo?.local || r?.period?.datetimeFrom?.local || '');
        const rawUtc = r?.period?.datetimeTo?.utc || r?.period?.datetimeFrom?.utc;
        const obsMs = parseObservedTimeMs(rawUtc || rawLocal);

        let hour = '';
        let fullTime = '';

        if (
          obsMs &&
          !isPlausibleLocalOffsetForCity(rawLocal, obsMs, query.city.country, stationLon, stationLat)
        ) {
          // Guard against OpenAQ feeds returning UTC "+00:00" as local time for non-UTC cities
          const formatted = formatLocalTimeForCityWithTz(
            obsMs,
            query.city.country,
            stationLon,
            stationLat
          );
          timezoneOffset = formatted.timezoneOffset;
          hour = formatted.localTime.slice(11, 16);
          fullTime = formatted.localTime.slice(5, 16);
        } else {
          const match = rawLocal.match(/(\d{2}-\d{2})T(\d{2}:\d{2})/);
          if (match) {
            hour = match[2];
            fullTime = `${match[1]} ${match[2]}`;
            timezoneOffset = extractUtcOffsetLabel(rawLocal) || timezoneOffset;
          } else if (obsMs) {
            const formatted = formatLocalTimeForCityWithTz(
              obsMs,
              query.city.country,
              stationLon,
              stationLat
            );
            timezoneOffset = formatted.timezoneOffset;
            hour = formatted.localTime.slice(11, 16);
            fullTime = formatted.localTime.slice(5, 16);
          } else {
            continue;
          }
        }

        const ev = evaluateAQI({ pm25 }, query.standard, true);
        const iaqi =
          query.standard === 'CN' ? calculateCNIAQI({ pm25 }) : calculateUSIAQI({ pm25 });

        points.push({
          hour,
          fullTime,
          ...(obsMs ? { timestampMs: obsMs } : {}),
          aqi: ev.aqi,
          pm25,
          iaqi,
          isReal: true,
        });
      }

      if (points.length < 3) return null;
      return {
        points: points.slice(-72),
        isReal: true,
        providerId: 'openaq',
        providerName: 'OpenAQ',
        timezoneOffset:
          timezoneOffset ||
          formatLocalTimeForCityWithTz(ctx.nowMs, query.city.country, stationLon, stationLat)
            .timezoneOffset,
        source: `OpenAQ (${stationLabel}) 逐小时实测`,
      };
    },
  },
};
