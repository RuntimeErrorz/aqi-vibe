import { describe, it, expect, beforeEach } from 'vitest';
import { findCity } from '@/lib/constants/cities';
import { filterStationsForCity } from '@/lib/services/geo-filter';
import type { WaqiBoundStation } from '@/lib/services/waqi';
import {
  computeFreshness,
  formatDelayBadge,
  isSameSovereignCountry,
  parseObservedTimeMs,
  pruneStaleStations,
  sortStationsByFreshnessAndDistance,
} from '@/lib/datasources/freshness';
import { normalizePollutantUnit } from '@/lib/datasources/units';
import { ProviderRegistry, resolveProviderSecrets } from '@/lib/datasources/registry';
import { DataSourceOrchestrator } from '@/lib/datasources/orchestrator';
import type { AirQualityProvider, ProviderRuntimeContext } from '@/lib/datasources/types';
import {
  qweatherProvider,
  signQWeatherJwt,
  clearQWeatherJwtCache,
} from '@/lib/datasources/providers/qweather.provider';
import { caiyunProvider } from '@/lib/datasources/providers/caiyun.provider';
import { waqiProvider } from '@/lib/datasources/providers/waqi.provider';
import { hkEpdProvider, clearHkEpdCache, parseHkEpdXml } from '@/lib/datasources/providers/hk-epd.provider';
import { twMoenvProvider, clearTwMoenvCache } from '@/lib/datasources/providers/tw-moenv.provider';
import { openaqProvider } from '@/lib/datasources/providers/openaq.provider';
import { airnowProvider } from '@/lib/datasources/providers/airnow.provider';
import { googleAqProvider } from '@/lib/datasources/providers/google-aq.provider';
import { openweatherProvider } from '@/lib/datasources/providers/openweather.provider';
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
  beforeEach(() => {
    clearHkEpdCache();
    clearTwMoenvCache();
  });

  it('parses Hong Kong EPD XML for both realtime stations and 24h hourly trend', async () => {
    const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<AQHI24HrPollutantConcentration>
  <PollutantConcentration><StationName>Central/Western</StationName><DateTime>Fri, 27 Nov 2026 13:00:00 +0800</DateTime><NO2>40</NO2><O3>55</O3><SO2>5</SO2><CO>500</CO><PM10>30</PM10><PM2.5>18</PM2.5></PollutantConcentration>
  <PollutantConcentration><StationName>Central/Western</StationName><DateTime>Fri, 27 Nov 2026 14:00:00 +0800</DateTime><NO2>42</NO2><O3>58</O3><SO2>5</SO2><CO>520</CO><PM10>32</PM10><PM2.5>19</PM2.5></PollutantConcentration>
  <PollutantConcentration><StationName>Central/Western</StationName><DateTime>Fri, 27 Nov 2026 15:00:00 +0800</DateTime><NO2>45</NO2><O3>60</O3><SO2>6</SO2><CO>600</CO><PM10>35</PM10><PM2.5>22</PM2.5></PollutantConcentration>
</AQHI24HrPollutantConcentration>`;

    expect(parseHkEpdXml(sampleXml).length).toBe(3);

    const mockFetch: typeof fetch = async () => new Response(sampleXml, { status: 200 });
    const hk = findCity('gl-hong-kong')!;
    const ctx: ProviderRuntimeContext = { env: {}, fetchImpl: mockFetch, nowMs: NOW_MS, isServer: true };

    const snap = await hkEpdProvider.realtime!.fetchCitySnapshot(hk, ctx);
    expect(snap?.providerId).toBe('hk-epd');
    expect(snap?.stations.length).toBe(1);
    expect(snap?.stations[0].pollutants.pm25).toBe(22);
    expect(snap?.stations[0].pollutants.co).toBe(0.6); // 600 ug/m3 -> 0.6 mg/m3
    expect(snap?.stations[0].freshness?.delayMinutes).toBe(36);

    const hourly = await hkEpdProvider.hourlyTrend!.fetchHourlyTrend(
      { city: hk, standard: 'CN' },
      ctx
    );
    expect(hourly?.isReal).toBe(true);
    expect(hourly?.points.length).toBe(3);
    expect(hourly?.points[2].pm25).toBe(22);
  });

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

  it('parses OpenAQ v3, Taiwan MOENV, US AirNow, Google AQ, and OpenWeather payloads', async () => {
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

    // Taiwan MOENV
    const taipei = findCity('gl-taipei')!;
    const twSnap = await twMoenvProvider.realtime!.fetchCitySnapshot(taipei, {
      env: { moenvApiKey: 'k' },
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            records: [
              {
                siteid: '11',
                sitename: '中山',
                county: '臺北市',
                aqi: '52',
                'pm2.5': '16',
                pm10: '28',
                o3: '35',
                co: '0.4',
                publishtime: '2026-11-27 15:00',
                latitude: '25.0623',
                longitude: '121.5265',
              },
            ],
          }),
          { status: 200 }
        ),
      nowMs: NOW_MS,
      isServer: true,
    });
    expect(twSnap?.stations[0].pollutants.pm25).toBe(16);
    expect(twSnap?.stations[0].freshness?.delayMinutes).toBe(36);

    // US AirNow
    const nyc = findCity('gl-newyork')!;
    const anSnap = await airnowProvider.realtime!.fetchCitySnapshot(nyc, {
      env: { airnowApiKey: 'k' },
      fetchImpl: async () =>
        new Response(
          JSON.stringify([
            {
              DateObserved: '2026-11-27 ',
              HourObserved: 2,
              LocalTimeZone: 'EST',
              ReportingArea: 'New York City',
              StateCode: 'NY',
              Latitude: 40.7128,
              Longitude: -74.006,
              ParameterName: 'PM2.5',
              AQI: 55,
            },
          ]),
          { status: 200 }
        ),
      nowMs: NOW_MS,
      isServer: true,
    });
    expect(anSnap?.stations[0].pollutants.pm25).toBeGreaterThan(10);
    expect(anSnap?.stations[0].freshness?.delayMinutes).toBe(36);

    // Google AQ
    const gSnap = await googleAqProvider.realtime!.fetchCitySnapshot(paris, {
      env: { googleAqApiKey: 'k' },
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            dateTime: '2026-11-27T07:00:00Z',
            pollutants: [
              { code: 'pm25', concentration: { value: 18.2, units: 'MICROGRAMS_PER_CUBIC_METER' } },
              { code: 'no2', concentration: { value: 15, units: 'PARTS_PER_BILLION' } },
            ],
          }),
          { status: 200 }
        ),
      nowMs: NOW_MS,
      isServer: true,
    });
    expect(gSnap?.directCityReading?.pollutants.pm25).toBe(18.2);
    expect(gSnap?.directCityReading?.pollutants.no2).toBeCloseTo(28.2, 1);

    // OpenWeather
    const owSnap = await openweatherProvider.realtime!.fetchCitySnapshot(paris, {
      env: { openweatherApiKey: 'k' },
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            list: [
              {
                dt: Math.floor((NOW_MS - 36 * 60_000) / 1000),
                components: { pm2_5: 19.4, pm10: 27.1, o3: 44.2, no2: 21.0, so2: 3.1, co: 450 },
              },
            ],
          }),
          { status: 200 }
        ),
      nowMs: NOW_MS,
      isServer: true,
    });
    expect(owSnap?.directCityReading?.pollutants.pm25).toBe(19.4);
    expect(owSnap?.directCityReading?.pollutants.co).toBe(0.45);
  });

  it('parses Caiyun Weather v2.6 realtime pollutants, weather unit conversions, and 5-day PM2.5 forecast', async () => {
    const chengdu = findCity('cn-chengdu')!;
    const mockFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          status: 'ok',
          server_time: Math.floor(NOW_MS / 1000),
          result: {
            realtime: {
              temperature: 14.5,
              humidity: 0.68,
              wind: { speed: 10.8 },
              pressure: 101500,
              air_quality: {
                pm25: 23,
                pm10: 41,
                o3: 76,
                no2: 18,
                so2: 5,
                co: 0.6,
                aqi: { chn: 41, usa: 74 },
              },
            },
            daily: {
              air_quality: {
                pm25: [
                  { date: '2026-11-27T00:00+08:00', max: 35, avg: 24, min: 15 },
                  { date: '2026-11-28T00:00+08:00', max: 42, avg: 30, min: 18 },
                  { date: '2026-11-29T00:00+08:00', max: 28, avg: 20, min: 12 },
                ],
              },
            },
          },
        }),
        { status: 200 }
      );

    const snap = await caiyunProvider.realtime!.fetchCitySnapshot(chengdu, {
      env: { caiyunToken: 'test-token' },
      fetchImpl: mockFetch,
      nowMs: NOW_MS,
      isServer: true,
    });

    expect(snap?.providerId).toBe('caiyun');
    expect(snap?.directCityReading?.pollutants.pm25).toBe(23);
    expect(snap?.directCityReading?.weather?.temp).toBe(14.5);
    expect(snap?.directCityReading?.weather?.humidity).toBe(68);
    expect(snap?.directCityReading?.weather?.windSpeed).toBe(3); // 10.8 km/h -> 3.0 m/s
    expect(snap?.directCityReading?.weather?.pressure).toBe(1015); // 101500 Pa -> 1015 hPa
    expect(snap?.forecast?.pm25?.length).toBe(3);
    expect(snap?.forecast?.pm25?.[1]).toEqual({ day: '2026-11-28', avg: 30, min: 18, max: 42 });
  });

  it('decouples 72h WAQI hourly trend by auto-resolving city stationIdx when realtime came from QWeather/Caiyun', async () => {
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
});
