import { dirname, join, normalize, relative } from "node:path";

// Doc content images live in the shared R2 bucket (see worker/index.ts)
// instead of content/docs/images. Authors keep writing plain markdown image
// syntax with the same paths they always used -- this plugin rewrites each
// image's `url` at compile time (pure path math, no image bytes needed)
// into the literal "/docs/propeller/img/..." URL the Worker serves, so
// nothing about the authoring experience changes.
//
// - Relative paths ("./images/x.svg", "../images/dag/x.svg", or bare
//   "images/x.svg") resolve against the source .mdx file's own location,
//   same as markdown always works.
// - Full external URLs (http://, https://) are left untouched.
const CONTENT_IMAGES_ROOT = join(process.cwd(), "content/docs/images");
const IMG_ROUTE_PREFIX = "/docs/propeller/img";

// Minimal structural types for what this plugin touches -- avoids pulling in
// `@types/mdast`/`vfile` as direct dependencies for two fields.
interface MdastNode {
  type?: string;
  url?: string;
  children?: MdastNode[];
}
interface CompileFile {
  path: string;
}

function walk(node: MdastNode, visitor: (node: MdastNode) => void) {
  if (node.type === "image") visitor(node);
  if (Array.isArray(node.children)) {
    for (const child of node.children) walk(child, visitor);
  }
}

export function remarkDocImages() {
  return (tree: MdastNode, file: CompileFile) => {
    walk(tree, (node) => {
      if (typeof node.url !== "string" || node.url.length === 0) return;
      if (/^https?:\/\//.test(node.url)) return; // external, leave alone
      if (node.url.startsWith(IMG_ROUTE_PREFIX)) return; // already resolved

      const fileDir = dirname(file.path);
      const absolute = normalize(join(fileDir, node.url));
      const relativeToImages = relative(CONTENT_IMAGES_ROOT, absolute)
        .split("\\")
        .join("/");
      node.url = `${IMG_ROUTE_PREFIX}/${relativeToImages}`;
    });
  };
}
