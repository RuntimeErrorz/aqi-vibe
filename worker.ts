export interface Env {
  ASSETS: {
    fetch: (request: Request) => Promise<Response>;
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

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
