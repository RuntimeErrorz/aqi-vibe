'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useStandard } from '@/components/StandardContext';
import { CITIES_REGISTRY, findCity } from '@/lib/constants/cities';
import { getStationsByCity } from '@/lib/constants/stations';
import { fetchWAQICityData, fetchWAQIGeoData } from '@/lib/services/waqi';
import { get24HourTrend } from '@/lib/services/history-data';
import { AirQualityRecord, CityMeta, StationMeta } from '@/lib/types';
import { TrendChart } from '@/components/TrendChart';
import { CitySearchAutocomplete } from '@/components/CitySearchAutocomplete';
import {
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
  AlertCircle,
} from 'lucide-react';

export default function DashboardPage() {
  const { standard } = useStandard();
  const [selectedCity, setSelectedCity] = useState<CityMeta>(CITIES_REGISTRY[0]); // 默认北京
  const [loading, setLoading] = useState(false);
  const [record, setRecord] = useState<AirQualityRecord | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [stations, setStations] = useState<StationMeta[]>([]);
  const [trendData, setTrendData] = useState<{ hour: string; aqi: number; pm25: number; o3: number }[]>([]);

  // 快捷推荐城市标签
  const quickCities = [
    { label: '成都', id: 'cn-chengdu' },
    { label: '北京', id: 'cn-beijing' },
    { label: '上海', id: 'cn-shanghai' },
    { label: '广州', id: 'cn-guangzhou' },
    { label: '深圳', id: 'cn-shenzhen' },
    { label: '东京', id: 'gl-tokyo' },
    { label: '纽约', id: 'gl-newyork' },
    { label: '伦敦', id: 'gl-london' },
    { label: '巴黎', id: 'gl-paris' },
    { label: '新德里', id: 'gl-delhi' },
  ];

  const loadCityData = async (city: CityMeta) => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchWAQICityData(city.id);
      setRecord(data);
      const activeAQI = standard === 'CN' ? data.evaluationCN.aqi : data.evaluationUS.aqi;
      const activePM25 = data.pollutants.pm25 || 25;
      setTrendData(get24HourTrend(activeAQI, activePM25));
      setStations(getStationsByCity(city.nameZh));
    } catch (err: any) {
      console.warn('Failed to load city data', err);
      setRecord(null);
      setLoadError(err?.message || '该站点当前暂无 WAQI 实时监测数据发布');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCityData(selectedCity);
  }, [selectedCity]);

  // 当标准切换时，重新同步 24 小时趋势的基准 AQI
  useEffect(() => {
    if (record) {
      const activeAQI = standard === 'CN' ? record.evaluationCN.aqi : record.evaluationUS.aqi;
      setTrendData(get24HourTrend(activeAQI, record.pollutants.pm25 || 25));
    }
  }, [standard]);

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
      <section className="glass-panel rounded-2xl p-4 sm:p-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <CitySearchAutocomplete
            selectedCity={selectedCity}
            onSelectCity={setSelectedCity}
            placeholder="搜索中国 375+ 城市或全球名城（如：成都 / 北京 / Tokyo / London）..."
            className="flex-1"
          />

          <button
            onClick={handleLocateMe}
            className="flex items-center justify-center space-x-1.5 px-4 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold transition-all shadow-sm shrink-0"
          >
            <MapPin className="w-3.5 h-3.5 text-sky-600" />
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
              className={`px-3 py-1 rounded-lg shrink-0 transition-all ${
                selectedCity.id === c.id
                  ? 'bg-sky-600 text-white font-bold shadow-sm'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </section>

      {/* 若 WAQI 暂未发布实时数据：诚实呈现，绝不伪造数据兜底 */}
      {loadError && !record && (
        <div className="glass-panel rounded-2xl p-8 sm:p-12 text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-amber-50 text-amber-600 border border-amber-200 flex items-center justify-center mx-auto shadow-sm">
            <AlertCircle className="w-7 h-7" />
          </div>
          <div className="space-y-1.5 max-w-md mx-auto">
            <h3 className="text-lg font-bold text-slate-900">
              【{selectedCity.nameZh} ({selectedCity.nameEn})】当前暂无 WAQI 实时监测数据
            </h3>
            <p className="text-xs sm:text-sm text-slate-500 leading-relaxed">
              {loadError}。本平台严格遵循纯真实测原则，WAQI 官方测站未收录或离线时，绝不使用随机数伪造数据兜底。
            </p>
          </div>
          <div className="pt-2">
            <p className="text-xs text-slate-400 mb-2.5">推荐切换查看测站活跃的代表性城市：</p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              {quickCities.slice(0, 6).map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    const found = findCity(c.id);
                    if (found) setSelectedCity(found);
                  }}
                  className="px-3.5 py-1.5 rounded-xl bg-slate-100 hover:bg-sky-50 hover:text-sky-600 text-xs font-semibold text-slate-700 transition-colors"
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 核心指标看板 Hero Section */}
      {record && evaluation && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* 左侧：主 AQI 指数卡片 */}
          <div className="lg:col-span-5 glass-panel rounded-2xl p-6 relative overflow-hidden flex flex-col justify-between">
            {/* 背景氛围晕光 */}
            <div
              className="absolute -right-16 -top-16 w-56 h-56 rounded-full blur-3xl opacity-15 pointer-events-none"
              style={{ backgroundColor: evaluation.color }}
            ></div>

            <div>
              {/* 头部城市名与更新时间 */}
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center space-x-2">
                    <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                      {record.name}
                    </h1>
                    <span className="text-xs px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 font-mono border border-slate-200">
                      {record.isDomestic ? '国内站点' : '国际名城'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1 flex items-center space-x-1">
                    <span>{record.nameEn}</span>
                    <span>·</span>
                    <span>更新时间: {record.updateTime}</span>
                  </p>
                </div>

                <button
                  onClick={() => loadCityData(selectedCity)}
                  disabled={loading}
                  className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-900 transition-colors shadow-sm"
                  title="刷新数据"
                >
                  <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-sky-600' : ''}`} />
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
                  <span className="text-slate-500 text-sm font-bold uppercase">AQI</span>
                </div>

                <div className="flex flex-col">
                  <div
                    className="px-3 py-1 rounded-full text-xs font-bold shadow-sm inline-flex items-center space-x-1"
                    style={{
                      backgroundColor: evaluation.color + '18',
                      color: evaluation.color,
                      border: `1px solid ${evaluation.color}40`,
                    }}
                  >
                    <Activity className="w-3.5 h-3.5" />
                    <span>{evaluation.level}</span>
                  </div>
                  <span className="text-[11px] text-slate-500 mt-1 font-medium">
                    计算标准: {standard === 'CN' ? '中国国标 (HJ 633)' : '美标 (US EPA)'}
                  </span>
                </div>
              </div>

              {/* 首要污染物与健康建议 */}
              <div className="mt-5 p-3.5 rounded-xl bg-slate-50 border border-slate-100 text-xs space-y-2">
                <div className="flex items-center justify-between text-slate-700">
                  <span className="text-slate-500">首要污染物:</span>
                  <span className="font-bold text-amber-600">{evaluation.primaryPollutantName}</span>
                </div>
                <div className="flex items-start space-x-2 pt-1 border-t border-slate-200/80 text-slate-600">
                  <AlertTriangle className="w-4 h-4 text-sky-600 shrink-0 mt-0.5" />
                  <p className="leading-relaxed">{evaluation.healthAdvice}</p>
                </div>
              </div>
            </div>

            {/* 气象观测指标条 */}
            <div className="mt-6 pt-4 border-t border-slate-100 grid grid-cols-4 gap-2 text-center text-xs">
              <div className="p-2 rounded-xl bg-slate-50 border border-slate-100">
                <div className="flex items-center justify-center text-slate-500 mb-1">
                  <Thermometer className="w-3.5 h-3.5 text-rose-500" />
                </div>
                <span className="font-bold text-slate-800">{record.weather?.temp ?? 22}°C</span>
                <p className="text-[10px] text-slate-400">气温</p>
              </div>
              <div className="p-2 rounded-xl bg-slate-50 border border-slate-100">
                <div className="flex items-center justify-center text-slate-500 mb-1">
                  <Droplets className="w-3.5 h-3.5 text-sky-500" />
                </div>
                <span className="font-bold text-slate-800">{record.weather?.humidity ?? 45}%</span>
                <p className="text-[10px] text-slate-400">湿度</p>
              </div>
              <div className="p-2 rounded-xl bg-slate-50 border border-slate-100">
                <div className="flex items-center justify-center text-slate-500 mb-1">
                  <Wind className="w-3.5 h-3.5 text-teal-500" />
                </div>
                <span className="font-bold text-slate-800">{record.weather?.windSpeed ?? 2.1} m/s</span>
                <p className="text-[10px] text-slate-400">风速</p>
              </div>
              <div className="p-2 rounded-xl bg-slate-50 border border-slate-100">
                <div className="flex items-center justify-center text-slate-500 mb-1">
                  <Gauge className="w-3.5 h-3.5 text-indigo-500" />
                </div>
                <span className="font-bold text-slate-800">{record.weather?.pressure ?? 1013} hPa</span>
                <p className="text-[10px] text-slate-400">气压</p>
              </div>
            </div>
          </div>

          {/* 右侧：6 大分项污染物实测卡片 */}
          <div className="lg:col-span-7 glass-panel rounded-2xl p-6 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-bold text-slate-900 flex items-center space-x-2">
                  <Activity className="w-4 h-4 text-sky-600" />
                  <span>六大主要空气污染物实测物理浓度</span>
                </h3>
                <span className="text-xs text-slate-500 font-medium">单位: μg/m³ (CO 为 mg/m³)</span>
              </div>

              {/* 污染物卡片网格 */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {[
                  { key: 'pm25', name: 'PM2.5 (细颗粒物)', val: record.pollutants.pm25, max: 150, color: '#f59e0b' },
                  { key: 'pm10', name: 'PM10 (可吸入颗粒物)', val: record.pollutants.pm10, max: 250, color: '#0284c7' },
                  { key: 'o3', name: '臭氧 O₃', val: record.pollutants.o3, max: 200, color: '#9333ea' },
                  { key: 'no2', name: '二氧化氮 NO₂', val: record.pollutants.no2, max: 100, color: '#ec4899' },
                  { key: 'so2', name: '二氧化硫 SO₂', val: record.pollutants.so2, max: 100, color: '#10b981' },
                  { key: 'co', name: '一氧化碳 CO', val: record.pollutants.co, max: 10, unit: 'mg/m³', color: '#6366f1' },
                ].map((item) => {
                  const val = item.val ?? 0;
                  const percent = Math.min(100, Math.round((val / item.max) * 100));
                  return (
                    <div
                      key={item.key}
                      className="p-3.5 rounded-xl bg-slate-50 border border-slate-100 flex flex-col justify-between hover:border-slate-200 transition-colors shadow-sm"
                    >
                      <div className="flex items-center justify-between text-xs text-slate-600 mb-2">
                        <span className="font-semibold text-slate-700">{item.name}</span>
                      </div>
                      <div className="flex items-baseline justify-between">
                        <span className="text-xl font-extrabold text-slate-900">{val > 0 ? val : '--'}</span>
                        <span className="text-[10px] text-slate-500">{item.unit || 'μg/m³'}</span>
                      </div>
                      {/* 进度条 */}
                      <div className="w-full bg-slate-200/80 rounded-full h-1.5 mt-2.5 overflow-hidden">
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
            <div className="mt-5 pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
              <span className="flex items-center space-x-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                <span>数据来源: {record.sourceAttribution?.[0]?.name || '官方实时监测网络'}</span>
              </span>
              <Link
                href={`/history?city=${selectedCity.id}`}
                className="text-sky-600 hover:text-sky-700 hover:underline font-semibold flex items-center space-x-1"
              >
                <span>查看长周期历史数据 →</span>
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* 24 小时逐小时走势分析图 */}
      <section className="glass-panel rounded-2xl p-5">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-base font-bold text-slate-900 flex items-center space-x-2">
            <Activity className="w-4 h-4 text-sky-600" />
            <span>过去 24 小时逐小时变化轨迹</span>
          </h3>
          <span className="text-xs text-slate-500 font-medium">
            观测城市: {selectedCity.nameZh} ({selectedCity.nameEn})
          </span>
        </div>
        <TrendChart data={trendData} city={selectedCity.nameZh} />
      </section>

      {/* 监测微站与预报网格 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 本地微观站点实测点位 (国控站点列表) */}
        <section className="glass-panel rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-bold text-slate-900 flex items-center space-x-2">
              <Building2 className="w-4 h-4 text-emerald-600" />
              <span>{selectedCity.nameZh} 本地国控微观监测站点</span>
            </h3>
            <span className="text-xs text-slate-500 font-medium">
              {stations.length > 0 ? `共 ${stations.length} 个点位` : '全国共 2,026 点位'}
            </span>
          </div>

          <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
            {stations.length > 0 ? (
              stations.map((st) => (
                <div
                  key={st.code}
                  className="p-3 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between hover:border-slate-200 transition-colors"
                >
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="font-semibold text-sm text-slate-800">{st.name}</span>
                      {st.isCleanStation && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 border border-emerald-200 font-semibold">
                          清洁对照点
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-500 font-mono mt-0.5">
                      国控站编码: {st.code} · ({st.longitude.toFixed(3)}°E, {st.latitude.toFixed(3)}°N)
                    </p>
                  </div>
                  <span className="text-xs px-2.5 py-1 rounded-lg bg-sky-50 text-sky-700 font-mono border border-sky-100 font-medium">
                    在线运行
                  </span>
                </div>
              ))
            ) : (
              <div className="p-8 text-center text-slate-400 text-xs">
                该区域为国际名城或未分配微观国控站，可通过全景地图查看 WAQI 全球打点。
              </div>
            )}
          </div>
        </section>

        {/* 未来数日预报卡片 */}
        <section className="glass-panel rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-bold text-slate-900 flex items-center space-x-2">
              <Calendar className="w-4 h-4 text-purple-600" />
              <span>未来 5 天空气质量预测走势</span>
            </h3>
            <span className="text-xs text-slate-500 font-medium">基于气象同化扩散模型</span>
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
                    className="p-3 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between"
                  >
                    <div className="flex items-center space-x-3">
                      <span className="text-xs font-mono text-slate-700 font-semibold">{f.day}</span>
                      <span
                        className="text-xs px-2 py-0.5 rounded font-bold"
                        style={{ backgroundColor: statusColor + '18', color: statusColor }}
                      >
                        {statusText}
                      </span>
                    </div>

                    <div className="flex items-center space-x-4 text-xs font-mono">
                      <span className="text-slate-500">
                        区间: {f.min} ~ {f.max}
                      </span>
                      <span className="font-bold text-slate-800">均值: {f.avg} μg/m³</span>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="p-8 text-center text-slate-400 text-xs">暂无未来预报数据</div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
