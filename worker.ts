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
  fetch5DayForecastMultiSource,
  fetchHourlyTrendMultiSource,
} from './lib/datasources';
import type { ProviderId, StandardType } from './lib/types';

export interface Env {
  ASSETS: {
    fetch: (request: Request) => Promise<Response>;
  };
  RANKING_KV?: KVNamespaceLike;
  WAQI_TOKENS?: string;
  // 多数据源可选密钥（配置哪个即自动激活对应数据源，未配置自动跳过）
  QWEATHER_API_HOST?: string;
  QWEATHER_API_KEY?: string;
  QWEATHER_JWT?: string;
  QWEATHER_DEVELOPER_ID?: string;
  QWEATHER_PROJECT_ID?: string;
  QWEATHER_CREDENTIAL_ID?: string;
  QWEATHER_PRIVATE_KEY?: string;
  CAIYUN_API_TOKEN?: string;
  OPENAQ_API_KEY?: string;
  AIRNOW_API_KEY?: string;
  GOOGLE_AQ_API_KEY?: string;
  MOENV_API_KEY?: string;
  OPENWEATHER_API_KEY?: string;
}

interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

interface WorkerScheduledController {
  scheduledTime: number;
  cron: string;
}

function getEdgeDefaultCache(): Cache | null {
  try {
    const cfCaches = (globalThis as unknown as { caches?: { default?: Cache } }).caches;
    return cfCaches?.default ?? null;
  } catch {
    return null;
  }
}

export default {
  async fetch(request: Request, env: Env, ctx?: WorkerExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // 0. 全球与国内实时空气质量排行榜接口（Cloudflare Edge Cache + KV 0ms 极速读取）
    if (url.pathname === '/api/ranking/realtime') {
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
          },
        });
      }

      if (!env.RANKING_KV) {
        return new Response(
          JSON.stringify({
            success: false,
            initializing: true,
            error: 'RANKING_KV namespace is not bound yet',
          }),
          {
            status: 503,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
              'Cache-Control': 'no-store',
            },
          }
        );
      }

      const edgeCache = getEdgeDefaultCache();
      const cacheKey = new Request(`${url.origin}/api/ranking/realtime`, { method: 'GET' });

      // 所有请求统一命中 Cloudflare 边缘缓存（60s），严禁通过 query 参数穿透直击 KV，彻底防刷
      if (edgeCache) {
        const cached = await edgeCache.match(cacheKey);
        if (cached) {
          return cached;
        }
      }

      const snapshotJson = await env.RANKING_KV.get(RANKING_LATEST_KEY);
      if (!snapshotJson) {
        return new Response(
          JSON.stringify({
            success: false,
            initializing: true,
            error: 'Ranking KV snapshot initializing, waiting for first Cron cycle',
          }),
          {
            status: 503,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
              'Cache-Control': 'no-store',
            },
          }
        );
      }

      const response = new Response(snapshotJson, {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
          'X-Ranking-Source': 'cloudflare-kv',
        },
      });

      if (edgeCache && ctx) {
        ctx.waitUntil(edgeCache.put(cacheKey, response.clone()));
      }

      return response;
    }

    // 0.5 单城实况边缘加速聚合接口 (Cloudflare Edge Cache 3 分钟，0 KV 消耗，<= 21 subrequests)
    if (url.pathname === '/api/city-realtime') {
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
          },
        });
      }

      const cityParam = url.searchParams.get('city')?.trim();
      if (!cityParam) {
        return new Response(JSON.stringify({ success: false, error: 'Missing city parameter' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }

      const edgeCache = getEdgeDefaultCache();
      const cacheKey = new Request(
        `${url.origin}/api/city-realtime?city=${encodeURIComponent(cityParam.toLowerCase())}`,
        { method: 'GET' }
      );

      if (edgeCache) {
        const cached = await edgeCache.match(cacheKey);
        if (cached) {
          return cached;
        }
      }

      try {
        // 1. 优先命中 40 座全球核心大都市 KV 预热分包（内网 ~10ms，0 次外部 WAQI 请求，彻底消灭 3~5 秒冷查）
        let sourceHeader = 'cloudflare-edge';
        let payload = env.RANKING_KV ? await readHotCityFromKV(env.RANKING_KV, cityParam) : null;
        if (payload) {
          sourceHeader = 'cloudflare-kv-hot';
        } else {
          // 2. 非热门长尾城市或首轮预热尚未完成时，实时边缘多源编排回源（策略 A：区域优先 + 延迟 >90m 自动切源）
          const tokens = parseWaqiTokens(env.WAQI_TOKENS);
          payload = await fetchEdgeCityRealtimePayload(cityParam, tokens, fetch, env);
        }

        if (!payload) {
          return new Response(
            JSON.stringify({ success: false, error: 'City not found or no live station data' }),
            {
              status: 404,
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'no-store',
              },
            }
          );
        }

        const response = new Response(JSON.stringify(payload), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=300, stale-while-revalidate=600',
            'X-City-Source': sourceHeader,
            'X-Data-Provider': payload.provenance?.providerId || payload.baseRecord?.provenance?.providerId || 'waqi',
          },
        });

        if (edgeCache && ctx) {
          ctx.waitUntil(edgeCache.put(cacheKey, response.clone()));
        }

        return response;
      } catch (err: any) {
        return new Response(
          JSON.stringify({ success: false, error: err?.message || 'Edge city fetch failed' }),
          {
            status: 502,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
              'Cache-Control': 'no-store',
            },
          }
        );
      }
    }

    // 0.8 多数据源 24~72 小时逐小时实测网关（自动路由和风/香港环保署/WAQI/OpenAQ/Google AQ，10 分钟边缘缓存）
    if (url.pathname === '/api/hourly-trend') {
      const cityParam = url.searchParams.get('city')?.trim();
      const standardParam: StandardType = url.searchParams.get('standard') === 'CN' ? 'CN' : 'US';
      const providerParam = (url.searchParams.get('provider')?.trim() || undefined) as ProviderId | undefined;
      const stationParam = url.searchParams.get('station')?.trim() || undefined;

      const city = cityParam ? findCity(cityParam) : undefined;
      if (!city) {
        return new Response(JSON.stringify({ points: [], isReal: false, source: '未知城市' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }

      const edgeCache = getEdgeDefaultCache();
      const cacheKey = new Request(
        `${url.origin}/api/hourly-trend?city=${encodeURIComponent(city.id)}&standard=${standardParam}&provider=${encodeURIComponent(providerParam || '')}&station=${encodeURIComponent(stationParam || '')}`,
        { method: 'GET' }
      );
      if (edgeCache) {
        const cached = await edgeCache.match(cacheKey);
        if (cached) return cached;
      }

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
        const response = new Response(JSON.stringify(result), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': result.isReal
              ? 'public, max-age=600, stale-while-revalidate=600'
              : 'public, max-age=60',
          },
        });
        if (edgeCache && ctx && result.isReal) {
          ctx.waitUntil(edgeCache.put(cacheKey, response.clone()));
        }
        return response;
      } catch (err: any) {
        return new Response(
          JSON.stringify({ points: [], isReal: false, source: err?.message || 'Fetch failed' }),
          {
            status: 502,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
          }
        );
      }
    }

    // 0.9 多数据源未来 5 天预报网关（优先彩云 AI 预报，自动回落 Open-Meteo ECMWF/CAMS，30 分钟边缘缓存）
    if (url.pathname === '/api/forecast') {
      const lat = Number(url.searchParams.get('lat'));
      const lon = Number(url.searchParams.get('lon'));
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return new Response(JSON.stringify({ list: [], source: '参数无效' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }

      const edgeCache = getEdgeDefaultCache();
      const cacheKey = new Request(
        `${url.origin}/api/forecast?lat=${lat.toFixed(2)}&lon=${lon.toFixed(2)}`,
        { method: 'GET' }
      );
      if (edgeCache) {
        const cached = await edgeCache.match(cacheKey);
        if (cached) return cached;
      }

      try {
        const result = await fetch5DayForecastMultiSource(lat, lon, {
          rawEnv: env,
          isServer: true,
        });
        const response = new Response(JSON.stringify(result), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=1800, stale-while-revalidate=1800',
          },
        });
        if (edgeCache && ctx && result.list.length > 0) {
          ctx.waitUntil(edgeCache.put(cacheKey, response.clone()));
        }
        return response;
      } catch (err: any) {
        return new Response(
          JSON.stringify({ list: [], source: err?.message || 'Forecast failed' }),
          {
            status: 502,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
          }
        );
      }
    }

    // 1. WAQI 24小时逐小时时序专线网关 (接入 Cloudflare Edge Cache 10 分钟真正缓存，彻底消除刷新时 2 次串行 POST)
    if (url.pathname === '/api/waqi-hourly') {
      const idx = url.searchParams.get('idx')?.trim();
      if (!idx) {
        return new Response(JSON.stringify({ error: 'Missing idx' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }

      const edgeCache = getEdgeDefaultCache();
      const hourlyCacheKey = new Request(
        `${url.origin}/api/waqi-hourly?idx=${encodeURIComponent(idx)}`,
        { method: 'GET' }
      );
      if (edgeCache) {
        const cached = await edgeCache.match(hourlyCacheKey);
        if (cached) {
          return cached;
        }
      }

      try {
        const uid = 'u' + Date.now();
        const tokenRes = await fetch(`https://api2.waqi.info/api/token/${idx}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `key=-&uid=${uid}`,
        });

        if (!tokenRes.ok) {
          return new Response(JSON.stringify({ error: `Token fetch error: ${tokenRes.status}` }), {
            status: 502,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
          });
        }

        const tokenJson: any = await tokenRes.json();
        const token = tokenJson?.rxs?.obs?.[0]?.msg?.token;
        if (!token) {
          return new Response(JSON.stringify({ error: 'Failed to acquire WAQI token' }), {
            status: 502,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
          });
        }

        const feedUid = 'f' + Date.now();
        const waqiRes = await fetch(`https://api2.waqi.info/api/feed/@${idx}/aqi.json`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `key=-&token=${token}&uid=${feedUid}&rqc=2`,
        });

        if (!waqiRes.ok) {
          return new Response(JSON.stringify({ error: `WAQI status ${waqiRes.status}` }), {
            status: 502,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
          });
        }

        const data = await waqiRes.text();
        const response = new Response(data, {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=600, stale-while-revalidate=600',
          },
        });
        if (edgeCache && ctx) {
          ctx.waitUntil(edgeCache.put(hourlyCacheKey, response.clone()));
        }
        return response;
      } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message || 'Fetch failed' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
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
