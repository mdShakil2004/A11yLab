import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { createCrawl, getCrawl, getScan } from '@/lib/scanner/store';
import { startCrawl } from '@/lib/crawler/site-crawler';
import { evaluateThreshold, getDefaultThreshold } from '@/lib/ci/threshold';
import { calculateSiteScore, aggregateViolations } from '@/lib/scoring/site-calculator';
import { formatJunit } from '@/lib/ci/formatters/junit';
import { generateSiteSarif } from '@/lib/report/sarif-generator';
import type { CiCrawlRequest, CiResult, CiViolationSummary, CrawlConfig } from '@/lib/types/crawl';
import type { ScanRecord } from '@/lib/types/scan';
import { trackCrawlStart, trackCrawlComplete, trackCrawlError } from '@/lib/telemetry';
import { createLogger } from '@/lib/logger';

const log = createLogger('api:ci:crawl');

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

const CRAWL_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export async function POST(request: NextRequest) {
  let body: CiCrawlRequest;
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

  const config: CrawlConfig = {
    maxPages: Math.min(Math.max(body.maxPages ?? 50, 1), 200),
    maxDepth: Math.min(Math.max(body.maxDepth ?? 3, 1), 10),
    concurrency: Math.min(Math.max(body.concurrency ?? 3, 1), 5),
    delayMs: 1000,
    includePatterns: Array.isArray(body.includePatterns) ? body.includePatterns : [],
    excludePatterns: Array.isArray(body.excludePatterns) ? body.excludePatterns : [],
    respectRobotsTxt: true,
    followSitemaps: true,
    domainStrategy: 'same-hostname',
  };

  const crawlId = uuidv4();
  log.info('CI crawl requested', { crawlId, url: url.trim(), maxPages: config.maxPages, format: body.format ?? 'json' });
  createCrawl(crawlId, url.trim(), config);

  const startTime = Date.now();
  const span = trackCrawlStart(crawlId, url.trim());
  try {
    // Synchronous crawl — blocks until complete, with timeout
    await Promise.race([
      startCrawl(crawlId, url.trim(), config),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Crawl timed out after 30 minutes')), CRAWL_TIMEOUT_MS)
      ),
    ]);

    const crawl = getCrawl(crawlId);
    if (!crawl) {
      return NextResponse.json({ error: 'Crawl record not found' }, { status: 500 });
    }

    // Gather page scan records
    const pageRecords: ScanRecord[] = crawl.pageIds
      .map((id) => getScan(id))
      .filter((r): r is ScanRecord => r != null);

    // Calculate site-wide score and violations
    const siteScore = calculateSiteScore(pageRecords);
    const aggregated = aggregateViolations(pageRecords);

    // Threshold evaluation
    const thresholdConfig = body.threshold ?? getDefaultThreshold();
    const thresholdEvaluation = evaluateThreshold(
      siteScore.overallScore,
      // Flatten page violations for threshold evaluation
      pageRecords.flatMap((r) => r.results?.violations ?? []),
      thresholdConfig
    );

    // Build violation summaries from aggregated data
    const violations: CiViolationSummary[] = aggregated.map((v) => ({
      ruleId: v.ruleId,
      impact: v.impact,
      description: v.description,
      instanceCount: v.totalInstances,
      helpUrl: v.helpUrl,
    }));

    // Deduped, in-scope list of successfully-scanned page URLs. Consumed by CI
    // pipelines that use the crawler purely as a URL discoverer and then drive
    // their own multi-engine scan loop over these URLs.
    const discoveredUrls: string[] = Array.from(
      new Set(pageRecords.filter((r) => r.results != null).map((r) => r.url))
    );

    const ciResult: CiResult = {
      passed: thresholdEvaluation.scorePassed && thresholdEvaluation.countPassed && thresholdEvaluation.rulePassed,
      score: siteScore.overallScore,
      grade: siteScore.grade,
      url: url.trim(),
      timestamp: new Date().toISOString(),
      violationCount: aggregated.length,
      thresholdEvaluation,
      violations,
      urls: discoveredUrls,
    };

    // Format response
    const format = body.format ?? 'json';

    trackCrawlComplete(span, crawlId, url.trim(), Date.now() - startTime, pageRecords.length, crawl.failedPageCount);

    if (format === 'sarif') {
      const pages = pageRecords
        .filter((r) => r.results != null)
        .map((r) => ({ url: r.url, violations: r.results!.violations }));
      const sarifLog = generateSiteSarif(pages, pageRecords[0]?.results?.engineVersion ?? 'unknown');
      return new NextResponse(JSON.stringify(sarifLog, null, 2), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (format === 'junit') {
      const junitOutput = formatJunit(ciResult);
      return new NextResponse(junitOutput, {
        status: 200,
        headers: { 'Content-Type': 'application/xml' },
      });
    }

    return NextResponse.json(ciResult);
  } catch (error) {
    trackCrawlError(span, crawlId, url.trim(), error instanceof Error ? error.message : 'Crawl failed');
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Crawl failed' },
      { status: 500 }
    );
  }
}
