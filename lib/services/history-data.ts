import { AnnualTrend, StandardType } from '../types';
import { evaluateAQI } from '../aqi-calculator';
import historySummary from '@/data/processed/history_summary.json';

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
      heavyPollutionDays: standard === 'CN' ? t.heavyPollutionDaysCN : t.heavyPollutionDaysUS,
      aqiAvg: standard === 'CN' ? t.aqiAvgCN : t.aqiAvgUS,
    }));
}

/**
 * 获取该城市具备真实历史归档的全部年份列表
 */
export function getCityAvailableYears(cityId: string): number[] {
  const trends = getAnnualTrends(cityId);
  if (trends.length === 0) {
    return [2025, 2024, 2023, 2022, 2021, 2020, 2019];
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
): [string, number, string, number, string][] {
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

  const result: [string, number, string, number, string][] = [];
  const yearPrefix = `${year}-`;

  for (const [dateStr, rec] of Object.entries(records)) {
    if (!dateStr.startsWith(yearPrefix)) continue;

    const pollutants = {
      pm25: rec.pm25 ?? undefined,
      pm10: rec.pm10 ?? undefined,
      o3: rec.o3 ?? undefined,
      no2: rec.no2 ?? undefined,
      so2: rec.so2 ?? undefined,
      co: rec.co ?? undefined,
    };

    const evalResult = evaluateAQI(pollutants, standard);
    result.push([dateStr, evalResult.aqi, evalResult.level, pollutants.pm25 ?? 0, evalResult.color]);
  }

  // 严格按日期升序排列
  result.sort((a, b) => a[0].localeCompare(b[0]));
  return result;
}

/**
 * 24 小时日内变化典型规律
 */
export function get24HourTrend(
  currentAQI = 65,
  currentPM25 = 32
): { hour: string; aqi: number; pm25: number; o3: number }[] {
  const points = [];
  const now = new Date();

  for (let i = 23; i >= 0; i--) {
    const h = new Date(now.getTime() - i * 3600 * 1000);
    const hourLabel = `${h.getHours().toString().padStart(2, '0')}:00`;
    const hourVal = h.getHours();

    let cycle = 1.0;
    if (hourVal >= 6 && hourVal <= 9) cycle = 1.2;
    else if (hourVal >= 13 && hourVal <= 16) cycle = 0.85;
    else if (hourVal >= 20 && hourVal <= 23) cycle = 1.15;

    const hourAQI = Math.max(1, Math.round(currentAQI * cycle));
    const hourPM25 = Math.max(1, Math.round(currentPM25 * cycle));
    const hourO3 = Math.round(20 + (hourVal >= 12 && hourVal <= 17 ? 55 : 15));

    points.push({
      hour: hourLabel,
      aqi: hourAQI,
      pm25: hourPM25,
      o3: hourO3,
    });
  }

  return points;
}
