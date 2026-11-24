import { describe, it, expect } from 'vitest';
import {
  RANKING_BOUNDS,
  TOTAL_BATCHES,
  RANKING_DRAFT_KEY,
  RANKING_LATEST_KEY,
  STATION_TTL_MS,
  KVNamespaceLike,
  getBatchIndexFromDate,
  getBoundsForBatch,
  findClosestCityFast,
  runRankingCronBatch,
} from '../lib/services/cf-ranking-engine';
import worker from '../worker';
import type { RankingApiResponse } from '../lib/services/realtime-ranking';
import { fetchEdgeCityRealtimePayload } from '../lib/services/cf-city-realtime';
import { preferOfficialStations } from '../lib/services/composite-aggregator';
import {
  HOT_CITY_PACKS,
  MAX_SUBREQUESTS_PER_PACK,
  allocateStationBudgets,
  getHotCitiesPackIndexFromDate,
  getHotPackKey,
  readHotCityFromKV,
  runHotCitiesCronPack,
} from '../lib/services/cf-hot-cities';
import { findCity } from '../lib/constants/cities';

class MemoryKV implements KVNamespaceLike {
  store = new Map<string, string>();
  readCount = 0;
  writeCount = 0;
  writeKeys: string[] = [];

  async get(key: string): Promise<string | null> {
    this.readCount++;
    return this.store.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    this.writeCount++;
    this.writeKeys.push(key);
    this.store.set(key, value);
  }
}

describe('Cloudflare Workers Free-Tier Ranking Engine', () => {
  it('partitions 336 pre-computed global bounds into 8 exact batches (< 50 subrequests)', () => {
    expect(TOTAL_BATCHES).toBe(8);
    expect(RANKING_BOUNDS.length).toBe(336);

    const seen = new Set<string>();
    for (let b = 0; b < TOTAL_BATCHES; b++) {
      const batchBounds = getBoundsForBatch(b);
      expect(batchBounds.length).toBe(42);
      expect(batchBounds.length).toBeLessThan(50);
      for (const bound of batchBounds) {
        expect(seen.has(bound)).toBe(false);
        seen.add(bound);
      }
    }
    expect(seen.size).toBe(RANKING_BOUNDS.length);
    expect(getBoundsForBatch(-1)).toEqual([]);
    expect(getBoundsForBatch(8)).toEqual([]);
  });

  it('maps dual 30-min Crons with zero minute overlap and <= 864 KV writes/day (< 1,000 Free Tier)', () => {
    const rankingMinutes = new Set<number>([
      0, 1, 2, 3, 4, 5, 6, 7,
      30, 31, 32, 33, 34, 35, 36, 37,
    ]);
    const hotMinutes = new Set<number>([
      9, 10, 11, 12, 13, 14, 15, 16, 17, 18,
      39, 40, 41, 42, 43, 44, 45, 46, 47, 48,
    ]);

    let rankingCount = 0;
    let hotCount = 0;
    for (let minute = 0; minute < 60; minute++) {
      const date = new Date(Date.UTC(2026, 0, 1, 12, minute, 0));
      const rIdx = getBatchIndexFromDate(date);
      const hIdx = getHotCitiesPackIndexFromDate(date);

      // Zero overlap between ranking Cron and hot-cities Cron
      expect(rIdx >= 0 && hIdx >= 0).toBe(false);

      if (rankingMinutes.has(minute)) {
        expect(rIdx).toBe(minute % 30);
        rankingCount++;
      } else {
        expect(rIdx).toBe(-1);
      }

      if (hotMinutes.has(minute)) {
        expect(hIdx).toBe((minute % 30) - 9);
        hotCount++;
      } else {
        expect(hIdx).toBe(-1);
      }
    }

    expect(rankingCount).toBe(16); // 2 cycles/hour * 8 batches
    expect(hotCount).toBe(20); // 2 cycles/hour * 10 packs
    const dailyKvWrites = (rankingCount + hotCount) * 24;
    expect(dailyKvWrites).toBe(864);
    expect(dailyKvWrites).toBeLessThan(1000);
  });

  it('performs fast Voronoi + sovereign country-coder city matching', () => {
    const beijing = findClosestCityFast(39.9042, 116.4074);
    expect(beijing?.city.id).toBe('cn-beijing');
    expect(beijing?.distKm).toBeLessThan(5);

    const chengdu = findClosestCityFast(30.657, 104.066);
    expect(chengdu?.city.id).toBe('cn-chengdu');

    // Open ocean has no city within 30km
    expect(findClosestCityFast(0.0, 0.0)).toBeNull();
  });

  it('executes a full 8-batch cycle with strictly 1 KV write per batch, outlier filtering, and TTL pruning', async () => {
    const kv = new MemoryKV();
    const baseTime = Date.UTC(2026, 5, 1, 8, 0, 0);

    // Seed an expired station (> 2h old) to verify automatic dead-station pruning
    await kv.put(
      RANKING_DRAFT_KEY,
      JSON.stringify({
        updatedAt: baseTime - STATION_TTL_MS - 60_000,
        lastBatch: 6,
        cities: {
          'cn-beijing': {
            '999999': {
              a: 250,
              p: 200,
              d: 1.0,
              n: 'Expired Dead Sensor',
              t: baseTime - STATION_TTL_MS - 60_000,
            },
          },
        },
      })
    );
    kv.writeCount = 0;
    kv.writeKeys = [];

    // Mock fetch: emit Chengdu stations on batch 0 (including 1 wild outlier sensor) and Tokyo on batch 7
    const batch0FirstBound = getBoundsForBatch(0)[0];
    const batch7FirstBound = getBoundsForBatch(7)[0];

    const mockFetch: typeof fetch = async (input) => {
      const urlStr = String(input);
      let data: any[] = [];

      if (urlStr.includes(`latlng=${batch0FirstBound}&`)) {
        data = [
          { uid: 1001, lat: 30.573, lon: 104.067, aqi: '68', station: { name: 'Chengdu (成都人民公园)' } },
          { uid: 1002, lat: 30.67, lon: 104.09, aqi: '72', station: { name: 'Chengdu (成都沙河铺)' } },
          { uid: 1003, lat: 30.64, lon: 104.04, aqi: '70', station: { name: 'Chengdu (成都草堂)' } },
          // Hardware glitch outlier (> 4 MAD away) that must be rejected
          { uid: 1004, lat: 30.58, lon: 104.07, aqi: '499', station: { name: 'Chengdu (故障传感器)' } },
        ];
      } else if (urlStr.includes(`latlng=${batch7FirstBound}&`)) {
        data = [
          { uid: 2001, lat: 35.68, lon: 139.76, aqi: '32', station: { name: 'Tokyo (Chiyoda)' } },
        ];
      }

      return new Response(JSON.stringify({ status: 'ok', data }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    for (let batch = 0; batch < TOTAL_BATCHES; batch++) {
      const summary = await runRankingCronBatch(
        kv,
        ['test-token-1', 'test-token-2'],
        batch,
        baseTime + batch * 60_000,
        mockFetch
      );
      expect(summary.slicesRequested).toBe(42);
      expect(summary.slicesSucceeded).toBe(42);
      expect(summary.subrequestsUsed).toBe(42);
      expect(summary.published).toBe(batch === TOTAL_BATCHES - 1);
    }

    // Strictly 1 KV write per Cron invocation (8 total for full cycle)
    expect(kv.writeCount).toBe(8);
    expect(kv.writeKeys.slice(0, 7)).toEqual(Array(7).fill(RANKING_DRAFT_KEY));
    expect(kv.writeKeys[7]).toBe(RANKING_LATEST_KEY);

    const latestRaw = await kv.get(RANKING_LATEST_KEY);
    expect(latestRaw).toBeTruthy();

    const snapshot = JSON.parse(latestRaw!) as RankingApiResponse;
    expect(snapshot.success).toBe(true);
    expect(snapshot.isRefreshing).toBe(false);
    // Expired cn-beijing dead sensor must be gone; Chengdu (batch 0) & Tokyo (batch 7) present
    expect(snapshot.totalCities).toBe(2);
    expect(snapshot.global.cleanest.map((c) => c.id)).toEqual(['gl-tokyo', 'cn-chengdu']);
    expect(snapshot.domestic.cleanest.map((c) => c.id)).toEqual(['cn-chengdu']);

    // Outlier uid 1004 (AQI 499) should be excluded, leaving 3 valid Chengdu stations
    const chengdu = snapshot.domestic.cleanest[0];
    expect(chengdu.stationsCount).toBe(3);
    expect(chengdu.aqiUS).toBeGreaterThanOrEqual(65);
    expect(chengdu.aqiUS).toBeLessThanOrEqual(75);
    expect(chengdu.repStationName).toBe('人民公园');
    expect(chengdu.repStationUid).toBe(1001);
  });

  it('serves /api/ranking/realtime from Worker KV and returns 503 during cold start', async () => {
    const dummyAssets = { fetch: async () => new Response('Not Found', { status: 404 }) };

    // 1. Unbound KV -> 503 initializing
    const resUnbound = await worker.fetch(
      new Request('https://aqi.example.com/api/ranking/realtime'),
      { ASSETS: dummyAssets }
    );
    expect(resUnbound.status).toBe(503);

    // 2. Bound but empty KV -> 503 initializing
    const kv = new MemoryKV();
    const resEmpty = await worker.fetch(
      new Request('https://aqi.example.com/api/ranking/realtime'),
      { ASSETS: dummyAssets, RANKING_KV: kv }
    );
    expect(resEmpty.status).toBe(503);

    // 3. Populated KV -> 200 JSON with cloudflare-kv header
    const samplePayload: RankingApiResponse = {
      success: true,
      updatedAt: '2026-06-01T08:07:00.000Z',
      totalStations: 5000,
      totalCities: 1,
      isRefreshing: false,
      domestic: { cleanest: [], polluted: [] },
      global: { cleanest: [], polluted: [] },
    };
    await kv.put(RANKING_LATEST_KEY, JSON.stringify(samplePayload));

    const resOk = await worker.fetch(
      new Request('https://aqi.example.com/api/ranking/realtime'),
      { ASSETS: dummyAssets, RANKING_KV: kv }
    );
    expect(resOk.status).toBe(200);
    expect(resOk.headers.get('X-Ranking-Source')).toBe('cloudflare-kv');
    const body = (await resOk.json()) as RankingApiResponse;
    expect(body.updatedAt).toBe('2026-06-01T08:07:00.000Z');

    // 4. Verify ?refresh=true cannot bypass Edge Cache to hammer KV
    const cacheStore = new Map<string, Response>();
    const prevCaches = (globalThis as any).caches;
    (globalThis as any).caches = {
      default: {
        match: async (req: Request) => cacheStore.get(req.url)?.clone(),
        put: async (req: Request, res: Response) => {
          cacheStore.set(req.url, res.clone());
        },
      },
    };
    try {
      kv.readCount = 0;
      const pending: Promise<unknown>[] = [];
      const ctx = { waitUntil: (p: Promise<unknown>) => { pending.push(p); } };

      const first = await worker.fetch(
        new Request('https://aqi.example.com/api/ranking/realtime'),
        { ASSETS: dummyAssets, RANKING_KV: kv },
        ctx
      );
      await Promise.all(pending);
      expect(first.status).toBe(200);
      expect(kv.readCount).toBe(1);

      const burst = await worker.fetch(
        new Request('https://aqi.example.com/api/ranking/realtime?refresh=true&bust=123'),
        { ASSETS: dummyAssets, RANKING_KV: kv },
        ctx
      );
      expect(burst.status).toBe(200);
      // Must be served from Edge Cache with 0 additional KV reads
      expect(kv.readCount).toBe(1);
    } finally {
      (globalThis as any).caches = prevCaches;
    }
  });

  it('prefers official uid>0 stations over negative community sensors and aggregates all 6 pollutants + weather', async () => {
    // 1. Unit check on preferOfficialStations
    expect(preferOfficialStations([{ uid: -499558 }, { uid: 2303 }]).map((s) => s.uid)).toEqual([2303]);
    expect(preferOfficialStations([{ uid: -101 }, { uid: -102 }]).map((s) => s.uid)).toEqual([-101, -102]);

    // 2. Full Edge city realtime test for Tokyo: negative community sensor must be ignored in favor of official uid>0
    let subrequests = 0;
    const mockFetch: typeof fetch = async (input) => {
      subrequests++;
      const url = String(input);
      if (url.includes('/v2/map/bounds')) {
        return new Response(
          JSON.stringify({
            status: 'ok',
            data: [
              // Closer negative community sensor (PM-only, drifted AQI 108) -> must be excluded
              { uid: -499558, lat: 35.6762, lon: 139.6503, aqi: '108', station: { name: 'Suginami, Izumi-3', time: '2026-11-24' } },
              // Official reference stations
              { uid: 2303, lat: 35.678, lon: 139.66, aqi: '38', station: { name: 'Sasazuka, Shibuya', time: '2026-11-24' } },
              { uid: 5574, lat: 35.65, lon: 139.65, aqi: '42', station: { name: 'Setagaya', time: '2026-11-24' } },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/feed/@2303/')) {
        return new Response(
          JSON.stringify({
            status: 'ok',
            data: {
              idx: 2303,
              aqi: 38,
              time: { s: '2026-11-24 20:00:00' },
              city: { geo: [35.678, 139.66], name: 'Sasazuka, Shibuya' },
              iaqi: {
                pm25: { v: 38 },
                pm10: { v: 10 },
                o3: { v: 30 },
                no2: { v: 20 },
                so2: { v: 2 },
                co: { v: 4 },
                t: { v: 12 },
                h: { v: 80 },
                w: { v: 1.0 },
                p: { v: 1004 },
              },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/feed/@5574/')) {
        return new Response(
          JSON.stringify({
            status: 'ok',
            data: {
              idx: 5574,
              aqi: 42,
              time: { s: '2026-11-24 20:00:00' },
              city: { geo: [35.65, 139.65], name: 'Setagaya' },
              iaqi: {
                pm25: { v: 42 },
                pm10: { v: 12 },
                o3: { v: 34 },
                no2: { v: 16 },
                so2: { v: 2 },
                co: { v: 6 },
                t: { v: 14 },
                h: { v: 84 },
                w: { v: 2.0 },
                p: { v: 1002 },
              },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify({ status: 'error' }), { status: 404 });
    };

    const result = await fetchEdgeCityRealtimePayload('gl-tokyo', ['tok-1', 'tok-2'], mockFetch);
    expect(result).not.toBeNull();
    expect(subrequests).toBe(3); // 1 bounds + 2 official stations (negative -499558 never even fetched!)
    expect(result!.baseRecord.stationIdx).toBe(2303);
    expect(result!.totalOfficialStations).toBe(2);
    expect(result!.compositeRecord.pollutants.o3).toBeGreaterThan(0);
    expect(result!.compositeRecord.pollutants.no2).toBeGreaterThan(0);
    expect(result!.compositeRecord.pollutants.so2).toBeGreaterThan(0);
    expect(result!.compositeRecord.pollutants.co).toBeGreaterThan(0);
    expect(result!.compositeRecord.weather?.temp).toBe(13); // mean(12, 14)
    expect(result!.compositeRecord.weather?.humidity).toBe(82); // mean(80, 84)
    expect(result!.compositeRecord.weather?.windSpeed).toBe(1.5); // mean(1.0, 2.0)
    expect(result!.compositeRecord.weather?.pressure).toBe(1003); // mean(1004, 1002)
  });

  it('pre-warms 40 verified hot metropolises in 10 packs with dynamic water-filling and KV-first serving', async () => {
    // 1. All 40 hot cities must exist in CITIES_REGISTRY with zero duplicates
    const seen = new Set<string>();
    expect(HOT_CITY_PACKS.length).toBe(10);
    for (const pack of HOT_CITY_PACKS) {
      expect(pack.length).toBe(4);
      for (const cid of pack) {
        expect(seen.has(cid)).toBe(false);
        seen.add(cid);
        expect(findCity(cid)?.id).toBe(cid);
      }
    }
    expect(seen.size).toBe(40);

    // 2. Water-filling gives small/medium cities 100% and flows spare slots to megacity up to 24
    const pack0Alloc = allocateStationBudgets([60, 8, 5, 1], MAX_SUBREQUESTS_PER_PACK, 24);
    expect(pack0Alloc).toEqual([24, 8, 5, 1]);
    expect(pack0Alloc.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(MAX_SUBREQUESTS_PER_PACK);

    const heavyAlloc = allocateStationBudgets([30, 20, 20, 20], MAX_SUBREQUESTS_PER_PACK, 24);
    expect(heavyAlloc).toEqual([11, 11, 11, 11]);

    // 3. Full Pack 0 run reusing ranking:draft (0 map/bounds calls, strictly 1 KV write) + Worker KV hit
    const kv = new MemoryKV();
    const nowMs = Date.now();
    await kv.put(
      RANKING_DRAFT_KEY,
      JSON.stringify({
        updatedAt: nowMs - 60_000,
        lastBatch: 6,
        cities: {
          'gl-tokyo': {
            '-499558': { a: 108, p: 40, d: 0.2, n: 'Community Sensor', t: nowMs - 60_000, la: 35.676, lo: 139.65 },
            '2303': { a: 38, p: 7, d: 1.0, n: 'Sasazuka', t: nowMs - 60_000, la: 35.678, lo: 139.66 },
          },
          'cn-chengdu': {
            '1001': { a: 60, p: 15, d: 0.8, n: '人民公园', t: nowMs - 60_000, la: 30.573, lo: 104.067 },
          },
          'gl-singapore': {
            '1663': { a: 30, p: 5, d: 1.2, n: 'Central', t: nowMs - 60_000, la: 1.35, lo: 103.82 },
          },
          'gl-madrid': {
            '5770': { a: 25, p: 4, d: 1.0, n: 'Madrid', t: nowMs - 60_000, la: 40.42, lo: -3.7 },
          },
        },
      })
    );
    kv.writeCount = 0;
    kv.writeKeys = [];

    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      expect(url.includes('/v2/map/bounds')).toBe(false); // 0 map/bounds wasted!
      const match = url.match(/\/feed\/@(\d+)\//);
      const uid = match ? Number(match[1]) : 0;
      return new Response(
        JSON.stringify({
          status: 'ok',
          data: {
            idx: uid,
            aqi: 38,
            time: { s: '2026-06-01 08:00:00' },
            city: { geo: [35.678, 139.66], name: `Official ${uid}` },
            iaqi: {
              pm25: { v: 38 },
              pm10: { v: 12 },
              o3: { v: 30 },
              no2: { v: 18 },
              so2: { v: 2 },
              co: { v: 3 },
              t: { v: 20 },
              h: { v: 65 },
              w: { v: 2.1 },
              p: { v: 1012 },
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const summary = await runHotCitiesCronPack(kv, ['tok-1', 'tok-2'], 0, nowMs, mockFetch);
    expect(summary.citiesProcessed).toBe(4);
    expect(summary.subrequestsUsed).toBe(4); // 4 official stations, negative -499558 excluded!
    expect(kv.writeCount).toBe(1);
    expect(kv.writeKeys).toEqual([getHotPackKey(0)]);

    const cachedTokyo = await readHotCityFromKV(kv, 'gl-tokyo', nowMs + 60_000);
    expect(cachedTokyo?.baseRecord.stationIdx).toBe(2303);
    expect(cachedTokyo?.compositeRecord.weather?.temp).toBe(20);

    // Worker /api/city-realtime serves directly from KV with X-City-Source: cloudflare-kv-hot
    const dummyAssets = { fetch: async () => new Response('Not Found', { status: 404 }) };
    const apiRes = await worker.fetch(
      new Request('https://aqi.example.com/api/city-realtime?city=gl-tokyo'),
      { ASSETS: dummyAssets, RANKING_KV: kv }
    );
    expect(apiRes.status).toBe(200);
    expect(apiRes.headers.get('X-City-Source')).toBe('cloudflare-kv-hot');
  });
});
