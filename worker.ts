import {
  KVNamespaceLike,
  RANKING_LATEST_KEY,
  getBatchIndexFromDate,
  parseWaqiTokens,
  runRankingCronBatch,
} from './lib/services/cf-ranking-engine';
import { fetchEdgeCityRealtimePayload } from './lib/services/cf-city-realtime';
import {
  getHotCitiesPackIndexFromDate,
  readHotCityFromKV,
  runHotCitiesCronPack,
} from './lib/services/cf-hot-cities';
import { findCity } from './lib/constants/cities';
import {
  createTimeoutSignal,
  fetch5DayForecastMultiSource,
  fetchHourlyTrendMultiSource,
} from './lib/datasources';
import { fetchWaqiHourlyRawText } from './lib/services/waqi-decoder';
import { encodeWaqiTarget } from './lib/utils/common';
import type { ProviderId, StandardType } from './lib/types';

export interface Env {
  ASSETS: {
    fetch: (request: Request) => Promise<Response>;
  };
  RANKING_KV?: KVNamespaceLike;
  WAQI_TOKENS?: string;
  CARTO_API_KEY?: string;
  // 多数据源密钥（和风天气 + OpenAQ）
  QWEATHER_API_HOST?: string;
  QWEATHER_API_KEY?: string;
  QWEATHER_JWT?: string;
  QWEATHER_DEVELOPER_ID?: string;
  QWEATHER_PROJECT_ID?: string;
  QWEATHER_CREDENTIAL_ID?: string;
  QWEATHER_PRIVATE_KEY?: string;
  OPENAQ_API_KEY?: string;
}

interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

interface WorkerScheduledController {
  scheduledTime: number;
  cron: string;
}

const CORS_BASE_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
} as const;

function getEdgeDefaultCache(): Cache | null {
  try {
    const cfCaches = (globalThis as unknown as { caches?: { default?: Cache } }).caches;
    return cfCaches?.default ?? null;
  } catch {
    return null;
  }
}

function jsonResponse(
  body: unknown,
  status = 200,
  extraHeaders?: Record<string, string>
): Response {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  return new Response(payload, {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      ...extraHeaders,
    },
  });
}

async function withEdgeCache(
  cacheUrl: string,
  ctx: WorkerExecutionContext | undefined,
  producer: () => Promise<{ response: Response; cacheable: boolean }>
): Promise<Response> {
  const edgeCache = getEdgeDefaultCache();
  const cacheKey = new Request(cacheUrl, { method: 'GET' });
  if (edgeCache) {
    const cached = await edgeCache.match(cacheKey);
    if (cached) return cached;
  }

  const { response, cacheable } = await producer();
  if (edgeCache && ctx && cacheable) {
    ctx.waitUntil(edgeCache.put(cacheKey, response.clone()));
  }
  return response;
}

function parseFiniteCoord(raw: string | null, fallback: number | undefined, min: number, max: number): number {
  const trimmed = raw?.trim();
  const val = trimmed && trimmed.length > 0 ? Number(trimmed) : fallback;
  if (typeof val !== 'number' || !Number.isFinite(val) || val < min || val > max) {
    return NaN;
  }
  return val;
}

function pickRandomToken(tokens: string[]): string {
  return tokens[Math.floor(Math.random() * tokens.length)];
}

/**
 * WAQI API returns HTTP 200 even on business errors like `{"status":"error","data":"Over quota"}`.
 * Verify the payload actually has `"status":"ok"` before allowing Edge or browser caching.
 */
function isWaqiOkPayload(rawText: string): boolean {
  try {
    const parsed = JSON.parse(rawText) as { status?: string };
    return parsed?.status === 'ok';
  } catch {
    return false;
  }
}

/**
 * Snap map bounds outward to a 0.05° grid (~5.5km) so tiny Leaflet float deltas share Edge Cache
 * without ever shrinking the requested viewport.
 */
function normalizeOutwardBounds(latlng: string): string | null {
  const parts = latlng.split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  let [minLat, minLon, maxLat, maxLon] = parts;
  if (minLat > maxLat) [minLat, maxLat] = [maxLat, minLat];
  if (minLon > maxLon) [minLon, maxLon] = [maxLon, minLon];
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const step = 20; // 0.05° resolution
  const sMinLat = clamp(Math.floor(minLat * step) / step, -90, 90);
  const sMinLon = clamp(Math.floor(minLon * step) / step, -180, 180);
  const sMaxLat = clamp(Math.ceil(maxLat * step) / step, -90, 90);
  const sMaxLon = clamp(Math.ceil(maxLon * step) / step, -180, 180);
  return `${sMinLat.toFixed(2)},${sMinLon.toFixed(2)},${sMaxLat.toFixed(2)},${sMaxLon.toFixed(2)}`;
}

export default {
  async fetch(request: Request, env: Env, ctx?: WorkerExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // 统一处理所有 /api/* 的 CORS OPTIONS 预检请求
    if (url.pathname.startsWith('/api/') && request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_BASE_HEADERS });
    }

    // 0. 全球与国内实时空气质量排行榜接口（Cloudflare Edge Cache + KV 0ms 极速读取）
    if (url.pathname === '/api/ranking/realtime') {
      if (!env.RANKING_KV) {
        return jsonResponse(
          { success: false, initializing: true, error: 'RANKING_KV namespace is not bound yet' },
          503,
          { 'Cache-Control': 'no-store' }
        );
      }

      // 所有请求统一命中 Cloudflare 边缘缓存（60s），严禁通过 query 参数穿透直击 KV，彻底防刷
      return withEdgeCache(`${url.origin}/api/ranking/realtime`, ctx, async () => {
        const snapshotJson = await env.RANKING_KV!.get(RANKING_LATEST_KEY);
        if (!snapshotJson) {
          return {
            cacheable: false,
            response: jsonResponse(
              {
                success: false,
                initializing: true,
                error: 'Ranking KV snapshot initializing, waiting for first Cron cycle',
              },
              503,
              { 'Cache-Control': 'no-store' }
            ),
          };
        }
        return {
          cacheable: true,
          response: jsonResponse(snapshotJson, 200, {
            // 浏览器不囤旧盘缓存，Edge 边缘缓存 60s（严格遵循 AGENTS.md §9.4）
            'Cache-Control': 'public, max-age=0, s-maxage=60',
            'X-Ranking-Source': 'cloudflare-kv',
          }),
        };
      });
    }

    // 0.5 单城实况边缘加速聚合接口 (Cloudflare Edge Cache 5 分钟，优先 KV 热城分包)
    if (url.pathname === '/api/city-realtime') {
      const cityParam = url.searchParams.get('city')?.trim();
      if (!cityParam) {
        return jsonResponse({ success: false, error: 'Missing city parameter' }, 400);
      }

      // 归一化城市别名（如 beijing / 北京 / cn-beijing 统一命中同一份 Edge Cache）
      const canonicalCity = findCity(cityParam);
      if (!canonicalCity) {
        return jsonResponse(
          { success: false, error: 'City not found or no live station data' },
          404,
          { 'Cache-Control': 'no-store' }
        );
      }

      const cacheUrl = `${url.origin}/api/city-realtime?city=${encodeURIComponent(canonicalCity.id)}`;
      return withEdgeCache(cacheUrl, ctx, async () => {
        try {
          let sourceHeader = 'cloudflare-edge';
          let payload = env.RANKING_KV ? await readHotCityFromKV(env.RANKING_KV, canonicalCity.id) : null;
          if (payload) {
            sourceHeader = 'cloudflare-kv-hot';
          } else {
            const tokens = parseWaqiTokens(env.WAQI_TOKENS);
            payload = await fetchEdgeCityRealtimePayload(canonicalCity.id, tokens, fetch, env);
          }

          if (!payload) {
            return {
              cacheable: false,
              response: jsonResponse(
                { success: false, error: 'City not found or no live station data' },
                404,
                { 'Cache-Control': 'no-store' }
              ),
            };
          }

          return {
            cacheable: true,
            response: jsonResponse(payload, 200, {
              // Edge 缓存 5 分钟；浏览器 max-age=0 避免在 KV/Edge 之上再叠 15 分钟本地旧缓存
              'Cache-Control': 'public, max-age=0, s-maxage=300',
              'X-City-Source': sourceHeader,
              'X-Data-Provider':
                payload.provenance?.providerId || payload.baseRecord?.provenance?.providerId || 'waqi',
            }),
          };
        } catch (err: any) {
          return {
            cacheable: false,
            response: jsonResponse(
              { success: false, error: err?.message || 'Edge city fetch failed' },
              502,
              { 'Cache-Control': 'no-store' }
            ),
          };
        }
      });
    }

    // 0.8 多数据源 24~72 小时逐小时实测网关（自动路由 WAQI / OpenAQ，10 分钟边缘缓存）
    if (url.pathname === '/api/hourly-trend') {
      const cityParam = url.searchParams.get('city')?.trim();
      const standardParam: StandardType = url.searchParams.get('standard') === 'CN' ? 'CN' : 'US';
      const providerParam = (url.searchParams.get('provider')?.trim() || undefined) as ProviderId | undefined;
      const stationParam = url.searchParams.get('station')?.trim() || undefined;

      const city = cityParam ? findCity(cityParam) : undefined;
      if (!city) {
        return jsonResponse({ points: [], isReal: false, source: '未知城市' }, 400);
      }

      const cacheUrl = `${url.origin}/api/hourly-trend?city=${encodeURIComponent(city.id)}&standard=${standardParam}&provider=${encodeURIComponent(providerParam || '')}&station=${encodeURIComponent(stationParam || '')}`;
      return withEdgeCache(cacheUrl, ctx, async () => {
        try {
          const result = await fetchHourlyTrendMultiSource(
            {
              city,
              preferredProviderId: providerParam,
              stationRawId: stationParam,
              standard: standardParam,
            },
            { rawEnv: env, isServer: true }
          );
          return {
            cacheable: result.isReal,
            response: jsonResponse(result, 200, {
              'Cache-Control': result.isReal ? 'public, max-age=0, s-maxage=600' : 'no-store',
            }),
          };
        } catch (err: any) {
          return {
            cacheable: false,
            response: jsonResponse(
              { points: [], isReal: false, source: err?.message || 'Fetch failed' },
              502,
              { 'Cache-Control': 'no-store' }
            ),
          };
        }
      });
    }

    // 0.9 多数据源未来 5 天预报网关（WAQI 官方站点扩散模型首选，自动回落 Open-Meteo ECMWF/CAMS，30 分钟边缘缓存）
    if (url.pathname === '/api/forecast') {
      const cityParam = url.searchParams.get('city')?.trim();
      const city = cityParam ? findCity(cityParam) : undefined;
      const lat = parseFiniteCoord(url.searchParams.get('lat'), city?.latitude, -90, 90);
      const lon = parseFiniteCoord(url.searchParams.get('lon'), city?.longitude, -180, 180);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return jsonResponse({ list: [], source: '参数无效' }, 400);
      }

      const cacheUrl = `${url.origin}/api/forecast?city=${encodeURIComponent(city?.id || '')}&lat=${lat.toFixed(2)}&lon=${lon.toFixed(2)}`;
      return withEdgeCache(cacheUrl, ctx, async () => {
        try {
          const result = await fetch5DayForecastMultiSource(
            lat,
            lon,
            { rawEnv: env, isServer: true },
            city
          );
          const hasData = result.list.length > 0;
          return {
            cacheable: hasData,
            response: jsonResponse(result, 200, {
              // 空预报严禁缓存，防止浏览器把瞬时失败锁死 30~60 分钟
              'Cache-Control': hasData ? 'public, max-age=60, s-maxage=1800' : 'no-store',
            }),
          };
        } catch (err: any) {
          return {
            cacheable: false,
            response: jsonResponse(
              { list: [], source: err?.message || 'Forecast failed' },
              502,
              { 'Cache-Control': 'no-store' }
            ),
          };
        }
      });
    }

    // 0.95 WAQI 零前端 Token 边缘代理（bounds / feed / tile）
    if (url.pathname === '/api/waqi/bounds') {
      const latlng = url.searchParams.get('latlng')?.trim() || '';
      if (!/^-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(latlng)) {
        return jsonResponse({ status: 'error', data: 'Invalid latlng' }, 400);
      }
      const normalizedBounds = normalizeOutwardBounds(latlng);
      if (!normalizedBounds) {
        return jsonResponse({ status: 'error', data: 'Invalid latlng' }, 400);
      }
      const tokens = parseWaqiTokens(env.WAQI_TOKENS);
      if (tokens.length === 0) {
        return jsonResponse({ status: 'error', data: 'WAQI_TOKENS not configured' }, 503);
      }

      const cacheUrl = `${url.origin}/api/waqi/bounds?latlng=${encodeURIComponent(normalizedBounds)}`;
      return withEdgeCache(cacheUrl, ctx, async () => {
        try {
          const token = pickRandomToken(tokens);
          const upstream = await fetch(
            `https://api.waqi.info/v2/map/bounds?latlng=${normalizedBounds}&token=${encodeURIComponent(token)}`,
            { signal: createTimeoutSignal(8000) }
          );
          const body = await upstream.text();
          // 必须校验业务 status === 'ok'，防止 WAQI HTTP 200 "Over quota" 毒化边缘缓存
          const okToCache = upstream.ok && isWaqiOkPayload(body);
          return {
            cacheable: okToCache,
            response: jsonResponse(body, upstream.status, {
              'Cache-Control': okToCache ? 'public, max-age=0, s-maxage=60' : 'no-store',
            }),
          };
        } catch (err: any) {
          return {
            cacheable: false,
            response: jsonResponse(
              { status: 'error', data: err?.message || 'Upstream bounds fetch failed' },
              502,
              { 'Cache-Control': 'no-store' }
            ),
          };
        }
      });
    }

    if (url.pathname === '/api/waqi/feed') {
      const target = url.searchParams.get('target')?.trim() || '';
      if (!/^(@-?\d+|[a-zA-Z0-9._\-\u4e00-\u9fa5% ]+)$/.test(target) || target.includes('..') || target.includes('/')) {
        return jsonResponse({ status: 'error', data: 'Invalid target' }, 400);
      }
      const tokens = parseWaqiTokens(env.WAQI_TOKENS);
      if (tokens.length === 0) {
        return jsonResponse({ status: 'error', data: 'WAQI_TOKENS not configured' }, 503);
      }

      const cacheUrl = `${url.origin}/api/waqi/feed?target=${encodeURIComponent(target)}`;
      return withEdgeCache(cacheUrl, ctx, async () => {
        try {
          const token = pickRandomToken(tokens);
          const upstream = await fetch(
            `https://api.waqi.info/feed/${encodeWaqiTarget(target)}/?token=${encodeURIComponent(token)}`,
            { signal: createTimeoutSignal(8000) }
          );
          const body = await upstream.text();
          const okToCache = upstream.ok && isWaqiOkPayload(body);
          return {
            cacheable: okToCache,
            response: jsonResponse(body, upstream.status, {
              'Cache-Control': okToCache ? 'public, max-age=0, s-maxage=120' : 'no-store',
            }),
          };
        } catch (err: any) {
          return {
            cacheable: false,
            response: jsonResponse(
              { status: 'error', data: err?.message || 'Upstream feed fetch failed' },
              502,
              { 'Cache-Control': 'no-store' }
            ),
          };
        }
      });
    }

    const tileMatch = url.pathname.match(/^\/api\/waqi\/tile\/(\d{1,2})\/(\d+)\/(\d+)\.png$/);
    if (tileMatch) {
      const [, z, x, y] = tileMatch;
      const tokens = parseWaqiTokens(env.WAQI_TOKENS);
      if (tokens.length === 0) {
        return new Response('WAQI_TOKENS not configured', { status: 503 });
      }

      const cacheUrl = `${url.origin}/api/waqi/tile/${z}/${x}/${y}.png`;
      return withEdgeCache(cacheUrl, ctx, async () => {
        try {
          const token = pickRandomToken(tokens);
          const upstream = await fetch(
            `https://tiles.aqicn.org/tiles/usepa-aqi/${z}/${x}/${y}.png?token=${encodeURIComponent(token)}`,
            { signal: createTimeoutSignal(8000) }
          );
          return {
            cacheable: upstream.ok,
            response: new Response(upstream.body, {
              status: upstream.status,
              headers: {
                'Content-Type': upstream.headers.get('Content-Type') || 'image/png',
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': upstream.ok ? 'public, max-age=600, stale-while-revalidate=600' : 'no-store',
              },
            }),
          };
        } catch {
          return {
            cacheable: false,
            response: new Response('Tile upstream unavailable', { status: 502 }),
          };
        }
      });
    }

    // 0.96 CartoDB 地图底图零前端 Key 边缘代理（30 天不可变边缘缓存）
    const cartoMatch = url.pathname.match(/^\/api\/carto\/(voyager|dark_all)\/(\d{1,2})\/(\d+)\/(\d+)\.png$/);
    if (cartoMatch) {
      const [, style, z, x, y] = cartoMatch;
      const cacheUrl = `${url.origin}/api/carto/${style}/${z}/${x}/${y}.png`;
      return withEdgeCache(cacheUrl, ctx, async () => {
        try {
          const pathPrefix = style === 'dark_all' ? 'dark_all' : 'rastertiles/voyager';
          const keyQuery = env.CARTO_API_KEY ? `?key=${encodeURIComponent(env.CARTO_API_KEY)}` : '';
          const upstream = await fetch(
            `https://basemaps.cartocdn.com/${pathPrefix}/${z}/${x}/${y}@2x.png${keyQuery}`,
            { signal: createTimeoutSignal(8000) }
          );
          return {
            cacheable: upstream.ok,
            response: new Response(upstream.body, {
              status: upstream.status,
              headers: {
                'Content-Type': upstream.headers.get('Content-Type') || 'image/png',
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': upstream.ok ? 'public, max-age=2592000, immutable' : 'no-store',
              },
            }),
          };
        } catch {
          return {
            cacheable: false,
            response: new Response('Basemap tile upstream unavailable', { status: 502 }),
          };
        }
      });
    }

    // 1. WAQI 24~72小时逐小时时序专线网关（严格校验纯数字 station idx，防止上游路径注入）
    if (url.pathname === '/api/waqi-hourly') {
      const idx = url.searchParams.get('idx')?.trim() || '';
      if (!/^-?\d+$/.test(idx)) {
        return jsonResponse({ error: 'Invalid or missing numeric idx' }, 400);
      }

      const cacheUrl = `${url.origin}/api/waqi-hourly?idx=${encodeURIComponent(idx)}`;
      return withEdgeCache(cacheUrl, ctx, async () => {
        try {
          const raw = await fetchWaqiHourlyRawText(idx, {
            fetchImpl: fetch,
            tokenTimeoutMs: 6000,
            feedTimeoutMs: 7000,
          });
          if (!raw.ok) {
            return {
              cacheable: false,
              response: jsonResponse({ error: raw.error }, raw.status, { 'Cache-Control': 'no-store' }),
            };
          }
          return {
            cacheable: true,
            response: jsonResponse(raw.text, 200, {
              'Cache-Control': 'public, max-age=0, s-maxage=600',
            }),
          };
        } catch (err: any) {
          return {
            cacheable: false,
            response: jsonResponse(
              { error: err?.message || 'Fetch failed' },
              500,
              { 'Cache-Control': 'no-store' }
            ),
          };
        }
      });
    }

    // 2. 优先交由 Cloudflare Workers Assets 静态托管分发
    const response = await env.ASSETS.fetch(request);
    if (response.status !== 404) {
      return response;
    }

    // 3. 针对 Next.js 无后缀路由（如 /map, /history, /compare），自动回退尝试 .html 后缀
    if (!url.pathname.includes('.')) {
      const cleanPath = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname;
      const htmlUrl = new URL(`${cleanPath}.html`, request.url);
      const htmlResponse = await env.ASSETS.fetch(new Request(htmlUrl.toString(), request));
      if (htmlResponse.status !== 404) {
        return htmlResponse;
      }
    }

    return response;
  },

  /**
   * Cloudflare 双 Cron Trigger（严守免费版 1,000 KV 写/天与 50 subrequests/次上限）：
   * - Cron #1 `0-7,30-37 * * * *`：每 30 分钟 8 批滚动拉完 336 个全球高清切片（384 写/天）
   * - Cron #2 `9-18,39-48 * * * *`：每 30 分钟 10 批预热 40 座全球核心大都市高密度官方站（480 写/天）
   * - 合计 864 次 KV 写/天（留 13.6% 安全余量）
   */
  async scheduled(
    controller: WorkerScheduledController,
    env: Env,
    ctx: WorkerExecutionContext
  ): Promise<void> {
    if (!env.RANKING_KV) {
      console.warn('[Cron] RANKING_KV binding missing; skipping scheduled update.');
      return;
    }

    const scheduledDate = new Date(controller.scheduledTime);
    const tokens = parseWaqiTokens(env.WAQI_TOKENS);

    // 1. 全球实时排行窗口 (:00-:07, :30-:37)
    const batchIndex = getBatchIndexFromDate(scheduledDate);
    if (batchIndex >= 0) {
      const task = runRankingCronBatch(env.RANKING_KV, tokens, batchIndex, controller.scheduledTime)
        .then((summary) => {
          console.log(
            `[RankingCron] Batch ${summary.batchIndex}/7 done: ${summary.slicesSucceeded}/${summary.slicesRequested} slices, ` +
              `${summary.subrequestsUsed} subrequests, ${summary.stationsMatched} stations matched, ` +
              `cities=${summary.totalCities}, published=${summary.published}`
          );
        })
        .catch((err) => {
          console.error(`[RankingCron] Batch ${batchIndex} failed:`, err);
        });
      ctx.waitUntil(task);
      return;
    }

    // 2. 40 座全球核心大都市高密度官方站预热窗口 (:09-:18, :39-:48)
    const hotPackIndex = getHotCitiesPackIndexFromDate(scheduledDate);
    if (hotPackIndex >= 0) {
      const task = runHotCitiesCronPack(
        env.RANKING_KV,
        tokens,
        hotPackIndex,
        controller.scheduledTime,
        fetch,
        env
      )
        .then((summary) => {
          console.log(
            `[HotCitiesCron] Pack ${summary.packIndex}/9 done: ${summary.citiesProcessed} cities, ` +
              `${summary.stationsFetched} stations fetched, ${summary.subrequestsUsed} subrequests, ` +
              `sampled=${JSON.stringify(summary.perCitySampled)}`
          );
        })
        .catch((err) => {
          console.error(`[HotCitiesCron] Pack ${hotPackIndex} failed:`, err);
        });
      ctx.waitUntil(task);
      return;
    }

    console.log(`[Cron] Off-window minute (${scheduledDate.toISOString()}); skipped.`);
  },
};
