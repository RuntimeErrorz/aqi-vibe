import { AirQualityRecord, PollutantValues, IAQIValues, CityMeta } from '../types';
import { evaluateAQI, getCNEvaluation, getUSEvaluation, convertIAQIToConcentration, calculateCNIAQI } from '../aqi-calculator';
import { findCity, CITIES_REGISTRY } from '../constants/cities';
import { iso1A2Code } from '@rapideditor/country-coder';

const WAQI_TOKEN = process.env.NEXT_PUBLIC_WAQI_TOKEN || '50b0c272a11f35667dd0ef7de354d76e9560ac48';

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
        const url = `https://api.waqi.info/feed/${encodeURIComponent(cityMeta.waqiSlug)}/?token=${WAQI_TOKEN}`;
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
  const url = `https://api.waqi.info/feed/${encodeURIComponent(targetSlug)}/?token=${WAQI_TOKEN}`;

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

export async function fetchWAQIGeoData(lat: number, lng: number, maxDistKm = 35): Promise<AirQualityRecord> {
  const url = `https://api.waqi.info/feed/geo:${lat};${lng}/?token=${WAQI_TOKEN}`;

  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`WAQI HTTP status ${res.status}`);
    const json = await res.json();
    if (json.status !== 'ok' || !json.data) throw new Error('该坐标附近暂无有效 WAQI 测站');

    // 严密距离校验：WAQI 的 geo 接口在本地无测站时会自动向外扩大数百公里搜索 (例如成都跳到200km外的重庆)
    // 超过设定阈值必须坚决抛出异常拒绝跨城抢站
    const stGeo = json.data.city?.geo;
    if (Array.isArray(stGeo) && stGeo.length >= 2) {
      const dist = getDistanceKm(lat, lng, stGeo[0], stGeo[1]);
      if (dist > maxDistKm) {
        throw new Error(`最近测站距离市中心过远 (${dist.toFixed(1)}km)，不属于目标城市范围`);
      }
    }

    return parseWAQIResponse(json.data);
  } catch (err: any) {
    console.warn(`[WAQI] Geo fetch failed for ${lat},${lng}:`, err?.message || err);
    throw new Error(err?.message || `该坐标附近暂无有效 WAQI 测站`);
  }
}

export function extractCleanStationName(rawName: string, cityNameZh?: string): string {
  if (!rawName) return '未命名测站';
  const match = rawName.match(/\((.+?)\)/);
  if (match && match[1]) {
    let name = match[1].trim();
    if (cityNameZh && name.startsWith(cityNameZh)) {
      const stripped = name.slice(cityNameZh.length).trim();
      if (stripped.length > 0) return stripped;
    }
    return name;
  }
  return rawName.split(',')[0].trim();
}

export async function fetchWAQIStationByUid(
  uid: number,
  cityMeta?: CityMeta,
  stationName?: string
): Promise<AirQualityRecord> {
  const url = `https://api.waqi.info/feed/@${uid}/?token=${WAQI_TOKEN}`;

  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`WAQI HTTP status ${res.status}`);
    const json = await res.json();
    if (json.status !== 'ok' || !json.data) throw new Error('该测站暂无最新数据发布');

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

export function getWAQIMapTileUrl(): string {
  return `https://tiles.aqicn.org/tiles/usepa-aqi/{z}/{x}/{y}.png?token=${WAQI_TOKEN}`;
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
}

export async function fetchWAQIMapBounds(
  minLat: number,
  minLng: number,
  maxLat: number,
  maxLng: number
): Promise<WaqiBoundStation[]> {
  const url = `https://api.waqi.info/v2/map/bounds?latlng=${minLat},${minLng},${maxLat},${maxLng}&token=${WAQI_TOKEN}`;
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
 * 计算两个经纬度坐标之间的球面大圆距离（单位：千米）
 */
export function getDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * 严格过滤属于特定城市的在册测站：
 * 杜绝地理边界矩形检索因经纬度重叠将临近城市测站误算入当前城市（例如德阳误算入成都/绵阳、佛山误算入广州/江门等）
 */
export function filterStationsForCity(
  stations: WaqiBoundStation[],
  targetCity: CityMeta,
  allCities: CityMeta[] = CITIES_REGISTRY
): WaqiBoundStation[] {
  if (!stations || stations.length === 0) return [];

  // 目标城市周围 160 公里内的在册城市作为 Voronoi 空间排他排他仲裁参考
  const neighborCities = allCities.filter((c) => {
    if (c.id === targetCity.id) return false;
    const dist = getDistanceKm(c.latitude, c.longitude, targetCity.latitude, targetCity.longitude);
    return dist <= 160;
  });

  return stations.filter((s) => {
    // 0. 纯经纬度主权国家排他：若测站经纬度所属国家与目标城市不符，直接排除
    const stCountry = iso1A2Code([s.lon, s.lat]);
    if (stCountry && targetCity.country && targetCity.country !== stCountry) {
      return false;
    }

    // 1. 严格物理几何距离门槛：测站必须在城市中心城区 35km 物理范围内
    const distToTarget = getDistanceKm(s.lat, s.lon, targetCity.latitude, targetCity.longitude);
    if (distToTarget > 35) return false;

    // 2. 纯客观物理几何 Voronoi 空间排他仲裁 (0 字符串正则与名称猜测)：
    // 若有其他邻近城市距离该测站更近，则该测站归属邻城
    for (const neighbor of neighborCities) {
      const distToNeighbor = getDistanceKm(s.lat, s.lon, neighbor.latitude, neighbor.longitude);
      if (distToNeighbor < distToTarget) {
        return false;
      }
    }

    return true;
  });
}

/**
 * 获取特定城市在册的全部官方与国控微站列表（自动过滤跨城污染源与邻城测站）
 */
export async function fetchWAQICityStations(city: CityMeta): Promise<WaqiBoundStation[]> {
  // 初步采用 ±0.35 度（约 35km 半径）进行精准覆盖
  let stations = await fetchWAQIMapBounds(
    city.latitude - 0.35,
    city.longitude - 0.35,
    city.latitude + 0.35,
    city.longitude + 0.35
  );

  let valid = stations.filter((s) => {
    const a = parseInt(s.aqi, 10);
    return !isNaN(a) && a > 0 && a <= 500;
  });

  let cityOnly = filterStationsForCity(valid, city);

  // 按距市中心距离由近及远排序
  return cityOnly.sort((a, b) => {
    const distA = getDistanceKm(a.lat, a.lon, city.latitude, city.longitude);
    const distB = getDistanceKm(b.lat, b.lon, city.latitude, city.longitude);
    return distA - distB;
  });
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
  const isDomestic = cityMeta ? cityMeta.isDomestic : (data.city?.name?.includes('China') || false);

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
  } else if (evaluationUS.aqi === 0 && typeof data.aqi === 'number' && !isNaN(data.aqi)) {
    // 严格遵守 AQI 计算公理：仅在全部实测分项污染物均缺失时，才使用 WAQI 顶层 data.aqi 作为兜底
    const officialAqi = Math.round(data.aqi);
    evaluationUS = getUSEvaluation(officialAqi, evaluationUS.primaryPollutant);
  }

  return {
    id: cityMeta?.id || `station-${data.idx || 'unknown'}`,
    name: cityMeta?.nameZh || data.city?.name || '未知监测点',
    nameEn: cityMeta?.nameEn || data.city?.name || 'Unknown Location',
    country: cityMeta?.country || (isDomestic ? 'CN' : 'GLOBAL'),
    isDomestic,
    isOffline: isNoLiveData,
    stationIdx: typeof data.idx === 'number' ? data.idx : undefined,
    latitude: geo[0] || 0,
    longitude: geo[1] || 0,
    updateTime: data.time?.s || new Date().toLocaleString(),
    pollutants,
    iaqi: iaqiUS,
    iaqiCN,
    iaqiUS,
    evaluationCN,
    evaluationUS,
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



