import { load } from "https://deno.land/std@0.204.0/dotenv/mod.ts";
import { Status, STATUS_TEXT } from "https://deno.land/std@0.204.0/http/http_status.ts";
import { gunzip } from "https://deno.land/x/compress@v0.4.5/mod.ts";

// Configuration
const config = {
  HOST: "vidsrc.cc",
  PORT: 8000,
  CACHE_DURATION: 60000, // 1 minute in milliseconds
  MAX_CONCURRENT_REQUESTS: 5,
  REQUEST_TIMEOUT: 10000, // 10 seconds
  MAX_RETRIES: 3,
  MAX_CACHE_SIZE: 1000,
  // SUB_BASE_URL: "https://expensive-salmon-48.deno.dev/subs?url=",
  SUBTITLE_LANGUAGES: [
    {"lang":"chi","name":"Simplified","localname" : "简体中文"},
    {"lang":"zht","name":"traditional","localname" : "繁体中文"},
    {"lang":"eng","name":"English","localname" : "English"},
  ],
  OPENSUBTITLES_USER_AGENT: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/84.0.4147.105 Safari/537.36",
  OPENSUBTITLES_XUSER_AGENT: "trailers.to-UA",
  OPENSUBTITLES_AUTHORITY: "rest.opensubtitles.org",
  ENABLE_SUBTITLE_SEARCH: true,
  SUBTITLE_SEARCH_TIMEOUT: 30000, // 30 seconds
  SUBTITLE_SEARCH_CONCURRENCY: 2,
  TMDB_APIKEY: "4ef0d7355d9ffb5151e987764708ce96",
  ENABLE_SUBTITLE_AD_REMOVAL: true,
  ENCRYPTION_KEY: "GXxUGRXb2dDLaZwM",
  //https://raw.githubusercontent.com/ach-raf/opensubtitles_subtitle_downloader/master/library/ads.txt
  AD_RULES: [
    "{\fs14\c&H00FFFF&}www.tvsubtitles.net{\fs\c}",
    "www.tvsubtitles.net",
    "Improved by: @Ivandrofly",
    "elderman == @elder_man",
    "{\c&HFFFF00&}@elder_man{\c}",
    "{\c&HFFFF00&}web dl sync",
    "web dl sync",
    "== {\c&H0000FF&}sync, corrected by",
    "== Sync by",
    "\N==",
    "Advertise your product or brand here",
    "by Beachboy in Rio de Janeiro - ♪♪♪",
    "chamallow - -  -",
    "contact www.OpenSubtitles.org today",
    "explosiveskull www.addic7ed.com",
    "from 3.49 USD/month ----> osdb.link/vpn",
    "Help other users to choose the best subtitles",
    "Support us and become VIP member",
    "to remove all ads",
    "OpenSubtitles recommends using Nord VPN",
    "Synced & corrected by -robtor-",
    "www.addic7ed.com",
    "Subtitles by TVT",
    "Sync by Marocas62",
    "Subtitles by ITV SignPost",
    "Synced and corrected by nkate",
    "Watch Full HD Movies & TV Shows",
    "with Subtitles for Free ---> osdb.link/tv",
    "www.tvsubtitles.net",
    "to remove all ads from OpenSubtitles.org",
    "ITFC Subtitles",
    "PETER BLANCHARD",
    "sync by",
    "OpenSubtitles recommends to be fit",
    "Reshape Weight Loss App: osdb.link/fit",
    "contact www.OpenSubtitles.org today",
    "Subtitles by",
    "MemoryOnSmells",
    "http://",
    "iSubDB.com - fast, modern, simple",
    "Subtitles search by drag & drop",
    "-==",
    "Please rate this subtitle at",
    "Help other users to choose the best subtitles",
    "Synced & corrected by",
    "Sync and corrections by",
    "_ Edited and Re-synced for demand",
    "Synced and corrected by",
    "sync & correction by",
    "~ Addic7ed.com ~",
    "<i> sync & correction by",
    "Sync and corrected by",
    "== sync, corrected by",
    "www.tvsubtitles.net",
    "Sync and corrections by",
    "www.Addic7ed.com",
    "@elder_man",
    "- Synced and corrected by",
    "- www.addic7ed.com",
    "Ripped By mstoll",
    '- <font color="#D81D1D">Synced and corrected by',
    "- Re-sync by",
    '-- <font color="#138CE9">www.Addic7ed',
    "أدعمنا وأصبح عضو مميز",
    "url%للإزالة جميع الإعلانات%",
    "قم بالإعلان هنا عن منتجك أو علامتك التجارية",
    "اليوم www.OpenSubtitles.org تواصل معنا",
    "www.osdb.link/bfnfu رجاء قم بتقييم الترجمة في",
    "ساعد الأخرين لإختيار الترجمة الأفضل",
    "www.1000fr.net presents",
    "Sync:于小坏 小P海儿 宇意@FRS",
    "Join our FRS/FRM",
    "Join our FRS/FRM and have fun!",
    "QQ Group No. 77207643/frzhaopin2@gmail.com",
    "welcome to www.1000fr.net",
    "{\c&H007700&}Synced and corrected by",
    "Captioning by",
    "Captioning by captionmax\Nwww.captionmax.com",
    "www.captionmax.com",
    "-=[ ai.OpenSubtitles.com ]=-",
    "www.osdb.link/lm",
    "Do you want subtitles for any video?",
    "Watch Online Movies and Series for FREE",
    // 可以根据需要添加更多规则
  ]
};

// Load environment variables
const env = await load();
Object.keys(config).forEach(key => {
  if (key === "SUBTITLE_LANGUAGES" && env[key]) {
    try {
      const parsedLanguages = JSON.parse(env[key]);
      if (Array.isArray(parsedLanguages) && parsedLanguages.every(lang => lang.lang && lang.name && lang.localname)) {
        config[key] = parsedLanguages;
      } else {
        console.warn("Invalid SUBTITLE_LANGUAGES format in environment variables. Using default.");
      }
    } catch (error) {
      console.warn("Error parsing SUBTITLE_LANGUAGES from environment variables. Using default.", error);
    }
  } else {
    config[key] = env[key] || config[key];
  }
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

class LimitedSizeCache {
  constructor(maxSize) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  set(key, value, ttl) {
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }
    this.cache.set(key, { value, expiry: Date.now() + ttl });
  }

  get(key) {
    const item = this.cache.get(key);
    if (!item) return null;
    if (Date.now() > item.expiry) {
      this.cache.delete(key);
      return null;
    }
    return item.value;
  }

  has(key) {
    return this.get(key) !== null;
  }
}

const cache = new LimitedSizeCache(config.MAX_CACHE_SIZE);
const subtitleCache = new LimitedSizeCache(config.MAX_CACHE_SIZE);

function createResponse(body, status = Status.OK, headers = {}) {
  const responseHeaders = new Headers({ "Content-Type": "application/json", ...corsHeaders, ...headers });
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

async function fetchWithTimeout(url, options = {}) {
  const { timeout = config.REQUEST_TIMEOUT } = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
}

async function fetchWithRetry(url, retries = config.MAX_RETRIES) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetchWithTimeout(url);
      if (response.ok) return response;
    } catch (err) {
      console.warn(`Attempt ${i + 1} failed: ${err.message}`);
      if (err.name === 'AbortError') break;
    }
    await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
  }
  throw new Error(`Failed to fetch ${url} after ${retries} attempts`);
}

async function fetchJson(url) {
  const response = await fetchWithRetry(url);
  return response.json();
}

function validateParams(params) {
  const { tmdbId, season, episode, isMovie } = params;
  if (!tmdbId || tmdbId.length < 3) {
    throw new Error('Invalid TMDB ID. Must be at least 3 characters long.');
  }
  if (!isMovie) {
    if (season === undefined || episode === undefined) {
      throw new Error('Season and episode are required for TV shows.');
    }
    const seasonNum = parseInt(season, 10);
    if (isNaN(seasonNum) || seasonNum.toString() !== season || seasonNum < 1) {
      throw new Error('Invalid season number. Must be a positive integer.');
    }
    const episodeNum = parseInt(episode, 10);
    if (isNaN(episodeNum) || episodeNum.toString() !== episode || episodeNum < 1) {
      throw new Error('Invalid episode number. Must be a positive integer.');
    }
  }
}

async function fetchWithConcurrencyLimit(urls, fetchFunction, concurrency = config.MAX_CONCURRENT_REQUESTS) {
  const results = [];
  const queue = [...urls];
  const activeRequests = new Set();

  const processQueue = async () => {
    while (queue.length > 0 && activeRequests.size < concurrency) {
      const url = queue.shift();
      activeRequests.add(url);
      const result = await fetchFunction(url);
      results.push(result);
      activeRequests.delete(url);
    }
    if (queue.length > 0) {
      await Promise.race(Array.from(activeRequests).map(url => fetchFunction(url)));
    }
  };

  await processQueue();
  return results;
}

async function subfetch(code, languages, timeout = config.SUBTITLE_SEARCH_TIMEOUT, currentDomain) {
  const cacheKey = `${code}_${languages.map(l => l.lang).join('_')}`;
  const cachedResult = subtitleCache.get(cacheKey);
  if (cachedResult) return cachedResult;

  const fetchSubtitle = async (languageObj) => {
    let imdbId;
    let type;
    let season, episode, seasonEpisode;

    if (code.includes("_")) {
      // [imdbId, season, episode] = code.split("_");
      [imdbId, seasonEpisode] = code.split("_");
      [season, episode] = seasonEpisode.split('x');
      type = 'tv';
    } else {
      imdbId = code;
      type = 'movie';
    }

    // 检查是否已经是 IMDb ID
    if (!imdbId.startsWith('tt')) {
      // 如果不是 IMDb ID，则进行转换
      const convertedId = await convertTMDbToIMDb(imdbId, type);
      if (!convertedId) {
        console.error(`Failed to convert ID ${imdbId} to IMDb ID`);
        return null;
      }
      imdbId = convertedId;
    }

    // 移除 'tt' 前缀
    const cleanImdbId = imdbId.replace(/^tt/, '');

    let url;
    if (type === 'tv') {
      url = `https://rest.opensubtitles.org/search/episode-${episode}/imdbid-${cleanImdbId}/season-${season}/sublanguageid-${languageObj.lang}`;
    } else {
      url = `https://rest.opensubtitles.org/search/imdbid-${cleanImdbId}/sublanguageid-${languageObj.lang}`;
    }

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': config.OPENSUBTITLES_USER_AGENT,
          'X-User-Agent': config.OPENSUBTITLES_XUSER_AGENT,
          'authority': config.OPENSUBTITLES_AUTHORITY
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      
      if (data.length > 0) {
        // const bestSubtitle = data.reduce((prev, current) => (prev.SubDownloadsCnt > current.SubDownloadsCnt) ? prev : current);
        // // console.log(url, data.length, bestSubtitle.SubDownloadLink,bestSubtitle.IDSubtitleFile)
        // return {
        //   label: languageObj.localname + ' [搜自字幕网]',
        //   file: `${config.SUB_BASE_URL}${bestSubtitle.SubDownloadLink}&lang=${languageObj.lang}`
        // };
        let subtitles;
        if (languageObj.lang === 'chi') {
          // For Chinese, take up to 3 subtitles
          subtitles = data.slice(0, 3).map((sub, index) => ({
            label: `${languageObj.localname}${index + 1} - 搜自字幕网`,
            file: `${currentDomain}${sub.SubDownloadLink}&lang=${languageObj.lang}`
          }));
        } else {
          // For other languages, take the best subtitle
          const bestSubtitle = data.reduce((prev, current) => (prev.SubDownloadsCnt > current.SubDownloadsCnt) ? prev : current);
          subtitles = [{
            label: `${languageObj.localname} - 搜自字幕网`,
            // config.SUB_BASE_URL
            file: `${currentDomain}${bestSubtitle.SubDownloadLink}&lang=${languageObj.lang}`
          }];
        }
        console.log(`Found ${subtitles.length} subtitle option(s) for ${imdbId} in ${languageObj.lang}`);
        return subtitles;
      } else {
        console.log(`No subtitles found for ${imdbId} in language ${languageObj.lang}`);
        return null;
      }
    } catch (error) {
      console.error(`Error fetching subtitle for ${imdbId} in ${languageObj.lang}: ${error.message}`);
      return null;
    }
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const subtitlePromises = languages.map(lang => fetchSubtitle(lang));
    const subtitles = await Promise.all(subtitlePromises.map(p => p.catch(e => null)));
    const validSubtitles = subtitles.filter(subtitle => subtitle !== null);

    subtitleCache.set(cacheKey, validSubtitles, config.CACHE_DURATION);
    return validSubtitles;
  } catch (error) {
    if (error.name === 'AbortError') {
      console.error('Subtitle search timed out');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function convertTMDbToIMDb(tmdbId, type) {
  const tmdbApiKey = config.TMDB_APIKEY;
  const url = `https://api.themoviedb.org/3/${type}/${tmdbId}/external_ids?api_key=${tmdbApiKey}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`TMDb API error: ${response.status}`);
    }
    const data = await response.json();
    if (data.imdb_id) {
      return data.imdb_id;
    } else {
      throw new Error('IMDb ID not found for this TMDb ID');
    }
  } catch (error) {
    console.error('Error converting TMDb ID to IMDb ID:', error);
    return null;
  }
}

function encryptString(input, key) {
  const sbox = Array.from({ length: 256 }, (_, i) => i);
  let j = 0;

    // 初始化 S-Box
    for (let i = 0; i < 256; i++) {
      j = (j + sbox[i] + key.charCodeAt(i % key.length)) % 256;
      [sbox[i], sbox[j]] = [sbox[j], sbox[i]];
    }

  let result = '';
  let i = 0;
  j = 0;
  for (let k = 0; k < input.length; k++) {
    i = (i + 1) % 256;
    j = (j + sbox[i]) % 256;
    [sbox[i], sbox[j]] = [sbox[j], sbox[i]];
    const charCode = input.charCodeAt(k) ^ sbox[(sbox[i] + sbox[j]) % 256];
    result += String.fromCharCode(charCode);
  }
  return result;
}

// // 在程序启动时验证配置
// function validateConfig() {
//   if (!Array.isArray(config.SUBTITLE_LANGUAGES) || 
//       !config.SUBTITLE_LANGUAGES.every(lang => lang.lang && lang.name)) {
//     throw new Error("Invalid SUBTITLE_LANGUAGES configuration");
//   }
//   // 可以添加其他配置验证
// }

// // 在主函数开始时调用
// validateConfig();

async function episode(data_id_1, data_id_2, type, s, e, tmdbId, currentDomain) {
  const cacheKey = `${data_id_1}-${data_id_2}-${type}-${s}-${e}`;
  const cachedData = cache.get(cacheKey);
  if (cachedData) {
    console.log('Returning cached data');
    return cachedData;
  }

  const vrfid = encodeURIComponent(encryptString(data_id_1, config.ENCRYPTION_KEY));
  // console.log(vrfid)

  const baseUrl = `https://${config.HOST}/api/episodes/${data_id_2}/servers?id=${data_id_1}&type=${type}&vrf=${vrfid}`;
  const url = type === 'tv' ? `${baseUrl}&season=${s}&episode=${e}` : baseUrl;
// console.log(url)
  const resp = await fetchJson(url);
  
  if (!resp.success || !Array.isArray(resp.data)) {
    throw new Error("Failed to fetch server data or invalid response format");
  }

  const sourceUrls = resp.data.map(server => `https://${config.HOST}/api/source/${server.hash}`);
  const sources = await fetchWithConcurrencyLimit(sourceUrls, async (url) => {
    try {
      const sourceData = await fetchJson(url);
      if (sourceData.success === true && sourceData.data.hasOwnProperty('source')) {
        // Only search for subtitles if the feature is enabled
        if (config.ENABLE_SUBTITLE_SEARCH) {
          let languagesToSearch;
          const existingSubtitles = new Set(sourceData.data.subtitles?.map(sub => sub.label) || []);

          if (existingSubtitles.size === 0) {
            languagesToSearch = config.SUBTITLE_LANGUAGES;
          } else {
            languagesToSearch = config.SUBTITLE_LANGUAGES.filter(lang => 
              !Array.from(existingSubtitles).some(label => label.toLowerCase().includes(lang.name.toLowerCase()))
            );
          }

          if (languagesToSearch.length > 0) {
            try {
              const additionalSubs = await subfetch(
                tmdbId + (type === 'tv' ? `_${s}x${e}` : ''),
                languagesToSearch,
                config.SUBTITLE_SEARCH_TIMEOUT,
                currentDomain
              );
              if (additionalSubs.length > 0) {
                const newSubtitles = additionalSubs.filter(sub => !existingSubtitles.has(sub.label));
                // sourceData.data.subtitles = (sourceData.data.subtitles || []).concat(newSubtitles);
                let flattenedNewSubtitles = newSubtitles.flatMap(subtitles => 
                  Array.isArray(subtitles) ? subtitles : [subtitles]
                );
                sourceData.data.subtitles = flattenedNewSubtitles.concat(sourceData.data.subtitles || []);
                console.log(`Added ${newSubtitles.length} new subtitles for ${tmdbId}`);
              }
            } catch (error) {
              console.error(`Error fetching additional subtitles: ${error.message}`);
              // 继续处理，不中断整个流程
            }
          }
        }
        return {
          name: resp.data.find(server => url.includes(server.hash)).name,
          ...sourceData
        };
      } else {
        console.warn(`Source data retrieval was not successful for ${url}`);
        return null;
      }
    } catch (error) {
      console.error(`Error fetching source data for ${url}:`, error);
      return null;
    }
  }, config.MAX_CONCURRENT_REQUESTS);

  const validSources = sources.filter(source => source !== null);
  const result = { sources: validSources };

  cache.set(cacheKey, result, config.CACHE_DURATION);

  return result;
}

async function getDataIds(url) {
  const text = await (await fetchWithRetry(url)).text();
  const regex = /data-id="(.*?)"/g;
  const matches = [...text.matchAll(regex)].map(match => match[1]);

  if (matches.length < 2) {
    throw new Error("Failed to find two data-id values in response.");
  }

  return matches.slice(0, 2);
}

async function getvmovie(id, currentDomain) {
  const [data_id_1, data_id_2] = await getDataIds(`https://${config.HOST}/v2/embed/movie/${id}`);
  return episode(data_id_1, data_id_2, 'movie', null, null, id, currentDomain);
}

async function getvserie(id, s, e, currentDomain) {
  const [data_id_1, data_id_2] = await getDataIds(`https://${config.HOST}/v2/embed/tv/${id}/${s}/${e}`);
  return episode(data_id_1, data_id_2, 'tv', s, e, id, currentDomain);
}

// async function handleSubtitleDownload(url) {
//   try {
//     const response = await fetch(url);
//     if (!response.ok) {
//       throw new Error(`HTTP error! status: ${response.status}`);
//     }

//     const arrayBuffer = await response.arrayBuffer();
//     const uint8Array = new Uint8Array(arrayBuffer);

//     // Attempt to gunzip the content
//     let decompressedContent;
//     try {
//       decompressedContent = await gunzip(uint8Array);
//     } catch (gzipError) {
//       console.warn("Content is not gzipped, using raw content:", gzipError);
//       decompressedContent = uint8Array;
//     }

//     // Decode the content as UTF-8
//     let subtitleContent;
//     try {
//       subtitleContent = new TextDecoder("utf-8").decode(decompressedContent);
//     } catch (decodeError) {
//       console.error("Error decoding content as UTF-8:", decodeError);
//       throw new Error("Failed to decode subtitle content");
//     }

//     // Create a ReadableStream to mimic Python's generator
//     const stream = new ReadableStream({
//       start(controller) {
//         controller.enqueue(new TextEncoder().encode(subtitleContent));
//         controller.close();
//       }
//     });

//     return new Response(stream, {
//       headers: {
//         "Content-Type": "application/octet-stream",
//         "Content-Disposition": "attachment; filename=subtitle.srt"
//       }
//     });
//   } catch (error) {
//     console.error(`Error fetching subtitle: ${error.message}`);
//     return new Response(JSON.stringify({ error: "Error fetching subtitle" }), {
//       status: 500,
//       headers: { "Content-Type": "application/json" }
//     });
//   }
// }

// async function handleSubtitleDownload(url) {
//   try {
//     const response = await fetch(url);
//     if (!response.ok) {
//       throw new Error(`HTTP error! status: ${response.status}`);
//     }

//     const contentType = response.headers.get("Content-Type");
//     const contentLength = response.headers.get("Content-Length");

//     // 如果文件太大，使用流式处理
//     if (contentLength && parseInt(contentLength) > 1024 * 1024) {
//       return new Response(response.body, {
//         headers: {
//           "Content-Type": "application/octet-stream",
//           "Content-Disposition": "attachment; filename=subtitle.srt"
//         }
//       });
//     }

//     const arrayBuffer = await response.arrayBuffer();
//     const uint8Array = new Uint8Array(arrayBuffer);

//     // 尝试解压缩内容
//     let decompressedContent;
//     try {
//       decompressedContent = await gunzip(uint8Array);
//     } catch (gzipError) {
//       console.warn("Content is not gzipped, using raw content:", gzipError);
//       decompressedContent = uint8Array;
//     }

//     // 尝试检测编码
//     let encoding = "utf-8";
//     if (decompressedContent[0] === 0xFF && decompressedContent[1] === 0xFE) {
//       encoding = "utf-16le";
//     } else if (decompressedContent[0] === 0xFE && decompressedContent[1] === 0xFF) {
//       encoding = "utf-16be";
//     }

//     // 解码内容
//     let subtitleContent;
//     try {
//       subtitleContent = new TextDecoder(encoding).decode(decompressedContent);
//     } catch (decodeError) {
//       console.error(`Error decoding content as ${encoding}:`, decodeError);
//       throw new Error("Failed to decode subtitle content");
//     }

//     // 检测字幕格式
//     let fileExtension = "srt";
//     if (subtitleContent.includes("WEBVTT")) {
//       fileExtension = "vtt";
//     }

//     // 创建 ReadableStream
//     const stream = new ReadableStream({
//       start(controller) {
//         controller.enqueue(new TextEncoder().encode(subtitleContent));
//         controller.close();
//       }
//     });

//     return new Response(stream, {
//       headers: {
//         "Content-Type": "application/octet-stream",
//         "Content-Disposition": `attachment; filename=subtitle.${fileExtension}`
//       }
//     });
//   } catch (error) {
//     console.error(`Error fetching subtitle: ${error.message}`);
//     return new Response(JSON.stringify({ error: error.message }), {
//       status: 500,
//       headers: { "Content-Type": "application/json" }
//     });
//   }
// }

// async function handleSubtitleDownload(url) {
//   try {
//     const response = await fetch(url);
//     if (!response.ok) {
//       throw new Error(`HTTP error! status: ${response.status}`);
//     }

//     const arrayBuffer = await response.arrayBuffer();
//     let uint8Array = new Uint8Array(arrayBuffer);

//     // Attempt to gunzip the content
//     try {
//       uint8Array = await gunzip(uint8Array);
//     } catch (gzipError) {
//       console.warn("Content is not gzipped, using raw content");
//     }

//     // Try different encodings
//     const encodings = ['utf-8', 'gb18030', 'big5', 'shift-jis'];
//     let subtitleContent = null;
//     let detectedEncoding = null;

//     for (const encoding of encodings) {
//       try {
//         const decoder = new TextDecoder(encoding);
//         subtitleContent = decoder.decode(uint8Array);
        
//         // Check if the decoded content looks valid
//         if (subtitleContent.includes('你') || subtitleContent.includes('我') || 
//             subtitleContent.match(/^\d+:\d+:\d+/m)) {
//           detectedEncoding = encoding;
//           break;
//         }
//       } catch (decodeError) {
//         console.warn(`Failed to decode with ${encoding}:`, decodeError);
//       }
//     }

//     if (!subtitleContent) {
//       throw new Error("Failed to decode subtitle content with any known encoding");
//     }

//     console.log(`Detected encoding: ${detectedEncoding}`);

//     // Determine subtitle format
//     let fileExtension = "srt";
//     if (subtitleContent.includes("WEBVTT")) {
//       fileExtension = "vtt";
//     }

//     // Create a ReadableStream
//     const stream = new ReadableStream({
//       start(controller) {
//         controller.enqueue(new TextEncoder().encode(subtitleContent));
//         controller.close();
//       }
//     });

//     return new Response(stream, {
//       headers: {
//         "Content-Type": "application/octet-stream",
//         "Content-Disposition": `attachment; filename=subtitle.${fileExtension}`,
//         "X-Detected-Encoding": detectedEncoding
//       }
//     });
//   } catch (error) {
//     console.error(`Error handling subtitle download: ${error.message}`);
//     return new Response(JSON.stringify({ error: error.message }), {
//       status: 500,
//       headers: { "Content-Type": "application/json" }
//     });
//   }
// }

// 更新去广告函数
function removeAdsFromSubtitle(content) {
  // 清理空字符串规则
  const validRules = config.AD_RULES.filter(rule => rule.trim() !== '');

  // 创建基于每个广告开头的动态正则表达式
  const regexList = validRules.map(rule => {
    const escapedRule = rule.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return `(^${escapedRule}.*$)`;
  });

  // 合并所有正则表达式
  const joinedRegex = regexList.join('|');

  // 使用正则表达式删除广告内容
  const cleanedContent = content.replace(new RegExp(joinedRegex, 'gm'), '');

  // 删除可能产生的连续空行
  return cleanedContent.replace(/\n{3,}/g, '\n\n');
}

function isChineseChar(char) {
  const code = char.charCodeAt(0);
  return (code >= 0x4E00 && code <= 0x9FFF) || 
         (code >= 0x3400 && code <= 0x4DBF) || 
         (code >= 0x20000 && code <= 0x2A6DF) || 
         (code >= 0x2A700 && code <= 0x2B73F) || 
         (code >= 0x2B740 && code <= 0x2B81F) || 
         (code >= 0x2B820 && code <= 0x2CEAF);
}

function calculateChineseRatio(text) {
  const characters = text.split('');
  const chineseCount = characters.filter(isChineseChar).length;
  return chineseCount / characters.length;
}

async function handleSubtitleDisplay(url, language) {
  if (['chi', 'zht', 'zhe'].includes(language)) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      let uint8Array = new Uint8Array(arrayBuffer);

      // Attempt to gunzip the content
      try {
        uint8Array = await gunzip(uint8Array);
      } catch (gzipError) {
        console.warn("Content is not gzipped, using raw content");
      }

      // Try different encodings
      const encodings = [
        'utf-8', 'gb18030', 'big5', 'gbk', 'gb2312', 'hz-gb-2312', 'euc-cn',
        'iso-2022-cn', 'shift-jis', 'euc-jp', 'iso-2022-jp'
      ];
      let subtitleContent = null;
      let detectedEncoding = null;
      let bestChineseRatio = 0;

      for (const encoding of encodings) {
        try {
          const decoder = new TextDecoder(encoding, { fatal: true });
          const decodedContent = decoder.decode(uint8Array);
          
          const chineseRatio = calculateChineseRatio(decodedContent);
          if (chineseRatio > bestChineseRatio) {
            subtitleContent = decodedContent;
            detectedEncoding = encoding;
            bestChineseRatio = chineseRatio;
          }

          // If we find a very good match, we can stop searching
          if (chineseRatio > 0.3) {
            break;
          }
        } catch (decodeError) {
          console.warn(`Failed to decode with ${encoding}:`, decodeError);
        }
      }

      if (config.ENABLE_SUBTITLE_AD_REMOVAL) {
        subtitleContent = removeAdsFromSubtitle(subtitleContent);
      }

      if (!subtitleContent) {
        throw new Error("Failed to decode subtitle content with any known encoding");
      }

      console.log(`Detected encoding: ${detectedEncoding}, Chinese character ratio: ${bestChineseRatio}`);

      // Determine subtitle format and set appropriate Content-Type
      let contentType = "text/plain";
      if (subtitleContent.includes("WEBVTT")) {
        contentType = "text/vtt";
      } else if (subtitleContent.trim().startsWith("1")) {
        contentType = "application/x-subrip";
      }

      return new Response(subtitleContent, {
        headers: {
          "Content-Type": contentType,
          "X-Detected-Encoding": detectedEncoding
        }
      });
    } catch (error) {
      console.error(`Error handling subtitle display: ${error.message}`);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
  } else {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);

      // Attempt to gunzip the content
      let decompressedContent;
      try {
        decompressedContent = await gunzip(uint8Array);
      } catch (gzipError) {
        console.warn("Content is not gzipped, using raw content:", gzipError);
        decompressedContent = uint8Array;
      }

      // Decode the content as UTF-8
      let subtitleContent;
      try {
        subtitleContent = new TextDecoder("utf-8").decode(decompressedContent);
      } catch (decodeError) {
        console.error("Error decoding content as UTF-8:", decodeError);
        throw new Error("Failed to decode subtitle content");
      }

      if (config.ENABLE_SUBTITLE_AD_REMOVAL) {
        subtitleContent = removeAdsFromSubtitle(subtitleContent);
      }

      // Determine subtitle format and set appropriate Content-Type
      let contentType = "text/plain";
      if (subtitleContent.includes("WEBVTT")) {
        contentType = "text/vtt";
      } else if (subtitleContent.trim().startsWith("1")) {
        contentType = "application/x-subrip";
      }

      return new Response(subtitleContent, {
        headers: {
          "Content-Type": contentType
        }
      });
    } catch (error) {
      console.error(`Error fetching subtitle: ${error.message}`);
      return new Response(JSON.stringify({ error: "Error fetching subtitle" }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
  }
}

async function handleSubtitleDownload(url, language) {
  if (['chi', 'zht', 'zhe'].includes(language)) {
try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    let uint8Array = new Uint8Array(arrayBuffer);

    // Attempt to gunzip the content
    try {
      uint8Array = await gunzip(uint8Array);
    } catch (gzipError) {
      console.warn("Content is not gzipped, using raw content");
    }

    // Try different encodings
    const encodings = [
      'utf-8', 'gb18030', 'big5', 'gbk', 'gb2312', 'hz-gb-2312', 'euc-cn',
      'iso-2022-cn', 'shift-jis', 'euc-jp', 'iso-2022-jp'
    ];
    let subtitleContent = null;
    let detectedEncoding = null;
    let bestChineseRatio = 0;

    for (const encoding of encodings) {
      try {
        const decoder = new TextDecoder(encoding, { fatal: true });
        const decodedContent = decoder.decode(uint8Array);
        
        const chineseRatio = calculateChineseRatio(decodedContent);
        if (chineseRatio > bestChineseRatio) {
          subtitleContent = decodedContent;
          detectedEncoding = encoding;
          bestChineseRatio = chineseRatio;
        }

        // If we find a very good match, we can stop searching
        if (chineseRatio > 0.3) {
          break;
        }
      } catch (decodeError) {
        console.warn(`Failed to decode with ${encoding}:`, decodeError);
      }
    }

    if (config.ENABLE_SUBTITLE_AD_REMOVAL) {
      subtitleContent = removeAdsFromSubtitle(subtitleContent);
    }

    if (!subtitleContent) {
      throw new Error("Failed to decode subtitle content with any known encoding");
    }

    console.log(`Detected encoding: ${detectedEncoding}, Chinese character ratio: ${bestChineseRatio}`);

    // Determine subtitle format
    let fileExtension = "srt";
    if (subtitleContent.includes("WEBVTT")) {
      fileExtension = "vtt";
    }

    // Create a ReadableStream
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(subtitleContent));
        controller.close();
      }
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename=subtitle.${fileExtension}`,
        "X-Detected-Encoding": detectedEncoding
      }
    });
  } catch (error) {
    console.error(`Error handling subtitle download: ${error.message}`);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
  } else {
try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    // Attempt to gunzip the content
    let decompressedContent;
    try {
      decompressedContent = await gunzip(uint8Array);
    } catch (gzipError) {
      console.warn("Content is not gzipped, using raw content:", gzipError);
      decompressedContent = uint8Array;
    }

    // Decode the content as UTF-8
    let subtitleContent;
    try {
      subtitleContent = new TextDecoder("utf-8").decode(decompressedContent);
    } catch (decodeError) {
      console.error("Error decoding content as UTF-8:", decodeError);
      throw new Error("Failed to decode subtitle content");
    }

    if (config.ENABLE_SUBTITLE_AD_REMOVAL) {
          subtitleContent = removeAdsFromSubtitle(subtitleContent);
    }

    // Create a ReadableStream to mimic Python's generator
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(subtitleContent));
        controller.close();
      }
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": "attachment; filename=subtitle.srt"
      }
    });
  } catch (error) {
    console.error(`Error fetching subtitle: ${error.message}`);
    return new Response(JSON.stringify({ error: "Error fetching subtitle" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
  }
  
}

async function handleRequest(request) {
  const url = new URL(request.url);
  const path = url.pathname;
  const params = url.searchParams;

  const currentDomain = `${url.protocol}//${url.hostname}${url.port ? ':' + url.port : ''}/subs?url=`;
  // console.log(currentDomain)
  
  if (request.method === "OPTIONS") {
    return new Response(null, { status: Status.NoContent, headers: corsHeaders });
  }

  if (path === "/") {
    return createResponse({
      intro: "Welcome to the unofficial vidsrc provider: check the provider website @ https://vidsrc.cc/ ",
      routes: {
        movie: "/vidsrc/:movieTMDBid",
        show: "/vidsrc/:showTMDBid?s=seasonNumber&e=episodeNumber",
        subtitle: "/subs?url=subtitleUrl"
      },
      author: "This api is developed and created by Inside4ndroid Studios"
    });
  }

  // if (path === "/health") {
  //   return createResponse({ status: "healthy" });
  // }
  if (path === "/health") {
    try {
      const healthCheckUrl = "https://vidsrc.cc/api/episodes/5234726/servers?id=94997&type=tv&season=2&episode=5&v=RmFzdCBYXzIwMjM=&isMobile=false&vrf=" + encodeURIComponent(encryptString("94997", "GXxUGRXb2dDLaZwM"));
      console.log(healthCheckUrl)
      const response = await fetchJson(healthCheckUrl);
      
      if (response.success === false && Array.isArray(response.data) && response.data.length === 0) {
        return createResponse({ status: "not healthy" });
      } else {
        return createResponse({ status: "healthy" });
      }
    } catch (error) {
      console.error("Health check failed:", error);
      return createResponse({ status: "not healthy", error: error.message }, Status.InternalServerError);
    }
  }

  // if (path === "/subs") {
  //   const subtitleUrl = params.get("url");
  //   if (!subtitleUrl) {
  //     return createResponse({ error: "Missing subtitle URL" }, Status.BadRequest);
  //   }
  //   return handleSubtitleDownload(subtitleUrl);
  // }

  if (path === "/subs") {
  const subtitleUrl = params.get("url");
  const language = params.get("lang") || "eng"; // 默认为英语
  if (!subtitleUrl) {
    return createResponse({ error: "Missing subtitle URL" }, Status.BadRequest);
  }
  //handleSubtitleDownload
  return handleSubtitleDisplay(subtitleUrl, language);
}

  if (path.startsWith("/vidsrc/")) {
    const tmdbId = path.split("/")[2];
    const season = params.get("s");
    const episode = params.get("e");
    const isMovie = !season && !episode;

    try {
      validateParams({ tmdbId, season, episode, isMovie });
      const vidsrcresponse = isMovie
        ? await getvmovie(tmdbId, currentDomain)
        : await getvserie(tmdbId, season, episode, currentDomain);
      return createResponse(vidsrcresponse);
    } catch (error) {
      console.error('Error fetching data:', error);
      return createResponse({ error: error.message }, Status.BadRequest);
    }
  }

  return createResponse({ error: STATUS_TEXT.get(Status.NotFound) }, Status.NotFound);
}

console.log(`Server running on http://localhost:${config.PORT}`);
Deno.serve({ port: config.PORT }, handleRequest);
