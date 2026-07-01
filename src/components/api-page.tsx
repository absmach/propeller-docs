import type { GeneratedPageProps } from "fumadocs-openapi";
import { openapi } from "@/lib/openapi";
import APIPageClient from "./api-page.client";

export async function APIPage({ document, ...props }: GeneratedPageProps) {
  const { bundled } = await openapi.getSchema(document);
  return <APIPageClient payload={{ bundled }} {...props} />;
}
