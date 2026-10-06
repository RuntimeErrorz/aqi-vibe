import { AirQualityRecord, PollutantValues, IAQIValues } from '../types';
import { evaluateAQI } from '../aqi-calculator';
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

function parseWAQIResponse(data: any, cityMeta?: any): AirQualityRecord {
  const iaqiRaw = data.iaqi || {};
  
  const pollutants: PollutantValues = {
    pm25: iaqiRaw.pm25?.v,
    pm10: iaqiRaw.pm10?.v,
    o3: iaqiRaw.o3?.v,
    no2: iaqiRaw.no2?.v,
    so2: iaqiRaw.so2?.v,
    co: iaqiRaw.co?.v,
  };

  const iaqi: IAQIValues = {
    pm25: iaqiRaw.pm25?.v ? Math.round(iaqiRaw.pm25.v) : undefined,
    pm10: iaqiRaw.pm10?.v ? Math.round(iaqiRaw.pm10.v) : undefined,
    o3: iaqiRaw.o3?.v ? Math.round(iaqiRaw.o3.v) : undefined,
    no2: iaqiRaw.no2?.v ? Math.round(iaqiRaw.no2.v) : undefined,
    so2: iaqiRaw.so2?.v ? Math.round(iaqiRaw.so2.v) : undefined,
    co: iaqiRaw.co?.v ? Math.round(iaqiRaw.co.v) : undefined,
  };

  const evaluationCN = evaluateAQI(pollutants, 'CN');
  const evaluationUS = evaluateAQI(pollutants, 'US');

  // 如果 WAQI 直接有 aqi 并且是有效数值，作为美标参考
  if (typeof data.aqi === 'number' && !isNaN(data.aqi)) {
    evaluationUS.aqi = data.aqi;
  }

  const geo = data.city?.geo || (cityMeta ? [cityMeta.latitude, cityMeta.longitude] : [39.9, 116.4]);
  const isDomestic = cityMeta ? cityMeta.isDomestic : (data.city?.name?.includes('China') || false);

  return {
    id: cityMeta?.id || `station-${data.idx || 'unknown'}`,
    name: cityMeta?.nameZh || data.city?.name || '未知监测点',
    nameEn: cityMeta?.nameEn || data.city?.name || 'Unknown Location',
    country: cityMeta?.country || (isDomestic ? 'CN' : 'GLOBAL'),
    isDomestic,
    latitude: geo[0] || 0,
    longitude: geo[1] || 0,
    updateTime: data.time?.s || new Date().toLocaleString(),
    pollutants,
    iaqi,
    evaluationCN,
    evaluationUS,
    weather: {
      temp: iaqiRaw.t?.v,
      humidity: iaqiRaw.h?.v,
      windSpeed: iaqiRaw.w?.v,
      pressure: iaqiRaw.p?.v,
    },
    forecast: data.forecast?.daily ? {
      pm25: data.forecast.daily.pm25 || [],
      pm10: data.forecast.daily.pm10 || [],
      o3: data.forecast.daily.o3 || [],
      uvi: data.forecast.daily.uvi || [],
    } : undefined,
    sourceAttribution: data.attributions || [
      { name: 'World Air Quality Index Project', url: 'https://waqi.info/' }
    ],
  };
}
