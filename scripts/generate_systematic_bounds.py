import json
import re
import math

# 1. 读取全部 940 城市
with open('lib/constants/cities.ts', 'r', encoding='utf-8') as f:
    text = f.read()

pattern = re.compile(r'"id":\s*"([^"]+)",[\s\S]*?"nameZh":\s*"([^"]+)",[\s\S]*?"nameEn":\s*"([^"]+)",[\s\S]*?"country":\s*"([^"]+)",[\s\S]*?"latitude":\s*([\d\.-]+),\s*"longitude":\s*([\d\.-]+)')
cities = []
for m in pattern.finditer(text):
    cities.append({
        'id': m.group(1),
        'nameZh': m.group(2),
        'nameEn': m.group(3),
        'country': m.group(4),
        'lat': float(m.group(5)),
        'lon': float(m.group(6))
    })

print(f"Total cities: {len(cities)}")

# 2. 我们使用规则网格算法 (Regular Grid Partitioning)
# 针对高密度区域（东亚、欧洲、北美）采用 7°x9°~8°x10° 细切片，WAQI 不会触发服务端下采样
# 其他开阔区域（澳洲、非洲、南美、中亚等）采用 12°x16°
# 并在边界处向外扩展 0.5 度 margin，确保跨网格边界城市两边的测站全部完整收录！

active_cells = {}
for c in cities:
    lat, lon = c['lat'], c['lon']
    # 密集工业/人口大洲：东亚、西欧中欧、北美
    is_dense = (15 <= lat <= 54 and 95 <= lon <= 146) or (35 <= lat <= 65 and -12 <= lon <= 35) or (24 <= lat <= 55 and -125 <= lon <= -65)
    lat_step = 7 if is_dense else 12
    lon_step = 9 if is_dense else 16

    c_lat_bin = math.floor(lat / lat_step) * lat_step
    c_lon_bin = math.floor(lon / lon_step) * lon_step
    key = (c_lat_bin, c_lon_bin)
    if key not in active_cells:
        active_cells[key] = (c_lat_bin, c_lon_bin, lat_step, lon_step)

print(f"Total active cells: {len(active_cells)}")

bounds_list = []
for key in sorted(active_cells.keys()):
    b_lat, b_lon, lat_step, lon_step = active_cells[key]
    min_lat = round(b_lat - 0.5, 1)
    max_lat = round(b_lat + lat_step + 0.5, 1)
    min_lon = round(b_lon - 0.5, 1)
    max_lon = round(b_lon + lon_step + 0.5, 1)
    bounds_list.append(f"{min_lat},{min_lon},{max_lat},{max_lon}")

# 校验 940 城市覆盖率
uncovered = []
for c in cities:
    covered = False
    for b in bounds_list:
        parts = [float(x) for x in b.split(',')]
        if parts[0] <= c['lat'] <= parts[2] and parts[1] <= c['lon'] <= parts[3]:
            covered = True
            break
    if not covered:
        uncovered.append(f"{c['nameZh']} ({c['lat']}, {c['lon']})")

print(f"Uncovered count: {len(uncovered)}")
if uncovered:
    print("Uncovered sample:", uncovered[:10])
assert len(uncovered) == 0, "All cities must be covered!"

with open('scripts/uniform_bounds.json', 'w', encoding='utf-8') as out:
    json.dump(bounds_list, out, indent=2, ensure_ascii=False)

print("Saved to scripts/uniform_bounds.json successfully.")

