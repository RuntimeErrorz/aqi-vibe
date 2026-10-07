import { AnnualTrend, StandardType, ForecastDay, CalendarHeatmapDay } from '../types';
import { evaluateAQI } from '../aqi-calculator';
import { build24HourPointsFromWaqiObs, fetchWaqiHourlyDirect } from './waqi-decoder';
import historySummary from '@/data/processed/history_summary.json';
import { CITIES_REGISTRY } from '@/lib/constants/cities';
import { getCountryInfo } from '@/lib/constants/countries';

// 客户端逐日数据内存缓存（按需加载并保持极速响应）
const clientDailyCache: Record<string, Record<string, any>> = {};

/**
 * 获取城市的年际长期演进趋势
 * 严格由逐日真实历史实测记录在对应标准下按年聚合得出，无任何人工伪造数据。
 */
export function getAnnualTrends(cityId: string, standard: StandardType = 'US'): AnnualTrend[] {
  const cityTrends = (historySummary as Record<string, any[]>)[cityId];
  if (!cityTrends || !Array.isArray(cityTrends)) {
    return [];
  }

  // 过滤少于 30 天的残缺年份
  return cityTrends
    .filter((t) => t.daysCount >= 30)
    .map((t) => ({
      year: t.year,
      pm25Avg: t.pm25Avg,
      pm10Avg: t.pm10Avg,
      goodDaysRatio: standard === 'CN' ? t.goodDaysRatioCN : t.goodDaysRatioUS,
      pollutedDays:
        standard === 'CN'
          ? (t.pollutedDaysCN ?? Math.max(0, t.daysCount - Math.round((t.goodDaysRatioCN * t.daysCount) / 100)))
          : (t.pollutedDaysUS ?? Math.max(0, t.daysCount - Math.round((t.goodDaysRatioUS * t.daysCount) / 100))),
      heavyPollutionDays: standard === 'CN' ? t.heavyPollutionDaysCN : t.heavyPollutionDaysUS,
      aqiAvg: standard === 'CN' ? t.aqiAvgCN : t.aqiAvgUS,
      daysCount: t.daysCount,
    }));
}

/**
 * 校验该城市是否具备官方实测长期历史归档数据
 */
export function hasCityHistory(cityId: string): boolean {
  const cityTrends = (historySummary as Record<string, any[]>)[cityId];
  return Array.isArray(cityTrends) && cityTrends.length > 0;
}

/**
 * 获取该城市具备真实历史归档的全部年份列表
 */
export function getCityAvailableYears(cityId: string): number[] {
  const trends = getAnnualTrends(cityId);
  if (trends.length === 0) {
    return [];
  }
  return trends.map((t) => t.year).reverse(); // 降序排列
}

/**
 * 客户端按需异步拉取城市完整逐日实测数据集
 */
export async function fetchCityDailyHistory(cityId: string): Promise<Record<string, any>> {
  if (clientDailyCache[cityId]) {
    return clientDailyCache[cityId];
  }

  // 绝不虚构兜底：若该城市未被收录于历史档案库，直接返回空，避免发起无效网络请求与产生 404
  if (!hasCityHistory(cityId)) {
    return {};
  }

  try {
    const safeId = cityId.replace(/[^a-zA-Z0-9_\-]/g, '_');
    const res = await fetch(`/data/history/${safeId}.json`);
    if (!res.ok) {
      return {};
    }
    const data = await res.json();
    const daily = data.daily || {};
    clientDailyCache[cityId] = daily;
    return daily;
  } catch (err) {
    console.warn(`Failed to fetch history for ${cityId}:`, err);
    return {};
  }
}

export interface CityYearPollutants {
  year: number;
  pm25: number;
  pm10: number;
  o3: number;
  no2: number;
  so2: number;
  co: number;
  validDays: number;
}

/**
 * 从城市逐日实测字典中精确聚合指定年份的 6 大主要污染物实测年均值
 */
export function aggregateYearlyPollutants(
  daily: Record<string, any> | undefined,
  year: number
): CityYearPollutants | null {
  if (!daily || typeof daily !== 'object') return null;
  const prefix = `${year}-`;
  const days = Object.keys(daily).filter((k) => k.startsWith(prefix));
  if (days.length === 0) return null;

  const calcAvg = (key: string): number => {
    const vals = days
      .map((d) => daily[d]?.[key])
      .filter((v) => v !== undefined && v !== null && !isNaN(v) && v > 0);
    return vals.length ? Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1)) : 0;
  };

  return {
    year,
    pm25: calcAvg('pm25'),
    pm10: calcAvg('pm10'),
    o3: calcAvg('o3'),
    no2: calcAvg('no2'),
    so2: calcAvg('so2'),
    co: calcAvg('co'),
    validDays: days.length,
  };
}

/**
 * 获取特定城市某一年的真实 365 天日历热力数据
 * 严格基于 QuotSoft 与 WAQI 真实逐日实测记录，无任何伪随机或波形兜底。
 * @param cityId 城市 ID (如 'gl-newyork', 'cn-beijing')
 * @param year 年份 (如 2024)
 * @param standard 评价标准 (CN 或 US)
 * @param dailyRecords 可选的传入实测逐日字典；未提供时如果在 Node 环境则自动读取文件
 */
export function get365CalendarHeatmap(
  cityId: string,
  year = 2025,
  standard: StandardType = 'US',
  dailyRecords?: Record<string, any>
): CalendarHeatmapDay[] {
  let records = dailyRecords || clientDailyCache[cityId];

  // 服务端 Node.js 环境下 (如 API 路由执行)，自动读取本地静态文件
  if (!records && typeof window === 'undefined') {
    try {
      const fs = require('fs');
      const path = require('path');
      const safeId = cityId.replace(/[^a-zA-Z0-9_\-]/g, '_');
      const filePath = path.join(process.cwd(), 'public', 'data', 'history', `${safeId}.json`);
      if (fs.existsSync(filePath)) {
        const fileContent = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        records = fileContent.daily;
      }
    } catch {
      // ignore
    }
  }

  if (!records) {
    return [];
  }

  const result: CalendarHeatmapDay[] = [];
  const yearPrefix = `${year}-`;

  for (const [dateStr, rec] of Object.entries(records)) {
    if (!dateStr.startsWith(yearPrefix)) continue;

    const pollutants = {
      pm25: rec.pm25 !== undefined && rec.pm25 !== null ? Number(rec.pm25) : undefined,
      pm10: rec.pm10 !== undefined && rec.pm10 !== null ? Number(rec.pm10) : undefined,
      o3: rec.o3 !== undefined && rec.o3 !== null ? Number(rec.o3) : undefined,
      no2: rec.no2 !== undefined && rec.no2 !== null ? Number(rec.no2) : undefined,
      so2: rec.so2 !== undefined && rec.so2 !== null ? Number(rec.so2) : undefined,
      co: rec.co !== undefined && rec.co !== null ? Number(rec.co) : undefined,
    };

    const evalResult = evaluateAQI(pollutants, standard);
    result.push({
      date: dateStr,
      aqi: evalResult.aqi,
      level: evalResult.level,
      color: evalResult.color,
      primaryPollutant: evalResult.primaryPollutant,
      primaryPollutantName: evalResult.primaryPollutantName,
      pm25: pollutants.pm25,
      pm10: pollutants.pm10,
      o3: pollutants.o3,
      no2: pollutants.no2,
      so2: pollutants.so2,
      co: pollutants.co,
    });
  }

  // 严格按日期升序排列
  result.sort((a, b) => a.date.localeCompare(b.date));
  return result;
}

export interface HourlyTrendPoint {
  hour: string;
  aqi: number;
  pm25: number;
  o3: number;
  isReal?: boolean;
}

export interface HourlyTrendResult {
  points: HourlyTrendPoint[];
  isReal: boolean;
  source: string;
  forecast?: ForecastDay[];
}

/**
 * 过去 24 小时逐小时走势分析：
 * 纯真 100% 直连 WAQI 官方底层折线图时序流（反编译差分解码）
 * 彻底移除任何 CAMS / 数值预报兜底与伪造波形，纯粹呈现官方测站逐小时实测。
 */
export async function fetch24HourHourlyTrend(
  lat: number,
  lng: number,
  standard: StandardType = 'US',
  currentAQI = 65,
  currentPM25 = 32,
  currentO3 = 40,
  updateTime?: string,
  stationIdx?: number
): Promise<HourlyTrendResult> {
  if (stationIdx) {
    // 优先 1：直连 WAQI 官方底层双步鉴权与差分解码协议（本地开发与前端直连 100% 秒通）
    try {
      const directPoints = await fetchWaqiHourlyDirect(stationIdx, standard);
      if (directPoints && directPoints.length >= 12) {
        return {
          points: directPoints,
          isReal: true,
          source: 'WAQI 官方测站实时逐小时实测 (反编译差分解码)',
        };
      }
    } catch {
      // 忽略直连网络微抖
    }

    // 优先 2：若部署在边缘环境且直连未中，通过 Cloudflare 边缘缓存专线网关拉取
    try {
      if (typeof window !== 'undefined' && window.location.origin) {
        const edgeRes = await fetch(`${window.location.origin}/api/waqi-hourly?idx=${stationIdx}`, {
          signal: AbortSignal.timeout(3000),
        });
        if (edgeRes.ok) {
          const waqiJson = await edgeRes.json();
          const obs = waqiJson?.rxs?.obs?.[0]?.msg?.obs;
          if (obs && obs.pm25) {
            const edgePoints = build24HourPointsFromWaqiObs(obs, standard);
            if (edgePoints.length >= 12) {
              return {
                points: edgePoints,
                isReal: true,
                source: 'WAQI 官方测站实时逐小时实测 (反编译差分解码)',
              };
            }
          }
        }
      }
    } catch {
      // 边缘网关失败
    }
  }

  // 绝不使用任何 CAMS 或虚构模拟数据兜底，无数据时如实返回空点集
  return {
    points: [],
    isReal: false,
    source: '该站点暂无 WAQI 逐小时实测发布',
  };
}



export interface CityRankingItem {
  id: string;
  nameZh: string;
  nameEn: string;
  country: string;
  countryZh: string;
  countryFlag: string;
  province?: string;
  isDomestic: boolean;
  year: number;
  pm25Avg: number;
  pm10Avg: number;
  aqiAvg: number;
  goodDaysRatio: number;
  heavyPollutionDays: number;
  daysCount: number;
  improvementRate: number | null; // % relative to earliest baseline
  earliestYear: number;
  earliestPm25: number;
}

export interface CountryRankingItem {
  countryCode: string;
  nameZh: string;
  nameEn: string;
  flag: string;
  cityCount: number;
  aqiAvg: number;
  pm25Avg: number;
  pm10Avg: number;
  goodDaysRatioAvg: number;
  cleanestCity: { id: string; nameZh: string; aqiAvg: number; pm25Avg: number };
  worstCity: { id: string; nameZh: string; aqiAvg: number; pm25Avg: number };
}

/**
 * 获取指定年份全球与国内所有城市的统一排名列表
 */
export function getAllCitiesRanking(year = 2025, standard: StandardType = 'US'): CityRankingItem[] {
  const summaryMap = historySummary as Record<string, any[]>;
  const list: CityRankingItem[] = [];

  for (const city of CITIES_REGISTRY) {
    const yearsArr = summaryMap[city.id];
    if (!yearsArr || !Array.isArray(yearsArr) || yearsArr.length === 0) continue;

    const yearObj = yearsArr.find((y) => y.year === year);
    if (!yearObj || yearObj.daysCount < 15) continue;

    const countryMeta = getCountryInfo(city.country);
    const earliestObj = yearsArr[0];
    let improvementRate: number | null = null;
    if (earliestObj && earliestObj.year < year && earliestObj.pm25Avg > 0) {
      improvementRate = Number((((yearObj.pm25Avg - earliestObj.pm25Avg) / earliestObj.pm25Avg) * 100).toFixed(1));
    }

    list.push({
      id: city.id,
      nameZh: city.nameZh,
      nameEn: city.nameEn,
      country: city.country,
      countryZh: countryMeta.nameZh,
      countryFlag: countryMeta.flag,
      province: city.province,
      isDomestic: city.isDomestic,
      year: yearObj.year,
      pm25Avg: yearObj.pm25Avg,
      pm10Avg: yearObj.pm10Avg,
      aqiAvg: standard === 'CN' ? yearObj.aqiAvgCN : yearObj.aqiAvgUS,
      goodDaysRatio: standard === 'CN' ? yearObj.goodDaysRatioCN : yearObj.goodDaysRatioUS,
      heavyPollutionDays: standard === 'CN' ? yearObj.heavyPollutionDaysCN : yearObj.heavyPollutionDaysUS,
      daysCount: yearObj.daysCount,
      improvementRate,
      earliestYear: earliestObj?.year ?? year,
      earliestPm25: earliestObj?.pm25Avg ?? yearObj.pm25Avg,
    });
  }

  return list;
}

/**
 * 聚合获取指定年份全球各国家/地区的综合空气质量排行榜
 */
export function getAllCountriesRanking(year = 2025, standard: StandardType = 'US'): CountryRankingItem[] {
  const cities = getAllCitiesRanking(year, standard);
  const countryGroups = new Map<string, CityRankingItem[]>();

  for (const c of cities) {
    if (!countryGroups.has(c.country)) {
      countryGroups.set(c.country, []);
    }
    countryGroups.get(c.country)!.push(c);
  }

  const result: CountryRankingItem[] = [];

  countryGroups.forEach((cList, cCode) => {
    if (cList.length === 0) return;
    const countryMeta = getCountryInfo(cCode);

    const aqiSum = cList.reduce((acc, c) => acc + c.aqiAvg, 0);
    const pm25Sum = cList.reduce((acc, c) => acc + c.pm25Avg, 0);
    const pm10Sum = cList.reduce((acc, c) => acc + c.pm10Avg, 0);
    const goodDaysSum = cList.reduce((acc, c) => acc + c.goodDaysRatio, 0);

    const sortedByAqi = [...cList].sort((a, b) => a.aqiAvg - b.aqiAvg);
    const cleanest = sortedByAqi[0];
    const worst = sortedByAqi[sortedByAqi.length - 1];

    result.push({
      countryCode: cCode,
      nameZh: countryMeta.nameZh,
      nameEn: countryMeta.nameEn,
      flag: countryMeta.flag,
      cityCount: cList.length,
      aqiAvg: Math.round(aqiSum / cList.length),
      pm25Avg: Number((pm25Sum / cList.length).toFixed(1)),
      pm10Avg: Number((pm10Sum / cList.length).toFixed(1)),
      goodDaysRatioAvg: Math.round(goodDaysSum / cList.length),
      cleanestCity: {
        id: cleanest.id,
        nameZh: cleanest.nameZh,
        aqiAvg: cleanest.aqiAvg,
        pm25Avg: cleanest.pm25Avg,
      },
      worstCity: {
        id: worst.id,
        nameZh: worst.nameZh,
        aqiAvg: worst.aqiAvg,
        pm25Avg: worst.pm25Avg,
      },
    });
  });

  return result;
}
