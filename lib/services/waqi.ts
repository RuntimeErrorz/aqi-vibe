import { AirQualityRecord, PollutantValues, IAQIValues } from '../types';
import { evaluateAQI, getCNEvaluation, getUSEvaluation, convertIAQIToConcentration, calculateCNIAQI } from '../aqi-calculator';
import { findCity } from '../constants/cities';

const WAQI_TOKEN = process.env.NEXT_PUBLIC_WAQI_TOKEN || '50b0c272a11f35667dd0ef7de354d76e9560ac48';

export async function fetchWAQICityData(cityIdentifier: string): Promise<AirQualityRecord> {
  const cityMeta = findCity(cityIdentifier);
  const targetSlug = cityMeta?.waqiSlug || cityIdentifier;

  const url = `https://api.waqi.info/feed/${encodeURIComponent(targetSlug)}/?token=${WAQI_TOKEN}`;

  try {
    const res = await fetch(url, { next: { revalidate: 600 } }); // 缓存10分钟
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

export async function fetchWAQIGeoData(lat: number, lng: number): Promise<AirQualityRecord> {
  const url = `https://api.waqi.info/feed/geo:${lat};${lng}/?token=${WAQI_TOKEN}`;

  try {
    const res = await fetch(url, { next: { revalidate: 600 } });
    if (!res.ok) throw new Error(`WAQI HTTP status ${res.status}`);
    const json = await res.json();
    if (json.status !== 'ok' || !json.data) throw new Error('该坐标附近暂无有效 WAQI 测站');

    return parseWAQIResponse(json.data);
  } catch (err: any) {
    console.warn(`[WAQI] Geo fetch failed for ${lat},${lng}:`, err?.message || err);
    throw new Error(err?.message || `该坐标附近暂无有效 WAQI 测站`);
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
    const res = await fetch(url);
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

  let evaluationCN = evaluateAQI(pollutants, 'CN');
  let evaluationUS = evaluateAQI(pollutants, 'US');

  // 若 WAQI 官方直接指定了总体 AQI（注意：WAQI 全球站点统一基于美标 US EPA NowCast 体系发布）
  if (typeof data.aqi === 'number' && !isNaN(data.aqi)) {
    const officialAqi = Math.round(data.aqi);
    evaluationUS = getUSEvaluation(officialAqi, evaluationUS.primaryPollutant);
  }

  return {
    id: cityMeta?.id || `station-${data.idx || 'unknown'}`,
    name: cityMeta?.nameZh || data.city?.name || '未知监测点',
    nameEn: cityMeta?.nameEn || data.city?.name || 'Unknown Location',
    country: cityMeta?.country || (isDomestic ? 'CN' : 'GLOBAL'),
    isDomestic,
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



