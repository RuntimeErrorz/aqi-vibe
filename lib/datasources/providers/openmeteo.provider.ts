import type { ForecastDay } from '../../types';
import { createTimeoutSignal } from '../units';
import type { AirQualityProvider } from '../types';

/**
 * Open-Meteo ECMWF/CAMS Numerical Dispersion Model Provider:
 * - Strictly `numerical-model` tier (100% Free, Zero API Key)
 * - Per AGENTS.md §9, NEVER registered for ground-station realtime observation;
 *   exclusively provides 5-day air quality forecasts.
 */
export const openMeteoProvider: AirQualityProvider = {
  id: 'open-meteo',
  name: 'CAMS / ECMWF 数值预报',
  shortName: 'ECMWF CAMS',
  tier: 'numerical-model',
  supportedCountries: '*',
  supportsBrowserDirect: true,

  isAvailable(): boolean {
    return true;
  },

  forecast: {
    async fetch5DayForecast(lat, lon, ctx) {
      const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&hourly=pm2_5&forecast_days=6&timezone=auto`;
      const res = await ctx.fetchImpl(url, {
        signal: createTimeoutSignal(ctx.timeoutMs ?? 4500, ctx.signal),
      });
      if (!res.ok) return null;

      const data = (await res.json()) as any;
      const times: string[] = data?.hourly?.time || [];
      const pm25Arr: (number | null)[] = data?.hourly?.pm2_5 || [];

      const now = new Date(ctx.nowMs);
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, '0');
      const d = String(now.getDate()).padStart(2, '0');
      const todayStr = `${y}-${m}-${d}`;

      const forecastMap: Record<string, number[]> = {};
      for (let i = 0; i < times.length; i++) {
        const dayStr = times[i].slice(0, 10);
        const v = pm25Arr[i];
        if (dayStr >= todayStr && v != null && !isNaN(v)) {
          if (!forecastMap[dayStr]) forecastMap[dayStr] = [];
          forecastMap[dayStr].push(v);
        }
      }

      const list: ForecastDay[] = Object.entries(forecastMap)
        .slice(0, 5)
        .map(([day, vals]) => ({
          day,
          min: Math.round(Math.min(...vals)),
          max: Math.round(Math.max(...vals)),
          avg: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length),
        }));

      if (list.length === 0) return null;
      return {
        list,
        source: 'CAMS / ECMWF 全球数值预报',
      };
    },
  },
};
