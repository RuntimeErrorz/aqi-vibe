# AQI-Vibe (全球与国内空气质量监测及历史统计平台)

AQI-Vibe 是一个基于现代化 Web 与 Serverless Edge 架构构建的空气质量监测与长周期历史分析平台。它兼备**国内微观高精度（375+ 城市、2,026+ 国控站点）**与**全球宏观广覆盖（100+ 国家、海外核心名城与任意经纬度）**。

平台完全支持部署在 **Cloudflare Pages / Workers** 或 **GitHub Pages** 上，享受 0 维护成本与全球极速 CDN 响应。

---

## 🌟 核心功能特性

1. **实时大盘总览 (`/`)**
   - 城市模糊中英文搜索与 GPS 经纬度自动定位。
   - 核心 AQI 动态表盘、首要污染物、分级健康出行建议。
   - 气象参数矩阵（温度、湿度、风速、气压）。
   - 六大主要污染物（PM2.5、PM10、O₃、NO₂、SO₂、CO）实测浓度与 IAQI 分项进度条。
   - 过去 24 小时逐小时走势面积折线图与未来 5 天平滑预测走势。
   - 本地国控微观站点点位与清洁对照点即时状态。

2. **全景地图大屏 (`/map`)**
   - 基于 Leaflet 与 CartoDB 深色底图。
   - 引入 **WAQI 实时污染热力瓦片图层**（动态全球平滑渐变，无需自建切片服务器）。
   - 全国 2,026 国控监测站点与全球名城打点交互，点击即刻查看微站编码与坐标。

3. **历史时间机器 (`/history`)**
   - **365 天日历热力图（ECharts Calendar Heatmap）**：以色块直观展示全年 365 天优良中差等级。
   - **近 10 年“蓝天保卫战”成果轨迹（2014-2025）**：双轴折线与柱状图展示 PM2.5 持续大幅削减与优良天数比例提升。
   - **季节污染特征透视**：秋冬季采暖逆温与夏秋季光化学臭氧对比。
   - 支持一键导出所选年份的空气质量 CSV 报表。

4. **全球沙盘对比 (`/compare`)**
   - 支持自由勾选 2~5 个国内外城市（如北京 vs 伦敦 vs 东京 vs 新德里）。
   - 同一坐标系下对比近 10 年改善曲线与主要污染物构成雷达图。

5. **双评价标准一键切换**
   - **中国国标 (HJ 633-2012)** 与 **美国标准 (US EPA NowCast)** 自由切换，分级断点动态重算。

---

## 🛠️ 技术栈与架构

- **前端框架**：Next.js 14 (App Router) + TypeScript
- **样式与动效**：Tailwind CSS + Glassmorphism 玻璃拟态设计
- **可视化图表**：Apache ECharts (`echarts-for-react`)
- **全景地图**：Leaflet + WAQI Map Tile Server
- **云端部署**：Cloudflare Pages / Workers (零成本边缘托管)
- **数据源通道**：
  - **WAQI REST API**：全球 11,000+ 站点实时查询与地图切片；
  - **QuotSoft 镜像库**：全国 375 城市与 2026 站点 2014 年至今逐小时历史；
  - **Open-Meteo API**：免 Key 全球任意经纬度气象模型预报兜底。

---

## 🚀 快速启动与本地运行

### 1. 安装依赖
```bash
npm install
```

### 2. 启动本地开发服务
```bash
npm run dev
```
打开浏览器访问 [http://localhost:3000](http://localhost:3000)。

### 3. 构建生产版本
```bash
npm run build
```

---

## ☁️ 部署至 Cloudflare Pages

### 方式 1：通过 GitHub 自动构建（推荐）
1. 将本项目推送到您的 GitHub 仓库。
2. 在 Cloudflare Dashboard 中创建 **Pages** 项目，选择连接您的 GitHub 仓库：
   - **Framework preset**：`Next.js (Static HTML Export)` 或 `None`
   - **Build command**：`npm run build`
   - **Build output directory**：`out`
   - **环境变量**：添加 `NEXT_EXPORT=true` 与 `NEXT_PUBLIC_WAQI_TOKEN`
3. 保存并部署，Cloudflare 将在数十秒内完成全球 CDN 部署。

### 方式 2：使用 Wrangler CLI 命令行部署
```bash
# 1. 导出静态页面
$env:NEXT_EXPORT="true"; npm run build

# 2. 部署到 Cloudflare Pages
npx wrangler pages deploy out --project-name aqi-vibe
```

---

## 📂 项目目录结构

```
├── app/
│   ├── page.tsx            # 实时总览大盘
│   ├── map/page.tsx        # 全景地图大屏
│   ├── history/page.tsx    # 历史深度透视与日历图
│   ├── compare/page.tsx    # 全球多城沙盘对比
│   ├── api/                # Edge 兼容 API 路由 (实时/历史/站点)
│   ├── layout.tsx          # 根布局与全局导航
│   └── globals.css         # 全局样式与玻璃拟态
├── components/
│   ├── Navbar.tsx          # 顶部导航与标准切换开关
│   ├── Footer.tsx          # 底部多源数据合规与归属
│   ├── StandardContext.tsx # 国标/美标 Context 状态管理
│   ├── AirMap.tsx          # Leaflet 瓦片地图与站点打点
│   ├── TrendChart.tsx      # 24小时逐小时折线图
│   ├── CalendarHeatmap.tsx # 365天时间机器日历热力图
│   └── AnnualTrendChart.tsx# 10年年际改善与优良率图表
├── lib/
│   ├── aqi-calculator.ts   # 国标 HJ 633 & 美标 EPA 断点计算核心
│   ├── types.ts            # 全局 TypeScript 接口定义
│   ├── constants/          # 375+ 城市与 2026+ 站点字典
│   └── services/           # WAQI API 与历史数据服务
├── scripts/
│   └── ingest-quotsoft.mjs # QuotSoft 全国数据自动化离线采集脚本
├── schema.sql              # 通用数据库建表 DDL (兼容 D1 / PostgreSQL)
└── wrangler.toml           # Cloudflare Pages / Workers 配置文件
```
