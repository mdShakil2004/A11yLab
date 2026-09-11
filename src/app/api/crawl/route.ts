import { NextRequest, NextResponse, after } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { createCrawl, getCrawl, persistCrawl } from '@/lib/scanner/store';
import type { CrawlConfig, CrawlRequest } from '@/lib/types/crawl';
import { trackCrawlStart, trackCrawlComplete, trackCrawlError } from '@/lib/telemetry';
import { createLogger } from '@/lib/logger';

export const runtime = 'nodejs';
export const maxDuration = 300;

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
  const normalizedUrl = url.trim();

  log.info('Crawl requested', {
    crawlId,
    url: normalizedUrl,
    maxPages: config.maxPages,
    maxDepth: config.maxDepth,
  });

  createCrawl(crawlId, normalizedUrl, config);

  // Persist the job before returning. This is required because the progress
  // requests can be routed to a different Vercel Function instance.
  try {
    await persistCrawl(crawlId);
  } catch (error) {
    log.error('Failed to persist crawl job', {
      crawlId,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: 'Crawl storage is not configured. Connect Upstash Redis to this Vercel project and redeploy.' },
      { status: 503 },
    );
  }

  const startTime = Date.now();

  after(async () => {
    const span = trackCrawlStart(crawlId, normalizedUrl);
    try {
      const { startCrawl } = await import('@/lib/crawler/site-crawler');
      await startCrawl(crawlId, normalizedUrl, config);

      const crawl = getCrawl(crawlId);
      trackCrawlComplete(
        span,
        crawlId,
        normalizedUrl,
        Date.now() - startTime,
        crawl?.completedPageCount ?? 0,
        crawl?.failedPageCount ?? 0,
      );
    } catch (crawlError) {
      trackCrawlError(
        span,
        crawlId,
        normalizedUrl,
        crawlError instanceof Error ? crawlError.message : 'Crawl failed',
      );
    }
  });

  return NextResponse.json({ crawlId }, { status: 202 });
}
