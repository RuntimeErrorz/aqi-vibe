import { findCity } from '../constants/cities';
import type { AirQualityRecord, CityMeta } from '../types';
import { calculateCNIAQI, evaluateAQI } from '../aqi-calculator';
import {
  aggregateCompositeRecord,
  extractStationMetricsFromIaqi,
  preferOfficialStations,
  StationCompositeSample,
} from './composite-aggregator';
import {
  DEFAULT_WAQI_TOKENS,
  KVNamespaceLike,
  RANKING_DRAFT_KEY,
  RankingDraftState,
  STATION_TTL_MS,
} from './cf-ranking-engine';
import {
  EdgeCityRealtimeResult,
  filterStationsEdge,
  parseWaqiStationResponse,
} from './cf-city-realtime';
import {
  createTimeoutSignal,
  defaultProviderRegistry,
  fetchCityRealtimeMultiSource,
  getRealtimeChainForCountry,
  RawEnvBag,
  refreshFreshnessMeta,
  resolveProviderSecrets,
} from '../datasources';
import {
  QWEATHER_STALL_THRESHOLD_MIN,
  seedQWeatherContentTag,
} from '../datasources/providers/qweather.provider';

/**
 * 40 座全球核心大都市（国内 20 城 + 海外 20 城），按站群规模均衡混编为 10 个分包：
 * 每批固定 4 城共享 44 个官方站子请求池（动态注水分配：中小站群 100% 全量覆盖，超大站群最高 24 个核心官方站）
 * 对应 Cron #2：`9-18,39-48 * * * *`（每 30 分钟全量更新，10 批 × 2 轮/时 × 24 时 = 480 次 KV 写/天）
 */
export const HOT_CITY_PACKS: readonly (readonly string[])[] = [
  ['gl-tokyo', 'cn-chengdu', 'gl-singapore', 'gl-madrid'],        // Pack 0 (:09 / :39)
  ['gl-seoul', 'cn-hangzhou', 'gl-bangkok', 'gl-rome'],           // Pack 1 (:10 / :40)
  ['cn-shenzhen', 'cn-wuhan', 'cn-zhengzhou', 'gl-losangeles'],   // Pack 2 (:11 / :41)
  ['gl-delhi', 'cn-nanjing', 'cn-suzhou', 'gl-sanfrancisco'],     // Pack 3 (:12 / :42)
  ['gl-london', 'cn-changsha', 'cn-tianjin', 'cn-xiamen'],        // Pack 4 (:13 / :43)
  ['cn-guangzhou', 'cn-xian', 'cn-qingdao', 'gl-chicago'],        // Pack 5 (:14 / :44)
  ['cn-shanghai', 'cn-dalian', 'gl-sydney', 'gl-toronto'],        // Pack 6 (:15 / :45)
  ['cn-chongqing', 'cn-kunming', 'gl-melbourne', 'cn-shenyang'],  // Pack 7 (:16 / :46)
  ['cn-beijing', 'gl-paris', 'gl-hong-kong', 'cn-harbin'],        // Pack 8 (:17 / :47)
  ['gl-berlin', 'gl-moscow', 'gl-newyork', 'gl-taipei'],          // Pack 9 (:18 / :48)
];

export const HOT_PACK_KEY_PREFIX = 'hot:';
export const HOT_PACK_START_MINUTE = 9;
export const MAX_SUBREQUESTS_PER_PACK = 44; // 44 fetch + 2 KV ops = 46 < 50 免费版硬上限
export const MAX_STATIONS_PER_HOT_CITY = 24;
export const HOT_CACHE_MAX_AGE_MS = 90 * 60 * 1000; // 超过 90 分钟未刷新视为过期回源
const EDGE_CONCURRENCY = 6;
const FETCH_TIMEOUT_MS = 4500;

const HOT_CITY_TO_PACK = new Map<string, number>();
HOT_CITY_PACKS.forEach((pack, packIdx) => {
  pack.forEach((cityId) => HOT_CITY_TO_PACK.set(cityId, packIdx));
});

export function getHotPackKey(packIndex: number): string {
  return `${HOT_PACK_KEY_PREFIX}${packIndex}`;
}

export function getHotCityPackIndex(cityQuery: string): { city: CityMeta; packIndex: number } | null {
  const city = findCity(cityQuery);
  if (!city) return null;
  const packIndex = HOT_CITY_TO_PACK.get(city.id);
  if (packIndex === undefined) return null;
  return { city, packIndex };
}

/**
 * 对应 Cron 表达式 `9-18,39-48 * * * *`（每 30 分钟 1 轮，10 个分包互不与排行 Cron `0-7,30-37` 冲突）
 */
export function getHotCitiesPackIndexFromDate(date: Date): number {
  const minute = date.getUTCMinutes();
  const offset = minute % 30;
  if (offset >= HOT_PACK_START_MINUTE && offset < HOT_PACK_START_MINUTE + HOT_CITY_PACKS.length) {
    return offset - HOT_PACK_START_MINUTE;
  }
  return -1;
}

/**
 * 批内动态注水配额分配算法：
 * 在严格不超过 totalBudget（44）前提下，让小站数城市 100% 全量采齐，余量均匀分配给大站群都市（单城封顶 24 站）
 */
export function allocateStationBudgets(
  availableCounts: number[],
  totalBudget: number,
  maxPerCity = MAX_STATIONS_PER_HOT_CITY
): number[] {
  const caps = availableCounts.map((n) => Math.max(0, Math.min(n, maxPerCity)));
  const alloc = availableCounts.map(() => 0);
  let remaining = Math.max(0, totalBudget);

  while (remaining > 0) {
    let grantedAny = false;
    for (let i = 0; i < caps.length && remaining > 0; i++) {
      if (alloc[i] < caps[i]) {
        alloc[i]++;
        remaining--;
        grantedAny = true;
      }
    }
    if (!grantedAny) break;
  }

  return alloc;
}

export interface HotCitiesPackPayload {
  packIndex: number;
  updatedAt: string;
  updatedAtMs: number;
  cities: Record<string, EdgeCityRealtimeResult>;
}

export interface HotPackRunSummary {
  packIndex: number;
  citiesProcessed: number;
  subrequestsUsed: number;
  stationsFetched: number;
  perCitySampled: Record<string, number>;
}

/**
 * 从 KV 分包秒读热门大都市预热快照（内网 ~10ms，0 WAQI 外部请求）
 */
export async function readHotCityFromKV(
  kv: KVNamespaceLike,
  cityQuery: string,
  nowMs = Date.now()
): Promise<EdgeCityRealtimeResult | null> {
  const match = getHotCityPackIndex(cityQuery);
  if (!match) return null;

  try {
    const raw = await kv.get(getHotPackKey(match.packIndex));
    if (!raw) return null;
    const pack = JSON.parse(raw) as HotCitiesPackPayload;
    if (!pack || !pack.cities) return null;
    if (typeof pack.updatedAtMs === 'number' && nowMs - pack.updatedAtMs > HOT_CACHE_MAX_AGE_MS) {
      return null;
    }
    const cityResult = pack.cities[match.city.id];
    if (!cityResult || !cityResult.success) return null;
    // 单城复用快照同样严守 90 分钟时效上限，防止包时间戳刷新掩盖单城实际超期
    const cityUpdatedMs = cityResult.updatedAt ? Date.parse(cityResult.updatedAt) : NaN;
    if (Number.isFinite(cityUpdatedMs) && nowMs - cityUpdatedMs > HOT_CACHE_MAX_AGE_MS) {
      return null;
    }
    // 刷新缓存快照中的动态 delayMinutes / isStale，避免复用窗口导致延迟角标冻结
    const refreshedFreshness = refreshFreshnessMeta(cityResult.freshness, nowMs);
    return {
      ...cityResult,
      ...(refreshedFreshness ? { freshness: refreshedFreshness } : {}),
      ...(cityResult.baseRecord
        ? {
            baseRecord: {
              ...cityResult.baseRecord,
              freshness: refreshFreshnessMeta(cityResult.baseRecord.freshness, nowMs),
            },
          }
        : {}),
      ...(cityResult.compositeRecord
        ? {
            compositeRecord: {
              ...cityResult.compositeRecord,
              freshness: refreshFreshnessMeta(cityResult.compositeRecord.freshness, nowMs),
            },
          }
        : {}),
    };
  } catch {
    return null;
  }
}

/**
 * 执行单批（4 座大都市）高密度官方站预热并写入独立 KV 分包 `hot:{packIndex}`
 * 支持策略 A 多源路由：当该城具备更低延迟的区域优先源（如和风天气 / OpenAQ）且已配置时，
 * 直接通过多源编排器抓取（通常仅消耗 1~7 subrequests）；否则无缝复用 ranking:draft 执行 WAQI 零 bounds 预热。
 */
export async function runHotCitiesCronPack(
  kv: KVNamespaceLike,
  tokens: string[],
  packIndex: number,
  nowMs = Date.now(),
  fetchImpl: typeof fetch = fetch,
  rawEnv?: RawEnvBag
): Promise<HotPackRunSummary> {
  const cityIds = HOT_CITY_PACKS[packIndex];
  if (!cityIds || cityIds.length === 0) {
    return {
      packIndex,
      citiesProcessed: 0,
      subrequestsUsed: 0,
      stationsFetched: 0,
      perCitySampled: {},
    };
  }

  const activeTokens = tokens.length > 0 ? tokens : [...DEFAULT_WAQI_TOKENS];
  let tokenIdx = packIndex * 11;
  const nextToken = () =>
    activeTokens.length > 0 ? activeTokens[tokenIdx++ % activeTokens.length] : '';

  // Never object-spread Cloudflare Worker `env` (bindings/secrets may be non-enumerable getters)
  const resolved = resolveProviderSecrets(rawEnv);
  const secrets = {
    ...resolved,
    waqiTokens: activeTokens.length > 0 ? activeTokens : resolved.waqiTokens,
  };

  // 预检：读取上一轮热城分包缓存（1 次 KV 读），用于和风免费月配额保护：
  // 和风月免费 50,000 次，若同城上一轮由和风更新且距今 < 50 分钟（同整点），直接复用不重复扣额度
  // （20 城 × 24 次/天 × 30 天 = 14,400 次/月，稳稳控制在免费额度的 30% 以内！）
  const QWEATHER_REUSE_WINDOW_MS = 50 * 60 * 1000;
  let prevPackCities: Record<string, EdgeCityRealtimeResult> = {};
  try {
    const prevRaw = await kv.get(getHotPackKey(packIndex));
    if (prevRaw) {
      const prevPack = JSON.parse(prevRaw) as HotCitiesPackPayload;
      if (prevPack && prevPack.cities) {
        prevPackCities = prevPack.cities;
      }
    }
  } catch {}

  // 预检：哪些城市已配置了优先于 WAQI 的低延迟区域源（如中国大陆配了和风、香港免费直连 EPD、台湾/北美配了 OpenAQ）
  const multiSourceResults: Record<string, EdgeCityRealtimeResult> = {};
  const waqiFallbackCityIds: string[] = [];
  let subrequestsUsed = 0;

  for (const cityId of cityIds) {
    const city = findCity(cityId);
    if (!city) continue;

    // 若该城上轮由和风成功预热且距今 < 50 分钟（且指纹未卡死 > 3 小时），直接复用节省月度配额
    const prevCity = prevPackCities[city.id];
    const prevUpdatedMs = prevCity?.updatedAt ? Date.parse(prevCity.updatedAt) : 0;
    const prevTag = prevCity?.freshness?.contentTag;
    const prevTagFirstSeenMs = prevCity?.freshness?.tagFirstSeenMs ?? prevUpdatedMs;
    const prevTagUnchangedMin =
      prevTag && prevTagFirstSeenMs > 0
        ? Math.round((nowMs - prevTagFirstSeenMs) / 60_000)
        : 0;
    if (
      prevCity &&
      prevCity.success &&
      prevCity.provenance?.providerId === 'qweather' &&
      prevUpdatedMs > 0 &&
      nowMs - prevUpdatedMs < QWEATHER_REUSE_WINDOW_MS &&
      prevTagUnchangedMin < QWEATHER_STALL_THRESHOLD_MIN
    ) {
      multiSourceResults[city.id] = prevCity;
      continue;
    }

    // 把上一轮 KV 中的和风内容指纹安全种入跟踪器（不覆盖同 Isolate 已观测到的新指纹）
    if (prevTag && prevTagFirstSeenMs > 0) {
      seedQWeatherContentTag(city.id, prevTag, prevTagFirstSeenMs);
    }

    const chain = getRealtimeChainForCountry(city.country);
    const nonWaqiPreferred = chain[0] !== 'waqi';
    const checkCtx = { env: secrets, fetchImpl, nowMs, isServer: true };
    const preferredProvider = nonWaqiPreferred ? defaultProviderRegistry.get(chain[0]) : undefined;
    const hasPreferredSource = Boolean(
      preferredProvider &&
        preferredProvider.realtime &&
        preferredProvider.isAvailable(checkCtx) &&
        !defaultProviderRegistry.breaker.isOpen(preferredProvider.id, nowMs)
    );

    // 仅当存在明确优先的非 WAQI 区域源且余量充足时直接走策略 A 多源编排
    if (hasPreferredSource && subrequestsUsed + 8 <= MAX_SUBREQUESTS_PER_PACK) {
      try {
        const res = await fetchCityRealtimeMultiSource(
          city,
          {
            secrets,
            fetchImpl,
            nowMs,
            isServer: true,
            maxStations: 8,
            concurrency: EDGE_CONCURRENCY,
            timeoutMs: FETCH_TIMEOUT_MS,
          },
          { maxFallbackProbes: 1 }
        );
        if (res && res.success) {
          multiSourceResults[city.id] = res;
          // Conservatively account for bounds/stations/weather enrichment subrequests within CF 50-subrequest limit
          subrequestsUsed += Math.max(2, Math.min(10, res.sampledStations + 2));
          continue;
        }
      } catch {
        // 失败则回落下方 WAQI 通道
      }
    }

    waqiFallbackCityIds.push(cityId);
  }

  // 1. 读取 ranking:draft（1 次 KV 读），为剩余走 WAQI 的城市复用全网官方站 UID，免去大部分 map/bounds 请求
  let draftCities: RankingDraftState['cities'] = {};
  if (waqiFallbackCityIds.length > 0 && activeTokens.length > 0) {
    try {
      const draftRaw = await kv.get(RANKING_DRAFT_KEY);
      if (draftRaw) {
        const parsed = JSON.parse(draftRaw) as RankingDraftState;
        if (parsed && parsed.cities) {
          draftCities = parsed.cities;
        }
      }
    } catch {}
  }

  const cityContexts: Array<{ city: CityMeta; stations: StationCompositeSample[] }> = [];

  for (const cityId of activeTokens.length > 0 ? waqiFallbackCityIds : []) {
    const city = findCity(cityId);
    if (!city) continue;

    // 优先从 ranking:draft 提取该城活跃官方站（按距市中心由近到远排序）
    const draftMap = draftCities[city.id];
    let stations: StationCompositeSample[] = [];
    if (draftMap) {
      const fromDraft: Array<{ st: StationCompositeSample; dist: number }> = [];
      for (const [uidStr, entry] of Object.entries(draftMap)) {
        const uid = Number(uidStr);
        if (!Number.isFinite(uid) || uid === 0) continue;
        if (!entry || nowMs - entry.t > STATION_TTL_MS) continue;
        fromDraft.push({
          dist: entry.d,
          st: {
            uid,
            lat: entry.la ?? city.latitude,
            lon: entry.lo ?? city.longitude,
            aqi: String(entry.a),
            station: {
              name: entry.n || city.nameZh,
              time: new Date(entry.ot ?? entry.t).toISOString(),
            },
          },
        });
      }
      fromDraft.sort((a, b) => a.dist - b.dist);
      stations = preferOfficialStations(fromDraft.map((item) => item.st));
    }

    // 若该城位于排行 Batch 7（如伦敦/柏林/莫斯科）或冷启动草稿尚空，花 1 次 bounds 子请求补齐官方站列表
    if (stations.length === 0 && subrequestsUsed < MAX_SUBREQUESTS_PER_PACK) {
      subrequestsUsed++;
      const minLat = (city.latitude - 0.35).toFixed(4);
      const minLon = (city.longitude - 0.35).toFixed(4);
      const maxLat = (city.latitude + 0.35).toFixed(4);
      const maxLon = (city.longitude + 0.35).toFixed(4);
      const boundsUrl = `https://api.waqi.info/v2/map/bounds?latlng=${minLat},${minLon},${maxLat},${maxLon}&token=${nextToken()}`;
      try {
        const res = await fetchImpl(boundsUrl, { signal: createTimeoutSignal(FETCH_TIMEOUT_MS) });
        if (res.ok) {
          const json = (await res.json()) as any;
          if (json?.status === 'ok' && Array.isArray(json.data)) {
            stations = filterStationsEdge(json.data, city, nowMs);
          }
        }
      } catch {}
    }

    cityContexts.push({ city, stations });
  }

  // 2. 动态注水分配剩余子请求预算（严格 <= 44 subrequests）
  const remainingBudget = Math.max(0, MAX_SUBREQUESTS_PER_PACK - subrequestsUsed);
  const budgets = allocateStationBudgets(
    cityContexts.map((ctx) => ctx.stations.length),
    remainingBudget,
    MAX_STATIONS_PER_HOT_CITY
  );

  interface StationTask {
    cityIdx: number;
    stationIdx: number;
    city: CityMeta;
    station: StationCompositeSample;
  }

  const tasks: StationTask[] = [];
  const enrichedByCity: StationCompositeSample[][] = cityContexts.map((ctx) => [...ctx.stations]);
  const baseRecordByCity: Array<AirQualityRecord | null> = cityContexts.map(() => null);

  cityContexts.forEach((ctx, cityIdx) => {
    const count = budgets[cityIdx];
    for (let sIdx = 0; sIdx < count; sIdx++) {
      tasks.push({
        cityIdx,
        stationIdx: sIdx,
        city: ctx.city,
        station: ctx.stations[sIdx],
      });
    }
  });

  // 3. 6 并发 + 5-Token 轮询拉取全部选中官方站的 6 项污染物 + 4 项气象 + 预报
  let cursor = 0;
  let stationsFetched = 0;

  const worker = async () => {
    while (cursor < tasks.length) {
      const task = tasks[cursor++];
      subrequestsUsed++;
      try {
        const url = `https://api.waqi.info/feed/@${task.station.uid}/?token=${nextToken()}`;
        const res = await fetchImpl(url, { signal: createTimeoutSignal(FETCH_TIMEOUT_MS) });
        if (!res.ok) continue;
        const json = (await res.json()) as any;
        if (json?.status !== 'ok' || !json.data) continue;

        stationsFetched++;
        const metrics = extractStationMetricsFromIaqi(json.data.iaqi);
        enrichedByCity[task.cityIdx][task.stationIdx] = {
          ...task.station,
          pm25: metrics.pm25,
          pm25IaqiUS: metrics.pm25IaqiUS,
          pm25IaqiCN: metrics.pm25IaqiCN,
          pollutants: metrics.pollutants,
          weather: metrics.weather,
        };

        // 优先取距市中心最近的官方站 (stationIdx === 0) 作为基准元数据与预报源
        if (task.stationIdx === 0 || !baseRecordByCity[task.cityIdx]) {
          baseRecordByCity[task.cityIdx] = parseWaqiStationResponse(json.data, task.city, nowMs);
        }
      } catch {
        // 单站超时静默容灾
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(EDGE_CONCURRENCY, tasks.length) }, () => worker())
  );

  // 4. 聚合每座城市的全 6 项污染物 + 4 项气象多站均值，打包写入独立 KV 分包 hot:{packIndex}
  const updatedIso = new Date(nowMs).toISOString();
  const citiesMap: Record<string, EdgeCityRealtimeResult> = { ...multiSourceResults };
  const perCitySampled: Record<string, number> = {};
  for (const [cid, res] of Object.entries(multiSourceResults)) {
    perCitySampled[cid] = res.sampledStations;
    stationsFetched += res.sampledStations;
  }

  cityContexts.forEach((ctx, cityIdx) => {
    const enriched = enrichedByCity[cityIdx];
    let baseRecord = baseRecordByCity[cityIdx];

    if (!baseRecord) {
      const fb = enriched.find((s) => s.pollutants && (s.pollutants.pm25 || s.pollutants.pm10));
      if (!fb) return;
      const pollutants = fb.pollutants || {};
      const iaqiCN = calculateCNIAQI(pollutants);
      baseRecord = {
        id: ctx.city.id,
        name: ctx.city.nameZh,
        nameEn: ctx.city.nameEn,
        country: ctx.city.country,
        isDomestic: Boolean(ctx.city.isDomestic),
        stationIdx: fb.uid,
        latitude: fb.lat,
        longitude: fb.lon,
        updateTime: fb.station?.time || updatedIso,
        pollutants,
        iaqi: iaqiCN,
        iaqiCN,
        evaluationCN: evaluateAQI(pollutants, 'CN'),
        evaluationUS: evaluateAQI(pollutants, 'US'),
        weather: fb.weather,
      };
    }

    const compositeRecord = {
      ...aggregateCompositeRecord(baseRecord, enriched, ctx.city, 'CN', false),
      freshness: baseRecord.freshness,
      provenance: baseRecord.provenance,
    };
    const sampledCount = compositeRecord.compositeStationCount || budgets[cityIdx];
    perCitySampled[ctx.city.id] = sampledCount;

    citiesMap[ctx.city.id] = {
      success: true,
      cityId: ctx.city.id,
      baseRecord,
      stations: enriched,
      compositeRecord,
      totalOfficialStations: ctx.stations.length,
      sampledStations: sampledCount,
      updatedAt: updatedIso,
      provenance: baseRecord.provenance,
      freshness: baseRecord.freshness,
    };
  });

  const payload: HotCitiesPackPayload = {
    packIndex,
    updatedAt: updatedIso,
    updatedAtMs: nowMs,
    cities: citiesMap,
  };

  await kv.put(getHotPackKey(packIndex), JSON.stringify(payload), {
    expirationTtl: 3 * 60 * 60, // 3 小时兜底过期
  });

  return {
    packIndex,
    citiesProcessed: Object.keys(citiesMap).length,
    subrequestsUsed,
    stationsFetched,
    perCitySampled,
  };
}
