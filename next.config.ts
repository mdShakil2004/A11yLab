import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  output: "standalone",

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
