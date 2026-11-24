#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AQI Vibe - 国内历史空气质量数据每日增量同步流水线
Daily incremental synchronization pipeline for Chinese historical air quality data.

升级规范：
1. 严格读取 shared/aqi-standards.json 单一标准配置源（中国国标 HJ 633-2012 日均/O3_8h 断点 + US EPA 2024 修订断点）。
2. 以已入库跟踪的 public/data/history/{cityId}.json 为唯一事实源 (SSOT)，彻底消除 GitHub Actions 下因忽略 quotsoft_yearly/ 导致整年汇总被覆盖清空的风险。
3. 优先采集 O3_8h 作为臭氧日评指标，并按 HJ 663-2012 校验每日有效小时样本数门槛。
4. 同步输出 data/processed/history_summary.json、public/data/history_summary.json 与 data/processed/history_index.json，并预聚合「只看 PM2.5」年度达标率与污染天数。
"""

import argparse
import datetime
import json
import math
import os
import re
import sys
import time
import urllib.request
from collections import defaultdict

sys.stdout.reconfigure(encoding='utf-8')

STANDARDS_FILE = 'shared/aqi-standards.json'
HISTORY_DIR = 'public/data/history'
SUMMARY_FILE = 'data/processed/history_summary.json'
PUBLIC_SUMMARY_FILE = 'public/data/history_summary.json'
INDEX_FILE = 'data/processed/history_index.json'
CITIES_REGISTRY_FILE = 'lib/constants/cities.ts'

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
}

with open(STANDARDS_FILE, 'r', encoding='utf-8') as _sf:
    _STANDARDS = json.load(_sf)

CN_DAILY_BP = _STANDARDS['cn_daily']
US_2024_BP = _STANDARDS['us_2024']

# HJ 663-2012 日均有效小时数门槛（24h 指标至少 20 个有效小时，O3_8h 至少 14 个有效滑窗）
MIN_VALID_HOURS_24H = 20
MIN_VALID_HOURS_O3 = 14


def calc_iaqi(val, bp_conc, bp_iaqi):
    if val is None or val <= 0:
        return 0
    max_idx = min(len(bp_conc) - 1, len(bp_iaqi) - 1)
    if val >= bp_conc[max_idx]:
        return bp_iaqi[max_idx]
    for i in range(max_idx):
        c_low = bp_conc[i]
        c_high = bp_conc[i + 1]
        i_low = bp_iaqi[i]
        i_high = bp_iaqi[i + 1]
        if c_low <= val <= c_high:
            iaqi = ((i_high - i_low) / (c_high - c_low)) * (val - c_low) + i_low
            return int(math.floor(iaqi + 0.5))
    return 0


def evaluate_day_aqi(rec, standard='CN', only_pm25=False):
    bp = CN_DAILY_BP if standard == 'CN' else US_2024_BP
    aqi_scale = bp['iaqi'] if standard == 'CN' else bp['aqi']

    if only_pm25:
        pm25 = rec.get('pm25')
        return calc_iaqi(pm25, bp['pm25'], aqi_scale) if (pm25 is not None and pm25 > 0) else 0

    iaqi_vals = []
    for key in ('pm25', 'pm10', 'o3', 'no2', 'so2', 'co'):
        v = rec.get(key)
        if v is not None and v > 0:
            iaqi_vals.append(calc_iaqi(v, bp[key], aqi_scale))

    return max(iaqi_vals) if iaqi_vals else 0


def load_cities_registry():
    """解析 lib/constants/cities.ts 获取国内官方城市映射"""
    with open(CITIES_REGISTRY_FILE, 'r', encoding='utf-8') as f:
        content = f.read()
    match = re.search(r'export const CITIES_REGISTRY: CityMeta\[\] = (\[.*?\]);', content, re.DOTALL)
    if not match:
        raise RuntimeError("无法从 cities.ts 解析 CITIES_REGISTRY")
    registry = json.loads(match.group(1))

    city_by_zh = {}
    for c in registry:
        if c.get('isDomestic'):
            city_by_zh[c['nameZh']] = c
    return city_by_zh


def parse_day_csv(csv_text):
    """解析单日全国城市 24 小时实测宽表，严格按 HJ 663-2012 生成日度统计"""
    lines = csv_text.strip().splitlines()
    if len(lines) < 2:
        return None

    header = lines[0].strip().split(',')
    if len(header) < 4:
        return None
    cities = [c.strip() for c in header[3:]]

    city_vals = defaultdict(lambda: defaultdict(list))
    for line in lines[1:]:
        parts = line.strip().split(',')
        if len(parts) >= 4:
            m_type = parts[2].strip()
            for idx, cname in enumerate(cities):
                col_idx = idx + 3
                if col_idx < len(parts):
                    v_str = parts[col_idx].strip()
                    if v_str:
                        try:
                            val = float(v_str)
                            if val >= 0:
                                city_vals[cname][m_type].append(val)
                        except ValueError:
                            pass

    day_res = {}
    for cname, metrics in city_vals.items():
        if not cname:
            continue
        p25 = metrics.get('PM2.5', [])
        p10 = metrics.get('PM10', [])
        # HJ 633-2012 日评优先使用 O3_8h 日最大 8 小时滑动平均，缺失时回退 O3
        o3_8h = metrics.get('O3_8h', [])
        o3_1h = metrics.get('O3', [])
        o3 = o3_8h if len(o3_8h) >= MIN_VALID_HOURS_O3 else (o3_8h or o3_1h)
        no2 = metrics.get('NO2', [])
        so2 = metrics.get('SO2', [])
        co = metrics.get('CO', [])

        rec = {
            'pm25': round(sum(p25) / len(p25), 1) if len(p25) >= MIN_VALID_HOURS_24H else None,
            'pm10': round(sum(p10) / len(p10), 1) if len(p10) >= MIN_VALID_HOURS_24H else None,
            'o3':   round(max(o3), 1) if len(o3) >= MIN_VALID_HOURS_O3 else None,
            'no2':  round(sum(no2) / len(no2), 1) if len(no2) >= MIN_VALID_HOURS_24H else None,
            'so2':  round(sum(so2) / len(so2), 1) if len(so2) >= MIN_VALID_HOURS_24H else None,
            'co':   round(sum(co) / len(co), 2) if len(co) >= MIN_VALID_HOURS_24H else None,
        }
        # 仅保留至少有一项有效日均监测值的记录
        if any(v is not None for v in rec.values()):
            day_res[cname] = rec

    return day_res


def fetch_date_csv(d_str, max_retries=3):
    """从 QuotSoft 下载指定日期 CSV"""
    url = f"https://quotsoft.net/air/data/china_cities_{d_str}.csv"
    for attempt in range(max_retries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=15) as resp:
                if resp.status == 200:
                    text = resp.read().decode('utf-8', errors='ignore')
                    return parse_day_csv(text)
        except Exception as e:
            if attempt < max_retries - 1:
                time.sleep(2 ** (attempt + 1))
            else:
                print(f"[-] 下载 {d_str} 失败 ({url}): {e}")
    return None


def compute_year_trend_item(target_year, daily_map):
    """基于单个城市完整 daily 字典，精确聚合指定年份的双标综合与纯 PM2.5 年度指标"""
    prefix = f"{target_year}-"
    year_days = [rec for d_str, rec in daily_map.items() if d_str.startswith(prefix)]
    total_days = len(year_days)
    if total_days == 0:
        return None

    pm25_vals = [r['pm25'] for r in year_days if r.get('pm25') is not None and r['pm25'] > 0]
    pm10_vals = [r['pm10'] for r in year_days if r.get('pm10') is not None and r['pm10'] > 0]

    pm25_avg = round(sum(pm25_vals) / len(pm25_vals), 1) if pm25_vals else 0
    pm10_avg = round(sum(pm10_vals) / len(pm10_vals), 1) if pm10_vals else 0

    cn_aqis = [evaluate_day_aqi(r, 'CN', False) for r in year_days]
    us_aqis = [evaluate_day_aqi(r, 'US', False) for r in year_days]

    cn_valid = [a for a in cn_aqis if a > 0]
    us_valid = [a for a in us_aqis if a > 0]
    cn_denom = len(cn_valid) or total_days
    us_denom = len(us_valid) or total_days

    cn_compliant = sum(1 for aqi in cn_valid if aqi <= 100)
    us_compliant = sum(1 for aqi in us_valid if aqi <= 100)
    cn_heavy = sum(1 for aqi in cn_valid if aqi > 200)
    us_heavy = sum(1 for aqi in us_valid if aqi > 150)

    # 纯 PM2.5 单项年度达标统计（消除前端只看 PM2.5 模式首屏闪烁）
    pm25_cn_aqis = [evaluate_day_aqi(r, 'CN', True) for r in year_days if r.get('pm25') is not None and r['pm25'] > 0]
    pm25_us_aqis = [evaluate_day_aqi(r, 'US', True) for r in year_days if r.get('pm25') is not None and r['pm25'] > 0]
    pm25_days = len(pm25_cn_aqis)
    pm25_cn_compliant = sum(1 for aqi in pm25_cn_aqis if aqi <= 100)
    pm25_us_compliant = sum(1 for aqi in pm25_us_aqis if aqi <= 100)

    return {
        'year': target_year,
        'daysCount': total_days,
        'pm25Avg': pm25_avg,
        'pm10Avg': pm10_avg,
        'goodDaysRatioCN': round((cn_compliant / cn_denom) * 100) if cn_valid else 0,
        'goodDaysRatioUS': round((us_compliant / us_denom) * 100) if us_valid else 0,
        'heavyPollutionDaysCN': cn_heavy,
        'heavyPollutionDaysUS': us_heavy,
        'aqiAvgCN': round(sum(cn_valid) / len(cn_valid)) if cn_valid else 0,
        'aqiAvgUS': round(sum(us_valid) / len(us_valid)) if us_valid else 0,
        'pollutedDaysCN': cn_denom - cn_compliant if cn_valid else 0,
        'pollutedDaysUS': us_denom - us_compliant if us_valid else 0,
        'goodDaysRatioPm25CN': round((pm25_cn_compliant / pm25_days) * 100) if pm25_days else 0,
        'goodDaysRatioPm25US': round((pm25_us_compliant / pm25_days) * 100) if pm25_days else 0,
        'pollutedDaysPm25CN': pm25_days - pm25_cn_compliant if pm25_days else 0,
        'pollutedDaysPm25US': pm25_days - pm25_us_compliant if pm25_days else 0,
    }


def sync_dates(dates_to_sync):
    """执行指定日期的增量更新流水线（以 public/data/history/{cid}.json 为唯一事实源）"""
    if not dates_to_sync:
        print("[*] 没有需要同步的日期。")
        return False

    print(f"[*] 准备检查并同步 {len(dates_to_sync)} 个日期: {dates_to_sync}")
    city_by_zh = load_cities_registry()
    print(f"[*] 成功载入 {len(city_by_zh)} 个国内官方城市映射。")

    touched_city_years = defaultdict(set)
    total_days_updated = 0

    for d_str in sorted(dates_to_sync):
        year = int(d_str[:4])
        date_iso = f"{d_str[:4]}-{d_str[4:6]}-{d_str[6:8]}"
        print(f"[*] 正在拉取 {date_iso} ({d_str}) 全国实测数据...")
        day_data = fetch_date_csv(d_str)
        if not day_data:
            print(f"[!] {date_iso} 数据源尚未就绪或不可用，跳过。")
            continue

        updated_cities = 0
        for cname, metrics in day_data.items():
            city_meta = city_by_zh.get(cname)
            if not city_meta:
                continue
            cid = city_meta['id']
            city_hist_file = os.path.join(HISTORY_DIR, f"{cid}.json")
            if not os.path.exists(city_hist_file):
                continue

            try:
                with open(city_hist_file, 'r', encoding='utf-8') as hf:
                    cobj = json.load(hf)
                if 'daily' not in cobj or not isinstance(cobj['daily'], dict):
                    cobj['daily'] = {}
                cobj['daily'][date_iso] = metrics
                years_list = cobj.get('years', [])
                if year not in years_list:
                    years_list.append(year)
                    years_list.sort()
                    cobj['years'] = years_list
                with open(city_hist_file, 'w', encoding='utf-8') as hf:
                    json.dump(cobj, hf, ensure_ascii=False, separators=(',', ':'))
                touched_city_years[cid].add(year)
                updated_cities += 1
            except Exception as err:
                print(f"[!] 更新 {city_hist_file} 失败: {err}")

        if updated_cities > 0:
            total_days_updated += 1
            print(f"[+] 成功更新 {date_iso}，涵盖 {updated_cities} 个国内城市！")

    if touched_city_years:
        update_summary_and_index(touched_city_years)

    return total_days_updated > 0


def update_summary_and_index(touched_city_years):
    """直接从各城市完整 public/data/history/{cid}.json 重算受影响年份的汇总，绝不会覆盖丢失历史天数"""
    print(f"[*] 正在从 SSOT 历史档案重算 {len(touched_city_years)} 座城市的年度汇总指标...")

    summary = {}
    if os.path.exists(SUMMARY_FILE):
        with open(SUMMARY_FILE, 'r', encoding='utf-8') as f:
            summary = json.load(f)

    index = {}
    if os.path.exists(INDEX_FILE):
        with open(INDEX_FILE, 'r', encoding='utf-8') as f:
            index = json.load(f)

    for cid, years_set in touched_city_years.items():
        hist_file = os.path.join(HISTORY_DIR, f"{cid}.json")
        if not os.path.exists(hist_file):
            continue
        try:
            with open(hist_file, 'r', encoding='utf-8') as hf:
                hdata = json.load(hf)
        except Exception as err:
            print(f"[!] 读取 {hist_file} 失败: {err}")
            continue

        daily_map = hdata.get('daily', {})
        if cid not in summary:
            summary[cid] = []

        for target_year in sorted(years_set):
            trend_item = compute_year_trend_item(target_year, daily_map)
            if not trend_item:
                continue

            # 安全防线：若旧记录存在且天数远大于新计算值，拒绝覆盖并报警
            found = False
            for idx, row in enumerate(summary[cid]):
                if row['year'] == target_year:
                    if row.get('daysCount', 0) > trend_item['daysCount']:
                        print(
                            f"[WARN] {cid} {target_year} 天数异常回退 "
                            f"({row.get('daysCount')} -> {trend_item['daysCount']})，跳过覆盖。"
                        )
                    else:
                        summary[cid][idx] = trend_item
                    found = True
                    break
            if not found:
                summary[cid].append(trend_item)
                summary[cid].sort(key=lambda x: x['year'])

        if cid in index:
            index[cid]['daysCount'] = len(daily_map)
            index[cid]['years'] = hdata.get('years', index[cid].get('years', []))

    for target_path in (SUMMARY_FILE, PUBLIC_SUMMARY_FILE):
        os.makedirs(os.path.dirname(target_path), exist_ok=True)
        with open(target_path, 'w', encoding='utf-8') as f:
            json.dump(summary, f, ensure_ascii=False, separators=(',', ':'))

    with open(INDEX_FILE, 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False, separators=(',', ':'))

    print(f"[✓] 成功重算并同步 {SUMMARY_FILE}、{PUBLIC_SUMMARY_FILE} 与 {INDEX_FILE}！")


def check_missing_recent_dates(lookback_days=3):
    """直接基于已入库跟踪的 public/data/history/cn-beijing.json 检查最近 N 天缺失日期"""
    today = datetime.date.today()
    beijing_file = os.path.join(HISTORY_DIR, 'cn-beijing.json')
    existing_dates = set()
    if os.path.exists(beijing_file):
        try:
            with open(beijing_file, 'r', encoding='utf-8') as f:
                existing_dates = set(json.load(f).get('daily', {}).keys())
        except Exception as err:
            print(f"[!] 读取基准档案 {beijing_file} 失败: {err}")

    missing = []
    for i in range(1, lookback_days + 1):
        target_d = today - datetime.timedelta(days=i)
        date_iso = target_d.strftime('%Y-%m-%d')
        if date_iso not in existing_dates:
            missing.append(target_d.strftime('%Y%m%d'))

    return sorted(missing)


def main():
    parser = argparse.ArgumentParser(description="AQI Vibe - 国内历史数据每日增量同步流水线")
    parser.add_argument('--date', type=str, help="指定同步日期 (格式: YYYYMMDD，如 20261006)")
    parser.add_argument('--days', type=int, default=3, help="自动向前检查的天数 (默认检查过去 3 天)")
    args = parser.parse_args()

    print("=" * 65)
    print("  AQI Vibe · 国内空气质量每日增量同步引擎 (SSOT + EPA2024 + HJ633)")
    print("=" * 65)

    if args.date:
        dates_to_sync = [args.date]
    else:
        print(f"[*] 自动自愈检查：正在探测过去 {args.days} 天本地缺失数据...")
        dates_to_sync = check_missing_recent_dates(args.days)
        if not dates_to_sync:
            print("[✓] 检查完毕：本地数据已是最新，无任何缺失，无需更新！")
            sys.exit(0)
        print(f"[!] 发现本地缺失日期: {dates_to_sync}")

    updated = sync_dates(dates_to_sync)
    if updated:
        print("\n[SUCCESS] 增量历史数据同步全部完成，数据已就绪！")
    else:
        print("\n[*] 本次运行未发生数据变更。")


if __name__ == '__main__':
    main()
