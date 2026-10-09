import React from 'react';
import { ExternalLink } from 'lucide-react';

export const Footer: React.FC = () => {
  return (
    <footer className="w-full border-t border-slate-200/80 bg-white/60 backdrop-blur-md mt-10 py-4 text-xs text-slate-500">
      <div className="max-w-[1380px] mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-3">
        {/* 左侧：品牌 + 极简定位与版权 */}
        <div className="flex items-center flex-wrap justify-center md:justify-start gap-2">
          <span className="font-bold text-slate-800 tracking-tight">AQI Vibe</span>
          <span className="text-slate-300">·</span>
          <span className="text-slate-500 text-[11px]">
            空气质量监测与历史统计平台 (US EPA / HJ 633)
          </span>
          <span className="text-slate-300 hidden sm:inline">·</span>
          <span className="text-slate-400 text-[11px] hidden sm:inline">© 2026</span>
        </div>

        {/* 右侧：紧凑数据源外链 */}
        <div className="flex items-center flex-wrap justify-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
          <span className="text-slate-400">数据源:</span>
          <a
            href="https://waqi.info/"
            target="_blank"
            rel="noreferrer"
            className="hover:text-sky-600 transition-colors inline-flex items-center gap-0.5"
          >
            <span>WAQI</span>
            <ExternalLink className="w-2.5 h-2.5 opacity-60" />
          </a>
          <span className="text-slate-200">/</span>
          <a
            href="https://quotsoft.net/air/"
            target="_blank"
            rel="noreferrer"
            className="hover:text-sky-600 transition-colors inline-flex items-center gap-0.5"
          >
            <span>QuotSoft</span>
            <ExternalLink className="w-2.5 h-2.5 opacity-60" />
          </a>
          <span className="text-slate-200">/</span>
          <a
            href="http://www.cnemc.cn/"
            target="_blank"
            rel="noreferrer"
            className="hover:text-sky-600 transition-colors inline-flex items-center gap-0.5"
          >
            <span>CNEMC</span>
            <ExternalLink className="w-2.5 h-2.5 opacity-60" />
          </a>
          <span className="text-slate-200">/</span>
          <a
            href="https://openaq.org/"
            target="_blank"
            rel="noreferrer"
            className="hover:text-sky-600 transition-colors inline-flex items-center gap-0.5"
          >
            <span>OpenAQ</span>
            <ExternalLink className="w-2.5 h-2.5 opacity-60" />
          </a>
        </div>
      </div>
    </footer>
  );
};

