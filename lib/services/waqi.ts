import {
  AirQualityRecord,
  PollutantValues,
  IAQIValues,
  CityMeta,
  WeatherInfo,
  DataProvenance,
  FreshnessMeta,
} from '../types';
import { evaluateAQI, getUSEvaluation, convertIAQIToConcentration, calculateCNIAQI } from '../aqi-calculator';
import { findCity } from '../constants/cities';
import {
  aggregateCompositeRecord,
  extractStationMetricsFromIaqi,
  preferOfficialStations,
} from './composite-aggregator';
import {
  computeFreshness,
  extractUtcOffsetLabel,
  parseObservedTimeMs,
  pruneStaleStations,
  sortStationsByFreshnessAndDistance,
} from '../datasources/freshness';
import { createTimeoutSignal } from '../datasources/units';
import { encodeWaqiTarget, extractCleanStationName, getDistanceKm } from '../utils/common';

export { extractCleanStationName, getDistanceKm };

// 零源码硬编码 Token：本地 dev 读取 .env.local，线上静态产物自动走 Cloudflare Worker /api/waqi/* 零 Token 代理
const WAQI_TOKENS: string[] = (
  process.env.WAQI_TOKENS ||
  process.env.NEXT_PUBLIC_WAQI_TOKEN ||
  ''
)
  .split(/[,\s]+/)
  .map((t) => t.trim())
  .filter((t) => Boolean(t) && !t.startsWith('your_'));
const WAQI_TOKEN = WAQI_TOKENS[0] || '';

let waqiTokenCursor = 0;
function getNextWaqiToken(): string {
  if (WAQI_TOKENS.length === 0) return '';
  const token = WAQI_TOKENS[waqiTokenCursor % WAQI_TOKENS.length];
  waqiTokenCursor = (waqiTokenCursor + 1) % WAQI_TOKENS.length;
  return token;
}

function buildWaqiFeedUrl(target: string): string {
  const token = getNextWaqiToken();
  if (token) {
    return `https://api.waqi.info/feed/${encodeWaqiTarget(target)}/?token=${encodeURIComponent(token)}`;
  }
  return `/api/waqi/feed?target=${encodeURIComponent(target)}`;
}

function buildWaqiBoundsUrl(minLat: number, minLng: number, maxLat: number, maxLng: number): string {
  const latlng = `${minLat},${minLng},${maxLat},${maxLng}`;
  const token = getNextWaqiToken();
  if (token) {
    return `https://api.waqi.info/v2/map/bounds?latlng=${latlng}&token=${token}`;
  }
  return `/api/waqi/bounds?latlng=${encodeURIComponent(latlng)}`;
}

export async function fetchWAQICityData(cityIdentifier: string): Promise<AirQualityRecord> {
  const cityMeta = findCity(cityIdentifier);

  // 核心原则：城市实况全面采用“市中心法定经纬度核心基准站”
  // 1. 优先从该城市在册实测站池中，严格选取距离市中心最近的在册活跃基准站 (Center Station)
  // 彻底告别对个别城市 slug 的依赖，杜绝停更一年的死站残留数据 (如达卡)
  if (cityMeta && typeof cityMeta.latitude === 'number' && typeof cityMeta.longitude === 'number') {
    try {
      const stations = await fetchWAQICityStations(cityMeta);
      if (stations.length > 0 && stations[0].uid) {
        return await fetchWAQIStationByUid(stations[0].uid, cityMeta, stations[0].station?.name);
      }
    } catch {
      // 容灾继续往下探测
    }

    // 2. 若无活跃实测站 (例如全城测站暂时停更或维护)，优先检查官方 slug 并如实展示其离线/停更状态
    if (cityMeta.waqiSlug) {
      try {
        const url = buildWaqiFeedUrl(cityMeta.waqiSlug);
        const res = await fetch(url, { cache: 'no-store' });
        if (res.ok) {
          const json = await res.json();
          if (json.status === 'ok' && json.data) {
            return parseWAQIResponse(json.data, cityMeta);
          }
        }
      } catch {}
    }
  }

  // 兼容直接传入 slug 或非注册标识符的兜底场景
  const targetSlug = cityMeta?.waqiSlug || cityIdentifier;
  const url = buildWaqiFeedUrl(targetSlug);

  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      throw new Error(`WAQI HTTP status ${res.status}`);
    }
    const json = await res.json();
    if (json.status !== 'ok' || !json.data) {
      throw new Error(`WAQI API error: ${json.data || 'Unknown error'}`);
    }

    return parseWAQIResponse(json.data, cityMeta);
  } catch (err: any) {
    console.warn(`[WAQI] Fetch failed for ${cityIdentifier}:`, err?.message || err);
    throw new Error(err?.message || `WAQI 暂未收录该站点或当前无数据发布`);
  }
}

export async function fetchWAQIStationByUid(
  uid: number,
  cityMeta?: CityMeta,
  stationName?: string
): Promise<AirQualityRecord> {
  const url = buildWaqiFeedUrl(`@${uid}`);

  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`WAQI HTTP status ${res.status}`);
    const json = await res.json();
    if (json.status !== 'ok' || !json.data) throw new Error('该测站暂无最新数据发布');

    // 自动回填单站完整 6 项污染物 + 4 项气象内存快照，避免 enrichStationsWithPM25 重复请求市中心基准站
    const metrics = extractStationMetricsFromIaqi(json.data.iaqi);
    setStationDetailCache(uid, {
      ...metrics,
      timestamp: Date.now(),
    });

    const cleanName = stationName || extractCleanStationName(json.data.city?.name || '', cityMeta?.nameZh);
    const displayName = cityMeta ? cityMeta.nameZh : cleanName;

    const parsed = parseWAQIResponse(json.data, cityMeta);
    return {
      ...parsed,
      name: displayName,
      nameEn: cityMeta ? cityMeta.nameEn : (json.data.city?.name ? json.data.city.name.split(',')[0] : parsed.nameEn),
    };
  } catch (err: any) {
    console.warn(`[WAQI] Station fetch failed for @${uid}:`, err?.message || err);
    throw new Error(err?.message || `获取该测站数据失败`);
  }
}

export interface WaqiBoundStation {
  lat: number;
  lon: number;
  uid: number;
  aqi: string;
  station: {
    name: string;
    time: string;
  };
  pm25?: number; // 实测 PM2.5 质量浓度 (μg/m³)
  pm25IaqiUS?: number; // 实测美标 PM2.5 分指数
  pm25IaqiCN?: number; // 实测国标 PM2.5 分指数
  pollutants?: PollutantValues; // 完整 6 项实测物理浓度
  weather?: WeatherInfo; // 完整 4 项气象实测
}

export interface EdgeCityRealtimePayload {
  success: boolean;
  cityId: string;
  baseRecord: AirQualityRecord;
  stations: WaqiBoundStation[];
  compositeRecord: AirQualityRecord;
  totalOfficialStations: number;
  sampledStations: number;
  updatedAt: string;
  provenance?: DataProvenance;
  freshness?: FreshnessMeta;
}

interface StationDetailEntry {
  pm25?: number;
  pm25IaqiUS?: number;
  pm25IaqiCN?: number;
  pollutants: PollutantValues;
  weather: WeatherInfo;
  timestamp: number;
}

// 测站实测内存快照缓存池 (5分钟保鲜，带容量上限与过期清理防长会话内存增长) + 同站/同城并发去重池
const STATION_DETAIL_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_STATION_DETAIL_CACHE = 500;
const stationDetailCache = new Map<number, StationDetailEntry>();
const stationDetailInFlight = new Map<number, Promise<StationDetailEntry | null>>();
const cityStationsInFlight = new Map<string, Promise<WaqiBoundStation[]>>();
const edgeCityInFlight = new Map<string, Promise<EdgeCityRealtimePayload | null>>();

function setStationDetailCache(uid: number, entry: StationDetailEntry) {
  if (stationDetailCache.size >= MAX_STATION_DETAIL_CACHE) {
    const now = Date.now();
    stationDetailCache.forEach((v, k) => {
      if (now - v.timestamp >= STATION_DETAIL_CACHE_TTL_MS) {
        stationDetailCache.delete(k);
      }
    });
    while (stationDetailCache.size >= MAX_STATION_DETAIL_CACHE) {
      const oldestKey = stationDetailCache.keys().next().value;
      if (oldestKey === undefined) break;
      stationDetailCache.delete(oldestKey);
    }
  }
  // Refresh insertion order for basic LRU behavior
  stationDetailCache.delete(uid);
  stationDetailCache.set(uid, entry);
}

function raceWithSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T | null> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.resolve(null);
  return new Promise<T | null>((resolve, reject) => {
    const onAbort = () => resolve(null);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (val) => {
        signal.removeEventListener('abort', onAbort);
        resolve(val);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      }
    );
  });
}

/**
 * 优先请求 Cloudflare Worker 边缘加速聚合接口 (/api/city-realtime?city=...)
 * 命中 5 分钟 Edge Cache 时 < 100ms 秒开；在本地 next dev 或纯静态托管下返回 null，自动回落前端并发通道。
 * 并发去重池不绑定单个调用方的 AbortSignal，避免调用方 A 取消请求时误杀复用的调用方 B。
 */
export async function fetchEdgeCityRealtime(
  cityId: string,
  signal?: AbortSignal
): Promise<EdgeCityRealtimePayload | null> {
  if (typeof window === 'undefined') return null;

  let task = edgeCityInFlight.get(cityId);
  if (!task) {
    task = (async (): Promise<EdgeCityRealtimePayload | null> => {
      try {
        const res = await fetch(`/api/city-realtime?city=${encodeURIComponent(cityId)}`, {
          cache: 'no-store',
          signal: createTimeoutSignal(8000),
        });
        if (!res.ok) return null;
        const json = (await res.json()) as EdgeCityRealtimePayload;
        if (json && json.success && json.baseRecord && json.compositeRecord) {
          // 仅将 WAQI 同源单站分项同步写入内存缓存，避免与非 WAQI 哈希 UID 混淆
          const now = Date.now();
          if (Array.isArray(json.stations)) {
            for (const st of json.stations) {
              const stProv = (st as { providerId?: string }).providerId;
              if (st.pollutants && (!stProv || stProv === 'waqi')) {
                setStationDetailCache(st.uid, {
                  pm25: st.pm25,
                  pm25IaqiUS: st.pm25IaqiUS,
                  pm25IaqiCN: st.pm25IaqiCN,
                  pollutants: st.pollutants,
                  weather: st.weather || {},
                  timestamp: now,
                });
              }
            }
          }
          return json;
        }
        return null;
      } catch {
        return null;
      } finally {
        edgeCityInFlight.delete(cityId);
      }
    })();

    edgeCityInFlight.set(cityId, task);
  }

  return raceWithSignal(task, signal);
}

function fetchSingleStationPm25(uid: number, signal?: AbortSignal): Promise<StationDetailEntry | null> {
  if (signal?.aborted) return Promise.resolve(null);

  let task = stationDetailInFlight.get(uid);
  if (!task) {
    task = (async (): Promise<StationDetailEntry | null> => {
      try {
        const url = buildWaqiFeedUrl(`@${uid}`);
        const res = await fetch(url, { cache: 'no-store', signal: createTimeoutSignal(6000) });
        if (res.ok) {
          const json = await res.json();
          if (json.status === 'ok' && json.data) {
            const metrics = extractStationMetricsFromIaqi(json.data.iaqi);
            const entry: StationDetailEntry = {
              ...metrics,
              timestamp: Date.now(),
            };
            setStationDetailCache(uid, entry);
            return entry;
          }
        }
        return null;
      } catch {
        return null;
      } finally {
        stationDetailInFlight.delete(uid);
      }
    })();

    stationDetailInFlight.set(uid, task);
  }

  return raceWithSignal(task, signal);
}

/**
 * 异步高并发补齐微站完整 6 项污染物 + 4 项气象实测指标
 * 借助 5-Token 轮询池 + 10 并发 HTTP/2 多路复用 + 同站请求去重 + 单站 6 秒长尾熔断
 */
export async function enrichStationsWithPM25(
  stations: WaqiBoundStation[],
  options?: { concurrency?: number; signal?: AbortSignal; maxStations?: number }
): Promise<WaqiBoundStation[]> {
  if (!stations || stations.length === 0) return [];
  const now = Date.now();
  const CACHE_TTL = 5 * 60 * 1000;
  const concurrency = Math.max(1, options?.concurrency ?? 10);
  const signal = options?.signal;
  const maxStations = options?.maxStations ?? stations.length;

  const result: WaqiBoundStation[] = [...stations];
  const pendingIndices: number[] = [];

  for (let i = 0; i < Math.min(stations.length, maxStations); i++) {
    const st = stations[i];
    if (st.pollutants && st.pm25 !== undefined && !isNaN(st.pm25) && st.pm25 > 0) continue;
    const cached = stationDetailCache.get(st.uid);
    if (cached && now - cached.timestamp < CACHE_TTL) {
      result[i] = {
        ...st,
        pm25: cached.pm25,
        pm25IaqiUS: cached.pm25IaqiUS,
        pm25IaqiCN: cached.pm25IaqiCN,
        pollutants: cached.pollutants,
        weather: cached.weather,
      };
    } else {
      pendingIndices.push(i);
    }
  }

  let cursor = 0;
  const worker = async () => {
    while (cursor < pendingIndices.length) {
      if (signal?.aborted) return;
      const idx = pendingIndices[cursor++];
      const st = stations[idx];
      const entry = await fetchSingleStationPm25(st.uid, signal);
      if (entry) {
        result[idx] = {
          ...st,
          pm25: entry.pm25,
          pm25IaqiUS: entry.pm25IaqiUS,
          pm25IaqiCN: entry.pm25IaqiCN,
          pollutants: entry.pollutants,
          weather: entry.weather,
        };
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, pendingIndices.length) }, () => worker()));
  return result;
}

export async function fetchWAQIMapBounds(
  minLat: number,
  minLng: number,
  maxLat: number,
  maxLng: number
): Promise<WaqiBoundStation[]> {
  const url = buildWaqiBoundsUrl(minLat, minLng, maxLat, maxLng);
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      throw new Error(`WAQI bounds HTTP error ${res.status}`);
    }
    const json = await res.json();
    if (json.status !== 'ok' || !Array.isArray(json.data)) {
      return [];
    }
    return json.data;
  } catch (err: any) {
    console.warn('[WAQI] Bounds fetch failed:', err?.message || err);
    return [];
  }
}

/**
 * 获取特定城市在册的全部官方与国控微站列表（自动过滤跨城污染源与邻城测站）
 * 按需动态加载 geo-filter (@rapideditor/country-coder)，不污染首页首屏 JS 包体积
 */
export async function fetchWAQICityStations(city: CityMeta): Promise<WaqiBoundStation[]> {
  const existing = cityStationsInFlight.get(city.id);
  if (existing) return existing;

  const task = (async () => {
    const [stations, { filterStationsForCity }] = await Promise.all([
      fetchWAQIMapBounds(
        city.latitude - 0.35,
        city.longitude - 0.35,
        city.latitude + 0.35,
        city.longitude + 0.35
      ),
      import('./geo-filter'),
    ]);

    const valid = stations.filter((s) => {
      const a = parseInt(s.aqi, 10);
      return !isNaN(a) && a > 0 && a <= 500;
    });

    const cityOnly = preferOfficialStations(filterStationsForCity(valid, city));

    // 剔除 >4 小时僵尸探头，并采用「新鲜度优先（最新整点窗内）+ 距市中心距离次之」排序
    // 彻底杜绝单座滞后基准站（如北京东城天坛/台北信义站）拖累全城时间戳
    const nowMs = Date.now();
    const withMeta = cityOnly.map((s) => ({
      station: s,
      distKm: getDistanceKm(s.lat, s.lon, city.latitude, city.longitude),
      observedAtMs: parseObservedTimeMs(s.station?.time) ?? undefined,
    }));
    const alive = pruneStaleStations(withMeta, nowMs);
    const ranked = sortStationsByFreshnessAndDistance(alive);
    return ranked.map((item) => item.station);
  })().finally(() => {
    cityStationsInFlight.delete(city.id);
  });

  cityStationsInFlight.set(city.id, task);
  return task;
}

/**
 * 拉取城市全城多站实测全项均值记录（Concentration-First 口径，与首页主卡片严格同源）
 * 优先走 Cloudflare Worker /api/city-realtime 边缘聚合加速接口，不可用时回落前端两段并行流水线
 */
export async function fetchWAQICityCompositeData(
  cityIdentifier: string,
  signal?: AbortSignal
): Promise<AirQualityRecord> {
  const cityMeta = findCity(cityIdentifier);
  if (!cityMeta) {
    return fetchWAQICityData(cityIdentifier);
  }

  // 优先走 Cloudflare Edge 聚合加速接口（3 分钟边缘缓存，<100ms 秒开）
  const edgePayload = await fetchEdgeCityRealtime(cityMeta.id, signal);
  if (edgePayload?.compositeRecord) {
    return edgePayload.compositeRecord;
  }

  // 回落前端两段并行流水线：Wave 1 单次拉取官方站点列表 -> Wave 2 市中心站详情 + 其余微站 5-Token 10并发同时拉取
  const stations = await fetchWAQICityStations(cityMeta).catch(() => [] as WaqiBoundStation[]);
  if (stations.length === 0) {
    return fetchWAQICityData(cityMeta.id);
  }

  const [baseRecord, restEnriched] = await Promise.all([
    fetchWAQIStationByUid(stations[0].uid, cityMeta, stations[0].station?.name),
    stations.length > 1
      ? enrichStationsWithPM25(stations.slice(1), {
          concurrency: 10,
          signal,
          maxStations: 19,
        }).catch(() => stations.slice(1))
      : Promise.resolve([] as WaqiBoundStation[]),
  ]);

  if (signal?.aborted) {
    return baseRecord;
  }

  const firstStation: WaqiBoundStation = {
    ...stations[0],
    pm25: baseRecord.pollutants.pm25,
    pm25IaqiUS: baseRecord.iaqiUS?.pm25,
    pm25IaqiCN: baseRecord.iaqiCN?.pm25,
    pollutants: baseRecord.pollutants,
    weather: baseRecord.weather,
  };
  const enriched = [firstStation, ...restEnriched];

  return aggregateCompositeRecord(baseRecord, enriched, cityMeta, 'CN', false);
}

function parseWAQIResponse(data: any, cityMeta?: any): AirQualityRecord {
  const iaqiRaw = data.iaqi || {};
  
  // 1. WAQI 官方 API 返回的 iaqiRaw 键值（pm25.v、pm10.v 等）均为美标 (US EPA NowCast) IAQI 分指数
  // 官方页面每一行也明确标注为 "PM2.5 AQI: 46", "PM10 AQI: 21" 等无量纲分指数。
  const iaqiUS: IAQIValues = {
    pm25: iaqiRaw.pm25?.v !== undefined ? Math.round(iaqiRaw.pm25.v) : undefined,
    pm10: iaqiRaw.pm10?.v !== undefined ? Math.round(iaqiRaw.pm10.v) : undefined,
    o3: iaqiRaw.o3?.v !== undefined ? Math.round(iaqiRaw.o3.v) : undefined,
    no2: iaqiRaw.no2?.v !== undefined ? Math.round(iaqiRaw.no2.v) : undefined,
    so2: iaqiRaw.so2?.v !== undefined ? Math.round(iaqiRaw.so2.v) : undefined,
    co: iaqiRaw.co?.v !== undefined ? Math.round(iaqiRaw.co.v) : undefined,
  };

  // 2. 根据美标 US EPA 断点逆向求出真实客观的物理质量浓度 (μg/m³，CO 为 mg/m³)
  // 空气中的物理微克质量浓度是客观存在的大气物理量，绝不随用户切换国标/美标而发生改变
  const pollutants: PollutantValues = {
    pm25: iaqiRaw.pm25?.v !== undefined ? convertIAQIToConcentration('pm25', iaqiRaw.pm25.v, 'US') : undefined,
    pm10: iaqiRaw.pm10?.v !== undefined ? convertIAQIToConcentration('pm10', iaqiRaw.pm10.v, 'US') : undefined,
    o3: iaqiRaw.o3?.v !== undefined ? convertIAQIToConcentration('o3', iaqiRaw.o3.v, 'US') : undefined,
    no2: iaqiRaw.no2?.v !== undefined ? convertIAQIToConcentration('no2', iaqiRaw.no2.v, 'US') : undefined,
    so2: iaqiRaw.so2?.v !== undefined ? convertIAQIToConcentration('so2', iaqiRaw.so2.v, 'US') : undefined,
    co: iaqiRaw.co?.v !== undefined ? convertIAQIToConcentration('co', iaqiRaw.co.v, 'US') : undefined,
  };

  // 3. 基于客观物理质量浓度计算中国国标 (HJ 633-2012) 分指数
  const iaqiCN = calculateCNIAQI(pollutants);

  const geo = data.city?.geo || (cityMeta ? [cityMeta.latitude, cityMeta.longitude] : [39.9, 116.4]);
  const isDomestic = cityMeta ? Boolean(cityMeta.isDomestic) : false;

  const isNoLiveData = data.aqi === '-' || data.aqi === null || data.aqi === undefined;

  let evaluationCN = evaluateAQI(pollutants, 'CN');
  let evaluationUS = evaluateAQI(pollutants, 'US');

  // 若官方明确发布 aqi 为 '-' (或缺失)：保留基于最后实测浓度的计算值，使用沉稳灰指示停更，但保持等级与健康建议的纯净语义
  if (isNoLiveData) {
    const lastAqiCN = evaluationCN.aqi || 0;
    const lastAqiUS = evaluationUS.aqi || 0;

    evaluationCN = {
      ...evaluationCN,
      aqi: lastAqiCN,
      level: lastAqiCN > 0 ? evaluationCN.level : '暂无数据',
      levelEn: lastAqiCN > 0 ? evaluationCN.levelEn : 'No Data',
      color: '#64748b', // 灰色指示停更
      textColor: '#ffffff',
      isOffline: true,
    };

    evaluationUS = {
      ...evaluationUS,
      aqi: lastAqiUS,
      level: lastAqiUS > 0 ? evaluationUS.level : 'No Data',
      levelEn: lastAqiUS > 0 ? evaluationUS.levelEn : 'No Data',
      color: '#64748b', // 灰色指示停更
      textColor: '#ffffff',
      isOffline: true,
    };
  } else if (evaluationUS.aqi === 0 && typeof data.aqi === 'number' && !isNaN(data.aqi) && data.aqi > 0) {
    // 严格遵守 AQI 计算公理：仅在全部实测分项污染物均缺失时，才使用 WAQI 顶层 data.aqi 作为兜底，并同步折算国标
    const officialAqi = Math.round(data.aqi);
    evaluationUS = getUSEvaluation(officialAqi, evaluationUS.primaryPollutant);
    const estPm25 = convertIAQIToConcentration('pm25', officialAqi, 'US');
    evaluationCN = evaluateAQI({ pm25: estPm25 }, 'CN');
  }

  const obsMs = parseObservedTimeMs(data.time?.iso || data.time?.s, data.time?.tz);
  const tzLabel = extractUtcOffsetLabel(data.time?.tz || data.time?.iso);
  const freshness = computeFreshness(
    obsMs,
    Date.now(),
    undefined,
    data.time?.iso || data.time?.s || undefined,
    tzLabel
  );
  const provenance: DataProvenance = {
    providerId: 'waqi',
    providerName: 'WAQI',
    tier: 'ground-official',
  };

  return {
    id: cityMeta?.id || `station-${data.idx || 'unknown'}`,
    name: cityMeta?.nameZh || data.city?.name || '未知监测点',
    nameEn: cityMeta?.nameEn || data.city?.name || 'Unknown Location',
    country: cityMeta?.country || (isDomestic ? 'CN' : 'GLOBAL'),
    isDomestic,
    isOffline: isNoLiveData,
    stationIdx: typeof data.idx === 'number' ? data.idx : undefined,
    latitude: typeof geo[0] === 'number' && Number.isFinite(geo[0]) ? geo[0] : 0,
    longitude: typeof geo[1] === 'number' && Number.isFinite(geo[1]) ? geo[1] : 0,
    updateTime: data.time?.s || new Date().toLocaleString(),
    pollutants,
    iaqi: iaqiUS,
    iaqiCN,
    iaqiUS,
    evaluationCN,
    evaluationUS,
    freshness,
    provenance,
    weather: {
      temp: iaqiRaw.t?.v,
      humidity: iaqiRaw.h?.v,
      windSpeed: iaqiRaw.w?.v,
      pressure: iaqiRaw.p?.v,
    },
    forecast: data.forecast?.daily ? {
      pm25: (data.forecast.daily.pm25 || []).map((f: any) => ({
        day: f.day,
        min: typeof f.min === 'number' ? convertIAQIToConcentration('pm25', f.min, 'US') : 0,
        max: typeof f.max === 'number' ? convertIAQIToConcentration('pm25', f.max, 'US') : 0,
        avg: typeof f.avg === 'number' ? convertIAQIToConcentration('pm25', f.avg, 'US') : 0,
      })),
      pm10: data.forecast.daily.pm10 || [],
      o3: data.forecast.daily.o3 || [],
      uvi: data.forecast.daily.uvi || [],
    } : undefined,
    sourceAttribution: data.attributions || [
      { name: 'World Air Quality Index Project', url: 'https://waqi.info/' }
    ],
  };
}



