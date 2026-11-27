import RANKING_BOUNDS_RAW from '../../shared/ranking-bounds.json';
import { CITIES_REGISTRY } from '../constants/cities';
import type { CityMeta } from '../types';
import { convertIAQIToConcentration, evaluateAQI, calculatePM25AQI } from '../aqi-calculator';
import type { RankedCityItem, RankingApiResponse } from './realtime-ranking';
import { iso1A2Code } from '@rapideditor/country-coder';
import { isSameSovereignCountry, parseObservedTimeMs } from '../datasources/freshness';
import { createTimeoutSignal } from '../datasources/units';
import { extractCleanStationName, filterSpatialOutliersByValue } from '../utils/common';

/**
 * Cloudflare Workers KV 最小兼容接口（免额外安装 @cloudflare/workers-types，
 * 同时与 Cloudflare Runtime 原生 KVNamespace 100% 结构兼容）
 */
export interface KVNamespaceLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export const RANKING_BOUNDS: readonly string[] = RANKING_BOUNDS_RAW as string[];
export const TOTAL_BATCHES = 8;
export const RANKING_DRAFT_KEY = 'ranking:draft';
export const RANKING_LATEST_KEY = 'ranking:latest';
export const STATION_TTL_MS = 2 * 60 * 60 * 1000; // 2 小时无上报自动淘汰死站

// Cloudflare Workers 免费版单次调用上限 50 subrequests（含 fetch）
// 336 切片 / 8 批 = 42 切片/批；留 4 次共享重试额度，最坏 46 fetch + 2 KV = 48 < 50
const WORKER_CONCURRENCY = 6; // 精确贴合 Cloudflare Workers 单调用 6 并发外连上限
const MAX_EXTRA_RETRIES = 4;
const FETCH_TIMEOUT_MS = 8500;
const MAX_CITY_RADIUS_KM = 35.0; // 与城市实况 (cf-city-realtime / geo-filter) 严格统一 35km 物理边界红线

// 零源码硬编码 Token：所有 WAQI Token 均由 Cloudflare Workers Secret (`WAQI_TOKENS`) 或本地 `.env.local` 注入
export const DEFAULT_WAQI_TOKENS: readonly string[] = [];

export function parseWaqiTokens(raw?: string): string[] {
  if (raw && raw.trim().length > 0) {
    const parsed = raw
      .split(/[,\s]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    if (parsed.length > 0) return parsed;
  }
  return [...DEFAULT_WAQI_TOKENS];
}

/**
 * 对应 Cron 表达式 `0-7,30-37 * * * *`（每 30 分钟 1 轮完整更新，每轮 8 分钟滚动跑完）
 * 将当前 UTC 分钟映射为批号 0..7；非调度窗口返回 -1。
 */
export function getBatchIndexFromDate(date: Date): number {
  const minute = date.getUTCMinutes();
  const offset = minute % 30;
  return offset < TOTAL_BATCHES ? offset : -1;
}

/**
 * 将 336 个预计算全球高清边界切片均匀切分为 8 批（严格 42 切片/批）
 */
export function getBoundsForBatch(batchIndex: number): string[] {
  if (batchIndex < 0 || batchIndex >= TOTAL_BATCHES) return [];
  const total = RANKING_BOUNDS.length;
  const start = Math.floor((batchIndex * total) / TOTAL_BATCHES);
  const end = Math.floor(((batchIndex + 1) * total) / TOTAL_BATCHES);
  return RANKING_BOUNDS.slice(start, end);
}

// ==========================================
// 1° × 1° 空间网格索引（将单次匹配从 O(940) 降至 O(1~5)，压低至 Free Tier 10ms CPU 预算内）
// ==========================================
let cityByIdCache: Map<string, CityMeta> | null = null;
let citySpatialGridCache: Map<string, CityMeta[]> | null = null;

function ensureSpatialIndex(): {
  cityById: Map<string, CityMeta>;
  grid: Map<string, CityMeta[]>;
} {
  if (cityByIdCache && citySpatialGridCache) {
    return { cityById: cityByIdCache, grid: citySpatialGridCache };
  }

  const cityById = new Map<string, CityMeta>();
  const grid = new Map<string, CityMeta[]>();

  for (let i = 0; i < CITIES_REGISTRY.length; i++) {
    const c = CITIES_REGISTRY[i];
    cityById.set(c.id, c);
    if (typeof c.latitude !== 'number' || typeof c.longitude !== 'number') continue;
    const key = `${Math.floor(c.latitude)},${Math.floor(c.longitude)}`;
    let cell = grid.get(key);
    if (!cell) {
      cell = [];
      grid.set(key, cell);
    }
    cell.push(c);
  }

  cityByIdCache = cityById;
  citySpatialGridCache = grid;
  return { cityById, grid };
}

/**
 * 纯客观几何 Voronoi 最近城市判定 + 主权国家矢量排他：
 * 1. 先通过 3×3 空间网格粗筛出物理距离 <= 35km 的候选城市；若无候选直接返回 null，省去无谓的 country-coder 查表。
 * 2. 有候选时调用 @rapideditor/country-coder 判定测站主权 ISO-2，在同国候选中取最短大圆距离。
 * 严格遵循 AGENTS.md §9.3，零字符串正则、零启发式特判。
 */
export function findClosestCityFast(
  sLat: number,
  sLon: number,
  maxDistKm = MAX_CITY_RADIUS_KM
): { city: CityMeta; distKm: number } | null {
  const { grid } = ensureSpatialIndex();
  const latCell = Math.floor(sLat);
  const lonCell = Math.floor(sLon);
  const maxDistSq = maxDistKm * maxDistKm;
  const maxDegLat = maxDistKm / 111.0;

  let candidates: Array<{ city: CityMeta; distSq: number }> | null = null;

  for (let dLatCell = -1; dLatCell <= 1; dLatCell++) {
    for (let dLonCell = -1; dLonCell <= 1; dLonCell++) {
      const cellCities = grid.get(`${latCell + dLatCell},${lonCell + dLonCell}`);
      if (!cellCities) continue;

      for (let i = 0; i < cellCities.length; i++) {
        const c = cellCities[i];
        const dLat = Math.abs(sLat - c.latitude);
        if (dLat > maxDegLat) continue;

        const avgLatRad = ((sLat + c.latitude) * 0.5 * Math.PI) / 180.0;
        const cosLat = Math.cos(avgLatRad);
        const dLon = Math.abs(sLon - c.longitude);
        if (dLon * cosLat > maxDegLat) continue;

        const kmLat = dLat * 111.0;
        const kmLon = dLon * 111.0 * cosLat;
        const distSq = kmLat * kmLat + kmLon * kmLon;

        if (distSq < maxDistSq) {
          if (!candidates) candidates = [];
          candidates.push({ city: c, distSq });
        }
      }
    }
  }

  if (!candidates || candidates.length === 0) return null;

  // 仅当测站确实落在某在册城市 35km 半径内时才执行矢量主权校验
  const stationCountry = iso1A2Code([sLon, sLat]);

  let closest: CityMeta | null = null;
  let minDistSq = maxDistSq;

  for (let i = 0; i < candidates.length; i++) {
    const item = candidates[i];
    if (!isSameSovereignCountry(stationCountry, item.city.country)) {
      continue;
    }
    if (item.distSq < minDistSq) {
      minDistSq = item.distSq;
      closest = item.city;
    }
  }

  if (!closest) return null;
  return { city: closest, distKm: Math.sqrt(minDistSq) };
}

// ==========================================
// KV 滚动草稿数据结构（极简键名降低 KV 体积与反序列化 CPU 开销）
// ==========================================
export interface DraftStationEntry {
  a: number; // WAQI 综合实测 AQI (1..500)
  p: number; // 反算 PM2.5 物理浓度 (μg/m³)
  d: number; // 到市中心物理距离 (km)
  n: string; // 清洗后测站名称
  t: number; // 抓取时间戳 (ms)
  ot?: number; // 测站原始观测时间戳 (ms)，用于淘汰上游已停更超过 6 小时的僵尸站
  la?: number; // 测站纬度 (3位小数，供热门大都市预热直接复用，免二次 map/bounds)
  lo?: number; // 测站经度 (3位小数)
}

export interface RankingDraftState {
  updatedAt: number;
  lastBatch: number;
  cities: Record<string, Record<string, DraftStationEntry>>;
}

interface StationCandidate {
  uid: number;
  name: string;
  aqi: number;
  pm25: number;
  distKm: number;
}

/**
 * 将草稿中累积的全网城市测站桶聚合为最终标准双标排行榜快照
 */
export function buildRankingSnapshotFromDraft(
  draft: RankingDraftState,
  nowMs: number
): RankingApiResponse {
  const { cityById } = ensureSpatialIndex();
  const allRanked: RankedCityItem[] = [];
  let totalStations = 0;

  for (const [cityId, stationMap] of Object.entries(draft.cities)) {
    const city = cityById.get(cityId);
    if (!city) continue;

    const candidates: StationCandidate[] = [];
    for (const [uidStr, entry] of Object.entries(stationMap)) {
      if (!entry || nowMs - entry.t > STATION_TTL_MS) continue;
      if (entry.a <= 0 || entry.a > 500 || entry.p <= 0) continue;
      const uid = Number(uidStr);
      candidates.push({
        uid: Number.isFinite(uid) ? uid : 0,
        name: entry.n || city.nameZh,
        aqi: entry.a,
        pm25: entry.p,
        distKm: entry.d,
      });
    }

    if (candidates.length === 0) continue;

    // 官方参考站 (uid > 0) 严格优先：只要同城存在官方国控站，过滤民间廉价微感器 (uid < 0) 避免漂移拉偏
    const officialCandidates = candidates.filter((s) => s.uid > 0);
    const activeCandidates = officialCandidates.length > 0 ? officialCandidates : candidates;
    totalStations += activeCandidates.length;

    const validStations = filterSpatialOutliersByValue(activeCandidates, (s) => s.pm25);
    if (validStations.length === 0) continue;

    // 严格遵循 HJ 633-2012 / US EPA 2024【浓度优先 (Concentration-First)】规范：
    // 先求辖区所有有效测站物理质量浓度空间均值，再由均值反算双标 AQI
    const pm25Sum = validStations.reduce((acc, s) => acc + s.pm25, 0);
    const cityPm25Conc = Number((pm25Sum / validStations.length).toFixed(1));
    if (cityPm25Conc <= 0) continue;

    const pm25AqiUS = calculatePM25AQI(cityPm25Conc, 'US');
    const pm25AqiCN = calculatePM25AQI(cityPm25Conc, 'CN');

    const rawAqiSum = validStations.reduce((acc, s) => acc + s.aqi, 0);
    const stationAvgAqi = Math.round(rawAqiSum / validStations.length);
    const compAqiUS = Math.max(stationAvgAqi, pm25AqiUS);
    const compAqiCN = evaluateAQI(
      { pm25: convertIAQIToConcentration('pm25', compAqiUS, 'US') },
      'CN',
      false
    ).aqi;

    // 距离市中心物理坐标最近的代表站
    let primaryStation = validStations[0];
    for (let i = 1; i < validStations.length; i++) {
      if (validStations[i].distKm < primaryStation.distKm) {
        primaryStation = validStations[i];
      }
    }

    const repAqiUS = primaryStation.aqi;
    const repAqiCN = evaluateAQI(
      { pm25: convertIAQIToConcentration('pm25', primaryStation.aqi, 'US') },
      'CN',
      false
    ).aqi;
    const repPm25 = primaryStation.pm25;
    const repPm25AqiUS = calculatePM25AQI(primaryStation.pm25, 'US');
    const repPm25AqiCN = calculatePM25AQI(primaryStation.pm25, 'CN');

    allRanked.push({
      id: city.id,
      nameZh: city.nameZh,
      nameEn: city.nameEn,
      country: city.country,
      province: city.province,
      latitude: city.latitude,
      longitude: city.longitude,
      isDomestic: Boolean(city.isDomestic),
      aqi: compAqiUS,
      aqiUS: compAqiUS,
      aqiCN: compAqiCN,
      pm25AqiUS,
      pm25AqiCN,
      pm25: cityPm25Conc,
      stationsCount: validStations.length,
      population: city.population,
      repAqiUS,
      repAqiCN,
      repPm25AqiUS,
      repPm25AqiCN,
      repPm25,
      repStationName: primaryStation.name,
      repStationUid: primaryStation.uid || undefined,
    });
  }

  const domesticCleanest = allRanked.filter((c) => c.isDomestic).sort((a, b) => a.aqi - b.aqi);
  const domesticPolluted = [...domesticCleanest].reverse();

  const globalCleanest = [...allRanked].sort((a, b) => a.aqi - b.aqi);
  const globalPolluted = [...globalCleanest].reverse();

  return {
    success: true,
    updatedAt: new Date(nowMs).toISOString(),
    totalStations,
    totalCities: allRanked.length,
    isRefreshing: false,
    domestic: {
      cleanest: domesticCleanest,
      polluted: domesticPolluted,
    },
    global: {
      cleanest: globalCleanest,
      polluted: globalPolluted,
    },
  };
}

export interface CronBatchRunSummary {
  batchIndex: number;
  slicesRequested: number;
  slicesSucceeded: number;
  subrequestsUsed: number;
  stationsMatched: number;
  published: boolean;
  totalCities: number;
}

/**
 * Cloudflare Worker Cron 单批滚动执行引擎：
 * - 每分钟拉取 1/8 全球切片（42 个，严格低于免费版 50 subrequest 红线）
 * - 每批就地完成空间归属与 2 小时死站清理，均摊至极低 CPU 开销
 * - 批号 0..6：写 1 次 `ranking:draft`（严格 1 KV 写）
 * - 批号 7：合并全网 8 批数据原子发布 `ranking:latest`（严格 1 KV 写）
 * 全天总写入 = 2 轮/时 × 8 次/轮 × 24 时 = 384 次/天 < 1,000 次/天免费额度。
 */
export async function runRankingCronBatch(
  kv: KVNamespaceLike,
  tokens: string[],
  batchIndex: number,
  nowMs = Date.now(),
  fetchImpl: typeof fetch = fetch
): Promise<CronBatchRunSummary> {
  const bounds = getBoundsForBatch(batchIndex);
  const activeTokens = tokens.length > 0 ? tokens : [...DEFAULT_WAQI_TOKENS];
  if (bounds.length === 0 || activeTokens.length === 0) {
    return {
      batchIndex,
      slicesRequested: 0,
      slicesSucceeded: 0,
      subrequestsUsed: 0,
      stationsMatched: 0,
      published: false,
      totalCities: 0,
    };
  }

  // 1. 读取现有滚动草稿（与网络拉取并行发起，零额外延迟）
  const draftPromise = kv
    .get(RANKING_DRAFT_KEY)
    .then((raw): RankingDraftState => {
      if (!raw) return { updatedAt: nowMs, lastBatch: -1, cities: {} };
      try {
        const parsed = JSON.parse(raw) as RankingDraftState;
        if (parsed && parsed.cities && typeof parsed.cities === 'object') {
          return parsed;
        }
      } catch {}
      return { updatedAt: nowMs, lastBatch: -1, cities: {} };
    })
    .catch((): RankingDraftState => ({ updatedAt: nowMs, lastBatch: -1, cities: {} }));

  // 2. 拉取本批 42 个高清切片（6 并发 + 最多 4 次全局重试额度，确保总请求 < 50）
  let nextIdx = 0;
  let extraRetriesRemaining = MAX_EXTRA_RETRIES;
  let slicesSucceeded = 0;
  let subrequestsUsed = 0;
  const matchedByCity = new Map<string, Map<string, DraftStationEntry>>();
  let stationsMatched = 0;

  const worker = async () => {
    while (nextIdx < bounds.length) {
      const idx = nextIdx++;
      const boundStr = bounds[idx];
      const token = activeTokens[(batchIndex * 42 + idx) % activeTokens.length];
      const url = `https://api.waqi.info/v2/map/bounds/?latlng=${boundStr}&token=${token}`;

      let done = false;
      while (!done) {
        subrequestsUsed++;
        try {
          const res = await fetchImpl(url, {
            signal: createTimeoutSignal(FETCH_TIMEOUT_MS),
          });

          if (res.ok) {
            const json = (await res.json()) as any;
            const items = json?.data;
            if (Array.isArray(items)) {
              slicesSucceeded++;
              for (let i = 0; i < items.length; i++) {
                const st = items[i];
                if (!st || !st.uid) continue;
                const aqiNum = parseInt(st.aqi, 10);
                if (isNaN(aqiNum) || aqiNum <= 0 || aqiNum > 500) continue;
                if (typeof st.lat !== 'number' || typeof st.lon !== 'number') continue;

                const matched = findClosestCityFast(st.lat, st.lon, MAX_CITY_RADIUS_KM);
                if (!matched) continue;

                const pm25Val = convertIAQIToConcentration('pm25', aqiNum, 'US');
                if (pm25Val <= 0) continue;

                let cityStations = matchedByCity.get(matched.city.id);
                if (!cityStations) {
                  cityStations = new Map<string, DraftStationEntry>();
                  matchedByCity.set(matched.city.id, cityStations);
                }

                const cleanName = extractCleanStationName(
                  st.station?.name || '',
                  matched.city.nameZh
                );
                const obsMs = parseObservedTimeMs(st.station?.time);
                // 若上游明确上报时间且已停更超过 6 小时（如芝加哥僵尸探头），直接过滤不污染排行
                if (obsMs && nowMs - obsMs > 6 * 60 * 60 * 1000) {
                  continue;
                }
                cityStations.set(String(st.uid), {
                  a: aqiNum,
                  p: pm25Val,
                  d: Number(matched.distKm.toFixed(2)),
                  n: cleanName,
                  t: nowMs,
                  ...(obsMs ? { ot: obsMs } : {}),
                  la: Number(st.lat.toFixed(3)),
                  lo: Number(st.lon.toFixed(3)),
                });
                stationsMatched++;
              }
            }
            done = true;
          } else if ((res.status === 429 || res.status >= 500) && extraRetriesRemaining > 0) {
            extraRetriesRemaining--;
            await new Promise((r) => setTimeout(r, 350));
          } else {
            done = true;
          }
        } catch {
          if (extraRetriesRemaining > 0) {
            extraRetriesRemaining--;
            await new Promise((r) => setTimeout(r, 300));
          } else {
            done = true;
          }
        }
      }
    }
  };

  const workers = Array.from({ length: Math.min(WORKER_CONCURRENCY, bounds.length) }, () => worker());
  await Promise.all(workers);

  // 3. 合并草稿并清理超过 2 小时未上报的失效测站
  const draft = await draftPromise;
  const prunedCities: Record<string, Record<string, DraftStationEntry>> = {};

  for (const [cityId, stationMap] of Object.entries(draft.cities)) {
    const alive: Record<string, DraftStationEntry> = {};
    let count = 0;
    for (const [uidStr, entry] of Object.entries(stationMap)) {
      if (entry && nowMs - entry.t <= STATION_TTL_MS) {
        alive[uidStr] = entry;
        count++;
      }
    }
    if (count > 0) {
      prunedCities[cityId] = alive;
    }
  }

  // 合入本批新采集到的测站数据（同 uid 新值覆盖旧值）
  for (const [cityId, freshStations] of Array.from(matchedByCity.entries())) {
    if (!prunedCities[cityId]) {
      prunedCities[cityId] = {};
    }
    for (const [uidStr, entry] of Array.from(freshStations.entries())) {
      prunedCities[cityId][uidStr] = entry;
    }
  }

  const nextDraft: RankingDraftState = {
    updatedAt: nowMs,
    lastBatch: batchIndex,
    cities: prunedCities,
  };

  // 4. 严格控制每次 Cron 触发仅执行 1 次 KV 写入：
  // - 批号 0..6：更新草稿池 ranking:draft
  // - 批号 7：原子构建并发布全网快照 ranking:latest
  if (batchIndex < TOTAL_BATCHES - 1) {
    await kv.put(RANKING_DRAFT_KEY, JSON.stringify(nextDraft), {
      expirationTtl: 6 * 60 * 60, // 6 小时兜底过期
    });
    return {
      batchIndex,
      slicesRequested: bounds.length,
      slicesSucceeded,
      subrequestsUsed,
      stationsMatched,
      published: false,
      totalCities: Object.keys(prunedCities).length,
    };
  }

  const snapshot = buildRankingSnapshotFromDraft(nextDraft, nowMs);
  await kv.put(RANKING_LATEST_KEY, JSON.stringify(snapshot), {
    expirationTtl: 6 * 60 * 60, // 6 小时兜底过期
  });

  return {
    batchIndex,
    slicesRequested: bounds.length,
    slicesSucceeded,
    subrequestsUsed,
    stationsMatched,
    published: true,
    totalCities: snapshot.totalCities,
  };
}
