-- ============================================================
-- AQI-Vibe 数据库表结构规范 (同时兼容 Cloudflare D1 与 PostgreSQL)
-- ============================================================

-- 1. 区域与城市元数据表
CREATE TABLE IF NOT EXISTS geo_regions (
    region_id VARCHAR(32) PRIMARY KEY,
    country_code VARCHAR(8) NOT NULL,
    name_zh VARCHAR(64) NOT NULL,
    name_en VARCHAR(64) NOT NULL,
    province VARCHAR(64),
    latitude REAL,
    longitude REAL,
    is_domestic INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. 监测站点元数据表 (国控微站与海外基站)
CREATE TABLE IF NOT EXISTS monitoring_stations (
    station_id VARCHAR(32) PRIMARY KEY,
    region_id VARCHAR(32),
    station_name VARCHAR(128) NOT NULL,
    code_cn VARCHAR(32),
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    is_control_point INTEGER DEFAULT 0,
    source VARCHAR(32) NOT NULL
);

-- 3. 逐小时实测明细表
CREATE TABLE IF NOT EXISTS aqi_hourly_records (
    record_time TEXT NOT NULL,
    target_id VARCHAR(32) NOT NULL,
    target_type VARCHAR(16) NOT NULL, -- 'city' 或 'station'
    aqi_cn INTEGER,
    aqi_us INTEGER,
    primary_pollutant VARCHAR(16),
    pm25 REAL,
    pm10 REAL,
    so2 REAL,
    no2 REAL,
    co REAL,
    o3 REAL,
    o3_8h REAL,
    temp REAL,
    humidity REAL,
    wind_speed REAL,
    PRIMARY KEY (record_time, target_id, target_type)
);

-- 4. 预聚合日度统计表 (用于年际趋势与日历热力秒级响应)
CREATE TABLE IF NOT EXISTS aqi_daily_stats (
    stat_date TEXT NOT NULL,
    target_id VARCHAR(32) NOT NULL,
    target_type VARCHAR(16) NOT NULL,
    aqi_avg_cn REAL,
    aqi_max_cn INTEGER,
    aqi_min_cn INTEGER,
    pm25_avg REAL,
    pm10_avg REAL,
    quality_level_cn VARCHAR(16),
    PRIMARY KEY (stat_date, target_id, target_type)
);

CREATE INDEX IF NOT EXISTS idx_hourly_target_time ON aqi_hourly_records(target_id, record_time DESC);
CREATE INDEX IF NOT EXISTS idx_daily_target_date ON aqi_daily_stats(target_id, stat_date DESC);
