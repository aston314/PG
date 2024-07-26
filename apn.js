// tmdb_proxy_server.ts
const TMDB_API_BASE = "https://api.themoviedb.org/3/";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/";
const EZTV_API_BASE = "https://eztvx.to/";
const YTS_API_BASE = "https://yts.mx/api/v2/";
const TB_API_BASE = "https://thepiratebay10.info/search/";
const X_API_BASE = "https://1337x.to/sort-category-search/";

async function proxyRequest(url: string, request: Request): Promise<Response> {
  const response = await fetch(url, {
    headers: request.headers,
    method: request.method,
    body: request.body,
  });
  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  });
}

async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path.startsWith("/3/")) {
    // TMDB API 代理
    return proxyRequest(TMDB_API_BASE + path.slice(3) + url.search, request);
  } else if (path.startsWith("/t/p/")) {
    // TMDB 图片代理
    return proxyRequest(TMDB_IMAGE_BASE + path.slice(5), request);
  } else if (path.startsWith("/api/get-torrents")) {
    // EZTV API 代理
    return proxyRequest(EZTV_API_BASE + path + url.search, request);
  } else if (path.startsWith("/api/v2/")) {
    // YTS API 代理
    return proxyRequest(YTS_API_BASE + path.slice(8) + url.search, request);
  } else if (path.startsWith("/search/")) {
    // TB API 代理
    return proxyRequest(TB_API_BASE + path.slice(8) + url.search, request);
  } else if (path.startsWith("/sort-category-search/")) {
    // X API 代理
    return proxyRequest(X_API_BASE + path.slice(22) + url.search, request);
  } else {
    return new Response("Not Found", { status: 404 });
  }
}

const port = parseInt(Deno.env.get("PORT") ?? "8000");
console.log(`代理服务器运行在 http://localhost:${port}`);
Deno.serve({ port }, handleRequest);
