const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

export function getBasePath(): string {
  return BASE_PATH;
}

export function assetPath(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${BASE_PATH}${normalizedPath}`;
}
