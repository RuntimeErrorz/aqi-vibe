import glob
import json
import os
import re
import sys
from collections import defaultdict

sys.stdout.reconfigure(encoding='utf-8')

print("Starting Full Historical Air Quality Data Processing Pipeline...")

# 1. Breakpoints matching lib/aqi-calculator.ts
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
    if 'pm25' in rec and rec['pm25'] is not None:
        iaqi_vals.append(calc_iaqi(rec['pm25'], bp['pm25'], aqi_scale))
    if 'pm10' in rec and rec['pm10'] is not None:
        iaqi_vals.append(calc_iaqi(rec['pm10'], bp['pm10'], aqi_scale))
    if 'o3' in rec and rec['o3'] is not None:
        iaqi_vals.append(calc_iaqi(rec['o3'], bp['o3'], aqi_scale))
    if 'no2' in rec and rec['no2'] is not None:
        iaqi_vals.append(calc_iaqi(rec['no2'], bp['no2'], aqi_scale))
    if 'so2' in rec and rec['so2'] is not None:
        iaqi_vals.append(calc_iaqi(rec['so2'], bp['so2'], aqi_scale))
    if 'co' in rec and rec['co'] is not None:
        iaqi_vals.append(calc_iaqi(rec['co'], bp['co'], aqi_scale))
    
    if not iaqi_vals:
        return 0
    return max(iaqi_vals)

def get_level_and_color(aqi, standard='CN'):
    if standard == 'CN':
        if aqi <= 50:
            return '优 (一级)', '#10b981'
        elif aqi <= 100:
            return '良 (二级)', '#eab308'
        elif aqi <= 150:
            return '轻度污染 (三级)', '#f97316'
        elif aqi <= 200:
            return '中度污染 (四级)', '#ef4444'
        elif aqi <= 300:
            return '重度污染 (五级)', '#8b5cf6'
        else:
            return '严重污染 (六级)', '#7f1d1d'
    else:
        if aqi <= 50:
            return 'Good (优)', '#10b981'
        elif aqi <= 100:
            return 'Moderate (良)', '#eab308'
        elif aqi <= 150:
            return 'Unhealthy for Sensitive (轻度敏感)', '#f97316'
        elif aqi <= 200:
            return 'Unhealthy (中度不健康)', '#ef4444'
        elif aqi <= 300:
            return 'Very Unhealthy (严重不健康)', '#8b5cf6'
        else:
            return 'Hazardous (有害危险)', '#7f1d1d'

# 2. Load CITIES_REGISTRY
with open('lib/constants/cities.ts', 'r', encoding='utf-8') as f:
    content = f.read()

match = re.search(r'export const CITIES_REGISTRY: CityMeta\[\] = (\[.*?\]);', content, re.DOTALL)
registry = json.loads(match.group(1))
print(f"Loaded {len(registry)} existing cities from registry.")

# Build lookup tables
city_by_id = {c['id']: c for c in registry}
city_by_zh = {c['nameZh']: c for c in registry}
city_by_en = {c['nameEn'].lower(): c for c in registry}
city_by_slug = {c.get('waqiSlug', '').lower(): c for c in registry}

# City alias mappings
CITY_ALIASES = {
    'manhattan': ('New York', 'US'),
    'brooklyn': ('New York', 'US'),
    'queens': ('New York', 'US'),
    'the bronx': ('New York', 'US'),
    'staten island': ('New York', 'US'),
}

# Known global translations
NAME_ZH_MAP = {
    'New York': '纽约', 'London': '伦敦', 'Tokyo': '东京', 'Paris': '巴黎', 'Berlin': '柏林',
    'Sydney': '悉尼', 'Melbourne': '墨尔本', 'Toronto': '多伦多', 'Vancouver': '温哥华',
    'Singapore': '新加坡', 'Seoul': '首尔', 'Busan': '釜山', 'Bangkok': '曼谷', 'Chiang Mai': '清迈',
    'Hanoi': '河内', 'Ho Chi Minh City': '胡志明市', 'Kuala Lumpur': '吉隆坡', 'Jakarta': '雅加达',
    'Manila': '马尼拉', 'Delhi': '新德里', 'New Delhi': '新德里', 'Mumbai': '孟买', 'Kolkata': '加尔各答',
    'Dubai': '迪拜', 'Abu Dhabi': '阿布扎比', 'Cairo': '开罗', 'Johannesburg': '约翰内斯堡',
    'Cape Town': '开普敦', 'Moscow': '莫斯科', 'Saint Petersburg': '圣彼得堡', 'Madrid': '马德里',
    'Barcelona': '巴塞罗那', 'Rome': '罗马', 'Milan': '米兰', 'Amsterdam': '阿姆斯特丹',
    'Rotterdam': '鹿特丹', 'Brussels': '布鲁塞尔', 'Vienna': '维也纳', 'Zurich': '苏黎世',
    'Geneva': '日内瓦', 'Stockholm': '斯德哥尔摩', 'Copenhagen': '哥本哈根', 'Oslo': '奥斯陆',
    'Helsinki': '赫尔辛基', 'Warsaw': '华沙', 'Prague': '布拉格', 'Budapest': '布达佩斯',
    'Athens': '雅典', 'Istanbul': '伊斯坦布尔', 'Ankara': '安卡拉', 'Jerusalem': '耶路撒冷',
    'Tel Aviv': '特拉维夫', 'Riyadh': '利雅得', 'São Paulo': '圣保罗', 'Sao Paulo': '圣保罗',
    'Rio de Janeiro': '里约热内卢', 'Buenos Aires': '布宜诺斯艾利斯', 'Santiago': '圣地亚哥',
    'Lima': '利马', 'Bogota': '波哥大', 'Bogotá': '波哥大', 'Mexico City': '墨西哥城',
    'Los Angeles': '洛杉矶', 'San Francisco': '旧金山', 'Chicago': '芝加哥', 'Houston': '休斯敦',
    'Phoenix': '菲尼克斯', 'Philadelphia': '费城', 'San Antonio': '圣安东尼奥', 'San Diego': '圣迭戈',
    'Dallas': '达拉斯', 'Austin': '奥斯汀', 'Seattle': '西雅图', 'Denver': '丹佛', 'Boston': '波士顿',
    'Las Vegas': '拉斯维加斯', 'Miami': '迈阿密', 'Atlanta': '亚特兰大', 'Washington': '华盛顿',
    'Taipei': '台北', 'Kaohsiung': '高雄', 'Taichung': '台中', 'Tainan': '台南', 'Hong Kong': '香港',
    'Macau': '澳门', 'Macao': '澳门', 'Incheon': '仁川', 'Daegu': '大邱', 'Daejeon': '大田',
    'Gwangju': '光州', 'Ulsan': '蔚山', 'Suwon': '水原', 'Changwon': '昌原', 'Sejong': '世宗',
    'Montreal': '蒙特利尔', 'Calgary': '卡尔加里', 'Ottawa': '渥太华', 'Edmonton': '埃德蒙顿',
    'Brisbane': '布里斯班', 'Perth': '珀斯', 'Adelaide': '阿德莱德', 'Auckland': '奥克兰',
    'Frankfurt': '法兰克福', 'Munich': '慕尼黑', 'Hamburg': '汉堡', 'Cologne': '科隆',
    'Lyon': '里昂', 'Marseille': '马赛', 'Nice': '尼斯', 'Toulouse': '图卢兹',
}

# 3. Read Quotsoft China daily data
print("Loading Quotsoft China daily data...")
quotsoft_daily = {}
if os.path.exists('data/processed/quotsoft_cities_daily.json'):
    with open('data/processed/quotsoft_cities_daily.json', 'r', encoding='utf-8') as f:
        quotsoft_daily = json.load(f)
    print(f"Loaded Quotsoft data for {len(quotsoft_daily)} Chinese cities.")

# 4. Read WAQI 7 raw files
waqi_files = sorted(glob.glob('data/raw/waqi-covid19-airqualitydata-*.csv'))
print(f"Found {len(waqi_files)} WAQI files: {waqi_files}")

# Store: city_key -> date -> specie -> value
# city_key = (city_name, country)
waqi_records = defaultdict(lambda: defaultdict(dict))

for fp in waqi_files:
    print(f"Streaming {os.path.basename(fp)}...")
    with open(fp, 'r', encoding='utf-8', errors='ignore') as f:
        for line in f:
            if line.startswith('#') or line.startswith('Date'):
                continue
            parts = line.strip().split(',')
            if len(parts) >= 8:
                date = parts[0]
                country = parts[1]
                city = parts[2]
                specie = parts[3]
                median = parts[7]
                
                if specie in ('pm25', 'pm10', 'o3', 'no2', 'so2', 'co'):
                    # Check alias (e.g. Manhattan -> New York)
                    city_lower = city.lower()
                    if city_lower in CITY_ALIASES:
                        city, country = CITY_ALIASES[city_lower]
                    
                    try:
                        val = round(float(median), 1)
                        waqi_records[(city, country)][date][specie] = val
                    except ValueError:
                        pass

print(f"Loaded {len(waqi_records)} unique WAQI city-country targets.")

# 5. Harmonize cities and assign IDs
# City data container: city_id -> { meta, daily }
all_city_daily = {}
new_registry_entries = []

# First, process Chinese cities from QuotSoft
for c in registry:
    cid = c['id']
    name_zh = c['nameZh']
    name_en = c['nameEn']
    
    daily_dict = {}
    
    # 1. From QuotSoft
    if name_zh in quotsoft_daily:
        for d_str, row in quotsoft_daily[name_zh].items():
            daily_dict[d_str] = {
                'pm25': row.get('pm25'),
                'pm10': row.get('pm10'),
                'o3':   row.get('o3'),
                'no2':  row.get('no2'),
                'so2':  row.get('so2'),
                'co':   row.get('co'),
            }
    
    # 2. Check WAQI for this city (e.g. ('Beijing', 'CN') or ('Chengdu', 'CN'))
    waqi_key = (name_en, 'CN')
    if waqi_key not in waqi_records:
        waqi_key = (name_zh, 'CN')
    if waqi_key not in waqi_records:
        # Check title case
        waqi_key = (name_en.title(), 'CN')
        
    if waqi_key in waqi_records:
        for d_str, row in waqi_records[waqi_key].items():
            if d_str not in daily_dict:
                daily_dict[d_str] = {}
            for sp in ('pm25', 'pm10', 'o3', 'no2', 'so2', 'co'):
                if row.get(sp) is not None:
                    daily_dict[d_str][sp] = row[sp]
    
    if daily_dict:
        all_city_daily[cid] = {
            'meta': c,
            'daily': daily_dict,
        }

# Next, process Global cities from WAQI
for (city_name, country), dates in waqi_records.items():
    if country == 'CN':
        continue # Already processed under domestic
    
    # Check if exists in registry
    matched_meta = None
    if city_name.lower() in city_by_en:
        matched_meta = city_by_en[city_name.lower()]
    elif city_name.lower() in city_by_slug:
        matched_meta = city_by_slug[city_name.lower()]
    elif NAME_ZH_MAP.get(city_name) and NAME_ZH_MAP.get(city_name) in city_by_zh:
        matched_meta = city_by_zh[NAME_ZH_MAP.get(city_name)]
    
    if matched_meta:
        cid = matched_meta['id']
        meta = matched_meta
    else:
        # Generate new entry
        import unicodedata
        norm_name = unicodedata.normalize('NFKD', city_name).encode('ASCII', 'ignore').decode('utf-8')
        clean_slug = re.sub(r'[^a-zA-Z0-9\-_]', '-', norm_name.lower())
        clean_slug = re.sub(r'-+', '-', clean_slug).strip('-')
        if not clean_slug:
            clean_slug = f"city-{len(new_registry_entries)}"
        cid = f"gl-{clean_slug}"
        name_zh = NAME_ZH_MAP.get(city_name, city_name)
        meta = {
            'id': cid,
            'nameZh': name_zh,
            'nameEn': city_name,
            'country': country,
            'latitude': 30.0,
            'longitude': 0.0,
            'isDomestic': False,
            'waqiSlug': clean_slug,
        }
        new_registry_entries.append(meta)
        city_by_id[cid] = meta
    
    if cid not in all_city_daily:
        all_city_daily[cid] = {
            'meta': meta,
            'daily': {},
        }
    
    # Merge dates (averaging if multiple records, e.g. from boroughs)
    for d_str, row in dates.items():
        if d_str not in all_city_daily[cid]['daily']:
            all_city_daily[cid]['daily'][d_str] = row
        else:
            # Merge
            existing = all_city_daily[cid]['daily'][d_str]
            for sp in ('pm25', 'pm10', 'o3', 'no2', 'so2', 'co'):
                if row.get(sp) is not None:
                    if existing.get(sp) is None:
                        existing[sp] = row[sp]
                    else:
                        existing[sp] = round((existing[sp] + row[sp]) / 2, 1)

print(f"Total harmonized cities with historical data: {len(all_city_daily)}")
print(f"New global cities added to registry: {len(new_registry_entries)}")

# 6. Precompute Annual Summaries & Save Daily Files
os.makedirs('public/data/history', exist_ok=True)
os.makedirs('data/processed', exist_ok=True)

annual_summary = {} # city_id -> [AnnualTrend]
city_index = {} # city_id -> { meta, years, count }

for cid, item in all_city_daily.items():
    meta = item['meta']
    daily = item['daily']
    
    # Organize by year
    years_map = defaultdict(dict)
    for d_str, rec in daily.items():
        year = int(d_str[:4])
        years_map[year][d_str] = rec
    
    sorted_years = sorted(years_map.keys())
    
    # Compute annual stats
    city_annual_trends = []
    for y in sorted_years:
        year_days = years_map[y]
        total_days = len(year_days)
        if total_days == 0:
            continue
        
        pm25_vals = [r['pm25'] for r in year_days.values() if r.get('pm25') is not None]
        pm10_vals = [r['pm10'] for r in year_days.values() if r.get('pm10') is not None]
        
        pm25_avg = round(sum(pm25_vals) / len(pm25_vals), 1) if pm25_vals else None
        pm10_avg = round(sum(pm10_vals) / len(pm10_vals), 1) if pm10_vals else None
        
        # Calculate AQI under both standards
        cn_aqis = [evaluate_day_aqi(r, 'CN') for r in year_days.values()]
        us_aqis = [evaluate_day_aqi(r, 'US') for r in year_days.values()]
        
        cn_compliant = sum(1 for aqi in cn_aqis if aqi <= 100)
        us_compliant = sum(1 for aqi in us_aqis if aqi <= 100)
        
        cn_heavy = sum(1 for aqi in cn_aqis if aqi > 200)
        us_heavy = sum(1 for aqi in us_aqis if aqi > 150)
        
        trend = {
            'year': y,
            'daysCount': total_days,
            'pm25Avg': pm25_avg if pm25_avg is not None else 0,
            'pm10Avg': pm10_avg if pm10_avg is not None else 0,
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
    
    # Save per-city JSON to public/data/history/{safe_id}.json
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

# Save annual summary
summary_file = 'data/processed/history_summary.json'
with open(summary_file, 'w', encoding='utf-8') as f:
    json.dump(annual_summary, f, ensure_ascii=False, separators=(',', ':'))
print(f"Saved {summary_file} ({os.path.getsize(summary_file) / 1024:.1f} KB).")

# Save history index
index_file = 'data/processed/history_index.json'
with open(index_file, 'w', encoding='utf-8') as f:
    json.dump(city_index, f, ensure_ascii=False, separators=(',', ':'))
print(f"Saved {index_file} ({os.path.getsize(index_file) / 1024:.1f} KB).")

# 7. Update CITIES_REGISTRY with all new cities
updated_registry = registry + new_registry_entries
# Deduplicate by ID
seen = set()
dedup_registry = []
for c in updated_registry:
    if c['id'] not in seen:
        seen.add(c['id'])
        dedup_registry.append(c)

print(f"Total cities in updated registry: {len(dedup_registry)}")

# Write updated CITIES_REGISTRY to lib/constants/cities.ts
registry_json = json.dumps(dedup_registry, ensure_ascii=False, indent=2)
new_cities_ts = f"""import {{ CityMeta }} from '../types';

export const CITIES_REGISTRY: CityMeta[] = {registry_json};

export function createCustomCity(cityName: string): CityMeta {{
  const trimmed = cityName.trim();
  const isChinese = /[\\u4e00-\\u9fa5]/.test(trimmed);
  const cleanSlug = trimmed.toLowerCase().replace(/[^a-z0-9\\u4e00-\\u9fa5]/g, '-');
  return {{
    id: `custom-${{cleanSlug}}`,
    nameZh: trimmed,
    nameEn: trimmed,
    country: isChinese ? 'CN' : 'GLOBAL',
    latitude: 35.0,
    longitude: 105.0,
    isDomestic: isChinese,
    waqiSlug: cleanSlug,
  }};
}}

export function findCity(query: string): CityMeta | undefined {{
  if (!query) return undefined;
  const q = query.trim().toLowerCase();
  
  // 1. 精确匹配
  const exact = CITIES_REGISTRY.find(c => 
    c.id.toLowerCase() === q ||
    c.nameZh.toLowerCase() === q ||
    c.nameEn.toLowerCase() === q ||
    c.waqiSlug?.toLowerCase() === q
  );
  if (exact) return exact;

  // 2. 包含匹配 (如搜 "巴黎" 或 "paris" 或 "成" 或 "京")
  const partial = CITIES_REGISTRY.find(c => 
    c.nameZh.toLowerCase().includes(q) ||
    c.nameEn.toLowerCase().includes(q) ||
    c.id.toLowerCase().includes(q)
  );
  if (partial) return partial;

  // 3. 动态生成任意输入城市
  return createCustomCity(query);
}}

export function searchCities(query: string, limit = 8): CityMeta[] {{
  const q = query.trim().toLowerCase();
  if (!q) {{
    return CITIES_REGISTRY.slice(0, limit);
  }}

  const results: CityMeta[] = [];
  for (const c of CITIES_REGISTRY) {{
    if (
      c.nameZh.toLowerCase().includes(q) ||
      c.nameEn.toLowerCase().includes(q) ||
      c.id.toLowerCase().includes(q) ||
      c.province?.toLowerCase().includes(q) ||
      c.country.toLowerCase().includes(q)
    ) {{
      results.push(c);
      if (results.length >= limit) break;
    }}
  }}

  // 如果没有完全精确匹配的结果，把用户的输入作为一个可创建项置顶推荐
  const hasExact = results.some(r => r.nameZh.toLowerCase() === q || r.nameEn.toLowerCase() === q);
  if (!hasExact && q.length > 0) {{
    results.unshift(createCustomCity(query.trim()));
  }}

  return results;
}}
"""

with open('lib/constants/cities.ts', 'w', encoding='utf-8') as f:
    f.write(new_cities_ts)

print("Updated lib/constants/cities.ts successfully!")
print("Pipeline complete!")
