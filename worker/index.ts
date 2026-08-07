// Cloudflare Worker entry point.
//
// This site is a fully static Next.js export (`output: "export"` in
// next.config.mjs) served by Cloudflare's native static assets (see
// `assets` in wrangler.jsonc) — there is no Next.js server runtime in
// production. That means neither @cloudflare/next-on-pages nor
// @opennextjs/cloudflare apply here: there's no running Next.js request
// handler on Cloudflare to reach a binding from. This file is the smallest
// possible layer on top of that: it serves everything through the ASSETS
// binding exactly as before, except requests for content images, which it
// answers directly from the shared R2 bucket. That's the only reason this
// repo has a `main` Worker script at all — see scripts/README.md.
//
// Docs content images used to be committed to git, co-located with their
// MDX files under content/docs/images/, and referenced with relative
// markdown paths (e.g. `./images/dag/architecture.svg`). Next's
// static-export bundler resolved those at build time into content-hashed
// files under `_next/static/media/`, which meant the image bytes had to be
// physically present in the repo just to run `next build`. That's
// incompatible with "stop committing images to git", so content images are
// now referenced by a stable absolute path instead (`/img/<file>`, resolved
// to `/docs/propeller/img/<file>` via NEXT_PUBLIC_BASE_PATH in
// src/components/doc-image.tsx) and served by this route.

interface R2ObjectBody {
  body: ReadableStream;
  size: number;
  httpEtag: string;
  writeHttpMetadata(headers: Headers): void;
}

interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>;
}

interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

interface Env {
  ASSETS: Fetcher;
  IMAGES_BUCKET: R2Bucket;
}

// Minimal structural types for the Workers Cache API -- avoids depending on
// the gitignored, wrangler-generated worker-configuration.d.ts (pnpm run
// build never regenerates it, only the separate types:check script does).
interface CFCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}
interface CFCacheStorage {
  readonly default: CFCache;
}
interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

// Matches next.config.mjs's BASE_PATH — this Worker has no access to that
// module (it isn't part of the Next.js build), so it's repeated here.
const IMG_ROUTE_PREFIX = "/docs/propeller/img/";

// Shared bucket ("websites-images") holds assets for multiple properties;
// this prefix keeps this site's objects from colliding with theirs.
const R2_KEY_PREFIX = "propeller-docs";

function notFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: { "cache-control": "no-store" },
  });
}

async function handleImageProxy(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
  const key = url.pathname.slice(IMG_ROUTE_PREFIX.length);
  if (!key) return notFound();

  // env.IMAGES_BUCKET.get() is an R2 binding call, not an HTTP subrequest --
  // it never touches Cloudflare's HTTP cache. Without explicitly writing the
  // response into the Cache API, every request (from every visitor, at
  // every edge location) would re-read from R2, no matter what
  // Cache-Control header gets set on the returned Response. Using the
  // request's own URL (unmodified) as the cache key keeps this purgeable by
  // the existing purge-by-URL call in scripts/publish-image.mjs.
  const cache = (caches as unknown as CFCacheStorage).default;
  const cacheKey = new Request(request.url, request);

  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const object = await env.IMAGES_BUCKET.get(`${R2_KEY_PREFIX}/${key}`);
  if (!object) return notFound();

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("content-length", String(object.size));
  // Browser TTL long enough to skip most repeat-visit requests, short
  // enough to self-heal within the hour if a purge is ever missed. Edge TTL
  // is effectively unbounded -- scripts/publish-image.mjs purges it
  // explicitly and immediately on every upload, so there's no benefit to a
  // shorter one, and every edge location that has ever served an image now
  // actually caches it (see the Cache API use above).
  headers.set("cache-control", "public, max-age=3600, s-maxage=31536000");

  const response = new Response(object.body, { headers });
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith(IMG_ROUTE_PREFIX)) {
      return handleImageProxy(request, env, ctx);
    }

    // run_worker_first defaults to false, so in production this Worker only
    // runs when no static asset matched the request path already — this
    // fetch() is here for local `wrangler dev` parity and clarity, not to
    // duplicate work the platform already does.
    return env.ASSETS.fetch(request);
  },
};
