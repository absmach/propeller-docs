import { execSync } from "node:child_process";
import { join } from "node:path";
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from "fumadocs-ui/layouts/docs/page";
import { createRelativeLink } from "fumadocs-ui/mdx";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LLMCopyButton, ViewOptions } from "@/components/page-actions";
import { SITE_URL } from "@/lib/geo-constants";
import { getPageImage, source } from "@/lib/source";
import { getMDXComponents } from "@/mdx-components";
import { RootRedirect } from "./root-redirect";

function resolvePageLastModified(
  frontmatterDate: string | undefined,
  filePath: string,
): string | undefined {
  if (frontmatterDate) return frontmatterDate;
  try {
    const date = execSync(
      `git log -1 --format=%cd --date=short -- ${filePath}`,
      { cwd: process.cwd() },
    )
      .toString()
      .trim();
    return date || undefined;
  } catch {
    return undefined;
  }
}

function resolvePageDatePublished(filePath: string): string | undefined {
  try {
    const output = execSync(
      `git log --follow --format=%cd --date=short -- ${filePath}`,
      { cwd: process.cwd() },
    )
      .toString()
      .trim();
    if (!output) return undefined;
    const lines = output.split("\n").filter(Boolean);
    return lines[lines.length - 1] || undefined;
  } catch {
    return undefined;
  }
}

export default async function Page(props: PageProps<"/[[...slug]]">) {
  const params = await props.params;

  const slug = params.slug ?? [];
  const page = source.getPage(slug);

  if (!page) {
    if (slug.length === 0) return <RootRedirect />;
    notFound();
  }

  const MDX = page.data.body;
  const pageUrl = `${SITE_URL}${page.url}`;
  const pageImage = new URL(
    getPageImage(page).url,
    new URL(SITE_URL).origin,
  ).toString();
  const contentPath = join(process.cwd(), "content", page.path);
  const lastModified = resolvePageLastModified(
    page.data.lastModified,
    contentPath,
  );
  const datePublished = resolvePageDatePublished(contentPath);

  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: controlled static JSON-LD
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "TechArticle",
            headline: page.data.title,
            description: page.data.description,
            url: pageUrl,
            image: pageImage,
            datePublished,
            dateModified: lastModified,
            author: { "@type": "Organization", name: "Abstract Machines" },
          }),
        }}
      />
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <div className="flex flex-row gap-2 items-center border-b pt-2 pb-6">
        <LLMCopyButton markdownUrl={`${page.url}.mdx`} />
        <ViewOptions
          markdownUrl={`${page.url}.mdx`}
          githubUrl={`https://github.com/absmach/propeller/blob/main/content/docs/${page.path}`}
        />
      </div>

      <DocsBody>
        <MDX
          components={getMDXComponents({
            a: createRelativeLink(source, page),
          })}
        />
      </DocsBody>
    </DocsPage>
  );
}

export async function generateStaticParams() {
  return [{ slug: [] }, ...source.generateParams()];
}

export async function generateMetadata(
  props: PageProps<"/[[...slug]]">,
): Promise<Metadata> {
  const params = await props.params;

  const slug = params.slug ?? [];
  const page = source.getPage(slug);
  if (!page) return { title: "Propeller Docs" };

  const canonical = `${SITE_URL}${page.url}`;
  return {
    title: page.data.title,
    description:
      page.data.description ??
      "Complete technical documentation for Propeller — architecture, APIs, components, and integration guides.",
    alternates: { canonical },
    openGraph: {
      url: canonical,
      images: getPageImage(page).url,
    },
  };
}
