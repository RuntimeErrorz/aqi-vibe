import { AnnualTrend, StandardType, CalendarHeatmapDay } from '../types';
import { evaluateAQI, calculatePM25AQI } from '../aqi-calculator';
import { CITIES_REGISTRY } from '@/lib/constants/cities';
import { getCountryInfo } from '@/lib/constants/countries';

// 重新导出实时趋势与预报接口，保持向后兼容（首页和地图页应直接导入 realtime-trend 避免加载历史逻辑）
export {
  fetch24HourHourlyTrend,
  fetch5DayForecast,
  type HourlyTrendPoint,
  type HourlyTrendResult,
} from './realtime-trend';

// 运行时异步加载的 history_summary.json 内存单例缓存（彻底避免将 1.8MB 静态打入客户端 JS 包！）
let summaryCache: Record<string, any[]> | null = null;
let summaryPromise: Promise<Record<string, any[]>> | null = null;

// 客户端逐日数据内存缓存（按需加载并保持极速响应）
const clientDailyCache: Record<string, Record<string, any>> = {};

function getSummarySync(): Record<string, any[]> {
  if (summaryCache) return summaryCache;
  // Node.js 服务端/测试环境直接同步读取本地文件
  if (typeof window === 'undefined') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const fs = require('fs');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const path = require('path');
      const candidates = [
        path.join(process.cwd(), 'public', 'data', 'history_summary.json'),
        path.join(process.cwd(), 'data', 'processed', 'history_summary.json'),
      ];
      for (const p of candidates) {
        if (fs.existsSync(p)) {
          summaryCache = JSON.parse(fs.readFileSync(p, 'utf-8'));
          return summaryCache!;
        }
      }
    } catch {
      // ignore
    }
  }
  return {};
}

/**
 * 异步加载全局历史年度汇总索引 (/data/history_summary.json)，客户端单次按需请求并常驻内存
 */
export async function loadHistorySummary(): Promise<Record<string, any[]>> {
  if (summaryCache) return summaryCache;
  if (typeof window === 'undefined') {
    return getSummarySync();
  }
  if (!summaryPromise) {
    summaryPromise = fetch('/data/history_summary.json')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: Record<string, any[]>) => {
        summaryCache = data || {};
        return summaryCache;
      })
      .catch((err) => {
        console.warn('[HistoryData] Failed to load history_summary.json:', err);
        summaryPromise = null;
        return {};
      });
  }
  return summaryPromise;
}

export function isHistorySummaryLoaded(): boolean {
  return summaryCache !== null;
}

/**
 * 获取城市的年际长期演进趋势
 * 严格由逐日真实历史实测记录在对应标准（国标 HJ 633-2012 日均 / 美标 US EPA 2024）下按年聚合得出。
 */
export function getAnnualTrends(cityId: string, standard: StandardType = 'US', onlyPm25 = false): AnnualTrend[] {
  const summaryMap = getSummarySync();
  const cityTrends = summaryMap[cityId];
  if (!cityTrends || !Array.isArray(cityTrends)) {
    return [];
  }

  return cityTrends
    .filter((t) => t.daysCount >= 30)
    .map((t) => {
      const goodDaysRatio = onlyPm25
        ? (standard === 'CN'
            ? (t.goodDaysRatioPm25CN ?? t.goodDaysRatioCN)
            : (t.goodDaysRatioPm25US ?? t.goodDaysRatioUS))
        : (standard === 'CN' ? t.goodDaysRatioCN : t.goodDaysRatioUS);

      const pollutedDays = onlyPm25
        ? (standard === 'CN'
            ? (t.pollutedDaysPm25CN ?? t.pollutedDaysCN ?? Math.max(0, t.daysCount - Math.round((goodDaysRatio * t.daysCount) / 100)))
            : (t.pollutedDaysPm25US ?? t.pollutedDaysUS ?? Math.max(0, t.daysCount - Math.round((goodDaysRatio * t.daysCount) / 100))))
        : (standard === 'CN'
            ? (t.pollutedDaysCN ?? Math.max(0, t.daysCount - Math.round((t.goodDaysRatioCN * t.daysCount) / 100)))
            : (t.pollutedDaysUS ?? Math.max(0, t.daysCount - Math.round((t.goodDaysRatioUS * t.daysCount) / 100))));

      return {
        year: t.year,
        pm25Avg: t.pm25Avg,
        pm10Avg: t.pm10Avg,
        goodDaysRatio,
        pollutedDays,
        heavyPollutionDays: standard === 'CN' ? t.heavyPollutionDaysCN : t.heavyPollutionDaysUS,
        aqiAvg: onlyPm25
          ? (t.pm25Avg > 0 ? calculatePM25AQI(t.pm25Avg, standard) : 0)
          : (standard === 'CN' ? t.aqiAvgCN : t.aqiAvgUS),
        daysCount: t.daysCount,
      };
    });
}

/**
 * 校验该城市是否具备官方实测长期历史归档数据
 */
export function hasCityHistory(cityId: string): boolean {
  const summaryMap = getSummarySync();
  const cityTrends = summaryMap[cityId];
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
  return trends.map((t) => t.year).reverse();
}

/**
 * 客户端按需异步拉取城市完整逐日实测数据集
 */
export async function fetchCityDailyHistory(cityId: string): Promise<Record<string, any>> {
  if (clientDailyCache[cityId]) {
    return clientDailyCache[cityId];
  }

  // 若 summary 尚未加载，先尝试加载；若 summary 加载成功且明确无该城记录才提前返回
  if (!summaryCache) {
    await loadHistorySummary();
  }

  if (summaryCache && !hasCityHistory(cityId)) {
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
  pm25: number | null;
  pm10: number | null;
  o3: number | null;
  no2: number | null;
  so2: number | null;
  co: number | null;
  validDays: number;
}

/**
 * 从城市逐日实测字典中精确聚合指定年份的 6 大主要污染物实测年均值
 * 严格遵循反伪造原则：缺失的污染物返回 null，绝不按系数伪造！
 */
export function aggregateYearlyPollutants(
  daily: Record<string, any> | undefined,
  year: number
): CityYearPollutants | null {
  if (!daily || typeof daily !== 'object') return null;
  const prefix = `${year}-`;
  const days = Object.keys(daily).filter((k) => k.startsWith(prefix));
  if (days.length === 0) return null;

  const calcAvg = (key: string): number | null => {
    const vals = days
      .map((d) => daily[d]?.[key])
      .filter((v) => v !== undefined && v !== null && !isNaN(v) && v > 0);
    return vals.length ? Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1)) : null;
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

export interface MonthlySeasonalStat {
  month: number; // 1..12
  label: string;
  pm25Avg: number | null;
  o3Avg: number | null;
  aqiAvg: number | null;
  daysCount: number;
}

/**
 * 从真实逐日实测字典聚合 1~12 月季节律动均值（支持单年或全历史多年聚合）
 */
export function aggregateMonthlySeasonality(
  daily: Record<string, any> | undefined,
  standard: StandardType = 'US',
  onlyPm25 = false,
  year?: number
): MonthlySeasonalStat[] {
  const buckets = Array.from({ length: 12 }, (_, idx) => ({
    month: idx + 1,
    pm25: [] as number[],
    o3: [] as number[],
    aqi: [] as number[],
    daysCount: 0,
  }));

  if (daily && typeof daily === 'object') {
    const prefix = year ? `${year}-` : null;
    for (const [dateStr, rec] of Object.entries(daily)) {
      if (prefix && !dateStr.startsWith(prefix)) continue;
      const monthNum = parseInt(dateStr.slice(5, 7), 10);
      if (isNaN(monthNum) || monthNum < 1 || monthNum > 12) continue;
      const b = buckets[monthNum - 1];
      b.daysCount++;
      const toPosNum = (v: unknown): number | undefined => {
        if (v === undefined || v === null) return undefined;
        const n = Number(v);
        return Number.isFinite(n) && n > 0 ? n : undefined;
      };
      const pm25 = toPosNum(rec?.pm25);
      const o3 = toPosNum(rec?.o3);
      if (pm25 !== undefined) b.pm25.push(pm25);
      if (o3 !== undefined) b.o3.push(o3);

      const evalRes = evaluateAQI(
        {
          pm25,
          pm10: toPosNum(rec?.pm10),
          o3,
          no2: toPosNum(rec?.no2),
          so2: toPosNum(rec?.so2),
          co: toPosNum(rec?.co),
        },
        standard,
        onlyPm25,
        'daily'
      );
      if (evalRes.aqi > 0) b.aqi.push(evalRes.aqi);
    }
  }

  return buckets.map((b) => ({
    month: b.month,
    label: `${b.month}月`,
    pm25Avg: b.pm25.length ? Number((b.pm25.reduce((a, c) => a + c, 0) / b.pm25.length).toFixed(1)) : null,
    o3Avg: b.o3.length ? Number((b.o3.reduce((a, c) => a + c, 0) / b.o3.length).toFixed(1)) : null,
    aqiAvg: b.aqi.length ? Math.round(b.aqi.reduce((a, c) => a + c, 0) / b.aqi.length) : null,
    daysCount: b.daysCount,
  }));
}

/**
 * 获取特定城市某一年的真实 365 天日历热力数据
 * 严格使用日均断点评价 (period = 'daily')，无任何伪随机或波形兜底。
 */
export function get365CalendarHeatmap(
  cityId: string,
  year = 2025,
  standard: StandardType = 'US',
  dailyRecords?: Record<string, any>,
  onlyPm25 = false
): CalendarHeatmapDay[] {
  let records = dailyRecords || clientDailyCache[cityId];

  if (!records && typeof window === 'undefined') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const fs = require('fs');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
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

    const evalResult = evaluateAQI(pollutants, standard, onlyPm25, 'daily');
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

  result.sort((a, b) => a.date.localeCompare(b.date));
  return result;
}

export interface CityRankingItem {
  id: string;
  nameZh: string;
  nameEn: string;
  country: string;
  countryZh: string;
  countryFlag: string;
  province?: string;
  population?: number;
  isDomestic: boolean;
  year: number;
  pm25Avg: number;
  pm10Avg: number;
  aqiAvg: number;
  goodDaysRatio: number;
  heavyPollutionDays: number;
  daysCount: number;
  improvementRate: number | null;
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
export function getAllCitiesRanking(
  year = 2025,
  standard: StandardType = 'US',
  onlyPm25 = false
): CityRankingItem[] {
  const summaryMap = getSummarySync();
  const list: CityRankingItem[] = [];

  for (const city of CITIES_REGISTRY) {
    const yearsArr = summaryMap[city.id];
    if (!yearsArr || !Array.isArray(yearsArr) || yearsArr.length === 0) continue;

    const yearObj = yearsArr.find((y) => y.year === year);
    if (!yearObj || yearObj.daysCount < 15) continue;

    const countryMeta = getCountryInfo(city.country);
    const earliestObj = yearsArr.reduce((min, cur) => (cur.year < min.year ? cur : min), yearsArr[0]);
    let improvementRate: number | null = null;
    if (earliestObj && earliestObj.year < year && earliestObj.pm25Avg > 0) {
      improvementRate = Number((((yearObj.pm25Avg - earliestObj.pm25Avg) / earliestObj.pm25Avg) * 100).toFixed(1));
    }

    const calculatedAqi = onlyPm25
      ? (yearObj.pm25Avg > 0 ? calculatePM25AQI(yearObj.pm25Avg, standard) : 0)
      : (standard === 'CN' ? yearObj.aqiAvgCN : yearObj.aqiAvgUS);

    if (!calculatedAqi || calculatedAqi <= 0) continue;
    if (onlyPm25 && (!yearObj.pm25Avg || yearObj.pm25Avg <= 0)) continue;

    const goodDaysRatio = onlyPm25
      ? (standard === 'CN'
          ? (yearObj.goodDaysRatioPm25CN ?? yearObj.goodDaysRatioCN)
          : (yearObj.goodDaysRatioPm25US ?? yearObj.goodDaysRatioUS))
      : (standard === 'CN' ? yearObj.goodDaysRatioCN : yearObj.goodDaysRatioUS);

    list.push({
      id: city.id,
      nameZh: city.nameZh,
      nameEn: city.nameEn,
      country: city.country,
      countryZh: countryMeta.nameZh,
      countryFlag: countryMeta.flag,
      province: city.province,
      population: city.population,
      isDomestic: city.isDomestic,
      year: yearObj.year,
      pm25Avg: yearObj.pm25Avg,
      pm10Avg: yearObj.pm10Avg,
      aqiAvg: calculatedAqi,
      goodDaysRatio,
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
export function getAllCountriesRanking(
  year = 2025,
  standard: StandardType = 'US',
  onlyPm25 = false
): CountryRankingItem[] {
  const cities = getAllCitiesRanking(year, standard, onlyPm25);
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
    if (aqiSum <= 0) return;
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
