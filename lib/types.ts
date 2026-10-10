export type StandardType = 'CN' | 'US';

export interface PollutantValues {
  pm25?: number; // ug/m3
  pm10?: number; // ug/m3
  o3?: number;   // ug/m3
  no2?: number;  // ug/m3
  so2?: number;  // ug/m3
  co?: number;   // mg/m3
}

export interface IAQIValues {
  pm25?: number;
  pm10?: number;
  o3?: number;
  no2?: number;
  so2?: number;
  co?: number;
}

export interface AQIEvaluation {
  aqi: number;
  level: string;
  levelEn: string;
  color: string;
  textColor: string;
  primaryPollutant: string;
  primaryPollutantName: string;
  healthAdvice: string;
  standard: StandardType;
  isOffline?: boolean;
}

export interface WeatherInfo {
  temp?: number;
  humidity?: number;
  windSpeed?: number;
  pressure?: number;
}

export interface ForecastDay {
  day: string; // YYYY-MM-DD
  avg: number;
  min: number;
  max: number;
}

export interface ForecastData {
  pm25?: ForecastDay[];
  pm10?: ForecastDay[];
  o3?: ForecastDay[];
  uvi?: ForecastDay[];
}

export interface AirQualityRecord {
  id: string;
  name: string;
  nameEn: string;
  country: string;
  isDomestic: boolean;
  stationIdx?: number;
  latitude: number;
  longitude: number;
  updateTime: string;
  pollutants: PollutantValues;
  iaqi: IAQIValues;
  iaqiCN?: IAQIValues;
  iaqiUS?: IAQIValues;
  evaluationCN: AQIEvaluation;
  evaluationUS: AQIEvaluation;
  weather?: WeatherInfo;
  forecast?: ForecastData;
  sourceAttribution?: {
    name: string;
    url?: string;
  }[];
  isOffline?: boolean;
}

export interface CityMeta {
  id: string;
  nameZh: string;
  nameEn: string;
  country: string;
  province?: string;
  latitude: number;
  longitude: number;
  isDomestic: boolean;
  waqiSlug?: string;
  population?: number;
}

export interface StationMeta {
  code: string;
  name: string;
  city: string;
  latitude: number;
  longitude: number;
  isCleanStation?: boolean;
}

export interface DailyStat {
  date: string; // YYYY-MM-DD
  aqi: number;
  pm25: number;
  pm10: number;
  o3: number;
  primaryPollutant: string;
  level: string;
  color: string;
}

export interface AnnualTrend {
  year: number;
  pm25Avg: number;
  pm10Avg: number;
  goodDaysRatio: number; // 优良天数比例 %
  pollutedDays?: number; // 超标 / 不健康天数 (AQI > 100)
  heavyPollutionDays: number; // 重污染天数 (国标 AQI>200, 美标 AQI>150)
  aqiAvg?: number; // 年均等效 AQI (随标准动态变化)
  daysCount?: number; // 实测有效在册总天数
}

export interface CalendarHeatmapDay {
  date: string;
  aqi: number;
  level: string;
  color: string;
  primaryPollutant: string;
  primaryPollutantName: string;
  pm25?: number;
  pm10?: number;
  o3?: number;
  no2?: number;
  so2?: number;
  co?: number;
}

