'use client';

import React, { useState, useEffect, useRef, useMemo, Suspense } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { useStandard } from '@/components/StandardContext';
import {
  CITIES_REGISTRY,
  findCity,
  getHotCities,
} from '@/lib/constants/cities';
import {
  fetchWAQICityData,
  fetchWAQIStationByUid,
  fetchWAQICityStations,
  fetchEdgeCityRealtime,
  enrichStationsWithPM25,
  WaqiBoundStation,
  extractCleanStationName,
  getDistanceKm,
} from '@/lib/services/waqi';
import { aggregateCompositeRecord } from '@/lib/services/composite-aggregator';
import {
  fetch24HourHourlyTrend,
  fetch5DayForecast,
  HourlyTrendResult,
} from '@/lib/services/realtime-trend';
import {
  calculateCNIAQI,
  calculateUSIAQI,
  evaluateAQI,
  convertIAQIToConcentration,
  getUSEvaluation,
} from '@/lib/aqi-calculator';
import { AirQualityRecord, CityMeta, ForecastDay } from '@/lib/types';

// 按需异步加载 ECharts 24 小时走势图，避免首页首屏同步打包 ~400KB ECharts 阻塞主线程
const TrendChart = dynamic(
  () => import('@/components/TrendChart').then((mod) => mod.TrendChart),
  {
    ssr: false,
    loading: () => (
      <div className="h-[260px] sm:h-[300px] w-full rounded-xl bg-slate-50/80 border border-slate-100 animate-pulse flex items-center justify-center text-xs text-slate-400">
        正在加载逐小时实测走势图...
      </div>
    ),
  }
);
import {
  MapPin,
  RefreshCw,
  Thermometer,
  Droplets,
  Wind,
  Gauge,
  Activity,
  AlertTriangle,
  Calendar,
  AlertCircle,
  ChevronDown,
  Layers,
  Loader2,
  Heart,
} from 'lucide-react';

function DashboardPageContent() {
  const {
    standard,
    onlyPm25,
    favoriteCityId,
    setFavoriteCityId,
    activeCityId,
    setActiveCityId,
    reportCityCompositeRecord,
    mounted,
  } = useStandard();
  const searchParams = useSearchParams();
  const initialCityParam = searchParams.get('city');
  const initialStationParam = searchParams.get('station');

  const [selectedCity, setSelectedCity] = useState<CityMeta>(() => {
    if (initialCityParam) {
      const found = findCity(initialCityParam);
      if (found) return found;
    }
    return findCity(activeCityId) || findCity('cn-chengdu') || CITIES_REGISTRY[0];
  });
  const favoriteInitializedRef = useRef<boolean>(false);
  const lastLoadedCityIdRef = useRef<string | null>(null);
  const lastSyncedActiveIdRef = useRef<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [record, setRecord] = useState<AirQualityRecord | null>(null);
  const [baseCityRecord, setBaseCityRecord] = useState<AirQualityRecord | null>(null);
  const [cityStations, setCityStations] = useState<WaqiBoundStation[]>([]);
  const [selectedStationMode, setSelectedStationMode] = useState<string>(initialStationParam || 'composite');
  const [stationLoading, setStationLoading] = useState<boolean>(false);
  const [trendLoading, setTrendLoading] = useState<boolean>(false);
  const [forecastLoading, setForecastLoading] = useState<boolean>(false);
  const [isStationDropdownOpen, setIsStationDropdownOpen] = useState<boolean>(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [forecastData, setForecastData] = useState<{ list: ForecastDay[]; source: string }>({
    list: [],
    source: '',
  });
  const [trendResult, setTrendResult] = useState<HourlyTrendResult | null>(null);
  const [baseTrendResult, setBaseTrendResult] = useState<HourlyTrendResult | null>(null);

  // 竞态防线：单调递增请求版本号 + 当前模式 ref + 微站补齐中止控制器
  const requestIdRef = useRef<number>(0);
  const selectedStationModeRef = useRef<string>(selectedStationMode);
  const enrichAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    selectedStationModeRef.current = selectedStationMode;
  }, [selectedStationMode]);

  // URL 深度链接同步 (?city=...&station=...)：仅在参数确实变化时调用 replaceState
  useEffect(() => {
    if (typeof window === 'undefined' || !mounted || !favoriteInitializedRef.current) return;
    const url = new URL(window.location.href);
    const targetStation = selectedStationMode && selectedStationMode !== 'composite' ? selectedStationMode : null;
    if (url.searchParams.get('city') === selectedCity.id && url.searchParams.get('station') === targetStation) {
      return;
    }
    url.searchParams.set('city', selectedCity.id);
    if (targetStation) {
      url.searchParams.set('station', targetStation);
    } else {
      url.searchParams.delete('station');
    }
    window.history.replaceState({}, '', url.toString());
  }, [selectedCity.id, selectedStationMode, mounted]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsStationDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    return () => {
      if (enrichAbortRef.current) enrichAbortRef.current.abort();
    };
  }, []);

  const getTodayDateStr = () => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  /**
   * 基于已采样官方测站的全 6 项污染物 + 4 项气象空间均值聚合（与 Worker 边缘接口同源）
   */
  const buildCompositeRecord = (
    targetRecord: AirQualityRecord,
    targetStations: WaqiBoundStation[],
    targetCity: CityMeta
  ): AirQualityRecord =>
    aggregateCompositeRecord(targetRecord, targetStations, targetCity, standard, onlyPm25);

  const handleStationChange = async (
    mode: string,
    overrideBaseRecord?: AirQualityRecord,
    overrideStations?: WaqiBoundStation[],
    reqId?: number,
    overrideCity?: CityMeta
  ) => {
    const activeReqId = reqId ?? requestIdRef.current;
    setSelectedStationMode(mode);
    selectedStationModeRef.current = mode;
    setIsStationDropdownOpen(false);
    const targetRecord: AirQualityRecord | null = overrideBaseRecord || baseCityRecord;
    const targetStations: WaqiBoundStation[] = overrideStations || cityStations;
    const targetCity = overrideCity || selectedCity;
    if (!targetRecord) return;

    if (mode === 'default') {
      setRecord(targetRecord);
      if (baseTrendResult && baseTrendResult.points && baseTrendResult.points.length > 0) {
        setTrendResult(baseTrendResult);
      } else {
        const trend = await fetch24HourHourlyTrend(
          targetCity.latitude,
          targetCity.longitude,
          standard,
          0,
          0,
          0,
          targetRecord.updateTime,
          targetRecord.stationIdx
        );
        if (requestIdRef.current !== activeReqId) return;
        setTrendResult(trend);
        setBaseTrendResult(trend);
      }
      return;
    }

    if (mode === 'composite') {
      const compRecord = buildCompositeRecord(targetRecord, targetStations, targetCity);
      setRecord(compRecord);
      reportCityCompositeRecord(targetCity.id, compRecord);

      // 逐小时曲线严格呈现市中心官方基准站真实逐小时实测，绝不对实测曲线做比例缩放伪造
      if (baseTrendResult && baseTrendResult.points.length > 0) {
        setTrendResult({
          ...baseTrendResult,
          source: '市中心基准站逐小时实测',
        });
      } else {
        const baseTrend = await fetch24HourHourlyTrend(
          targetCity.latitude,
          targetCity.longitude,
          standard,
          0,
          0,
          0,
          targetRecord.updateTime,
          targetRecord.stationIdx
        );
        if (requestIdRef.current !== activeReqId) return;
        setBaseTrendResult(baseTrend);
        setTrendResult({
          ...baseTrend,
          source: baseTrend.isReal ? '市中心基准站逐小时实测' : baseTrend.source,
        });
      }
      return;
    }

    // 单独国控测站
    const uidNum = parseInt(mode, 10);
    if (!isNaN(uidNum)) {
      setStationLoading(true);
      setTrendResult(null);
      try {
        const found = targetStations.find((s) => s.uid === uidNum);
        const cleanName = found ? extractCleanStationName(found.station?.name || '', targetCity.nameZh) : undefined;
        const stationData = await fetchWAQIStationByUid(uidNum, targetCity, cleanName);
        if (requestIdRef.current !== activeReqId) return;

        setRecord({
          ...stationData,
          name: targetCity.nameZh,
        });

        let trend = await fetch24HourHourlyTrend(
          stationData.latitude || targetCity.latitude,
          stationData.longitude || targetCity.longitude,
          standard,
          0,
          0,
          0,
          stationData.updateTime,
          stationData.stationIdx || uidNum
        );
        if (requestIdRef.current !== activeReqId) return;

        // 若该子微站未开放独立小时时序流，诚实回退展示本市基准站真实时序（原样展示，不缩放伪造）
        if (!trend.points || trend.points.length === 0) {
          if (baseTrendResult && baseTrendResult.points.length > 0) {
            trend = {
              ...baseTrendResult,
              source: `${cleanName || '该子站'}无独立小时流 · 展示本市基准站逐小时实测`,
            };
          } else if (targetRecord.stationIdx) {
            const fallbackTrend = await fetch24HourHourlyTrend(
              targetCity.latitude,
              targetCity.longitude,
              standard,
              0,
              0,
              0,
              stationData.updateTime,
              targetRecord.stationIdx
            );
            if (requestIdRef.current !== activeReqId) return;
            if (fallbackTrend.points.length > 0) {
              setBaseTrendResult(fallbackTrend);
              trend = {
                ...fallbackTrend,
                source: `${cleanName || '该子站'}无独立小时流 · 展示本市基准站逐小时实测`,
              };
            }
          }
        }

        setTrendResult(trend);
      } catch (e: any) {
        console.warn('Failed to load station data', e);
      } finally {
        if (requestIdRef.current === activeReqId) {
          setStationLoading(false);
        }
      }
    }
  };

  const loadCityData = async (city: CityMeta, preferredMode = 'composite', clearStale = true) => {
    const reqId = ++requestIdRef.current;
    if (enrichAbortRef.current) {
      enrichAbortRef.current.abort();
    }
    const enrichController = new AbortController();
    enrichAbortRef.current = enrichController;

    setLoading(true);
    setTrendLoading(true);
    setLoadError(null);
    if (clearStale) {
      // 切换城市时立即清空旧城市所有状态，展示 1:1 鱼骨占位，彻底杜绝旧城市数据短暂残留
      setRecord(null);
      setBaseCityRecord(null);
      setCityStations([]);
      setTrendResult(null);
      setBaseTrendResult(null);
      setForecastData({ list: [], source: '' });
    }
    try {
      // ==========================================
      // 极速主通道：优先走 Cloudflare Worker /api/city-realtime 边缘聚合接口（3 分钟 Edge Cache <100ms 秒开）
      // 本地 dev 或无 Worker 环境自动平滑回落前端 5-Token 10 并发两段并行管道
      // ==========================================
      let data: AirQualityRecord;
      let enriched: WaqiBoundStation[];
      let targetMode: string;
      let earlyTrendPromise: Promise<HourlyTrendResult> | null = null;

      const edgePayload = await fetchEdgeCityRealtime(city.id, enrichController.signal);
      if (requestIdRef.current !== reqId || enrichController.signal.aborted) return;

      if (edgePayload?.baseRecord) {
        data = edgePayload.baseRecord;
        enriched = edgePayload.stations || [];
        targetMode =
          preferredMode !== 'composite' &&
          preferredMode !== 'default' &&
          enriched.some((s) => String(s.uid) === preferredMode)
            ? preferredMode
            : 'composite';
        setSelectedStationMode(targetMode);
        selectedStationModeRef.current = targetMode;
      } else {
        // Wave 1: 仅请求一次官方测站列表（内置同城并发去重，不再重复拉取 map/bounds）
        const stations = await fetchWAQICityStations(city).catch(() => [] as WaqiBoundStation[]);
        if (requestIdRef.current !== reqId) return;

        targetMode =
          preferredMode !== 'composite' &&
          preferredMode !== 'default' &&
          stations.some((s) => String(s.uid) === preferredMode)
            ? preferredMode
            : 'composite';

        setSelectedStationMode(targetMode);
        selectedStationModeRef.current = targetMode;

        const centerStation = stations.length > 0 && stations[0].uid ? stations[0] : null;

        // Wave 2: 市中心基准站详情 + 其余微站完整分项/气象 (5-Token 10并发) + 24小时趋势 全部同时起跑
        const baseRecordPromise = centerStation
          ? fetchWAQIStationByUid(centerStation.uid, city, centerStation.station?.name)
          : fetchWAQICityData(city.id);

        const restEnrichPromise =
          targetMode === 'composite' && stations.length > 1
            ? enrichStationsWithPM25(stations.slice(1), {
                concurrency: 10,
                signal: enrichController.signal,
                maxStations: 19,
              }).catch(() => stations.slice(1))
            : Promise.resolve(stations.slice(1));

        earlyTrendPromise =
          centerStation && (targetMode === 'composite' || targetMode === 'default')
            ? fetch24HourHourlyTrend(
                city.latitude,
                city.longitude,
                standard,
                0,
                0,
                0,
                '',
                centerStation.uid
              ).catch((): HourlyTrendResult => ({ points: [], isReal: false, source: '暂无官方小时流' }))
            : null;

        const [fetchedData, restEnriched] = await Promise.all([baseRecordPromise, restEnrichPromise]);
        if (requestIdRef.current !== reqId || enrichController.signal.aborted) return;

        data = fetchedData;
        enriched = centerStation
          ? [
              {
                ...centerStation,
                pm25: data.pollutants.pm25,
                pm25IaqiUS: data.iaqiUS?.pm25,
                pm25IaqiCN: data.iaqiCN?.pm25,
                pollutants: data.pollutants,
                weather: data.weather,
              },
              ...restEnriched,
            ]
          : stations;
      }

      setBaseCityRecord(data);
      setCityStations(enriched);

      // 立即渲染主卡片与六大污染物（不再等待 24h 曲线与 Open-Meteo 预报阻塞首屏！）
      if (targetMode === 'composite') {
        const compRecord = buildCompositeRecord(data, enriched, city);
        setRecord(compRecord);
        reportCityCompositeRecord(city.id, compRecord);
      } else if (targetMode === 'default') {
        setRecord(data);
      } else {
        // 指定了具体单站深度链接 (?station=uid)
        await handleStationChange(targetMode, data, enriched, reqId, city);
        if (!edgePayload && enriched.length > 1) {
          enrichStationsWithPM25(enriched.slice(1), {
            concurrency: 10,
            signal: enrichController.signal,
            maxStations: 19,
          })
            .then((rest) => {
              if (requestIdRef.current !== reqId || enrichController.signal.aborted) return;
              const fullEnriched = [enriched[0], ...rest];
              setCityStations(fullEnriched);
              const updatedComp = buildCompositeRecord(data, fullEnriched, city);
              reportCityCompositeRecord(city.id, updatedComp);
            })
            .catch(() => {});
        }
      }

      // 智能预报整合：WAQI 官方扩散模型立即上屏；缺失时异步拉取 ECMWF/CAMS，绝不阻塞主卡片
      const todayStr = getTodayDateStr();
      const validWaqiForecast = (data.forecast?.pm25 || []).filter(
        (f) => f.day >= todayStr && typeof f.avg === 'number' && !isNaN(f.avg)
      );

      if (validWaqiForecast.length >= 3) {
        setForecastLoading(false);
        setForecastData({
          list: validWaqiForecast.slice(0, 5),
          source: 'WAQI 官方站点扩散模型',
        });
      } else {
        setForecastLoading(true);
        fetch5DayForecast(city.latitude, city.longitude)
          .then((ecForecast) => {
            if (requestIdRef.current !== reqId) return;
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
          })
          .catch(() => {
            if (requestIdRef.current !== reqId) return;
            setForecastData({
              list: (data.forecast?.pm25 || []).slice(0, 5),
              source: '官方预报暂未发布',
            });
          })
          .finally(() => {
            if (requestIdRef.current === reqId) {
              setForecastLoading(false);
            }
          });
      }

      // 主卡片、污染物和预报已就绪，立即结束首屏骨架！
      setLoading(false);

      // 挂载已并行起跑的 24 小时逐小时走势结果（通常与主卡片同时到达）
      if (targetMode === 'composite' || targetMode === 'default') {
        const trendTask =
          earlyTrendPromise ||
          fetch24HourHourlyTrend(
            city.latitude,
            city.longitude,
            standard,
            0,
            0,
            0,
            data.updateTime,
            data.stationIdx
          ).catch((): HourlyTrendResult => ({ points: [], isReal: false, source: '暂无官方小时流' }));

        trendTask.then((trend) => {
          if (requestIdRef.current !== reqId) return;
          setBaseTrendResult(trend);
          setTrendResult(
            targetMode === 'composite'
              ? {
                  ...trend,
                  source: trend.isReal ? '市中心基准站逐小时实测' : trend.source,
                }
              : trend
          );
          setTrendLoading(false);
        });
      } else {
        setTrendLoading(false);
      }
    } catch (err: any) {
      if (requestIdRef.current !== reqId) return;
      console.warn('Failed to load city data', err);
      setRecord(null);
      setLoadError(err?.message || '该站点当前暂无 WAQI 实时监测数据发布');
      setLoading(false);
      setTrendLoading(false);
      setForecastLoading(false);
    }
  };

  // 挂载后对齐 URL ?city= 或全局 activeCityId / 最爱城市（单次初始化，绝不与 activeCityId 同帧互掐触发 3 轮重拉）
  useEffect(() => {
    if (!mounted || favoriteInitializedRef.current) return;
    favoriteInitializedRef.current = true;

    let initialTarget = selectedCity;
    if (initialCityParam) {
      const found = findCity(initialCityParam);
      if (found) {
        initialTarget = found;
        if (found.id !== activeCityId) {
          setActiveCityId(found.id);
        }
      }
    } else {
      const targetCity = findCity(activeCityId) || findCity(favoriteCityId);
      if (targetCity) {
        initialTarget = targetCity;
      }
    }

    lastSyncedActiveIdRef.current = initialTarget.id;

    if (initialTarget.id !== selectedCity.id) {
      setSelectedCity(initialTarget);
      return;
    }

    lastLoadedCityIdRef.current = initialTarget.id;
    const modeToUse =
      initialCityParam && initialTarget.id === findCity(initialCityParam)?.id && initialStationParam
        ? initialStationParam
        : 'composite';
    loadCityData(initialTarget, modeToUse);
  }, [mounted]);

  // 响应 Header 全局城市切换器（仅在 activeCityId 真实变化为新城市时切换，不响应挂载首帧的旧 activeCityId）
  useEffect(() => {
    if (!mounted || !favoriteInitializedRef.current) return;
    if (activeCityId === lastSyncedActiveIdRef.current) return;
    lastSyncedActiveIdRef.current = activeCityId;
    const nextCity = findCity(activeCityId);
    if (nextCity && nextCity.id !== selectedCity.id) {
      setSelectedCity(nextCity);
    }
  }, [activeCityId, mounted, selectedCity.id]);

  useEffect(() => {
    if (!mounted || !favoriteInitializedRef.current) return;
    if (lastLoadedCityIdRef.current === selectedCity.id) return;
    lastLoadedCityIdRef.current = selectedCity.id;
    lastSyncedActiveIdRef.current = selectedCity.id;
    const modeToUse =
      initialCityParam && selectedCity.id === findCity(initialCityParam)?.id && initialStationParam
        ? initialStationParam
        : 'composite';
    loadCityData(selectedCity, modeToUse);
  }, [selectedCity, mounted]);

  // 标准或「只看 PM2.5」切换时同步重算当前视图与 24 小时基准时序
  useEffect(() => {
    if (!baseCityRecord) return;
    if (selectedStationMode === 'composite') {
      setRecord(buildCompositeRecord(baseCityRecord, cityStations, selectedCity));
    }
    if (baseCityRecord.stationIdx) {
      const activeReqId = requestIdRef.current;
      fetch24HourHourlyTrend(
        selectedCity.latitude,
        selectedCity.longitude,
        standard,
        0,
        0,
        0,
        baseCityRecord.updateTime,
        selectedStationMode !== 'composite' && selectedStationMode !== 'default'
          ? Number(selectedStationMode) || baseCityRecord.stationIdx
          : baseCityRecord.stationIdx
      ).then((t) => {
        if (requestIdRef.current !== activeReqId) return;
        if (t.points.length > 0) {
          setTrendResult(t);
          if (selectedStationMode === 'composite' || selectedStationMode === 'default') {
            setBaseTrendResult(t);
          }
        }
      });
    }
  }, [standard, onlyPm25]);

  const evaluation = useMemo(() => {
    if (!record) return null;
    if (onlyPm25) {
      return evaluateAQI({ pm25: record.pollutants.pm25 }, standard, true);
    }
    return standard === 'CN' ? record.evaluationCN : record.evaluationUS;
  }, [record, standard, onlyPm25]);

  const activeIAQI = record
    ? standard === 'CN'
      ? calculateCNIAQI(record.pollutants)
      : calculateUSIAQI(record.pollutants)
    : {};

  // 严格真实：单站微标在「只看 PM2.5」模式下仅使用已实测的 PM2.5，未拉取到时诚实展示综合 AQI，绝不乘比例伪造
  const getStationEval = (st: WaqiBoundStation) => {
    const rawAqiNum = parseInt(st.aqi, 10);
    if (isNaN(rawAqiNum) || rawAqiNum <= 0) return { aqi: 0, color: '#94a3b8', level: '--', isRealPm25: false };

    if (onlyPm25 && st.pm25 !== undefined && st.pm25 > 0) {
      const ev = evaluateAQI({ pm25: st.pm25 }, standard, true);
      return { ...ev, isRealPm25: true };
    }
    if (onlyPm25 && st.pm25IaqiUS !== undefined && st.pm25IaqiUS > 0) {
      const pm25Conc = convertIAQIToConcentration('pm25', st.pm25IaqiUS, 'US');
      const ev = evaluateAQI({ pm25: pm25Conc }, standard, true);
      return { ...ev, isRealPm25: true };
    }

    const compEval =
      standard === 'US'
        ? getUSEvaluation(rawAqiNum)
        : evaluateAQI({ pm25: convertIAQIToConcentration('pm25', rawAqiNum, 'US') }, 'CN');
    return { ...compEval, isRealPm25: false };
  };

  const compositePreviewEval = useMemo(() => {
    if (!baseCityRecord) return null;
    const comp = buildCompositeRecord(baseCityRecord, cityStations, selectedCity);
    return onlyPm25
      ? evaluateAQI({ pm25: comp.pollutants.pm25 }, standard, true)
      : standard === 'CN'
      ? comp.evaluationCN
      : comp.evaluationUS;
  }, [baseCityRecord, cityStations, selectedCity, standard, onlyPm25]);

  const enrichedPm25Count = useMemo(
    () => cityStations.filter((s) => s.pm25 !== undefined && s.pm25 > 0).length,
    [cityStations]
  );

  // 根据当前标准动态呈现一级优限值参考（紧凑文案杜绝 375px 折行截断）
  const pollutantCards = useMemo(() => {
    if (!record) return [];
    const isUS = standard === 'US';
    return [
      {
        key: 'pm25',
        name: 'PM2.5 细颗粒',
        val: record.pollutants.pm25,
        max: 150,
        color: '#f59e0b',
        unit: 'μg/m³',
        limit: isUS ? 9.0 : 35,
        label: isUS ? '优 ≤ 9.0' : '优 ≤ 35',
        limitTitle: isUS ? 'US EPA 2024 一级优限值 9.0 μg/m³' : '中国国标 HJ 633 一级优限值 35 μg/m³',
      },
      {
        key: 'pm10',
        name: 'PM10 粗颗粒',
        val: record.pollutants.pm10,
        max: 250,
        color: '#0284c7',
        unit: 'μg/m³',
        limit: isUS ? 54 : 50,
        label: isUS ? '优 ≤ 54' : '优 ≤ 50',
        limitTitle: isUS ? 'US EPA 一级优限值 54 μg/m³' : '中国国标一级优限值 50 μg/m³',
      },
      {
        key: 'o3',
        name: '臭氧 O₃',
        val: record.pollutants.o3,
        max: 200,
        color: '#9333ea',
        unit: 'μg/m³',
        limit: isUS ? 108 : 160,
        label: isUS ? '优 ≤ 108' : '优 ≤ 160',
        limitTitle: isUS ? 'US EPA 一级优限值 108 μg/m³' : '中国国标小时优限值 160 μg/m³',
      },
      {
        key: 'no2',
        name: '二氧化氮 NO₂',
        val: record.pollutants.no2,
        max: 100,
        color: '#ec4899',
        unit: 'μg/m³',
        limit: 100,
        label: '优 ≤ 100',
        limitTitle: '小时一级优限值 100 μg/m³',
      },
      {
        key: 'so2',
        name: '二氧化硫 SO₂',
        val: record.pollutants.so2,
        max: 100,
        color: '#10b981',
        unit: 'μg/m³',
        limit: isUS ? 92 : 150,
        label: isUS ? '优 ≤ 92' : '优 ≤ 150',
        limitTitle: isUS ? 'US EPA 一级优限值 92 μg/m³' : '中国国标小时优限值 150 μg/m³',
      },
      {
        key: 'co',
        name: '一氧化碳 CO',
        val: record.pollutants.co,
        max: 10,
        color: '#6366f1',
        unit: 'mg/m³',
        limit: 5,
        label: '优 ≤ 5.0',
        limitTitle: '小时一级优限值 5.0 mg/m³',
      },
    ];
  }, [record, standard]);

  return (
    <div className="space-y-6">
      {/* 无实时数据时诚实呈现 */}
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
              {loadError}。本平台严格遵循纯真实测原则，WAQI 官方测站未收录或离线时，绝不伪造数据兜底。
            </p>
          </div>
          <div className="pt-2">
            <p className="text-xs text-slate-400 mb-2.5">推荐切换查看测站活跃的代表性城市：</p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              {getHotCities()
                .slice(0, 6)
                .map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setSelectedCity(c);
                      setActiveCityId(c.id);
                    }}
                    className="px-3.5 py-1.5 rounded-xl bg-slate-100 hover:bg-sky-50 hover:text-sky-600 text-xs font-semibold text-slate-700 transition-colors cursor-pointer"
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
          <div className="lg:col-span-5 glass-panel rounded-2xl p-4 sm:p-6 relative flex flex-col min-w-0">
            <div className="absolute inset-0 overflow-hidden rounded-2xl pointer-events-none">
              <div
                className="absolute -right-16 -top-16 w-56 h-56 rounded-full blur-3xl opacity-15"
                style={{ backgroundColor: evaluation.color }}
              />
            </div>

            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center space-x-2.5 sm:space-x-3 flex-wrap gap-y-2">
                  <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight truncate">
                    {selectedCity.nameZh}
                  </h1>

                  {/* 设为最爱城市（城市实况 / 实时全景 / 历史档案全局默认联动） */}
                  {findCity(selectedCity.id) && (
                    <button
                      type="button"
                      onClick={() => setFavoriteCityId(selectedCity.id)}
                      disabled={favoriteCityId === selectedCity.id}
                      className={`inline-flex items-center space-x-1 px-2 py-1 rounded-xl text-[11px] font-bold border transition-all shrink-0 ${
                        favoriteCityId === selectedCity.id
                          ? 'bg-rose-50 text-rose-600 border-rose-200 cursor-default'
                          : 'bg-white text-slate-500 border-slate-200 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 cursor-pointer'
                      }`}
                      title={
                        favoriteCityId === selectedCity.id
                          ? '当前城市已设为默认最爱城市（打开城市实况与实时全景默认展示此城市）'
                          : '设为最爱城市（下次打开城市实况与实时全景默认展示此城市）'
                      }
                    >
                      <Heart
                        className={`w-3 h-3 ${
                          favoriteCityId === selectedCity.id ? 'fill-rose-500 text-rose-500' : ''
                        }`}
                      />
                      <span>{favoriteCityId === selectedCity.id ? '最爱城市' : '设为最爱'}</span>
                    </button>
                  )}

                  {/* 测站选择器 */}
                  <div className="relative inline-block" ref={dropdownRef}>
                    <button
                      type="button"
                      onClick={() => setIsStationDropdownOpen(!isStationDropdownOpen)}
                      disabled={stationLoading}
                      aria-expanded={isStationDropdownOpen}
                      aria-haspopup="listbox"
                      className={`group inline-flex items-center space-x-1.5 px-2.5 sm:px-3 py-1 rounded-xl text-xs font-bold border transition-all duration-150 shadow-2xs cursor-pointer select-none max-w-full ${
                        selectedStationMode === 'composite'
                          ? 'bg-emerald-50 hover:bg-emerald-100/80 text-emerald-800 border-emerald-200'
                          : 'bg-indigo-50 hover:bg-indigo-100/80 text-indigo-800 border-indigo-200'
                      }`}
                    >
                      {stationLoading ? (
                        <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin shrink-0" />
                      ) : selectedStationMode === 'composite' ? (
                        <Layers className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      ) : (
                        <MapPin className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                      )}

                      <span className="truncate max-w-[140px] xs:max-w-[170px] sm:max-w-[200px]">
                        {selectedStationMode === 'composite'
                          ? enrichedPm25Count > 0 && enrichedPm25Count < cityStations.length
                            ? `核心城区均值 (${enrichedPm25Count}/${cityStations.length}站)`
                            : `全城均值 (${enrichedPm25Count || cityStations.length || 1}站)`
                          : (() => {
                              const found = cityStations.find((s) => String(s.uid) === selectedStationMode);
                              const clean = found
                                ? extractCleanStationName(found.station?.name || '', selectedCity.nameZh)
                                : '基准站';
                              const stEval = found ? getStationEval(found) : null;
                              return `${clean}${stEval ? ` · AQI ${stEval.aqi}` : ''}`;
                            })()}
                      </span>

                      <ChevronDown
                        className={`w-3.5 h-3.5 text-slate-400 group-hover:text-slate-600 transition-transform duration-200 shrink-0 ${
                          isStationDropdownOpen ? 'rotate-180 text-sky-600' : ''
                        }`}
                      />
                    </button>

                    {isStationDropdownOpen && (
                      <>
                        <div
                          className="fixed inset-0 bg-slate-900/25 backdrop-blur-sm z-40 sm:hidden"
                          onClick={() => setIsStationDropdownOpen(false)}
                          aria-hidden="true"
                        />
                        <div
                          role="listbox"
                          aria-label="选择监测站点"
                          className="fixed inset-x-4 top-28 sm:absolute sm:inset-x-auto sm:left-0 sm:top-full mt-1.5 z-50 w-auto sm:w-80 max-w-sm rounded-2xl bg-white shadow-2xl border border-slate-200 p-2 text-xs transition-all animate-in fade-in slide-in-from-top-1 duration-150"
                        >
                          <button
                            type="button"
                            onClick={() => handleStationChange('composite')}
                            className={`w-full text-left p-2 rounded-xl flex items-center justify-between transition-colors cursor-pointer ${
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
                                  <span>
                                    {enrichedPm25Count > 0 && enrichedPm25Count < cityStations.length
                                      ? '核心城区多站均值'
                                      : '全城多站均值'}
                                  </span>
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-semibold">
                                    {enrichedPm25Count > 0 && enrichedPm25Count < cityStations.length
                                      ? `${enrichedPm25Count}/${cityStations.length}站`
                                      : `${enrichedPm25Count || cityStations.length || 1}站`}
                                  </span>
                                </div>
                              </div>
                            </div>
                            {compositePreviewEval && compositePreviewEval.aqi > 0 && (
                              <span
                                className="px-2 py-0.5 rounded-md font-mono font-bold text-[11px] shrink-0 ml-2"
                                style={{
                                  backgroundColor: compositePreviewEval.color + '18',
                                  color: compositePreviewEval.color,
                                }}
                              >
                                AQI {compositePreviewEval.aqi}
                              </span>
                            )}
                          </button>

                          {cityStations.length > 0 &&
                            (() => {
                              const stationsWithDist = cityStations
                                .map((st) => ({
                                  ...st,
                                  distKm: getDistanceKm(selectedCity.latitude, selectedCity.longitude, st.lat, st.lon),
                                }))
                                .sort((a, b) => a.distKm - b.distKm);

                              return (
                                <div className="mt-2 pt-2 border-t border-slate-100">
                                  <div className="px-2 py-1 flex items-center justify-between text-[11px] font-bold text-slate-400">
                                    <span>本地国控微站明细 ({stationsWithDist.length})</span>
                                    <span className="text-[10px] text-slate-400 font-normal">单站独立实测</span>
                                  </div>
                                  <div className="max-h-52 overflow-y-auto space-y-0.5 pr-1 mt-1 custom-scrollbar">
                                    {stationsWithDist.map((st, idx) => {
                                      const cleanName = extractCleanStationName(
                                        st.station?.name || '',
                                        selectedCity.nameZh
                                      );
                                      const stEval = getStationEval(st);
                                      const isSelected = selectedStationMode === String(st.uid);
                                      const isCenter = idx === 0 && st.distKm <= 35;
                                      return (
                                        <button
                                          key={st.uid}
                                          type="button"
                                          onClick={() => handleStationChange(String(st.uid))}
                                          className={`w-full text-left px-2.5 py-1.5 rounded-xl flex items-center justify-between transition-colors cursor-pointer ${
                                            isSelected
                                              ? 'bg-indigo-50 text-indigo-900 font-semibold border border-indigo-200/80 shadow-2xs'
                                              : 'hover:bg-slate-50 text-slate-700'
                                          }`}
                                        >
                                          <div className="flex items-center space-x-1.5 truncate min-w-0">
                                            <MapPin
                                              className={`w-3.5 h-3.5 shrink-0 ${
                                                isSelected ? 'text-indigo-600' : 'text-slate-400'
                                              }`}
                                            />
                                            <span className="truncate text-xs">{cleanName}</span>
                                            {isCenter && (
                                              <span className="text-[9px] px-1 py-0.5 rounded bg-sky-100 text-sky-700 font-bold shrink-0">
                                                市中心站
                                              </span>
                                            )}
                                          </div>
                                          <span
                                            className="text-[11px] font-mono font-bold px-1.5 py-0.5 rounded shrink-0 ml-2"
                                            style={{
                                              backgroundColor: stEval.color + '18',
                                              color: stEval.color,
                                            }}
                                            title={onlyPm25 && !stEval.isRealPm25 ? '综合 AQI（点击加载该站实测 PM2.5）' : undefined}
                                          >
                                            AQI {stEval.aqi}
                                          </span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            })()}
                        </div>
                      </>
                    )}
                  </div>
                </div>

                <p className="text-xs text-slate-500 mt-1.5 flex items-center space-x-1.5 flex-wrap gap-y-1">
                  <span>{selectedCity.nameEn}</span>
                  <span>·</span>
                  <span>更新时间: {record.updateTime}</span>
                  {(record.isOffline || evaluation.isOffline) && (
                    <>
                      <span>·</span>
                      <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md bg-amber-50 border border-amber-200/80 text-amber-800 font-medium text-[11px]">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                        <span>站点停更 · 历史实测</span>
                      </span>
                    </>
                  )}
                  {selectedStationMode !== 'default' && selectedStationMode !== 'composite' && (
                    <>
                      <span>·</span>
                      <span className="text-indigo-700 font-semibold bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-200/80 text-[11px]">
                        单站实测:{' '}
                        {(() => {
                          const found = cityStations.find((s) => String(s.uid) === selectedStationMode);
                          const clean = found
                            ? extractCleanStationName(found.station?.name || '', selectedCity.nameZh)
                            : '在册微站';
                          return clean;
                        })()}
                      </span>
                    </>
                  )}
                </p>
              </div>

              <button
                type="button"
                onClick={() => loadCityData(selectedCity, selectedStationMode, false)}
                disabled={loading || stationLoading}
                className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-900 transition-colors shadow-sm cursor-pointer"
                title="刷新数据"
                aria-label="刷新当前城市空气质量数据"
              >
                <RefreshCw className={`w-4 h-4 ${loading || stationLoading ? 'animate-spin text-sky-600' : ''}`} />
              </button>
            </div>

            {/* AQI 大字与等级徽章 */}
            <div className="mt-5 flex items-baseline flex-wrap gap-x-4 gap-y-2">
              <div className="flex items-baseline space-x-2">
                <span className="text-6xl sm:text-7xl font-black tracking-tight" style={{ color: evaluation.color }}>
                  {evaluation.aqi > 0 ? evaluation.aqi : '-'}
                </span>
                <span className="text-slate-500 text-sm font-bold uppercase">AQI</span>
                {onlyPm25 && (
                  <span className="text-[10px] sm:text-xs px-2 py-0.5 rounded-md font-bold bg-sky-100 text-sky-700 border border-sky-200/80 ml-1">
                    仅看 PM2.5
                  </span>
                )}
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

            {/* 首要污染物与健康建议 */}
            <div className="mt-4 p-4 rounded-xl bg-slate-50 border border-slate-100 flex-1 flex flex-col justify-center space-y-2.5">
              <div className="flex items-center justify-between text-slate-700">
                <span className="text-slate-500 font-semibold text-xs sm:text-sm">首要污染物:</span>
                <span className="font-bold text-amber-600 text-xs sm:text-sm">{evaluation.primaryPollutantName}</span>
              </div>
              <div className="flex items-start space-x-2 pt-2.5 border-t border-slate-200/80 text-slate-700">
                <AlertTriangle className="w-4.5 h-4.5 text-sky-600 shrink-0 mt-0.5" />
                <p className="leading-relaxed text-xs sm:text-[13.5px] font-medium">{evaluation.healthAdvice}</p>
              </div>
            </div>

            {/* 气象观测指标条（缺失时诚实展示 --，严禁伪造默认值） */}
            <div className="mt-5 pt-4 border-t border-slate-100 grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
              <div className="p-2 rounded-xl bg-slate-50 border border-slate-100">
                <div className="flex items-center justify-center text-slate-500 mb-1">
                  <Thermometer className="w-3.5 h-3.5 text-rose-500" />
                </div>
                <span translate="no" className="font-bold text-slate-800">
                  {record.weather?.temp !== undefined ? `${record.weather.temp}°C` : '--'}
                </span>
                <p className="text-[10px] text-slate-400">气温</p>
              </div>
              <div className="p-2 rounded-xl bg-slate-50 border border-slate-100">
                <div className="flex items-center justify-center text-slate-500 mb-1">
                  <Droplets className="w-3.5 h-3.5 text-sky-500" />
                </div>
                <span translate="no" className="font-bold text-slate-800">
                  {record.weather?.humidity !== undefined ? `${record.weather.humidity}%` : '--'}
                </span>
                <p className="text-[10px] text-slate-400">湿度</p>
              </div>
              <div className="p-2 rounded-xl bg-slate-50 border border-slate-100">
                <div className="flex items-center justify-center text-slate-500 mb-1">
                  <Wind className="w-3.5 h-3.5 text-teal-500" />
                </div>
                <span translate="no" className="font-bold text-slate-800">
                  {record.weather?.windSpeed !== undefined ? `${record.weather.windSpeed} m/s` : '--'}
                </span>
                <p className="text-[10px] text-slate-400">风速</p>
              </div>
              <div className="p-2 rounded-xl bg-slate-50 border border-slate-100">
                <div className="flex items-center justify-center text-slate-500 mb-1">
                  <Gauge className="w-3.5 h-3.5 text-indigo-500" />
                </div>
                <span translate="no" className="font-bold text-slate-800">
                  {record.weather?.pressure !== undefined ? `${record.weather.pressure} hPa` : '--'}
                </span>
                <p className="text-[10px] text-slate-400">气压</p>
              </div>
            </div>
          </div>

          {/* 右侧：6 大分项污染物卡片 */}
          <div className="lg:col-span-7 glass-panel rounded-2xl p-4 sm:p-6 flex flex-col justify-between min-w-0">
            <div className="min-w-0">
              <div className="flex items-center justify-between gap-2 mb-3.5 sm:mb-4">
                <div className="flex items-center space-x-2 min-w-0">
                  <Activity className="w-4 h-4 text-sky-600 shrink-0" />
                  <h3 className="text-sm sm:text-base font-bold text-slate-900 truncate">六大主要空气污染物浓度</h3>
                </div>
                <Link
                  href={`/history?city=${selectedCity.id}`}
                  className="text-xs text-sky-600 hover:text-sky-700 hover:underline font-semibold shrink-0 whitespace-nowrap"
                >
                  历史数据
                </Link>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 sm:gap-3.5">
                {pollutantCards.map((item) => {
                  const val = item.val ?? 0;
                  const percent = Math.min(100, Math.round((val / item.max) * 100));
                  const itemIAQI = activeIAQI[item.key as keyof typeof activeIAQI];
                  const isSafe = val > 0 && val <= item.limit;

                  return (
                    <div
                      key={item.key}
                      className="min-w-0 p-3 sm:p-4 rounded-xl bg-slate-50/90 border border-slate-200/80 flex flex-col justify-between hover:border-slate-300 hover:shadow-xs transition-all shadow-2xs"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center justify-between gap-1 text-xs text-slate-600 mb-2 sm:mb-2.5 min-w-0">
                          <span className="font-bold text-slate-800 text-xs sm:text-[13px] truncate min-w-0">{item.name}</span>
                          {itemIAQI !== undefined && (
                            <span
                              translate="no"
                              className="text-[10px] sm:text-[11px] font-mono px-1.5 py-0.5 rounded bg-slate-200/80 text-slate-700 font-bold shrink-0"
                              title="单项空气质量分指数 (IAQI)"
                            >
                              IAQI {itemIAQI}
                            </span>
                          )}
                        </div>
                        <div className="flex items-baseline justify-between gap-1 min-w-0">
                          <span className="text-xl sm:text-2xl md:text-3xl font-black text-slate-900 tracking-tight truncate">
                            {val > 0 ? val : '--'}
                          </span>
                          <span translate="no" className="text-xs sm:text-sm text-slate-500 font-semibold shrink-0">
                            {item.unit}
                          </span>
                        </div>
                      </div>

                      <div className="mt-2.5 sm:mt-3 pt-2 border-t border-slate-200/50 min-w-0">
                        <div className="w-full bg-slate-200/80 rounded-full h-1.5 overflow-hidden mb-1 sm:mb-1.5">
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{ width: `${percent}%`, backgroundColor: item.color }}
                          ></div>
                        </div>
                        <div className="flex items-center justify-between gap-1 text-[11px] sm:text-xs text-slate-500 font-mono min-w-0">
                          <span className="font-medium text-slate-600 truncate min-w-0" title={item.limitTitle}>
                            {item.label}
                          </span>
                          {val > 0 && (
                            <span
                              className={`text-[11px] sm:text-xs font-bold px-1.5 py-0.5 rounded whitespace-nowrap shrink-0 ${
                                isSafe
                                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/80'
                                  : 'bg-amber-50 text-amber-700 border border-amber-200/80'
                              }`}
                            >
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
          </div>
        </div>
      ) : !loadError ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-6">
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
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 mb-2">
          <div className="flex items-center space-x-2">
            <Activity className="w-4 h-4 text-sky-600" />
            <h3 className="text-sm sm:text-base font-bold text-slate-900">逐小时空气质量变化轨迹</h3>
          </div>
          {trendResult?.source && (
            <span className="text-[11px] text-slate-400 font-medium">{trendResult.source}</span>
          )}
        </div>
        <TrendChart
          data={trendResult?.points || []}
          city={selectedCity.nameZh}
          isReal={trendResult?.isReal}
          loading={loading || stationLoading || trendLoading}
        />
      </section>

      {/* 未来 5 天空气质量预测走势 */}
      <section className="glass-panel rounded-2xl p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 mb-4 sm:mb-5">
          <div className="flex items-center flex-wrap gap-2">
            <Calendar className="w-4.5 h-4.5 sm:w-5 sm:h-5 text-indigo-600" />
            <h3 className="text-base sm:text-lg font-bold text-slate-900">未来 5 天空气质量预测走势</h3>
            {forecastData.source && (
              <span className="text-[10px] sm:text-[11px] px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 font-semibold border border-indigo-200 shadow-sm flex items-center space-x-1">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse inline-block mr-1"></span>
                <span>{forecastData.source}</span>
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2.5 sm:gap-3.5">
          {loading || forecastLoading ? (
            [1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="p-3.5 sm:p-4 rounded-xl bg-slate-50/80 border border-slate-200/70 space-y-3 animate-pulse"
              >
                <div className="flex items-center justify-between">
                  <div className="h-3.5 w-16 bg-slate-200 rounded" />
                  <div className="h-5 w-12 bg-slate-200 rounded-md" />
                </div>
                <div className="flex items-center justify-between pt-1">
                  <div className="h-3 w-12 bg-slate-100 rounded" />
                  <div className="h-3.5 w-10 bg-slate-200 rounded" />
                </div>
                <div className="pt-2.5 border-t border-slate-200/60 space-y-2">
                  <div className="flex justify-between">
                    <div className="h-3 w-14 bg-slate-100 rounded" />
                    <div className="h-3 w-12 bg-slate-200 rounded" />
                  </div>
                  <div className="flex justify-between">
                    <div className="h-2.5 w-12 bg-slate-100 rounded" />
                    <div className="h-2.5 w-16 bg-slate-100 rounded" />
                  </div>
                </div>
              </div>
            ))
          ) : forecastData.list.length > 0 ? (
            forecastData.list.map((f, idx) => {
              const evalRes = evaluateAQI({ pm25: f.avg }, standard, onlyPm25);
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
                        <span className="text-xs font-bold font-mono text-slate-800">{f.day.slice(5)}</span>
                        <span className="text-[11px] text-slate-500 font-medium">{isToday ? '(今天)' : weekName}</span>
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
                      <span className="text-xs font-bold" style={{ color: evalRes.color }}>
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
                        <span>
                          {f.min} ~ {f.max} μg/m³
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="col-span-full p-8 text-center text-slate-400 text-xs">
              当前城市暂无未来 5 天空气质量预报发布
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[60vh] flex flex-col items-center justify-center space-y-3">
          <Loader2 className="w-8 h-8 animate-spin text-sky-600" />
          <p className="text-xs text-slate-500 font-medium">正在加载实时空气质量总览...</p>
        </div>
      }
    >
      <DashboardPageContent />
    </Suspense>
  );
}
