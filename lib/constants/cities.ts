import { CityMeta } from '../types';

export const CITIES_REGISTRY: CityMeta[] = [
  // --- 中国重点城市 ---
  { id: 'cn-beijing', nameZh: '北京', nameEn: 'Beijing', country: 'CN', province: '北京市', latitude: 39.9042, longitude: 116.4074, isDomestic: true, waqiSlug: 'beijing' },
  { id: 'cn-shanghai', nameZh: '上海', nameEn: 'Shanghai', country: 'CN', province: '上海市', latitude: 31.2304, longitude: 121.4737, isDomestic: true, waqiSlug: 'shanghai' },
  { id: 'cn-guangzhou', nameZh: '广州', nameEn: 'Guangzhou', country: 'CN', province: '广东省', latitude: 23.1291, longitude: 113.2644, isDomestic: true, waqiSlug: 'guangzhou' },
  { id: 'cn-shenzhen', nameZh: '深圳', nameEn: 'Shenzhen', country: 'CN', province: '广东省', latitude: 22.5431, longitude: 114.0579, isDomestic: true, waqiSlug: 'shenzhen' },
  { id: 'cn-chengdu', nameZh: '成都', nameEn: 'Chengdu', country: 'CN', province: '四川省', latitude: 30.5728, longitude: 104.0668, isDomestic: true, waqiSlug: 'chengdu' },
  { id: 'cn-hangzhou', nameZh: '杭州', nameEn: 'Hangzhou', country: 'CN', province: '浙江省', latitude: 30.2741, longitude: 120.1551, isDomestic: true, waqiSlug: 'hangzhou' },
  { id: 'cn-wuhan', nameZh: '武汉', nameEn: 'Wuhan', country: 'CN', province: '湖北省', latitude: 30.5928, longitude: 114.3055, isDomestic: true, waqiSlug: 'wuhan' },
  { id: 'cn-xian', nameZh: '西安', nameEn: 'Xi\'an', country: 'CN', province: '陕西省', latitude: 34.3416, longitude: 108.9398, isDomestic: true, waqiSlug: 'xian' },
  { id: 'cn-chongqing', nameZh: '重庆', nameEn: 'Chongqing', country: 'CN', province: '重庆市', latitude: 29.5630, longitude: 106.5516, isDomestic: true, waqiSlug: 'chongqing' },
  { id: 'cn-tianjin', nameZh: '天津', nameEn: 'Tianjin', country: 'CN', province: '天津市', latitude: 39.0842, longitude: 117.2009, isDomestic: true, waqiSlug: 'tianjin' },
  { id: 'cn-nanjing', nameZh: '南京', nameEn: 'Nanjing', country: 'CN', province: '江苏省', latitude: 32.0603, longitude: 118.7969, isDomestic: true, waqiSlug: 'nanjing' },
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
  { id: 'cn-guiyang', nameZh: '贵阳', nameEn: 'Guiyang', country: 'CN', province: '贵州省', latitude: 26.6477, longitude: 106.6302, isDomestic: true, waqiSlug: 'guiyang' },
  { id: 'cn-lanzhou', nameZh: '兰州', nameEn: 'Lanzhou', country: 'CN', province: '甘肃省', latitude: 36.0611, longitude: 103.8343, isDomestic: true, waqiSlug: 'lanzhou' },
  { id: 'cn-xining', nameZh: '西宁', nameEn: 'Xining', country: 'CN', province: '青海省', latitude: 36.6171, longitude: 101.7782, isDomestic: true, waqiSlug: 'xining' },
  { id: 'cn-yinchuan', nameZh: '银川', nameEn: 'Yinchuan', country: 'CN', province: '宁夏回族自治区', latitude: 38.4872, longitude: 106.2309, isDomestic: true, waqiSlug: 'yinchuan' },
  { id: 'cn-urumqi', nameZh: '乌鲁木齐', nameEn: 'Urumqi', country: 'CN', province: '新疆维吾尔自治区', latitude: 43.8256, longitude: 87.6168, isDomestic: true, waqiSlug: 'urumqi' },
  { id: 'cn-lhasa', nameZh: '拉萨', nameEn: 'Lhasa', country: 'CN', province: '西藏自治区', latitude: 29.6525, longitude: 91.1721, isDomestic: true, waqiSlug: 'lhasa' },
  { id: 'cn-hohhot', nameZh: '呼和浩特', nameEn: 'Hohhot', country: 'CN', province: '内蒙古自治区', latitude: 40.8424, longitude: 111.7492, isDomestic: true, waqiSlug: 'hohhot' },

  // --- 全球重点名城 ---
  { id: 'gl-tokyo', nameZh: '东京', nameEn: 'Tokyo', country: 'JP', latitude: 35.6762, longitude: 139.6503, isDomestic: false, waqiSlug: 'tokyo' },
  { id: 'gl-newyork', nameZh: '纽约', nameEn: 'New York', country: 'US', latitude: 40.7128, longitude: -74.0060, isDomestic: false, waqiSlug: 'newyork' },
  { id: 'gl-london', nameZh: '伦敦', nameEn: 'London', country: 'GB', latitude: 51.5074, longitude: -0.1278, isDomestic: false, waqiSlug: 'london' },
  { id: 'gl-paris', nameZh: '巴黎', nameEn: 'Paris', country: 'FR', latitude: 48.8566, longitude: 2.3522, isDomestic: false, waqiSlug: 'paris' },
  { id: 'gl-seoul', nameZh: '首尔', nameEn: 'Seoul', country: 'KR', latitude: 37.5665, longitude: 126.9780, isDomestic: false, waqiSlug: 'seoul' },
  { id: 'gl-singapore', nameZh: '新加坡', nameEn: 'Singapore', country: 'SG', latitude: 1.3521, longitude: 103.8198, isDomestic: false, waqiSlug: 'singapore' },
  { id: 'gl-sydney', nameZh: '悉尼', nameEn: 'Sydney', country: 'AU', latitude: -33.8688, longitude: 151.2093, isDomestic: false, waqiSlug: 'sydney' },
  { id: 'gl-delhi', nameZh: '新德里', nameEn: 'New Delhi', country: 'IN', latitude: 28.6139, longitude: 77.2090, isDomestic: false, waqiSlug: 'delhi' },
  { id: 'gl-bangkok', nameZh: '曼谷', nameEn: 'Bangkok', country: 'TH', latitude: 13.7563, longitude: 100.5018, isDomestic: false, waqiSlug: 'bangkok' },
  { id: 'gl-berlin', nameZh: '柏林', nameEn: 'Berlin', country: 'DE', latitude: 52.5200, longitude: 13.4050, isDomestic: false, waqiSlug: 'berlin' },
  { id: 'gl-dubai', nameZh: '迪拜', nameEn: 'Dubai', country: 'AE', latitude: 25.2048, longitude: 55.2708, isDomestic: false, waqiSlug: 'dubai' },
  { id: 'gl-sanfrancisco', nameZh: '旧金山', nameEn: 'San Francisco', country: 'US', latitude: 37.7749, longitude: -122.4194, isDomestic: false, waqiSlug: 'san-francisco' },
  { id: 'gl-losangeles', nameZh: '洛杉矶', nameEn: 'Los Angeles', country: 'US', latitude: 34.0522, longitude: -118.2437, isDomestic: false, waqiSlug: 'los-angeles' },
  { id: 'gl-toronto', nameZh: '多伦多', nameEn: 'Toronto', country: 'CA', latitude: 43.6532, longitude: -79.3832, isDomestic: false, waqiSlug: 'toronto' },
  { id: 'gl-rome', nameZh: '罗马', nameEn: 'Rome', country: 'IT', latitude: 41.9028, longitude: 12.4964, isDomestic: false, waqiSlug: 'rome' },
  { id: 'gl-madrid', nameZh: '马德里', nameEn: 'Madrid', country: 'ES', latitude: 40.4168, longitude: -3.7038, isDomestic: false, waqiSlug: 'madrid' },
  { id: 'gl-moscow', nameZh: '莫斯科', nameEn: 'Moscow', country: 'RU', latitude: 55.7558, longitude: 37.6173, isDomestic: false, waqiSlug: 'moscow' },
  { id: 'gl-cairo', nameZh: '开罗', nameEn: 'Cairo', country: 'EG', latitude: 30.0444, longitude: 31.2357, isDomestic: false, waqiSlug: 'cairo' },
  { id: 'gl-mumbai', nameZh: '孟买', nameEn: 'Mumbai', country: 'IN', latitude: 19.0760, longitude: 72.8777, isDomestic: false, waqiSlug: 'mumbai' },
  { id: 'gl-mexicocity', nameZh: '墨西哥城', nameEn: 'Mexico City', country: 'MX', latitude: 19.4326, longitude: -99.1332, isDomestic: false, waqiSlug: 'mexico-city' },
];

export function findCity(query: string): CityMeta | undefined {
  const q = query.trim().toLowerCase();
  return CITIES_REGISTRY.find(c => 
    c.id.toLowerCase() === q ||
    c.nameZh.toLowerCase() === q ||
    c.nameEn.toLowerCase() === q ||
    c.waqiSlug?.toLowerCase() === q
  );
}
