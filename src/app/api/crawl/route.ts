import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { createCrawl, getCrawl } from '@/lib/scanner/store';
import { startCrawl } from '@/lib/crawler/site-crawler';
import type { CrawlConfig, CrawlRequest } from '@/lib/types/crawl';
import { trackCrawlStart, trackCrawlComplete, trackCrawlError } from '@/lib/telemetry';
import { createLogger } from '@/lib/logger';

const log = createLogger('api:crawl');

function isValidScanUrl(input: string): boolean {
  if (!input || typeof input !== 'string' || input.length > 2048) return false;

  let parsed: URL;
  try {
    parsed = new URL(input.trim());
  } catch {
    return false;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;

  const hostname = parsed.hostname;

  // Block private/internal IPs (SSRF prevention)
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '0.0.0.0' ||
    hostname.startsWith('10.') ||
    hostname.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
    hostname.startsWith('fc') ||
    hostname.startsWith('fd') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    return false;
  }

  return true;
}

function validateConfig(body: CrawlRequest): { config: CrawlConfig; error?: string } {
  const maxPages = body.maxPages ?? 50;
  const maxDepth = body.maxDepth ?? 3;
  const concurrency = body.concurrency ?? 3;
  const delayMs = body.delayMs ?? 1000;

  if (maxPages < 1 || maxPages > 200) {
    return { config: null as unknown as CrawlConfig, error: 'maxPages must be between 1 and 200' };
  }
  if (maxDepth < 1 || maxDepth > 10) {
    return { config: null as unknown as CrawlConfig, error: 'maxDepth must be between 1 and 10' };
  }
  if (concurrency < 1 || concurrency > 5) {
    return { config: null as unknown as CrawlConfig, error: 'concurrency must be between 1 and 5' };
  }

  const config: CrawlConfig = {
    maxPages,
    maxDepth,
    concurrency,
    delayMs,
    includePatterns: body.includePatterns ?? [],
    excludePatterns: body.excludePatterns ?? [],
    respectRobotsTxt: body.respectRobotsTxt ?? true,
    followSitemaps: body.followSitemaps ?? true,
    domainStrategy: body.domainStrategy ?? 'same-hostname',
  };

  return { config };
}

export async function POST(request: NextRequest) {
  let body: CrawlRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { url } = body;

  if (!url || typeof url !== 'string') {
    return NextResponse.json({ error: 'URL is required' }, { status: 400 });
  }

  if (!isValidScanUrl(url)) {
    return NextResponse.json({ error: 'Invalid URL. Only public HTTP/HTTPS URLs are allowed.' }, { status: 400 });
  }

  const { config, error } = validateConfig(body);
  if (error) {
    return NextResponse.json({ error }, { status: 400 });
  }

  const crawlId = uuidv4();
  log.info('Crawl requested', { crawlId, url: url.trim(), maxPages: config.maxPages, maxDepth: config.maxDepth });
  createCrawl(crawlId, url.trim(), config);

  // Start crawl asynchronously — do not await
  const startTime = Date.now();
  const span = trackCrawlStart(crawlId, url.trim());
  startCrawl(crawlId, url.trim(), config).then(() => {
    const crawl = getCrawl(crawlId);
    trackCrawlComplete(span, crawlId, url.trim(), Date.now() - startTime, crawl?.completedPageCount ?? 0, crawl?.failedPageCount ?? 0);
  }).catch((error) => {
    trackCrawlError(span, crawlId, url.trim(), error instanceof Error ? error.message : 'Crawl failed');
  });

  return NextResponse.json({ crawlId }, { status: 202 });
}
