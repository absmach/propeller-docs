export const SITE_URL = (
  process.env.NEXT_PUBLIC_BASE_URL || "https://www.absmach.eu/docs/propeller"
).replace(/\/$/, "");

export function toSiteUrl(path: string): string {
  const url = `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
  return url.endsWith("/") ? url : `${url}/`;
}

export const GITHUB_URL = "https://github.com/absmach/propeller" as const;
