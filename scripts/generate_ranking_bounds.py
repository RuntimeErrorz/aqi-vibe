#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从 lib/constants/cities.ts 确定性预生成全网紧凑高清 WAQI 切片网格 shared/ranking-bounds.json。
供 Cloudflare Worker Cron 0ms 冷启动直接按 8 批 × 42 切片滚动抓取，彻底避免在 Worker 10ms CPU 预算内执行 O(N^2) 聚类。
"""

import json
import math
import os
import re

CITIES_FILE = 'lib/constants/cities.ts'
OUT_FILE = 'shared/ranking-bounds.json'
MAX_SPAN = 2.8
PADDING = 0.25


def main():
    with open(CITIES_FILE, 'r', encoding='utf-8') as f:
        txt = f.read()
    match = re.search(r'export const CITIES_REGISTRY: CityMeta\[\] = (\[.*?\]);', txt, re.DOTALL)
    if not match:
        raise RuntimeError('Failed to parse CITIES_REGISTRY')
    reg = json.loads(match.group(1))

    sorted_c = sorted(reg, key=lambda c: (math.floor(c['latitude'] / MAX_SPAN), c['longitude']))
    bounds = []
    for c in sorted_c:
        merged = False
        for b in bounds:
            min_lat = min(b[0], c['latitude'] - PADDING)
            max_lat = max(b[1], c['latitude'] + PADDING)
            min_lon = min(b[2], c['longitude'] - PADDING)
            max_lon = max(b[3], c['longitude'] + PADDING)
            if max_lat - min_lat <= MAX_SPAN and max_lon - min_lon <= MAX_SPAN:
                b[0], b[1], b[2], b[3] = min_lat, max_lat, min_lon, max_lon
                merged = True
                break
        if not merged:
            bounds.append([
                c['latitude'] - PADDING,
                c['latitude'] + PADDING,
                c['longitude'] - PADDING,
                c['longitude'] + PADDING,
            ])

    changed = True
    while changed:
        changed = False
        for i in range(len(bounds)):
            for j in range(i + 1, len(bounds)):
                min_lat = min(bounds[i][0], bounds[j][0])
                max_lat = max(bounds[i][1], bounds[j][1])
                min_lon = min(bounds[i][2], bounds[j][2])
                max_lon = max(bounds[i][3], bounds[j][3])
                if max_lat - min_lat <= MAX_SPAN and max_lon - min_lon <= MAX_SPAN:
                    bounds[i] = [min_lat, max_lat, min_lon, max_lon]
                    bounds.pop(j)
                    changed = True
                    break
            if changed:
                break

    formatted = [f"{b[0]:.2f},{b[2]:.2f},{b[1]:.2f},{b[3]:.2f}" for b in bounds]
    os.makedirs(os.path.dirname(OUT_FILE), exist_ok=True)
    with open(OUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(formatted, f, ensure_ascii=False, separators=(',', ':'))

    print(f"[✓] Generated {OUT_FILE}: {len(formatted)} slices ({math.ceil(len(formatted)/8)} slices/batch across 8 batches)")


if __name__ == '__main__':
    main()
