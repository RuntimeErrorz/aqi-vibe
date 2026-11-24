import { describe, it, expect } from 'vitest';
import {
  calculatePM25AQI,
  calculateCNIAQI,
  calculateUSIAQI,
  convertIAQIToConcentration,
  evaluateAQI,
  WHO_2021_GUIDELINES,
} from '@/lib/aqi-calculator';

describe('AQI Calculator (US EPA 2024 & CN HJ 633-2012 Hourly/Daily)', () => {
  it('enforces US EPA 2024 PM2.5 breakpoints (9.0 Good ceiling, 325.4 = 500)', () => {
    expect(calculatePM25AQI(0, 'US')).toBe(0);
    expect(calculatePM25AQI(9.0, 'US')).toBe(50);
    expect(calculatePM25AQI(12.0, 'US')).toBeGreaterThan(50); // Under 2024 rule, 12.0 is Moderate, not Good!
    expect(calculatePM25AQI(35.4, 'US')).toBe(100);
    expect(calculatePM25AQI(55.4, 'US')).toBe(150);
    expect(calculatePM25AQI(125.4, 'US')).toBe(200);
    expect(calculatePM25AQI(225.4, 'US')).toBe(300);
    expect(calculatePM25AQI(325.4, 'US')).toBe(500);
    expect(calculatePM25AQI(600, 'US')).toBe(500);
  });

  it('distinguishes CN HJ 633-2012 hourly vs daily breakpoints for NO2, SO2, CO, O3', () => {
    // NO2 = 80 ug/m3: daily ceiling for IAQI 100, but only IAQI 40 on 1h scale
    const hourlyNO2 = calculateCNIAQI({ no2: 80 }, 'hourly').no2;
    const dailyNO2 = calculateCNIAQI({ no2: 80 }, 'daily').no2;
    expect(hourlyNO2).toBe(40);
    expect(dailyNO2).toBe(100);

    // O3 = 160 ug/m3: daily O3_8h IAQI = 100, hourly O3_1h IAQI = 50
    expect(calculateCNIAQI({ o3: 160 }, 'hourly').o3).toBe(50);
    expect(calculateCNIAQI({ o3: 160 }, 'daily').o3).toBe(100);

    // SO2 = 150 ug/m3: daily IAQI = 100, hourly IAQI = 50
    expect(calculateCNIAQI({ so2: 150 }, 'hourly').so2).toBe(50);
    expect(calculateCNIAQI({ so2: 150 }, 'daily').so2).toBe(100);

    // CO = 4 mg/m3: daily IAQI = 100, hourly IAQI = 40
    expect(calculateCNIAQI({ co: 4 }, 'hourly').co).toBe(40);
    expect(calculateCNIAQI({ co: 4 }, 'daily').co).toBe(100);
  });

  it('round-trips IAQI <-> concentration accurately under US EPA 2024', () => {
    const conc = convertIAQIToConcentration('pm25', 50, 'US');
    expect(conc).toBe(9.0);
    expect(calculatePM25AQI(conc, 'US')).toBe(50);

    const conc150 = convertIAQIToConcentration('pm25', 150, 'US');
    expect(conc150).toBe(55.4);
    expect(calculateUSIAQI({ pm25: conc150 }).pm25).toBe(150);
  });

  it('isolates PM2.5 strictly when onlyPm25 = true (no max with O3/PM10)', () => {
    const pollutants = { pm25: 9.0, o3: 240, pm10: 300 };
    const compUS = evaluateAQI(pollutants, 'US', false);
    const pm25OnlyUS = evaluateAQI(pollutants, 'US', true);

    expect(compUS.aqi).toBeGreaterThan(200);
    expect(compUS.primaryPollutant).toBe('o3');
    expect(pm25OnlyUS.aqi).toBe(50);
    expect(pm25OnlyUS.primaryPollutant).toBe('pm25');
  });

  it('handles missing/invalid concentrations honestly with AQI 0 & No Data', () => {
    const res = evaluateAQI({}, 'CN');
    expect(res.aqi).toBe(0);
    expect(res.level).toBe('暂无数据');
    expect(WHO_2021_GUIDELINES.pm25Annual).toBe(5);
  });
});
