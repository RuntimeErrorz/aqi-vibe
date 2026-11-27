import { iso1A2Code } from '@rapideditor/country-coder';
import { CITIES_REGISTRY } from '../constants/cities';
import type { CityMeta } from '../types';
import type { WaqiBoundStation } from './waqi';
import { isSameSovereignCountry } from '../datasources/freshness';
import { getDistanceKm } from '../utils/common';

export { getDistanceKm };

/**
 * 严格过滤属于特定城市的在册测站：
 * 杜绝地理边界矩形检索因经纬度重叠将临近城市测站误算入当前城市（例如德阳误算入成都/绵阳、佛山误算入广州/江门等）
 */
export function filterStationsForCity(
  stations: WaqiBoundStation[],
  targetCity: CityMeta,
  allCities: CityMeta[] = CITIES_REGISTRY
): WaqiBoundStation[] {
  if (!stations || stations.length === 0) return [];

  // 目标城市周围 160 公里内的在册城市作为 Voronoi 空间排他仲裁参考
  const neighborCities = allCities.filter((c) => {
    if (c.id === targetCity.id) return false;
    const dist = getDistanceKm(c.latitude, c.longitude, targetCity.latitude, targetCity.longitude);
    return dist <= 160;
  });

  return stations.filter((s) => {
    // 0. 纯经纬度主权国家排他：若测站经纬度所属国家与目标城市不符，直接排除（兼容港澳 HK/MO 与 CN 归属）
    const stCountry = iso1A2Code([s.lon, s.lat]);
    if (!isSameSovereignCountry(stCountry, targetCity.country)) {
      return false;
    }

    // 1. 严格物理几何距离门槛：测站必须在城市中心城区 35km 物理范围内
    const distToTarget = getDistanceKm(s.lat, s.lon, targetCity.latitude, targetCity.longitude);
    if (distToTarget > 35) return false;

    // 2. 纯客观物理几何 Voronoi 空间排他仲裁 (0 字符串正则与名称猜测)：
    // 若有其他邻近城市距离该测站更近，则该测站归属邻城
    for (const neighbor of neighborCities) {
      const distToNeighbor = getDistanceKm(s.lat, s.lon, neighbor.latitude, neighbor.longitude);
      if (distToNeighbor < distToTarget) {
        return false;
      }
    }

    return true;
  });
}
