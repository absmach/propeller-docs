import type { GeneratedPageProps } from "fumadocs-openapi";
import { createOpenAPIPage } from "fumadocs-openapi/ui";
import { openapi } from "@/lib/openapi";

const OpenAPIPage = createOpenAPIPage();

export async function APIPage({ document, ...props }: GeneratedPageProps) {
  const { bundled } = await openapi.getSchema(document);
  return <OpenAPIPage payload={{ bundled }} {...props} />;
}
