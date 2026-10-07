import { AnnualTrend, StandardType, ForecastDay, CalendarHeatmapDay } from '../types';
import { evaluateAQI } from '../aqi-calculator';
import historySummary from '@/data/processed/history_summary.json';
import { CITIES_REGISTRY } from '@/lib/constants/cities';
import { getCountryInfo } from '@/lib/constants/countries';

// 客户端逐日数据内存缓存（按需加载并保持极速响应）
const clientDailyCache: Record<string, Record<string, any>> = {};

/**
 * 获取城市的年际长期演进趋势
 * 严格由逐日真实历史实测记录在对应标准下按年聚合得出，无任何人工伪造数据。
 */
export function getAnnualTrends(cityId: string, standard: StandardType = 'CN'): AnnualTrend[] {
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
  standard: StandardType = 'CN',
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

function getDiurnalFactor(hour: number): number {
  if (hour >= 6 && hour <= 9) return 1.2;    // 早高峰积累
  if (hour >= 13 && hour <= 16) return 0.85; // 午后扩散条件较好
  if (hour >= 20 && hour <= 23) return 1.15; // 晚高峰与夜间逆温
  return 1.0;
}

function getO3Factor(hour: number): number {
  if (hour >= 12 && hour <= 17) return 1.5;  // 强光照光化学生成高峰
  if (hour >= 10 && hour <= 19) return 1.2;  // 日间光照时段
  if (hour >= 0 && hour <= 6) return 0.6;    // 夜间无光照消耗
  return 0.8;
}

/**
 * 24 小时日内变化典型规律
 * 严格以当前实时实测值为基准锚点（终点 100% 吻合实测），历史 23 小时按日内规律相对反推闭合
 */
export function get24HourTrend(
  currentAQI = 65,
  currentPM25 = 32,
  currentO3 = 40,
  updateTime?: string
): { hour: string; aqi: number; pm25: number; o3: number }[] {
  const points = [];
  let now = new Date();
  if (updateTime) {
    const parsed = new Date(updateTime.replace(/-/g, '/'));
    if (!isNaN(parsed.getTime())) {
      now = parsed;
    }
  }

  const nowHour = now.getHours();
  const baseFactor = getDiurnalFactor(nowHour);
  const baseO3Factor = getO3Factor(nowHour);

  for (let i = 23; i >= 0; i--) {
    const h = new Date(now.getTime() - i * 3600 * 1000);
    const hourLabel = `${h.getHours().toString().padStart(2, '0')}:00`;
    const hourVal = h.getHours();

    let hourAQI: number;
    let hourPM25: number;
    let hourO3: number;

    if (i === 0) {
      // 关键修复：当前时刻必须 100% 严格锚定实测实时数据，与卡片绝对一致
      hourAQI = currentAQI;
      hourPM25 = currentPM25;
      hourO3 = currentO3;
    } else {
      // 历史时刻按日内规律相对演化，确保终点平滑闭合
      const relCycle = getDiurnalFactor(hourVal) / baseFactor;
      hourAQI = Math.max(1, Math.round(currentAQI * relCycle));
      hourPM25 = Math.max(1, Math.round(currentPM25 * relCycle));

      const relO3 = getO3Factor(hourVal) / baseO3Factor;
      hourO3 = Math.max(1, Math.round(currentO3 * relO3));
    }

    points.push({
      hour: hourLabel,
      aqi: hourAQI,
      pm25: hourPM25,
      o3: hourO3,
    });
  }

  return points;
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
 * 优先从 Open-Meteo Air Quality 接口异步拉取过去 24 小时真正的逐小时历史实测/再分析数据
 * 若拉取成功，返回真小时流水并根据用户标准 (CN/US) 换算 AQI；
 * 若拉取失败或超时，自动兜底调用 get24HourTrend（终点依然 100% 锚定实测）。
 */
export async function fetch24HourHourlyTrend(
  lat: number,
  lng: number,
  standard: StandardType = 'CN',
  currentAQI = 65,
  currentPM25 = 32,
  currentO3 = 40,
  updateTime?: string
): Promise<HourlyTrendResult> {
  try {
    const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lng}&hourly=pm2_5,pm10,ozone,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,us_aqi&past_days=1&forecast_days=7&timezone=auto`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4500) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const hourly = data?.hourly;
    if (!hourly || !Array.isArray(hourly.time) || hourly.time.length === 0) {
      throw new Error('Invalid hourly payload');
    }

    const times: string[] = hourly.time;
    const pm25Arr: (number | null)[] = hourly.pm2_5 || [];
    const pm10Arr: (number | null)[] = hourly.pm10 || [];
    const o3Arr: (number | null)[] = hourly.ozone || [];
    const no2Arr: (number | null)[] = hourly.nitrogen_dioxide || [];
    const so2Arr: (number | null)[] = hourly.sulphur_dioxide || [];
    const coArr: (number | null)[] = hourly.carbon_monoxide || [];
    const usAqiArr: (number | null)[] = hourly.us_aqi || [];

    const now = new Date();
    const validIndices: number[] = [];
    for (let i = 0; i < times.length; i++) {
      const t = new Date(times[i]);
      if (t <= now) {
        validIndices.push(i);
      }
    }

    const sliceIndices = validIndices.slice(-24);
    if (sliceIndices.length < 12) {
      throw new Error('Not enough hourly records');
    }

    // 获取数值模型在最新时刻的基准值，用于进行“地面测站实测同化偏差校正 (Bias Calibration)”
    const latestIdx = sliceIndices[sliceIndices.length - 1];
    const latestModelP25 = Math.max(1, pm25Arr[latestIdx] ?? 50);
    const latestModelO3 = Math.max(1, o3Arr[latestIdx] ?? 40);

    let latestModelAqi = 100;
    if (standard === 'CN') {
      latestModelAqi = evaluateAQI({ pm25: latestModelP25 }, 'CN').aqi;
    } else {
      latestModelAqi = (usAqiArr[latestIdx] != null && !isNaN(usAqiArr[latestIdx]!)) ? usAqiArr[latestIdx]! : 100;
    }
    latestModelAqi = Math.max(1, latestModelAqi);

    // 计算地面实测与大网格模型的同化比例因子（消除模型大区域系统性偏差，彻底解决断崖跳水）
    const aqiScale = currentAQI > 0 ? (currentAQI / latestModelAqi) : 1.0;
    const pm25Scale = currentPM25 > 0 ? (currentPM25 / latestModelP25) : 1.0;
    const o3Scale = currentO3 > 0 ? (currentO3 / latestModelO3) : 1.0;

    const points: HourlyTrendPoint[] = sliceIndices.map((idx, pos) => {
      const isLatest = pos === sliceIndices.length - 1;
      const timeStr = times[idx];
      const hourLabel = timeStr.includes('T') ? timeStr.split('T')[1].slice(0, 5) : timeStr.slice(-5);

      const p25 = pm25Arr[idx] ?? 0;
      const p10 = pm10Arr[idx] ?? 0;
      const ozone = o3Arr[idx] ?? 0;
      const n2 = no2Arr[idx] ?? 0;
      const s2 = so2Arr[idx] ?? 0;
      const coVal = coArr[idx] != null ? Math.round((coArr[idx]! / 1000) * 10) / 10 : 0.5;

      let aqiVal: number;
      if (standard === 'CN') {
        const evalRes = evaluateAQI(
          {
            pm25: p25 > 0 ? p25 : undefined,
            pm10: p10 > 0 ? p10 : undefined,
            o3: ozone > 0 ? ozone : undefined,
            no2: n2 > 0 ? n2 : undefined,
            so2: s2 > 0 ? s2 : undefined,
            co: coVal > 0 ? coVal : undefined,
          },
          'CN'
        );
        aqiVal = evalRes.aqi;
      } else {
        aqiVal = (usAqiArr[idx] != null && !isNaN(usAqiArr[idx]!))
          ? usAqiArr[idx]!
          : evaluateAQI({ pm25: p25 > 0 ? p25 : undefined }, 'US').aqi;
      }

      if (isLatest) {
        return {
          hour: hourLabel,
          aqi: currentAQI > 0 ? currentAQI : Math.round(aqiVal),
          pm25: currentPM25 > 0 ? currentPM25 : Math.round(p25),
          o3: currentO3 > 0 ? currentO3 : Math.round(ozone),
          isReal: true,
        };
      }

      // 地面实测同化校正：保留真实日内相对演化形态，同时彻底消除模型与地面测站断崖偏差
      const calibratedAqi = Math.max(1, Math.round(aqiVal * aqiScale));
      const calibratedPm25 = Math.max(1, Math.round(p25 * pm25Scale));
      const calibratedO3 = Math.max(1, Math.round(ozone * o3Scale));

      return {
        hour: hourLabel,
        aqi: calibratedAqi,
        pm25: calibratedPm25,
        o3: calibratedO3,
        isReal: true,
      };
    });

    // 汇总未来 5 天日均预报数据（基于本地日期精确提取今日及未来天数）
    const forecastMap: Record<string, number[]> = {};
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const todayStr = `${y}-${m}-${d}`;

    for (let i = 0; i < times.length; i++) {
      const dayStr = times[i].slice(0, 10);
      if (dayStr >= todayStr && pm25Arr[i] != null && !isNaN(pm25Arr[i]!)) {
        if (!forecastMap[dayStr]) forecastMap[dayStr] = [];
        forecastMap[dayStr].push(pm25Arr[i]!);
      }
    }
    const forecast: ForecastDay[] = Object.entries(forecastMap).slice(0, 5).map(([day, vals]) => {
      const min = Math.round(Math.min(...vals));
      const max = Math.round(Math.max(...vals));
      const avg = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
      return { day, min, max, avg };
    });

    return {
      points,
      isReal: true,
      source: 'CAMS / Open-Meteo 真实逐小时再分析与实测',
      forecast,
    };
  } catch (err) {
    const fallbackPoints = get24HourTrend(currentAQI, currentPM25, currentO3, updateTime);
    return {
      points: fallbackPoints.map((p) => ({ ...p, isReal: false })),
      isReal: false,
      source: '典型日内规律平滑反推（端点实测严格锚定）',
    };
  }
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
export function getAllCitiesRanking(year = 2025, standard: StandardType = 'CN'): CityRankingItem[] {
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
export function getAllCountriesRanking(year = 2025, standard: StandardType = 'CN'): CountryRankingItem[] {
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
