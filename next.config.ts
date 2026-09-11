import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  output: "standalone",

  // Crawlee and its browser stack contain mixed CommonJS/ESM dependencies.
  // Let Next.js bundle/transpile Crawlee instead of leaving its dependency
  // graph as raw server-side require() calls in the Vercel function.
  transpilePackages: [
    "crawlee",
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
    // OCR dependencies load worker/native assets at runtime.
    "tesseract.js",
    "pngjs",
  ],

  // Runtime assets loaded through filesystem paths must be present in the
  // standalone/serverless output.
  outputFileTracingIncludes: {
    "/*": [
      "./node_modules/@sparticuz/chromium/bin/**/*",
      "./node_modules/axe-core/axe.min.js",
    ],
  },
};

export default withNextIntl(nextConfig);
