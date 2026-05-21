"use client";

import { CodeBlock, Pre } from "fumadocs-ui/components/codeblock";
import { useEffect, useState } from "react";
import { codeToHtml } from "shiki/bundle/full";

interface CodeFromSourceProps {
  src: string;
  lang?: string;
}

function inferLang(src: string): string {
  const ext = src.split(".").pop()?.split("?")[0] ?? "";
  const map: Record<string, string> = {
    go: "go",
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    py: "python",
    rs: "rust",
    sh: "bash",
    yaml: "yaml",
    yml: "yaml",
    json: "json",
    md: "markdown",
    mdx: "mdx",
    toml: "toml",
    c: "c",
    cpp: "cpp",
    java: "java",
  };
  return map[ext] ?? "plaintext";
}

// Extract the <code>...</code> element from shiki's <pre><code>...</code></pre> output.
// We inject only <code> into Pre's <pre> to avoid nesting <pre> inside <pre>.
function extractCode(html: string): string {
  const match = html.match(/(<code>[\s\S]*<\/code>)/);
  return match ? match[1] : html;
}

export function CodeFromSource({ src, lang }: CodeFromSourceProps) {
  const [codeHtml, setCodeHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const language = lang ?? inferLang(src);

  useEffect(() => {
    let cancelled = false;
    fetch(src)
      .then((res) => {
        if (!res.ok)
          throw new Error(`Failed to fetch: ${res.status} ${res.statusText}`);
        return res.text();
      })
      .then((code) =>
        codeToHtml(code, {
          lang: language,
          themes: { light: "github-light", dark: "github-dark" },
        }),
      )
      .then((highlighted) => {
        if (!cancelled) setCodeHtml(extractCode(highlighted));
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [src, language]);

  if (error) {
    return (
      <CodeBlock>
        <Pre>{`Error loading source: ${error}`}</Pre>
      </CodeBlock>
    );
  }

  if (codeHtml === null) {
    return (
      <CodeBlock>
        <Pre>Loading...</Pre>
      </CodeBlock>
    );
  }

  // Inject <code>...</code> into Pre's <pre>.
  // The fumadocs CSS selector is: .shiki code span { color: var(--shiki-light) }
  // CodeBlock adds the "shiki" class to the wrapping <figure>, satisfying the selector.
  return (
    <CodeBlock>
      <Pre
        // biome-ignore lint/security/noDangerouslySetInnerHtml: shiki output is trusted
        dangerouslySetInnerHTML={{ __html: codeHtml }}
      />
    </CodeBlock>
  );
}
