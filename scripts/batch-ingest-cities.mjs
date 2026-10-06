/**
 * QuotSoft 全国 375+ 城市历史数据批量流式抓取与日度聚合脚本
 * 
 * 核心设计：
 * 1. 忽略繁杂的微观 2026+ 站点，直接抓取全国 375+ 城市综合宽表 (china_cities_YYYYMMDD.csv)
 * 2. 内存流式解析 24 小时 16 项指标，计算城市日均值 (PM2.5, PM10, SO2, NO2, CO, O3_8h, AQI)
 * 3. 产出紧凑、极小体积的 JSON 历史数据集 (data/processed/quotsoft_cities_daily.json)
 * 
 * 用法:
 *   node scripts/batch-ingest-cities.mjs               # 抓取最近 7 天
 *   node scripts/batch-ingest-cities.mjs 20240501 20240507  # 抓取指定起止日期区间
 */

import fs from 'fs';
import path from 'path';

// 格式化日期为 YYYYMMDD
function formatDate(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

// 格式化为 YYYY-MM-DD
function formatISODate(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// 解析日期字符串 YYYYMMDD 为 Date
function parseDate(str) {
  const y = parseInt(str.substring(0, 4), 10);
  const m = parseInt(str.substring(4, 6), 10) - 1;
  const d = parseInt(str.substring(6, 8), 10);
  return new Date(y, m, d);
}

// 获取日期区间列表
function getDateRange(startStr, endStr) {
  const dates = [];
  let curr = parseDate(startStr);
  const end = parseDate(endStr);

  while (curr <= end) {
    dates.push(formatDate(curr));
    curr.setDate(curr.getDate() + 1);
  }
  return dates;
}

// 下载单日城市 CSV
async function fetchDayCSV(dateStr) {
  const url = `https://quotsoft.net/air/data/china_cities_${dateStr}.csv`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'AQI-Vibe-Aggregator/1.0' } });
    if (!res.ok) {
      console.warn(`[WARN] 无法获取 ${dateStr} 数据 (HTTP ${res.status})`);
      return null;
    }
    const text = await res.text();
    return text;
  } catch (err) {
    console.error(`[ERROR] 请求 ${dateStr} 失败:`, err.message);
    return null;
  }
}

// 解析单日 CSV 并聚合每个城市的日均指标
function parseAndAggregateDay(csvText, dateStr) {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) return null;

  const header = lines[0].trim().split(',');
  const cityNames = header.slice(3); // 前三列为 date, hour, type

  // 为每个城市初始化数据收集器
  // cityData[cityName] = { pm25: [], pm10: [], o3_8h: [], no2: [], so2: [], co: [], aqi: [] }
  const cityData = {};
  for (const c of cityNames) {
    if (c) cityData[c] = { pm25: [], pm10: [], o3_8h: [], no2: [], so2: [], co: [], aqi: [] };
  }

  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].trim().split(',');
    if (row.length < 4) continue;
    const type = row[2];

    for (let cIdx = 0; cIdx < cityNames.length; cIdx++) {
      const cityName = cityNames[cIdx];
      const valStr = row[3 + cIdx];
      if (!valStr || isNaN(valStr)) continue;
      const val = parseFloat(valStr);

      if (type === 'PM2.5') cityData[cityName].pm25.push(val);
      else if (type === 'PM10') cityData[cityName].pm10.push(val);
      else if (type === 'O3_8h') cityData[cityName].o3_8h.push(val);
      else if (type === 'NO2') cityData[cityName].no2.push(val);
      else if (type === 'SO2') cityData[cityName].so2.push(val);
      else if (type === 'CO') cityData[cityName].co.push(val);
      else if (type === 'AQI') cityData[cityName].aqi.push(val);
    }
  }

  const avg = (arr) => arr.length ? +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1) : null;
  const max = (arr) => arr.length ? Math.max(...arr) : null;

  const isoDate = `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}`;
  const daySummary = {};

  for (const [cityName, stats] of Object.entries(cityData)) {
    const pm25Avg = avg(stats.pm25);
    const pm10Avg = avg(stats.pm10);
    const o3Max = max(stats.o3_8h) || avg(stats.o3_8h);
    const aqiAvg = avg(stats.aqi);

    if (pm25Avg !== null || aqiAvg !== null) {
      daySummary[cityName] = {
        date: isoDate,
        pm25: pm25Avg,
        pm10: pm10Avg,
        o3: o3Max,
        no2: avg(stats.no2),
        so2: avg(stats.so2),
        co: avg(stats.co),
        aqi: aqiAvg ? Math.round(aqiAvg) : null,
      };
    }
  }

  return daySummary;
}

async function main() {
  const args = process.argv.slice(2);
  let startStr, endStr;

  if (args.length >= 2) {
    startStr = args[0];
    endStr = args[1];
  } else {
    // 默认获取过去 7 天
    const today = new Date();
    const end = new Date(today);
    end.setDate(end.getDate() - 1);
    const start = new Date(end);
    start.setDate(start.getDate() - 6);
    startStr = formatDate(start);
    endStr = formatDate(end);
  }

  console.log(`[QuotSoft Aggregator] 准备处理城市级历史数据，区间: ${startStr} 至 ${endStr}`);
  const dates = getDateRange(startStr, endStr);
  console.log(`[QuotSoft Aggregator] 共需抓取 ${dates.length} 天的城市宽表数据...`);

  // 输出目录
  const outDir = path.resolve(process.cwd(), 'data', 'processed');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const resultFilePath = path.join(outDir, 'quotsoft_cities_daily.json');
  let masterData = {};
  if (fs.existsSync(resultFilePath)) {
    try {
      masterData = JSON.parse(fs.readFileSync(resultFilePath, 'utf-8'));
    } catch {
      masterData = {};
    }
  }

  let successCount = 0;
  for (const d of dates) {
    console.log(`-> 正在下载并聚合: ${d}...`);
    const csv = await fetchDayCSV(d);
    if (!csv) continue;

    const daySummary = parseAndAggregateDay(csv, d);
    if (!daySummary) continue;

    const isoDate = `${d.substring(0, 4)}-${d.substring(4, 6)}-${d.substring(6, 8)}`;
    
    // 按城市存入 masterData: masterData[cityName][isoDate] = { pm25, pm10, o3, aqi, ... }
    for (const [cityName, record] of Object.entries(daySummary)) {
      if (!masterData[cityName]) masterData[cityName] = {};
      masterData[cityName][isoDate] = record;
    }

    successCount++;
  }

  // 写入最终紧凑 JSON
  fs.writeFileSync(resultFilePath, JSON.stringify(masterData, null, 2), 'utf-8');
  console.log(`\n========================================`);
  console.log(`[QuotSoft Aggregator] 批处理完成！`);
  console.log(`成功处理: ${successCount} / ${dates.length} 天`);
  console.log(`涵盖全国城市数: ${Object.keys(masterData).length} 个`);
  console.log(`输出数据文件: ${resultFilePath}`);
  const stat = fs.statSync(resultFilePath);
  console.log(`产物大小: ${(stat.size / 1024).toFixed(1)} KB (超轻量快速加载)`);
  console.log(`========================================\n`);
}

main();
