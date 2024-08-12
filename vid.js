import { load } from "https://deno.land/std@0.204.0/dotenv/mod.ts";
import { Status, STATUS_TEXT } from "https://deno.land/std@0.204.0/http/http_status.ts";

// Configuration
const config = {
  HOST: "vidsrc.cc",
  PORT: 8000,
  CACHE_DURATION: 60000, // 1 minute in milliseconds
  MAX_CONCURRENT_REQUESTS: 5,
  REQUEST_TIMEOUT: 10000, // 10 seconds
  MAX_RETRIES: 3,
  MAX_CACHE_SIZE: 1000,
};

// Load environment variables
const env = await load();
Object.keys(config).forEach(key => {
  config[key] = env[key] || config[key];
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
  //|| !tmdbId.startsWith('tt') 
  if (!tmdbId || tmdbId.length < 3) {
    throw new Error('Invalid TMDB ID. Must start with "tt" followed by numbers.');
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

async function fetchWithConcurrencyLimit(urls, fetchFunction) {
  const results = [];
  for (let i = 0; i < urls.length; i += config.MAX_CONCURRENT_REQUESTS) {
    const batch = urls.slice(i, i + config.MAX_CONCURRENT_REQUESTS);
    const batchResults = await Promise.all(batch.map(fetchFunction));
    results.push(...batchResults);
  }
  return results;
}

async function episode(data_id_1, data_id_2, type, s, e) {
  const cacheKey = `${data_id_1}-${data_id_2}-${type}-${s}-${e}`;
  const cachedData = cache.get(cacheKey);
  if (cachedData) {
    console.log('Returning cached data');
    return cachedData;
  }

  const baseUrl = `https://${config.HOST}/api/episodes/${data_id_2}/servers?id=${data_id_1}&type=${type}`;
  const url = type === 'tv' ? `${baseUrl}&season=${s}&episode=${e}` : baseUrl;

  const resp = await fetchJson(url);
  
  if (!resp.success || !Array.isArray(resp.data)) {
    throw new Error("Failed to fetch server data or invalid response format");
  }

  const sourceUrls = resp.data.map(server => `https://${config.HOST}/api/source/${server.hash}`);
  const sources = await fetchWithConcurrencyLimit(sourceUrls, async (url) => {
    try {
      const sourceData = await fetchJson(url);
      //success === true
      if (sourceData.data.hasOwnProperty('source')) {
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
  });

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

async function getvmovie(id) {
  const [data_id_1, data_id_2] = await getDataIds(`https://${config.HOST}/v2/embed/movie/${id}`);
  return episode(data_id_1, data_id_2, 'movie');
}

async function getvserie(id, s, e) {
  const [data_id_1, data_id_2] = await getDataIds(`https://${config.HOST}/v2/embed/tv/${id}/${s}/${e}`);
  return episode(data_id_1, data_id_2, 'tv', s, e);
}

async function handleRequest(request) {
  const url = new URL(request.url);
  const path = url.pathname;
  const params = url.searchParams;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: Status.NoContent, headers: corsHeaders });
  }

  if (path === "/") {
    return createResponse({
      intro: "Welcome to the unofficial vidsrc provider: check the provider website @ https://vidsrc.cc/ ",
      routes: {
        movie: "/vidsrc/:movieTMDBid",
        show: "/vidsrc/:showTMDBid?s=seasonNumber&e=episodeNumber"
      },
      author: "This api is developed and created by Inside4ndroid Studios"
    });
  }

  if (path === "/health") {
    return createResponse({ status: "healthy" });
  }

  if (path.startsWith("/vidsrc/")) {
    const tmdbId = path.split("/")[2];
    const season = params.get("s");
    const episode = params.get("e");
    const isMovie = !season && !episode;

    try {
      validateParams({ tmdbId, season, episode, isMovie });
      const vidsrcresponse = isMovie
        ? await getvmovie(tmdbId)
        : await getvserie(tmdbId, season, episode);
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
