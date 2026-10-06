import { StationMeta } from '../types';

export const POPULAR_STATIONS: StationMeta[] = [
  // --- 北京国控微站 ---
  { code: '1001A', name: '万寿西宫', city: '北京', latitude: 39.8673, longitude: 116.3660, isCleanStation: false },
  { code: '1002A', name: '定陵 (清洁对照点)', city: '北京', latitude: 40.2865, longitude: 116.1700, isCleanStation: true },
  { code: '1003A', name: '东四', city: '北京', latitude: 39.9522, longitude: 116.4340, isCleanStation: false },
  { code: '1004A', name: '天坛', city: '北京', latitude: 39.8745, longitude: 116.4340, isCleanStation: false },
  { code: '1005A', name: '农展馆', city: '北京', latitude: 39.9546, longitude: 116.4681, isCleanStation: false },
  { code: '1006A', name: '官园', city: '北京', latitude: 39.9425, longitude: 116.3610, isCleanStation: false },
  { code: '1007A', name: '海淀万柳', city: '北京', latitude: 39.9930, longitude: 116.3150, isCleanStation: false },
  { code: '1008A', name: '顺义新城', city: '北京', latitude: 40.1438, longitude: 116.7200, isCleanStation: false },
  { code: '1009A', name: '昌平镇', city: '北京', latitude: 40.2200, longitude: 116.2300, isCleanStation: false },
  { code: '1010A', name: '门头沟龙泉', city: '北京', latitude: 39.9370, longitude: 116.1060, isCleanStation: false },
  { code: '1011A', name: '房山良乡', city: '北京', latitude: 39.7420, longitude: 116.1360, isCleanStation: false },
  { code: '1012A', name: '大兴黄村', city: '北京', latitude: 39.7180, longitude: 116.3420, isCleanStation: false },

  // --- 上海国控微站 ---
  { code: '1141A', name: '普陀监测站', city: '上海', latitude: 31.2530, longitude: 121.4010, isCleanStation: false },
  { code: '1142A', name: '静安监测站', city: '上海', latitude: 31.2280, longitude: 121.4390, isCleanStation: false },
  { code: '1143A', name: '徐汇上师大', city: '上海', latitude: 31.1680, longitude: 121.4170, isCleanStation: false },
  { code: '1144A', name: '杨浦四漂', city: '上海', latitude: 31.2720, longitude: 121.5450, isCleanStation: false },
  { code: '1145A', name: '青浦淀山湖 (对照点)', city: '上海', latitude: 31.0930, longitude: 120.9850, isCleanStation: true },
  { code: '1146A', name: '浦东张江', city: '上海', latitude: 31.2050, longitude: 121.6030, isCleanStation: false },

  // --- 广州国控微站 ---
  { code: '1345A', name: '广雅中学', city: '广州', latitude: 23.1410, longitude: 113.2420, isCleanStation: false },
  { code: '1346A', name: '市监测站', city: '广州', latitude: 23.1250, longitude: 113.2620, isCleanStation: false },
  { code: '1347A', name: '天河公园', city: '广州', latitude: 23.1260, longitude: 113.3680, isCleanStation: false },
  { code: '1348A', name: '麓湖', city: '广州', latitude: 23.1550, longitude: 113.2790, isCleanStation: false },
  { code: '1349A', name: '从化温泉 (对照点)', city: '广州', latitude: 23.6360, longitude: 113.6330, isCleanStation: true },

  // --- 深圳国控微站 ---
  { code: '1361A', name: '洪湖公园', city: '深圳', latitude: 22.5640, longitude: 114.1220, isCleanStation: false },
  { code: '1362A', name: '荔园小学', city: '深圳', latitude: 22.5510, longitude: 114.0950, isCleanStation: false },
  { code: '1363A', name: '华侨城', city: '深圳', latitude: 22.5350, longitude: 113.9850, isCleanStation: false },
  { code: '1364A', name: '南西', city: '深圳', latitude: 22.5180, longitude: 113.9280, isCleanStation: false },

  // --- 成都与其它核心微站 ---
  { code: '2011A', name: '金泉两河', city: '成都', latitude: 30.7100, longitude: 103.9820, isCleanStation: false },
  { code: '2012A', name: '十里店', city: '成都', latitude: 30.6820, longitude: 104.1450, isCleanStation: false },
  { code: '2013A', name: '三瓦窑', city: '成都', latitude: 30.6060, longitude: 104.0840, isCleanStation: false },
  { code: '2014A', name: '沙河铺', city: '成都', latitude: 30.6270, longitude: 104.1160, isCleanStation: false },
  { code: '2015A', name: '灵岩寺 (对照点)', city: '成都', latitude: 31.0060, longitude: 103.6080, isCleanStation: true },
];

export function getStationsByCity(cityName: string): StationMeta[] {
  const match = cityName.replace(/市$/, '');
  return POPULAR_STATIONS.filter(s => s.city.includes(match));
}
