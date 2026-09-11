import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { createCrawl, getCrawl, getScan } from '@/lib/scanner/store';
import type { CrawlConfig, CrawlRequest } from '@/lib/types/crawl';
import { trackCrawlStart, trackCrawlComplete, trackCrawlError } from '@/lib/telemetry';
import { createLogger } from '@/lib/logger';

export const runtime = 'nodejs';
export const maxDuration = 300;

const log = createLogger('api:crawl');

function isValidScanUrl(input: string): boolean {
  if (!input || typeof input !== 'string' || input.length > 2048) return false;
  let parsed: URL;
  try { parsed = new URL(input.trim()); } catch { return false; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  const hostname = parsed.hostname;
  if (
    hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' ||
    hostname === '0.0.0.0' || hostname.startsWith('10.') || hostname.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) || hostname.startsWith('fc') ||
    hostname.startsWith('fd') || hostname.endsWith('.local') || hostname.endsWith('.internal')
  ) return false;
  return true;
}

function validateConfig(body: CrawlRequest): { config: CrawlConfig; error?: string } {
  const maxPages = body.maxPages ?? 25;
  const maxDepth = body.maxDepth ?? 3;
  const concurrency = body.concurrency ?? 3;
  const delayMs = body.delayMs ?? 1000;
  if (maxPages < 1 || maxPages > 100) return { config: null as unknown as CrawlConfig, error: 'maxPages must be between 1 and 100' };
  if (maxDepth < 1 || maxDepth > 10) return { config: null as unknown as CrawlConfig, error: 'maxDepth must be between 1 and 10' };
  if (concurrency < 1 || concurrency > 5) return { config: null as unknown as CrawlConfig, error: 'concurrency must be between 1 and 5' };
  return { config: { maxPages, maxDepth, concurrency, delayMs, includePatterns: body.includePatterns ?? [], excludePatterns: body.excludePatterns ?? [], respectRobotsTxt: body.respectRobotsTxt ?? true, followSitemaps: body.followSitemaps ?? true, domainStrategy: body.domainStrategy ?? 'same-hostname' } };
}

export async function POST(request: NextRequest) {
  let body: CrawlRequest;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }
  const { url } = body;
  if (!url || typeof url !== 'string') return NextResponse.json({ error: 'URL is required' }, { status: 400 });
  if (!isValidScanUrl(url)) return NextResponse.json({ error: 'Invalid URL. Only public HTTP/HTTPS URLs are allowed.' }, { status: 400 });

  const { config, error } = validateConfig(body);
  if (error) return NextResponse.json({ error }, { status: 400 });

  const crawlId = uuidv4();
  const normalizedUrl = url.trim();
  createCrawl(crawlId, normalizedUrl, config);
  log.info('Crawl requested', { crawlId, url: normalizedUrl, maxPages: config.maxPages, maxDepth: config.maxDepth });

  const startTime = Date.now();
  const span = trackCrawlStart(crawlId, normalizedUrl);

  try {
    // No Redis and no background job. The crawl and all page scans finish in
    // this same function invocation, so the in-memory records remain valid.
    const { startCrawl } = await import('@/lib/crawler/site-crawler');
    await startCrawl(crawlId, normalizedUrl, config);

    const crawl = getCrawl(crawlId);
    if (!crawl) throw new Error('Crawl result was lost before completion.');

    const pages = crawl.pageIds
      .map((pageId) => getScan(pageId))
      .filter((page): page is NonNullable<typeof page> => Boolean(page))
      .map((page) => ({
        pageId: page.id,
        url: page.url,
        score: page.results?.score.overallScore ?? 0,
        grade: page.results?.score.grade ?? 'F',
        violationCount: page.results?.violations.length ?? 0,
        passCount: page.results?.passes.length ?? 0,
        status: page.status,
        scannedAt: page.completedAt ?? page.startedAt,
      }));

    trackCrawlComplete(span, crawlId, normalizedUrl, Date.now() - startTime, crawl.completedPageCount, crawl.failedPageCount);

    return NextResponse.json({ crawlId, status: crawl.status, progress: crawl.progress, crawl, pages });
  } catch (crawlError) {
    const message = crawlError instanceof Error ? crawlError.message : 'Crawl failed';
    trackCrawlError(span, crawlId, normalizedUrl, message);
    log.error('Crawl failed', { crawlId, error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
