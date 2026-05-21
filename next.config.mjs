import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

const basePath = "/docs/propeller";

/** @type {import('next').NextConfig} */
const config = {
  basePath,
  output: "export",
  trailingSlash: true,
  reactStrictMode: true,
  images: {
    unoptimized: true,
  },
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
};

export default withMDX(config);
