import { NextResponse } from 'next/server';
import { CITIES_REGISTRY } from '@/lib/constants/cities';
import { CityMeta } from '@/lib/types';
import { convertIAQIToConcentration, evaluateAQI } from '@/lib/aqi-calculator';

export const runtime = 'nodejs';
export const revalidate = 600; // 10 分钟缓存

interface RankedCityItem {
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

interface RankingApiResponse {
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

// 内存单例缓存
let cacheData: RankingApiResponse | null = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 分钟

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

function getApproxDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat1 - lat2) * 111.0;
  const dLon = (lon1 - lon2) * 111.0 * Math.cos((((lat1 + lat2) / 2.0) * Math.PI) / 180.0);
  return Math.sqrt(dLat * dLat + dLon * dLon);
}

export async function GET() {
  const now = Date.now();
  if (cacheData && now - lastFetchTime < CACHE_TTL_MS) {
    return NextResponse.json(cacheData, {
      headers: {
        'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=1200',
      },
    });
  }

  try {
    // 并发拉取全球多区域高清测站
    const fetchPromises = REGION_BOUNDS.map(async (bounds) => {
      const url = `https://api.waqi.info/v2/map/bounds/?latlng=${bounds}&token=${WAQI_TOKEN}`;
      const res = await fetch(url, { next: { revalidate: 600 } });
      if (!res.ok) return [];
      const json = await res.json();
      return (json.data || []) as any[];
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

      let closestCity: CityMeta | null = null;
      let minDist = 65.0; // 65km 大都市圈匹配

      for (const c of CITIES_REGISTRY) {
        const d = getApproxDistanceKm(sLat, sLon, c.latitude, c.longitude);
        if (d < minDist) {
          minDist = d;
          closestCity = c;
        }
      }

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
      const evalUS = evaluateAQI({ pm25: avgPm25 }, 'US');

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

    cacheData = {
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
    lastFetchTime = now;

    return NextResponse.json(cacheData, {
      headers: {
        'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=1200',
      },
    });
  } catch (error: any) {
    console.error('Error generating realtime ranking:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to fetch realtime rankings',
      },
      { status: 500 }
    );
  }
}
