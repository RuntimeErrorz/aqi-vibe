import glob
import json
import os
import re
import sys
from collections import defaultdict

sys.stdout.reconfigure(encoding='utf-8')

print("Starting Master Historical Consolidation Pipeline...")

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

def aqi_to_concentration(aqi, specie):
    if aqi is None or aqi <= 0 or specie not in US_BP:
        return aqi
    bp_aqi = US_BP['aqi']
    bp_conc = US_BP[specie]
    max_idx = min(len(bp_aqi) - 1, len(bp_conc) - 1)
    if aqi >= bp_aqi[max_idx]:
        return bp_conc[max_idx]
    for i in range(max_idx):
        if bp_aqi[i] <= aqi <= bp_aqi[i+1]:
            conc = ((bp_conc[i+1] - bp_conc[i]) / (bp_aqi[i+1] - bp_aqi[i])) * (aqi - bp_aqi[i]) + bp_conc[i]
            return round(conc, 1)
    return round(aqi, 1)

# 1. Load registry
with open('lib/constants/cities.ts', 'r', encoding='utf-8') as f:
    content = f.read()

match = re.search(r'export const CITIES_REGISTRY: CityMeta\[\] = (\[.*?\]);', content, re.DOTALL)
registry = json.loads(match.group(1))
print(f"Loaded {len(registry)} cities from CITIES_REGISTRY.")

city_by_id = {c['id']: c for c in registry}
city_by_zh = {c['nameZh']: c for c in registry}
city_by_en = {c['nameEn'].lower(): c for c in registry}

# 2. Load all QuotSoft yearly files
quotsoft_yearly_files = sorted(glob.glob('data/processed/quotsoft_yearly/quotsoft_*.json'))
print(f"Found {len(quotsoft_yearly_files)} QuotSoft yearly files.")

# Container: cityName -> dateStr -> metrics
quotsoft_all_daily = defaultdict(dict)
for qf in quotsoft_yearly_files:
    print(f"Reading {os.path.basename(qf)}...")
    with open(qf, 'r', encoding='utf-8') as f:
        y_data = json.load(f)
        for cname, dates in y_data.items():
            for d_str, row in dates.items():
                quotsoft_all_daily[cname][d_str] = row

print(f"Total Chinese cities in QuotSoft: {len(quotsoft_all_daily)}")

# 3. Load WAQI files for global cities + supplemental domestic
CITY_ALIASES = {
    'manhattan': ('New York', 'US'),
    'brooklyn': ('New York', 'US'),
    'queens': ('New York', 'US'),
    'the bronx': ('New York', 'US'),
    'staten island': ('New York', 'US'),
}

waqi_files = sorted(glob.glob('data/raw/waqi-covid19-airqualitydata-*.csv'))
waqi_records = defaultdict(lambda: defaultdict(dict))

for fp in waqi_files:
    print(f"Reading {os.path.basename(fp)}...")
    with open(fp, 'r', encoding='utf-8', errors='ignore') as f:
        for line in f:
            if line.startswith('#') or line.startswith('Date'): continue
            parts = line.strip().split(',')
            if len(parts) >= 8:
                date = parts[0]
                country = parts[1]
                city = parts[2]
                specie = parts[3]
                median = parts[7]
                
                if specie in ('pm25', 'pm10', 'o3', 'no2', 'so2', 'co'):
                    city_lower = city.lower()
                    if city_lower in CITY_ALIASES:
                        city, country = CITY_ALIASES[city_lower]
                    
                    try:
                        raw_aqi = float(median)
                        phys_val = aqi_to_concentration(raw_aqi, specie)
                        waqi_records[(city, country)][date][specie] = phys_val
                    except ValueError:
                        pass

print(f"Loaded {len(waqi_records)} WAQI targets.")

# 4. Harmonize into all_city_daily
all_city_daily = {}

# Domestic cities from QuotSoft
for c in registry:
    cid = c['id']
    name_zh = c['nameZh']
    name_en = c['nameEn']
    
    daily_dict = {}
    
    # Priority 1: QuotSoft official arithmetic means
    if name_zh in quotsoft_all_daily:
        for d_str, row in quotsoft_all_daily[name_zh].items():
            daily_dict[d_str] = row
    
    # Priority 2: WAQI supplement on missing dates
    waqi_key = (name_en, 'CN')
    if waqi_key not in waqi_records: waqi_key = (name_zh, 'CN')
    if waqi_key not in waqi_records: waqi_key = (name_en.title(), 'CN')
    
    if waqi_key in waqi_records:
        for d_str, row in waqi_records[waqi_key].items():
            if d_str not in daily_dict:
                daily_dict[d_str] = row
            else:
                for sp in ('pm25', 'pm10', 'o3', 'no2', 'so2', 'co'):
                    if daily_dict[d_str].get(sp) is None and row.get(sp) is not None:
                        daily_dict[d_str][sp] = row[sp]
    
    if daily_dict:
        all_city_daily[cid] = {
            'meta': c,
            'daily': daily_dict,
        }

# Global cities from WAQI
for (city_name, country), dates in waqi_records.items():
    if country == 'CN':
        continue
    
    matched_meta = None
    if city_name.lower() in city_by_en:
        matched_meta = city_by_en[city_name.lower()]
    elif city_name.lower() in city_by_zh:
        matched_meta = city_by_zh[city_name.lower()]
    
    if matched_meta:
        cid = matched_meta['id']
        meta = matched_meta
        
        if cid not in all_city_daily:
            all_city_daily[cid] = {'meta': meta, 'daily': {}}
        
        for d_str, row in dates.items():
            if d_str not in all_city_daily[cid]['daily']:
                all_city_daily[cid]['daily'][d_str] = row
            else:
                existing = all_city_daily[cid]['daily'][d_str]
                for sp in ('pm25', 'pm10', 'o3', 'no2', 'so2', 'co'):
                    if row.get(sp) is not None:
                        if existing.get(sp) is None:
                            existing[sp] = row[sp]
                        else:
                            existing[sp] = round((existing[sp] + row[sp]) / 2, 1)

print(f"Total harmonized cities with historical data: {len(all_city_daily)}")

# 5. Precompute annual trends and save per-city files
os.makedirs('public/data/history', exist_ok=True)
os.makedirs('data/processed', exist_ok=True)

annual_summary = {}
city_index = {}

for cid, item in all_city_daily.items():
    meta = item['meta']
    daily = item['daily']
    
    years_map = defaultdict(dict)
    for d_str, rec in daily.items():
        year = int(d_str[:4])
        years_map[year][d_str] = rec
    
    sorted_years = sorted(years_map.keys())
    
    city_annual_trends = []
    for y in sorted_years:
        year_days = years_map[y]
        total_days = len(year_days)
        if total_days < 30: # ignore partial fragments
            continue
        
        pm25_vals = [r['pm25'] for r in year_days.values() if r.get('pm25') is not None and r['pm25'] > 0]
        pm10_vals = [r['pm10'] for r in year_days.values() if r.get('pm10') is not None and r['pm10'] > 0]
        
        pm25_avg = round(sum(pm25_vals) / len(pm25_vals), 1) if pm25_vals else 0
        pm10_avg = round(sum(pm10_vals) / len(pm10_vals), 1) if pm10_vals else 0
        
        cn_aqis = [evaluate_day_aqi(r, 'CN') for r in year_days.values()]
        us_aqis = [evaluate_day_aqi(r, 'US') for r in year_days.values()]
        
        cn_compliant = sum(1 for aqi in cn_aqis if aqi <= 100)
        us_compliant = sum(1 for aqi in us_aqis if aqi <= 100)
        
        cn_heavy = sum(1 for aqi in cn_aqis if aqi > 200)
        us_heavy = sum(1 for aqi in us_aqis if aqi > 150)
        
        trend = {
            'year': y,
            'daysCount': total_days,
            'pm25Avg': pm25_avg,
            'pm10Avg': pm10_avg,
            'goodDaysRatioCN': round((cn_compliant / total_days) * 100),
            'goodDaysRatioUS': round((us_compliant / total_days) * 100),
            'heavyPollutionDaysCN': cn_heavy,
            'heavyPollutionDaysUS': us_heavy,
            'aqiAvgCN': round(sum(cn_aqis) / len(cn_aqis)) if cn_aqis else 0,
            'aqiAvgUS': round(sum(us_aqis) / len(us_aqis)) if us_aqis else 0,
        }
        city_annual_trends.append(trend)
    
    annual_summary[cid] = city_annual_trends
    city_index[cid] = {
        'id': cid,
        'nameZh': meta['nameZh'],
        'nameEn': meta['nameEn'],
        'country': meta['country'],
        'years': sorted_years,
        'daysCount': len(daily),
    }
    
    safe_id = re.sub(r'[^a-zA-Z0-9_\-]', '_', cid)
    out_file = os.path.join('public/data/history', f"{safe_id}.json")
    with open(out_file, 'w', encoding='utf-8') as f:
        json.dump({
            'id': cid,
            'nameZh': meta['nameZh'],
            'nameEn': meta['nameEn'],
            'country': meta['country'],
            'years': sorted_years,
            'daily': daily,
        }, f, ensure_ascii=False, separators=(',', ':'))

# Save summaries
with open('data/processed/history_summary.json', 'w', encoding='utf-8') as f:
    json.dump(annual_summary, f, ensure_ascii=False, separators=(',', ':'))

with open('data/processed/history_index.json', 'w', encoding='utf-8') as f:
    json.dump(city_index, f, ensure_ascii=False, separators=(',', ':'))

print(f"Master consolidation complete! Saved summary for {len(annual_summary)} cities.")
