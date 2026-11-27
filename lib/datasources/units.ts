import type { PollutantValues } from '../types';

/**
 * Standard atmospheric molar volume at 25°C, 1 atm (24.45 L/mol).
 * Molecular weights (g/mol): NO2=46.0055, O3=48.00, SO2=64.066, CO=28.01.
 * Canonical units in AQI Vibe:
 * - pm25, pm10, o3, no2, so2: μg/m³
 * - co: mg/m³
 */
const GAS_PPB_TO_UGM3: Record<'no2' | 'o3' | 'so2' | 'co', number> = {
  no2: 46.0055 / 24.45, // ~1.8816 μg/m³ per ppb
  o3: 48.0 / 24.45,     // ~1.9632 μg/m³ per ppb
  so2: 64.066 / 24.45,  // ~2.6203 μg/m³ per ppb
  co: 28.01 / 24.45,    // ~1.1456 μg/m³ per ppb (= 0.0011456 mg/m³ per ppb)
};

function roundVal(v: number, decimals: number): number {
  const f = Math.pow(10, decimals);
  return Math.round(v * f) / f;
}

/**
 * Convert an upstream pollutant measurement in arbitrary unit (μg/m³, mg/m³, ppb, ppm,
 * PARTS_PER_BILLION, MICROGRAMS_PER_CUBIC_METER) into AQI Vibe canonical units.
 */
export function normalizePollutantUnit(
  pollutant: keyof PollutantValues,
  value: number | undefined | null,
  rawUnit?: string | null
): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return undefined;
  }

  const u = (rawUnit || '').trim().toLowerCase().replace(/\s+/g, '');

  if (pollutant === 'pm25' || pollutant === 'pm10') {
    // Expect μg/m³
    if (u === 'mg/m3' || u === 'mg/m³') {
      return roundVal(value * 1000, 1);
    }
    return roundVal(value, 1);
  }

  if (pollutant === 'co') {
    // Canonical CO unit is mg/m³
    if (u === 'mg/m3' || u === 'mg/m³' || u === 'milligrams_per_cubic_meter') {
      return roundVal(value, 2);
    }
    if (u === 'ug/m3' || u === 'µg/m³' || u === 'μg/m³' || u === 'micrograms_per_cubic_meter') {
      return roundVal(value / 1000, 2);
    }
    if (u === 'ppm' || u === 'parts_per_million') {
      return roundVal(value * GAS_PPB_TO_UGM3.co, 2);
    }
    if (u === 'ppb' || u === 'parts_per_billion') {
      return roundVal((value * GAS_PPB_TO_UGM3.co) / 1000, 2);
    }
    // Heuristic-free default if unit omitted: assume mg/m³ when <= 50, else μg/m³
    return value > 50 ? roundVal(value / 1000, 2) : roundVal(value, 2);
  }

  // Gaseous pollutants: o3, no2, so2 -> canonical unit is μg/m³
  const factor = GAS_PPB_TO_UGM3[pollutant];
  if (u === 'ppb' || u === 'parts_per_billion') {
    return roundVal(value * factor, 1);
  }
  if (u === 'ppm' || u === 'parts_per_million') {
    return roundVal(value * 1000 * factor, 1);
  }
  if (u === 'mg/m3' || u === 'mg/m³') {
    return roundVal(value * 1000, 1);
  }
  return roundVal(value, 1);
}

/**
 * Create a cross-runtime timeout AbortSignal compatible with Cloudflare Workers, Node 20+, and browsers.
 */
export function createTimeoutSignal(ms: number, parent?: AbortSignal): AbortSignal | undefined {
  if (parent?.aborted) return parent;
  if (typeof AbortController !== 'undefined') {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    const onParentAbort = () => {
      clearTimeout(timer);
      controller.abort();
    };
    if (parent) {
      parent.addEventListener('abort', onParentAbort, { once: true });
    }
    controller.signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        if (parent) parent.removeEventListener('abort', onParentAbort);
      },
      { once: true }
    );
    return controller.signal;
  }
  return undefined;
}
