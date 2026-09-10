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
    // OCR probe (image-of-text / rendered-text-contrast): these load native /
    // worker assets at runtime and must not be bundled by the server build.
    "tesseract.js",
    "pngjs",
  ],
};

export default withNextIntl(nextConfig);
