import { describe, it, expect } from 'vitest';
import { decodeWaqiObsSeries, build24HourPointsFromWaqiObs } from '@/lib/services/waqi-decoder';

describe('WAQI Delta Observation Decoder', () => {
  it('decodes prefix-sum delta series in chronological order', () => {
    const series = decodeWaqiObsSeries({
      s: '2026-10-07 15:00:00',
      d: 3600,
      m: 1,
      v: [50, -10, 5], // t=15:00 -> 50, t=14:00 -> 40, t=13:00 -> 45
    });

    expect(series).toHaveLength(3);
    expect(series.map((p) => p.value)).toEqual([45, 40, 50]);
    expect(series[0].timestamp).toBeLessThan(series[1].timestamp);
    expect(series[1].timestamp).toBeLessThan(series[2].timestamp);
  });

  it('builds consistent US and CN hourly points without double-converting IAQI', () => {
    const obs = {
      pm25: {
        s: '2026-10-07 15:00:00',
        d: 3600,
        m: 1,
        v: [50, 0, 50], // 15:00 -> 50, 14:00 -> 50, 13:00 -> 100
      },
      o3: {
        s: '2026-10-07 15:00:00',
        d: 3600,
        m: 1,
        v: [30, 0, 0],
      },
    };

    const usPoints = build24HourPointsFromWaqiObs(obs, 'US');
    const cnPoints = build24HourPointsFromWaqiObs(obs, 'CN');

    expect(usPoints).toHaveLength(3);
    // Latest point (15:00): US PM2.5 IAQI = 50 -> 9.0 ug/m3 under EPA 2024
    expect(usPoints[2].aqi).toBe(50);
    expect(usPoints[2].pm25).toBe(9.0);
    // Same physical mass concentration under CN HJ 633 -> ~13 IAQI (9/35 * 50)
    expect(cnPoints[2].pm25).toBe(9.0);
    expect(cnPoints[2].aqi).toBeLessThan(50);
  });
});
