#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AQI Vibe - 国内历史空气质量数据每日增量同步流水线
Daily incremental synchronization pipeline for Chinese historical air quality data.

功能说明：
1. 默认自动检查过去 N 天（默认 3 天）全国 375 城市国控站实测数据。
2. 发现缺失日期时，自动从官方镜像 (QuotSoft) 拉取 china_cities_YYYYMMDD.csv 宽表。
3. 极速计算 375 个城市日均值，并根据国标 (HJ 633-2012) 与美标 (US EPA) 评价。
4. 幂等更新当年的 quotsoft_YYYY.json、各城市 public/data/history/{cityId}.json，
   并重新聚合 history_summary.json 与 history_index.json。
5. 专为 GitHub Actions + Cloudflare Pages GitOps 设计，具备容错自愈能力。
"""

import argparse
import datetime
import json
import os
import re
import sys
import time
import urllib.request
from collections import defaultdict

# 强制标准输出使用 UTF-8
sys.stdout.reconfigure(encoding='utf-8')

QUOTSOFT_DIR = 'data/processed/quotsoft_yearly'
HISTORY_DIR = 'public/data/history'
SUMMARY_FILE = 'data/processed/history_summary.json'
INDEX_FILE = 'data/processed/history_index.json'
CITIES_REGISTRY_FILE = 'lib/constants/cities.ts'

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
}

# 中国国标 (HJ 633-2012) 与美标 (US EPA NowCast) 断点
CN_BP = {
    'iaqi': [0, 50, 100, 150, 200, 300, 400, 500],
    'pm25': [0, 35, 75, 115, 150, 250, 350, 500],
    'pm10': [0, 50, 150, 250, 350, 420, 500, 600],
    'so2':  [0, 150, 500, 650, 800],
    'no2':  [0, 100, 200, 700, 1200, 2340, 3090, 3840],
    'co':   [0, 5, 10, 35, 60, 90, 120, 150],
    'o3':   [0, 160, 200, 300, 400, 800, 1000, 1200],
}

US_BP = {
    'aqi':  [0, 50, 100, 150, 200, 300, 500],
    'pm25': [0.0, 12.0, 35.4, 55.4, 150.4, 250.4, 500.4],
    'pm10': [0, 54, 154, 254, 354, 424, 604],
    'no2':  [0, 100, 188, 677, 1221, 2349, 3853],
    'so2':  [0, 92, 197, 485, 797, 1584, 2630],
    'co':   [0, 5.0, 10.8, 14.2, 17.6, 34.8, 57.6],
    'o3':   [0, 108, 140, 170, 210, 400, 800],
}

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
            return round(iaqi)
    return 0

def evaluate_day_aqi(rec, standard='CN'):
    bp = CN_BP if standard == 'CN' else US_BP
    aqi_scale = bp['iaqi'] if standard == 'CN' else bp['aqi']
    
    iaqi_vals = []
    if rec.get('pm25') is not None and rec['pm25'] > 0:
        iaqi_vals.append(calc_iaqi(rec['pm25'], bp['pm25'], aqi_scale))
    if rec.get('pm10') is not None and rec['pm10'] > 0:
        iaqi_vals.append(calc_iaqi(rec['pm10'], bp['pm10'], aqi_scale))
    if rec.get('o3') is not None and rec['o3'] > 0:
        iaqi_vals.append(calc_iaqi(rec['o3'], bp['o3'], aqi_scale))
    if rec.get('no2') is not None and rec['no2'] > 0:
        iaqi_vals.append(calc_iaqi(rec['no2'], bp['no2'], aqi_scale))
    if rec.get('so2') is not None and rec['so2'] > 0:
        iaqi_vals.append(calc_iaqi(rec['so2'], bp['so2'], aqi_scale))
    if rec.get('co') is not None and rec['co'] > 0:
        iaqi_vals.append(calc_iaqi(rec['co'], bp['co'], aqi_scale))
    
    return max(iaqi_vals) if iaqi_vals else 0

def load_cities_registry():
    """解析 lib/constants/cities.ts 获取全国 375 城市映射"""
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
    """解析单日 375 城市 24 小时实测宽表，生成日度统计"""
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
        o3 = metrics.get('O3', metrics.get('O3_8h', []))
        no2 = metrics.get('NO2', [])
        so2 = metrics.get('SO2', [])
        co = metrics.get('CO', [])
        
        day_res[cname] = {
            'pm25': round(sum(p25) / len(p25), 1) if p25 else None,
            'pm10': round(sum(p10) / len(p10), 1) if p10 else None,
            'o3':   round(max(o3), 1) if o3 else None,
            'no2':  round(sum(no2) / len(no2), 1) if no2 else None,
            'so2':  round(sum(so2) / len(so2), 1) if so2 else None,
            'co':   round(sum(co) / len(co), 2) if co else None,
        }
    
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
                time.sleep(2)
            else:
                print(f"[-] 下载 {d_str} 失败 ({url}): {e}")
    return None

def sync_dates(dates_to_sync):
    """执行指定日期的增量更新流水线"""
    if not dates_to_sync:
        print("[*] 没有需要同步的日期。")
        return False
    
    print(f"[*] 准备检查并同步 {len(dates_to_sync)} 个日期: {dates_to_sync}")
    city_by_zh = load_cities_registry()
    print(f"[*] 成功载入 {len(city_by_zh)} 个国内官方城市映射。")
    
    # 按年份组织需要更新的数据
    year_to_dates = defaultdict(list)
    for d_str in dates_to_sync:
        y = int(d_str[:4])
        year_to_dates[y].append(d_str)
    
    total_days_updated = 0
    
    for year, d_list in sorted(year_to_dates.items()):
        year_file = os.path.join(QUOTSOFT_DIR, f"quotsoft_{year}.json")
        year_data = defaultdict(dict)
        if os.path.exists(year_file):
            try:
                with open(year_file, 'r', encoding='utf-8') as f:
                    loaded = json.load(f)
                    for c, d_map in loaded.items():
                        year_data[c] = d_map
            except Exception as e:
                print(f"[!] 读取 {year_file} 失败: {e}")
        
        # 逐日抓取并合并
        year_updated_days = []
        for d_str in d_list:
            date_iso = f"{d_str[:4]}-{d_str[4:6]}-{d_str[6:8]}"
            print(f"[*] 正在拉取 {date_iso} ({d_str}) 全国实测数据...")
            day_data = fetch_date_csv(d_str)
            if not day_data:
                print(f"[!] {date_iso} 数据源尚未就绪或不可用，跳过。")
                continue
            
            # 合并到 year_data
            for cname, metrics in day_data.items():
                year_data[cname][date_iso] = metrics
            
            # 同时增量更新 public/data/history/{cityId}.json
            for cname, metrics in day_data.items():
                city_meta = city_by_zh.get(cname)
                if not city_meta:
                    continue
                cid = city_meta['id']
                city_hist_file = os.path.join(HISTORY_DIR, f"{cid}.json")
                if os.path.exists(city_hist_file):
                    try:
                        with open(city_hist_file, 'r', encoding='utf-8') as hf:
                            cobj = json.load(hf)
                        cobj['daily'][date_iso] = metrics
                        if year not in cobj.get('years', []):
                            cobj['years'].append(year)
                            cobj['years'].sort()
                        with open(city_hist_file, 'w', encoding='utf-8') as hf:
                            json.dump(cobj, hf, ensure_ascii=False, separators=(',', ':'))
                    except Exception as err:
                        pass
            
            year_updated_days.append(date_iso)
            total_days_updated += 1
            print(f"[+] 成功更新 {date_iso}，涵盖 {len(day_data)} 个城市！")
        
        if year_updated_days:
            # 写回 quotsoft_{year}.json
            with open(year_file, 'w', encoding='utf-8') as f:
                json.dump(year_data, f, ensure_ascii=False, separators=(',', ':'))
            print(f"[✓] 已持久化 {year_file} (总计收录 {len(year_data)} 城)")
            
            # 重新聚合更新 history_summary.json 与 history_index.json
            update_summary_and_index(year, year_data, city_by_zh)
    
    return total_days_updated > 0

def update_summary_and_index(target_year, year_data, city_by_zh):
    """增量重新计算 target_year 的指标，更新 history_summary.json 与 history_index.json"""
    print(f"[*] 正在增量重算 {target_year} 年度的各城市统计指标...")
    
    # 1. 载入现有 summary
    summary = {}
    if os.path.exists(SUMMARY_FILE):
        with open(SUMMARY_FILE, 'r', encoding='utf-8') as f:
            summary = json.load(f)
            
    # 2. 载入现有 index
    index = {}
    if os.path.exists(INDEX_FILE):
        with open(INDEX_FILE, 'r', encoding='utf-8') as f:
            index = json.load(f)
            
    for cname, date_map in year_data.items():
        city_meta = city_by_zh.get(cname)
        if not city_meta:
            continue
        cid = city_meta['id']
        
        # 提取当年全部有效实测日
        year_days = [rec for d_str, rec in date_map.items() if d_str.startswith(str(target_year))]
        total_days = len(year_days)
        if total_days == 0:
            continue
        
        pm25_vals = [r['pm25'] for r in year_days if r.get('pm25') is not None and r['pm25'] > 0]
        pm10_vals = [r['pm10'] for r in year_days if r.get('pm10') is not None and r['pm10'] > 0]
        
        pm25_avg = round(sum(pm25_vals) / len(pm25_vals), 1) if pm25_vals else 0
        pm10_avg = round(sum(pm10_vals) / len(pm10_vals), 1) if pm10_vals else 0
        
        cn_aqis = [evaluate_day_aqi(r, 'CN') for r in year_days]
        us_aqis = [evaluate_day_aqi(r, 'US') for r in year_days]
        
        cn_compliant = sum(1 for aqi in cn_aqis if aqi <= 100)
        us_compliant = sum(1 for aqi in us_aqis if aqi <= 100)
        
        cn_heavy = sum(1 for aqi in cn_aqis if aqi > 200)
        us_heavy = sum(1 for aqi in us_aqis if aqi > 150)
        
        trend_item = {
            'year': target_year,
            'daysCount': total_days,
            'pm25Avg': pm25_avg,
            'pm10Avg': pm10_avg,
            'goodDaysRatioCN': round((cn_compliant / total_days) * 100),
            'goodDaysRatioUS': round((us_compliant / total_days) * 100),
            'heavyPollutionDaysCN': cn_heavy,
            'heavyPollutionDaysUS': us_heavy,
            'aqiAvgCN': round(sum(cn_aqis) / len(cn_aqis)) if cn_aqis else 0,
            'aqiAvgUS': round(sum(us_aqis) / len(us_aqis)) if us_aqis else 0,
            'pollutedDaysCN': total_days - cn_compliant,
            'pollutedDaysUS': total_days - us_compliant,
        }
        
        # 更新该城市的年度统计数组
        if cid not in summary:
            summary[cid] = []
        
        found = False
        for idx, row in enumerate(summary[cid]):
            if row['year'] == target_year:
                summary[cid][idx] = trend_item
                found = True
                break
        if not found:
            summary[cid].append(trend_item)
            summary[cid].sort(key=lambda x: x['year'])
            
        # 更新 index
        if cid in index:
            # 重新计算该城市的总历史天数
            hist_file = os.path.join(HISTORY_DIR, f"{cid}.json")
            if os.path.exists(hist_file):
                try:
                    with open(hist_file, 'r', encoding='utf-8') as hf:
                        hdata = json.load(hf)
                    index[cid]['daysCount'] = len(hdata.get('daily', {}))
                    index[cid]['years'] = hdata.get('years', index[cid]['years'])
                except Exception:
                    pass
    
    with open(SUMMARY_FILE, 'w', encoding='utf-8') as f:
        json.dump(summary, f, ensure_ascii=False, separators=(',', ':'))
    with open(INDEX_FILE, 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False, separators=(',', ':'))
    print(f"[✓] 成功重算并刷新 {SUMMARY_FILE} 与 {INDEX_FILE}！")

def check_missing_recent_dates(lookback_days=3):
    """检查最近 N 天中，本地数据库缺失的日期列表"""
    today = datetime.date.today()
    missing = []
    
    # 检查北京作为基准城市在对应年份的收录情况
    for i in range(1, lookback_days + 1):
        target_d = today - datetime.timedelta(days=i)
        d_str = target_d.strftime('%Y%m%d')
        date_iso = target_d.strftime('%Y-%m-%d')
        year = target_d.year
        
        year_file = os.path.join(QUOTSOFT_DIR, f"quotsoft_{year}.json")
        if not os.path.exists(year_file):
            missing.append(d_str)
            continue
            
        try:
            with open(year_file, 'r', encoding='utf-8') as f:
                ydata = json.load(f)
            # 取北京或任意首选城市判断是否存在该日期
            sample_dates = set(ydata.get('北京', {}).keys())
            if date_iso not in sample_dates:
                missing.append(d_str)
        except Exception:
            missing.append(d_str)
            
    return sorted(missing)

def main():
    parser = argparse.ArgumentParser(description="AQI Vibe - 国内历史数据每日增量同步流水线")
    parser.add_argument('--date', type=str, help="指定同步日期 (格式: YYYYMMDD，如 20261006)")
    parser.add_argument('--days', type=int, default=3, help="自动向前检查的天数 (默认检查过去 3 天)")
    args = parser.parse_args()
    
    print("=" * 65)
    print("  AQI Vibe · 国内空气质量每日增量同步引擎")
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
