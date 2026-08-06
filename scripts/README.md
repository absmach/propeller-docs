# Publishing docs images (maintainers only)

Content images are no longer committed to this repo. They're stored in a shared
Cloudflare R2 bucket (`websites-images`, under the `propeller-docs` key prefix so they
don't collide with other properties in the same bucket) and served at
`/docs/propeller/img/<path>` by a small Cloudflare Worker script,
[`worker/index.ts`](../worker/index.ts), that reads the object from R2 and streams it
back.

**Authoring is unchanged** — write plain markdown image syntax exactly as before, with
whatever relative path you'd naturally use from the `.mdx` file you're editing:

```md
![Propeller DAG Architecture](./images/dag/architecture.svg)
```

[`src/lib/remark-doc-images.ts`](../src/lib/remark-doc-images.ts) resolves that path
(relative to the source file's own location — pure path math, no image bytes needed) into
the literal `/docs/propeller/img/dag/architecture.svg` URL the Worker serves, at compile
time. `src/mdx-components.tsx`'s `img:` override then renders it as a plain, zoomable
`<img>` (`fumadocs-ui`'s `ImageZoom` wrapping a plain element, not `next/image`) — no
width/height needed, so there's no manifest to keep in sync when images change.

## Why a Worker script, not a Next.js route

This site is a fully static Next.js export (`output: "export"` in `next.config.mjs`),
deployed to Cloudflare as static assets with no Next.js server at all. That's also why
neither `@cloudflare/next-on-pages` nor `@opennextjs/cloudflare` apply here: there's no
running Next.js request handler on Cloudflare to reach an R2 binding from.

Before this change, fumadocs-mdx's `remarkImage` plugin resolved markdown image syntax
into a webpack `import` at build time, content-hashed under `_next/static/media/` — which
meant the image bytes had to be physically present in the repo just to run `next build`,
incompatible with getting them out of git. `source.config.ts` disables that plugin, and
`wrangler.jsonc` has a `main` Worker script (`worker/index.ts`) purely to answer the
`/docs/propeller/img/*` route: it falls back from the `ASSETS` binding (Cloudflare serves
any matching static file directly and only invokes this Worker when nothing matches,
since `run_worker_first` defaults to `false`) to reading the request straight out of
`IMAGES_BUCKET`.

Only maintainers publish images, using [`publish-image.mjs`](./publish-image.mjs). The
script is safe to have in a public repo because it's inert without a token — nobody can
upload to the bucket just by reading this file. See "Why maintainer-only" below.

## One-time setup

1. Create `scripts/.env.publish-image` from the template:

   ```bash
   cp scripts/.env.publish-image.example scripts/.env.publish-image
   ```

2. Create a Cloudflare API token: dashboard -> **My Profile -> API Tokens -> Create Token
   -> Custom Token**, with both permissions on the same token:
   - `Workers R2 Storage: Edit`
   - `Zone -> Cache Purge -> Purge`, **Zone Resources** scoped to the zone fronting this
     site (`www.absmach.eu` — see `scripts/.env.publish-image.example`)

3. Paste the token into `CLOUDFLARE_API_TOKEN` in `scripts/.env.publish-image`
   (`CLOUDFLARE_ZONE_ID` is pre-filled — it isn't secret).

4. Sanity-check the token before first use:

   ```bash
   curl -s https://api.cloudflare.com/client/v4/user/tokens/verify \
     -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
   ```

   Should return `"status":"active"`. If it doesn't, the token value itself is wrong
   (bad copy/paste, expired, revoked) — fix that before troubleshooting anything else.

## Publishing an image

```bash
pnpm run publish-image <local-file> <public-path>
```

`<public-path>` must start with `img/` and include the rest of the path MDX content will
reference. Example:

```bash
pnpm run publish-image ./architecture.svg img/dag/architecture.svg
# -> uploaded to r2://websites-images/propeller-docs/dag/architecture.svg
# -> live at https://www.absmach.eu/docs/propeller/img/dag/architecture.svg
# -> reference from MDX with any relative path resolving to
#    content/docs/images/dag/architecture.svg, e.g. ![Alt](./images/dag/architecture.svg)
```

The script does two things, in order:

1. `wrangler r2 object put ... --remote` — uploads to the **real** bucket. `--remote` is
   required; without it, `wrangler` silently writes to a local simulated bucket and
   prints a normal-looking "Upload complete" with no error, and the object is never
   actually live.
2. Purges that exact URL from Cloudflare's edge cache (`POST /zones/{id}/purge_cache`),
   so the update is visible within seconds instead of waiting out the cache TTL.

If you re-run the same command for an existing path, it overwrites the object in place and
purges again — that's the intended way to update an image without changing its URL or the
MDX that references it.

If you're adding a brand-new diagram: drop it wherever makes sense under
`content/docs/images/` conceptually (the directory itself no longer exists in git, but the
path still determines the R2 key — see above), run `publish-image` on it, then reference
it from your MDX with the matching relative path — no separate registration step.

## Migrating the existing diagrams (one-time, already done)

This repo's 40 actually-referenced diagrams (5 more existed under `content/docs/images/`
but weren't linked from any `.mdx` file, so were dropped rather than migrated) have
already been uploaded to the real R2 bucket and spot-checked byte-for-byte against the
originals. Nothing further to do here unless a diagram needs updating — use
`publish-image` for that, same as any other image.

## Why maintainer-only

This repo is public. The risk isn't the script being visible — it's inert without a
credential. The risk is _credential distribution_: whoever holds `CLOUDFLARE_API_TOKEN`
can write to the shared bucket. So nobody, internal or external, gets a personal R2
token. Only a maintainer, holding this one scoped token, runs `publish-image`.

Practical flow for a PR that adds a diagram: the contributor attaches the image to the PR
the normal GitHub way (drag-and-drop into the description or a comment) and references
`/img/<path>` from their MDX changes. A maintainer reviewing the PR runs
`pnpm run publish-image` locally before merging, then approves.

## Troubleshooting

- **`Local file not found: --`** — you ran `pnpm run publish-image -- <file>`. pnpm
  forwards a leading `--` to the script literally instead of stripping it like npm does.
  The script strips it defensively, but plain `pnpm run publish-image <file> <path>` (no
  `--`) is the form to use.
- **`Resource location: local` in the upload output** — means `--remote` didn't get
  applied for some reason (e.g. running the underlying `wrangler` command by hand without
  copying the full flag list from the script). The object was never written to the real
  bucket even though the CLI reports success. Always use `pnpm run publish-image`, or add
  `--remote` yourself if invoking wrangler directly.
- **`Cache purge failed` / `Authentication error` (code 10000)** — Cloudflare reuses this
  code for both "bad token" and "token valid but missing this permission." Run the token
  verify curl command above first to rule out a bad token. If that succeeds, the token is
  missing `Zone -> Cache Purge -> Purge` for the correct zone, or that permission's Zone
  Resources selector doesn't include it — edit the token in the dashboard and add it.
- To confirm an object actually made it into the bucket after a `--remote` upload:

  ```bash
  wrangler r2 object get websites-images/propeller-docs/<path> --remote --file=/tmp/check
  ```
