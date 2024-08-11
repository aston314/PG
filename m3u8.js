import { serve } from "https://deno.land/std@0.181.0/http/server.ts";
import { gzip } from "https://deno.land/x/compress@v0.4.5/gzip/mod.ts";

const version = "1.5.0";

const CONFIG = {
  port: parseInt(Deno.env.get("PORT") || "8000"),
  logLevel: Deno.env.get("LOG_LEVEL") || 'info',
  maxRetries: 3,
  retryDelay: 1000, // ms
};

const metrics = {
  totalRequests: 0,
  successfulRequests: 0,
  failedRequests: 0,
  totalProcessingTime: 0,
};

function log(level: string, message: string, extra?: Record<string, unknown>) {
  const levels = ['debug', 'info', 'warn', 'error'];
  if (levels.indexOf(level) >= levels.indexOf(CONFIG.logLevel)) {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message,
      ...extra,
    }));
  }
}

function healthResponse() {
  return new Response(JSON.stringify({ status: "ok", version, metrics }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function fetchWithRetry(url: string, options: RequestInit, retries = CONFIG.maxRetries): Promise<Response> {
  try {
    return await fetch(url, options);
  } catch (error) {
    if (retries > 0) {
      log('warn', `Fetch failed, retrying...`, { url, retriesLeft: retries - 1 });
      await new Promise(resolve => setTimeout(resolve, CONFIG.retryDelay));
      return fetchWithRetry(url, options, retries - 1);
    }
    throw error;
  }
}

function rewriteM3U8(content: string, baseUrl: string, proxyUrl: string): string {
  return content.split("\n").map(line => {
    if (line.startsWith("#") || line.trim() === '') return line;
    const fullUrl = new URL(line, baseUrl).href;
    return `${proxyUrl}?url=${encodeURIComponent(fullUrl)}`;
  }).join("\n");
}

async function streamResponse(response: Response): Promise<ReadableStream> {
  const reader = response.body!.getReader();
  return new ReadableStream({
    async start(controller) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        controller.enqueue(value);
      }
      controller.close();
    },
  });
}

async function handleRequest(request: Request): Promise<Response> {
  const startTime = Date.now();
  metrics.totalRequests++;

  try {
    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") {
      return healthResponse();
    }

    const targetUrl = decodeURIComponent(url.searchParams.get("url") || "");
    if (!targetUrl) {
      metrics.failedRequests++;
      return new Response("Invalid URL", { status: 400 });
    }

    log('debug', `Proxying request`, { targetUrl });

    const headers = new Headers(request.headers);
    headers.set("Referer", new URL(targetUrl).origin);

    const response = await fetchWithRetry(targetUrl, { headers });
    
    const contentType = response.headers.get("Content-Type");
    if (contentType?.includes("application/vnd.apple.mpegurl") || targetUrl.endsWith(".m3u8")) {
      const text = await response.text();
      const modifiedM3u8 = rewriteM3U8(text, targetUrl, url.origin);
      
      const acceptEncoding = request.headers.get("accept-encoding") || "";
      let body: Uint8Array | string = modifiedM3u8;
      let responseHeaders = new Headers({
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/vnd.apple.mpegurl",
        "Cache-Control": "no-cache, no-store, must-revalidate",
      });

      if (acceptEncoding.includes("gzip")) {
        body = gzip(new TextEncoder().encode(modifiedM3u8));
        responseHeaders.set("Content-Encoding", "gzip");
      }

      metrics.successfulRequests++;
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    } else {
      // For non-M3U8 files, stream the content
      metrics.successfulRequests++;
      return new Response(await streamResponse(response), {
        status: response.status,
        statusText: response.statusText,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": contentType || "application/octet-stream",
        },
      });
    }
  } catch (e) {
    metrics.failedRequests++;
    log('error', `Error processing request: ${e.message}`, { error: e });
    return new Response("Internal Server Error", { status: 500 });
  } finally {
    const processingTime = Date.now() - startTime;
    metrics.totalProcessingTime += processingTime;
    log('info', `Request processed`, { processingTime });
  }
}

log('info', `Server running on http://localhost:${CONFIG.port}`);
await serve(handleRequest, { port: CONFIG.port });
