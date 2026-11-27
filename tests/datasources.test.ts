import { describe, it, expect, beforeEach } from 'vitest';
import { findCity } from '@/lib/constants/cities';
import { filterStationsForCity } from '@/lib/services/geo-filter';
import type { WaqiBoundStation } from '@/lib/services/waqi';
import {
  computeFreshness,
  formatDelayBadge,
  formatLocalTimeForCityWithTz,
  isPlausibleLocalOffsetForCity,
  isSameSovereignCountry,
  parseObservedTimeMs,
  pruneStaleStations,
  sortStationsByFreshnessAndDistance,
} from '@/lib/datasources/freshness';
import { normalizePollutantUnit } from '@/lib/datasources/units';
import { ProviderRegistry, resolveProviderSecrets } from '@/lib/datasources/registry';
import { createRuntimeContext } from '@/lib/datasources';
import { DataSourceOrchestrator } from '@/lib/datasources/orchestrator';
import type { AirQualityProvider, ProviderRuntimeContext } from '@/lib/datasources/types';
import {
  qweatherProvider,
  signQWeatherJwt,
  clearQWeatherJwtCache,
} from '@/lib/datasources/providers/qweather.provider';
import { waqiProvider } from '@/lib/datasources/providers/waqi.provider';
import { openaqProvider } from '@/lib/datasources/providers/openaq.provider';
import { openMeteoProvider } from '@/lib/datasources/providers/openmeteo.provider';

const NOW_MS = Date.parse('2026-11-27T07:36:00Z'); // 15:36 CST

describe('Multi-Source Freshness, Units & Sovereign Boundary Fixes', () => {
  it('handles HK/MO sovereign compatibility while preserving Voronoi border separation', () => {
    expect(isSameSovereignCountry('CN', 'HK')).toBe(true);
    expect(isSameSovereignCountry('CN', 'MO')).toBe(true);
    expect(isSameSovereignCountry('MY', 'SG')).toBe(false);
    expect(isSameSovereignCountry('CN', 'JP')).toBe(false);

    const hongKong = findCity('gl-hong-kong')!;
    const hkStations: WaqiBoundStation[] = [
      // Official HK Central station (~4km from HK center)
      {
        uid: 2560,
        lat: 22.2818,
        lon: 114.1581,
        aqi: '55',
        station: { name: 'Central, HongKong (中环)', time: '2026-11-27T15:00:00+08:00' },
      },
      // Shenzhen Luohu station (closer to Shenzhen than HK -> excluded by Voronoi)
      {
        uid: 14469,
        lat: 22.5417,
        lon: 114.1167,
        aqi: '63',
        station: { name: 'Nanhu, Shenzhen (罗湖区)', time: '2026-11-27T15:00:00+08:00' },
      },
    ];

    const filtered = filterStationsForCity(hkStations, hongKong);
    expect(filtered.map((s) => s.uid)).toEqual([2560]);
  });

  it('prunes >4h zombie sensors (Chicago case) while honestly keeping whole-city lagged clusters (Chengdu case)', () => {
    const chicagoStations = [
      { id: 'fresh-1', observedAtMs: NOW_MS - 60 * 60_000 },
      { id: 'fresh-2', observedAtMs: NOW_MS - 90 * 60_000 },
      { id: 'zombie', observedAtMs: NOW_MS - 2557 * 60_000 }, // 42.6 hours old!
    ];
    expect(pruneStaleStations(chicagoStations, NOW_MS).map((s) => s.id)).toEqual([
      'fresh-1',
      'fresh-2',
    ]);

    const chengduStations = [
      { id: 'cd-1', observedAtMs: NOW_MS - 216 * 60_000 },
      { id: 'cd-2', observedAtMs: NOW_MS - 216 * 60_000 },
    ];
    expect(pruneStaleStations(chengduStations, NOW_MS).map((s) => s.id)).toEqual(['cd-1', 'cd-2']);
  });

  it('prioritizes freshest stations before distance (Beijing 15:00 vs lagged 13:00 center station)', () => {
    const stations = [
      { id: 'center-lagged', distKm: 1.5, observedAtMs: NOW_MS - 156 * 60_000 }, // 13:00
      { id: 'fresh-near', distKm: 4.2, observedAtMs: NOW_MS - 36 * 60_000 },     // 15:00
      { id: 'fresh-far', distKm: 11.0, observedAtMs: NOW_MS - 36 * 60_000 },     // 15:00
    ];
    const sorted = sortStationsByFreshnessAndDistance(stations);
    expect(sorted.map((s) => s.id)).toEqual(['fresh-near', 'fresh-far', 'center-lagged']);
  });

  it('normalizes heterogeneous gas/particulate units into canonical μg/m³ and CO mg/m³', () => {
    expect(normalizePollutantUnit('co', 633.4, 'ug/m3')).toBe(0.63);
    expect(normalizePollutantUnit('co', 0.5, 'ppm')).toBeCloseTo(0.57, 2);
    expect(normalizePollutantUnit('co', 500, 'PARTS_PER_BILLION')).toBeCloseTo(0.57, 2);
    expect(normalizePollutantUnit('no2', 20, 'ppb')).toBeCloseTo(37.6, 1);
    expect(normalizePollutantUnit('o3', 0.05, 'ppm')).toBeCloseTo(98.2, 1);
    expect(normalizePollutantUnit('pm25', 34.56, 'µg/m³')).toBe(34.6);
  });

  it('parses RFC-2822 / ISO / naive timestamps and formats concise delay badges', () => {
    const epdMs = parseObservedTimeMs('Fri, 27 Nov 2026 15:00:00 +0800');
    expect(epdMs).toBe(Date.parse('2026-11-27T07:00:00Z'));

    const freshMeta = computeFreshness(NOW_MS - 36 * 60_000, NOW_MS);
    expect(freshMeta?.isStale).toBe(false);
    expect(formatDelayBadge(freshMeta)).toBeNull();

    const staleMeta = computeFreshness(NOW_MS - 216 * 60_000, NOW_MS);
    expect(staleMeta?.isStale).toBe(true);
    expect(formatDelayBadge(staleMeta)?.label).toBe('延迟 4h');
    expect(formatDelayBadge(staleMeta)?.severity).toBe('severe');
  });
});

describe('Strategy A Orchestrator (Region-Aware + >90m Freshness Auto-Failover)', () => {
  const chengdu = findCity('cn-chengdu')!;

  function makeMockProvider(
    id: AirQualityProvider['id'],
    name: string,
    delayMin: number,
    pm25: number,
    opts?: { fail?: boolean; status?: number; onCall?: () => void }
  ): AirQualityProvider {
    return {
      id,
      name,
      shortName: name,
      tier: 'ground-official',
      supportedCountries: '*',
      supportsBrowserDirect: true,
      isAvailable: () => true,
      realtime: {
        async fetchCitySnapshot(city, ctx) {
          opts?.onCall?.();
          if (opts?.fail) {
            const err = new Error('Upstream failed') as Error & { status?: number };
            err.status = opts.status;
            throw err;
          }
          const obsMs = ctx.nowMs - delayMin * 60_000;
          return {
            providerId: id,
            providerName: name,
            tier: 'ground-official',
            stations: [
              {
                stationId: `${id}:s1`,
                providerId: id,
                rawId: 's1',
                numericUid: 1001,
                name: `${city.nameZh}监测站`,
                latitude: city.latitude,
                longitude: city.longitude,
                isOfficial: true,
                freshness: computeFreshness(obsMs, ctx.nowMs),
                pollutants: { pm25, pm10: pm25 * 1.4, o3: 50 },
              },
            ],
            subrequestsUsed: 1,
          };
        },
      },
    };
  }

  it('fast-paths without calling backup when primary source is fresh (<= 90m)', async () => {
    let backupCalled = false;
    const registry = new ProviderRegistry();
    registry.register(makeMockProvider('qweather', '和风天气', 20, 42));
    registry.register(
      makeMockProvider('waqi', 'WAQI', 15, 40, {
        onCall: () => {
          backupCalled = true;
        },
      })
    );

    const orchestrator = new DataSourceOrchestrator(registry, { strategy: 'region-freshness' });
    const ctx: ProviderRuntimeContext = {
      env: {},
      fetchImpl: fetch,
      nowMs: NOW_MS,
      isServer: true,
      enrichWeather: false,
    };
    const result = await orchestrator.fetchCityRealtime(chengdu, ctx);

    expect(result?.provenance.providerId).toBe('qweather');
    expect(result?.provenance.fallbackFrom).toBeUndefined();
    expect(backupCalled).toBe(false);
  });

  it('seamlessly switches to fresher backup when primary exceeds 90m delay and records fallback provenance', async () => {
    const registry = new ProviderRegistry();
    // Primary QWeather delayed 3.5h, backup WAQI fresh at 25m -> switches automatically!
    registry.register(makeMockProvider('qweather', '和风天气', 210, 60));
    registry.register(makeMockProvider('waqi', 'WAQI', 25, 48));

    const orchestrator = new DataSourceOrchestrator(registry, { strategy: 'region-freshness' });
    const ctx: ProviderRuntimeContext = {
      env: {},
      fetchImpl: fetch,
      nowMs: NOW_MS,
      isServer: true,
      enrichWeather: false,
    };
    const result = await orchestrator.fetchCityRealtime(chengdu, ctx);

    expect(result?.provenance.providerId).toBe('waqi');
    expect(result?.provenance.fallbackFrom).toEqual({
      providerId: 'qweather',
      reason: 'stale',
      delayMinutes: 210,
    });
    expect(result?.compositeRecord.pollutants.pm25).toBe(48);
  });

  it('trips circuit breaker on HTTP 429/401 and routes subsequent calls straight to healthy backup', async () => {
    let primaryCalls = 0;
    const registry = new ProviderRegistry();
    registry.register(
      makeMockProvider('qweather', '和风天气', 10, 50, {
        fail: true,
        status: 429,
        onCall: () => {
          primaryCalls++;
        },
      })
    );
    registry.register(makeMockProvider('waqi', 'WAQI', 30, 52));

    const orchestrator = new DataSourceOrchestrator(registry, { strategy: 'region-freshness' });
    const ctx: ProviderRuntimeContext = {
      env: {},
      fetchImpl: fetch,
      nowMs: NOW_MS,
      isServer: true,
      enrichWeather: false,
    };

    const first = await orchestrator.fetchCityRealtime(chengdu, ctx);
    expect(first?.provenance.providerId).toBe('waqi');
    expect(first?.provenance.fallbackFrom?.reason).toBe('rate-limited');
    expect(primaryCalls).toBe(1);

    // Second call within cooldown must skip tripped primary immediately
    const second = await orchestrator.fetchCityRealtime(chengdu, ctx);
    expect(second?.provenance.providerId).toBe('waqi');
    expect(primaryCalls).toBe(1);
  });

  it('never injects numerical-model Open-Meteo into ground-station realtime routing', async () => {
    const registry = new ProviderRegistry();
    registry.register(openMeteoProvider);
    const orchestrator = new DataSourceOrchestrator(registry);
    const ctx: ProviderRuntimeContext = { env: {}, fetchImpl: fetch, nowMs: NOW_MS, isServer: true };

    const realtime = await orchestrator.fetchCityRealtime(chengdu, ctx);
    expect(realtime).toBeNull();
  });
});

describe('Individual Data Source Provider Adapters', () => {
  it('parses QWeather Air Quality v1 current + linked station responses', async () => {
    const chengdu = findCity('cn-chengdu')!;
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('/airquality/v1/current/')) {
        return new Response(
          JSON.stringify({
            updateTime: '2026-11-27T15:00:00+08:00',
            indexes: [{ code: 'us-epa', aqi: 89 }],
            pollutants: [
              { code: 'pm2p5', concentration: { value: 30.2, unit: 'µg/m³' } },
              { code: 'pm10', concentration: { value: 52.0, unit: 'µg/m³' } },
              { code: 'co', concentration: { value: 0.7, unit: 'mg/m³' } },
            ],
            stations: [{ id: 'ST01', name: '草堂寺', latitude: 30.659, longitude: 104.028 }],
          }),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify({
          updateTime: '2026-11-27T15:00:00+08:00',
          pollutants: [{ code: 'pm2p5', concentration: { value: 31.5, unit: 'µg/m³' } }],
        }),
        { status: 200 }
      );
    };

    const ctx: ProviderRuntimeContext = {
      env: { qweatherHost: 'https://test.qweatherapi.com', qweatherApiKey: 'test-key' },
      fetchImpl: mockFetch,
      nowMs: NOW_MS,
      isServer: true,
    };

    const snap = await qweatherProvider.realtime!.fetchCitySnapshot(chengdu, ctx);
    expect(snap?.providerId).toBe('qweather');
    expect(snap?.directCityReading?.pollutants.pm25).toBe(30.2);
    expect(snap?.stations.length).toBe(1);
    expect(snap?.stations[0].pollutants.pm25).toBe(31.5);
    expect(snap?.directCityReading?.freshness?.delayMinutes).toBe(36);
  });

  it('signs and verifies QWeather Ed25519 JWT dynamically using Web Crypto', async () => {
    clearQWeatherJwtCache();
    const { generateKeyPairSync } = await import('node:crypto');
    const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'der' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    const jwt = await signQWeatherJwt({
      developerId: 'QDEV12345',
      projectId: 'PROJ12345',
      credentialId: 'CRED67890',
      privateKeyPem: privateKey,
      nowMs: NOW_MS,
    });

    const parts = jwt.split('.');
    expect(parts.length).toBe(3);

    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    expect(header).toEqual({ alg: 'EdDSA', kid: 'CRED67890' });
    expect(payload.iss).toBe('QDEV12345');
    expect(payload.sub).toBe('PROJ12345');
    expect(payload.exp - payload.iat).toBe(900);

    // Cryptographically verify signature with public key
    const verifyKey = await globalThis.crypto.subtle.importKey(
      'spki',
      publicKey,
      { name: 'Ed25519' },
      false,
      ['verify']
    );
    const sigBytes = Buffer.from(parts[2], 'base64url');
    const valid = await globalThis.crypto.subtle.verify(
      'Ed25519',
      verifyKey,
      sigBytes,
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
    );
    expect(valid).toBe(true);
  });

  it('parses OpenAQ v3 payloads with unit normalization', async () => {
    const paris = findCity('gl-paris')!;
    const openaqFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('/locations?')) {
        return new Response(
          JSON.stringify({
            results: [
              {
                id: 500,
                name: 'Paris Centre',
                isMonitor: true,
                coordinates: { latitude: 48.8566, longitude: 2.3522 },
                sensors: [
                  { id: 1, parameter: { name: 'pm25', units: 'µg/m³' } },
                  { id: 2, parameter: { name: 'no2', units: 'ppm' } },
                ],
              },
            ],
          }),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify({
          results: [
            { sensorsId: 1, value: 14.5, datetime: { utc: '2026-11-27T07:00:00Z' } },
            { sensorsId: 2, value: 0.02, datetime: { utc: '2026-11-27T07:00:00Z' } },
          ],
        }),
        { status: 200 }
      );
    };
    const oaqSnap = await openaqProvider.realtime!.fetchCitySnapshot(paris, {
      env: { openaqApiKey: 'k' },
      fetchImpl: openaqFetch,
      nowMs: NOW_MS,
      isServer: true,
    });
    expect(oaqSnap?.stations[0].pollutants.pm25).toBe(14.5);
    expect(oaqSnap?.stations[0].pollutants.no2).toBeCloseTo(37.6, 1);
  });

  it('decouples 72h WAQI hourly trend by auto-resolving city stationIdx when realtime came from QWeather', async () => {
    const chengdu = findCity('cn-chengdu')!;
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('api.waqi.info/feed/chengdu/')) {
        return new Response(JSON.stringify({ status: 'ok', data: { idx: 1450 } }), { status: 200 });
      }
      if (url.includes('api2.waqi.info/api/token/1450')) {
        return new Response(
          JSON.stringify({ rxs: { obs: [{ msg: { token: 'mock-tok' } }] } }),
          { status: 200 }
        );
      }
      if (url.includes('api2.waqi.info/api/feed/@1450/aqi.json')) {
        return new Response(
          JSON.stringify({
            rxs: {
              obs: [
                {
                  msg: {
                    obs: {
                      pm25: { s: '2026-11-27 15:00:00', d: 3600, m: 1, v: [68, -4, -2, 5] },
                      o3: { s: '2026-11-27 15:00:00', d: 3600, m: 1, v: [35, -3, -2, 1] },
                    },
                  },
                },
              ],
            },
          }),
          { status: 200 }
        );
      }
      return new Response('Not Found', { status: 404 });
    };

    // Note: stationRawId is intentionally omitted (simulating realtime served by QWeather/Caiyun)
    const trend = await waqiProvider.hourlyTrend!.fetchHourlyTrend(
      { city: chengdu, standard: 'CN' },
      {
        env: { waqiTokens: ['tok-1'] },
        fetchImpl: mockFetch,
        nowMs: NOW_MS,
        isServer: true,
      }
    );

    expect(trend?.isReal).toBe(true);
    expect(trend?.points.length).toBe(4);
    // Chengdu 15:00 CST (UTC+8) -> 2026-11-27T07:00:00Z
    expect(trend?.points[trend.points.length - 1].timestampMs).toBe(
      Date.parse('2026-11-27T07:00:00Z')
    );
  });

  it('extracts secrets from non-enumerable Cloudflare Worker env objects without object spread loss', () => {
    const workerdEnv = {};
    Object.defineProperties(workerdEnv, {
      QWEATHER_API_HOST: { value: 'https://test.re.qweatherapi.com', enumerable: false },
      QWEATHER_DEVELOPER_ID: { value: 'QDEV123', enumerable: false },
      QWEATHER_PROJECT_ID: { value: 'PROJ456', enumerable: false },
      QWEATHER_CREDENTIAL_ID: { value: 'CRED789', enumerable: false },
      QWEATHER_PRIVATE_KEY: { value: '-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----', enumerable: false },
      OPENAQ_API_KEY: { value: 'openaq-secret', enumerable: false },
    });

    // Confirm object spread loses non-enumerable properties, while resolveProviderSecrets preserves all of them
    expect(Object.keys({ ...workerdEnv })).toEqual([]);
    const secrets = resolveProviderSecrets(workerdEnv as any);
    expect(secrets.qweatherHost).toBe('https://test.re.qweatherapi.com');
    expect(secrets.qweatherDeveloperId).toBe('QDEV123');
    expect(secrets.qweatherProjectId).toBe('PROJ456');
    expect(secrets.qweatherCredentialId).toBe('CRED789');
    expect(secrets.qweatherPrivateKey).toContain('\nABC\n');
    expect(secrets.openaqApiKey).toBe('openaq-secret');
  });

  it('wraps fetchImpl safely for Cloudflare workerd (no Illegal invocation & strips cache:no-store)', async () => {
    let observedThis: unknown = 'sentinel';
    let observedInit: RequestInit | undefined;
    const strictWorkerdFetch = function (this: unknown, _input: RequestInfo | URL, init?: RequestInit) {
      observedThis = this;
      observedInit = init;
      if (this !== undefined && this !== globalThis) {
        throw new TypeError('Illegal invocation');
      }
      if (init && 'cache' in init) {
        throw new TypeError("The 'cache' field on 'RequestInitializerDict' is not implemented.");
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    } as typeof fetch;

    const ctx = createRuntimeContext({ fetchImpl: strictWorkerdFetch, isServer: true });
    const res = await ctx.fetchImpl('https://example.com/test', { cache: 'no-store', method: 'GET' });
    expect(res.status).toBe(200);
    expect(observedThis).toBeUndefined();
    expect(observedInit).toEqual({ method: 'GET' });
  });

  it('resolves DST-accurate IANA local time and UTC offset (Sydney AEDT/AEST, NYC EST/EDT, London GMT/BST, India +5:30)', () => {
    const novUtc = Date.parse('2026-11-27T10:00:00Z');
    const julUtc = Date.parse('2026-07-15T10:00:00Z');

    // Sydney: AEDT (UTC+11) in Nov -> 21:00; AEST (UTC+10) in Jul -> 20:00
    expect(formatLocalTimeForCityWithTz(novUtc, 'AU', 151.2093, -33.8688)).toEqual({
      localTime: '2026-11-27 21:00:00',
      timezoneOffset: 'UTC+11',
    });
    expect(formatLocalTimeForCityWithTz(julUtc, 'AU', 151.2093, -33.8688)).toEqual({
      localTime: '2026-07-15 20:00:00',
      timezoneOffset: 'UTC+10',
    });

    // New York: EST (UTC-5) in Nov -> 05:00; EDT (UTC-4) in Jul -> 06:00
    expect(formatLocalTimeForCityWithTz(novUtc, 'US', -74.006, 40.7128)).toEqual({
      localTime: '2026-11-27 05:00:00',
      timezoneOffset: 'UTC-5',
    });
    expect(formatLocalTimeForCityWithTz(julUtc, 'US', -74.006, 40.7128)).toEqual({
      localTime: '2026-07-15 06:00:00',
      timezoneOffset: 'UTC-4',
    });

    // London: GMT (UTC+0) in Nov -> 10:00; BST (UTC+1) in Jul -> 11:00
    expect(formatLocalTimeForCityWithTz(novUtc, 'GB', -0.1276, 51.5072)).toEqual({
      localTime: '2026-11-27 10:00:00',
      timezoneOffset: 'UTC+0',
    });
    expect(formatLocalTimeForCityWithTz(julUtc, 'GB', -0.1276, 51.5072)).toEqual({
      localTime: '2026-07-15 11:00:00',
      timezoneOffset: 'UTC+1',
    });

    // India half-hour offset: UTC+5:30
    expect(formatLocalTimeForCityWithTz(novUtc, 'IN', 77.209, 28.6139)).toEqual({
      localTime: '2026-11-27 15:30:00',
      timezoneOffset: 'UTC+5:30',
    });
  });

  it('guards OpenAQ realtime & hourly trend against bogus +00:00 UTC local strings in non-UTC cities', async () => {
    const nyc = findCity('gl-newyork')!;
    const novUtc = Date.parse('2026-11-27T09:00:00Z');
    // Bogus UTC "+00:00" for New York must be flagged implausible, while "-05:00" is plausible
    expect(isPlausibleLocalOffsetForCity('2026-11-27T09:00:00+00:00', novUtc, 'US', -74.006, 40.7128)).toBe(false);
    expect(isPlausibleLocalOffsetForCity('2026-11-27T04:00:00-05:00', novUtc, 'US', -74.006, 40.7128)).toBe(true);

    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('/locations?')) {
        return new Response(
          JSON.stringify({
            results: [
              {
                id: 999,
                name: 'NY Midtown Monitor',
                isMonitor: true,
                coordinates: { latitude: 40.75, longitude: -73.98 },
                datetimeLast: { utc: '2026-11-27T09:00:00Z' },
                sensors: [{ id: 5555, parameter: { name: 'pm25', units: 'µg/m³' } }],
              },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.includes('/locations/999/latest')) {
        return new Response(
          JSON.stringify({
            results: [
              {
                sensorsId: 5555,
                value: 11.2,
                datetime: { utc: '2026-11-27T09:00:00Z', local: '2026-11-27T09:00:00+00:00' },
              },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.includes('/sensors/5555/hours')) {
        return new Response(
          JSON.stringify({
            results: [
              {
                value: 10.1,
                parameter: { units: 'µg/m³' },
                period: {
                  datetimeTo: { utc: '2026-11-27T07:00:00Z', local: '2026-11-27T07:00:00+00:00' },
                },
              },
              {
                value: 10.8,
                parameter: { units: 'µg/m³' },
                period: {
                  datetimeTo: { utc: '2026-11-27T08:00:00Z', local: '2026-11-27T08:00:00+00:00' },
                },
              },
              {
                value: 11.2,
                parameter: { units: 'µg/m³' },
                period: {
                  datetimeTo: { utc: '2026-11-27T09:00:00Z', local: '2026-11-27T09:00:00+00:00' },
                },
              },
            ],
          }),
          { status: 200 }
        );
      }
      return new Response('Not Found', { status: 404 });
    };

    const ctx: ProviderRuntimeContext = {
      env: { openaqApiKey: 'test-key' },
      fetchImpl: mockFetch,
      nowMs: Date.parse('2026-11-27T09:40:00Z'),
      isServer: true,
    };

    const snap = await openaqProvider.realtime!.fetchCitySnapshot(nyc, ctx);
    expect(snap?.stations[0].freshness?.observedAtLocal).toBe('2026-11-27 04:00:00');
    expect(snap?.stations[0].freshness?.timezoneOffset).toBe('UTC-5');

    const trend = await openaqProvider.hourlyTrend!.fetchHourlyTrend({ city: nyc, standard: 'US' }, ctx);
    expect(trend?.isReal).toBe(true);
    expect(trend?.providerId).toBe('openaq');
    expect(trend?.timezoneOffset).toBe('UTC-5');
    expect(trend?.points.map((p) => p.fullTime)).toEqual([
      '11-27 02:00',
      '11-27 03:00',
      '11-27 04:00',
    ]);
    expect(trend?.points.map((p) => p.timestampMs)).toEqual([
      Date.parse('2026-11-27T07:00:00Z'),
      Date.parse('2026-11-27T08:00:00Z'),
      Date.parse('2026-11-27T09:00:00Z'),
    ]);
  });

  it('computes Open-Meteo 5-day forecast today boundary using city utc_offset_seconds rather than Worker UTC clock', async () => {
    // Worker UTC clock is 2026-11-27 02:00Z, which is STILL 2026-11-26 21:00 EST in New York!
    const mockFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          utc_offset_seconds: -18000, // UTC-5
          hourly: {
            time: [
              '2026-11-26T20:00',
              '2026-11-26T21:00',
              '2026-11-27T12:00',
              '2026-11-28T12:00',
            ],
            pm2_5: [12, 14, 18, 20],
          },
        }),
        { status: 200 }
      );

    const res = await openMeteoProvider.forecast!.fetch5DayForecast(40.7128, -74.006, {
      env: {},
      fetchImpl: mockFetch,
      nowMs: Date.parse('2026-11-27T02:00:00Z'),
      isServer: true,
    });

    expect(res?.list[0].day).toBe('2026-11-26');
    expect(res?.list.length).toBe(3);
  });
});
