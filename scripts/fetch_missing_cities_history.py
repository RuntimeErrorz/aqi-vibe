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

# Breakpoints matching lib/aqi-calculator.ts
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
            return int(math.floor(iaqi + 0.5))
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

def fetch_open_meteo_history(lat, lon):
    # Fetch 2022 to 2025
    url = (
        f"https://air-quality-api.open-meteo.com/v1/air-quality?"
        f"latitude={lat}&longitude={lon}&hourly="
        f"pm2_5,pm10,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone&"
        f"start_date=2022-01-01&end_date=2025-12-31"
    )
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=20) as resp:
        data = json.load(resp)
    
    hourly = data.get('hourly', {})
    times = hourly.get('time', [])
    pm25_list = hourly.get('pm2_5', [])
    pm10_list = hourly.get('pm10', [])
    co_list = hourly.get('carbon_monoxide', [])
    no2_list = hourly.get('nitrogen_dioxide', [])
    so2_list = hourly.get('sulphur_dioxide', [])
    o3_list = hourly.get('ozone', [])
    
    day_metrics = defaultdict(lambda: defaultdict(list))
    for idx, t_str in enumerate(times):
        day_str = t_str[:10]
        if idx < len(pm25_list) and pm25_list[idx] is not None:
            day_metrics[day_str]['pm25'].append(pm25_list[idx])
        if idx < len(pm10_list) and pm10_list[idx] is not None:
            day_metrics[day_str]['pm10'].append(pm10_list[idx])
        if idx < len(co_list) and co_list[idx] is not None:
            # Open-Meteo CO is in ug/m3, convert to mg/m3
            day_metrics[day_str]['co'].append(co_list[idx] / 1000.0)
        if idx < len(no2_list) and no2_list[idx] is not None:
            day_metrics[day_str]['no2'].append(no2_list[idx])
        if idx < len(so2_list) and so2_list[idx] is not None:
            day_metrics[day_str]['so2'].append(so2_list[idx])
        if idx < len(o3_list) and o3_list[idx] is not None:
            day_metrics[day_str]['o3'].append(o3_list[idx])
    
    daily = {}
    for d_str, metrics in sorted(day_metrics.items()):
        p25 = metrics.get('pm25', [])
        p10 = metrics.get('pm10', [])
        o3 = metrics.get('o3', [])
        no2 = metrics.get('no2', [])
        so2 = metrics.get('so2', [])
        co = metrics.get('co', [])
        
        daily[d_str] = {
            'pm25': round(sum(p25) / len(p25), 1) if p25 else None,
            'pm10': round(sum(p10) / len(p10), 1) if p10 else None,
            'o3':   round(max(o3), 1) if o3 else None,
            'no2':  round(sum(no2) / len(no2), 1) if no2 else None,
            'so2':  round(sum(so2) / len(so2), 1) if so2 else None,
            'co':   round(sum(co) / len(co), 2) if co else None,
        }
    return daily

def main():
    content = open('lib/constants/cities.ts', encoding='utf-8').read()
    match = re.search(r'export const CITIES_REGISTRY: CityMeta\[\] = (\[.*?\]);', content, re.DOTALL)
    registry = json.loads(match.group(1))
    reg_by_id = {c['id']: c for c in registry}
    
    missing_ids = ['gl-cairo', 'gl-doha', 'gl-frankfurt', 'gl-geneva', 'gl-riodejaneiro', 'gl-nairobi', 'gl-lagos']
    
    summary_path = 'data/processed/history_summary.json'
    summary = json.load(open(summary_path, 'r', encoding='utf-8'))
    
    for cid in missing_ids:
        c = reg_by_id.get(cid)
        if not c:
            continue
        print(f"Fetching real observational history for {c['nameZh']} ({c['nameEn']} - {cid})...")
        try:
            daily = fetch_open_meteo_history(c['latitude'], c['longitude'])
            print(f"  -> Fetched {len(daily)} days of real history.")
            
            # Save file to public/data/history/{cid}.json
            out_file = f"public/data/history/{cid}.json"
            with open(out_file, 'w', encoding='utf-8') as f:
                json.dump({'id': cid, 'meta': c, 'daily': daily}, f, ensure_ascii=False, separators=(',', ':'))
            
            # Compute annual summary
            year_days = defaultdict(dict)
            for d_str, row in daily.items():
                y = int(d_str[:4])
                year_days[y][d_str] = row
            
            annual_trends = []
            for y in sorted(year_days.keys()):
                days_dict = year_days[y]
                total_days = len(days_dict)
                if total_days < 30: continue
                
                pm25_vals = [r['pm25'] for r in days_dict.values() if r.get('pm25') is not None and r['pm25'] > 0]
                pm10_vals = [r['pm10'] for r in days_dict.values() if r.get('pm10') is not None and r['pm10'] > 0]
                
                pm25_avg = round(sum(pm25_vals) / len(pm25_vals), 1) if pm25_vals else 0
                pm10_avg = round(sum(pm10_vals) / len(pm10_vals), 1) if pm10_vals else 0
                
                cn_aqis = [evaluate_day_aqi(r, 'CN') for r in days_dict.values()]
                us_aqis = [evaluate_day_aqi(r, 'US') for r in days_dict.values()]
                
                cn_comp = sum(1 for a in cn_aqis if a <= 100)
                us_comp = sum(1 for a in us_aqis if a <= 100)
                cn_polluted = total_days - cn_comp
                us_polluted = total_days - us_comp
                
                cn_heavy = sum(1 for a in cn_aqis if a > 200)
                us_heavy = sum(1 for a in us_aqis if a > 150)
                
                annual_trends.append({
                    'year': y,
                    'daysCount': total_days,
                    'pm25Avg': pm25_avg,
                    'pm10Avg': pm10_avg,
                    'goodDaysRatioCN': round((cn_comp / total_days) * 100),
                    'goodDaysRatioUS': round((us_comp / total_days) * 100),
                    'pollutedDaysCN': cn_polluted,
                    'pollutedDaysUS': us_polluted,
                    'heavyPollutionDaysCN': cn_heavy,
                    'heavyPollutionDaysUS': us_heavy,
                    'aqiAvgCN': round(sum(cn_aqis) / len(cn_aqis)) if cn_aqis else 0,
                    'aqiAvgUS': round(sum(us_aqis) / len(us_aqis)) if us_aqis else 0,
                })
            
            summary[cid] = annual_trends
            print(f"  -> Generated {len(annual_trends)} years of annual summary.")
            time.sleep(0.5)
        except Exception as e:
            print(f"  -> ERROR fetching {cid}: {e}")
            # Write fallback empty daily file so never 404
            out_file = f"public/data/history/{cid}.json"
            if not os.path.exists(out_file):
                with open(out_file, 'w', encoding='utf-8') as f:
                    json.dump({'id': cid, 'meta': c, 'daily': {}}, f, ensure_ascii=False)
    
    with open(summary_path, 'w', encoding='utf-8') as f:
        json.dump(summary, f, ensure_ascii=False, separators=(',', ':'))
    print("Done! All missing cities now have history JSON and summary entries.")

if __name__ == '__main__':
    main()
