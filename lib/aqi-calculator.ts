import { AQIEvaluation, PollutantValues, IAQIValues, StandardType } from './types';

// 中国国标 HJ 633-2012 断点表
const CN_BREAKPOINTS = {
  iaqi: [0, 50, 100, 150, 200, 300, 400, 500],
  pm25: [0, 35, 75, 115, 150, 250, 350, 500],
  pm10: [0, 50, 150, 250, 350, 420, 500, 600],
  so2: [0, 150, 500, 650, 800],
  no2: [0, 100, 200, 700, 1200, 2340, 3090, 3840],
  co: [0, 5, 10, 35, 60, 90, 120, 150],
  o3: [0, 160, 200, 300, 400, 800, 1000, 1200],
};

// 美国环保署 US EPA 断点表 (浓度转微克/立方米)
const US_BREAKPOINTS = {
  aqi: [0, 50, 100, 150, 200, 300, 500],
  pm25: [0.0, 12.0, 35.4, 55.4, 150.4, 250.4, 500.4],
  pm10: [0, 54, 154, 254, 354, 424, 604],
  no2: [0, 100, 188, 677, 1221, 2349, 3853],
  so2: [0, 92, 197, 485, 797, 1584, 2630],
  co: [0, 5.0, 10.8, 14.2, 17.6, 34.8, 57.6],
  o3: [0, 108, 140, 170, 210, 400, 800],
};

function calculateIAQI(concentration: number, bpConcentrations: number[], bpIAQI: number[]): number {
  if (concentration <= 0 || isNaN(concentration)) return 0;
  
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
      return Math.round(iaqi);
    }
  }

  return 0;
}

export function calculateCNIAQI(pollutants: PollutantValues): IAQIValues {
  const result: IAQIValues = {};
  if (pollutants.pm25 !== undefined) {
    result.pm25 = calculateIAQI(pollutants.pm25, CN_BREAKPOINTS.pm25, CN_BREAKPOINTS.iaqi);
  }
  if (pollutants.pm10 !== undefined) {
    result.pm10 = calculateIAQI(pollutants.pm10, CN_BREAKPOINTS.pm10, CN_BREAKPOINTS.iaqi);
  }
  if (pollutants.so2 !== undefined) {
    result.so2 = calculateIAQI(pollutants.so2, CN_BREAKPOINTS.so2, CN_BREAKPOINTS.iaqi);
  }
  if (pollutants.no2 !== undefined) {
    result.no2 = calculateIAQI(pollutants.no2, CN_BREAKPOINTS.no2, CN_BREAKPOINTS.iaqi);
  }
  if (pollutants.co !== undefined) {
    result.co = calculateIAQI(pollutants.co, CN_BREAKPOINTS.co, CN_BREAKPOINTS.iaqi);
  }
  if (pollutants.o3 !== undefined) {
    result.o3 = calculateIAQI(pollutants.o3, CN_BREAKPOINTS.o3, CN_BREAKPOINTS.iaqi);
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

export function evaluateAQI(pollutants: PollutantValues, standard: StandardType = 'CN'): AQIEvaluation {
  const iaqi = standard === 'CN' ? calculateCNIAQI(pollutants) : calculateUSIAQI(pollutants);

  let maxAQI = 0;
  let primaryPollutant = 'pm25';

  const validEntries = Object.entries(iaqi).filter(([_, v]) => v !== undefined && !isNaN(v as number)) as [string, number][];

  if (validEntries.length > 0) {
    for (const [key, val] of validEntries) {
      if (val > maxAQI) {
        maxAQI = val;
        primaryPollutant = key;
      }
    }
  }

  // 兜底：如果完全没有分项，则设定为良
  if (maxAQI === 0 && pollutants.pm25) {
    maxAQI = Math.round(pollutants.pm25 * 1.2);
  }

  if (standard === 'CN') {
    return getCNEvaluation(maxAQI, primaryPollutant);
  } else {
    return getUSEvaluation(maxAQI, primaryPollutant);
  }
}

function getCNEvaluation(aqi: number, primaryPollutant: string): AQIEvaluation {
  let level = '优';
  let levelEn = 'Good';
  let color = '#10b981'; // 绿
  let textColor = '#ffffff';
  let healthAdvice = '空气质量令人满意，基本无空气污染，各类人群可正常户外活动。';

  if (aqi <= 50) {
    level = '优 (一级)';
    levelEn = 'Excellent';
    color = '#10b981';
    healthAdvice = '空气质量优，各项指标非常清洁，极适宜户外锻炼与开窗通风。';
  } else if (aqi <= 100) {
    level = '良 (二级)';
    levelEn = 'Good';
    color = '#eab308';
    healthAdvice = '空气质量可接受，但极少数异常敏感人群应适当减少长时间户外活动。';
  } else if (aqi <= 150) {
    level = '轻度污染 (三级)';
    levelEn = 'Lightly Polluted';
    color = '#f97316';
    healthAdvice = '易感人群症状有轻度加剧，儿童、老年人及心脏病、呼吸系统疾病患者应减少长时间、高强度的户外锻炼。';
  } else if (aqi <= 200) {
    level = '中度污染 (四级)';
    levelEn = 'Moderately Polluted';
    color = '#ef4444';
    healthAdvice = '进一步加剧易感人群症状，敏感人群避免户外活动，一般人群适量减少户外运动并佩戴防雾霾口罩。';
  } else if (aqi <= 300) {
    level = '重度污染 (五级)';
    levelEn = 'Heavily Polluted';
    color = '#8b5cf6';
    healthAdvice = '心脏病和肺病患者症状显著加剧，儿童、老年人及病人应停留在室内，一般人群应避免户外运动。';
  } else {
    level = '严重污染 (六级)';
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

function getUSEvaluation(aqi: number, primaryPollutant: string): AQIEvaluation {
  let level = '良好 (Good)';
  let levelEn = 'Good';
  let color = '#10b981';
  let textColor = '#ffffff';
  let healthAdvice = 'Air quality is satisfactory, and poses little or no risk.';

  if (aqi <= 50) {
    level = '优 (Good)';
    levelEn = 'Good';
    color = '#10b981';
    healthAdvice = 'Air quality is considered satisfactory, and air pollution poses little or no risk.';
  } else if (aqi <= 100) {
    level = '良 (Moderate)';
    levelEn = 'Moderate';
    color = '#eab308';
    healthAdvice = 'Air quality is acceptable. Very sensitive individuals should limit prolonged outdoor exertion.';
  } else if (aqi <= 150) {
    level = '对敏感人群不健康 (USG)';
    levelEn = 'Unhealthy for Sensitive Groups';
    color = '#f97316';
    healthAdvice = 'Members of sensitive groups may experience health effects. General public not likely affected.';
  } else if (aqi <= 200) {
    level = '不健康 (Unhealthy)';
    levelEn = 'Unhealthy';
    color = '#ef4444';
    healthAdvice = 'Everyone may begin to experience health effects; sensitive groups may experience serious effects.';
  } else if (aqi <= 300) {
    level = '非常不健康 (Very Unhealthy)';
    levelEn = 'Very Unhealthy';
    color = '#8b5cf6';
    healthAdvice = 'Health alert: The risk of health effects is increased for everyone.';
  } else {
    level = '严重危害 (Hazardous)';
    levelEn = 'Hazardous';
    color = '#7f1d1d';
    healthAdvice = 'Health warning of emergency conditions: everyone is more likely to be affected.';
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
