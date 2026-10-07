export interface Env {
  ASSETS: {
    fetch: (request: Request) => Promise<Response>;
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // 0. WAQI 24小时逐小时时序专线网关 (带边缘缓存与反爬头伪装，突破 WAQI 防爬陷阱)
    if (url.pathname === '/api/waqi-hourly') {
      const idx = url.searchParams.get('idx');
      if (!idx) {
        return new Response(JSON.stringify({ error: 'Missing idx' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }

      try {
        const uid = 'u' + Date.now();
        const tokenRes = await fetch(`https://api2.waqi.info/api/token/${idx}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `key=-&uid=${uid}`
        });

        if (!tokenRes.ok) {
          return new Response(JSON.stringify({ error: `Token fetch error: ${tokenRes.status}` }), {
            status: 502,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
          });
        }

        const tokenJson: any = await tokenRes.json();
        const token = tokenJson?.rxs?.obs?.[0]?.msg?.token;
        if (!token) {
          return new Response(JSON.stringify({ error: 'Failed to acquire WAQI token' }), {
            status: 502,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
          });
        }

        const feedUid = 'f' + Date.now();
        const waqiRes = await fetch(`https://api2.waqi.info/api/feed/@${idx}/aqi.json`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `key=-&token=${token}&uid=${feedUid}&rqc=2`
        });

        if (!waqiRes.ok) {
          return new Response(JSON.stringify({ error: `WAQI status ${waqiRes.status}` }), {
            status: 502,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
          });
        }

        const data = await waqiRes.text();
        return new Response(data, {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=600'
          }
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message || 'Fetch failed' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
    }

    // 1. 优先交由 Cloudflare Workers Assets 静态托管分发
    const response = await env.ASSETS.fetch(request);
    if (response.status !== 404) {
      return response;
    }

    // 2. 针对 Next.js 无后缀路由（如 /map, /history, /compare），自动回退尝试 .html 后缀
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
};
