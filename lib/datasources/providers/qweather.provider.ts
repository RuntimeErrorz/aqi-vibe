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

function createHttpError(status: number, message: string): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

// ============================================================
// Zero-dependency Web Crypto Ed25519 JWT Signer (Cloudflare Workers + Node 20+)
// Spec: Header { alg: "EdDSA", kid: CREDENTIAL_ID }, Payload { sub: PROJECT_ID, iat: now-30, exp: iat+900 }
// ============================================================
interface CachedJwtEntry {
  cacheKey: string;
  token: string;
  expiresAtMs: number;
}

let cachedJwt: CachedJwtEntry | null = null;

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const b64 =
    typeof btoa === 'function'
      ? btoa(binary)
      : Buffer.from(bytes).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlEncodeJson(obj: Record<string, unknown>): string {
  const utf8 = new TextEncoder().encode(JSON.stringify(obj));
  return base64UrlEncodeBytes(utf8);
}

function pemToPkcs8Bytes(pem: string): Uint8Array {
  const cleaned = pem
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');

  if (typeof atob === 'function') {
    const bin = atob(cleaned);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      bytes[i] = bin.charCodeAt(i);
    }
    return bytes;
  }
  return new Uint8Array(Buffer.from(cleaned, 'base64'));
}

export async function signQWeatherJwt(params: {
  developerId?: string;
  projectId: string;
  credentialId: string;
  privateKeyPem: string;
  nowMs?: number;
  ttlSeconds?: number;
}): Promise<string> {
  const nowMs = params.nowMs ?? Date.now();
  const ttlSeconds = Math.min(Math.max(params.ttlSeconds ?? 900, 60), 82800); // 15 min default, < 24h QWeather max
  const cacheKey = `${params.developerId || ''}:${params.projectId}:${params.credentialId}`;

  if (
    cachedJwt &&
    cachedJwt.cacheKey === cacheKey &&
    cachedJwt.expiresAtMs - nowMs > 120_000
  ) {
    return cachedJwt.token;
  }

  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error('Web Crypto API is unavailable for Ed25519 JWT signing');
  }

  const pkcs8Bytes = pemToPkcs8Bytes(params.privateKeyPem);
  // Copy into a clean ArrayBuffer to satisfy strict BufferSource typing across Workers & Node
  const keyBuffer = pkcs8Bytes.buffer.slice(
    pkcs8Bytes.byteOffset,
    pkcs8Bytes.byteOffset + pkcs8Bytes.byteLength
  ) as ArrayBuffer;

  const cryptoKey = await subtle.importKey(
    'pkcs8',
    keyBuffer,
    { name: 'Ed25519' },
    false,
    ['sign']
  );

  const iat = Math.floor(nowMs / 1000) - 30; // 30s clock-skew tolerance per QWeather docs
  const exp = iat + ttlSeconds;

  const headerB64 = base64UrlEncodeJson({ alg: 'EdDSA', kid: params.credentialId });
  const payloadObj: Record<string, unknown> = params.developerId
    ? { iss: params.developerId, sub: params.projectId, iat, exp }
    : { sub: params.projectId, iat, exp };
  const payloadB64 = base64UrlEncodeJson(payloadObj);
  const signingInput = `${headerB64}.${payloadB64}`;

  const signatureBuffer = await subtle.sign(
    'Ed25519',
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );
  const sigB64 = base64UrlEncodeBytes(new Uint8Array(signatureBuffer));
  const token = `${signingInput}.${sigB64}`;

  cachedJwt = {
    cacheKey,
    token,
    expiresAtMs: exp * 1000,
  };

  return token;
}

export function clearQWeatherJwtCache(): void {
  cachedJwt = null;
}

async function buildAuthHeaders(ctx: ProviderRuntimeContext): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  if (
    ctx.env.qweatherDeveloperId &&
    ctx.env.qweatherProjectId &&
    ctx.env.qweatherCredentialId &&
    ctx.env.qweatherPrivateKey
  ) {
    const jwt = await signQWeatherJwt({
      developerId: ctx.env.qweatherDeveloperId,
      projectId: ctx.env.qweatherProjectId,
      credentialId: ctx.env.qweatherCredentialId,
      privateKeyPem: ctx.env.qweatherPrivateKey,
      nowMs: ctx.nowMs,
    });
    headers.Authorization = `Bearer ${jwt}`;
  } else if (ctx.env.qweatherJwt) {
    headers.Authorization = `Bearer ${ctx.env.qweatherJwt}`;
  } else if (ctx.env.qweatherApiKey) {
    headers['X-QW-Api-Key'] = ctx.env.qweatherApiKey;
  }

  return headers;
}

function getBaseHost(ctx: ProviderRuntimeContext): string {
  const raw = ctx.env.qweatherHost || 'https://devapi.qweather.com';
  return raw.startsWith('http') ? raw.replace(/\/+$/, '') : `https://${raw.replace(/\/+$/, '')}`;
}

function extractPollutantsFromQWeather(rawList: any[]): PollutantValues {
  const pollutants: PollutantValues = {};
  if (!Array.isArray(rawList)) return pollutants;

  for (const item of rawList) {
    const code = String(item?.code || '').toLowerCase();
    const val = Number(item?.concentration?.value);
    const unit = item?.concentration?.unit as string | undefined;
    if (!Number.isFinite(val) || val < 0) continue;

    if (code === 'pm2p5' || code === 'pm25') {
      pollutants.pm25 = normalizePollutantUnit('pm25', val, unit);
    } else if (code === 'pm10') {
      pollutants.pm10 = normalizePollutantUnit('pm10', val, unit);
    } else if (code === 'o3') {
      pollutants.o3 = normalizePollutantUnit('o3', val, unit);
    } else if (code === 'no2') {
      pollutants.no2 = normalizePollutantUnit('no2', val, unit);
    } else if (code === 'so2') {
      pollutants.so2 = normalizePollutantUnit('so2', val, unit);
    } else if (code === 'co') {
      pollutants.co = normalizePollutantUnit('co', val, unit);
    }
  }
  return pollutants;
}

/**
 * QWeather (和风天气) Air Quality API v1 Provider:
 * - Connects directly to CNEMC national/provincial stations in China (typical latency 10-25 min)
 * - Global 1x1km coverage with multi-standard & physical concentrations
 * - Supports automatic Ed25519 JWT dynamic signing (`QWEATHER_PROJECT_ID` + `QWEATHER_CREDENTIAL_ID` + `QWEATHER_PRIVATE_KEY`),
 *   as well as static `QWEATHER_JWT` or `QWEATHER_API_KEY` + custom `QWEATHER_API_HOST`
 */
export const qweatherProvider: AirQualityProvider = {
  id: 'qweather',
  name: '和风天气空气质量',
  shortName: '和风天气',
  tier: 'station-grid-fusion',
  supportedCountries: '*',
  supportsBrowserDirect: false, // Server/Edge only to protect QWeather credentials

  isAvailable(ctx: ProviderRuntimeContext): boolean {
    const hasDynamicJwt = Boolean(
      ctx.env.qweatherDeveloperId &&
        ctx.env.qweatherProjectId &&
        ctx.env.qweatherCredentialId &&
        ctx.env.qweatherPrivateKey
    );
    return Boolean(
      ctx.env.qweatherHost &&
        (hasDynamicJwt || ctx.env.qweatherJwt || ctx.env.qweatherApiKey)
    );
  },

  realtime: {
    async fetchCitySnapshot(
      city: CityMeta,
      ctx: ProviderRuntimeContext
    ): Promise<ProviderCitySnapshot | null> {
      const host = getBaseHost(ctx);
      const headers = await buildAuthHeaders(ctx);
      const timeoutMs = ctx.timeoutMs ?? 4500;
      let subrequestsUsed = 0;

      const lat = city.latitude.toFixed(4);
      const lon = city.longitude.toFixed(4);
      const url = `${host}/airquality/v1/current/${lat}/${lon}?lang=zh`;

      subrequestsUsed++;
      const res = await ctx.fetchImpl(url, {
        headers,
        signal: createTimeoutSignal(timeoutMs, ctx.signal),
      });

      if (res.status === 401 || res.status === 403 || res.status === 429) {
        throw createHttpError(res.status, `QWeather HTTP ${res.status}`);
      }
      if (!res.ok) return null;

      const json = (await res.json()) as any;
      const pollutants = extractPollutantsFromQWeather(json?.pollutants);
      if (!hasValidPollutants(pollutants)) return null;

      const obsMs =
        parseObservedTimeMs(json?.updateTime || json?.metadata?.updateTime) ??
        Math.floor(ctx.nowMs / 3_600_000) * 3_600_000;
      const freshness = computeFreshness(obsMs, ctx.nowMs);

      const usIndex = Array.isArray(json?.indexes)
        ? json.indexes.find((idx: any) => String(idx?.code || '').toLowerCase() === 'us-epa')
        : undefined;
      const rawUsAqi =
        typeof usIndex?.aqi === 'number' && usIndex.aqi > 0
          ? Math.round(usIndex.aqi)
          : evaluateAQI(pollutants, 'US').aqi;

      const cityCanonicalId = `qweather:${city.id}` as const;
      const directReading: NormalizedStationSample = {
        stationId: cityCanonicalId,
        providerId: 'qweather',
        rawId: city.id,
        numericUid: hashStationIdToUid(cityCanonicalId),
        name: `${city.nameZh}城区融合观测`,
        latitude: city.latitude,
        longitude: city.longitude,
        isOfficial: true,
        freshness,
        pollutants,
        rawUsAqi,
        pm25IaqiUS: calculateUSIAQI(pollutants).pm25,
        pm25IaqiCN: calculateCNIAQI(pollutants).pm25,
      };

      const linkedStations = Array.isArray(json?.stations) ? json.stations : [];
      const maxLinked = Math.min(linkedStations.length, ctx.isServer ? 6 : 8);
      const stationSamples: NormalizedStationSample[] = [];

      if (maxLinked > 0) {
        const tasks = linkedStations.slice(0, maxLinked).map(async (st: any) => {
          const stId = String(st?.id || '').trim();
          if (!stId) return;
          subrequestsUsed++;
          try {
            const stRes = await ctx.fetchImpl(
              `${host}/airquality/v1/stations/${encodeURIComponent(stId)}?lang=zh`,
              {
                headers,
                signal: createTimeoutSignal(timeoutMs, ctx.signal),
              }
            );
            if (!stRes.ok) return;
            const stJson = (await stRes.json()) as any;
            const stPollutants = extractPollutantsFromQWeather(stJson?.pollutants);
            if (!hasValidPollutants(stPollutants)) return;

            const stObsMs = parseObservedTimeMs(stJson?.updateTime) ?? obsMs;
            const stCanonical = `qweather:${stId}` as const;
            stationSamples.push({
              stationId: stCanonical,
              providerId: 'qweather',
              rawId: stId,
              numericUid: hashStationIdToUid(stCanonical),
              name: st.name || stId,
              latitude: typeof st.latitude === 'number' ? st.latitude : city.latitude,
              longitude: typeof st.longitude === 'number' ? st.longitude : city.longitude,
              isOfficial: true,
              freshness: computeFreshness(stObsMs, ctx.nowMs),
              pollutants: stPollutants,
              rawUsAqi: evaluateAQI(stPollutants, 'US').aqi,
              pm25IaqiUS: calculateUSIAQI(stPollutants).pm25,
              pm25IaqiCN: calculateCNIAQI(stPollutants).pm25,
            });
          } catch {
            // Skip individual station timeout
          }
        });
        await Promise.all(tasks);
      }

      return {
        providerId: 'qweather',
        providerName: '和风天气',
        tier: stationSamples.length > 0 ? 'ground-official' : 'station-grid-fusion',
        stations: stationSamples,
        directCityReading: directReading,
        attributions: [{ name: '和风天气 QWeather Air Quality', url: 'https://www.qweather.com/' }],
        subrequestsUsed,
      };
    },
  },

  // Note: QWeather `/airquality/v1/hourly/` returns FUTURE hourly forecasts rather than past 24h observations,
  // so per AGENTS.md §9 we intentionally omit `hourlyTrend` here and let past 24h charts use real historical feeds.

  forecast: {
    async fetch5DayForecast(lat, lon, ctx) {
      const host = getBaseHost(ctx);
      const headers = await buildAuthHeaders(ctx);
      const res = await ctx.fetchImpl(
        `${host}/airquality/v1/daily/${lat.toFixed(4)}/${lon.toFixed(4)}?lang=zh`,
        {
          headers,
          signal: createTimeoutSignal(ctx.timeoutMs ?? 4500, ctx.signal),
        }
      );
      if (!res.ok) return null;
      const json = (await res.json()) as any;
      const days: any[] = Array.isArray(json?.days) ? json.days : [];
      if (days.length === 0) return null;

      const list: ForecastDay[] = days
        .slice(0, 5)
        .map((d) => {
          const day = String(d?.forecastStartTime || '').slice(0, 10);
          const pollutants = extractPollutantsFromQWeather(d?.pollutants);
          const avg = Math.round(pollutants.pm25 ?? 0);
          return {
            day,
            avg,
            min: Math.max(0, Math.round(avg * 0.8)),
            max: Math.round(avg * 1.2),
          };
        })
        .filter((d) => d.day.length === 10 && d.avg > 0);

      if (list.length === 0) return null;
      return {
        list,
        source: '和风天气空气质量预报',
      };
    },
  },
};
