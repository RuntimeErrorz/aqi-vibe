'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useStandard } from './StandardContext';
import {
  Wind,
  Map,
  History,
  BarChart3,
  Sparkles,
  HelpCircle,
  Menu,
  X,
  ChevronRight,
} from 'lucide-react';

export const Navbar: React.FC = () => {
  const pathname = usePathname();
  const { standard, toggleStandard, mounted } = useStandard();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // 路由跳转时自动关闭移动端菜单
  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [pathname]);

  // 当移动端抽屉打开时，锁定 body 滚动防止穿透
  useEffect(() => {
    if (isMobileMenuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isMobileMenuOpen]);

  // 按 Escape 键自动关闭移动端菜单
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsMobileMenuOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const navLinks = [
    { href: '/', label: '城市实况', icon: Wind },
    { href: '/map', label: '实时全景', icon: Map },
    { href: '/history', label: '历史数据', icon: History },
    { href: '/compare', label: '全球对比', icon: BarChart3 },
  ];

  return (
    <header className="sticky top-0 z-[9999] w-full bg-white/95 backdrop-blur-md border-b border-slate-200/80 shadow-sm">
      {/* 主导航条 */}
      <div className="max-w-[1380px] mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link
          href="/"
          onClick={() => setIsMobileMenuOpen(false)}
          className="flex items-center space-x-2.5 sm:space-x-3 group shrink-0"
        >
          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-sky-600 flex items-center justify-center shadow-md shadow-sky-600/20 group-hover:scale-105 transition-transform shrink-0">
            <Wind className="w-5 h-5 text-white stroke-[2.5]" />
          </div>
          <div>
            <span className="font-bold text-base sm:text-lg tracking-tight text-slate-900 group-hover:text-sky-600 transition-colors">
              AQI Vibe
            </span>
          </div>
        </Link>

        {/* 桌面端菜单项 (中大屏展示) */}
        <nav className="hidden md:flex items-center space-x-1 lg:space-x-1.5">
          {navLinks.map((link, idx) => {
            const Icon = link.icon;
            const isActive = pathname === link.href;
            return (
              <React.Fragment key={link.href}>
                {idx === 2 && (
                  <div
                    className="h-4 w-px bg-slate-200 mx-1 sm:mx-1.5 self-center"
                    aria-hidden="true"
                  />
                )}
                <Link
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
              </React.Fragment>
            );
          })}
        </nav>

        {/* 桌面端标准切换开关与独立悬停 Tip (仅 md 及以上展示) */}
        <div className="hidden md:flex w-[186px] shrink-0 items-center justify-between rounded-xl border border-slate-200 bg-white shadow-sm hover:border-slate-300 transition-colors">
          {/* 左侧主体：点击切换标准 */}
          <button
            onClick={toggleStandard}
            className="flex-1 flex items-center space-x-1.5 px-3 py-1.5 text-xs transition-colors hover:bg-slate-50 rounded-l-xl cursor-pointer select-none"
            title="点击切换 AQI 计算标准 (美国 EPA / 中国国标)"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-500 shrink-0" />
            <span className="text-slate-500 shrink-0">标准:</span>
            <span className="w-20 inline-flex items-center text-left shrink-0">
              {!mounted ? (
                <span className="h-3.5 w-16 bg-slate-200/90 rounded-md animate-pulse inline-block" />
              ) : (
                <span className="font-bold text-slate-900 whitespace-nowrap">
                  {standard === 'US' ? '美标 (US EPA)' : '国标 (HJ 633)'}
                </span>
              )}
            </span>
          </button>

          {/* 分隔细线 */}
          <div className="h-4 w-px bg-slate-200 shrink-0" />

          {/* 右侧独立 Tip 图标 */}
          <div className="relative group/tip shrink-0">
            <button
              type="button"
              className="p-1.5 text-slate-400 hover:text-sky-600 hover:bg-sky-50 rounded-r-xl transition-colors cursor-help flex items-center justify-center"
              aria-label="查看标准说明"
            >
              <HelpCircle className="w-3.5 h-3.5" />
            </button>

            {/* 仅在悬停右侧 Tip 时弹出的说明卡片 */}
            <div className="absolute right-0 top-full pt-2 w-80 opacity-0 translate-y-1 pointer-events-none group-hover/tip:opacity-100 group-hover/tip:translate-y-0 group-hover/tip:pointer-events-auto transition-all duration-200 z-50">
              <div className="bg-white/95 backdrop-blur-md rounded-2xl border border-slate-200/90 shadow-xl shadow-slate-900/10 p-4 text-xs space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                  <div className="flex items-center space-x-1.5 font-bold text-slate-900">
                    <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                    <span>AQI 评价标准对照</span>
                  </div>
                  <span className="text-[10px] text-sky-600 bg-sky-50 px-2 py-0.5 rounded-full font-medium">
                    左侧按钮可直接切换
                  </span>
                </div>

                {/* 美标模式卡片 */}
                <div
                  className={`p-2.5 rounded-xl transition-all border ${
                    standard === 'US'
                      ? 'bg-amber-50/80 border-amber-200 text-amber-950 shadow-sm'
                      : 'bg-slate-50/60 border-slate-100 text-slate-600'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-slate-900">美国标准 (US EPA NowCast)</span>
                    {standard === 'US' && (
                      <span className="text-[10px] bg-amber-600 text-white px-1.5 py-0.5 rounded font-bold">
                        当前生效
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] leading-relaxed">
                    标准限值更严苛，<b>一级优</b> 仅对应 PM2.5 ≤ 12 μg/m³，<b>二级良</b> 对应 PM2.5 ≤ 35.4 μg/m³，超过 35.4 即进入不健康超标区间。
                  </p>
                </div>

                {/* 国标模式卡片 */}
                <div
                  className={`p-2.5 rounded-xl transition-all border ${
                    standard === 'CN'
                      ? 'bg-sky-50/80 border-sky-200 text-sky-950 shadow-sm'
                      : 'bg-slate-50/60 border-slate-100 text-slate-600'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-slate-900">中国国标 (HJ 633-2012)</span>
                    {standard === 'CN' && (
                      <span className="text-[10px] bg-sky-600 text-white px-1.5 py-0.5 rounded font-bold">
                        当前生效
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] leading-relaxed">
                    优良门槛为 <b>AQI ≤ 100</b>（包含一级优 PM2.5 ≤ 35 μg/m³、二级良 PM2.5 ≤ 75 μg/m³），更符合国内日常通报口径。
                  </p>
                </div>

                <div className="text-[10px] text-slate-400 pt-1 flex items-center justify-between border-t border-slate-100">
                  <span>💡 全站实时指标、日历与历史数据即时联动重算</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 移动端顶栏右侧快捷区域：紧凑标准切换键 + 汉堡按钮 */}
        <div className="flex md:hidden items-center space-x-2">
          {/* 移动端 1 键快速切换胶囊 */}
          <button
            onClick={toggleStandard}
            className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 shadow-xs text-xs font-bold transition-all cursor-pointer select-none"
            title="点击快速切换标准"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-500 shrink-0" />
            <span className="text-slate-800">
              {!mounted ? (
                <span className="inline-block w-6 h-3 bg-slate-200 rounded animate-pulse" />
              ) : standard === 'US' ? (
                '美标'
              ) : (
                '国标'
              )}
            </span>
          </button>

          {/* 移动端汉堡菜单折叠按钮 */}
          <button
            type="button"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="p-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 shadow-xs transition-colors cursor-pointer"
            aria-label={isMobileMenuOpen ? '关闭菜单' : '打开菜单'}
          >
            {isMobileMenuOpen ? (
              <X className="w-5 h-5 text-slate-900" />
            ) : (
              <Menu className="w-5 h-5 text-slate-700" />
            )}
          </button>
        </div>
      </div>

      {/* 移动端背景半透明遮罩 (点击可直接关闭抽屉) */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 top-16 bg-slate-900/30 backdrop-blur-xs z-40 md:hidden animate-in fade-in duration-200"
          onClick={() => setIsMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* 移动端折叠抽屉面板 (Mobile Navigation Drawer) */}
      {isMobileMenuOpen && (
        <div className="md:hidden relative z-50 border-t border-slate-200/90 bg-white shadow-2xl animate-in slide-in-from-top-2 duration-200 max-h-[calc(100vh-4rem)] overflow-y-auto">
          <div className="px-4 py-4 space-y-4">
            {/* 移动端导航主链接 */}
            <div className="space-y-1">
              {navLinks.map((link) => {
                const Icon = link.icon;
                const isActive = pathname === link.href;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setIsMobileMenuOpen(false)}
                    className={`flex items-center justify-between p-3 rounded-xl text-sm font-semibold transition-all ${
                      isActive
                        ? 'bg-sky-50 text-sky-600 border border-sky-200/80 shadow-xs'
                        : 'text-slate-700 hover:bg-slate-50 hover:text-slate-900 border border-transparent'
                    }`}
                  >
                    <div className="flex items-center space-x-3">
                      <div
                        className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                          isActive
                            ? 'bg-sky-600 text-white shadow-xs'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                      </div>
                      <span>{link.label}</span>
                    </div>
                    <ChevronRight
                      className={`w-4 h-4 ${
                        isActive ? 'text-sky-600' : 'text-slate-300'
                      }`}
                    />
                  </Link>
                );
              })}
            </div>

            {/* 移动端标准切换 */}
            <div className="pt-2 border-t border-slate-100">
              <button
                onClick={toggleStandard}
                className="w-full flex items-center justify-between p-3 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 transition-colors text-xs font-semibold select-none cursor-pointer"
                title="点击切换 AQI 计算标准 (美国 EPA / 中国国标)"
              >
                <div className="flex items-center space-x-2">
                  <Sparkles className="w-4 h-4 text-amber-500 shrink-0" />
                  <span className="text-slate-500">计算标准:</span>
                  <span className="font-bold text-slate-900">
                    {!mounted ? '...' : standard === 'US' ? '美国标准 (US EPA)' : '中国国标 (HJ 633)'}
                  </span>
                </div>
                <span className="text-[11px] text-sky-600 font-medium">点击切换</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
};
