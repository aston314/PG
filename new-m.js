import { serve } from "https://deno.land/std@0.215.0/http/server.ts";

// 配置服务器端口
const PORT = 8000;

/**
 * 从请求中获取代理基础URL
 * @param request 请求对象
 * @returns 代理基础URL
 */
function getProxyBaseUrl(request: Request): string {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

/**
 * 解析M3U8内容并替换URL
 * @param content M3U8内容
 * @param baseUrl 原始M3U8的基础URL
 * @param originalUrl 原始M3U8的完整URL
 * @param headers 请求头
 * @param proxyBaseUrl 代理服务器的基础URL
 * @returns 替换后的M3U8内容
 */
function processM3u8Content(
  content: string,
  baseUrl: string,
  originalUrl: string,
  headers: Record<string, string>,
  proxyBaseUrl: string
): string {
  const lines = content.split("\n");
  const processedLines = lines.map((line) => {
    line = line.trim();
    
    // 跳过注释行和空行
    if (line.startsWith("#") || line === "") {
      return line;
    }
    
    // 检查是否是M3U8文件链接(通常是多级M3U8的情况)
    if (line.endsWith(".m3u8") || line.includes(".m3u8?")) {
      const absoluteUrl = new URL(line, baseUrl).toString();
      const encodedUrl = encodeURIComponent(absoluteUrl);
      const encodedHeaders = encodeURIComponent(JSON.stringify(headers));
      return `${proxyBaseUrl}/play?url=${encodedUrl}&headers=${encodedHeaders}`;
    }
    
    // 处理TS分片链接
    if (line.endsWith(".ts") || line.includes(".ts?") || !line.includes(".")) {
      const absoluteUrl = new URL(line, baseUrl).toString();
      const encodedUrl = encodeURIComponent(absoluteUrl);
      const encodedHeaders = encodeURIComponent(JSON.stringify(headers));
      return `${proxyBaseUrl}/segment?url=${encodedUrl}&headers=${encodedHeaders}`;
    }
    
    return line;
  });
  
  return processedLines.join("\n");
}

/**
 * 获取资源的基础URL
 * @param url 完整URL
 * @returns 基础URL，包含路径
 */
function getBaseUrl(url: string): string {
  const parsedUrl = new URL(url);
  const pathParts = parsedUrl.pathname.split("/");
  pathParts.pop(); // 移除文件名
  const pathWithoutFile = pathParts.join("/");
  return `${parsedUrl.protocol}//${parsedUrl.hostname}${parsedUrl.port ? `:${parsedUrl.port}` : ''}${pathWithoutFile}/`;
}

/**
 * 处理HTTP请求
 */
async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const proxyBaseUrl = getProxyBaseUrl(request);
  
  // 健康检查端点
  if (path === "/") {
    return new Response(`M3U8 Proxy Server is running at ${proxyBaseUrl}`, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }
  
  // 处理M3U8请求
  if (path === "/play") {
    const targetUrl = url.searchParams.get("url");
    const headersParam = url.searchParams.get("headers");
    
    if (!targetUrl) {
      return new Response("Missing 'url' parameter", { status: 400 });
    }
    
    try {
      // 解析请求头
      // const headers: Record<string, string> = headersParam 
      //   ? JSON.parse(decodeURIComponent(headersParam)) 
      //   : {};
      let headers: Record<string, string> = {};

      if (headersParam) {
          try {
              // 转换 key，使其符合 JSON 语法
              const jsonCompatibleString = headersParam
                  .replace(/([\w-]+):/g, '"$1":')  // 给 key 加双引号
                  .replace(/,\s*}/g, "}");         // 修复尾部可能的逗号问题
      
              headers = JSON.parse(`{${jsonCompatibleString}}`);
          } catch (error) {
              console.error("Failed to parse headersParam:", error);
              headers = {};
          }
      }
      
      
      // 获取原始M3U8内容
      const response = await fetch(targetUrl, { headers });
      
      
      if (!response.ok) {
        return new Response(`Failed to fetch M3U8: ${response.statusText}`, {
          status: response.status,
        });
      }
      
      const contentType = response.headers.get("Content-Type");
      const content = await response.text();
      
      // 只处理M3U8内容
      if (contentType?.includes("application/vnd.apple.mpegurl") || 
          contentType?.includes("audio/mpegurl") ||
          content.includes("#EXTM3U")) {
        
        const baseUrl = getBaseUrl(targetUrl);
        const processedContent = processM3u8Content(content, baseUrl, targetUrl, headers, proxyBaseUrl);
        
        return new Response(processedContent, {
          status: 200,
          headers: {
            "Content-Type": "application/vnd.apple.mpegurl",
            "Access-Control-Allow-Origin": "*",
          },
        });
      } else {
        // 不是M3U8内容，直接返回
        return new Response(content, {
          status: 200,
          headers: {
            "Content-Type": contentType || "text/plain",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }
    } catch (error) {
      console.error("Error processing M3U8:", error);
      return new Response(`Error: ${error.message}`, { status: 500 });
    }
  }
  
  // 处理分片请求
  if (path === "/segment") {
    const targetUrl = url.searchParams.get("url");
    const headersParam = url.searchParams.get("headers");
    
    if (!targetUrl) {
      return new Response("Missing 'url' parameter", { status: 400 });
    }
    
    try {
      // 解析请求头
      const headers: Record<string, string> = headersParam 
        ? JSON.parse(decodeURIComponent(headersParam)) 
        : {};
      
      // 转发请求到原始服务器
      const response = await fetch(targetUrl, { headers });
      
      if (!response.ok) {
        return new Response(`Failed to fetch segment: ${response.statusText}`, {
          status: response.status,
        });
      }
      
      // 直接返回分片内容
      const contentType = response.headers.get("Content-Type");
      const contentLength = response.headers.get("Content-Length");
      const data = await response.arrayBuffer();
      
      return new Response(data, {
        status: 200,
        headers: {
          "Content-Type": contentType || "video/MP2T",
          "Content-Length": contentLength || String(data.byteLength),
          "Access-Control-Allow-Origin": "*",
        },
      });
    } catch (error) {
      console.error("Error fetching segment:", error);
      return new Response(`Error: ${error.message}`, { status: 500 });
    }
  }
  
  // 404 未找到端点
  return new Response("Not Found", { status: 404 });
}

// 启动服务器
console.log(`Starting M3U8 proxy server on port ${PORT}...`);
serve(handleRequest, { port: PORT });
