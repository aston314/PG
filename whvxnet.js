import { Application, Router } from "https://deno.land/x/oak/mod.ts";
import { oakCors } from "https://deno.land/x/cors/mod.ts";

interface SearchResponse {
  url: string;
}

interface SourceResponse {
  [key: string]: unknown;
}

const baseUrl = "https://www.whvx.net";
const baseAPiUrl = "https://api.whvx.net/";

const options: RequestInit = {
  headers: {
    Origin: baseUrl,
    Referer: baseUrl,
  },
};

async function fetchSource(params: URLSearchParams): Promise<SourceResponse> {
  // First request to get resourceId
  const searchResponse = await fetch(
    `${baseAPiUrl}search/?${params}`,
    options
  );
  console.log(searchResponse)
  const searchData: SearchResponse = await searchResponse.json();
  const resourceId = searchData.url;

  // Second request to get source
  const sourceResponse = await fetch(
    `${baseAPiUrl}source/?${new URLSearchParams({
      resourceId,
      provider: "astra",
    }).toString()}`,
    options
  );
  
  return await sourceResponse.json();
}

async function movie(id: string) {
  const queryParams = new URLSearchParams({
    query: JSON.stringify({
      tmdbId: id,
      type: "movie",
    }),
    provider: "astra",
  });

  try {
    const sourceData = await fetchSource(queryParams);
    return sourceData;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Movie error: ${error.message}`);
    }
    throw new Error("An unknown error occurred while fetching movie");
  }
}

async function tv(id: string, season: number, episode: number) {
  const queryParams = new URLSearchParams({
    query: JSON.stringify({
      tmdbId: id,
      type: "show",
      season: season.toString(),
      episode: episode.toString(),
    }),
    provider: "astra",
  });

  try {
    const sourceData = await fetchSource(queryParams);
    return sourceData;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`TV Show error: ${error.message}`);
    }
    throw new Error("An unknown error occurred while fetching TV show");
  }
}

const app = new Application();
const router = new Router();

// Enable CORS
app.use(oakCors({
  origin: "*",
  methods: ["GET"],
  allowedHeaders: ["Content-Type"],
}));

// Routes
router.get("/movie/:id", async (ctx) => {
  try {
    const id = ctx.params.id;
    ctx.response.body = await movie(id);
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = { error: error.message };
  }
});

router.get("/tv/:id/:s/:e", async (ctx) => {
  try {
    const id = ctx.params.id;
    const s = parseInt(ctx.params.s);
    const e = parseInt(ctx.params.e);
    ctx.response.body = await tv(id, s, e);
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = { error: error.message };
  }
});

// Use router
app.use(router.routes());
app.use(router.allowedMethods());

// Start server
const port = 8000;
console.log(`Server running on http://localhost:${port}`);
await app.listen({ port });
