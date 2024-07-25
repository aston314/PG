// tmdb_proxy_server.ts
const TMDB_API_BASE = "https://api.themoviedb.org/3/";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/";

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
    // API proxy
    return proxyRequest(TMDB_API_BASE + path.slice(3) + url.search, request);
  } else if (path.startsWith("/t/p/")) {
    // Image proxy
    return proxyRequest(TMDB_IMAGE_BASE + path.slice(5), request);
  } else {
    return new Response("Not Found", { status: 404 });
  }
}

const port = parseInt(Deno.env.get("PORT") ?? "8000");
console.log(`TMDB Proxy server running on http://localhost:${port}`);
Deno.serve({ port }, handleRequest);
