async function handle(request, connInfo) {
    const corsHeaders = {
      headers: {
        "Access-Control-Allow-Origin": "*",
      },
    };
    const corsOptionsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
      "Access-Control-Max-Age": "86400",
    };

    async function handleRequest(request, connInfo) {
      const url = new URL(request.url);
      let api_pos = url.origin.length + 1;
      let api = url.href.substring(api_pos);
      let ip = "no";
      let redirect = request.method === "POST" ? "manual" : "follow";
      let get_cookie = false;
      let params = [];
      let cdn_info = "cdn_c8Bc9aMo";

      if (api === "headers") {
        let body = "";
        request.headers.forEach((value, key) => body += key + " = " + value + "\n");
        if (connInfo && connInfo.remoteAddr) {
          body += "connInfo" + " = " + JSON.stringify(connInfo.remoteAddr) + "\n";
        }
        body += "request_url" + " = " + request.url + "\n";
        body += "apn_version = 1.06\n";
        return new Response(body, corsHeaders);
      }

      if (api.startsWith("?")) {
        api_pos += 1;
        api = api.substring(1);
      }

      let next_param = true;
      while (next_param) {
        if (api.startsWith("ip")) {
          let pos = api.indexOf("/");
          if (pos !== -1) {
            ip = api.substring(2, pos);
            api_pos += pos + 1;
            api = api.substring(pos + 1);
          } else {
            ip = api.substring(2);
            api_pos += api.length;
            api = "";
          }
        } else if (api.startsWith("redirect=")) {
          let pos = api.indexOf("/");
          if (pos !== -1) {
            redirect = api.substring(9, pos);
            api_pos += pos + 1;
            api = api.substring(pos + 1);
          } else {
            redirect = api.substring(9);
            api_pos += api.length;
            api = "";
          }
        } else if (api.startsWith("get_cookie/")) {
          get_cookie = true;
          api_pos += 11;
          api = api.substring(11);
        } else if (api.startsWith("param?") || api.startsWith("param/")) {
          api_pos += 6;
          api = api.substring(6);
          let param;
          let pos = api.indexOf("/");
          if (pos !== -1) {
            param = api.substring(0, pos);
            api_pos += pos + 1;
            api = api.substring(pos + 1);
          } else {
            param = api.substring(0);
            api_pos += api.length;
            api = "";
          }
          params.push(param.split("="));
        } else {
          next_param = false;
        }
      }

      let proxy = url.href.substring(0, api_pos);

      let forwarded_proto = request.headers.get("X-Forwarded-Proto");
      if (forwarded_proto) forwarded_proto = forwarded_proto.split(",")[0].trim();
      if (forwarded_proto === "https") proxy = proxy.replace('http://', 'https://');

      if (!ip) {
        let forwarded_for = request.headers.get("X-Forwarded-For");
        if (forwarded_for) ip = forwarded_for.split(",").map(s=>s.trim()).find(s=>s && !s.match(/^(127\.|10\.|172\.1[6-9]|172\.2[0-9]|172\.3[01]|192\.168\.)/)) || "";
      }
      if (!ip) ip = request.headers.get("cf-connecting-ip");
      if (!ip) ip = request.headers.get("X-Real-IP");
      if (!ip) ip = connInfo && connInfo.remoteAddr && connInfo.remoteAddr.hostname || "";

      if (!api || !/^https?:\/\/[^\/]/.test(api)) {
        let error = "Malformed URL";
        return new Response(error + ": " + api, {
          ...corsHeaders,
          status: 404,
          statusText: error,
        });
      }
      const apiUrl = new URL(api);
      let apiBase = apiUrl.href.substring(0, apiUrl.href.lastIndexOf("/") + 1);

      // Rewrite request to point to API URL. This also makes the request mutable
      // so you can add the correct Origin header to make the API server think
      // that this request is not cross-site.
      request = new Request(api, request);

      let cdn_loop = request.headers.get("CDN-Loop");
      if (cdn_loop && cdn_loop.indexOf(cdn_info) !== -1) {
        let error = "CDN-Loop detected";
        return new Response(error, {
          ...corsHeaders,
          status: 403,
          statusText: error,
        });
      } else {
        request.headers.append("CDN-Loop", cdn_info);
      }

      request.headers.set("Origin", apiUrl.origin);
      request.headers.set("Referer", apiUrl.origin + "/");
      if (true) {
        request.headers.delete("Sec-Fetch-Dest");
        request.headers.delete("Sec-Fetch-Mode");
        request.headers.delete("Sec-Fetch-Site");
        request.headers.delete("Sec-Fetch-User");
        request.headers.delete("Sec-CH-UA");
        request.headers.delete("Sec-CH-UA-Mobile");
        request.headers.delete("Sec-CH-UA-Platform");
        request.headers.delete("Host");
      }
      if (true) {
        request.headers.delete("X-Forwarded-For");
        request.headers.delete("X-Forwarded-Proto");
        //request.headers.delete("X-Real-IP");
        //request.headers.delete("cf-connecting-ip");
        request.headers.delete("cf-ipcountry");
        request.headers.delete("cf-ray");
        request.headers.delete("cf-visitor");
      }
      if (ip && ip !== "no") {
        request.headers.set("X-Forwarded-For", ip);
        request.headers.set("X-Forwarded-Proto", "https");
        request.headers.set("X-Real-IP", ip);
        request.headers.set("cf-connecting-ip", ip);
      }
      if (apiUrl.hostname === "rezka.ag" || apiUrl.hostname === "hdrezka.ag" || apiUrl.hostname === "hdrezka.me" || apiUrl.hostname === "hdrezka.sh" || apiUrl.hostname === "hdrezka.cm" || apiUrl.hostname === "hdrezka.kim" || apiUrl.hostname === "hdrezka.la" || apiUrl.hostname === "rezka.pub" || apiUrl.hostname === "kinopub.me") {
        request.headers.set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36");
      }
      if (apiUrl.hostname.endsWith(".svetacdn.in")) {
        request.headers.set("Origin", "https://videocdn.tv");
        request.headers.set("Referer", "https://videocdn.tv/");
      }
      if (apiUrl.hostname.endsWith("cdnmovies-stream.online") || apiUrl.hostname.endsWith("cdnmovies-hls-stream.online") || apiUrl.hostname.endsWith(".sarnage.cc")) {
        request.headers.set("Origin", "https://cdnmovies.net");
        request.headers.set("Referer", "https://cdnmovies.net/");
      }
      if (apiUrl.hostname.endsWith(".bazon.site")) {
        request.headers.set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36");
        request.headers.set("Origin", "https://bazon.cc");
        request.headers.set("Referer", "https://bazon.cc/");
      }
      if (["kodikapi.com", "kodik.biz", "kodik.info"].indexOf(apiUrl.hostname) !== -1) {
        request.headers.delete("Origin");
        request.headers.delete("Referer");
      }
      if (apiUrl.hostname === "kinoplay.site" || apiUrl.hostname === "kinoplay1.site" || apiUrl.hostname === "kinoplay2.site") {
        request.headers.set("Cookie", "invite=a246a3f46c82fe439a45c3dbbbb24ad5");
      }
      if (apiUrl.pathname.endsWith(".m3u8") || apiUrl.pathname.endsWith(".m3u") || apiUrl.pathname.endsWith(".M3U8") || apiUrl.pathname.endsWith(".M3U")) {
        request.headers.delete("Range");
      }
      params.forEach(param => {
        if (param[0]) {
          if (param[1]) {
            request.headers.set(decodeURIComponent(param[0]), decodeURIComponent(param[1] || ""));
          } else {
            request.headers.delete(decodeURIComponent(param[0]));
          }
        }
      });
      let response = await fetch(request, {
        redirect: redirect,
      });

      // Recreate the response so you can modify the headers
      response = new Response(response.body, response);

      // Set CORS headers
      response.headers.set("Access-Control-Allow-Origin", "*");

      // Append to/Add Vary header so browser will cache response correctly
      response.headers.append("Vary", "Origin");

      if (response.status >= 200 && response.status < 300) {
        if (get_cookie) {
          let json = {};
          json.cookie = response.headers.getSetCookie();
          return new Response(JSON.stringify(json), {
            headers: {
              "Access-Control-Allow-Origin": "*",
              "Vary": "Origin",
              "Content-Type": "application/json; charset=utf-8",
            },
          });
        }
        let ctype = (response.headers.get("Content-Type") || '').toLowerCase();
        let url = new URL(request.url);
        if (["application/x-mpegurl", "application/vnd.apple.mpegurl"].indexOf(ctype) !== -1 || 
            url.pathname.toLowerCase().endsWith('.m3u8')) {
          let body = edit_m3u8(await response.text(), proxy, apiUrl, apiBase);
          response.headers.set("Content-Type", "application/vnd.apple.mpegurl");
          response.headers.delete("Content-Length");
          response.headers.delete("Content-Range");
          response.headers.set("Accept-Ranges", "none");
          return new Response(body, response);
        }
      }

      // Fix redirect URL
      if (response.status >= 300 && response.status < 400) {
        let target = response.headers.get("Location");
        if (target) {
          response.headers.set("Location", fixLink(target, proxy, apiUrl, apiBase));
        }
      }

      return response;
    }

    function fixLink(link, proxy, url, base) {
      if (!link) return link;
      if (link.includes('_v16')) {
        link = link.replace('https://', 'https://up.vid124.site/');
      }
      try {
        // 尝试作为完整URL解析
        new URL(link);
        // 如果成功，说明是绝对URL
        return proxy + link;
      } catch {
        // 如果失败，说明可能是相对URL
        if (link.startsWith("//")) return proxy + url.protocol + link;
        if (link.startsWith("/")) return proxy + url.origin + link;
        if (link.startsWith("?")) return proxy + url.origin + url.pathname + link;
        if (link.startsWith("#")) return proxy + url.origin + url.pathname + url.search + link;
        // 处理相对路径
        return proxy + new URL(link, base).href;
      }
    }

    function edit_m3u8(m3u8, proxy, url, apiBase) {
      try {
        let lines = m3u8.split("\n");
        let output = [];
        let hasExtm3u = false;

        for (let line of lines) {
          line = line.trim();
          if (line.startsWith("#EXTM3U")) {
            hasExtm3u = true;
            output.push(line);
          } else if (line.startsWith("#EXT")) {
            output.push(line.replace(/\b(URI|URL)="([^"]*)"/g, (match, attr, link) => {
              return `${attr}="${fixLink(link.trim(), proxy, url, apiBase)}"`;
            }));
          } else if (line && !line.startsWith("#")) {
            output.push(fixLink(line, proxy, url, apiBase));
          } else {
            output.push(line);
          }
        }

        if (!hasExtm3u) {
          output.unshift("#EXTM3U");
        }

        return output.join("\n");
      } catch (err) {
        console.error("Error processing m3u8:", err);
        return m3u8;
      }
    }

    async function handleOptions(request, connInfo) {
      if (
        request.headers.get("Origin") !== null &&
        request.headers.get("Access-Control-Request-Method") !== null &&
        request.headers.get("Access-Control-Request-Headers") !== null
      ) {
        // Handle CORS preflight requests.
        return new Response(null, {
          headers: {
            ...corsOptionsHeaders,
            "Access-Control-Allow-Headers": request.headers.get(
              "Access-Control-Request-Headers"
            ),
          },
        });
      } else {
        // Handle standard OPTIONS request.
        return new Response(null, {
          headers: {
            Allow: "GET, HEAD, POST, OPTIONS",
          },
        });
      }
    }

    try {
      if (request.method === "OPTIONS") {
        // Handle CORS preflight requests
        return await handleOptions(request, connInfo);
      } else if (
        request.method === "GET" ||
        request.method === "HEAD" ||
        request.method === "POST"
      ) {
        // Handle requests to the API server
        return await handleRequest(request, connInfo);
      } else {
        let error = "Method Not Allowed";
        return new Response(error + ": " + request.method, {
          ...corsHeaders,
          status: 405,
          statusText: error,
        });
      }
    } catch (err) {
      let error = "Internal Server Error";
      return new Response(error + ": " + err + "\n" + (err.stack || ""), {
          ...corsHeaders,
        status: 500,
        statusText: error,
      });
    }
}

const port = parseInt(Deno.env.get("PORT") || "8000");
Deno.serve({port: port}, handle);
