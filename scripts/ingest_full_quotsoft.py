import concurrent.futures
import datetime
import json
import os
import sys
import time
import urllib.request
from collections import defaultdict

sys.stdout.reconfigure(encoding='utf-8')

YEARLY_DIR = 'data/processed/quotsoft_yearly'
os.makedirs(YEARLY_DIR, exist_ok=True)

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
}

def parse_day_csv(csv_text, date_iso):
    """内存快速解析单日 375 城市 24 小时宽表"""
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

def fetch_and_process_date(d_str):
    url = f"https://quotsoft.net/air/data/china_cities_{d_str}.csv"
    date_iso = f"{d_str[:4]}-{d_str[4:6]}-{d_str[6:8]}"
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=10) as resp:
            text = resp.read().decode('utf-8', errors='ignore')
            data = parse_day_csv(text, date_iso)
            return d_str, date_iso, data
    except Exception as e:
        return d_str, date_iso, None

def get_year_dates(year):
    dates = []
    start = datetime.date(year, 1, 1)
    end = datetime.date(year, 12, 31)
    
    # 2014 starts on May 13
    if year == 2014:
        start = datetime.date(2014, 5, 13)
    
    curr = start
    today = datetime.date.today()
    while curr <= end and curr <= today:
        dates.append(curr.strftime('%Y%m%d'))
        curr += datetime.timedelta(days=1)
    return dates

def ingest_year(year, max_workers=20):
    year_file = os.path.join(YEARLY_DIR, f"quotsoft_{year}.json")
    year_data = defaultdict(dict) # city -> date_iso -> metrics
    
    if os.path.exists(year_file):
        try:
            with open(year_file, 'r', encoding='utf-8') as f:
                loaded = json.load(f)
                for c, d_map in loaded.items():
                    year_data[c] = d_map
            print(f"[{year}] 已载入现有本地缓存，包含 {len(year_data)} 个城市。")
        except Exception:
            pass
    
    all_dates = get_year_dates(year)
    # Check already completed dates
    sample_city = next(iter(year_data.keys()), None)
    existing_dates = set()
    if sample_city:
        existing_dates = set(year_data[sample_city].keys())
    
    needed_dates = [d for d in all_dates if f"{d[:4]}-{d[4:6]}-{d[6:8]}" not in existing_dates]
    
    if not needed_dates:
        print(f"[{year}] 全部 {len(all_dates)} 天数据已在本地就绪，跳过抓取。")
        return year_data
    
    print(f"[{year}] 开始并发抓取 {len(needed_dates)}/{len(all_dates)} 天全国实测数据 (工作线程: {max_workers})...")
    
    t0 = time.time()
    completed = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(fetch_and_process_date, d): d for d in needed_dates}
        for future in concurrent.futures.as_completed(futures):
            d_str, date_iso, day_data = future.result()
            completed += 1
            if day_data:
                for cname, metrics in day_data.items():
                    year_data[cname][date_iso] = metrics
            
            if completed % 50 == 0 or completed == len(needed_dates):
                speed = completed / (time.time() - t0)
                print(f"[{year}] 进度: {completed}/{len(needed_dates)} 天 ({speed:.1f} 天/秒)...")
    
    # Save year file
    with open(year_file, 'w', encoding='utf-8') as f:
        json.dump(year_data, f, ensure_ascii=False, separators=(',', ':'))
    print(f"[{year}] 成功存储至 {year_file} ({os.path.getsize(year_file)/1024:.1f} KB).")
    return year_data

if __name__ == '__main__':
    target_years = [int(y) for y in sys.argv[1:]] if len(sys.argv) > 1 else [2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016, 2015, 2014]
    print(f"开始执行 QuotSoft 全国全量历史数据流水线，目标年份: {target_years}")
    
    for y in target_years:
        ingest_year(y, max_workers=25)
    
    print("\n所有指定年份数据已抓取归档完成！")
