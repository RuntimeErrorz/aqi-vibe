/**
 * QuotSoft 全国城市与国控站点历史数据离线导入脚本
 * 用法:
 *   node scripts/ingest-quotsoft.mjs              # 默认抓取昨日数据
 *   node scripts/ingest-quotsoft.mjs 20240501     # 抓取指定日期
 */

import fs from 'fs';
import path from 'path';

function getYesterdayStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

const targetDate = process.argv[2] || getYesterdayStr();
console.log(`[QuotSoft Ingest] Starting ingestion for date: ${targetDate}`);

const CITY_URL = `https://quotsoft.net/air/data/china_cities_${targetDate}.csv`;
const SITE_URL = `https://quotsoft.net/air/data/china_sites_${targetDate}.csv`;

async function fetchAndSave(url, fileName) {
  console.log(`Downloading: ${url}...`);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'AQI-Vibe-Ingester/1.0' } });
    if (!res.ok) {
      console.warn(`Failed to fetch ${url}, status: ${res.status}`);
      return null;
    }
    const text = await res.text();
    const outDir = path.resolve(process.cwd(), 'data', 'raw');
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }
    const outPath = path.join(outDir, fileName);
    fs.writeFileSync(outPath, text, 'utf-8');
    console.log(`Successfully saved ${text.split('\n').length} lines to ${outPath}`);
    return text;
  } catch (err) {
    console.error(`Error fetching ${url}:`, err.message);
    return null;
  }
}

async function run() {
  await fetchAndSave(CITY_URL, `china_cities_${targetDate}.csv`);
  await fetchAndSave(SITE_URL, `china_sites_${targetDate}.csv`);
  console.log('[QuotSoft Ingest] Done.');
}

run();
