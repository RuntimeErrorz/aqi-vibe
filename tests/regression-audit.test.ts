import { describe, it, expect } from 'vitest';
import worker from '../worker';
import { evaluateAQI, calculatePM25AQI } from '@/lib/aqi-calculator';
import { aggregateCompositeRecord } from '@/lib/services/composite-aggregator';
import { runRankingCronBatch, KVNamespaceLike } from '@/lib/services/cf-ranking-engine';
import { qweatherProvider } from '@/lib/datasources/providers/qweather.provider';
import { openaqProvider } from '@/lib/datasources/providers/openaq.provider';
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
});
