import { serve } from "https://deno.land/std@0.140.0/http/server.ts";

const version = "1.4.0";

const CONFIG = {
  logLevel: 'debug',
  maxRetries: 3,
  retryDelay: 1000, // ms
};

function log(level: string, message: string, extra: Record<string, unknown> = {}) {
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

async function fetchWithRetry(url: string, options: RequestInit, retries = CONFIG.maxRetries): Promise<Response> {
  try {
    const response = await fetch(url, options);
    if (response.redirected) {
      return await fetch(response.url, options);
    }
    return response;
  } catch (error) {
    if (retries > 0) {
      log('warn', `Fetch failed, retrying...`, { url, retriesLeft: retries - 1 });
      await new Promise(resolve => setTimeout(resolve, CONFIG.retryDelay));
      return fetchWithRetry(url, options, retries - 1);
    }
    throw error;
  }
}

function rewriteM3U8Line(line: string, proxyUrl: string, baseUrl: string): string {
  if (line.startsWith("#") || line.trim() === '') return line;

  try {
    let fullUrl: string;
    if (line.startsWith("http://") || line.startsWith("https://")) {
      fullUrl = line;
    } else if (line.startsWith("/")) {
      fullUrl = new URL(line, new URL(baseUrl).origin).href;
    } else {
      fullUrl = new URL(line, baseUrl).href;
    }
    return `${proxyUrl}?url=${encodeURIComponent(fullUrl)}`;
  } catch (error) {
    log('error', "Error processing URL:", { line, error: (error as Error).toString() });
    return line;
  }
}

function getContentType(url: string): string {
  if (url.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl';
  if (url.endsWith('.ts')) return 'video/MP2T';
  return 'application/octet-stream';
}

async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const targetUrl = decodeURIComponent(url.searchParams.get("url") || "");

  if (!targetUrl) {
    return new Response("Invalid URL", { status: 400 });
  }

  log('debug', `Proxying request`, { targetUrl });

  const proxyRequest = new Request(targetUrl, {
    method: request.method,
    headers: new Headers(request.headers),
    body: request.body,
  });

  proxyRequest.headers.delete('Origin');
  proxyRequest.headers.delete('Referer');

  try {
    const response = await fetchWithRetry(proxyRequest);
    const contentType = getContentType(targetUrl);

    if (contentType === 'application/vnd.apple.mpegurl') {
      const { readable, writable } = new TransformStream();
      
      const baseUrl = new URL(targetUrl).href.split('/').slice(0, -1).join('/') + '/';
      const proxyUrlBase = `${url.origin}${url.pathname}`;

      fetchWithRetry(proxyRequest).then(async response => {
        const reader = response.body!.getReader();
        const encoder = new TextEncoder();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop()!; // 保留不完整的最后一行

          for (const line of lines) {
            const processedLine = rewriteM3U8Line(line, proxyUrlBase, baseUrl);
            const writer = writable.getWriter();
            await writer.write(encoder.encode(processedLine + '\n'));
            writer.releaseLock();
          }
        }

        if (buffer) {
          const processedLine = rewriteM3U8Line(buffer, proxyUrlBase, baseUrl);
          const writer = writable.getWriter();
          await writer.write(encoder.encode(processedLine));
          writer.releaseLock();
        }

        writable.getWriter().close();
      }).catch(error => {
        log('error', 'Error in stream processing:', { error: (error as Error).toString() });
        writable.abort(error);
      });

      return new Response(readable, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Range",
          "Access-Control-Expose-Headers": "Content-Length, Content-Range",
        },
      });
    } else {
      const newHeaders = new Headers(response.headers);
      newHeaders.set("Content-Type", contentType);
      newHeaders.set("Access-Control-Allow-Origin", "*");
      newHeaders.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
      newHeaders.set("Access-Control-Allow-Headers", "Content-Type, Range");
      newHeaders.set("Access-Control-Expose-Headers", "Content-Length, Content-Range");

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
      });
    }
  } catch (error) {
    log('error', `Proxy request failed`, { error: (error as Error).toString() });
    return new Response("Internal Server Error", { status: 500 });
  }
}

serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Range",
        "Access-Control-Max-Age": "86400",
      },
    });
  }
  return handleRequest(request);
});

console.log(`HTTP webserver running. Access it at: http://localhost:8000/`);
