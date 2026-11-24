'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useStandard } from './StandardContext';
import { HeaderCitySwitcher } from './HeaderCitySwitcher';
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
  Filter,
} from 'lucide-react';

export const Navbar: React.FC = () => {
  const pathname = usePathname();
  const { standard, toggleStandard, onlyPm25, toggleOnlyPm25, mounted } = useStandard();
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
      <div className="max-w-[1380px] mx-auto px-3 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-2">
        {/* 左侧：Logo + 全局城市检索与关注胶囊 */}
        <div className="flex items-center space-x-2 sm:space-x-3 min-w-0">
          <Link
            href="/"
            onClick={() => setIsMobileMenuOpen(false)}
            className="flex items-center space-x-2 sm:space-x-2.5 group shrink-0"
          >
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-sky-600 flex items-center justify-center shadow-md shadow-sky-600/20 group-hover:scale-105 transition-transform shrink-0">
              <Wind className="w-4 h-4 sm:w-5 sm:h-5 text-white stroke-[2.5]" />
            </div>
            <div className="hidden sm:block">
              <span className="font-bold text-base sm:text-lg tracking-tight text-slate-900 group-hover:text-sky-600 transition-colors whitespace-nowrap">
                AQI Vibe
              </span>
            </div>
          </Link>

          <div className="hidden lg:block">
            <HeaderCitySwitcher />
          </div>
          <div className="lg:hidden">
            <HeaderCitySwitcher compact={true} />
          </div>
        </div>

        {/* 桌面端菜单项 (lg 及以上展示，避免 768px 平板竖屏挤压折行) */}
        <nav className="hidden lg:flex items-center space-x-0.5 xl:space-x-1.5">
          {navLinks.map((link, idx) => {
            const Icon = link.icon;
            const isActive = pathname === link.href;
            return (
              <React.Fragment key={link.href}>
                {idx === 2 && (
                  <div
                    className="h-4 w-px bg-slate-200 mx-1 self-center"
                    aria-hidden="true"
                  />
                )}
                <Link
                  href={link.href}
                  className={`flex items-center space-x-1.5 px-2 xl:px-3 py-1.5 rounded-lg text-xs xl:text-sm font-medium whitespace-nowrap shrink-0 transition-all ${
                    isActive
                      ? 'bg-sky-50 text-sky-600 border border-sky-200 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 xl:w-4 xl:h-4 shrink-0" />
                  <span>{link.label}</span>
                </Link>
              </React.Fragment>
            );
          })}
        </nav>

        {/* 桌面端控制组：只看 PM2.5 开关 + 标准切换开关 (仅 lg 及以上展示) */}
        <div className="hidden lg:flex items-center space-x-1.5 xl:space-x-2.5 shrink-0">
          {/* 美标左侧：只看 PM2.5 纯净模式开关 */}
          <div className="relative group/pm25">
            <button
              type="button"
              onClick={toggleOnlyPm25}
              className={`flex items-center space-x-1.5 px-2.5 xl:px-3 py-1.5 rounded-xl border text-xs font-bold transition-all cursor-pointer select-none shadow-2xs whitespace-nowrap ${
                onlyPm25
                  ? 'bg-sky-600 text-white border-sky-600 shadow-sky-600/25 ring-2 ring-sky-300/40'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:text-slate-900'
              }`}
              title="开启/关闭仅看 PM2.5 模式 (全站实时指标、日历与排行仅按 PM2.5 评级)"
            >
              <Filter className="w-3.5 h-3.5 shrink-0" />
              <span className="whitespace-nowrap">只看 PM2.5</span>
              <span
                className={`w-2 h-2 rounded-full shrink-0 transition-all ${
                  onlyPm25 ? 'bg-white shadow-xs animate-pulse' : 'bg-slate-300'
                }`}
              />
            </button>

            {/* 悬停 Tip 浮层说明卡片 */}
            <div className="absolute left-0 top-full pt-2 w-72 opacity-0 translate-y-1 pointer-events-none group-hover/pm25:opacity-100 group-hover/pm25:translate-y-0 group-hover/pm25:pointer-events-auto transition-all duration-200 z-50">
              <div className="bg-white/95 backdrop-blur-md rounded-2xl border border-slate-200/90 shadow-xl shadow-slate-900/10 p-3.5 text-xs space-y-2">
                <div className="flex items-center justify-between pb-1.5 border-b border-slate-100">
                  <div className="flex items-center space-x-1.5 font-bold text-slate-900">
                    <Filter className="w-3.5 h-3.5 text-sky-600" />
                    <span>只看 PM2.5 纯净模式</span>
                  </div>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                      onlyPm25 ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {onlyPm25 ? '生效中' : '未开启'}
                  </span>
                </div>
                <p className="text-[11px] text-slate-600 leading-relaxed">
                  开启后，全站实时指数、365 天日历热力图、历史统计与城市排行榜将<b>仅以 PM2.5 单项指标</b>计算 AQI 等级与颜色，过滤掉臭氧 (O₃) 或扬沙 (PM10) 的复合拉升影响。
                </p>
              </div>
            </div>
          </div>

          {/* 右侧：标准切换开关与独立悬停 Tip */}
          <div className="flex w-auto xl:w-[186px] shrink-0 items-center justify-between rounded-xl border border-slate-200 bg-white shadow-sm hover:border-slate-300 transition-colors">
            {/* 左侧主体：点击切换标准 */}
            <button
              onClick={toggleStandard}
              className="flex-1 flex items-center space-x-1.5 px-2.5 xl:px-3 py-1.5 text-xs transition-colors hover:bg-slate-50 rounded-l-xl cursor-pointer select-none whitespace-nowrap"
              title="点击切换 AQI 计算标准 (美国 EPA / 中国国标)"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-500 shrink-0" />
              <span className="hidden xl:inline text-slate-500 shrink-0">标准:</span>
              <span className="xl:w-20 inline-flex items-center text-left shrink-0">
                {!mounted ? (
                  <span className="h-3.5 w-14 xl:w-16 bg-slate-200/90 rounded-md animate-pulse inline-block" />
                ) : (
                  <span className="font-bold text-slate-900 whitespace-nowrap">
                    {standard === 'US' ? '美标 (EPA)' : '国标 (HJ633)'}
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
                      <span className="font-bold text-slate-900">美国标准 (US EPA 2024)</span>
                      {standard === 'US' && (
                        <span className="text-[10px] bg-amber-600 text-white px-1.5 py-0.5 rounded font-bold">
                          当前生效
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] leading-relaxed">
                      采用 2024 年 5 月生效的最新修订标准：<b>一级优</b> 收紧至 PM2.5 ≤ 9.0 μg/m³，<b>二级良</b> 对应 PM2.5 ≤ 35.4 μg/m³，超过 35.4 进入不健康超标区间。
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
                      严格区分<b>实时小时</b>与<b>历史日均/O₃-8h</b>双套断点，优良门槛为 <b>AQI ≤ 100</b>（一级优 PM2.5 ≤ 35、二级良 ≤ 75 μg/m³）。
                    </p>
                  </div>

                  <div className="text-[10px] text-slate-400 pt-1 flex items-center justify-between border-t border-slate-100">
                    <span>💡 全站实时指标、日历与历史数据即时联动重算</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 移动端/平板竖屏顶栏右侧快捷区域：紧凑 PM2.5 切换 + 标准切换键 + 汉堡按钮 */}
        <div className="flex lg:hidden items-center space-x-1.5 shrink-0">
          {/* 移动端 PM2.5 纯净模式快捷切换 */}
          <button
            type="button"
            onClick={toggleOnlyPm25}
            className={`flex items-center space-x-1 px-2 py-1.5 rounded-xl border text-xs font-bold transition-all cursor-pointer select-none shadow-2xs whitespace-nowrap shrink-0 ${
              onlyPm25
                ? 'bg-sky-600 text-white border-sky-600'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
            title="点击开启/关闭只看 PM2.5 模式"
          >
            <Filter className="w-3 h-3 shrink-0" />
            <span>PM2.5</span>
          </button>

          {/* 移动端 1 键快速切换胶囊 */}
          <button
            onClick={toggleStandard}
            className="flex items-center space-x-1 px-2 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 shadow-xs text-xs font-bold transition-all cursor-pointer select-none whitespace-nowrap shrink-0"
            title="点击快速切换标准"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-500 shrink-0" />
            <span className="text-slate-800 whitespace-nowrap">
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
          className="fixed inset-0 top-16 bg-slate-900/30 backdrop-blur-xs z-40 lg:hidden animate-in fade-in duration-200"
          onClick={() => setIsMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* 移动端折叠抽屉面板 (Mobile Navigation Drawer) */}
      {isMobileMenuOpen && (
        <div className="lg:hidden relative z-50 border-t border-slate-200/90 bg-white shadow-2xl animate-in slide-in-from-top-2 duration-200 max-h-[calc(100vh-4rem)] overflow-y-auto">
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

            {/* 移动端 PM2.5 与标准切换控制区 */}
            <div className="pt-2 border-t border-slate-100 space-y-2">
              <button
                type="button"
                onClick={toggleOnlyPm25}
                className={`w-full flex items-center justify-between p-3 rounded-xl border text-xs font-semibold select-none cursor-pointer transition-all ${
                  onlyPm25
                    ? 'bg-sky-50 border-sky-200 text-sky-900 shadow-2xs'
                    : 'border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700'
                }`}
                title="开启/关闭仅看 PM2.5 模式"
              >
                <div className="flex items-center space-x-2">
                  <Filter className={`w-4 h-4 ${onlyPm25 ? 'text-sky-600' : 'text-slate-400'}`} />
                  <span className="text-slate-500">只看 PM2.5:</span>
                  <span className="font-bold text-slate-900">
                    {onlyPm25 ? '已启用 (仅看单项)' : '未启用 (综合全项)'}
                  </span>
                </div>
                <span
                  className={`text-[11px] font-bold px-2 py-0.5 rounded-md ${
                    onlyPm25 ? 'bg-sky-600 text-white' : 'bg-slate-200 text-slate-600'
                  }`}
                >
                  {onlyPm25 ? '已开启' : '点击开启'}
                </span>
              </button>

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
