# Propeller Website

Propeller Website is a documentation website built with [Next.js](https://nextjs.org/) and [Fumadocs](https://www.fumadocs.dev/), featuring documentation and OpenAPI reference pages.

## Features

- Documentation with MDX support
- OpenAPI/Swagger API reference documentation
- Static site generation for optimal performance
- Search functionality powered by Orama
- Responsive design with dark mode support
- SEO-optimized with sitemap and robots.txt generation

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v20+
- [pnpm](https://pnpm.io/) v9+

### Installation

```bash
pnpm install
```

### Development

Run the development server:

```bash
pnpm run dev
```

Open <http://localhost:3000> with your browser to see the result.

### Build

Build the static site:

```bash
pnpm run build
```

The output will be generated in the `out` directory.

### Preview Production Build

```bash
pnpm run start
```

### Linting

```bash
pnpm run lint
pnpm run lint:fix  # Auto-fix issues
```

## Deployment

The site is configured for static export and can be deployed to GitHub Pages (via [`.github/workflows/cd.yaml`](.github/workflows/cd.yaml)) or any other static hosting provider.
