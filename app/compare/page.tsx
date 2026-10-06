'use client';

import React, { useState } from 'react';
import { useStandard } from '@/components/StandardContext';
import { CITIES_REGISTRY, findCity } from '@/lib/constants/cities';
import { CityMeta } from '@/lib/types';
import { getAnnualTrends, hasCityHistory } from '@/lib/services/history-data';
import { CompareLineChart } from '@/components/CompareLineChart';
import { CompareRadarChart } from '@/components/CompareRadarChart';
import { CitySearchAutocomplete } from '@/components/CitySearchAutocomplete';
import { GlobalRankingSandbox } from '@/components/GlobalRankingSandbox';
import { BarChart3, Plus, X, Globe, Trophy, ArrowDownRight, Check } from 'lucide-react';

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

  const handleRemoveCity = (cityId: string) => {
    if (selectedCityIds.length <= 1) {
      alert('请至少保留 1 个城市进行查看');
      return;
    }
    setSelectedCityIds(selectedCityIds.filter((id) => id !== cityId));
  };

  const toggleCity = (cityId: string) => {
    if (selectedCityIds.includes(cityId)) {
      handleRemoveCity(cityId);
    } else {
      if (selectedCityIds.length < 5) {
        setSelectedCityIds([...selectedCityIds, cityId]);
      } else {
        // 达到 5 城上限时，自动替换最后一个城市
        setSelectedCityIds([...selectedCityIds.slice(0, 4), cityId]);
      }
    }
  };

  const handleAddCity = (city: CityMeta) => {
    if (selectedCityIds.includes(city.id)) return;
    if (selectedCityIds.length >= 5) {
      // 替换最后一个城市
      setSelectedCityIds([...selectedCityIds.slice(0, 4), city.id]);
      return;
    }
    setSelectedCityIds([...selectedCityIds, city.id]);
  };

  const handleQuickAddCity = (cityId: string) => {
    if (selectedCityIds.includes(cityId)) return;
    if (selectedCityIds.length < 5) {
      setSelectedCityIds([...selectedCityIds, cityId]);
    } else {
      setSelectedCityIds([...selectedCityIds.slice(0, 4), cityId]);
    }
  };

  const activeCities = selectedCityIds.map((id, idx) => {
    const meta = findCity(id) || CITIES_REGISTRY[0];
    const trends = getAnnualTrends(meta.id, standard);
    const latest = trends[trends.length - 1];
    const pm25 = latest ? latest.pm25Avg : 25.0;
    const pm10 = latest ? (latest.pm10Avg > 0 ? latest.pm10Avg : Math.round(pm25 * 1.5)) : 40.0;
    return {
      id: meta.id,
      name: meta.nameZh,
      nameEn: meta.nameEn,
      color: PALETTE[idx % PALETTE.length],
      pm25,
      pm10,
      o3: Math.round(pm25 * 0.8 + 20),
      no2: Math.round(pm25 * 0.5 + 10),
      so2: Math.round(pm25 * 0.1 + 2),
      co: +(pm25 * 0.015 + 0.3).toFixed(1),
    };
  });

  return (
    <div className="space-y-6">
      {/* 1. 核心榜单模块: 全球沙盘排行榜置于最开头 */}
      <section>
        <GlobalRankingSandbox
          selectedCityIds={selectedCityIds}
          onToggleCity={toggleCity}
          onAddCity={handleQuickAddCity}
        />
      </section>

      {/* 2. 多城沙盘横向对比大盘 */}
      <div className="glass-panel rounded-2xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-xl font-bold text-slate-900 flex items-center space-x-2">
                <BarChart3 className="w-5 h-5 text-sky-600" />
                <span>全球与国内名城空气质量改善沙盘对比</span>
              </h2>
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
            <span className="font-bold text-sky-600 bg-sky-50 px-2.5 py-0.5 rounded-lg border border-sky-100">
              {selectedCityIds.length} / 5
            </span>
          </div>
        </div>

        {/* 当前正在对比的全部城市 (显式带有 ✕ 按钮，随时可叉去) */}
        <div className="pt-2">
          <div className="text-xs text-slate-500 font-medium mb-2 flex items-center justify-between">
            <span className="font-bold text-slate-700">
              当前对比城市（{selectedCityIds.length} / 5）：
            </span>
            {selectedCityIds.length > 1 && (
              <span className="text-slate-400">点击城市标签右侧 ✕ 即可随时移出对比</span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {activeCities.map((ac) => (
              <div
                key={ac.id}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-white shadow-sm transition-all"
                style={{ backgroundColor: ac.color }}
              >
                <span>{ac.name}</span>
                <span className="text-[10px] opacity-80 font-normal">
                  ({findCity(ac.id)?.country})
                </span>
                <button
                  type="button"
                  onClick={() => handleRemoveCity(ac.id)}
                  className="ml-1 p-0.5 rounded-full hover:bg-black/25 text-white/90 hover:text-white transition-colors cursor-pointer"
                  title={`移出对比: ${ac.name}`}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* 动态检索添加任意全球或国内城市 */}
        <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <CitySearchAutocomplete
            selectedCity={findCity(selectedCityIds[0]) || CITIES_REGISTRY[0]}
            onSelectCity={handleAddCity}
            placeholder="搜索全球或国内任意城市加入对比沙盘 (如: 杭州 / 巴黎 / 纽约)..."
            className="flex-1 sm:max-w-md"
            filterCity={(c) => hasCityHistory(c.id)}
          />
          <span className="text-xs text-slate-400">
            支持搜索并添加任意城市（上限 5 城，满额时添加将自动替换）
          </span>
        </div>

        {/* 快捷推荐城市标签池 */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs">
          <span className="text-slate-400 shrink-0">快捷添加:</span>
          {[
            'cn-chengdu',
            'cn-beijing',
            'cn-shanghai',
            'cn-guangzhou',
            'gl-london',
            'gl-tokyo',
            'gl-paris',
            'gl-delhi',
            'gl-newyork',
          ].map((quickId) => {
            const qc = findCity(quickId);
            if (!qc) return null;
            const isSelected = selectedCityIds.includes(quickId);
            return (
              <button
                key={quickId}
                disabled={isSelected}
                onClick={() => handleQuickAddCity(quickId)}
                className={`flex items-center space-x-1 px-2.5 py-1 rounded-lg shrink-0 transition-all ${
                  isSelected
                    ? 'bg-slate-100 text-slate-400 cursor-default'
                    : 'bg-slate-50 border border-slate-200 text-slate-700 hover:bg-sky-50 hover:text-sky-600 hover:border-sky-200 cursor-pointer'
                }`}
              >
                <span>{qc.nameZh}</span>
                {isSelected ? (
                  <Check className="w-3 h-3 text-emerald-500" />
                ) : (
                  <Plus className="w-3 h-3 text-slate-400" />
                )}
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
