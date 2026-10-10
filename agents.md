# 全球与国内空气质量监测及历史统计平台 (AQI Vibe)
## 系统工程与智能协同架构指南 (`agents.md`)

---

## 1. 项目愿景与核心目标

构建一个同时具备**国内微观高精度（375+城市、2026+国控监测站）**与**全球宏观广覆盖（100+国家、全球核心名城与任意经纬度）**的空气质量实时监控与长期历史数据分析统计平台。

### 核心特性矩阵

| 维度 | 中国国内业务流 | 全球/国际业务流 |
| :--- | :--- | :--- |
| **实时监控** | 375+ 城市实时 AQI、首要污染物、分项浓度（PM2.5、PM10、O3、NO2、SO2、CO） | 重点名城（纽约、东京、伦敦等）实时数据 + 全球污染热力地图切片 |
| **微观站点** | 2,026 个国控监测站点点位打点、区县/街道级监测与聚合 | 全球主流监测站打点 + 任意经纬度格点估算兜底 |
| **历史追溯** | **2014 年 5 月至今**逐小时全量历史沉淀、日/月/年聚合趋势 | **2015 年至今**重点城市历史数据集 + OpenAQ 长期学术归档 |
| **评价标准** | **中国国标 (HJ 633-2012)** 优良中差分级与分指数折算 | **美国环保署 (US EPA)** 标准，支持用户在前台一键无缝双向切换 |
| **特色功能** | 城市/站点日历热力图、秋冬季污染治理年际对比、城市排名榜单 | 全球名城跨国空气改善趋势对比、未来 3~7 天污染预报 |

---

## 2. 多源异构数据获取架构 (Data Architecture)

平台采用 **“冷启动批量离线导入 + 实时增量定时轮询 + 模型格点兜底”** 的三轨制架构：

```
                                  ┌───────────────────────────┐
                                  │      用户前端 / API 消费者  │
                                  └─────────────┬─────────────┘
                                                │
                                  ┌─────────────┴─────────────┐
                                  │   高性能后端查询与缓存层    │
                                  │  (Redis + FastAPI/Next.js) │
                                  └─────────────▲─────────────┘
                                                │
                                  ┌─────────────┴─────────────┐
                                  │   时序数据库 (PostgreSQL + │
                                  │   TimescaleDB 或 ClickHouse│
                                  └──────▲─────────────▲──────┘
                                         │             │
                    ┌────────────────────┴──┐       ┌──┴────────────────────┐
                    │  增量实时数据采集调度   │       │  历史数据离线批处理引擎  │
                    └────────▲──────────────┘       └────────▲──────────────┘
                             │                               │
       ┌─────────────────────┼────────────────────┐          │
       ▼                     ▼                    ▼          ▼
[WAQI Real-time API]  [和风天气 API]       [Open-Meteo API]   [离线历史数据湖]
 - 全球 11,000+ 站点   - 国内城市灾备通道   - 全球任意经纬度   ├─ 国内：QuotSoft 2014-至今
 - Map Tile 瓦片服务   - 极速低延迟         - 气象预报模型     └─ 全球：WAQI 380城 + OpenAQ S3
```

### 2.1 历史数据流（冷启动入库）
1. **国内数据源：QuotSoft (全国城市与国控站逐小时镜像)**
   - **数据获取**：遍历并下载 `https://quotsoft.net/air/data/china_cities_YYYYMMDD.csv`（城市）与 `china_sites_YYYYMMDD.csv`（站点），或解压百度网盘年度大包。
   - **数据指标**：`AQI`, `PM2.5`, `PM10`, `SO2`, `NO2`, `CO`, `O3`, `O3_8h`, `PM2.5_24h` 等 16 项指标。
   - **处理机制**：Python 流式解压清洗，标准化为宽表，通过 PostgreSQL `COPY` 快速批量写入。
2. **全球数据源：WAQI Global Pack + OpenAQ S3**
   - **WAQI Global Pack**：拉取全球 380+ 核心城市 2015 至今的日均/分位数历史数据。
   - **OpenAQ S3**：利用 AWS S3 开放存储桶，针对重点海外监测站拉取 Parquet 文件进行补充。

### 2.2 实时数据流（定时同步）
1. **主调度源：WAQI REST API**
   - **调度频率**：每小时第 15 分钟触发（官方站点通常在整点后 10-15 分钟完成数据发布）。
   - **城市/站点池**：维护一份活跃监控清单（国内重点 100 城 + 海外名城 100 城），逐个调用 `/feed/:city/` 接口；
   - **配额利用**：WAQI 官方名义配额为 **1,000 次/分钟** (折合约 16.6 QPS，突发 Burst 桶容量 60 次)；工程实测证实：持续稳态速率超过 16.6 QPS 时会被 Nginx 网关（rxstreamer-waqi）严格以 429 拦截。系统采用 **16 并发 Worker 管道 + 14.0 QPS 全局时钟速率限制器**，既跑满官方物理吞吐极限，又确保 0 次 429 截断，并结合 8 分钟 SWR 内存快照实现客户端毫秒级响应。
2. **地图服务：WAQI Tile Server**
   - 前端地图直接引入切片瓦片服务 `https://tiles.aqicn.org/tiles/usepa-aqi/{z}/{x}/{y}.png?token={TOKEN}`，无需自建昂贵切片服务器。
3. **兜底源：Open-Meteo Air Quality API**
   - 面向海外偏远地区坐标查询时，动态透传调用，免 Key 实时渲染。

---

## 3. 标准规范与算法设计 (Standards & Conversions)

系统内部统一存储物理**原始质量浓度（$\mu\text{g/m}^3$ 与 $\text{mg/m}^3$）**，前端根据用户偏好实时或视图层转换 AQI。

### 3.1 双标准断点表 (Breakpoint Tables)

#### ① 中国国标 HJ 633-2012
| 空气质量级别 | AQI 指标区间 | PM2.5 (24h均值 $\mu\text{g/m}^3$) | PM10 (24h均值 $\mu\text{g/m}^3$) | O3 (8h滑动 $\mu\text{g/m}^3$) |
| :--- | :--- | :--- | :--- | :--- |
| **优 (一级)** | 0 - 50 | 0 - 35 | 0 - 50 | 0 - 100 |
| **良 (二级)** | 51 - 100 | 35 - 75 | 50 - 150 | 100 - 160 |
| **轻度污染 (三级)** | 101 - 150 | 75 - 115 | 150 - 250 | 160 - 215 |
| **中度污染 (四级)** | 151 - 200 | 115 - 150 | 250 - 350 | 215 - 265 |
| **重度污染 (五级)** | 201 - 300 | 150 - 250 | 350 - 420 | 265 - 800 |
| **严重污染 (六级)** | > 300 | > 250 | > 420 | - |

#### ② 美国标准 US EPA NowCast
| 级别 | AQI 指标区间 | PM2.5 (24h均值 $\mu\text{g/m}^3$) |
| :--- | :--- | :--- |
| **Good** | 0 - 50 | 0.0 - 12.0 |
| **Moderate** | 51 - 100 | 12.1 - 35.4 |
| **Unhealthy for Sensitive Groups** | 101 - 150 | 35.5 - 55.4 |
| **Unhealthy** | 151 - 200 | 55.5 - 150.4 |
| **Very Unhealthy** | 201 - 300 | 150.5 - 250.4 |
| **Hazardous** | 301 - 500 | 250.5 - 500.4 |

### 3.2 分指数计算核心公式
$$IAQI_p = \frac{IAQI_{hi} - IAQI_{lo}}{BP_{hi} - BP_{lo}} \times (C_p - BP_{lo}) + IAQI_{lo}$$
$$AQI = \max(IAQI_1, IAQI_2, \dots, IAQI_n)$$
首要污染物即为对应 $IAQI$ 最大的项目。

---

## 4. 数据库设计与 Schema 规范 (Database Schemas)

以 **PostgreSQL**（可加装 TimescaleDB 扩展）为基准：

```sql
-- 1. 区域与城市元数据表
CREATE TABLE geo_regions (
    region_id VARCHAR(32) PRIMARY KEY, -- 如 "CN_110000", "US_NYC"
    country_code VARCHAR(8) NOT NULL,   -- "CN", "US", "JP"
    name_zh VARCHAR(64) NOT NULL,       -- "北京"
    name_en VARCHAR(64) NOT NULL,       -- "Beijing"
    province VARCHAR(64),
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    is_domestic BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. 监测站点元数据表 (国控站与海外基站)
CREATE TABLE monitoring_stations (
    station_id VARCHAR(32) PRIMARY KEY, -- 如 "1001A", "waqi_1451"
    region_id VARCHAR(32) REFERENCES geo_regions(region_id),
    station_name VARCHAR(128) NOT NULL,
    code_cn VARCHAR(32),                -- 国控站编码如 "1001A"
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    is_control_point BOOLEAN DEFAULT FALSE, -- 是否为清洁对照点
    source VARCHAR(32) NOT NULL         -- "CNEMC", "WAQI", "EPA"
);

-- 3. 逐小时实测明细表 (按月分表或 Timescale Hypertable)
CREATE TABLE aqi_hourly_records (
    record_time TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    target_id VARCHAR(32) NOT NULL,     -- region_id 或 station_id
    target_type VARCHAR(16) NOT NULL,   -- 'city' 或 'station'
    aqi_cn INTEGER,
    aqi_us INTEGER,
    primary_pollutant VARCHAR(16),      -- 'pm25', 'o3', etc.
    pm25 REAL,                          -- ug/m3
    pm10 REAL,                          -- ug/m3
    so2 REAL,                           -- ug/m3
    no2 REAL,                           -- ug/m3
    co REAL,                            -- mg/m3
    o3 REAL,                            -- ug/m3
    o3_8h REAL,                         -- ug/m3
    temp REAL,                          -- 摄氏度
    humidity REAL,                      -- 百分比
    wind_speed REAL,                    -- m/s
    wind_direction REAL,                -- 角度
    PRIMARY KEY (record_time, target_id, target_type)
);

-- 4. 预聚合日度统计表 (用于前端秒级生成年际/月度图表)
CREATE TABLE aqi_daily_stats (
    stat_date DATE NOT NULL,
    target_id VARCHAR(32) NOT NULL,
    target_type VARCHAR(16) NOT NULL,
    aqi_avg_cn REAL,
    aqi_max_cn INTEGER,
    aqi_min_cn INTEGER,
    pm25_avg REAL,
    pm10_avg REAL,
    o3_8h_max REAL,
    quality_level_cn VARCHAR(16),       -- '优', '良', '轻度', etc.
    PRIMARY KEY (stat_date, target_id, target_type)
);

CREATE INDEX idx_hourly_target_time ON aqi_hourly_records(target_id, record_time DESC);
CREATE INDEX idx_daily_target_date ON aqi_daily_stats(target_id, stat_date DESC);
```

---

## 5. 前端可视化与交互模块架构

平台前端采用现代响应式仪表盘设计：

### 5.1 核心页面与组件
1. **全局实时总览看板 (`/`)**
   - 顶部实时指标跑马灯：全球最清洁城市 vs 污染最重城市 Top 10。
   - 搜索与定位栏：支持中英文城市模糊搜索、国控站点检索、当前经纬度自动定位。
   - 核心仪表卡片：当前大字 AQI、环形进度色条、健康防护建议、首要污染物、分项雷达图。
2. **交互式全景地图大屏 (`/map`)**
   - 底图：基于 MapLibre GL / Leaflet，加载轻量深色/浅色底图。
   - 覆盖层 1：WAQI 全球实时污染热力瓦片层（无缝平滑渐变）。
   - 覆盖层 2：全国 2,026 国控站点矢量聚合打点（高缩放显示聚类泡泡，低缩放展开显示每个微站的实时数字与颜色）。
3. **城市历史深度透视 (`/city/:id`)**
   - **时间机器日历图**：ECharts Calendar Heatmap，以格子形式展示全年 365 天每天的优良等级（红绿黄紫）。
   - **长周期年际趋势对比**：折线图展示近 10 年（2014-至今）该城市 PM2.5 年均浓度持续下降的“蓝天保卫战”成果轨迹。
   - **24小时与未来 7 天走势**：历史连续记录 + 未来平滑预测虚线。
4. **全球对比沙盘 (`/compare`)**
   - 自由挑选 2~4 个城市（如 `北京` vs `伦敦` vs `新德里`）。
   - 同一坐标轴对比过去同期的改善幅度、主要污染物构成差异。

---

## 6. 协同工作流与智能角色分工 (Agent Roles)

在全栈工程实现中，分设以下 5 个自动化专业协同角色（Agent Roles）：

```
┌────────────────────────────────────────────────────────┐
│               Lead Architect Agent                     │
│               (总控架构与质量标准评审)                   │
└────────┬───────────────────┬───────────────────┬───────┘
         ▼                   ▼                   ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│ Data Pipeline   │ │ Backend & Engine│ │ Frontend UI/UX  │
│ Agent           │ │ Agent           │ │ Agent           │
│ (数据管道与清洗) │ │ (API与时序查询) │ │ (可视化与大屏)   │
└─────────────────┘ └─────────────────┘ └─────────────────┘
         ▲                   ▲                   ▲
         └───────────────────┴───────────────────┘
                             │
                    ┌────────┴────────┐
                    │ QA & Verification│
                    │ Agent           │
                    │ (数据校准与测试) │
                    └─────────────────┘
```

| Agent 角色 | 核心职责 | 关键产出物 |
| :--- | :--- | :--- |
| **Lead Architect Agent** | 整体系统架构把控、技术栈规范、API 契约定义与合规保障 | 架构协议、接口规范、进度把控 |
| **Data Pipeline Agent** | 编写 QuotSoft 爬取与入库脚本、WAQI 轮询定时任务、OpenAQ S3 连接器 | `scripts/ingest_quotsoft.py`, `scripts/sync_realtime.py` |
| **Backend & Engine Agent** | 实现高并发 REST/GraphQL API、TimescaleDB 聚合查询、国标/美标 AQI 计算引擎 | `/api/realtime`, `/api/history`, `/api/stations` |
| **Frontend UI/UX Agent** | 搭建 Next.js/React 现代化前端、ECharts 图表封装、Leaflet 地图瓦片与站点打点 | 可交互大屏、图表组件、移动端适配 |
| **QA & Verification Agent** | 校验数据连续性、比对官方发布值与计算值误差、性能与缓存压力测试 | 自动化测试脚本、对账报告 |

---

## 7. 详细分阶段落地实施路线图 (Roadmap)

### Phase 1：环境初始化与脚手架准备 (已完成 ✅)
- [x] 初始化 Next.js 14 App Router 全栈工程架构，接入 TypeScript 与 Tailwind CSS 玻璃拟态风格。
- [x] 创建兼容 Cloudflare D1 (SQLite) 与 PostgreSQL 的双模式数据库 DDL 表结构 (`schema.sql`)。
- [x] 配置专属 WAQI Token 环境变量与开发环境。

### Phase 2：数据管道与离线导入引擎 (已完成 ✅)
- [x] 整理并固化全国 375+ 重点城市与 2026+ 国控微站经纬度元数据字典。
- [x] 编写 QuotSoft 离线自动抓取与解析脚本 (`scripts/ingest-quotsoft.mjs`)。
- [x] 构建兼顾采暖季、沙尘季、光化学臭氧季的 365 天时间序列生成与日度统计模型。
- [x] 编写每日增量自动同步与自愈流水线 (`scripts/sync_daily_quotsoft.py` 与 `.github/workflows/daily-sync-history.yml`)，实现国内历史数据零费用免运维自动化入库。

### Phase 3：标准换算算法与 API 引擎 (已完成 ✅)
- [x] 封装完整国标 (HJ 633-2012) 与美标 (US EPA NowCast) 双标准换算引擎 (`lib/aqi-calculator.ts`)。
- [x] 接入 WAQI REST API 实时通道与气象参数提取 (`lib/services/waqi.ts`)。
- [x] 提供兼容 Cloudflare Edge Runtime 的轻量 API 接口：
  - `GET /api/realtime?city=beijing`
  - `GET /api/history?city=cn-beijing&year=2025`
  - `GET /api/stations?city=北京`

### Phase 4：现代化前端与多维数据可视化大屏 (已完成 ✅)
- [x] 搭建响应式导航栏与一键无缝双标准切换 Context (`components/StandardContext.tsx`)。
- [x] 首页实时总览大盘 (`/`)：AQI 动态表盘、六大污染物实测进度条、24 小时面积折线图、未来 5 天预报、本地国控微站列表。
- [x] 全景地图大屏 (`/map`)：集成 Leaflet + CartoDB 深色底图 + WAQI 实时污染热力切片层 + 2,026 国控微站打点交互。
- [x] 历史时间机器 (`/history`)：365 天日历热力谱系图、近 10 年蓝天保卫战成果双轴图、一键导出 CSV 报表。
- [x] 全球沙盘对比 (`/compare`)：支持自由挑选 2~5 个国内外大城市，同坐标系对比改善曲线与污染物雷达图。

### Phase 5：Cloudflare / GitHub Pages 部署就绪与交付 (已完成 ✅)
- [x] 配置 Cloudflare Pages / Workers 部署配置文件 (`wrangler.toml`)。
- [x] 编写 GitHub Actions 自动 CI/CD 流程 (`.github/workflows/deploy-cloudflare.yml`)，实现零服务器费用自动化部署。
- [x] 全流程执行 `npm run build`，生产环境编译 100% 成功，0 错误交付。

---

## 8. 智能体行为准则与调试守则 (Agent Guidelines & Rules)

> [!WARNING]
> **严禁随意或频繁执行 `npm run build`**：
> - **原因**：用户本地通常保持 `npm run dev` 运行进行热重载预览。全量 `npm run build` 会强行重写/清理 `.next` 编译缓存与产物，导致开发服务器热更新失效或直接崩溃，迫使用户必须频繁重启 `run dev`。
> - **规范要求**：
>   1. **禁止动不动执行 `npm run build`**。在日常页面优化、UI 样式微调、局部组件修改时，严禁自行触发全量 build。
>   2. 代码正确性验证优先使用轻量静态类型检查（如 `npx tsc --noEmit`）或由开发者的 `run dev` 自动完成热编译校验。
>   3. 仅在用户明确发出打包/构建指令，或最终交付发布审查时，才可谨慎执行 `npm run build`。

---

## 9. 数据真实性与反伪降级铁律 (Data Authenticity & Anti-Heuristic Directives)

> [!CAUTION]
> **在空气质量与环境监测等严肃科学数据平台中，“无数据如实报告无数据”远比“自作聪明的假降级与数据伪造”要专业一万倍！**
> 任何智能体 (Agent) 必须誓死捍卫数据客观性，严禁编写任何粉饰太平的伪兜底与启发式猜测代码。

### 9.1 严禁跨域移花接木与假降级 (Zero Synthetic Fallback & False Delegation)
* **严禁越界冒名顶替**：当城市在册监测点因上游维护、通信中断等原因无实时数据发布（如 `aqi: "-"`）时，**必须如实展示其离线停更状态**（Badge 置灰、标注 `isOffline: true` 与最后有效上报时间）。
* **严禁滥用 `feed/geo:` 兜底**：严禁在在册城市无数据时盲目退化至 WAQI 坐标逆检索接口。WAQI 的 `geo:` 会在无数据时无限外溢搜索数百公里，把异地测站（如将 196km 外的重庆测站套上“成都”标签）抓回冒充，此行为属于**不可容忍的伪造数据事故**。
* **物理距离硬红线**：任意经纬度检索必须硬编码 $\le 35\text{km}$ 物理大圆距离红线，超出范围直接阻断并报错，严禁跨行政区掠夺邻城数据。

### 9.2 严禁启发式扩大搜索半径 (No Radius Escalation)
* 城市在册测站池覆盖范围统一锁定在 $\pm 0.35^\circ$（约 35km 半径，地级市核心城区物理边界）。
* **严禁自适应扩大搜索半径**（如搜不到就自动扩大到 $\pm 0.50^\circ$、$\pm 1.0^\circ$）。扩大半径只会将周边邻近城市（如德阳之于成都、佛山之于广州）的测站误拉入当前城市，严重破坏数据独立性。

### 9.3 纯客观几何 Voronoi 判定，彻底消灭字符串猜测 (Zero String Heuristics)
* **主权归属**：必须 100% 由 `@rapideditor/country-coder` 高精矢量多边形逆地理编码判定（`iso1A2Code([lon, lat])`），严禁任何手写国家名称字符串匹配（如 `Malaysia`、`Singapore`、`Johor` 等特判）。
* **城市归属**：必须 100% 由客观球面物理几何距离（Voronoi 最近城市算法）裁决，哪个城市中心物理距离最近即归属哪个城市。
* **严禁名称正则猜测**：严禁使用 `stationName.includes('CityName')`。国内存在大量如“中山公园”、“南京路”、“广州西路”等重名地标，字符串匹配会造成灾难性的跨城误判。

### 9.4 客户端零脏缓存，服务端 8 分钟 SWR 内存快照 (Lean Cache Directives)
* **严禁在客户端浏览器搞 `sessionStorage` / `localStorage` 缓存**：客户端长缓存会导致用户在刷新或切换 Tab 时读到滞后的历史旧值，造成前台实况与排行榜数据严重对不上账。前台直连服务端获取最新状态。
* **服务端采用 8 分钟 SWR 内存快照与 30 秒物理防抖**：排行榜聚合全网数百个网格切片，服务端内存快照保鲜 8 分钟（过期后先行秒回旧值并在后台静默更新，杜绝前台白屏与击穿上游 Nginx 反代约 10~15 QPS 漏桶瞬时限频）；用户手动刷新支持 30 秒物理防抖穿透。


