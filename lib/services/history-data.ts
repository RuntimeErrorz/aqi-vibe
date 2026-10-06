import { AnnualTrend, DailyStat } from '../types';

// 城市历史蓝天治理基线 (2014-2025 年均 PM2.5 真实演进数据)
const HISTORICAL_BASELINES: Record<string, number[]> = {
  // 格式：[2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025]
  'cn-beijing': [85.9, 80.6, 73.0, 58.0, 51.0, 42.0, 38.0, 33.0, 30.0, 32.0, 30.5, 28.2],
  'cn-shanghai': [52.0, 53.0, 45.0, 39.0, 36.0, 35.0, 32.0, 27.0, 25.0, 28.0, 26.0, 24.5],
  'cn-guangzhou': [49.0, 39.0, 36.0, 35.0, 35.0, 30.0, 23.0, 24.0, 22.0, 23.0, 21.0, 19.8],
  'cn-chengdu': [78.0, 64.0, 63.0, 56.0, 53.0, 43.0, 41.0, 39.8, 38.5, 37.0, 35.2, 33.0],
  'gl-london': [16.2, 15.0, 14.5, 13.8, 13.0, 12.2, 10.5, 10.8, 9.8, 9.5, 9.2, 8.8],
  'gl-newyork': [10.5, 10.2, 9.8, 9.2, 8.8, 8.5, 7.8, 8.2, 8.9, 9.1, 8.4, 8.0],
  'gl-tokyo': [15.8, 14.9, 14.0, 13.2, 12.5, 11.8, 10.2, 10.0, 9.5, 9.4, 9.0, 8.6],
  'gl-delhi': [155.0, 148.0, 142.0, 135.0, 128.0, 115.0, 98.0, 106.0, 99.5, 102.0, 98.0, 95.0],
};

export function getAnnualTrends(cityId: string): AnnualTrend[] {
  const years = [2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];
  const baseline = HISTORICAL_BASELINES[cityId] || [65, 60, 56, 48, 44, 38, 34, 30, 28, 29, 27, 25];

  return years.map((year, idx) => {
    const pm25 = baseline[idx] ?? 30;
    const pm10 = +(pm25 * 1.65).toFixed(1);
    // 优良天数比例随治理改善逐年攀升
    const goodRatio = Math.min(96, Math.max(45, Math.round(100 - pm25 * 0.75 + (year - 2014) * 1.2)));
    const heavyDays = Math.max(0, Math.round((pm25 / 85) * (year <= 2016 ? 45 : (2025 - year) * 3)));

    return {
      year,
      pm25Avg: pm25,
      pm10Avg: pm10,
      goodDaysRatio: goodRatio,
      heavyPollutionDays: heavyDays,
    };
  });
}

export function get365CalendarHeatmap(cityId: string, year = 2025): [string, number, string, number][] {
  const result: [string, number, string, number][] = [];
  const basePM25 = (HISTORICAL_BASELINES[cityId] || [30])[11] || 30;

  const startDate = new Date(year, 0, 1);
  const totalDays = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365;

  for (let i = 0; i < totalDays; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    const month = d.getMonth() + 1; // 1 - 12
    const dateStr = d.toISOString().split('T')[0];

    // 季节性模拟：
    // 冬季 (11-2月): 采暖季逆温层，PM2.5 高
    // 春季 (3-4月): 沙尘波动，PM10 高
    // 夏季 (6-8月): PM2.5 最优，但午后 O3 易高
    // 秋季 (9-10月): 秋高气爽最优良
    let seasonFactor = 1.0;
    if (month === 12 || month === 1 || month === 2) seasonFactor = 1.55;
    else if (month === 3 || month === 4) seasonFactor = 1.15;
    else if (month === 7 || month === 8) seasonFactor = 0.75;
    else if (month === 9 || month === 10) seasonFactor = 0.65;

    // 添加气象随机噪声（冷空气过程与静稳天气周期）
    const noise = Math.sin(i / 3.5) * 0.35 + (Math.random() - 0.45) * 0.4;
    const dailyPM25 = Math.max(5, Math.round(basePM25 * (seasonFactor + noise)));
    
    // 粗略折算 AQI
    let aqi = Math.round(dailyPM25 * 1.3);
    if (dailyPM25 <= 35) aqi = Math.round((50 / 35) * dailyPM25);
    else if (dailyPM25 <= 75) aqi = 50 + Math.round((50 / 40) * (dailyPM25 - 35));
    else if (dailyPM25 <= 115) aqi = 100 + Math.round((50 / 40) * (dailyPM25 - 75));
    else aqi = 150 + Math.round((50 / 35) * (dailyPM25 - 115));

    let level = '优';
    if (aqi > 300) level = '严重污染';
    else if (aqi > 200) level = '重度污染';
    else if (aqi > 150) level = '中度污染';
    else if (aqi > 100) level = '轻度污染';
    else if (aqi > 50) level = '良';

    result.push([dateStr, aqi, level, dailyPM25]);
  }

  return result;
}

export function get24HourTrend(currentAQI = 65, currentPM25 = 32): { hour: string; aqi: number; pm25: number; o3: number }[] {
  const points = [];
  const now = new Date();

  for (let i = 23; i >= 0; i--) {
    const h = new Date(now.getTime() - i * 3600 * 1000);
    const hourLabel = `${h.getHours().toString().padStart(2, '0')}:00`;
    const hourVal = h.getHours();

    // 日变化规律：夜间清晨积聚、午后扩散好但光化学臭氧升高
    let cycle = 1.0;
    if (hourVal >= 6 && hourVal <= 9) cycle = 1.25; // 早高峰
    else if (hourVal >= 13 && hourVal <= 16) cycle = 0.85; // 午后对流
    else if (hourVal >= 20 && hourVal <= 23) cycle = 1.2; // 晚高峰逆温

    const jitter = (Math.random() - 0.5) * 0.15;
    const hourAQI = Math.max(10, Math.round(currentAQI * (cycle + jitter)));
    const hourPM25 = Math.max(5, Math.round(currentPM25 * (cycle + jitter)));
    // 臭氧午后最高
    const hourO3 = Math.round(20 + (hourVal >= 12 && hourVal <= 17 ? 60 : 15) + (Math.random() * 15));

    points.push({
      hour: hourLabel,
      aqi: hourAQI,
      pm25: hourPM25,
      o3: hourO3,
    });
  }

  return points;
}
