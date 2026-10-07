import glob
import json
import os
import sys

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

import math

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

def main():
    summary_path = 'data/processed/history_summary.json'
    print("Reading history_summary.json...")
    with open(summary_path, 'r', encoding='utf-8') as f:
        summary = json.load(f)
    
    history_files = glob.glob('public/data/history/*.json')
    print(f"Found {len(history_files)} city daily files.")
    
    updated_cities = 0
    for hf in history_files:
        cid = os.path.splitext(os.path.basename(hf))[0]
        if cid not in summary:
            continue
        
        with open(hf, 'r', encoding='utf-8') as f:
            cdata = json.load(f)
        daily = cdata.get('daily', {})
        if not daily:
            continue
        
        # Group daily records by year
        year_days = {}
        for d_str, rec in daily.items():
            y = int(d_str[:4])
            if y not in year_days:
                year_days[y] = []
            year_days[y].append(rec)
        
        for row in summary[cid]:
            y = row['year']
            if y in year_days:
                days = year_days[y]
                cn_aqis = [evaluate_day_aqi(r, 'CN') for r in days]
                us_aqis = [evaluate_day_aqi(r, 'US') for r in days]
                
                cn_comp = sum(1 for a in cn_aqis if a <= 100)
                us_comp = sum(1 for a in us_aqis if a <= 100)
                
                row['pollutedDaysCN'] = len(cn_aqis) - cn_comp
                row['pollutedDaysUS'] = len(us_aqis) - us_comp
        
        updated_cities += 1
    
    with open(summary_path, 'w', encoding='utf-8') as f:
        json.dump(summary, f, ensure_ascii=False, separators=(',', ':'))
    
    print(f"Updated polluted days for {updated_cities} cities in {summary_path} successfully!")

if __name__ == '__main__':
    main()
