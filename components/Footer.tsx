import React from 'react';
import { ExternalLink, ShieldCheck, Heart } from 'lucide-react';

export const Footer: React.FC = () => {
  return (
    <footer className="w-full border-t border-slate-200 bg-white mt-16 py-10 text-xs text-slate-500">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 md:grid-cols-3 gap-8">
        <div>
          <div className="flex items-center space-x-2 text-slate-900 font-semibold text-sm mb-3">
            <span>AQI-Vibe 空气质量平台</span>
          </div>
          <p className="leading-relaxed text-slate-600">
            融合中国 375+ 城市、2026+ 国控站点微观数据与全球名城宏观观测，提供自 2014 年以来的逐小时长周期分析与实时健康指导。
          </p>
          <div className="mt-3 flex items-center space-x-1.5 text-emerald-600 text-[11px]">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>支持 Cloudflare Pages / Workers 0 成本边缘部署</span>
          </div>
        </div>

        <div>
          <h4 className="text-slate-900 font-medium mb-3">多源数据合规与归属</h4>
          <ul className="space-y-1.5 text-slate-600">
            <li>
              <a href="https://waqi.info/" target="_blank" rel="noreferrer" className="hover:text-sky-600 flex items-center space-x-1">
                <span>WAQI (World Air Quality Index Project)</span>
                <ExternalLink className="w-2.5 h-2.5" />
              </a>
            </li>
            <li>
              <a href="https://quotsoft.net/air/" target="_blank" rel="noreferrer" className="hover:text-sky-600 flex items-center space-x-1">
                <span>QuotSoft 全国逐小时历史数据镜像库</span>
                <ExternalLink className="w-2.5 h-2.5" />
              </a>
            </li>
            <li>
              <a href="http://www.cnemc.cn/" target="_blank" rel="noreferrer" className="hover:text-sky-600 flex items-center space-x-1">
                <span>中国环境监测总站 (CNEMC) 官方发布平台</span>
                <ExternalLink className="w-2.5 h-2.5" />
              </a>
            </li>
            <li>
              <a href="https://openaq.org/" target="_blank" rel="noreferrer" className="hover:text-sky-600 flex items-center space-x-1">
                <span>OpenAQ 全球开放空气质量数据基金会</span>
                <ExternalLink className="w-2.5 h-2.5" />
              </a>
            </li>
          </ul>
        </div>

        <div>
          <h4 className="text-slate-900 font-medium mb-3">标准与健康免责</h4>
          <p className="leading-relaxed text-slate-600">
            实时与历史 AQI 依照中国国标 (HJ 633-2012) 或美标 (US EPA NowCast) 动态换算。监测数值受传感器清洗与气象剧烈波动影响可能存在修正，具体防护请结合当地气象与环保部门官方通告。
          </p>
          <p className="mt-3 text-slate-500 flex items-center space-x-1">
            <span>AQI-Vibe © 2026 · Built with</span>
            <Heart className="w-3 h-3 text-rose-500 fill-rose-500 mx-0.5 inline" />
            <span>for Clean Air & Blue Sky</span>
          </p>
        </div>
      </div>
    </footer>
  );
};
