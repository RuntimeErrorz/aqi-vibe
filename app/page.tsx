'use client';

import React, { useState, useEffect } from 'react';
import { useStandard } from '@/components/StandardContext';
import { CITIES_REGISTRY, findCity } from '@/lib/constants/cities';
import { getStationsByCity } from '@/lib/constants/stations';
import { fetchWAQICityData, fetchWAQIGeoData } from '@/lib/services/waqi';
import { get24HourTrend } from '@/lib/services/history-data';
import { AirQualityRecord, CityMeta, StationMeta } from '@/lib/types';
import { TrendChart } from '@/components/TrendChart';
import {
  Search,
  MapPin,
  RefreshCw,
  Thermometer,
  Droplets,
  Wind,
  Gauge,
  Activity,
  AlertTriangle,
  CheckCircle2,
  Calendar,
  Building2,
  Sparkles,
} from 'lucide-react';

export default function DashboardPage() {
  const { standard } = useStandard();
  const [selectedCity, setSelectedCity] = useState<CityMeta>(CITIES_REGISTRY[0]); // 默认北京
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [record, setRecord] = useState<AirQualityRecord | null>(null);
  const [stations, setStations] = useState<StationMeta[]>([]);
  const [trendData, setTrendData] = useState<{ hour: string; aqi: number; pm25: number; o3: number }[]>([]);

  // 快捷推荐城市标签
  const quickCities = [
    { label: '北京', id: 'cn-beijing' },
    { label: '上海', id: 'cn-shanghai' },
    { label: '广州', id: 'cn-guangzhou' },
    { label: '深圳', id: 'cn-shenzhen' },
    { label: '成都', id: 'cn-chengdu' },
    { label: '东京', id: 'gl-tokyo' },
    { label: '纽约', id: 'gl-newyork' },
    { label: '伦敦', id: 'gl-london' },
    { label: '巴黎', id: 'gl-paris' },
    { label: '新德里', id: 'gl-delhi' },
  ];

  const loadCityData = async (city: CityMeta) => {
    setLoading(true);
    try {
      const data = await fetchWAQICityData(city.id);
      setRecord(data);
      const activeAQI = standard === 'CN' ? data.evaluationCN.aqi : data.evaluationUS.aqi;
      const activePM25 = data.pollutants.pm25 || 25;
      setTrendData(get24HourTrend(activeAQI, activePM25));
      setStations(getStationsByCity(city.nameZh));
    } catch (err) {
      console.error('Failed to load city data', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCityData(selectedCity);
  }, [selectedCity]);

  // 搜索处理
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    const match = findCity(searchQuery);
    if (match) {
      setSelectedCity(match);
      setSearchQuery('');
    } else {
      // 允许任意自由搜索城市
      const customCity: CityMeta = {
        id: searchQuery.trim(),
        nameZh: searchQuery.trim(),
        nameEn: searchQuery.trim(),
        country: 'CN',
        latitude: 39.9,
        longitude: 116.4,
        isDomestic: true,
        waqiSlug: searchQuery.trim(),
      };
      setSelectedCity(customCity);
      setSearchQuery('');
    }
  };

  // 定位处理
  const handleLocateMe = () => {
    if (!navigator.geolocation) {
      alert('您的浏览器不支持地理位置定位');
      return;
    }
    setLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          const data = await fetchWAQIGeoData(lat, lng);
          setRecord(data);
          const activeAQI = standard === 'CN' ? data.evaluationCN.aqi : data.evaluationUS.aqi;
          setTrendData(get24HourTrend(activeAQI, data.pollutants.pm25 || 25));
        } catch (err) {
          console.error(err);
        } finally {
          setLoading(false);
        }
      },
      () => {
        alert('无法获取当前坐标，请检查浏览器权限');
        setLoading(false);
      }
    );
  };

  const evaluation = record ? (standard === 'CN' ? record.evaluationCN : record.evaluationUS) : null;

  return (
    <div className="space-y-6">
      {/* 搜索与快速选择栏 */}
      <section className="glass-panel rounded-2xl p-4 sm:p-5 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <form onSubmit={handleSearch} className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="搜索中国 375+ 城市或全球名城（支持中英文，如：上海 / Tokyo / London）..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-24 py-2.5 rounded-xl bg-slate-900/90 border border-slate-700/80 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition-all"
            />
            <button
              type="submit"
              className="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1 bg-sky-500 hover:bg-sky-400 text-slate-950 font-medium text-xs rounded-lg transition-colors"
            >
              检索
            </button>
          </form>

          <button
            onClick={handleLocateMe}
            className="flex items-center justify-center space-x-1.5 px-4 py-2.5 rounded-xl border border-slate-700 bg-slate-900/80 hover:bg-slate-800 text-slate-200 text-xs font-medium transition-all shrink-0"
          >
            <MapPin className="w-3.5 h-3.5 text-sky-400" />
            <span>自动定位当前坐标</span>
          </button>
        </div>

        {/* 快捷城市标签 */}
        <div className="mt-3.5 flex items-center space-x-2 overflow-x-auto pb-1 text-xs">
          <span className="text-slate-500 shrink-0">热门城市:</span>
          {quickCities.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                const found = findCity(c.id);
                if (found) setSelectedCity(found);
              }}
              className={`px-2.5 py-1 rounded-lg shrink-0 transition-all ${
                selectedCity.id === c.id
                  ? 'bg-sky-500 text-slate-950 font-semibold shadow-sm'
                  : 'bg-slate-800/80 hover:bg-slate-700 text-slate-300'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </section>

      {/* 核心指标看板 Hero Section */}
      {record && evaluation && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* 左侧：主 AQI 指数卡片 */}
          <div className="lg:col-span-5 glass-panel rounded-2xl p-6 relative overflow-hidden flex flex-col justify-between shadow-2xl">
            {/* 背景氛围晕光 */}
            <div
              className="absolute -right-16 -top-16 w-56 h-56 rounded-full blur-3xl opacity-20 pointer-events-none"
              style={{ backgroundColor: evaluation.color }}
            ></div>

            <div>
              {/* 头部城市名与更新时间 */}
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center space-x-2">
                    <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                      {record.name}
                    </h1>
                    <span className="text-xs px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 font-mono border border-slate-700">
                      {record.isDomestic ? '国内站点' : '国际名城'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1 flex items-center space-x-1">
                    <span>{record.nameEn}</span>
                    <span>·</span>
                    <span>更新时间: {record.updateTime}</span>
                  </p>
                </div>

                <button
                  onClick={() => loadCityData(selectedCity)}
                  disabled={loading}
                  className="p-2 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
                  title="刷新数据"
                >
                  <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-sky-400' : ''}`} />
                </button>
              </div>

              {/* AQI 大字与等级徽章 */}
              <div className="mt-6 flex items-baseline space-x-4">
                <div className="flex items-baseline space-x-2">
                  <span
                    className="text-6xl sm:text-7xl font-black tracking-tight"
                    style={{ color: evaluation.color }}
                  >
                    {evaluation.aqi}
                  </span>
                  <span className="text-slate-400 text-sm font-semibold uppercase">AQI</span>
                </div>

                <div className="flex flex-col">
                  <div
                    className="px-3 py-1 rounded-full text-xs font-bold shadow-md inline-flex items-center space-x-1"
                    style={{
                      backgroundColor: evaluation.color + '25',
                      color: evaluation.color,
                      border: `1px solid ${evaluation.color}50`,
                    }}
                  >
                    <Activity className="w-3.5 h-3.5" />
                    <span>{evaluation.level}</span>
                  </div>
                  <span className="text-[11px] text-slate-400 mt-1">
                    当前标准: {standard === 'CN' ? '中国国标 HJ 633' : '美标 US EPA'}
                  </span>
                </div>
              </div>

              {/* 首要污染物与健康建议 */}
              <div className="mt-5 p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 text-xs space-y-2">
                <div className="flex items-center justify-between text-slate-300">
                  <span className="text-slate-400">首要污染物:</span>
                  <span className="font-semibold text-amber-400">{evaluation.primaryPollutantName}</span>
                </div>
                <div className="flex items-start space-x-2 pt-1 border-t border-slate-800/80 text-slate-300">
                  <AlertTriangle className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                  <p className="leading-relaxed">{evaluation.healthAdvice}</p>
                </div>
              </div>
            </div>

            {/* 气象观测指标条 */}
            <div className="mt-6 pt-4 border-t border-slate-800/80 grid grid-cols-4 gap-2 text-center text-xs">
              <div className="p-2 rounded-lg bg-slate-900/60">
                <div className="flex items-center justify-center text-slate-400 mb-1">
                  <Thermometer className="w-3.5 h-3.5 text-rose-400" />
                </div>
                <span className="font-bold text-white">{record.weather?.temp ?? 22}°C</span>
                <p className="text-[10px] text-slate-500">气温</p>
              </div>
              <div className="p-2 rounded-lg bg-slate-900/60">
                <div className="flex items-center justify-center text-slate-400 mb-1">
                  <Droplets className="w-3.5 h-3.5 text-sky-400" />
                </div>
                <span className="font-bold text-white">{record.weather?.humidity ?? 45}%</span>
                <p className="text-[10px] text-slate-500">湿度</p>
              </div>
              <div className="p-2 rounded-lg bg-slate-900/60">
                <div className="flex items-center justify-center text-slate-400 mb-1">
                  <Wind className="w-3.5 h-3.5 text-teal-400" />
                </div>
                <span className="font-bold text-white">{record.weather?.windSpeed ?? 2.1} m/s</span>
                <p className="text-[10px] text-slate-500">风速</p>
              </div>
              <div className="p-2 rounded-lg bg-slate-900/60">
                <div className="flex items-center justify-center text-slate-400 mb-1">
                  <Gauge className="w-3.5 h-3.5 text-indigo-400" />
                </div>
                <span className="font-bold text-white">{record.weather?.pressure ?? 1013} hPa</span>
                <p className="text-[10px] text-slate-500">气压</p>
              </div>
            </div>
          </div>

          {/* 右侧：6 大分项污染物与浓度雷达 */}
          <div className="lg:col-span-7 glass-panel rounded-2xl p-6 flex flex-col justify-between shadow-2xl">
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-bold text-white flex items-center space-x-2">
                  <Activity className="w-4 h-4 text-sky-400" />
                  <span>六大主要空气污染物实测浓度</span>
                </h3>
                <span className="text-xs text-slate-400">单位: μg/m³ (CO 为 mg/m³)</span>
              </div>

              {/* 污染物卡片网格 */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {[
                  { key: 'pm25', name: 'PM2.5 (细颗粒物)', val: record.pollutants.pm25, max: 150, color: '#f59e0b' },
                  { key: 'pm10', name: 'PM10 (可吸入颗粒物)', val: record.pollutants.pm10, max: 250, color: '#3b82f6' },
                  { key: 'o3', name: '臭氧 O₃', val: record.pollutants.o3, max: 200, color: '#a855f7' },
                  { key: 'no2', name: '二氧化氮 NO₂', val: record.pollutants.no2, max: 100, color: '#ec4899' },
                  { key: 'so2', name: '二氧化硫 SO₂', val: record.pollutants.so2, max: 100, color: '#10b981' },
                  { key: 'co', name: '一氧化碳 CO', val: record.pollutants.co, max: 10, unit: 'mg/m³', color: '#6366f1' },
                ].map((item) => {
                  const val = item.val ?? 0;
                  const percent = Math.min(100, Math.round((val / item.max) * 100));
                  return (
                    <div
                      key={item.key}
                      className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800/80 flex flex-col justify-between"
                    >
                      <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                        <span className="font-medium text-slate-300">{item.name}</span>
                      </div>
                      <div className="flex items-baseline justify-between">
                        <span className="text-xl font-bold text-white">{val > 0 ? val : '--'}</span>
                        <span className="text-[10px] text-slate-500">{item.unit || 'μg/m³'}</span>
                      </div>
                      {/* 进度条 */}
                      <div className="w-full bg-slate-800 rounded-full h-1.5 mt-2.5 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${percent}%`, backgroundColor: item.color }}
                        ></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 来源认证提示 */}
            <div className="mt-5 pt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
              <span className="flex items-center space-x-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>数据来源: {record.sourceAttribution?.[0]?.name || '官方实时监测网络'}</span>
              </span>
              <a
                href="/history"
                className="text-sky-400 hover:text-sky-300 hover:underline flex items-center space-x-1"
              >
                <span>查看长周期历史趋势 →</span>
              </a>
            </div>
          </div>
        </div>
      )}

      {/* 24 小时逐小时走势分析图 */}
      <section className="glass-panel rounded-2xl p-5 shadow-xl">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-base font-bold text-white flex items-center space-x-2">
            <Activity className="w-4 h-4 text-sky-400" />
            <span>过去 24 小时逐小时变化轨迹</span>
          </h3>
          <span className="text-xs text-slate-400">
            观测城市: {selectedCity.nameZh} ({selectedCity.nameEn})
          </span>
        </div>
        <TrendChart data={trendData} city={selectedCity.nameZh} />
      </section>

      {/* 监测微站与预报网格 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 本地微观站点实测点位 (国控站点列表) */}
        <section className="glass-panel rounded-2xl p-5 shadow-xl">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-bold text-white flex items-center space-x-2">
              <Building2 className="w-4 h-4 text-emerald-400" />
              <span>{selectedCity.nameZh} 本地国控微观监测站点</span>
            </h3>
            <span className="text-xs text-slate-400">
              {stations.length > 0 ? `共 ${stations.length} 个点位` : '全国共 2,026 点位'}
            </span>
          </div>

          <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
            {stations.length > 0 ? (
              stations.map((st) => (
                <div
                  key={st.code}
                  className="p-3 rounded-xl bg-slate-900/70 border border-slate-800/80 flex items-center justify-between hover:border-slate-700 transition-colors"
                >
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="font-semibold text-sm text-slate-200">{st.name}</span>
                      {st.isCleanStation && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                          清洁对照点
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-500 font-mono mt-0.5">
                      国控站编码: {st.code} · ({st.longitude.toFixed(3)}°E, {st.latitude.toFixed(3)}°N)
                    </p>
                  </div>
                  <span className="text-xs px-2.5 py-1 rounded-lg bg-sky-500/10 text-sky-400 font-mono border border-sky-500/20">
                    运行中
                  </span>
                </div>
              ))
            ) : (
              <div className="p-8 text-center text-slate-500 text-xs">
                该区域为国际名城或未分配微观国控站，可通过全景地图查看 WAQI 全球打点。
              </div>
            )}
          </div>
        </section>

        {/* 未来数日预报卡片 */}
        <section className="glass-panel rounded-2xl p-5 shadow-xl">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-bold text-white flex items-center space-x-2">
              <Calendar className="w-4 h-4 text-purple-400" />
              <span>未来 5 天空气质量预测走势</span>
            </h3>
            <span className="text-xs text-slate-400">基于气象同化扩散模型</span>
          </div>

          <div className="space-y-2.5">
            {record?.forecast?.pm25 && record.forecast.pm25.length > 0 ? (
              record.forecast.pm25.slice(0, 5).map((f) => {
                const isGood = f.avg <= 35;
                const isModerate = f.avg > 35 && f.avg <= 75;
                const statusText = isGood ? '优' : isModerate ? '良' : '轻度污染';
                const statusColor = isGood ? '#10b981' : isModerate ? '#eab308' : '#f97316';

                return (
                  <div
                    key={f.day}
                    className="p-3 rounded-xl bg-slate-900/70 border border-slate-800/80 flex items-center justify-between"
                  >
                    <div className="flex items-center space-x-3">
                      <span className="text-xs font-mono text-slate-300">{f.day}</span>
                      <span
                        className="text-xs px-2 py-0.5 rounded font-bold"
                        style={{ backgroundColor: statusColor + '20', color: statusColor }}
                      >
                        {statusText}
                      </span>
                    </div>

                    <div className="flex items-center space-x-4 text-xs font-mono">
                      <span className="text-slate-400">
                        区间: {f.min} ~ {f.max}
                      </span>
                      <span className="font-bold text-white">均值: {f.avg} μg/m³</span>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="p-8 text-center text-slate-500 text-xs">暂无未来预报数据</div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
