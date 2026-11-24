import { describe, it, expect } from 'vitest';
import { filterStationsForCity, getDistanceKm } from '@/lib/services/geo-filter';
import type { WaqiBoundStation } from '@/lib/services/waqi';
import { findCity } from '@/lib/constants/cities';

const makeStation = (uid: number, lat: number, lon: number, aqi = '45'): WaqiBoundStation => ({
  uid,
  lat,
  lon,
  aqi,
  station: { name: `Station ${uid}`, time: '2026-11-22 12:00:00' },
});

describe('Geometric Voronoi & Sovereign Exclusion Station Filter', () => {
  it('computes accurate great-circle distance', () => {
    const dist = getDistanceKm(39.9042, 116.4074, 31.2304, 121.4737); // Beijing - Shanghai ~1068 km
    expect(dist).toBeGreaterThan(1050);
    expect(dist).toBeLessThan(1090);
  });

  it('rejects stations beyond the 35km hard boundary', () => {
    const chengdu = findCity('cn-chengdu')!;
    const nearStation = makeStation(1, chengdu.latitude + 0.05, chengdu.longitude + 0.05); // ~7 km
    const farStation = makeStation(2, chengdu.latitude + 0.5, chengdu.longitude + 0.5); // ~73 km

    const filtered = filterStationsForCity([nearStation, farStation], chengdu);
    expect(filtered.map((s) => s.uid)).toEqual([1]);
  });

  it('enforces sovereign country exclusion across Singapore / Johor Bahru border', () => {
    const singapore = findCity('gl-singapore')!;
    const sgStation = makeStation(10, 1.3521, 103.8198); // Central Singapore
    const myStation = makeStation(11, 1.4927, 103.7414); // Johor Bahru, Malaysia (~17km away, within 35km!)

    const filtered = filterStationsForCity([sgStation, myStation], singapore);
    expect(filtered.map((s) => s.uid)).toEqual([10]);
  });
});
