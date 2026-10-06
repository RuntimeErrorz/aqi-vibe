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
    <header className="sticky top-0 z-50 w-full bg-white/95 backdrop-blur-md border-b border-slate-200/80 shadow-sm">
      {/* 顶部微型跑马灯 */}
      <div className="bg-slate-50 px-4 py-1 text-xs text-slate-500 border-b border-slate-200/70 hidden md:flex items-center justify-between">
        <div className="flex items-center space-x-4 overflow-hidden">
          <span className="flex items-center text-emerald-600 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse mr-1.5"></span>
            实时数据网络就绪
          </span>
          <span className="text-slate-300">|</span>
          <span className="truncate">
            国内 375+ 城市 & 2,026 国控站点全量覆盖 · 历史数据追溯至 2014 年 · 支持 Cloudflare Edge 部署
          </span>
        </div>
        <div className="flex items-center space-x-3 text-slate-500">
          <span className="flex items-center space-x-1">
            <Globe className="w-3 h-3 text-sky-500" />
            <span>WAQI / QuotSoft 镜像双通道</span>
          </span>
        </div>
      </div>

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

        {/* 标准切换开关 */}
        <div className="flex items-center space-x-3">
          <button
            onClick={toggleStandard}
            className="flex items-center space-x-2 px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 text-xs transition-all shadow-sm"
            title="点击切换 AQI 计算标准 (中国国标 / 美国 EPA)"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            <span className="text-slate-500">标准:</span>
            <span className="font-bold text-slate-900">
              {standard === 'CN' ? '国标 (HJ 633)' : '美标 (US EPA)'}
            </span>
            <span className="text-[10px] text-sky-600 bg-sky-50 border border-sky-100 px-1 py-0.5 rounded">
              一键切换
            </span>
          </button>
        </div>
      </div>
    </header>
  );
};
