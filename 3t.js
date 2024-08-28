import { Application, Router } from "https://deno.land/x/oak/mod.ts";
import { oakCors } from "https://deno.land/x/cors/mod.ts";
import cheerio from "https://esm.sh/cheerio@1.0.0-rc.12";
import axiod from "https://deno.land/x/axiod/mod.ts";

// API 配置
const CONFIG = {
  TMDB_API_KEY: "4ef0d7355d9ffb5151e987764708ce96",
  X1377_BASE_URL: "https://www.1377x.to",
  TMDB_BASE_URL: "https://api.themoviedb.org/3",
};

// 简单的日志函数
const logger = {
  info: (message: string) => console.log(`[INFO] ${message}`),
  error: (message: string) => console.error(`[ERROR] ${message}`),
  debug: (message: string) => console.debug(`[DEBUG] ${message}`),
};

// 定义电影卡片的接口
interface MovieCard {
  title: string;
  original_title: string;
  title_org: string;
  url: string;
  img: string;
  quantity: string;
  year: string;
  release_year: string;
  update: string;
  score: string;
  episodes_info: string;
}

// 响应格式化函数
function formatResponse(data: any, success: boolean, message: string = "") {
  return {
    success,
    message,
    data,
  };
}

// 获取1377x页面内容
async function fetch1377xContent(page: number = 1, type: string = 'release'): Promise<string> {
  let sortParam: string;
  switch (type) {
    case 'score':
      sortParam = 'rate/desc';
      break;
    case 'latest':
      sortParam = 'latest/desc';
      break;
    case 'release':
    default:
      sortParam = 'release/desc';
  }

  const url = `${CONFIG.X1377_BASE_URL}/movie-lib-sort/all/all/all/${sortParam}/${page}/`;
  try {
    const response = await axiod.get(url);
    return response.data;
  } catch (error) {
    logger.error(`Error fetching 1377x content: ${error.message}`);
    throw new Error("Failed to fetch 1377x content");
  }
}

// 解析1377x内容并提取电影信息
function parse1377xContent(content: string): MovieCard[] {
  const $ = cheerio.load(content);
  const cards: MovieCard[] = [];

  $('div.library-box ul li').each((_, element) => {
    const $html = $(element);
    const $headerLink = $html.find('div.modal-header > h3 > a');
    const href = $headerLink.attr('href') || '';
    const releaseYearMatch = href.match(/-(\d{4})\//);
    const scoreStyle = $html.find('span.rating > i').attr('style') || '';

    cards.push({
      title: $headerLink.text(),
      original_title: '',
      title_org: '',
      url: CONFIG.X1377_BASE_URL + href,
      img: CONFIG.X1377_BASE_URL + $html.find('img.lazy').attr('data-original'),
      quantity: '',
      year: '',
      release_year: releaseYearMatch ? releaseYearMatch[1] : '',
      update: '',
      score: scoreStyle ? (parseFloat(scoreStyle.replace(/width: |%;/g, '')) / 10).toFixed(1) : '',
      episodes_info: releaseYearMatch ? releaseYearMatch[1] : ''
    });
  });

  return cards;
}

// 从TMDB获取电影信息
async function fetchTMDBInfo(movie: MovieCard, language: string): Promise<MovieCard | null> {
  if (!CONFIG.TMDB_API_KEY) {
    logger.error("TMDB API key is not set");
    throw new Error("TMDB API key is not set");
  }

  const searchUrl = `${CONFIG.TMDB_BASE_URL}/search/movie?api_key=${CONFIG.TMDB_API_KEY}&query=${encodeURIComponent(movie.title)}&year=${movie.release_year}&language=${language}`;

  try {
    const response = await axiod.get(searchUrl);
    const results = response.data.results;

    if (results && results.length > 0) {
      const tmdbMovie = results[0];
      return {
        ...movie,
        id: tmdbMovie.id,
        title: tmdbMovie.title,
        original_title: tmdbMovie.original_title,
        title_org: tmdbMovie.original_title,
        img: tmdbMovie.poster_path ? `t/p/w300${tmdbMovie.poster_path}` : movie.img,
        year: tmdbMovie.release_date.split('-')[0],
        release_year: tmdbMovie.release_date.split('-')[0],
        score: tmdbMovie.vote_average.toFixed(1),
      };
    }
  } catch (error) {
    logger.error(`Error fetching TMDB info: ${error.message}`);
  }

  return null;
}

// 主函数
async function main(page: number = 1, language: string = 'en', type: string = 'release') {
  const content = await fetch1377xContent(page, type);
  const movies = parse1377xContent(content);

  const updatedMovies = await Promise.all(movies.map(async (movie) => {
    const tmdbInfo = await fetchTMDBInfo(movie, language);
    return tmdbInfo || movie;
  }));

  return updatedMovies;
}

// 健康检查函数
async function healthCheck(): Promise<{ www1377x: boolean; tmdb: boolean }> {
  const result = { www1377x: false, tmdb: false };

  try {
    await axiod.get(CONFIG.X1377_BASE_URL);
    result.www1377x = true;
  } catch (error) {
    logger.error(`1377x health check failed: ${error.message}`);
  }

  try {
    await axiod.get(`${CONFIG.TMDB_BASE_URL}/movie/550?api_key=${CONFIG.TMDB_API_KEY}`);
    result.tmdb = true;
  } catch (error) {
    logger.error(`TMDB health check failed: ${error.message}`);
  }

  return result;
}

// 创建路由
const router = new Router();

router.get("/movies", async (context) => {
  const page = context.request.url.searchParams.get("page");
  const language = context.request.url.searchParams.get("language") || "en";
  const type = context.request.url.searchParams.get("type") || "release";
  
  if (!page || isNaN(Number(page)) || Number(page) < 1) {
    context.response.body = formatResponse(null, false, "Invalid page number");
    context.response.status = 400;
    return;
  }

  if (!['release', 'score', 'latest'].includes(type)) {
    context.response.body = formatResponse(null, false, "Invalid type parameter");
    context.response.status = 400;
    return;
  }

  try {
    const movies = await main(parseInt(page), language, type);
    context.response.body = formatResponse({
      movies,
      page: Number(page),
      language,
      type,
      total: movies.length,
    }, true, "Movies fetched successfully");
  } catch (error) {
    logger.error(`Error processing request: ${error.message}`);
    context.response.body = formatResponse(null, false, "Internal server error");
    context.response.status = 500;
  }
});

// 添加健康检查路由
router.get("/health", async (context) => {
  try {
    const health = await healthCheck();
    context.response.body = formatResponse(health, true, "Health check completed");
  } catch (error) {
    logger.error(`Error during health check: ${error.message}`);
    context.response.body = formatResponse(null, false, "Health check failed");
    context.response.status = 500;
  }
});

// 创建应用
const app = new Application();

// CORS 中间件
app.use(oakCors({
  origin: "*", // 允许所有来源，您可以根据需要设置为特定域名
  methods: ["GET"], // 只允许 GET 请求
  allowedHeaders: ["Content-Type", "Authorization"],
  optionsSuccessStatus: 200 // 一些遗留浏览器 (IE11, various SmartTVs) 在 204 上卡住
}));

// 错误处理中间件
app.use(async (context, next) => {
  try {
    await next();
  } catch (error) {
    logger.error(`Unhandled error: ${error.message}`);
    context.response.body = formatResponse(null, false, "Internal server error");
    context.response.status = 500;
  }
});

app.use(router.routes());
app.use(router.allowedMethods());

// 启动服务器
const port = 8000;
logger.info(`Server running on http://localhost:${port}`);
await app.listen({ port });
