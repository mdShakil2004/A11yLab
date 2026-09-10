# Stage 1: Install dependencies
FROM node:20-alpine AS deps
WORKDIR /app
# The @siteimprove/* Alfa ACT-Rules packages are published to the public npm
# registry and declared as OPTIONAL dependencies, so `npm ci` installs them with no
# token or secret. If the registry is ever unreachable, npm skips the optional
# packages and the Alfa runner degrades to a no-op at scan time (see engine.ts runAlfa).
COPY package.json package-lock.json .npmrc ./
RUN npm ci

# Stage 2: Build the application
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx next build

# Stage 3: Production image with Playwright browsers
FROM node:20-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NODE_OPTIONS="--max-old-space-size=1536"

# Install procps (provides 'ps' command needed by Crawlee memory monitoring),
# Playwright system dependencies, and curl (used below to fetch the Tesseract
# OCR language model at build time).
RUN apt-get update && apt-get install -y --no-install-recommends procps curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Bundle the Tesseract OCR language model locally so the image-of-text /
# rendered-text-contrast probe runs offline and deterministically (no CDN
# round-trip at scan time). tesseract.js is configured with gzip:true and
# langPath=$TESSERACT_LANG_PATH, so the gzipped traineddata is consumed as-is.
RUN mkdir -p /app/tessdata \
    && curl -fsSL https://tessdata.projectnaptha.com/4.0.0/eng.traineddata.gz \
         -o /app/tessdata/eng.traineddata.gz
ENV TESSERACT_LANG_PATH=/app/tessdata

# Copy standalone output
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Copy all node_modules from deps to ensure serverExternalPackages
# (crawlee, @azure/monitor-opentelemetry, etc.) have all transitive dependencies
COPY --from=deps /app/node_modules ./node_modules

# Install Playwright Chromium and Puppeteer Chrome AFTER node_modules are in place
# so the installed browser versions match the packages in node_modules
RUN npx playwright install --with-deps chromium
RUN npx puppeteer browsers install chrome

EXPOSE 3000

CMD ["node", "server.js"]
