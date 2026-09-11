import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: [
    "crawlee",
    "cacheable-request",
    "@crawlee/playwright",
    "@crawlee/browser-pool",
    "@crawlee/core",
    "@crawlee/utils",
    "@crawlee/types",
    "@crawlee/memory-storage",
    "accessibility-checker",
    "@azure/monitor-opentelemetry",
    "@opentelemetry/api",
    "@opentelemetry/api-logs",
    "@sparticuz/chromium",
    "playwright",
    "playwright-core",
    // OCR probe (image-of-text / rendered-text-contrast): these load native /
    // worker assets at runtime and must not be bundled by the server build.
    "tesseract.js",
    "pngjs",
  ],
  // @sparticuz/chromium loads its compressed Chromium binary from its
  // package-local bin directory at runtime. Next's output-file tracing does
  // not always discover those dynamically resolved assets, so include them
  // explicitly in the Vercel serverless function.
  outputFileTracingIncludes: {
    "/*": ["./node_modules/@sparticuz/chromium/bin/**/*"],
  },
};

export default withNextIntl(nextConfig);
