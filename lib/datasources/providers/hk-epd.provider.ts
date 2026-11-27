import type { CityMeta, PollutantValues } from '../../types';
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

const HK_EPD_XML_URL = 'https://www.aqhi.gov.hk/epd/ddata/html/out/24pc_Eng.xml';

/**
 * Official Hong Kong Environmental Protection Department (EPD) 18 Air Quality Monitoring Stations.
 * Coordinates sourced from official EPD station metadata (WGS-84).
 */
const HK_EPD_STATION_META: Record<
  string,
  { nameZh: string; lat: number; lon: number }
> = {
  'Central/Western': { nameZh: '中西区', lat: 22.2849, lon: 114.1444 },
  Southern: { nameZh: '南区', lat: 22.2474, lon: 114.1602 },
  Eastern: { nameZh: '东区', lat: 22.2829, lon: 114.2193 },
  'Kwun Tong': { nameZh: '观塘', lat: 22.3096, lon: 114.2312 },
  'Sham Shui Po': { nameZh: '深水埗', lat: 22.3302, lon: 114.1591 },
  'Kwai Chung': { nameZh: '葵涌', lat: 22.3571, lon: 114.1296 },
  'Tsuen Wan': { nameZh: '荃湾', lat: 22.3717, lon: 114.1145 },
  'Tseung Kwan O': { nameZh: '将军澳', lat: 22.3176, lon: 114.2596 },
  'Yuen Long': { nameZh: '元朗', lat: 22.4452, lon: 114.0226 },
  'Tuen Mun': { nameZh: '屯门', lat: 22.3911, lon: 113.9767 },
  'Tung Chung': { nameZh: '东涌', lat: 22.2889, lon: 113.9437 },
  'Tai Po': { nameZh: '大埔', lat: 22.4510, lon: 114.1646 },
  'Sha Tin': { nameZh: '沙田', lat: 22.3763, lon: 114.1845 },
  North: { nameZh: '北区', lat: 22.4967, lon: 114.1282 },
  'Tap Mun': { nameZh: '塔门', lat: 22.4713, lon: 114.3607 },
  'Causeway Bay': { nameZh: '铜锣湾(路边)', lat: 22.2801, lon: 114.1851 },
  Central: { nameZh: '中环(路边)', lat: 22.2818, lon: 114.1581 },
  'Mong Kok': { nameZh: '旺角(路边)', lat: 22.3226, lon: 114.1683 },
};

interface ParsedEpdRow {
  stationNameEn: string;
  obsMs: number;
  rawDateTime: string;
  pollutants: PollutantValues;
}

let cachedXmlRows: { fetchedAtMs: number; rows: ParsedEpdRow[] } | null = null;
const XML_CACHE_TTL_MS = 5 * 60 * 1000;

function extractTag(block: string, tag: string): string | undefined {
  const escaped = tag.replace('.', '\\.');
  const m = block.match(new RegExp(`<${escaped}>([^<]*)</${escaped}>`));
  return m ? m[1].trim() : undefined;
}

function parsePositiveFloat(raw?: string): number | undefined {
  if (!raw || raw === '-' || raw === 'N/A') return undefined;
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function parseHkEpdXml(xmlText: string): ParsedEpdRow[] {
  const rows: ParsedEpdRow[] = [];
  const regex = /<PollutantConcentration>([\s\S]*?)<\/PollutantConcentration>/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(xmlText)) !== null) {
    const block = match[1];
    const stationNameEn = extractTag(block, 'StationName');
    const rawDateTime = extractTag(block, 'DateTime');
    if (!stationNameEn || !rawDateTime) continue;

    const obsMs = parseObservedTimeMs(rawDateTime);
    if (!obsMs) continue;

    // Note: HK EPD reports NO2, O3, SO2, CO, PM10, PM2.5 all in μg/m³ (CO must convert μg/m³ -> mg/m³)
    const pollutants: PollutantValues = {
      pm25: normalizePollutantUnit('pm25', parsePositiveFloat(extractTag(block, 'PM2.5')), 'ug/m3'),
      pm10: normalizePollutantUnit('pm10', parsePositiveFloat(extractTag(block, 'PM10')), 'ug/m3'),
      o3: normalizePollutantUnit('o3', parsePositiveFloat(extractTag(block, 'O3')), 'ug/m3'),
      no2: normalizePollutantUnit('no2', parsePositiveFloat(extractTag(block, 'NO2')), 'ug/m3'),
      so2: normalizePollutantUnit('so2', parsePositiveFloat(extractTag(block, 'SO2')), 'ug/m3'),
      co: normalizePollutantUnit('co', parsePositiveFloat(extractTag(block, 'CO')), 'ug/m3'),
    };

    if (!hasValidPollutants(pollutants)) continue;
    rows.push({ stationNameEn, obsMs, rawDateTime, pollutants });
  }

  return rows;
}

async function fetchEpdRows(ctx: ProviderRuntimeContext): Promise<ParsedEpdRow[]> {
  if (cachedXmlRows && ctx.nowMs - cachedXmlRows.fetchedAtMs < XML_CACHE_TTL_MS) {
    return cachedXmlRows.rows;
  }

  const res = await ctx.fetchImpl(HK_EPD_XML_URL, {
    cache: 'no-store',
    signal: createTimeoutSignal(ctx.timeoutMs ? Math.max(ctx.timeoutMs, 8000) : 8000, ctx.signal),
  });
  if (!res.ok) {
    throw new Error(`HK EPD XML HTTP ${res.status}`);
  }
  const xmlText = await res.text();
  const rows = parseHkEpdXml(xmlText);
  if (rows.length > 0) {
    cachedXmlRows = { fetchedAtMs: ctx.nowMs, rows };
  }
  return rows;
}

/**
 * Hong Kong Environmental Protection Department (EPD) Open Data Provider:
 * - 100% Free, Zero API Key, Official Government Real-time (0-delay hourly publication)
 * - Provides all 18 official Hong Kong stations + 24-hour full 6-pollutant time series
 */
export const hkEpdProvider: AirQualityProvider = {
  id: 'hk-epd',
  name: '香港环保署 EPD',
  shortName: '香港环保署',
  tier: 'ground-official',
  supportedCountries: ['HK'],
  supportsBrowserDirect: false, // EPD XML does not send CORS headers; served via Cloudflare Edge Worker

  isAvailable(ctx: ProviderRuntimeContext): boolean {
    return Boolean(ctx.isServer);
  },

  realtime: {
    async fetchCitySnapshot(
      city: CityMeta,
      ctx: ProviderRuntimeContext
    ): Promise<ProviderCitySnapshot | null> {
      if (city.country.toUpperCase() !== 'HK') return null;

      const rows = await fetchEpdRows(ctx);
      if (rows.length === 0) return null;

      // Pick the latest observation row per station
      const latestByStation = new Map<string, ParsedEpdRow>();
      for (const row of rows) {
        const prev = latestByStation.get(row.stationNameEn);
        if (!prev || row.obsMs > prev.obsMs) {
          latestByStation.set(row.stationNameEn, row);
        }
      }

      const stations: NormalizedStationSample[] = [];
      latestByStation.forEach((row, enName) => {
        const meta = HK_EPD_STATION_META[enName];
        if (!meta) return;

        const canonicalId = `hk-epd:${enName}` as const;
        stations.push({
          stationId: canonicalId,
          providerId: 'hk-epd',
          rawId: enName,
          numericUid: hashStationIdToUid(canonicalId),
          name: `${enName} (${meta.nameZh})`,
          latitude: meta.lat,
          longitude: meta.lon,
          isOfficial: true,
          freshness: computeFreshness(row.obsMs, ctx.nowMs, undefined, undefined, 'UTC+8'),
          pollutants: row.pollutants,
          rawUsAqi: evaluateAQI(row.pollutants, 'US').aqi,
          pm25IaqiUS: calculateUSIAQI(row.pollutants).pm25,
          pm25IaqiCN: calculateCNIAQI(row.pollutants).pm25,
        });
      });

      if (stations.length === 0) return null;

      return {
        providerId: 'hk-epd',
        providerName: '香港环保署',
        tier: 'ground-official',
        stations,
        directCityReading: stations[0],
        attributions: [
          {
            name: 'Hong Kong Environmental Protection Department (EPD)',
            url: 'https://www.aqhi.gov.hk/',
          },
        ],
        subrequestsUsed: 1,
      };
    },
  },

  hourlyTrend: {
    async fetchHourlyTrend(query, ctx) {
      if (query.city.country.toUpperCase() !== 'HK') return null;

      const rows = await fetchEpdRows(ctx);
      if (rows.length === 0) return null;

      // Use specified station or default to Central/Western (official downtown reference station)
      const targetName =
        query.stationRawId && HK_EPD_STATION_META[query.stationRawId]
          ? query.stationRawId
          : 'Central/Western';

      const stationRows = rows
        .filter((r) => r.stationNameEn === targetName)
        .sort((a, b) => a.obsMs - b.obsMs);

      if (stationRows.length < 3) return null;

      const points: HourlyTrendPoint[] = stationRows.map((row) => {
        // HK is strictly UTC+8
        const hkDate = new Date(row.obsMs + 8 * 3600 * 1000);
        const pad = (n: number) => String(n).padStart(2, '0');
        const hour = `${pad(hkDate.getUTCHours())}:00`;
        const fullTime = `${pad(hkDate.getUTCMonth() + 1)}-${pad(hkDate.getUTCDate())} ${hour}`;
        const ev = evaluateAQI(row.pollutants, query.standard);
        const iaqi =
          query.standard === 'CN'
            ? calculateCNIAQI(row.pollutants)
            : calculateUSIAQI(row.pollutants);

        return {
          hour,
          fullTime,
          aqi: ev.aqi,
          pm25: row.pollutants.pm25 ?? 0,
          pm10: row.pollutants.pm10,
          o3: row.pollutants.o3 ?? 0,
          no2: row.pollutants.no2,
          so2: row.pollutants.so2,
          co: row.pollutants.co,
          iaqi,
          isReal: true,
        };
      });

      return {
        points,
        isReal: true,
        providerId: 'hk-epd',
        providerName: '香港环保署',
        timezoneOffset: 'UTC+8',
        source: `香港环保署 (${HK_EPD_STATION_META[targetName]?.nameZh || targetName}) 逐小时实测`,
      };
    },
  },
};

export function clearHkEpdCache(): void {
  cachedXmlRows = null;
}
