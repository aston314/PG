const TMDB_API_BASE = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";
const EZTV_API_BASE = "https://eztvx.to";
const YTS_API_BASE = "https://yts.mx/api/v2";
const TB_API_BASE = "https://thepiratebay10.info/search";
const X_API_BASE = "https://1337x.to/sort-category-search";

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

async function proxyRequest(url: string, request: Request): Promise<Response> {
  // console.log(`代理请求到: ${url}`);
  try {
    const response = await fetch(url, {
      headers: request.headers,
      method: request.method,
      body: request.body,
    });
    // console.log(`收到响应，状态码: ${response.status}`);
    return new Response(response.body, {
      status: response.status,
      headers: {
        ...response.headers,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  } catch (error) {
    // console.error(`代理请求期间发生错误: ${error}`);
    return new Response(`代理请求失败: ${error}`, { status: 500 });
  }
}

async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  // console.log(`收到请求，路径: ${path}`);

  try {
    let proxyUrl: string;
    if (path.startsWith("/3/")) {
      proxyUrl = joinUrl(TMDB_API_BASE, path.slice(3)) + url.search;
    } else if (path.startsWith("/t/p/")) {
      proxyUrl = joinUrl(TMDB_IMAGE_BASE, path.slice(5)) + url.search;
    } else if (path.startsWith("/api/get-torrents")) {
      proxyUrl = joinUrl(EZTV_API_BASE, path) + url.search;
    } else if (path.startsWith("/api/v2/")) {
      proxyUrl = joinUrl(YTS_API_BASE, path.slice(8)) + url.search;
    } else if (path.startsWith("/search/")) {
      proxyUrl = joinUrl(TB_API_BASE, path.slice(8)) + url.search;
    } else if (path.startsWith("/sort-category-search/")) {
      proxyUrl = joinUrl(X_API_BASE, path.slice(22)) + url.search;
    } else {
      // console.log(`没有匹配的路由: ${path}`);
      return new Response("Not Found", { status: 404 });
    }
    return proxyRequest(proxyUrl, request);
  } catch (error) {
    // console.error(`处理请求时发生错误: ${error}`);
    return new Response(`服务器错误: ${error}`, { status: 500 });
  }
}

const port = parseInt(Deno.env.get("PORT") ?? "8000");
console.log(`代理服务器运行在 http://localhost:${port}`);
Deno.serve({ port }, handleRequest);
