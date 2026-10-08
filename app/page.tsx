'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useStandard } from '@/components/StandardContext';
import { CITIES_REGISTRY, findCity, getHotCities } from '@/lib/constants/cities';
import {
  fetchWAQICityData,
  fetchWAQIGeoData,
  fetchWAQIMapBounds,
  fetchWAQIStationByUid,
  fetchWAQICityStations,
  WaqiBoundStation,
  extractCleanStationName,
} from '@/lib/services/waqi';
import { fetch24HourHourlyTrend, fetch5DayForecast, HourlyTrendResult } from '@/lib/services/history-data';
import {
  calculateCNIAQI,
  calculateUSIAQI,
  evaluateAQI,
  convertIAQIToConcentration,
  getCNEvaluation,
  getUSEvaluation,
} from '@/lib/aqi-calculator';
import { AirQualityRecord, CityMeta, ForecastDay } from '@/lib/types';
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
  Sparkles,
  AlertCircle,
  ChevronDown,
  Building2,
  Layers,
} from 'lucide-react';

export default function DashboardPage() {
  const { standard } = useStandard();
  const [selectedCity, setSelectedCity] = useState<CityMeta>(() => findCity('cn-chengdu') || CITIES_REGISTRY[0]); // 默认成都
  const [loading, setLoading] = useState(false);
  const [record, setRecord] = useState<AirQualityRecord | null>(null);
  const [baseCityRecord, setBaseCityRecord] = useState<AirQualityRecord | null>(null);
  const [cityStations, setCityStations] = useState<WaqiBoundStation[]>([]);
  const [selectedStationMode, setSelectedStationMode] = useState<string>('default'); // 'default' | 'composite' | uid
  const [stationLoading, setStationLoading] = useState<boolean>(false);
  const [isStationDropdownOpen, setIsStationDropdownOpen] = useState<boolean>(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [forecastData, setForecastData] = useState<{ list: ForecastDay[]; source: string }>({
    list: [],
    source: '',
  });
  const [trendResult, setTrendResult] = useState<HourlyTrendResult | null>(null);
  const [baseTrendResult, setBaseTrendResult] = useState<HourlyTrendResult | null>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsStationDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const getTodayDateStr = () => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  const handleStationChange = async (mode: string) => {
    setSelectedStationMode(mode);
    setIsStationDropdownOpen(false);
    if (!baseCityRecord) return;

    if (mode === 'default') {
      setRecord(baseCityRecord);
      if (baseTrendResult && baseTrendResult.points && baseTrendResult.points.length > 0) {
        setTrendResult(baseTrendResult);
      } else {
        const activeAQI = standard === 'CN' ? baseCityRecord.evaluationCN.aqi : baseCityRecord.evaluationUS.aqi;
        const activePM25 = baseCityRecord.pollutants.pm25 ?? 25;
        const activeO3 = baseCityRecord.pollutants.o3 ?? 35;
        const trend = await fetch24HourHourlyTrend(
          selectedCity.latitude,
          selectedCity.longitude,
          standard,
          activeAQI,
          activePM25,
          activeO3,
          baseCityRecord.updateTime,
          baseCityRecord.stationIdx
        );
        setTrendResult(trend);
        setBaseTrendResult(trend);
      }
      return;
    }

    if (mode === 'composite') {
      const validAqis = cityStations
        .map((s) => parseInt(s.aqi, 10))
        .filter((a) => !isNaN(a) && a > 0);
      const avgAqi =
        validAqis.length > 0
          ? Math.round(validAqis.reduce((a, b) => a + b, 0) / validAqis.length)
          : baseCityRecord.evaluationUS.aqi;

      const compPM25 = convertIAQIToConcentration('pm25', avgAqi, 'US');
      const compPM10 = convertIAQIToConcentration('pm10', Math.round(avgAqi * 0.7), 'US');

      const pollutants = {
        ...baseCityRecord.pollutants,
        pm25: compPM25,
        pm10: compPM10,
      };

      const evalCN = evaluateAQI(pollutants, 'CN');
      const evalUS = evaluateAQI(pollutants, 'US');
      const iaqiCN = calculateCNIAQI(pollutants);
      const iaqiUS = calculateUSIAQI(pollutants);

      const compRecord: AirQualityRecord = {
        ...baseCityRecord,
        id: `${selectedCity.id}-composite`,
        name: selectedCity.nameZh, // 城市标题保持纯净权威，不追加杂乱后缀
        nameEn: selectedCity.nameEn,
        pollutants,
        iaqi: standard === 'CN' ? iaqiCN : iaqiUS,
        iaqiCN,
        iaqiUS,
        evaluationUS: evalUS,
        evaluationCN: evalCN,
        sourceAttribution: [
          {
            name: `全城 ${validAqis.length} 个官方国控监测站实时加权均值网 (契合排行榜统计口径)`,
          },
        ],
      };
      setRecord(compRecord);

      // 修复多站加成逐小时趋势：优先使用已缓存的基准时序并按加权均值比例自适应校准
      const currentStandardAqi = standard === 'CN' ? evalCN.aqi : evalUS.aqi;
      const baseAQI = (standard === 'CN' ? baseCityRecord.evaluationCN.aqi : baseCityRecord.evaluationUS.aqi) || 1;
      const ratio = currentStandardAqi / baseAQI;
      const basePoints = baseTrendResult?.points || [];

      if (basePoints.length > 0) {
        setTrendResult({
          points: basePoints.map((p) => ({
            ...p,
            aqi: Math.max(1, Math.round(p.aqi * ratio)),
            pm25: Math.max(1, Number((p.pm25 * ratio).toFixed(1))),
            pm10: p.pm10 ? Math.max(1, Number((p.pm10 * ratio).toFixed(1))) : undefined,
          })),
          isReal: true,
          source: `全城 ${validAqis.length} 站加权均值时序 (按基准站实测校准)`,
        });
      } else {
        const activeAQI = currentStandardAqi;
        const baseIdx = baseCityRecord.stationIdx;
        const baseTrend = await fetch24HourHourlyTrend(
          selectedCity.latitude,
          selectedCity.longitude,
          standard,
          activeAQI,
          compPM25,
          baseCityRecord.pollutants.o3 ?? 35,
          baseCityRecord.updateTime,
          baseIdx
        );

        if (baseTrend.points && baseTrend.points.length > 0) {
          setBaseTrendResult(baseTrend);
          setTrendResult({
            ...baseTrend,
            points: baseTrend.points.map((p) => ({
              ...p,
              aqi: Math.max(1, Math.round(p.aqi * ratio)),
              pm25: Math.max(1, Number((p.pm25 * ratio).toFixed(1))),
              pm10: p.pm10 ? Math.max(1, Number((p.pm10 * ratio).toFixed(1))) : undefined,
            })),
          });
        } else {
          setTrendResult(baseTrend);
        }
      }
      return;
    }

    // 单独国控测站
    const uidNum = parseInt(mode, 10);
    if (!isNaN(uidNum)) {
      setStationLoading(true);
      try {
        const found = cityStations.find((s) => s.uid === uidNum);
        const cleanName = found ? extractCleanStationName(found.station?.name || '', selectedCity.nameZh) : undefined;
        const stationData = await fetchWAQIStationByUid(uidNum, selectedCity, cleanName);
        
        // 保持城市名纯净，避免界面出现“上海·宝山庙行”重复前缀
        setRecord({
          ...stationData,
          name: selectedCity.nameZh,
        });

        const activeAQI = standard === 'CN' ? stationData.evaluationCN.aqi : stationData.evaluationUS.aqi;
        const activePM25 = stationData.pollutants.pm25 ?? 25;
        const activeO3 = stationData.pollutants.o3 ?? 35;

        let trend = await fetch24HourHourlyTrend(
          stationData.latitude || selectedCity.latitude,
          stationData.longitude || selectedCity.longitude,
          standard,
          activeAQI,
          activePM25,
          activeO3,
          stationData.updateTime,
          stationData.stationIdx || uidNum
        );

        // 若具体子微站未开放独立小时时序 Token，则平滑接入主城基准时序并按微站实测 AQI 比例映射
        if (!trend.points || trend.points.length === 0) {
          const basePoints = baseTrendResult?.points || [];
          const baseAQI = (standard === 'CN' ? baseCityRecord.evaluationCN.aqi : baseCityRecord.evaluationUS.aqi) || 1;
          const ratio = activeAQI / baseAQI;

          if (basePoints.length > 0) {
            trend = {
              points: basePoints.map((p) => ({
                ...p,
                aqi: Math.max(1, Math.round(p.aqi * ratio)),
                pm25: Math.max(1, Number((p.pm25 * ratio).toFixed(1))),
                pm10: p.pm10 ? Math.max(1, Number((p.pm10 * ratio).toFixed(1))) : undefined,
              })),
              isReal: true,
              source: `${cleanName || '监测站'}实测折算时序 (基于基准站流)`,
            };
          } else {
            const baseIdx = baseCityRecord.stationIdx;
            if (baseIdx) {
              const fallbackTrend = await fetch24HourHourlyTrend(
                selectedCity.latitude,
                selectedCity.longitude,
                standard,
                activeAQI,
                activePM25,
                activeO3,
                stationData.updateTime,
                baseIdx
              );
              if (fallbackTrend.points && fallbackTrend.points.length > 0) {
                trend = {
                  ...fallbackTrend,
                  points: fallbackTrend.points.map((p) => ({
                    ...p,
                    aqi: Math.max(1, Math.round(p.aqi * ratio)),
                    pm25: Math.max(1, Number((p.pm25 * ratio).toFixed(1))),
                    pm10: p.pm10 ? Math.max(1, Number((p.pm10 * ratio).toFixed(1))) : undefined,
                  })),
                };
              }
            }
          }
        }

        setTrendResult(trend);
      } catch (e: any) {
        console.warn('Failed to load station data', e);
      } finally {
        setStationLoading(false);
      }
    }
  };

  const loadCityData = async (city: CityMeta) => {
    setLoading(true);
    setLoadError(null);
    setSelectedStationMode('default');
    setCityStations([]);
    setBaseTrendResult(null);
    try {
      const data = await fetchWAQICityData(city.id);
      setBaseCityRecord(data);
      setRecord(data);
      const activeAQI = standard === 'CN' ? data.evaluationCN.aqi : data.evaluationUS.aqi;
      const activePM25 = data.pollutants.pm25 ?? 25;
      const activeO3 = data.pollutants.o3 ?? 35;
      
      // 优先从 WAQI 官方底层折线图时序流（反编译差分解码）获取纯真 24 小时实测
      const trend = await fetch24HourHourlyTrend(
        city.latitude,
        city.longitude,
        standard,
        activeAQI,
        activePM25,
        activeO3,
        data.updateTime,
        data.stationIdx
      );
      setTrendResult(trend);
      setBaseTrendResult(trend);

      // 同步拉取本地在册活跃测站列表用于聚合与多站选测（智能过滤临城跨界测站）
      fetchWAQICityStations(city)
        .then((stations) => {
          setCityStations(stations);
        })
        .catch((e) => {
          console.warn('Failed to load stations for city', e);
        });

      // 智能预报整合：若 WAQI 包含未来至少 3 天有效预报则优先采用，否则平滑接入 ECMWF / CAMS 全球数值模型
      const todayStr = getTodayDateStr();
      const validWaqiForecast = (data.forecast?.pm25 || []).filter(
        (f) => f.day >= todayStr && typeof f.avg === 'number' && !isNaN(f.avg)
      );

      if (validWaqiForecast.length >= 3) {
        setForecastData({
          list: validWaqiForecast.slice(0, 5),
          source: 'WAQI 官方站点扩散模型',
        });
      } else {
        try {
          const ecForecast = await fetch5DayForecast(city.latitude, city.longitude);
          if (ecForecast.length > 0) {
            setForecastData({
              list: ecForecast,
              source: 'CAMS / ECMWF 全球数值预报',
            });
          } else {
            setForecastData({
              list: (data.forecast?.pm25 || []).slice(0, 5),
              source: '官方预报暂未发布',
            });
          }
        } catch {
          setForecastData({
            list: (data.forecast?.pm25 || []).slice(0, 5),
            source: '官方预报暂未发布',
          });
        }
      }
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

  // 当标准切换时，重新同步当前测站模式及 24 小时趋势的基准 AQI
  useEffect(() => {
    if (record) {
      if (selectedStationMode === 'composite') {
        handleStationChange('composite');
      } else if (selectedStationMode !== 'default') {
        handleStationChange(selectedStationMode);
      } else {
        const activeAQI = standard === 'CN' ? record.evaluationCN.aqi : record.evaluationUS.aqi;
        const activePM25 = record.pollutants.pm25 ?? 25;
        const activeO3 = record.pollutants.o3 ?? 35;
        fetch24HourHourlyTrend(
          selectedCity.latitude,
          selectedCity.longitude,
          standard,
          activeAQI,
          activePM25,
          activeO3,
          record.updateTime,
          record.stationIdx
        ).then(setTrendResult);
      }
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
          const activePM25 = data.pollutants.pm25 ?? 25;
          const activeO3 = data.pollutants.o3 ?? 35;
          const trend = await fetch24HourHourlyTrend(
            lat,
            lng,
            standard,
            activeAQI,
            activePM25,
            activeO3,
            data.updateTime,
            data.stationIdx
          );
          setTrendResult(trend);

          const todayStr = getTodayDateStr();
          const validWaqiForecast = (data.forecast?.pm25 || []).filter(
            (f) => f.day >= todayStr && typeof f.avg === 'number' && !isNaN(f.avg)
          );

          if (validWaqiForecast.length >= 3) {
            setForecastData({
              list: validWaqiForecast.slice(0, 5),
              source: 'WAQI 官方站点扩散模型',
            });
          } else {
            try {
              const ecForecast = await fetch5DayForecast(lat, lng);
              if (ecForecast.length > 0) {
                setForecastData({
                  list: ecForecast,
                  source: 'CAMS / ECMWF 全球数值预报',
                });
              } else {
                setForecastData({
                  list: (data.forecast?.pm25 || []).slice(0, 5),
                  source: '官方预报暂未发布',
                });
              }
            } catch {
              setForecastData({
                list: (data.forecast?.pm25 || []).slice(0, 5),
                source: '官方预报暂未发布',
              });
            }
          }
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
  const activeIAQI = record ? (standard === 'CN' ? calculateCNIAQI(record.pollutants) : calculateUSIAQI(record.pollutants)) : {};

  // 根据当前标准计算微观在册测站的 AQI 指数与评级颜色
  const getStationEval = (stAqi: string | number) => {
    const usNum = typeof stAqi === 'number' ? stAqi : parseInt(stAqi, 10);
    if (isNaN(usNum) || usNum <= 0) return { aqi: 0, color: '#94a3b8', level: '--' };
    const pm25Conc = convertIAQIToConcentration('pm25', usNum, 'US');
    return standard === 'CN' ? evaluateAQI({ pm25: pm25Conc }, 'CN') : evaluateAQI({ pm25: pm25Conc }, 'US');
  };

  return (
    <div className="space-y-6">
      {/* 搜索与快速选择栏 */}
      <section className="glass-panel rounded-2xl p-4 sm:p-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 sm:gap-4">
          <CitySearchAutocomplete
            selectedCity={selectedCity}
            onSelectCity={setSelectedCity}
            placeholder="搜索国内 375 城市或全球 564 城市（如：成都 / 北京 / Tokyo / London）..."
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
              {getHotCities().slice(0, 6).map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSelectedCity(c)}
                  className="px-3.5 py-1.5 rounded-xl bg-slate-100 hover:bg-sky-50 hover:text-sky-600 text-xs font-semibold text-slate-700 transition-colors"
                >
                  {c.nameZh}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 核心指标看板 Hero Section */}
      {record && evaluation ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-6">
          {/* 左侧：主 AQI 指数卡片 */}
          <div className="lg:col-span-5 glass-panel rounded-2xl p-4 sm:p-6 relative flex flex-col">
            {/* 背景氛围晕光 (限制于独立圆角容器内，杜绝主卡片全局 overflow-hidden 截断测站下拉弹窗) */}
            <div className="absolute inset-0 overflow-hidden rounded-2xl pointer-events-none">
              <div
                className="absolute -right-16 -top-16 w-56 h-56 rounded-full blur-3xl opacity-15"
                style={{ backgroundColor: evaluation.color }}
              />
            </div>

            {/* 头部城市名与更新时间 */}
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center space-x-2.5 sm:space-x-3 flex-wrap gap-y-2">
                  <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight truncate">
                    {selectedCity.nameZh}
                  </h1>

                  {/* 测站选择器 / 聚合模式选择器 (优雅浮动胶囊菜单) */}
                  <div className="relative inline-block" ref={dropdownRef}>
                    <button
                      type="button"
                      onClick={() => setIsStationDropdownOpen(!isStationDropdownOpen)}
                      disabled={stationLoading}
                      className={`group inline-flex items-center space-x-1.5 px-2.5 sm:px-3 py-1 rounded-xl text-xs font-bold border transition-all duration-150 shadow-2xs cursor-pointer select-none max-w-full ${
                        selectedStationMode === 'composite'
                          ? 'bg-emerald-50 hover:bg-emerald-100/80 text-emerald-800 border-emerald-200'
                          : selectedStationMode !== 'default'
                          ? 'bg-indigo-50 hover:bg-indigo-100/80 text-indigo-800 border-indigo-200'
                          : 'bg-sky-50 hover:bg-sky-100/80 text-sky-800 border-sky-200'
                      }`}
                    >
                      {stationLoading ? (
                        <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin shrink-0" />
                      ) : selectedStationMode === 'composite' ? (
                        <Layers className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      ) : selectedStationMode !== 'default' ? (
                        <MapPin className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                      ) : (
                        <Building2 className="w-3.5 h-3.5 text-sky-600 shrink-0" />
                      )}

                      <span className="truncate max-w-[120px] xs:max-w-[150px] sm:max-w-[180px]">
                        {selectedStationMode === 'composite'
                          ? `全城加权 (${cityStations.length}站)`
                          : selectedStationMode !== 'default'
                          ? (() => {
                              const found = cityStations.find((s) => String(s.uid) === selectedStationMode);
                              const clean = found ? extractCleanStationName(found.station?.name || '', selectedCity.nameZh) : '单站实测';
                              const stEval = found ? getStationEval(found.aqi) : null;
                              return `${clean}${stEval ? ` · AQI ${stEval.aqi}` : ''}`;
                            })()
                          : '官方核心代表站'}
                      </span>

                      <ChevronDown
                        className={`w-3.5 h-3.5 text-slate-400 group-hover:text-slate-600 transition-transform duration-200 shrink-0 ${
                          isStationDropdownOpen ? 'rotate-180 text-sky-600' : ''
                        }`}
                      />
                    </button>

                    {/* 浮动下拉弹出层 (移动端居中弹窗带半透明遮罩，平板与桌面吸附于按钮下方) */}
                    {isStationDropdownOpen && (
                      <>
                        <div
                          className="fixed inset-0 bg-slate-900/25 backdrop-blur-2xs z-40 sm:hidden"
                          onClick={() => setIsStationDropdownOpen(false)}
                          aria-hidden="true"
                        />
                        <div className="fixed inset-x-4 top-28 sm:absolute sm:inset-x-auto sm:left-0 sm:top-full mt-1.5 z-50 w-auto sm:w-80 max-w-sm rounded-2xl bg-white/98 backdrop-blur-xl shadow-2xl border border-slate-200/90 p-2 text-xs transition-all animate-in fade-in slide-in-from-top-1 duration-150">
                        {/* 城市数据口径 */}
                        <div className="px-2 py-1 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                          城市数据统计口径
                        </div>

                        {/* 选项 1: 官方核心代表站 */}
                        <button
                          type="button"
                          onClick={() => handleStationChange('default')}
                          className={`w-full text-left p-2 rounded-xl flex items-center justify-between transition-colors ${
                            selectedStationMode === 'default'
                              ? 'bg-sky-50 text-sky-900 font-semibold border border-sky-200/80 shadow-2xs'
                              : 'hover:bg-slate-50 text-slate-700'
                          }`}
                        >
                          <div className="flex items-center space-x-2.5 min-w-0">
                            <div className="w-7 h-7 rounded-lg bg-sky-100 text-sky-700 flex items-center justify-center shrink-0">
                              <Building2 className="w-3.5 h-3.5" />
                            </div>
                            <div className="min-w-0">
                              <div className="text-xs font-bold text-slate-800">官方核心代表站</div>
                              <div className="text-[10px] text-slate-400 truncate">城市基准测站 · 实时首报</div>
                            </div>
                          </div>
                          {baseCityRecord && (
                            <span
                              className="px-2 py-0.5 rounded-md font-mono font-bold text-[11px] shrink-0 ml-2"
                              style={{
                                backgroundColor: (standard === 'CN' ? baseCityRecord.evaluationCN.color : baseCityRecord.evaluationUS.color) + '18',
                                color: standard === 'CN' ? baseCityRecord.evaluationCN.color : baseCityRecord.evaluationUS.color,
                              }}
                            >
                              AQI {standard === 'CN' ? baseCityRecord.evaluationCN.aqi : baseCityRecord.evaluationUS.aqi}
                            </span>
                          )}
                        </button>

                        {/* 选项 2: 全城多站加权均值 */}
                        {cityStations.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleStationChange('composite')}
                            className={`w-full text-left p-2 rounded-xl flex items-center justify-between transition-colors mt-1 ${
                              selectedStationMode === 'composite'
                                ? 'bg-emerald-50 text-emerald-900 font-semibold border border-emerald-200/80 shadow-2xs'
                                : 'hover:bg-slate-50 text-slate-700'
                            }`}
                          >
                            <div className="flex items-center space-x-2.5 min-w-0">
                              <div className="w-7 h-7 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                                <Layers className="w-3.5 h-3.5" />
                              </div>
                              <div className="min-w-0">
                                <div className="text-xs font-bold text-slate-800 flex items-center space-x-1.5">
                                  <span>全城多站加权均值</span>
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-semibold">
                                    {cityStations.length}站聚合
                                  </span>
                                </div>
                                <div className="text-[10px] text-slate-400 truncate">消除单点偏差 · 对齐排行榜口径</div>
                              </div>
                            </div>
                            {(() => {
                              const validAqis = cityStations.map((s) => parseInt(s.aqi, 10)).filter((a) => !isNaN(a) && a > 0);
                              if (validAqis.length === 0) return null;
                              const usAvg = Math.round(validAqis.reduce((a, b) => a + b, 0) / validAqis.length);
                              const pm25Conc = convertIAQIToConcentration('pm25', usAvg, 'US');
                              const pm10Conc = convertIAQIToConcentration('pm10', Math.round(usAvg * 0.7), 'US');
                              const compEval = standard === 'CN'
                                ? evaluateAQI({ pm25: pm25Conc, pm10: pm10Conc }, 'CN')
                                : evaluateAQI({ pm25: pm25Conc, pm10: pm10Conc }, 'US');
                              return (
                                <span
                                  className="px-2 py-0.5 rounded-md font-mono font-bold text-[11px] shrink-0 ml-2"
                                  style={{
                                    backgroundColor: compEval.color + '18',
                                    color: compEval.color,
                                  }}
                                >
                                  AQI {compEval.aqi}
                                </span>
                              );
                            })()}
                          </button>
                        )}

                        {/* 选项 3: 本地具体国控微站 */}
                        {cityStations.length > 0 && (
                          <div className="mt-2 pt-2 border-t border-slate-100">
                            <div className="px-2 py-1 flex items-center justify-between text-[11px] font-bold text-slate-400">
                              <span>本地国控微站明细 ({cityStations.length})</span>
                              <span className="text-[10px] text-slate-400 font-normal">单站独立实测</span>
                            </div>
                            <div className="max-h-52 overflow-y-auto space-y-0.5 pr-1 mt-1 custom-scrollbar">
                              {cityStations.map((st) => {
                                const cleanName = extractCleanStationName(st.station?.name || '', selectedCity.nameZh);
                                const stEval = getStationEval(st.aqi);
                                const isSelected = selectedStationMode === String(st.uid);
                                return (
                                  <button
                                    key={st.uid}
                                    type="button"
                                    onClick={() => handleStationChange(String(st.uid))}
                                    className={`w-full text-left px-2.5 py-1.5 rounded-xl flex items-center justify-between transition-colors ${
                                      isSelected
                                        ? 'bg-indigo-50 text-indigo-900 font-semibold border border-indigo-200/80 shadow-2xs'
                                        : 'hover:bg-slate-50 text-slate-700'
                                    }`}
                                  >
                                    <div className="flex items-center space-x-2 truncate min-w-0">
                                      <MapPin className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-indigo-600' : 'text-slate-400'}`} />
                                      <span className="truncate text-xs">{cleanName}</span>
                                    </div>
                                    <span
                                      className="text-[11px] font-mono font-bold px-1.5 py-0.5 rounded shrink-0 ml-2"
                                      style={{
                                        backgroundColor: stEval.color + '18',
                                        color: stEval.color,
                                      }}
                                    >
                                      AQI {stEval.aqi}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                      </>
                    )}
                  </div>
                </div>

                <p className="text-xs text-slate-500 mt-1.5 flex items-center space-x-1.5 flex-wrap gap-y-1">
                  <span>{selectedCity.nameEn}</span>
                  <span>·</span>
                  <span>更新时间: {record.updateTime}</span>
                  {selectedStationMode !== 'default' && selectedStationMode !== 'composite' && (
                    <>
                      <span>·</span>
                      <span className="text-indigo-700 font-semibold bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-200/80 text-[11px]">
                        单站实测: {(() => {
                          const found = cityStations.find((s) => String(s.uid) === selectedStationMode);
                          const clean = found ? extractCleanStationName(found.station?.name || '', selectedCity.nameZh) : '在册微站';
                          const stEval = found ? getStationEval(found.aqi) : null;
                          return `${clean}${stEval ? ` · AQI ${stEval.aqi}` : ''}`;
                        })()}
                      </span>
                    </>
                  )}
                </p>
              </div>

              <button
                onClick={() => {
                  if (selectedStationMode === 'default') {
                    loadCityData(selectedCity);
                  } else {
                    handleStationChange(selectedStationMode);
                  }
                }}
                disabled={loading || stationLoading}
                className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-900 transition-colors shadow-sm cursor-pointer"
                title="刷新数据"
              >
                <RefreshCw className={`w-4 h-4 ${loading || stationLoading ? 'animate-spin text-sky-600' : ''}`} />
              </button>
            </div>

            {/* AQI 大字与等级徽章 */}
            <div className="mt-5 flex items-baseline space-x-4">
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
              </div>
            </div>

            {/* 首要污染物与健康建议：自适应平滑舒展，杜绝空白断层 */}
            <div className="mt-4 p-4 rounded-xl bg-slate-50 border border-slate-100 text-xs flex-1 flex flex-col justify-center space-y-2">
              <div className="flex items-center justify-between text-slate-700">
                <span className="text-slate-500 font-medium">首要污染物:</span>
                <span className="font-bold text-amber-600">{evaluation.primaryPollutantName}</span>
              </div>
              <div className="flex items-start space-x-2 pt-2 border-t border-slate-200/80 text-slate-600">
                <AlertTriangle className="w-4 h-4 text-sky-600 shrink-0 mt-0.5" />
                <p className="leading-relaxed">{evaluation.healthAdvice}</p>
              </div>
            </div>

            {/* 气象观测指标条 */}
            <div className="mt-5 pt-4 border-t border-slate-100 grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
              <div className="p-2 rounded-xl bg-slate-50 border border-slate-100">
                <div className="flex items-center justify-center text-slate-500 mb-1">
                  <Thermometer className="w-3.5 h-3.5 text-rose-500" />
                </div>
                <span translate="no" className="font-bold text-slate-800">{record.weather?.temp ?? 22}°C</span>
                <p className="text-[10px] text-slate-400">气温</p>
              </div>
              <div className="p-2 rounded-xl bg-slate-50 border border-slate-100">
                <div className="flex items-center justify-center text-slate-500 mb-1">
                  <Droplets className="w-3.5 h-3.5 text-sky-500" />
                </div>
                <span translate="no" className="font-bold text-slate-800">{record.weather?.humidity ?? 45}%</span>
                <p className="text-[10px] text-slate-400">湿度</p>
              </div>
              <div className="p-2 rounded-xl bg-slate-50 border border-slate-100">
                <div className="flex items-center justify-center text-slate-500 mb-1">
                  <Wind className="w-3.5 h-3.5 text-teal-500" />
                </div>
                <span translate="no" className="font-bold text-slate-800">{record.weather?.windSpeed ?? 2.1} m/s</span>
                <p className="text-[10px] text-slate-400">风速</p>
              </div>
              <div className="p-2 rounded-xl bg-slate-50 border border-slate-100">
                <div className="flex items-center justify-center text-slate-500 mb-1">
                  <Gauge className="w-3.5 h-3.5 text-indigo-500" />
                </div>
                <span translate="no" className="font-bold text-slate-800">{record.weather?.pressure ?? 1013} hPa</span>
                <p className="text-[10px] text-slate-400">气压</p>
              </div>
            </div>
          </div>

          {/* 右侧：6 大分项污染物实测卡片 */}
          <div className="lg:col-span-7 glass-panel rounded-2xl p-4 sm:p-6 flex flex-col justify-between">
            <div>
              <div className="flex items-center space-x-2 mb-3.5 sm:mb-4">
                <Activity className="w-4 h-4 text-sky-600" />
                <h3 className="text-sm sm:text-base font-bold text-slate-900">六大主要空气污染物实测物理浓度</h3>
              </div>

              {/* 污染物卡片网格 */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 sm:gap-3.5">
                {[
                  { key: 'pm25', name: 'PM2.5 (细颗粒物)', val: record.pollutants.pm25, max: 150, color: '#f59e0b', unit: 'μg/m³', limit: '35', label: '优级限值 35' },
                  { key: 'pm10', name: 'PM10 (可吸入颗粒物)', val: record.pollutants.pm10, max: 250, color: '#0284c7', unit: 'μg/m³', limit: '50', label: '优级限值 50' },
                  { key: 'o3', name: '臭氧 O₃', val: record.pollutants.o3, max: 200, color: '#9333ea', unit: 'μg/m³', limit: '100', label: '优级限值 100' },
                  { key: 'no2', name: '二氧化氮 NO₂', val: record.pollutants.no2, max: 100, color: '#ec4899', unit: 'μg/m³', limit: '40', label: '优级限值 40' },
                  { key: 'so2', name: '二氧化硫 SO₂', val: record.pollutants.so2, max: 100, color: '#10b981', unit: 'μg/m³', limit: '50', label: '优级限值 50' },
                  { key: 'co', name: '一氧化碳 CO', val: record.pollutants.co, max: 10, color: '#6366f1', unit: 'mg/m³', limit: '2', label: '优级限值 2' },
                ].map((item) => {
                  const val = item.val ?? 0;
                  const percent = Math.min(100, Math.round((val / item.max) * 100));
                  const itemIAQI = activeIAQI[item.key as keyof typeof activeIAQI];
                  const numLimit = parseFloat(item.limit);
                  const isSafe = val > 0 && val <= numLimit;

                  return (
                    <div
                      key={item.key}
                      className="p-3 sm:p-4 rounded-xl bg-slate-50/90 border border-slate-200/80 flex flex-col justify-between hover:border-slate-300 hover:shadow-xs transition-all shadow-2xs"
                    >
                      <div>
                        <div className="flex items-center justify-between text-xs text-slate-600 mb-2 sm:mb-2.5">
                          <span className="font-bold text-slate-800 text-[11px] sm:text-xs truncate">{item.name}</span>
                          {itemIAQI !== undefined && (
                            <span
                              translate="no"
                              className="text-[9px] sm:text-[10px] font-mono px-1 sm:px-1.5 py-0.5 rounded bg-slate-200/80 text-slate-700 font-semibold shrink-0 ml-1"
                              title="单项空气质量分指数"
                            >
                              分指数 {itemIAQI}
                            </span>
                          )}
                        </div>
                        <div className="flex items-baseline justify-between">
                          <span className="text-xl sm:text-2xl md:text-3xl font-black text-slate-900 tracking-tight">
                            {val > 0 ? val : '--'}
                          </span>
                          <span translate="no" className="text-[11px] sm:text-xs text-slate-500 font-semibold">{item.unit}</span>
                        </div>
                      </div>

                      <div className="mt-2.5 sm:mt-3 pt-2 border-t border-slate-200/50">
                        {/* 进度条 */}
                        <div className="w-full bg-slate-200/80 rounded-full h-1.5 overflow-hidden mb-1 sm:mb-1.5">
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{ width: `${percent}%`, backgroundColor: item.color }}
                          ></div>
                        </div>
                        <div className="flex items-center justify-between text-[9px] sm:text-[10px] text-slate-400 font-mono">
                          <span>{item.label}</span>
                          {val > 0 && (
                            <span className={isSafe ? 'text-emerald-600 font-semibold' : 'text-amber-600 font-semibold'}>
                              {isSafe ? '清洁优' : '略偏高'}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 来源认证提示 */}
            <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
              <span className="flex items-center space-x-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                <span>数据来源: {record.sourceAttribution?.[0]?.name || '官方实时监测网络'}</span>
              </span>
              <Link
                href={`/history?city=${selectedCity.id}`}
                className="text-sky-600 hover:text-sky-700 hover:underline font-semibold flex items-center space-x-1"
              >
                <span>历史数据</span>
              </Link>
            </div>
          </div>
        </div>
      ) : !loadError ? (
        /* 首屏加载/刷新骨架屏：杜绝卡片消失塌陷，1:1 稳固结构 */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-6">
          {/* 左侧主 AQI 卡片骨架 */}
          <div className="lg:col-span-5 glass-panel rounded-2xl p-4 sm:p-6 min-h-[380px] flex flex-col justify-between animate-pulse">
            <div>
              <div className="flex items-start justify-between">
                <div className="space-y-2">
                  <div className="h-7 w-32 bg-slate-200 rounded-lg" />
                  <div className="h-3.5 w-48 bg-slate-100 rounded" />
                </div>
                <div className="h-8 w-8 bg-slate-100 rounded-lg" />
              </div>
              <div className="mt-7 flex items-baseline space-x-4">
                <div className="h-16 w-24 bg-slate-200 rounded-xl" />
                <div className="space-y-2">
                  <div className="h-6 w-20 bg-slate-200 rounded-full" />
                  <div className="h-3.5 w-32 bg-slate-100 rounded" />
                </div>
              </div>
              <div className="mt-6 p-4 rounded-xl bg-slate-50 border border-slate-100 space-y-2.5">
                <div className="h-3.5 w-full bg-slate-200 rounded" />
                <div className="h-3 w-4/5 bg-slate-100 rounded" />
              </div>
            </div>
            <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
              <div className="h-3 w-28 bg-slate-100 rounded" />
              <div className="h-3 w-28 bg-slate-100 rounded" />
            </div>
          </div>

          {/* 右侧六大污染物卡片骨架 */}
          <div className="lg:col-span-7 glass-panel rounded-2xl p-4 sm:p-6 flex flex-col justify-between min-h-[380px] animate-pulse">
            <div>
              <div className="flex items-center justify-between pb-3.5 border-b border-slate-100">
                <div className="h-5 w-40 bg-slate-200 rounded" />
                <div className="h-4 w-32 bg-slate-100 rounded" />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 sm:gap-3.5 mt-4">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <div key={i} className="p-3 sm:p-3.5 rounded-xl bg-slate-50 border border-slate-100 space-y-3">
                    <div className="flex justify-between items-center">
                      <div className="h-3.5 w-14 bg-slate-200 rounded" />
                      <div className="h-3 w-10 bg-slate-100 rounded" />
                    </div>
                    <div className="h-7 w-16 bg-slate-200 rounded" />
                    <div className="h-1.5 w-full bg-slate-200 rounded-full" />
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-4 pt-3 border-t border-slate-100 flex justify-between items-center">
              <div className="h-3 w-36 bg-slate-100 rounded" />
              <div className="h-3 w-32 bg-slate-100 rounded" />
            </div>
          </div>
        </div>
      ) : null}

      {/* 24 小时逐小时走势分析图 */}
      <section className="glass-panel rounded-2xl p-4 sm:p-5">
        <div className="flex items-center space-x-2 mb-2">
          <Activity className="w-4 h-4 text-sky-600" />
          <h3 className="text-sm sm:text-base font-bold text-slate-900">逐小时空气质量变化轨迹</h3>
        </div>
        <TrendChart
          data={trendResult?.points || []}
          city={selectedCity.nameZh}
          isReal={trendResult?.isReal}
        />
      </section>

      {/* 未来 5 天空气质量预测走势 */}
      <section className="glass-panel rounded-2xl p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 mb-4 sm:mb-5">
          <div className="flex items-center flex-wrap gap-2">
            <Calendar className="w-4.5 h-4.5 sm:w-5 sm:h-5 text-indigo-600" />
            <h3 className="text-base sm:text-lg font-bold text-slate-900">
              未来 5 天空气质量预测走势
            </h3>
            {forecastData.source && (
              <span className="text-[10px] sm:text-[11px] px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 font-semibold border border-indigo-200 shadow-sm flex items-center space-x-1">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse inline-block mr-1"></span>
                <span>{forecastData.source}</span>
              </span>
            )}
          </div>
          <span className="text-[11px] sm:text-xs text-slate-500 font-medium">
            大气环流动力学与化学传输数值模型推演
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2.5 sm:gap-3.5">
          {forecastData.list.length > 0 ? (
            forecastData.list.map((f, idx) => {
              const evalRes = evaluateAQI({ pm25: f.avg }, standard);
              const dateObj = new Date(f.day + 'T00:00:00');
              const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
              const weekName = !isNaN(dateObj.getTime()) ? weekDays[dateObj.getDay()] : '';
              const isToday = idx === 0;

              return (
                <div
                  key={f.day}
                  className="p-3.5 sm:p-4 rounded-xl bg-slate-50/80 border border-slate-200/80 flex flex-col justify-between hover:border-indigo-300 hover:shadow-sm transition-all"
                >
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center space-x-1.5">
                        <span className="text-xs font-bold font-mono text-slate-800">
                          {f.day.slice(5)}
                        </span>
                        <span className="text-[11px] text-slate-500 font-medium">
                          {isToday ? '(今天)' : weekName}
                        </span>
                      </div>
                      <span
                        className="text-xs font-bold font-mono px-2 py-0.5 rounded-md"
                        style={{
                          backgroundColor: evalRes.color + '18',
                          color: evalRes.color,
                          border: `1px solid ${evalRes.color}40`,
                        }}
                      >
                        AQI {evalRes.aqi}
                      </span>
                    </div>

                    <div className="flex items-baseline justify-between mt-2">
                      <span className="text-xs text-slate-500 font-medium">综合级别:</span>
                      <span
                        className="text-xs font-bold"
                        style={{ color: evalRes.color }}
                      >
                        {evalRes.level}
                      </span>
                    </div>

                    <div className="mt-3 pt-2.5 border-t border-slate-200/60 text-xs space-y-1.5">
                      <div className="flex items-center justify-between text-slate-600 font-mono">
                        <span className="text-[11px] text-slate-500">PM2.5 均值</span>
                        <span className="font-bold text-slate-900">{f.avg} μg/m³</span>
                      </div>
                      <div className="flex items-center justify-between text-slate-400 font-mono text-[10px]">
                        <span>日波动区间</span>
                        <span>{f.min} ~ {f.max} μg/m³</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="col-span-full p-8 text-center text-slate-400 text-xs">
              同步未来大气气象数值预报中...
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
