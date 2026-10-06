'use client';

import React, { useState } from 'react';
import { CITIES_REGISTRY, findCity } from '@/lib/constants/cities';
import { CompareLineChart } from '@/components/CompareLineChart';
import { CompareRadarChart } from '@/components/CompareRadarChart';
import { BarChart3, Plus, X, Globe, Trophy, ArrowDownRight } from 'lucide-react';

const PALETTE = ['#38bdf8', '#10b981', '#f59e0b', '#ec4899', '#a855f7'];

export default function ComparePage() {
  const [selectedCityIds, setSelectedCityIds] = useState<string[]>([
    'cn-beijing',
    'gl-london',
    'gl-tokyo',
    'gl-delhi',
  ]);

  const toggleCity = (cityId: string) => {
    if (selectedCityIds.includes(cityId)) {
      if (selectedCityIds.length > 2) {
        setSelectedCityIds(selectedCityIds.filter((id) => id !== cityId));
      } else {
        alert('请至少保留 2 个城市进行对比');
      }
    } else {
      if (selectedCityIds.length < 5) {
        setSelectedCityIds([...selectedCityIds, cityId]);
      } else {
        alert('最多支持同时对比 5 个城市');
      }
    }
  };

  const activeCities = selectedCityIds.map((id, idx) => {
    const meta = findCity(id) || CITIES_REGISTRY[0];
    return {
      id: meta.id,
      name: meta.nameZh,
      nameEn: meta.nameEn,
      color: PALETTE[idx % PALETTE.length],
      // 模拟对应城市的污染物指标
      pm25: id === 'cn-beijing' ? 32 : id === 'gl-delhi' ? 95 : id === 'gl-london' ? 9 : 8,
      pm10: id === 'cn-beijing' ? 58 : id === 'gl-delhi' ? 165 : id === 'gl-london' ? 15 : 14,
      o3: id === 'cn-beijing' ? 48 : id === 'gl-delhi' ? 52 : id === 'gl-london' ? 38 : 42,
      no2: id === 'cn-beijing' ? 24 : id === 'gl-delhi' ? 48 : id === 'gl-london' ? 19 : 18,
      so2: id === 'cn-beijing' ? 4 : id === 'gl-delhi' ? 22 : id === 'gl-london' ? 2 : 2,
      co: id === 'cn-beijing' ? 0.7 : id === 'gl-delhi' ? 1.8 : id === 'gl-london' ? 0.4 : 0.4,
    };
  });

  return (
    <div className="space-y-6">
      {/* 顶部标题与选择沙盘 */}
      <div className="glass-panel rounded-2xl p-5 shadow-xl">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-white flex items-center space-x-2">
              <BarChart3 className="w-5 h-5 text-sky-400" />
              <span>全球与国内名城空气质量改善沙盘对比</span>
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">
              在同一基准坐标系下，对比各主要经济体与城市近 10 年治理轨迹及污染物构成差异。
            </p>
          </div>

          <div className="flex items-center space-x-2 text-xs">
            <span className="text-slate-400">当前选择:</span>
            <span className="font-bold text-sky-400">{selectedCityIds.length} / 5</span>
          </div>
        </div>

        {/* 城市选择标签池 */}
        <div className="mt-4 flex flex-wrap gap-2">
          {CITIES_REGISTRY.slice(0, 18).map((c) => {
            const isSelected = selectedCityIds.includes(c.id);
            const activeObj = activeCities.find((ac) => ac.id === c.id);
            return (
              <button
                key={c.id}
                onClick={() => toggleCity(c.id)}
                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
                  isSelected
                    ? 'border text-white shadow-sm'
                    : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-white'
                }`}
                style={{
                  backgroundColor: isSelected ? activeObj?.color + '20' : undefined,
                  borderColor: isSelected ? activeObj?.color : undefined,
                }}
              >
                <span>{c.nameZh}</span>
                <span className="text-[10px] opacity-70">({c.country})</span>
                {isSelected ? <X className="w-3 h-3 ml-0.5" /> : <Plus className="w-3 h-3 ml-0.5" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* 对比亮点总结卡片 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="glass-panel rounded-2xl p-5 border border-slate-800">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">历史改善幅度第一</span>
            <Trophy className="w-4 h-4 text-amber-400" />
          </div>
          <h3 className="text-xl font-bold text-white mt-1">中国 · 北京</h3>
          <p className="text-xs text-emerald-400 mt-1 flex items-center space-x-1">
            <ArrowDownRight className="w-3.5 h-3.5" />
            <span>PM2.5 自 2014 年起累计削减 67.2%</span>
          </p>
        </div>

        <div className="glass-panel rounded-2xl p-5 border border-slate-800">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">当前最清洁基准</span>
            <Globe className="w-4 h-4 text-sky-400" />
          </div>
          <h3 className="text-xl font-bold text-white mt-1">日本 · 东京 / 英国 · 伦敦</h3>
          <p className="text-xs text-sky-400 mt-1">年均浓度常年稳定在 8~10 μg/m³ 优级区间</p>
        </div>

        <div className="glass-panel rounded-2xl p-5 border border-slate-800">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">复合型治理挑战</span>
            <BarChart3 className="w-4 h-4 text-purple-400" />
          </div>
          <h3 className="text-xl font-bold text-white mt-1">颗粒物 vs 臭氧协同</h3>
          <p className="text-xs text-slate-300 mt-1">中国城市迈入 PM2.5 与 O₃ 协同减排深水区</p>
        </div>
      </div>

      {/* 对比图表 1: 近 10 年 PM2.5 年均下降曲线对比 */}
      <section className="glass-panel rounded-2xl p-5 shadow-xl">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-base font-bold text-white flex items-center space-x-2">
            <BarChart3 className="w-4 h-4 text-sky-400" />
            <span>2014 ~ 2025 年际 PM2.5 浓度改善轨迹横向对比</span>
          </h3>
          <span className="text-xs text-slate-400">单位: μg/m³ (年均综合值)</span>
        </div>
        <CompareLineChart cities={activeCities} />
      </section>

      {/* 对比图表 2: 六大污染物雷达构成分析 */}
      <section className="glass-panel rounded-2xl p-5 shadow-xl">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-base font-bold text-white flex items-center space-x-2">
            <BarChart3 className="w-4 h-4 text-purple-400" />
            <span>多城主要空气污染物构成雷达对比</span>
          </h3>
          <span className="text-xs text-slate-400">颗粒物与气态污染物综合特征透视</span>
        </div>
        <CompareRadarChart cities={activeCities} />
      </section>
    </div>
  );
}
