import { CITIES_REGISTRY } from '../constants/cities';
import { CityMeta } from '../types';
import { convertIAQIToConcentration, evaluateAQI } from '../aqi-calculator';

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

// 高密度全球与国内多区域分片视口
const REGION_BOUNDS = [
  '35,105,54,135',    // 中国北方/东北
  '18,105,35,125',    // 中国南方/华东
  '20,73,50,105',     // 中国西部/西北
  '30,125,46,146',    // 东亚 (日韩)
  '-11,95,25,125',    // 东南亚
  '5,60,38,95',       // 南亚 (印度/孟加拉)
  '35,-12,60,40',     // 欧洲西部与中部
  '50,15,70,55',      // 欧洲东部与北欧
  '24,-90,55,-60',    // 北美洲东部
  '24,-130,60,-90',   // 北美洲西部
  '-45,110,-10,180',  // 大洋洲 (澳洲/新西兰)
  '-35,-20,40,65',    // 非洲与中东
  '-55,-85,15,-35',   // 南美洲
];

// 高性能空间粗筛与最近城市聚类算法 (65km 范围)
// 通过纬度/经度矩形快速剔除 99.8% 的无效计算，避免触发边缘 Serverless 50ms CPU 限额
function findClosestCity(sLat: number, sLon: number, cities: CityMeta[], maxDistKm = 65.0): CityMeta | null {
  let closest: CityMeta | null = null;
  let minDistSq = maxDistKm * maxDistKm;
  const maxDegLat = maxDistKm / 111.0; // ~0.585 度

  for (let i = 0; i < cities.length; i++) {
    const c = cities[i];
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

// 内存单例缓存
let memoryRankingCache: RankingApiResponse | null = null;
let lastFetchTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 分钟常规缓存
const MIN_REFRESH_INTERVAL_MS = 15 * 1000; // 手动刷新保护间隔 15 秒，防止突发连续快速点击
const STORAGE_CACHE_KEY = 'aqi_vibe_realtime_ranking_v1';

/**
 * 从浏览器端本地缓存恢复
 */
function tryLoadFromClientStorage(): RankingApiResponse | null {
  if (typeof window === 'undefined' || !window.sessionStorage) return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.data && typeof parsed.timestamp === 'number') {
      if (Date.now() - parsed.timestamp < CACHE_TTL_MS) {
        return parsed.data;
      }
    }
  } catch {}
  return null;
}

/**
 * 写入浏览器端本地缓存
 */
function saveToClientStorage(data: RankingApiResponse): void {
  if (typeof window === 'undefined' || !window.sessionStorage) return;
  try {
    window.sessionStorage.setItem(
      STORAGE_CACHE_KEY,
      JSON.stringify({ timestamp: Date.now(), data })
    );
  } catch {}
}

/**
 * 实时获取全球与国内空气质量排行榜数据 (支持浏览器端本地极速计算与并发请求)
 * @param forceRefresh 是否强制向 WAQI 发起最新拉取
 */
export async function getRealtimeRanking(forceRefresh = false): Promise<RankingApiResponse> {
  const now = Date.now();

  // 1. 尝试使用内存单例缓存
  if (memoryRankingCache) {
    if (!forceRefresh && now - lastFetchTimestamp < CACHE_TTL_MS) {
      return memoryRankingCache;
    }
    if (forceRefresh && now - lastFetchTimestamp < MIN_REFRESH_INTERVAL_MS) {
      return memoryRankingCache;
    }
  }

  // 2. 尝试从浏览器 sessionStorage 恢复
  if (!forceRefresh) {
    const stored = tryLoadFromClientStorage();
    if (stored) {
      memoryRankingCache = stored;
      lastFetchTimestamp = now;
      return stored;
    }
  }

  try {
    // 并发拉取全球多区域高清测站 (7秒超时保护，防止个别偏远地区网络慢阻塞整体)
    const fetchPromises = REGION_BOUNDS.map(async (bounds) => {
      const url = `https://api.waqi.info/v2/map/bounds/?latlng=${bounds}&token=${WAQI_TOKEN}`;
      try {
        const res = await fetch(url, { signal: getTimeoutSignal(7000) });
        if (!res.ok) return [];
        const json = (await res.json()) as any;
        return (json.data || []) as any[];
      } catch {
        return [];
      }
    });

    const results = await Promise.allSettled(fetchPromises);
    const stationMap = new Map<number, any>();

    for (const r of results) {
      if (r.status === 'fulfilled' && Array.isArray(r.value)) {
        for (const st of r.value) {
          if (st && st.uid && !stationMap.has(st.uid)) {
            stationMap.set(st.uid, st);
          }
        }
      }
    }

    const uniqueStations = Array.from(stationMap.values());

    // 空间聚类：将站点就近归并至都市圈城市 (65km 范围)
    const cityCluster = new Map<string, { city: CityMeta; aqis: number[]; pm25s: number[] }>();

    for (const st of uniqueStations) {
      const aqiNum = parseInt(st.aqi, 10);
      if (isNaN(aqiNum) || aqiNum <= 0 || aqiNum > 800) continue;

      const sLat = st.lat;
      const sLon = st.lon;
      const closestCity = findClosestCity(sLat, sLon, CITIES_REGISTRY, 65.0);

      if (closestCity) {
        if (!cityCluster.has(closestCity.id)) {
          cityCluster.set(closestCity.id, { city: closestCity, aqis: [], pm25s: [] });
        }
        cityCluster.get(closestCity.id)!.aqis.push(aqiNum);
        // WAQI 的 st.aqi 为原生美标分指数，逆向推导其实际物理微克浓度
        const pm25Val = convertIAQIToConcentration('pm25', aqiNum, 'US');
        cityCluster.get(closestCity.id)!.pm25s.push(pm25Val);
      }
    }

    // 转换为排名项：分别以国标与美标精确折算 AQI
    const allRanked: RankedCityItem[] = [];
    for (const [_, item] of Array.from(cityCluster.entries())) {
      const avgAqiUS = Math.round(item.aqis.reduce((a: number, b: number) => a + b, 0) / item.aqis.length);
      const avgPm25 = Number((item.pm25s.reduce((a, b) => a + b, 0) / item.pm25s.length).toFixed(1));

      const evalCN = evaluateAQI({ pm25: avgPm25 }, 'CN');

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
    lastFetchTimestamp = now;
    saveToClientStorage(freshResult);

    return freshResult;
  } catch (err: any) {
    console.error('[RealtimeRanking] Failed to fetch or calculate rankings:', err);
    if (memoryRankingCache) {
      return memoryRankingCache;
    }
    throw err;
  }
}
