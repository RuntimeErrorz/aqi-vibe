import { AQIEvaluation, PollutantValues, IAQIValues, StandardType } from './types';
import standardsConfig from '../shared/aqi-standards.json';

export type AveragingPeriod = 'hourly' | 'daily';

// WHO AQG 2021 全球空气质量健康参考准则
export const WHO_2021_GUIDELINES = standardsConfig.who2021;

// 中国国标 HJ 633-2012 断点表（区分实时小时评价与 24h 日均/O3_8h 评价）
export const CN_HOURLY_BREAKPOINTS = standardsConfig.cn_hourly;
export const CN_DAILY_BREAKPOINTS = standardsConfig.cn_daily;

// 美国环保署 US EPA 2024 修订断点表 (2024年5月6日生效：PM2.5 优限值 9.0 μg/m³)
export const US_BREAKPOINTS = standardsConfig.us_2024;

function getCNBreakpoints(period: AveragingPeriod) {
  return period === 'daily' ? CN_DAILY_BREAKPOINTS : CN_HOURLY_BREAKPOINTS;
}

function calculateIAQI(concentration: number, bpConcentrations: number[], bpIAQI: number[]): number {
  if (!Number.isFinite(concentration) || concentration <= 0) return 0;

  const maxIdx = Math.min(bpConcentrations.length - 1, bpIAQI.length - 1);
  if (concentration >= bpConcentrations[maxIdx]) {
    return bpIAQI[maxIdx];
  }

  for (let i = 0; i < maxIdx; i++) {
    const cLow = bpConcentrations[i];
    const cHigh = bpConcentrations[i + 1];
    const iLow = bpIAQI[i];
    const iHigh = bpIAQI[i + 1];

    if (concentration >= cLow && concentration <= cHigh) {
      const iaqi = ((iHigh - iLow) / (cHigh - cLow)) * (concentration - cLow) + iLow;
      // Valid positive concentration should never round down to 0 ("No Data")
      return Math.max(1, Math.round(iaqi));
    }
  }

  return 0;
}

/**
 * 根据分指数 IAQI 逆向计算对应物理质量浓度
 */
export function calculateConcentrationFromIAQI(
  iaqi: number,
  bpConcentrations: number[],
  bpIAQI: number[]
): number {
  if (!Number.isFinite(iaqi) || iaqi <= 0) return 0;
  const maxIdx = Math.min(bpConcentrations.length - 1, bpIAQI.length - 1);
  if (iaqi >= bpIAQI[maxIdx]) {
    return bpConcentrations[maxIdx];
  }

  for (let i = 0; i < maxIdx; i++) {
    const iLow = bpIAQI[i];
    const iHigh = bpIAQI[i + 1];
    const cLow = bpConcentrations[i];
    const cHigh = bpConcentrations[i + 1];

    if (iaqi >= iLow && iaqi <= iHigh) {
      const conc = ((cHigh - cLow) / (iHigh - iLow)) * (iaqi - iLow) + cLow;
      return Math.round(conc * 10) / 10;
    }
  }

  return 0;
}

export function convertIAQIToConcentration(
  pollutant: 'pm25' | 'pm10' | 'o3' | 'no2' | 'so2' | 'co',
  iaqiVal: number,
  standard: StandardType = 'US',
  period: AveragingPeriod = 'hourly'
): number {
  const bp = standard === 'CN' ? getCNBreakpoints(period) : US_BREAKPOINTS;
  const bpIAQI = standard === 'CN' ? (bp as typeof CN_HOURLY_BREAKPOINTS).iaqi : US_BREAKPOINTS.aqi;
  const bpConc = (bp as Record<string, number[]>)[pollutant];
  if (!bpConc) return iaqiVal;
  return calculateConcentrationFromIAQI(iaqiVal, bpConc, bpIAQI);
}

export function calculateCNIAQI(
  pollutants: PollutantValues,
  period: AveragingPeriod = 'hourly'
): IAQIValues {
  const bp = getCNBreakpoints(period);
  const result: IAQIValues = {};
  if (pollutants.pm25 !== undefined) {
    result.pm25 = calculateIAQI(pollutants.pm25, bp.pm25, bp.iaqi);
  }
  if (pollutants.pm10 !== undefined) {
    result.pm10 = calculateIAQI(pollutants.pm10, bp.pm10, bp.iaqi);
  }
  if (pollutants.so2 !== undefined) {
    result.so2 = calculateIAQI(pollutants.so2, bp.so2, bp.iaqi);
  }
  if (pollutants.no2 !== undefined) {
    result.no2 = calculateIAQI(pollutants.no2, bp.no2, bp.iaqi);
  }
  if (pollutants.co !== undefined) {
    result.co = calculateIAQI(pollutants.co, bp.co, bp.iaqi);
  }
  if (pollutants.o3 !== undefined) {
    result.o3 = calculateIAQI(pollutants.o3, bp.o3, bp.iaqi);
  }
  return result;
}

export function calculateUSIAQI(pollutants: PollutantValues): IAQIValues {
  const result: IAQIValues = {};
  if (pollutants.pm25 !== undefined) {
    result.pm25 = calculateIAQI(pollutants.pm25, US_BREAKPOINTS.pm25, US_BREAKPOINTS.aqi);
  }
  if (pollutants.pm10 !== undefined) {
    result.pm10 = calculateIAQI(pollutants.pm10, US_BREAKPOINTS.pm10, US_BREAKPOINTS.aqi);
  }
  if (pollutants.so2 !== undefined) {
    result.so2 = calculateIAQI(pollutants.so2, US_BREAKPOINTS.so2, US_BREAKPOINTS.aqi);
  }
  if (pollutants.no2 !== undefined) {
    result.no2 = calculateIAQI(pollutants.no2, US_BREAKPOINTS.no2, US_BREAKPOINTS.aqi);
  }
  if (pollutants.co !== undefined) {
    result.co = calculateIAQI(pollutants.co, US_BREAKPOINTS.co, US_BREAKPOINTS.aqi);
  }
  if (pollutants.o3 !== undefined) {
    result.o3 = calculateIAQI(pollutants.o3, US_BREAKPOINTS.o3, US_BREAKPOINTS.aqi);
  }
  return result;
}

const POLLUTANT_NAMES_ZH: Record<string, string> = {
  pm25: 'PM2.5 (细颗粒物)',
  pm10: 'PM10 (可吸入颗粒物)',
  o3: '臭氧 (O₃)',
  no2: '二氧化氮 (NO₂)',
  so2: '二氧化硫 (SO₂)',
  co: '一氧化碳 (CO)',
};

/**
 * 纯粹基于 PM2.5 物理质量浓度计算 AQI（仅看 PM2.5 模式核心算法）
 * 严格只根据 PM2.5 单项指标分指数折算，绝对不与其他污染物比较或取最大值
 */
export function calculatePM25AQI(
  pm25Concentration: number | undefined | null,
  standard: StandardType = 'US',
  period: AveragingPeriod = 'hourly'
): number {
  if (
    pm25Concentration === undefined ||
    pm25Concentration === null ||
    !Number.isFinite(pm25Concentration) ||
    pm25Concentration <= 0
  ) {
    return 0;
  }
  if (standard === 'CN') {
    const bp = getCNBreakpoints(period);
    return calculateIAQI(pm25Concentration, bp.pm25, bp.iaqi);
  } else {
    return calculateIAQI(pm25Concentration, US_BREAKPOINTS.pm25, US_BREAKPOINTS.aqi);
  }
}

export function evaluateAQI(
  pollutants: PollutantValues,
  standard: StandardType = 'US',
  onlyPm25 = false,
  period: AveragingPeriod = 'hourly'
): AQIEvaluation {
  // 1. 若开启「只看 PM2.5」模式：AQI 计算完全只按照 PM2.5 单项物理质量浓度计算
  if (onlyPm25) {
    const pm25Val = pollutants.pm25;
    const aqi = calculatePM25AQI(pm25Val, standard, period);
    const evalResult = standard === 'CN' ? getCNEvaluation(aqi, 'pm25') : getUSEvaluation(aqi, 'pm25');
    if (aqi <= 0) {
      return evalResult;
    }
    return {
      ...evalResult,
      primaryPollutant: 'pm25',
      primaryPollutantName: 'PM2.5 (细颗粒物)',
    };
  }

  // 2. 综合全项 AQI 模式：取六项污染物 IAQI 分指数中的最大值 (max)
  const iaqi = standard === 'CN' ? calculateCNIAQI(pollutants, period) : calculateUSIAQI(pollutants);

  let maxAQI = 0;
  let primaryPollutant = 'pm25';

  const validEntries = Object.entries(iaqi).filter(
    ([_, v]) => v !== undefined && !isNaN(v as number)
  ) as [string, number][];

  if (validEntries.length > 0) {
    for (const [key, val] of validEntries) {
      if (val > maxAQI) {
        maxAQI = val;
        primaryPollutant = key;
      }
    }
  }

  if (maxAQI === 0 && pollutants.pm25) {
    maxAQI = calculatePM25AQI(pollutants.pm25, standard);
  }

  if (standard === 'CN') {
    return getCNEvaluation(maxAQI, primaryPollutant);
  } else {
    return getUSEvaluation(maxAQI, primaryPollutant);
  }
}

export function getCNEvaluation(aqi: number, primaryPollutant = 'pm25'): AQIEvaluation {
  if (isNaN(aqi) || aqi <= 0) {
    return {
      aqi: 0,
      level: '暂无数据',
      levelEn: 'No Data',
      color: '#64748b',
      textColor: '#ffffff',
      primaryPollutant,
      primaryPollutantName: '暂无',
      healthAdvice: '当前站点暂无实时监测数据发布。',
      standard: 'CN',
    };
  }

  let level = '优';
  let levelEn = 'Good';
  let color = '#10b981';
  const textColor = '#ffffff';
  let healthAdvice = '空气质量令人满意，基本无空气污染，各类人群可正常户外活动。';

  if (aqi <= 50) {
    level = '优';
    levelEn = 'Excellent';
    color = '#10b981';
    healthAdvice = '空气质量优，各项指标非常清洁，极适宜户外锻炼与开窗通风。';
  } else if (aqi <= 100) {
    level = '良';
    levelEn = 'Good';
    color = '#eab308';
    healthAdvice = '空气质量可接受，但极少数异常敏感人群应适当减少长时间户外活动。';
  } else if (aqi <= 150) {
    level = '轻度污染';
    levelEn = 'Lightly Polluted';
    color = '#f97316';
    healthAdvice = '易感人群症状有轻度加剧，儿童、老年人及心脏病、呼吸系统疾病患者应减少长时间、高强度的户外锻炼。';
  } else if (aqi <= 200) {
    level = '中度污染';
    levelEn = 'Moderately Polluted';
    color = '#ef4444';
    healthAdvice = '进一步加剧易感人群症状，敏感人群避免户外活动，一般人群适量减少户外运动并佩戴防雾霾口罩。';
  } else if (aqi <= 300) {
    level = '重度污染';
    levelEn = 'Heavily Polluted';
    color = '#8b5cf6';
    healthAdvice = '心脏病和肺病患者症状显著加剧，儿童、老年人及病人应停留在室内，一般人群应避免户外运动。';
  } else {
    level = '严重污染';
    levelEn = 'Severely Polluted';
    color = '#7f1d1d';
    healthAdvice = '健康人运动耐受力降低，有明显强烈症状。儿童、老年人和病人应当留在室内，避免体力消耗。';
  }

  return {
    aqi,
    level,
    levelEn,
    color,
    textColor,
    primaryPollutant,
    primaryPollutantName: POLLUTANT_NAMES_ZH[primaryPollutant] || primaryPollutant.toUpperCase(),
    healthAdvice,
    standard: 'CN',
  };
}

export function getUSEvaluation(aqi: number, primaryPollutant = 'pm25'): AQIEvaluation {
  if (isNaN(aqi) || aqi <= 0) {
    return {
      aqi: 0,
      level: '暂无数据',
      levelEn: 'No Data',
      color: '#64748b',
      textColor: '#ffffff',
      primaryPollutant,
      primaryPollutantName: '暂无',
      healthAdvice: '当前站点暂无实时监测数据发布。',
      standard: 'US',
    };
  }

  let level = '优';
  let levelEn = 'Good';
  let color = '#10b981';
  const textColor = '#ffffff';
  let healthAdvice = '空气质量优良，无污染风险，极适宜正常户外活动。';

  if (aqi <= 50) {
    level = '优';
    levelEn = 'Good';
    color = '#10b981';
    healthAdvice = '空气质量优良，无污染风险，极适宜各类户外运动与开窗通风。';
  } else if (aqi <= 100) {
    level = '良';
    levelEn = 'Moderate';
    color = '#eab308';
    healthAdvice = '空气质量可接受，极少数对空气异常敏感的人群应减少长时间户外剧烈活动。';
  } else if (aqi <= 150) {
    level = '敏感不适';
    levelEn = 'Unhealthy for Sensitive Groups';
    color = '#f97316';
    healthAdvice = '易感人群（儿童、老人及心肺疾病患者）应减少长时间高强度户外运动；普通公众暂不受明显影响。';
  } else if (aqi <= 200) {
    level = '不健康';
    levelEn = 'Unhealthy';
    color = '#ef4444';
    healthAdvice = '空气达到不健康水平，所有人群均可能受到不良健康影响，敏感人群应避免户外活动并佩戴防护口罩。';
  } else if (aqi <= 300) {
    level = '非常不健康';
    levelEn = 'Very Unhealthy';
    color = '#8b5cf6';
    healthAdvice = '触发严重健康警报，全体人群受健康损害风险显著升高，所有人均应尽量避免户外活动。';
  } else {
    level = '严重危害';
    levelEn = 'Hazardous';
    color = '#7f1d1d';
    healthAdvice = '达到紧急健康警报状态，全体人群均极易受到严重呼吸道健康损伤，所有人应留在室内并关闭门窗。';
  }

  return {
    aqi,
    level,
    levelEn,
    color,
    textColor,
    primaryPollutant,
    primaryPollutantName: POLLUTANT_NAMES_ZH[primaryPollutant] || primaryPollutant.toUpperCase(),
    healthAdvice,
    standard: 'US',
  };
}
