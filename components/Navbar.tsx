'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useStandard } from './StandardContext';
import { Wind, Map, History, BarChart3, Globe, Sparkles } from 'lucide-react';

export const Navbar: React.FC = () => {
  const pathname = usePathname();
  const { standard, toggleStandard } = useStandard();

  const navLinks = [
    { href: '/', label: '实时总览', icon: Wind },
    { href: '/map', label: '全景地图', icon: Map },
    { href: '/history', label: '历史透视', icon: History },
    { href: '/compare', label: '全球沙盘', icon: BarChart3 },
  ];

  return (
    <header className="sticky top-0 z-50 w-full glass-panel border-b border-slate-800">
      {/* 顶部微型跑马灯 */}
      <div className="bg-slate-950/80 px-4 py-1 text-xs text-slate-400 border-b border-slate-800/60 hidden md:flex items-center justify-between">
        <div className="flex items-center space-x-4 overflow-hidden">
          <span className="flex items-center text-emerald-400 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse mr-1.5"></span>
            全球实时数据就绪
          </span>
          <span className="text-slate-500">|</span>
          <span className="truncate">
            国内 375+ 城市 & 2,026 国控站点覆盖 · 历史数据追溯至 2014 年 · 支持 Cloudflare Edge 部署
          </span>
        </div>
        <div className="flex items-center space-x-3 text-slate-400">
          <span className="flex items-center space-x-1">
            <Globe className="w-3 h-3 text-sky-400" />
            <span>WAQI / QuotSoft 镜像双通道</span>
          </span>
        </div>
      </div>

      {/* 主导航条 */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center space-x-3 group">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-sky-500 to-emerald-400 flex items-center justify-center shadow-lg shadow-sky-500/20 group-hover:scale-105 transition-transform">
            <Wind className="w-5 h-5 text-slate-950 stroke-[2.5]" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-bold text-lg tracking-tight text-white group-hover:text-sky-300 transition-colors">
                AQI-Vibe
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-sky-500/20 text-sky-300 font-mono border border-sky-500/30">
                EDGE
              </span>
            </div>
            <p className="text-[10px] text-slate-400 hidden sm:block">空气质量监测与历史统计</p>
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
                    ? 'bg-sky-500/15 text-sky-400 border border-sky-500/30'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{link.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* 标准切换开关 */}
        <div className="flex items-center space-x-3">
          <button
            onClick={toggleStandard}
            className="flex items-center space-x-2 px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-900/80 hover:bg-slate-800 text-xs transition-all shadow-sm"
            title="点击切换 AQI 计算标准"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-slate-400">标准:</span>
            <span className="font-semibold text-white">
              {standard === 'CN' ? '国标 (HJ 633)' : '美标 (US EPA)'}
            </span>
            <span className="text-[10px] text-slate-500 bg-slate-800 px-1 py-0.5 rounded">切换</span>
          </button>
        </div>
      </div>
    </header>
  );
};
