import { CITIES_REGISTRY } from '../constants/cities';
import { CityMeta } from '../types';
import { convertIAQIToConcentration, evaluateAQI } from '../aqi-calculator';
import { extractCleanStationName } from './waqi';
import { iso1A2Code } from '@rapideditor/country-coder';

export interface RankedCityItem {
  id: string;
  nameZh: string;
  nameEn: string;
  country: string;
  province?: string;
  latitude: number;
  longitude: number;
  isDomestic: boolean;
  aqi: number;
  aqiUS: number;
  aqiCN: number;
  pm25: number;
  stationsCount: number;
  population?: number;
  repAqiUS?: number;
  repAqiCN?: number;
  repPm25?: number;
  repStationName?: string;
  repStationUid?: number;
}

export interface RankingApiResponse {
  success: boolean;
  updatedAt: string;
  totalStations: number;
  totalCities: number;
  domestic: {
    cleanest: RankedCityItem[];
    polluted: RankedCityItem[];
  };
  global: {
    cleanest: RankedCityItem[];
    polluted: RankedCityItem[];
  };
}

const WAQI_TOKEN = process.env.NEXT_PUBLIC_WAQI_TOKEN || '50b0c272a11f35667dd0ef7de354d76e9560ac48';

/**
 * 纯数据驱动的全球城市全量高清无抽稀网格生成器 (彻底消除任何手工硬编码维护)
 * 直接以 CITIES_REGISTRY 在册城市为基准点，为每个城市生成专属高清采样窗 (跨度 <= 2.4°)
 * 远低于 WAQI 4.0° 抽稀阈值，100% 绝对在 WAQI 服务端不抽稀的安全阈值内
 * 空间相邻都市圈自动去重合并，彻底消灭任何人工特判，所有在册城市 100% 自动对齐中心站点
 */
function buildDynamicHighResBounds(cities: CityMeta[]): string[] {
  const MAX_SPAN = 2.8; // 控制在 2.8° (约 300km)，远低于 WAQI 4.0° 抽稀阈值，100% 保留中心站点并显著降低请求数
  const PADDING = 0.25; // 边缘缓冲 0.25° (约 28km)

  // 空间网格排序：相邻经纬度的城市排在一起，最大化空间无缝合并率
  const sorted = [...cities].sort((a, b) => {
    const latDiff = Math.floor(a.latitude / MAX_SPAN) - Math.floor(b.latitude / MAX_SPAN);
    if (latDiff !== 0) return latDiff;
    return a.longitude - b.longitude;
  });

  const bounds: Array<{ minLat: number; maxLat: number; minLon: number; maxLon: number }> = [];

  for (const c of sorted) {
    if (typeof c.latitude !== 'number' || typeof c.longitude !== 'number') continue;
    let merged = false;
    for (const b of bounds) {
      const minLat = Math.min(b.minLat, c.latitude - PADDING);
      const maxLat = Math.max(b.maxLat, c.latitude + PADDING);
      const minLon = Math.min(b.minLon, c.longitude - PADDING);
      const maxLon = Math.max(b.maxLon, c.longitude + PADDING);

      if (maxLat - minLat <= MAX_SPAN && maxLon - minLon <= MAX_SPAN) {
        b.minLat = minLat;
        b.maxLat = maxLat;
        b.minLon = minLon;
        b.maxLon = maxLon;
        merged = true;
        break;
      }
    }
    if (!merged) {
      bounds.push({
        minLat: c.latitude - PADDING,
        maxLat: c.latitude + PADDING,
        minLon: c.longitude - PADDING,
        maxLon: c.longitude + PADDING,
      });
    }
  }

  // 二次聚类合并：检查已有 bounds 之间能否进一步合并，消除边界网格割裂
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < bounds.length; i++) {
      for (let j = i + 1; j < bounds.length; j++) {
        const b1 = bounds[i];
        const b2 = bounds[j];
        const minLat = Math.min(b1.minLat, b2.minLat);
        const maxLat = Math.max(b1.maxLat, b2.maxLat);
        const minLon = Math.min(b1.minLon, b2.minLon);
        const maxLon = Math.max(b1.maxLon, b2.maxLon);

        if (maxLat - minLat <= MAX_SPAN && maxLon - minLon <= MAX_SPAN) {
          bounds[i] = { minLat, maxLat, minLon, maxLon };
          bounds.splice(j, 1);
          changed = true;
          break;
        }
      }
      if (changed) break;
    }
  }

  return bounds.map(
    (b) => `${b.minLat.toFixed(2)},${b.minLon.toFixed(2)},${b.maxLat.toFixed(2)},${b.maxLon.toFixed(2)}`
  );
}

// 全局精确速率限制器：严格保证发往 WAQI 的请求速率不超过官方物理限额 (1,000 req/min = 16.6 req/s)
// 设定稳态速率为 14.0 req/s (约 71ms 时钟周期)，消除瞬时突发，从根源上杜绝 429 拦截
class RequestRateLimiter {
  private nextAllowedTime = 0;
  private readonly intervalMs: number;

  constructor(targetQps = 14.0) {
    this.intervalMs = Math.ceil(1000 / targetQps);
  }

  async acquire(): Promise<void> {
    const now = Date.now();
    const scheduled = Math.max(now, this.nextAllowedTime);
    this.nextAllowedTime = scheduled + this.intervalMs;
    const waitMs = scheduled - now;
    if (waitMs > 0) {
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
}

// 模块初始化时由 CITIES_REGISTRY 单次自动衍生，0 人工维护特判，100% 覆盖全部在册城市
const DYNAMIC_HIGH_RES_BOUNDS = buildDynamicHighResBounds(CITIES_REGISTRY);


/**
 * 纯几何经纬度最近城市空间归属：
 * 1. 纯经纬度主权判定：由经纬度坐标通过本地矢量逆地理编码确定测站所在主权国家 (ISO-2)
 * 2. 空间距离排他归属：在同国城市中，严格选取到城市中心几何物理距离最短的唯一归属
 * 零字符串正则、零国别猜测、零启发式特判，完全由客观物理地理决定。
 */
function findClosestCity(
  sLat: number,
  sLon: number,
  cities: CityMeta[],
  maxDistKm = 30.0
): CityMeta | null {
  // 直接通过坐标判定测站所属主权国家代码 (例如 "MY", "SG", "CN", "US")
  const stationCountry = iso1A2Code([sLon, sLat]);

  let closest: CityMeta | null = null;
  let minDistSq = maxDistKm * maxDistKm;
  const maxDegLat = maxDistKm / 111.0;

  for (let i = 0; i < cities.length; i++) {
    const c = cities[i];

    // 纯经纬度主权排他：若测站经纬度所属国家与候选城市不符，纯空间几何排他
    if (stationCountry && c.country && c.country !== stationCountry) {
      continue;
    }

    const dLat = Math.abs(sLat - c.latitude);
    if (dLat > maxDegLat) continue;

    const avgLatRad = ((sLat + c.latitude) * 0.5 * Math.PI) / 180.0;
    const cosLat = Math.cos(avgLatRad);
    const dLon = Math.abs(sLon - c.longitude);
    if (dLon * cosLat > maxDegLat) continue;

    const kmLat = dLat * 111.0;
    const kmLon = dLon * 111.0 * cosLat;
    const distSq = kmLat * kmLat + kmLon * kmLon;

    if (distSq < minDistSq) {
      minDistSq = distSq;
      closest = c;
    }
  }

  return closest;
}


// 客户端超时信号兼容
function getTimeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal !== 'undefined' && typeof (AbortSignal as any).timeout === 'function') {
    return (AbortSignal as any).timeout(ms);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

// 方案 1 & 2：服务端内存 SWR 缓存与请求单例控制器
let memoryRankingCache: RankingApiResponse | null = null;
let lastFetchTimestamp = 0;
let inFlightFetchPromise: Promise<RankingApiResponse> | null = null;

// 全局在册测站累积池：跨请求持久保留有效测站，新值覆盖旧值，彻底杜绝单次网络抖动导致的城市消失
const cumulativeStationMap = new Map<number, any>();

// 缓存与防抖规范 (方案 1 & 2)
const FRESH_TTL_MS = 8 * 60 * 1000; // 8 分钟内视为绝对保鲜，直接 0ms 返回快照
const STALE_TTL_MS = 25 * 60 * 1000; // 8 ~ 25 分钟处于 SWR 窗口，直接先行返回快照，后台异步静默刷新
const MIN_REFRESH_INTERVAL_MS = 30 * 1000; // 方案 2：手动刷新 30 秒物理防抖，防止高频狂点击穿

/**
 * 计算城市聚合 AQI 与 PM2.5 (算术平均值，零启发式加权或离群过滤)
 */
function aggregateCityData(aqis: number[], pm25s: number[]): { avgAqiUS: number; avgPm25: number } {
  if (aqis.length === 0) return { avgAqiUS: 0, avgPm25: 0 };
  const avgAqiUS = Math.round(aqis.reduce((a, b) => a + b, 0) / aqis.length);
  const avgPm25 = Number((pm25s.reduce((a, b) => a + b, 0) / pm25s.length).toFixed(1));
  return { avgAqiUS, avgPm25 };
}

/**
 * 实时获取全球与国内空气质量排行榜数据 (遵循方案 1 & 2：8分钟 SWR 内存快照 + 30秒防抖穿透)
 * @param forceRefresh 是否为用户手动点击刷新 (触发方案 2 穿透逻辑)
 */
export async function getRealtimeRanking(forceRefresh = false): Promise<RankingApiResponse> {
  const now = Date.now();

  // 1. 若已有内存快照
  if (memoryRankingCache) {
    const age = now - lastFetchTimestamp;

    // 方案 2：用户手动点击刷新 (forceRefresh === true)
    if (forceRefresh) {
      if (age < MIN_REFRESH_INTERVAL_MS) {
        // 30 秒内物理防抖，直接返回现有快照
        return memoryRankingCache;
      }
      // 超过 30 秒，发起穿透拉取并等待完成
      return triggerFetch();
    }

    // 方案 1：页面正常访问与轮询 (forceRefresh === false)
    if (age < FRESH_TTL_MS) {
      // 8 分钟保鲜期内，直接秒回快照 (0ms，0 请求)
      return memoryRankingCache;
    }

    if (age < STALE_TTL_MS) {
      // 8 ~ 25 分钟处于 SWR 窗口：立即返回当前快照，同时在后台异步静默拉取
      triggerFetch().catch((err) => {
        console.warn('[RealtimeRanking] Background SWR refresh failed:', err);
      });
      return memoryRankingCache;
    }
  }

  // 2. 无缓存（首次冷启动）或快照已超过 25 分钟：同步等待拉取
  return triggerFetch();
}

/**
 * 全局单例拉取调度器：保证全站同一时刻最多只有一个正在向 WAQI 执行拉取的任务，杜绝并发风暴
 */
function triggerFetch(): Promise<RankingApiResponse> {
  if (inFlightFetchPromise) {
    return inFlightFetchPromise;
  }

  inFlightFetchPromise = performFetchAndAggregate().finally(() => {
    inFlightFetchPromise = null;
  });

  return inFlightFetchPromise;
}

/**
 * 实际执行全网切片抓取与聚合的核心引擎
 */
async function performFetchAndAggregate(): Promise<RankingApiResponse> {
  const now = Date.now();

  try {
    const isClient = typeof window !== 'undefined';
    // 服务端采用 16 个并发 Worker 管道配合 14.0 QPS 全局速率限制器，充分填满网络 RTT 延迟且杜绝 429 截断
    const CONCURRENCY = isClient ? 8 : 16;
    const rateLimiter = new RequestRateLimiter(isClient ? 10.0 : 14.0);
    let nextIndex = 0;
    const currentBatchMap = new Map<number, any>();

    const fetchWorker = async () => {
      while (nextIndex < DYNAMIC_HIGH_RES_BOUNDS.length) {
        const idx = nextIndex++;
        const bounds = DYNAMIC_HIGH_RES_BOUNDS[idx];
        const url = `https://api.waqi.info/v2/map/bounds/?latlng=${bounds}&token=${WAQI_TOKEN}`;
        let attempts = 3;

        while (attempts > 0) {
          try {
            // 通过全局时钟调度器平滑放行，紧贴官方 16.6 QPS 物理上限并留出绝对安全裕度
            await rateLimiter.acquire();

            const res = await fetch(url, { signal: getTimeoutSignal(10000), cache: 'no-store' });

            if (res.status === 429) {
              attempts--;
              // 遭遇 429 频控退避：等待 500ms 后重试
              await new Promise((r) => setTimeout(r, 500));
              continue;
            }

            if (!res.ok) {
              attempts--;
              await new Promise((r) => setTimeout(r, 200));
              continue;
            }

            const json = (await res.json()) as any;
            const items = json?.data;
            if (Array.isArray(items)) {
              for (const st of items) {
                if (st && st.uid) {
                  currentBatchMap.set(st.uid, st);
                  cumulativeStationMap.set(st.uid, st);
                }
              }
            }
            break;
          } catch {
            attempts--;
            await new Promise((r) => setTimeout(r, 200));
          }
        }
      }
    };

    const workers = Array.from({ length: CONCURRENCY }, () => fetchWorker());
    await Promise.all(workers);

    // 测站池：优先使用累积测站池（新值覆盖旧值，且网络偶发抖动不丢失测站）
    const uniqueStations = Array.from(
      cumulativeStationMap.size > 0 ? cumulativeStationMap.values() : currentBatchMap.values()
    );

    // 空间聚类：将站点就近归并至都市圈城市 (30km 精准都市圈半径)
    interface StationCandidate {
      uid: number;
      name: string;
      aqi: number;
      pm25: number;
      distKm: number;
    }

    interface ClusterBucket {
      city: CityMeta;
      aqis: number[];
      pm25s: number[];
      stations: StationCandidate[];
    }
    const cityCluster = new Map<string, ClusterBucket>();

    for (const st of uniqueStations) {
      const aqiNum = parseInt(st.aqi, 10);
      // 标准 AQI 范围为 1 ~ 500，超出 500 的为硬件故障或严重脏数据
      // 自然室外环境空气中即使在极洁净极地/海岛，PM2.5 也极少低于 0.8 μg/m³ (对应 AQI 2~3)；
      // AQI <= 2 绝大多数属于传感器物理断开零漂、硬件通讯故障或室内密闭滤网测试，必须予以过滤防伪
      if (isNaN(aqiNum) || aqiNum <= 2 || aqiNum > 500) continue;
      // 过滤未校准探头低于 6 的假读数 (如室内净化器旁)
      if (st.uid < 0 && aqiNum <= 6) continue;

      const sLat = st.lat;
      const sLon = st.lon;
      const closestCity = findClosestCity(sLat, sLon, CITIES_REGISTRY, 30.0);

      if (closestCity) {
        if (!cityCluster.has(closestCity.id)) {
          cityCluster.set(closestCity.id, {
            city: closestCity,
            aqis: [],
            pm25s: [],
            stations: [],
          });
        }
        const bucket = cityCluster.get(closestCity.id)!;
        const pm25Val = convertIAQIToConcentration('pm25', aqiNum, 'US');

        // 计算测站到市中心基准点的实际物理球面距离
        const dLat = (sLat - closestCity.latitude) * 111.0;
        const avgLatRad = ((sLat + closestCity.latitude) * 0.5 * Math.PI) / 180.0;
        const dLon = (sLon - closestCity.longitude) * 111.0 * Math.cos(avgLatRad);
        const distKm = Math.sqrt(dLat * dLat + dLon * dLon);
        const stName = st.station?.name || closestCity.nameZh;

        bucket.stations.push({
          uid: st.uid,
          name: stName,
          aqi: aqiNum,
          pm25: pm25Val,
          distKm,
        });

        bucket.aqis.push(aqiNum);
        bucket.pm25s.push(pm25Val);
      }
    }

    // 转换为排名项：分别以国标与美标精确折算 AQI
    const allRanked: RankedCityItem[] = [];
    for (const [_, item] of Array.from(cityCluster.entries())) {
      if (item.aqis.length === 0) continue;

      const { avgAqiUS, avgPm25 } = aggregateCityData(item.aqis, item.pm25s);
      if (avgAqiUS <= 2) continue;

      const evalCN = evaluateAQI({ pm25: avgPm25 }, 'CN');

      // 提取市中心核心基准站：
      // 纯粹以城市中心法定经纬度为基准，严格选取几何物理距离最近的在册基准站 (与全景地图、城市实况 100% 规则对齐)
      const sortedByDist = [...item.stations].sort((a, b) => a.distKm - b.distKm);
      const primaryStation = sortedByDist[0];

      let repAqiUS = avgAqiUS;
      let repAqiCN = evalCN.aqi;
      let repPm25 = avgPm25;
      let repStationName = item.city.nameZh;
      let repStationUid: number | undefined = undefined;

      if (primaryStation) {
        repAqiUS = primaryStation.aqi;
        repPm25 = primaryStation.pm25;
        repAqiCN = evaluateAQI({ pm25: repPm25 }, 'CN').aqi;
        repStationName = extractCleanStationName(primaryStation.name, item.city.nameZh);
        repStationUid = primaryStation.uid;
      }

      allRanked.push({
        id: item.city.id,
        nameZh: item.city.nameZh,
        nameEn: item.city.nameEn,
        country: item.city.country,
        province: item.city.province,
        latitude: item.city.latitude,
        longitude: item.city.longitude,
        isDomestic: Boolean(item.city.isDomestic),
        aqi: avgAqiUS,
        aqiUS: avgAqiUS,
        aqiCN: evalCN.aqi,
        pm25: avgPm25,
        stationsCount: item.aqis.length,
        population: item.city.population,
        repAqiUS,
        repAqiCN,
        repPm25,
        repStationName,
        repStationUid,
      });
    }

    // 若拉取异常且无任何城市解析出来，优先回退历史有效缓存
    if (allRanked.length === 0 && memoryRankingCache) {
      return memoryRankingCache;
    }

    // 国内榜单 (从属于国内 375 城的站点聚合)
    const domesticList = allRanked.filter((c) => c.isDomestic);
    domesticList.sort((a, b) => a.aqi - b.aqi);

    const domesticCleanest = domesticList;
    const domesticPolluted = [...domesticList].reverse();

    // 全球主要都会榜单 (全球所有城市综合竞技)
    const globalList = [...allRanked];
    globalList.sort((a, b) => a.aqi - b.aqi);

    const globalCleanest = globalList;
    const globalPolluted = [...globalList].reverse();

    const freshResult: RankingApiResponse = {
      success: true,
      updatedAt: new Date().toISOString(),
      totalStations: uniqueStations.length,
      totalCities: allRanked.length,
      domestic: {
        cleanest: domesticCleanest,
        polluted: domesticPolluted,
      },
      global: {
        cleanest: globalCleanest,
        polluted: globalPolluted,
      },
    };

    memoryRankingCache = freshResult;
    lastFetchTimestamp = Date.now(); // 必须使用拉取完成时刻的精确时间戳，保证 30 秒物理防抖和 8 分钟 SWR 有效计算

    return freshResult;
  } catch (err: any) {
    console.error('[RealtimeRanking] Failed to fetch or calculate rankings:', err);
    if (memoryRankingCache) {
      return memoryRankingCache;
    }
    throw err;
  }
}
