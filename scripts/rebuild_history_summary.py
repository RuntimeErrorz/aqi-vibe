#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从 public/data/history/*.json 全量重建 history_summary.json（使用 shared/aqi-standards.json 单一标准源：
中国国标 HJ 633-2012 日均断点 + US EPA 2024 修订断点，并补齐纯 PM2.5 年度达标与超标天数）。
同时同步写入 data/processed/history_summary.json 与 public/data/history_summary.json。
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sync_daily_quotsoft import compute_year_trend_item

HISTORY_DIR = 'public/data/history'
SUMMARY_FILE = 'data/processed/history_summary.json'
PUBLIC_SUMMARY_FILE = 'public/data/history_summary.json'


def main():
    with open(SUMMARY_FILE, 'r', encoding='utf-8') as f:
        existing_summary = json.load(f)

    new_summary = {}
    missing_files = 0
    total_city_years = 0

    for cid in sorted(existing_summary.keys()):
        hist_file = os.path.join(HISTORY_DIR, f'{cid}.json')
        if not os.path.exists(hist_file):
            missing_files += 1
            new_summary[cid] = existing_summary[cid]
            continue

        with open(hist_file, 'r', encoding='utf-8') as hf:
            hdata = json.load(hf)

        daily_map = hdata.get('daily', {})
        years = sorted({int(d[:4]) for d in daily_map.keys() if len(d) >= 4 and d[:4].isdigit()})
        trends = []
        for y in years:
            item = compute_year_trend_item(y, daily_map)
            if item:
                trends.append(item)
                total_city_years += 1
        if trends:
            new_summary[cid] = trends

    for target in (SUMMARY_FILE, PUBLIC_SUMMARY_FILE):
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, 'w', encoding='utf-8') as f:
            json.dump(new_summary, f, ensure_ascii=False, separators=(',', ':'))

    print(
        f"[✓] Rebuilt history_summary.json for {len(new_summary)} cities "
        f"({total_city_years} city-years, missing={missing_files})."
    )


if __name__ == '__main__':
    main()
