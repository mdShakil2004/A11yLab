import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  output: "standalone",

  // Bundle the direct Playwright crawler package so its mixed ESM/CJS
  // dependency graph is handled by Next.js instead of Node's raw require().
  transpilePackages: [
    "@crawlee/playwright",
    "@crawlee/browser-pool",
    "@crawlee/core",
    "@crawlee/utils",
    "@crawlee/types",
    "@crawlee/memory-storage",
    "cacheable-request",
  ],

  serverExternalPackages: [
    "accessibility-checker",
    "@azure/monitor-opentelemetry",
    "@opentelemetry/api",
    "@opentelemetry/api-logs",
    "@sparticuz/chromium",
    "playwright",
    "playwright-core",
    "tesseract.js",
    "pngjs",
  ],

  outputFileTracingIncludes: {
    "/*": [
      "./node_modules/@sparticuz/chromium/bin/**/*",
      "./node_modules/axe-core/axe.min.js",
    ],
  },
};

export default withNextIntl(nextConfig);
