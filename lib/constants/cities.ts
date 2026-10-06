import { CityMeta } from '../types';

export const CITIES_REGISTRY: CityMeta[] = [
  // --- 中国重点城市 ---
  { id: 'cn-chengdu', nameZh: '成都', nameEn: 'Chengdu', country: 'CN', province: '四川省', latitude: 30.5728, longitude: 104.0668, isDomestic: true, waqiSlug: 'chengdu' },
  { id: 'cn-beijing', nameZh: '北京', nameEn: 'Beijing', country: 'CN', province: '北京市', latitude: 39.9042, longitude: 116.4074, isDomestic: true, waqiSlug: 'beijing' },
  { id: 'cn-shanghai', nameZh: '上海', nameEn: 'Shanghai', country: 'CN', province: '上海市', latitude: 31.2304, longitude: 121.4737, isDomestic: true, waqiSlug: 'shanghai' },
  { id: 'cn-guangzhou', nameZh: '广州', nameEn: 'Guangzhou', country: 'CN', province: '广东省', latitude: 23.1291, longitude: 113.2644, isDomestic: true, waqiSlug: 'guangzhou' },
  { id: 'cn-shenzhen', nameZh: '深圳', nameEn: 'Shenzhen', country: 'CN', province: '广东省', latitude: 22.5431, longitude: 114.0579, isDomestic: true, waqiSlug: 'shenzhen' },
  { id: 'cn-hangzhou', nameZh: '杭州', nameEn: 'Hangzhou', country: 'CN', province: '浙江省', latitude: 30.2741, longitude: 120.1551, isDomestic: true, waqiSlug: 'hangzhou' },
  { id: 'cn-wuhan', nameZh: '武汉', nameEn: 'Wuhan', country: 'CN', province: '湖北省', latitude: 30.5928, longitude: 114.3055, isDomestic: true, waqiSlug: 'wuhan' },
  { id: 'cn-xian', nameZh: '西安', nameEn: 'Xi\'an', country: 'CN', province: '陕西省', latitude: 34.3416, longitude: 108.9398, isDomestic: true, waqiSlug: 'xian' },
  { id: 'cn-chongqing', nameZh: '重庆', nameEn: 'Chongqing', country: 'CN', province: '重庆市', latitude: 29.5630, longitude: 106.5516, isDomestic: true, waqiSlug: 'chongqing' },
  { id: 'cn-tianjin', nameZh: '天津', nameEn: 'Tianjin', country: 'CN', province: '天津市', latitude: 39.0842, longitude: 117.2009, isDomestic: true, waqiSlug: 'tianjin' },
  { id: 'cn-nanjing', nameZh: '南京', nameEn: 'Nanjing', country: 'CN', province: '江苏省', latitude: 32.0603, longitude: 118.7969, isDomestic: true, waqiSlug: 'nanjing' },
  { id: 'cn-suzhou', nameZh: '苏州', nameEn: 'Suzhou', country: 'CN', province: '江苏省', latitude: 31.2989, longitude: 120.5853, isDomestic: true, waqiSlug: 'suzhou' },
  { id: 'cn-changsha', nameZh: '长沙', nameEn: 'Changsha', country: 'CN', province: '湖南省', latitude: 28.2282, longitude: 112.9388, isDomestic: true, waqiSlug: 'changsha' },
  { id: 'cn-zhengzhou', nameZh: '郑州', nameEn: 'Zhengzhou', country: 'CN', province: '河南省', latitude: 34.7466, longitude: 113.6253, isDomestic: true, waqiSlug: 'zhengzhou' },
  { id: 'cn-jinan', nameZh: '济南', nameEn: 'Jinan', country: 'CN', province: '山东省', latitude: 36.6512, longitude: 117.1201, isDomestic: true, waqiSlug: 'jinan' },
  { id: 'cn-qingdao', nameZh: '青岛', nameEn: 'Qingdao', country: 'CN', province: '山东省', latitude: 36.0671, longitude: 120.3826, isDomestic: true, waqiSlug: 'qingdao' },
  { id: 'cn-shenyang', nameZh: '沈阳', nameEn: 'Shenyang', country: 'CN', province: '辽宁省', latitude: 41.8057, longitude: 123.4315, isDomestic: true, waqiSlug: 'shenyang' },
  { id: 'cn-dalian', nameZh: '大连', nameEn: 'Dalian', country: 'CN', province: '辽宁省', latitude: 38.9140, longitude: 121.6147, isDomestic: true, waqiSlug: 'dalian' },
  { id: 'cn-harbin', nameZh: '哈尔滨', nameEn: 'Harbin', country: 'CN', province: '黑龙江省', latitude: 45.8038, longitude: 126.5349, isDomestic: true, waqiSlug: 'harbin' },
  { id: 'cn-kunming', nameZh: '昆明', nameEn: 'Kunming', country: 'CN', province: '云南省', latitude: 24.8797, longitude: 102.8332, isDomestic: true, waqiSlug: 'kunming' },
  { id: 'cn-fuzhou', nameZh: '福州', nameEn: 'Fuzhou', country: 'CN', province: '福建省', latitude: 26.0745, longitude: 119.2965, isDomestic: true, waqiSlug: 'fuzhou' },
  { id: 'cn-xiamen', nameZh: '厦门', nameEn: 'Xiamen', country: 'CN', province: '福建省', latitude: 24.4798, longitude: 118.0894, isDomestic: true, waqiSlug: 'xiamen' },
  { id: 'cn-shijiazhuang', nameZh: '石家庄', nameEn: 'Shijiazhuang', country: 'CN', province: '河北省', latitude: 38.0428, longitude: 114.5149, isDomestic: true, waqiSlug: 'shijiazhuang' },
  { id: 'cn-taiyuan', nameZh: '太原', nameEn: 'Taiyuan', country: 'CN', province: '山西省', latitude: 37.8706, longitude: 112.5489, isDomestic: true, waqiSlug: 'taiyuan' },
  { id: 'cn-hefei', nameZh: '合肥', nameEn: 'Hefei', country: 'CN', province: '安徽省', latitude: 31.8206, longitude: 117.2272, isDomestic: true, waqiSlug: 'hefei' },
  { id: 'cn-nanchang', nameZh: '南昌', nameEn: 'Nanchang', country: 'CN', province: '江西省', latitude: 28.6829, longitude: 115.8582, isDomestic: true, waqiSlug: 'nanchang' },
  { id: 'cn-nanning', nameZh: '南宁', nameEn: 'Nanning', country: 'CN', province: '广西壮族自治区', latitude: 22.8170, longitude: 108.3665, isDomestic: true, waqiSlug: 'nanning' },
  { id: 'cn-haikou', nameZh: '海口', nameEn: 'Haikou', country: 'CN', province: '海南省', latitude: 20.0440, longitude: 110.1999, isDomestic: true, waqiSlug: 'haikou' },
  { id: 'cn-sanya', nameZh: '三亚', nameEn: 'Sanya', country: 'CN', province: '海南省', latitude: 18.2528, longitude: 109.5120, isDomestic: true, waqiSlug: 'sanya' },
  { id: 'cn-guiyang', nameZh: '贵阳', nameEn: 'Guiyang', country: 'CN', province: '贵州省', latitude: 26.6477, longitude: 106.6302, isDomestic: true, waqiSlug: 'guiyang' },
  { id: 'cn-lanzhou', nameZh: '兰州', nameEn: 'Lanzhou', country: 'CN', province: '甘肃省', latitude: 36.0611, longitude: 103.8343, isDomestic: true, waqiSlug: 'lanzhou' },
  { id: 'cn-xining', nameZh: '西宁', nameEn: 'Xining', country: 'CN', province: '青海省', latitude: 36.6171, longitude: 101.7782, isDomestic: true, waqiSlug: 'xining' },
  { id: 'cn-yinchuan', nameZh: '银川', nameEn: 'Yinchuan', country: 'CN', province: '宁夏回族自治区', latitude: 38.4872, longitude: 106.2309, isDomestic: true, waqiSlug: 'yinchuan' },
  { id: 'cn-urumqi', nameZh: '乌鲁木齐', nameEn: 'Urumqi', country: 'CN', province: '新疆维吾尔自治区', latitude: 43.8256, longitude: 87.6168, isDomestic: true, waqiSlug: 'urumqi' },
  { id: 'cn-lhasa', nameZh: '拉萨', nameEn: 'Lhasa', country: 'CN', province: '西藏自治区', latitude: 29.6525, longitude: 91.1721, isDomestic: true, waqiSlug: 'lhasa' },
  { id: 'cn-hohhot', nameZh: '呼和浩特', nameEn: 'Hohhot', country: 'CN', province: '内蒙古自治区', latitude: 40.8424, longitude: 111.7492, isDomestic: true, waqiSlug: 'hohhot' },
  { id: 'cn-hongkong', nameZh: '香港', nameEn: 'Hong Kong', country: 'CN', province: '香港特别行政区', latitude: 22.3193, longitude: 114.1694, isDomestic: true, waqiSlug: 'hongkong' },
  { id: 'cn-macau', nameZh: '澳门', nameEn: 'Macau', country: 'CN', province: '澳门特别行政区', latitude: 22.1987, longitude: 113.5439, isDomestic: true, waqiSlug: 'macau' },
  { id: 'cn-taipei', nameZh: '台北', nameEn: 'Taipei', country: 'CN', province: '台湾省', latitude: 25.0330, longitude: 121.5654, isDomestic: true, waqiSlug: 'taipei' },

  // --- 全球核心名城 ---
  { id: 'gl-tokyo', nameZh: '东京', nameEn: 'Tokyo', country: 'JP', latitude: 35.6762, longitude: 139.6503, isDomestic: false, waqiSlug: 'tokyo' },
  { id: 'gl-osaka', nameZh: '大阪', nameEn: 'Osaka', country: 'JP', latitude: 34.6937, longitude: 135.5023, isDomestic: false, waqiSlug: 'osaka' },
  { id: 'gl-kyoto', nameZh: '京都', nameEn: 'Kyoto', country: 'JP', latitude: 35.0116, longitude: 135.7681, isDomestic: false, waqiSlug: 'kyoto' },
  { id: 'gl-newyork', nameZh: '纽约', nameEn: 'New York', country: 'US', latitude: 40.7128, longitude: -74.0060, isDomestic: false, waqiSlug: 'newyork' },
  { id: 'gl-losangeles', nameZh: '洛杉矶', nameEn: 'Los Angeles', country: 'US', latitude: 34.0522, longitude: -118.2437, isDomestic: false, waqiSlug: 'los-angeles' },
  { id: 'gl-sanfrancisco', nameZh: '旧金山', nameEn: 'San Francisco', country: 'US', latitude: 37.7749, longitude: -122.4194, isDomestic: false, waqiSlug: 'san-francisco' },
  { id: 'gl-chicago', nameZh: '芝加哥', nameEn: 'Chicago', country: 'US', latitude: 41.8781, longitude: -87.6298, isDomestic: false, waqiSlug: 'chicago' },
  { id: 'gl-seattle', nameZh: '西雅图', nameEn: 'Seattle', country: 'US', latitude: 47.6062, longitude: -122.3321, isDomestic: false, waqiSlug: 'seattle' },
  { id: 'gl-london', nameZh: '伦敦', nameEn: 'London', country: 'GB', latitude: 51.5074, longitude: -0.1278, isDomestic: false, waqiSlug: 'london' },
  { id: 'gl-paris', nameZh: '巴黎', nameEn: 'Paris', country: 'FR', latitude: 48.8566, longitude: 2.3522, isDomestic: false, waqiSlug: 'paris' },
  { id: 'gl-berlin', nameZh: '柏林', nameEn: 'Berlin', country: 'DE', latitude: 52.5200, longitude: 13.4050, isDomestic: false, waqiSlug: 'berlin' },
  { id: 'gl-madrid', nameZh: '马德里', nameEn: 'Madrid', country: 'ES', latitude: 40.4168, longitude: -3.7038, isDomestic: false, waqiSlug: 'madrid' },
  { id: 'gl-rome', nameZh: '罗马', nameEn: 'Rome', country: 'IT', latitude: 41.9028, longitude: 12.4964, isDomestic: false, waqiSlug: 'rome' },
  { id: 'gl-amsterdam', nameZh: '阿姆斯特丹', nameEn: 'Amsterdam', country: 'NL', latitude: 52.3676, longitude: 4.9041, isDomestic: false, waqiSlug: 'amsterdam' },
  { id: 'gl-zurich', nameZh: '苏黎世', nameEn: 'Zurich', country: 'CH', latitude: 47.3769, longitude: 8.5417, isDomestic: false, waqiSlug: 'zurich' },
  { id: 'gl-vienna', nameZh: '维也纳', nameEn: 'Vienna', country: 'AT', latitude: 48.2082, longitude: 16.3738, isDomestic: false, waqiSlug: 'vienna' },
  { id: 'gl-stockholm', nameZh: '斯德哥尔摩', nameEn: 'Stockholm', country: 'SE', latitude: 59.3293, longitude: 18.0686, isDomestic: false, waqiSlug: 'stockholm' },
  { id: 'gl-oslo', nameZh: '奥斯陆', nameEn: 'Oslo', country: 'NO', latitude: 59.9139, longitude: 10.7522, isDomestic: false, waqiSlug: 'oslo' },
  { id: 'gl-copenhagen', nameZh: '哥本哈根', nameEn: 'Copenhagen', country: 'DK', latitude: 55.6761, longitude: 12.5683, isDomestic: false, waqiSlug: 'copenhagen' },
  { id: 'gl-seoul', nameZh: '首尔', nameEn: 'Seoul', country: 'KR', latitude: 37.5665, longitude: 126.9780, isDomestic: false, waqiSlug: 'seoul' },
  { id: 'gl-singapore', nameZh: '新加坡', nameEn: 'Singapore', country: 'SG', latitude: 1.3521, longitude: 103.8198, isDomestic: false, waqiSlug: 'singapore' },
  { id: 'gl-sydney', nameZh: '悉尼', nameEn: 'Sydney', country: 'AU', latitude: -33.8688, longitude: 151.2093, isDomestic: false, waqiSlug: 'sydney' },
  { id: 'gl-melbourne', nameZh: '墨尔本', nameEn: 'Melbourne', country: 'AU', latitude: -37.8136, longitude: 144.9631, isDomestic: false, waqiSlug: 'melbourne' },
  { id: 'gl-auckland', nameZh: '奥克兰', nameEn: 'Auckland', country: 'NZ', latitude: -36.8485, longitude: 174.7633, isDomestic: false, waqiSlug: 'auckland' },
  { id: 'gl-delhi', nameZh: '新德里', nameEn: 'New Delhi', country: 'IN', latitude: 28.6139, longitude: 77.2090, isDomestic: false, waqiSlug: 'delhi' },
  { id: 'gl-mumbai', nameZh: '孟买', nameEn: 'Mumbai', country: 'IN', latitude: 19.0760, longitude: 72.8777, isDomestic: false, waqiSlug: 'mumbai' },
  { id: 'gl-bangkok', nameZh: '曼谷', nameEn: 'Bangkok', country: 'TH', latitude: 13.7563, longitude: 100.5018, isDomestic: false, waqiSlug: 'bangkok' },
  { id: 'gl-dubai', nameZh: '迪拜', nameEn: 'Dubai', country: 'AE', latitude: 25.2048, longitude: 55.2708, isDomestic: false, waqiSlug: 'dubai' },
  { id: 'gl-toronto', nameZh: '多伦多', nameEn: 'Toronto', country: 'CA', latitude: 43.6532, longitude: -79.3832, isDomestic: false, waqiSlug: 'toronto' },
  { id: 'gl-vancouver', nameZh: '温哥华', nameEn: 'Vancouver', country: 'CA', latitude: 49.2827, longitude: -123.1207, isDomestic: false, waqiSlug: 'vancouver' },
  { id: 'gl-moscow', nameZh: '莫斯科', nameEn: 'Moscow', country: 'RU', latitude: 55.7558, longitude: 37.6173, isDomestic: false, waqiSlug: 'moscow' },
  { id: 'gl-cairo', nameZh: '开罗', nameEn: 'Cairo', country: 'EG', latitude: 30.0444, longitude: 31.2357, isDomestic: false, waqiSlug: 'cairo' },
  { id: 'gl-mexicocity', nameZh: '墨西哥城', nameEn: 'Mexico City', country: 'MX', latitude: 19.4326, longitude: -99.1332, isDomestic: false, waqiSlug: 'mexico-city' },
  { id: 'gl-saopaulo', nameZh: '圣保罗', nameEn: 'Sao Paulo', country: 'BR', latitude: -23.5505, longitude: -46.6333, isDomestic: false, waqiSlug: 'sao-paulo' },
  { id: 'gl-buenosaires', nameZh: '布宜诺斯艾利斯', nameEn: 'Buenos Aires', country: 'AR', latitude: -34.6037, longitude: -58.3816, isDomestic: false, waqiSlug: 'buenos-aires' },
  { id: 'gl-istanbul', nameZh: '伊斯坦布尔', nameEn: 'Istanbul', country: 'TR', latitude: 41.0082, longitude: 28.9784, isDomestic: false, waqiSlug: 'istanbul' },
  { id: 'gl-capetown', nameZh: '开普敦', nameEn: 'Cape Town', country: 'ZA', latitude: -33.9249, longitude: 18.4241, isDomestic: false, waqiSlug: 'cape-town' },
];

export function createCustomCity(cityName: string): CityMeta {
  const trimmed = cityName.trim();
  const isChinese = /[\u4e00-\u9fa5]/.test(trimmed);
  const cleanSlug = trimmed.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '-');
  return {
    id: `custom-${cleanSlug}`,
    nameZh: trimmed,
    nameEn: trimmed,
    country: isChinese ? 'CN' : 'GLOBAL',
    latitude: 35.0,
    longitude: 105.0,
    isDomestic: isChinese,
    waqiSlug: cleanSlug,
  };
}

export function findCity(query: string): CityMeta | undefined {
  if (!query) return undefined;
  const q = query.trim().toLowerCase();
  
  // 1. 精确匹配
  const exact = CITIES_REGISTRY.find(c => 
    c.id.toLowerCase() === q ||
    c.nameZh.toLowerCase() === q ||
    c.nameEn.toLowerCase() === q ||
    c.waqiSlug?.toLowerCase() === q
  );
  if (exact) return exact;

  // 2. 包含匹配 (如搜 "巴黎" 或 "paris" 或 "京")
  const partial = CITIES_REGISTRY.find(c => 
    c.nameZh.toLowerCase().includes(q) ||
    c.nameEn.toLowerCase().includes(q) ||
    c.id.toLowerCase().includes(q)
  );
  if (partial) return partial;

  // 3. 动态生成任意输入城市
  return createCustomCity(query);
}

export function searchCities(query: string, limit = 8): CityMeta[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return CITIES_REGISTRY.slice(0, limit);
  }

  const results: CityMeta[] = [];
  for (const c of CITIES_REGISTRY) {
    if (
      c.nameZh.toLowerCase().includes(q) ||
      c.nameEn.toLowerCase().includes(q) ||
      c.id.toLowerCase().includes(q) ||
      c.province?.toLowerCase().includes(q) ||
      c.country.toLowerCase().includes(q)
    ) {
      results.push(c);
      if (results.length >= limit) break;
    }
  }

  // 如果没有完全精确匹配的结果，把用户的输入作为一个可创建项置顶推荐
  const hasExact = results.some(r => r.nameZh.toLowerCase() === q || r.nameEn.toLowerCase() === q);
  if (!hasExact && q.length > 0) {
    results.unshift(createCustomCity(query.trim()));
  }

  return results;
}
