'use client';

import React, { useState } from 'react';
import { useStandard } from '@/components/StandardContext';
import { CITIES_REGISTRY, findCity } from '@/lib/constants/cities';
import { CompareLineChart } from '@/components/CompareLineChart';
import { CompareRadarChart } from '@/components/CompareRadarChart';
import { BarChart3, Plus, X, Globe, Trophy, ArrowDownRight, Sparkles } from 'lucide-react';

const PALETTE = ['#0284c7', '#059669', '#d97706', '#db2777', '#7c3aed'];

export default function ComparePage() {
  const { standard } = useStandard();
  const [selectedCityIds, setSelectedCityIds] = useState<string[]>([
    'cn-chengdu',
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
      pm25: id === 'cn-chengdu' ? 36.5 : id === 'cn-beijing' ? 28.2 : id === 'gl-delhi' ? 95 : id === 'gl-london' ? 8.8 : 8.6,
      pm10: id === 'cn-chengdu' ? 62 : id === 'cn-beijing' ? 52 : id === 'gl-delhi' ? 165 : id === 'gl-london' ? 15 : 14,
      o3: id === 'cn-chengdu' ? 54 : id === 'cn-beijing' ? 48 : id === 'gl-delhi' ? 52 : id === 'gl-london' ? 38 : 42,
      no2: id === 'cn-chengdu' ? 28 : id === 'cn-beijing' ? 23 : id === 'gl-delhi' ? 48 : id === 'gl-london' ? 19 : 18,
      so2: id === 'cn-chengdu' ? 5 : id === 'cn-beijing' ? 3 : id === 'gl-delhi' ? 22 : id === 'gl-london' ? 2 : 2,
      co: id === 'cn-chengdu' ? 0.8 : id === 'cn-beijing' ? 0.6 : id === 'gl-delhi' ? 1.8 : id === 'gl-london' ? 0.4 : 0.4,
    };
  });

  return (
    <div className="space-y-6">
      {/* 顶部标题与选择沙盘 */}
      <div className="glass-panel rounded-2xl p-5">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-xl font-bold text-slate-900 flex items-center space-x-2">
                <BarChart3 className="w-5 h-5 text-sky-600" />
                <span>全球与国内名城空气质量改善沙盘对比</span>
              </h1>
              <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-sky-100 text-sky-700 border border-sky-200">
                {standard === 'CN' ? '国标 (HJ 633)' : '美标 (US EPA)'}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              在同一基准坐标系下，对比各主要经济体与城市近 10 年治理轨迹及污染物构成差异。
            </p>
          </div>

          <div className="flex items-center space-x-2 text-xs">
            <span className="text-slate-500">已选城市:</span>
            <span className="font-bold text-sky-600 bg-sky-50 px-2 py-0.5 rounded-lg border border-sky-100">
              {selectedCityIds.length} / 5
            </span>
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
                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all shadow-sm ${
                  isSelected
                    ? 'text-white'
                    : 'bg-slate-50 border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
                style={{
                  backgroundColor: isSelected ? activeObj?.color : undefined,
                  borderColor: isSelected ? activeObj?.color : undefined,
                }}
              >
                <span>{c.nameZh}</span>
                <span className="text-[10px] opacity-80">({c.country})</span>
                {isSelected ? <X className="w-3 h-3 ml-0.5" /> : <Plus className="w-3 h-3 ml-0.5" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* 对比亮点总结卡片 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="glass-panel rounded-2xl p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500 font-medium">历史改善幅度显著</span>
            <Trophy className="w-4 h-4 text-amber-500" />
          </div>
          <h3 className="text-xl font-bold text-slate-900 mt-1">中国 · 北京 & 成都</h3>
          <p className="text-xs text-emerald-600 mt-1 flex items-center space-x-1 font-medium">
            <ArrowDownRight className="w-3.5 h-3.5" />
            <span>PM2.5 自 2014 年起累计削减超 50% ~ 67%</span>
          </p>
        </div>

        <div className="glass-panel rounded-2xl p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500 font-medium">当前清洁基准</span>
            <Globe className="w-4 h-4 text-sky-600" />
          </div>
          <h3 className="text-xl font-bold text-slate-900 mt-1">日本 · 东京 / 英国 · 伦敦</h3>
          <p className="text-xs text-sky-600 mt-1 font-medium">年均浓度常年稳定在 8~10 μg/m³ 优级区间</p>
        </div>

        <div className="glass-panel rounded-2xl p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500 font-medium">盆地与复合治理</span>
            <BarChart3 className="w-4 h-4 text-purple-600" />
          </div>
          <h3 className="text-xl font-bold text-slate-900 mt-1">颗粒物 vs 臭氧协同</h3>
          <p className="text-xs text-slate-600 mt-1 font-medium">成都等盆地城市迈入冬季 PM2.5 与夏季 O₃ 协同攻坚</p>
        </div>
      </div>

      {/* 对比图表 1: 近 10 年 PM2.5 年均下降曲线对比 */}
      <section className="glass-panel rounded-2xl p-5">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-base font-bold text-slate-900 flex items-center space-x-2">
            <BarChart3 className="w-4 h-4 text-sky-600" />
            <span>2014 ~ 2025 年际 PM2.5 浓度改善轨迹横向对比</span>
          </h3>
          <span className="text-xs text-slate-500 font-medium">单位: μg/m³ (年均综合实测值)</span>
        </div>
        <CompareLineChart cities={activeCities} />
      </section>

      {/* 对比图表 2: 六大污染物雷达构成分析 */}
      <section className="glass-panel rounded-2xl p-5">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-base font-bold text-slate-900 flex items-center space-x-2">
            <BarChart3 className="w-4 h-4 text-purple-600" />
            <span>多城主要空气污染物构成雷达对比</span>
          </h3>
          <span className="text-xs text-slate-500 font-medium">颗粒物与气态污染物综合特征透视</span>
        </div>
        <CompareRadarChart cities={activeCities} />
      </section>
    </div>
  );
}
