import {
  defineConfig,
  defineDocs,
  frontmatterSchema,
  metaSchema,
} from "fumadocs-mdx/config";
import { z } from "zod";
import { remarkDocImages } from "./src/lib/remark-doc-images";

// You can customise Zod schemas for frontmatter and `meta.json` here
// see https://fumadocs.dev/docs/mdx/collections
export const docs = defineDocs({
  dir: "content/docs",
  docs: {
    schema: frontmatterSchema.extend({
      lastModified: z.string().optional(),
    }),
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
  meta: {
    schema: metaSchema,
  },
});

export default defineConfig({
  mdxOptions: {
    // Content images are served at runtime from R2 via worker/index.ts
    // (see scripts/README.md), not committed to this repo. fumadocs-mdx's
    // remarkImage plugin needs the file on local disk at build time --
    // exactly what we're avoiding -- so it's disabled here. Authors keep
    // writing plain markdown image syntax with whatever relative path they
    // always used (`./images/x.svg`, `../images/dag/x.svg`); remarkDocImages
    // below resolves that to the R2-proxy URL at compile time instead (pure
    // path math, no manifest), and mdx-components.tsx's `img:` override
    // renders it as a plain, zoomable <img>.
    remarkImageOptions: false,
    remarkPlugins: [remarkDocImages],
  },
});
