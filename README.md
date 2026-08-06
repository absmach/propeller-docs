# Propeller Docs

Documentation site for [Propeller](https://github.com/absmach/propeller), built with [Fumadocs](https://fumadocs.dev) and Next.js.

Visiting `/docs/propeller/` redirects to `/docs/propeller/architecture/`.

## Development

```bash
pnpm install
pnpm dev
```

Open http://localhost:3000/docs/propeller/ with your browser to see the result.

## Deployment

This site uses:

- **Next.js static export** — `next build` outputs static files to `out/`
- **Next.js `basePath`** — generates links and assets under `/docs/propeller`
- **Post-build nesting** — `scripts/nest-static-export.mjs` moves the export under `out/docs/propeller/` so Cloudflare static assets can serve it from the route prefix
- **Worker-proxied doc images** — `worker/index.ts` (the `main` entry in `wrangler.jsonc`) sits in front of the static assets and serves `/docs/propeller/img/*` requests directly from the shared `websites-images` R2 bucket; every other request falls through to the static asset binding unchanged. See [`scripts/README.md`](./scripts/README.md) for how images get published there.

### Cloudflare build settings (Dashboard)

| Setting         | Value                           |
| --------------- | ------------------------------- |
| Build command   | `pnpm run build`                |
| Deploy command  | `pnpm wrangler deploy`          |
| Version command | `pnpm wrangler versions upload` |
| Root directory  | `/`                             |

### Architecture

```mermaid
flowchart LR
  subgraph Build_and_Deploy
    A[Git push] --> B[Cloudflare build trigger]
    B --> C[pnpm run build]
    C --> D[next build — static export]
    D --> E[nest export under out/docs/propeller]
    B --> F[pnpm wrangler deploy]
    E --> G[Cloudflare static assets]
    F --> G
  end

  subgraph Runtime_Request_Flow
    U[Browser request] --> W[worker/index.ts]
    W -->|"/docs/propeller/img/*"| R[(R2: websites-images)]
    W -->|everything else| H[ASSETS binding]
    R --> U
    H --> U
  end
```

## Environment Variables

Only one build variable is needed:

```env
NEXT_PUBLIC_BASE_URL=https://www.absmach.eu/docs/propeller
```

Set this as a Cloudflare build variable so it is embedded into the static output at build time.

## Project structure

| Path                             | Description                                 |
| -------------------------------- | ------------------------------------------- |
| `src/app/[[...slug]]/page.tsx`   | Docs page renderer (all routes)             |
| `src/app/api/search/route.ts`    | Static search index route handler           |
| `src/app/og/[...slug]/route.tsx` | OG image generation for docs pages          |
| `src/app/llms-full.txt/route.ts` | LLM-readable full docs text                 |
| `content/docs`                   | MDX source files                            |
| `src/lib/source.ts`              | Fumadocs source adapter                     |
| `src/lib/layout.shared.tsx`      | Shared layout options                       |
| `content/openapi.yaml`           | OpenAPI spec (generates API docs)           |
| `scripts/nest-static-export.mjs` | Moves static export under `/docs/propeller` |
| `worker/index.ts`                | Cloudflare Worker: proxies `/docs/propeller/img/*` from R2, falls through to static assets otherwise |
| `src/lib/remark-doc-images.ts`   | Remark plugin resolving markdown image paths (relative to their source file) to their R2-proxy URL at build time |
| `scripts/publish-image.mjs`      | Maintainer-only: uploads a content image to R2 and purges its cache entry |

## Learn More

- [Fumadocs](https://fumadocs.dev)
- [Next.js Documentation](https://nextjs.org/docs)
