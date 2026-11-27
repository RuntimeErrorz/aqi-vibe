import type { WeatherInfo } from '../types';

/**
 * Compute great-circle spherical distance (km) between two WGS-84 coordinates.
 */
export function getDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Robust spatial outlier filter using Median-MAD (Median Absolute Deviation).
 * Only activates when >= 3 items carry a positive finite metric; keeps items without the metric.
 */
export function filterSpatialOutliersByValue<T>(
  items: T[],
  getValue: (item: T) => number | undefined
): T[] {
  const validValues: number[] = [];
  for (let i = 0; i < items.length; i++) {
    const v = getValue(items[i]);
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
      validValues.push(v);
    }
  }
  if (validValues.length < 3) return items;

  validValues.sort((a, b) => a - b);
  const mid = Math.floor(validValues.length / 2);
  const median =
    validValues.length % 2 === 0
      ? (validValues[mid - 1] + validValues[mid]) / 2
      : validValues[mid];

  const deviations = validValues.map((v) => Math.abs(v - median)).sort((a, b) => a - b);
  const mad =
    deviations.length % 2 === 0
      ? (deviations[mid - 1] + deviations[mid]) / 2
      : deviations[mid];

  const effectiveScale = Math.max(mad * 1.4826, 12.0);
  const MAX_DEV_Z = 4.0;

  return items.filter((item) => {
    const v = getValue(item);
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return true;
    return Math.abs(v - median) <= MAX_DEV_Z * effectiveScale;
  });
}

/**
 * Extract concise station display name without Node/DOM dependencies.
 */
export function extractCleanStationName(rawName: string, cityNameZh?: string): string {
  if (!rawName) return '未命名测站';
  const match = rawName.match(/\((.+?)\)/);
  if (match && match[1]) {
    const name = match[1].trim();
    if (cityNameZh && name.startsWith(cityNameZh)) {
      const stripped = name.slice(cityNameZh.length).trim();
      if (stripped.length > 0) return stripped;
    }
    return name;
  }
  return rawName.split(',')[0].trim();
}

/**
 * Encode WAQI feed target while preserving leading '@' for station UID paths (`@1451`).
 */
export function encodeWaqiTarget(target: string): string {
  const trimmed = target.trim();
  if (trimmed.startsWith('@')) {
    return `@${encodeURIComponent(trimmed.slice(1))}`;
  }
  return encodeURIComponent(trimmed);
}

/**
 * Create an Error carrying an HTTP status code for circuit breaker classification.
 */
export function createHttpError(status: number, message: string): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

/**
 * Merge meteorological weather objects without letting explicit `undefined` keys wipe defined fallback values.
 */
export function mergeWeatherInfo(
  fallback: WeatherInfo | undefined,
  primary: WeatherInfo | undefined
): WeatherInfo | undefined {
  if (!fallback && !primary) return undefined;
  const merged: WeatherInfo = {
    temp: primary?.temp ?? fallback?.temp,
    humidity: primary?.humidity ?? fallback?.humidity,
    windSpeed: primary?.windSpeed ?? fallback?.windSpeed,
    pressure: primary?.pressure ?? fallback?.pressure,
  };
  return merged;
}

/**
 * Escape HTML special characters for safe interpolation in Leaflet popups and ECharts tooltips.
 */
export function escapeHtml(str: string): string {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
