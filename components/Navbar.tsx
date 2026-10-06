'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useStandard } from './StandardContext';
import { Wind, Map, History, BarChart3, Sparkles, Info } from 'lucide-react';

export const Navbar: React.FC = () => {
  const pathname = usePathname();
  const { standard, toggleStandard } = useStandard();

  const navLinks = [
    { href: '/', label: '实时总览', icon: Wind },
    { href: '/map', label: '全景地图', icon: Map },
    { href: '/history', label: '历史数据', icon: History },
    { href: '/compare', label: '全球沙盘', icon: BarChart3 },
  ];

  return (
    <header className="sticky top-0 z-[9999] w-full bg-white/95 backdrop-blur-md border-b border-slate-200/80 shadow-sm">
      {/* 主导航条 */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center space-x-3 group">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-sky-500 to-emerald-400 flex items-center justify-center shadow-md shadow-sky-500/20 group-hover:scale-105 transition-transform">
            <Wind className="w-5 h-5 text-white stroke-[2.5]" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-bold text-lg tracking-tight text-slate-900 group-hover:text-sky-600 transition-colors">
                AQI-Vibe
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-sky-100 text-sky-700 font-mono border border-sky-200">
                EDGE
              </span>
            </div>
            <p className="text-[10px] text-slate-500 hidden sm:block">空气质量监测与历史统计</p>
          </div>
        </Link>

        {/* 菜单项 */}
        <nav className="flex items-center space-x-1 sm:space-x-2">
          {navLinks.map((link) => {
            const Icon = link.icon;
            const isActive = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-sky-50 text-sky-600 border border-sky-200 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{link.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* 标准切换开关与说明悬停 Tip */}
        <div className="relative group">
          <button
            onClick={toggleStandard}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 text-xs transition-all shadow-sm cursor-pointer select-none"
            aria-label="切换 AQI 计算标准"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-500 shrink-0" />
            <span className="text-slate-500">标准:</span>
            <span className="font-bold text-slate-900">
              {standard === 'CN' ? '国标 (HJ 633)' : '美标 (US EPA)'}
            </span>
            <Info className="w-3.5 h-3.5 text-slate-400 group-hover:text-sky-500 transition-colors shrink-0 ml-0.5" />
          </button>

          {/* 悬停弹出说明卡片 */}
          <div className="absolute right-0 top-full pt-2 w-80 opacity-0 translate-y-1 pointer-events-none group-hover:opacity-100 group-hover:translate-y-0 group-hover:pointer-events-auto transition-all duration-200 z-50">
            <div className="bg-white/95 backdrop-blur-md rounded-2xl border border-slate-200/90 shadow-xl shadow-slate-900/10 p-4 text-xs space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                <div className="flex items-center space-x-1.5 font-bold text-slate-900">
                  <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                  <span>AQI 评价标准对照</span>
                </div>
                <span className="text-[10px] text-sky-600 bg-sky-50 px-2 py-0.5 rounded-full font-medium">
                  点击按钮一键切换
                </span>
              </div>

              {/* 国标模式卡片 */}
              <div
                className={`p-2.5 rounded-xl transition-all border ${
                  standard === 'CN'
                    ? 'bg-sky-50/80 border-sky-200 text-sky-950 shadow-sm'
                    : 'bg-slate-50/60 border-slate-100 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-slate-900">中国国标 (HJ 633-2012)</span>
                  {standard === 'CN' && (
                    <span className="text-[10px] bg-sky-600 text-white px-1.5 py-0.2 rounded font-bold">
                      当前生效
                    </span>
                  )}
                </div>
                <p className="text-[11px] leading-relaxed">
                  优良门槛为 <b>AQI ≤ 100</b>（包含一级优 PM2.5 ≤ 35 μg/m³、二级良 PM2.5 ≤ 75 μg/m³），更符合国内日常通报口径。
                </p>
              </div>

              {/* 美标模式卡片 */}
              <div
                className={`p-2.5 rounded-xl transition-all border ${
                  standard === 'US'
                    ? 'bg-amber-50/80 border-amber-200 text-amber-950 shadow-sm'
                    : 'bg-slate-50/60 border-slate-100 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-slate-900">美国标准 (US EPA NowCast)</span>
                  {standard === 'US' && (
                    <span className="text-[10px] bg-amber-600 text-white px-1.5 py-0.2 rounded font-bold">
                      当前生效
                    </span>
                  )}
                </div>
                <p className="text-[11px] leading-relaxed">
                  标准限值更严苛，<b>Good (优)</b> 仅对应 PM2.5 ≤ 12 μg/m³，<b>Moderate (良)</b> 对应 PM2.5 ≤ 35.4 μg/m³，超过 35.4 即进入不健康超标区间。
                </p>
              </div>

              <div className="text-[10px] text-slate-400 pt-1 flex items-center justify-between border-t border-slate-100">
                <span>💡 全站实时指标、日历与历史趋势即时联动重算</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};
