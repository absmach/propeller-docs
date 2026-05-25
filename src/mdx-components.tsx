import { CodeBlock, Pre } from "fumadocs-ui/components/codeblock";
import { ImageZoom } from "fumadocs-ui/components/image-zoom";
import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";
import type { ComponentProps } from "react";
import { APIPage } from "@/components/api-page";
import { CodeFromSource } from "@/components/code-from-source";
import { assetPath } from "@/lib/base-path";

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
    img: (props: ComponentProps<typeof ImageZoom>) => {
      const src =
        typeof props.src === "string" ? assetPath(props.src) : props.src;
      return <ImageZoom {...props} src={src} />;
    },
    ...components,
  };
}
