import { CodeBlock, Pre } from "fumadocs-ui/components/codeblock";
import { ImageZoom } from "fumadocs-ui/components/image-zoom";
import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";
import type { ComponentPropsWithoutRef } from "react";
import { APIPage } from "@/components/api-page";
import { CodeFromSource } from "@/components/code-from-source";

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    APIPage,
    CodeFromSource,
    pre: ({ ref: _ref, ...props }) => (
      <CodeBlock {...props}>
        <Pre>{props.children}</Pre>
      </CodeBlock>
    ),
    // Content images are R2-backed (src/lib/remark-doc-images.ts resolves
    // the path at compile time; remarkImageOptions is disabled in
    // source.config.ts so this receives the literal, resolved `<img>` MDX
    // produced for every `![...](...)` in content, unmodified). Rendered as
    // a plain, zoomable <img> -- no next/image, no dimensions needed, same
    // ImageZoom-wrapped UX this repo had before any of this migration.
    img: (props: ComponentPropsWithoutRef<"img">) => {
      if (typeof props.src !== "string") return null;
      const { src, alt, ...rest } = props;
      return (
        // src/alt passed here too, not just to the inner <img>: ImageZoom's
        // zoomed-in view reads its image from these props directly, not
        // from `children` -- omitting them renders a blank zoomed-in image
        // even though the inline thumbnail (via children) looks correct.
        <ImageZoom src={src} alt={alt ?? ""}>
          {/* biome-ignore lint/performance/noImgElement: doc content images are served from R2, not Next's image pipeline -- see src/lib/remark-doc-images.ts */}
          <img {...rest} src={src} alt={alt ?? ""} loading="lazy" />
        </ImageZoom>
      );
    },
    ...components,
  };
}
