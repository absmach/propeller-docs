"use client";
import { createOpenAPIPage, type OpenAPIPageProps } from "fumadocs-openapi/ui";

const OpenAPIPage = createOpenAPIPage();

export default function APIPageClient(props: OpenAPIPageProps) {
  return <OpenAPIPage {...props} />;
}
