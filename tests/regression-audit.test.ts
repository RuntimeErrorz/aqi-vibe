import { describe, it, expect, vi } from 'vitest';
import worker from '../worker';
import { evaluateAQI, calculatePM25AQI } from '@/lib/aqi-calculator';
import { aggregateCompositeRecord } from '@/lib/services/composite-aggregator';
import {
  buildRankingSnapshotFromDraft,
  runRankingCronBatch,
  KVNamespaceLike,
} from '@/lib/services/cf-ranking-engine';
import { getHotPackKey, readHotCityFromKV } from '@/lib/services/cf-hot-cities';
import {
  clearQWeatherTagTracker,
  qweatherProvider,
  seedQWeatherContentTag,
  trackQWeatherContentTag,
} from '@/lib/datasources/providers/qweather.provider';
import { formatDelayBadge } from '@/lib/datasources/freshness';
import { openaqProvider } from '@/lib/datasources/providers/openaq.provider';
import { waqiProvider } from '@/lib/datasources/providers/waqi.provider';
import { build24HourPointsFromWaqiObs } from '@/lib/services/waqi-decoder';
import { CITIES_REGISTRY, findCity, searchCities } from '@/lib/constants/cities';
import { encodeWaqiTarget, escapeHtml, mergeWeatherInfo } from '@/lib/utils/common';
import type { AirQualityRecord } from '@/lib/types';
import type { ProviderRuntimeContext } from '@/lib/datasources/types';

const dummyAssets = { fetch: async () => new Response('Not Found', { status: 404 }) };

describe('Codebase Audit Regression Guards', () => {
  it('preserves Open-Meteo weather values when primary record carries undefined weather keys', () => {
    const merged = mergeWeatherInfo(
      { temp: 18.5, humidity: 64, windSpeed: 2.3, pressure: 1013.2 },
      { temp: undefined, humidity: undefined, windSpeed: undefined, pressure: undefined }
    );
    expect(merged).toEqual({ temp: 18.5, humidity: 64, windSpeed: 2.3, pressure: 1013.2 });

    const partial = mergeWeatherInfo(
      { temp: 18.5, humidity: 64, windSpeed: 2.3, pressure: 1013.2 },
      { temp: 20.1, humidity: undefined }
    );
    expect(partial).toEqual({ temp: 20.1, humidity: 64, windSpeed: 2.3, pressure: 1013.2 });
  });

  it('validates Worker /api/waqi-hourly idx, /api/forecast coords, and CORS OPTIONS preflight', async () => {
    // Reject path traversal / non-numeric idx
    const badIdx = await worker.fetch(
      new Request('https://aqi.example.com/api/waqi-hourly?idx=../../etc/passwd'),
      { ASSETS: dummyAssets }
    );
    expect(badIdx.status).toBe(400);

    // Reject empty lat/lon instead of coercing "" to (0, 0) Null Island
    const emptyCoords = await worker.fetch(
      new Request('https://aqi.example.com/api/forecast?lat=&lon='),
      { ASSETS: dummyAssets }
    );
    expect(emptyCoords.status).toBe(400);

    // Reject out-of-range coordinates
    const oobCoords = await worker.fetch(
      new Request('https://aqi.example.com/api/forecast?lat=999&lon=200'),
      { ASSETS: dummyAssets }
    );
    expect(oobCoords.status).toBe(400);

    // Uniform OPTIONS preflight across /api/*
    const preflight = await worker.fetch(
      new Request('https://aqi.example.com/api/waqi/bounds', { method: 'OPTIONS' }),
      { ASSETS: dummyAssets }
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('short-circuits runRankingCronBatch with 0 subrequests when WAQI_TOKENS is empty', async () => {
    let fetchCalls = 0;
    const kv: KVNamespaceLike = {
      get: async () => null,
      put: async () => {},
    };
    const summary = await runRankingCronBatch(
      kv,
      [],
      0,
      Date.now(),
      (async () => {
        fetchCalls++;
        return new Response('{}', { status: 200 });
      }) as typeof fetch
    );
    expect(fetchCalls).toBe(0);
    expect(summary.subrequestsUsed).toBe(0);
    expect(summary.slicesRequested).toBe(0);
  });

  it('preserves offline badge semantics in aggregateCompositeRecord when no live stations exist', () => {
    const chengdu = findCity('cn-chengdu')!;
    const offlineBase: AirQualityRecord = {
      id: chengdu.id,
      name: chengdu.nameZh,
      nameEn: chengdu.nameEn,
      country: chengdu.country,
      isDomestic: true,
      isOffline: true,
      latitude: chengdu.latitude,
      longitude: chengdu.longitude,
      updateTime: '2026-11-26 12:00:00',
      pollutants: { pm25: 35 },
      iaqi: { pm25: 100 },
      evaluationCN: {
        aqi: 50,
        level: '优',
        levelEn: 'Excellent',
        color: '#64748b',
        textColor: '#ffffff',
        primaryPollutant: 'pm25',
        primaryPollutantName: 'PM2.5 (细颗粒物)',
        healthAdvice: '',
        standard: 'CN',
        isOffline: true,
      },
      evaluationUS: {
        aqi: 99,
        level: '良',
        levelEn: 'Moderate',
        color: '#64748b',
        textColor: '#ffffff',
        primaryPollutant: 'pm25',
        primaryPollutantName: 'PM2.5 (细颗粒物)',
        healthAdvice: '',
        standard: 'US',
        isOffline: true,
      },
    };

    const comp = aggregateCompositeRecord(offlineBase, [], chengdu, 'CN', false);
    expect(comp.isOffline).toBe(true);
    expect(comp.evaluationCN.isOffline).toBe(true);
    expect(comp.evaluationCN.color).toBe('#64748b');
    expect(comp.evaluationUS.isOffline).toBe(true);
    expect(comp.evaluationUS.color).toBe('#64748b');
    expect(comp.compositeStationCount).toBe(0);
  });

  it('handles missing PM2.5 in onlyPm25 mode and ultra-clean positive concentrations accurately', () => {
    const noDataPm25 = evaluateAQI({}, 'CN', true);
    expect(noDataPm25.aqi).toBe(0);
    expect(noDataPm25.level).toBe('暂无数据');
    expect(noDataPm25.primaryPollutantName).toBe('暂无');

    // Ultra-clean positive measurement should be >= 1 ("优"), never misclassified as 0 ("暂无数据")
    expect(calculatePM25AQI(0.1, 'CN')).toBe(1);
    const ultraClean = evaluateAQI({ pm25: 0.1 }, 'CN', true);
    expect(ultraClean.aqi).toBe(1);
    expect(ultraClean.level).toBe('优');
  });

  it('allows QWeather dynamic JWT without optional developerId and does not fabricate forecast spread', async () => {
    const ctx: ProviderRuntimeContext = {
      env: {
        qweatherHost: 'https://test.qweatherapi.com',
        qweatherProjectId: 'PROJ1',
        qweatherCredentialId: 'CRED1',
        qweatherPrivateKey: '-----BEGIN PRIVATE KEY-----\nTEST\n-----END PRIVATE KEY-----',
      },
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({
            days: [
              {
                forecastStartTime: '2026-11-28T00:00Z',
                pollutants: [{ code: 'pm2p5', concentration: { value: 25, unit: 'μg/m³' } }],
              },
            ],
          }),
          { status: 200 }
        )) as typeof fetch,
      nowMs: Date.parse('2026-11-27T08:00:00Z'),
      isServer: true,
    };

    expect(qweatherProvider.isAvailable(ctx)).toBe(true);

    const apiKeyCtx: ProviderRuntimeContext = {
      ...ctx,
      env: { qweatherHost: 'https://test.qweatherapi.com', qweatherApiKey: 'key' },
    };
    const forecast = await qweatherProvider.forecast!.fetch5DayForecast(30.65, 104.06, apiKeyCtx);
    expect(forecast?.list[0]).toEqual({ day: '2026-11-28', avg: 25, min: 25, max: 25 });
  });

  it('keeps newest OpenAQ sensor measurement per parameter and omits unmeasured o3 in hourly trends', async () => {
    const nyc = findCity('gl-newyork')!;
    const nowMs = Date.parse('2026-11-27T10:00:00Z');
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('/locations?')) {
        return new Response(
          JSON.stringify({
            results: [
              {
                id: 88,
                name: 'NY Multi-Sensor',
                isMonitor: true,
                coordinates: { latitude: 40.71, longitude: -74.0 },
                datetimeLast: { utc: '2026-11-27T09:00:00Z' },
                sensors: [
                  { id: 1, parameter: { name: 'pm25', units: 'µg/m³' } },
                  { id: 2, parameter: { name: 'pm25', units: 'µg/m³' } },
                ],
              },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.includes('/locations/88/latest')) {
        return new Response(
          JSON.stringify({
            results: [
              // Newer reading comes FIRST, older reading comes SECOND -> newer (12.0) must win!
              { sensorsId: 1, value: 12.0, datetime: { utc: '2026-11-27T09:00:00Z' } },
              { sensorsId: 2, value: 99.0, datetime: { utc: '2026-11-27T05:00:00Z' } },
            ],
          }),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify({
          results: [
            { value: 10, parameter: { units: 'µg/m³' }, period: { datetimeTo: { utc: '2026-11-27T07:00:00Z' } } },
            { value: 11, parameter: { units: 'µg/m³' }, period: { datetimeTo: { utc: '2026-11-27T08:00:00Z' } } },
            { value: 12, parameter: { units: 'µg/m³' }, period: { datetimeTo: { utc: '2026-11-27T09:00:00Z' } } },
          ],
        }),
        { status: 200 }
      );
    };

    const ctx: ProviderRuntimeContext = {
      env: { openaqApiKey: 'test' },
      fetchImpl: mockFetch,
      nowMs,
      isServer: true,
    };

    const snap = await openaqProvider.realtime!.fetchCitySnapshot(nyc, ctx);
    expect(snap?.stations[0].pollutants.pm25).toBe(12.0);

    const trend = await openaqProvider.hourlyTrend!.fetchHourlyTrend({ city: nyc, standard: 'US' }, ctx);
    expect(trend?.points[0].o3).toBeUndefined();
  });

  it('keeps Taiwan cities uniformly isDomestic=true and boosts valid US major cities on country search', () => {
    const twCities = CITIES_REGISTRY.filter((c) => c.country === 'TW');
    expect(twCities.length).toBeGreaterThan(0);
    expect(twCities.every((c) => c.isDomestic === true)).toBe(true);

    const usResults = searchCities('美国', 5);
    expect(usResults[0].id).toBe('gl-newyork');
    expect(usResults.slice(0, 3).map((c) => c.id)).toEqual([
      'gl-newyork',
      'gl-losangeles',
      'gl-chicago',
    ]);
  });

  it('encodes WAQI targets preserving leading @ and escapes HTML safely', () => {
    expect(encodeWaqiTarget('@1451')).toBe('@1451');
    expect(encodeWaqiTarget('@-99')).toBe('@-99');
    expect(encodeWaqiTarget('beijing')).toBe('beijing');
    expect(escapeHtml('<img src=x onerror="alert(1)">')).toBe('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  });

  it('refuses to cache WAQI HTTP 200 business error payloads and snaps bounds outward', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('/feed/')) {
        return new Response(JSON.stringify({ status: 'error', data: 'Over quota' }), { status: 200 });
      }
      if (url.includes('/v2/map/bounds')) {
        expect(url).toContain('latlng=30.10,103.95,31.25,105.15');
        return new Response(JSON.stringify({ status: 'ok', data: [] }), { status: 200 });
      }
      return new Response('Not Found', { status: 404 });
    });

    try {
      const errFeed = await worker.fetch(
        new Request('https://aqi.example.com/api/waqi/feed?target=@1451'),
        { ASSETS: dummyAssets, WAQI_TOKENS: 'tok1' }
      );
      expect(errFeed.status).toBe(200);
      expect(errFeed.headers.get('Cache-Control')).toBe('no-store');

      const okBounds = await worker.fetch(
        new Request('https://aqi.example.com/api/waqi/bounds?latlng=30.123456,103.987654,31.234567,105.123456'),
        { ASSETS: dummyAssets, WAQI_TOKENS: 'tok1' }
      );
      expect(okBounds.status).toBe(200);
      expect(okBounds.headers.get('Cache-Control')).toBe('public, max-age=0, s-maxage=60');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('returns Cache-Control: no-store when /api/forecast yields an empty list', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(JSON.stringify({}), { status: 500 });
    });
    try {
      const res = await worker.fetch(
        new Request('https://aqi.example.com/api/forecast?lat=39.9&lon=116.4'),
        { ASSETS: dummyAssets }
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { list: unknown[] };
      expect(body.list).toEqual([]);
      expect(res.headers.get('Cache-Control')).toBe('no-store');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('rejects stale reused hot cities in readHotCityFromKV even when pack updatedAtMs is fresh', async () => {
    const nowMs = Date.parse('2026-11-27T12:00:00Z');
    const packKey = getHotPackKey(8); // Pack 8 contains cn-beijing
    const kv: KVNamespaceLike = {
      async get(key) {
        if (key !== packKey) return null;
        return JSON.stringify({
          packIndex: 8,
          updatedAt: new Date(nowMs - 5 * 60_000).toISOString(),
          updatedAtMs: nowMs - 5 * 60_000, // Pack looks fresh (5 min ago)
          cities: {
            'cn-beijing': {
              success: true,
              cityId: 'cn-beijing',
              updatedAt: new Date(nowMs - 110 * 60_000).toISOString(), // Individual city is 110 min old (> 90 min limit)
            },
          },
        });
      },
      async put() {},
    };

    const result = await readHotCityFromKV(kv, 'cn-beijing', nowMs);
    expect(result).toBeNull();
  });

  it('recomputes live delay dynamically in formatDelayBadge and preserves newer QWeather tag on seed', () => {
    const obsMs = Date.parse('2026-11-27T08:00:00Z');
    const nowMs = Date.parse('2026-11-27T10:30:00Z'); // 150 min elapsed
    const badge = formatDelayBadge(
      {
        observedAtMs: obsMs,
        observedAtIso: new Date(obsMs).toISOString(),
        delayMinutes: 15, // Frozen at cache creation time
        isStale: false,
        fetchedAtMs: obsMs + 15 * 60_000,
      },
      nowMs
    );
    expect(badge).not.toBeNull();
    expect(badge!.severity).toBe('severe');

    clearQWeatherTagTracker();
    trackQWeatherContentTag('cn-beijing', 'tag-new', nowMs);
    // Old KV seed must NOT overwrite the newer tag already observed in this isolate
    seedQWeatherContentTag('cn-beijing', 'tag-old', obsMs);
    const next = trackQWeatherContentTag('cn-beijing', 'tag-new', nowMs + 60_000);
    expect(next.contentTag).toBe('tag-new');
    expect(next.unchangedMinutes).toBe(1);
    clearQWeatherTagTracker();
  });

  it('drops stations in buildRankingSnapshotFromDraft whose observed time ot exceeds 6 hours', () => {
    const nowMs = Date.parse('2026-11-27T12:00:00Z');
    const snapshot = buildRankingSnapshotFromDraft(
      {
        updatedAt: nowMs,
        lastBatch: 7,
        cities: {
          'cn-beijing': {
            '1451': {
              a: 50,
              p: 12,
              d: 2.1,
              n: '北京旧站',
              t: nowMs - 30 * 60_000, // Scraped 30m ago (< 2h TTL)
              ot: nowMs - 7 * 60 * 60_000, // Observed 7h ago (> 6h zombie threshold)
            },
          },
        },
      },
      nowMs
    );
    expect(snapshot.totalCities).toBe(0);
  });

  it('throws typed HTTP 429 on WAQI HTTP 200 Over quota and OpenAQ latest 429 so circuit breakers trip', async () => {
    const beijing = findCity('cn-beijing')!;
    const waqiCtx: ProviderRuntimeContext = {
      env: { waqiTokens: ['tok1'] },
      fetchImpl: async () => new Response(JSON.stringify({ status: 'error', data: 'Over quota' }), { status: 200 }),
      nowMs: Date.parse('2026-11-27T12:00:00Z'),
      isServer: true,
    };
    await expect(waqiProvider.realtime!.fetchCitySnapshot(beijing, waqiCtx)).rejects.toMatchObject({
      status: 429,
    });

    const nyc = findCity('gl-newyork')!;
    const openaqCtx: ProviderRuntimeContext = {
      env: { openaqApiKey: 'key1' },
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes('/locations?')) {
          return new Response(
            JSON.stringify({
              results: [
                {
                  id: 99,
                  name: 'NYC Station',
                  isMonitor: true,
                  coordinates: { latitude: 40.71, longitude: -74.0 },
                  datetimeLast: { utc: '2026-11-27T11:30:00Z' },
                  sensors: [{ id: 1, parameter: { name: 'pm25', units: 'µg/m³' } }],
                },
              ],
            }),
            { status: 200 }
          );
        }
        return new Response('Too Many Requests', { status: 429 });
      },
      nowMs: Date.parse('2026-11-27T12:00:00Z'),
      isServer: true,
    };
    await expect(openaqProvider.realtime!.fetchCitySnapshot(nyc, openaqCtx)).rejects.toMatchObject({
      status: 429,
    });
  });

  it('decodes non-PM2.5 WAQI hourly series (PM10/O3-only stations) without dropping the chart', () => {
    const pts = build24HourPointsFromWaqiObs(
      {
        o3: {
          s: '2026-11-27 12:00:00',
          d: 3600,
          m: 1,
          v: [45, -5, -10],
        },
      },
      'US',
      480
    );
    expect(pts.length).toBe(3);
    expect(pts[0].aqi).toBeGreaterThan(0);
    expect(pts[0].o3).toBeGreaterThan(0);
    expect(pts[0].pm25).toBe(0);
  });
});
