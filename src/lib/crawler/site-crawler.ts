import { PlaywrightCrawler, Configuration, RequestQueue, purgeDefaultStorages, type PlaywrightCrawlingContext } from '@crawlee/playwright';
import { chromium } from 'playwright-core';
import chromiumBinary from '@sparticuz/chromium';
import { v4 as uuidv4 } from 'uuid';
import { scanPage } from '../scanner/engine';
import { parseAxeResults } from '../scanner/result-parser';
import { createScan, updateScan, getCrawl, updateCrawl } from '../scanner/store';
import { normalizeUrl, isWithinDomainBoundary, isScannable, matchesPatterns } from './url-utils';
import { isAllowedByRobots, getCrawlDelay, getSitemapUrls, clearRobotsCache } from './robots';
import { discoverSitemapUrls } from './sitemap';
import type { CrawlConfig, CrawlProgressEvent, PageSummary } from '../types/crawl';

export type ProgressCallback = (event: CrawlProgressEvent) => void;

// Active AbortControllers keyed by crawlId
const activeAbortControllers = new Map<string, AbortController>();

function isServerlessEnv(): boolean {
  const hasVercelEnv = !!process.env.VERCEL || !!process.env.VERCEL_ENV;
  const hasLambdaEnv = !!process.env.AWS_LAMBDA_FUNCTION_VERSION;
  const looksLikeProdLinux = process.platform !== 'win32' && process.env.NODE_ENV === 'production';
  return hasVercelEnv || hasLambdaEnv || looksLikeProdLinux;
}

export async function startCrawl(
  crawlId: string,
  seedUrl: string,
  config: CrawlConfig,
  onProgress?: ProgressCallback
): Promise<void> {
  const abortController = new AbortController();
  activeAbortControllers.set(crawlId, abortController);
  updateCrawl(crawlId, { abortController });

  const completedPages: PageSummary[] = [];
  const visitedUrls = new Set<string>();
  let effectiveSeedUrl = seedUrl;
  let requestQueue: Awaited<ReturnType<typeof RequestQueue.open>> | undefined;

  try {
    updateCrawl(crawlId, { status: 'discovering', progress: 5, message: 'Fetching robots.txt and sitemaps...' });
    emitProgress(crawlId, completedPages, onProgress);

    let robotsCrawlDelay: number | null = null;
    let robotsSitemapUrls: string[] = [];
    if (config.respectRobotsTxt) {
      robotsCrawlDelay = await getCrawlDelay(seedUrl);
      robotsSitemapUrls = await getSitemapUrls(seedUrl);
    }

    const effectiveDelay = robotsCrawlDelay !== null ? Math.max(config.delayMs, robotsCrawlDelay) : config.delayMs;

    let sitemapUrls: string[] = [];
    if (config.followSitemaps) {
      sitemapUrls = await discoverSitemapUrls(seedUrl, robotsSitemapUrls);
    }

    const primarySeed = normalizeUrl(seedUrl);
    const totalEstimate = Math.min(sitemapUrls.length + 1, config.maxPages);
    updateCrawl(crawlId, {
      status: 'scanning',
      progress: 10,
      message: `Starting crawl of ${totalEstimate} discovered URLs...`,
      discoveredUrls: [primarySeed],
      totalPageCount: totalEstimate,
    });
    emitProgress(crawlId, completedPages, onProgress);

    Configuration.getGlobalConfig().set('persistStorage', false);
    await purgeDefaultStorages();
    requestQueue = await RequestQueue.open(`crawl-${crawlId}`);

    const urlDepth = new Map<string, number>();
    urlDepth.set(primarySeed, 0);

    const serverless = isServerlessEnv();
    const executablePath = serverless ? await chromiumBinary.executablePath() : undefined;

    const crawler = new PlaywrightCrawler({
      maxRequestsPerCrawl: config.maxPages,
      maxConcurrency: config.concurrency,
      requestHandlerTimeoutSecs: 60,
      navigationTimeoutSecs: 30,
      requestQueue,
      launchContext: {
        launcher: chromium as any, // eslint-disable-line @typescript-eslint/no-explicit-any
        launchOptions: {
          headless: true,
          executablePath,
          args: serverless
            ? chromiumBinary.args
            : ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--single-process'],
        },
      },
      browserPoolOptions: { useFingerprints: false },

      async requestHandler(context: PlaywrightCrawlingContext) {
        const { page, request, enqueueLinks } = context;
        const currentUrl = normalizeUrl(request.loadedUrl || request.url);

        if (request.loadedUrl && visitedUrls.size === 0) {
          const requestedUrl = normalizeUrl(request.url);
          if (requestedUrl === primarySeed && currentUrl !== primarySeed) effectiveSeedUrl = currentUrl;
        }

        if (abortController.signal.aborted) return;
        if (visitedUrls.has(currentUrl)) return;
        if (!isWithinDomainBoundary(currentUrl, effectiveSeedUrl, config.domainStrategy)) return;
        if (!matchesPatterns(currentUrl, config.includePatterns, config.excludePatterns)) return;
        if (!isScannable(currentUrl)) return;

        if (config.respectRobotsTxt) {
          const allowed = await isAllowedByRobots(currentUrl);
          if (!allowed) return;
        }

        visitedUrls.add(currentUrl);
        const pageId = uuidv4();
        createScan(pageId, currentUrl);
        updateScan(pageId, { status: 'scanning', progress: 30, message: 'Running accessibility scan...' });

        try {
          const axeResults = await scanPage(page as any); // eslint-disable-line @typescript-eslint/no-explicit-any
          const scanResults = parseAxeResults(currentUrl, axeResults);

          updateScan(pageId, {
            status: 'complete', progress: 100, message: 'Scan complete',
            completedAt: new Date().toISOString(), results: scanResults,
          });

          completedPages.push({
            pageId, url: currentUrl, score: scanResults.score.overallScore,
            grade: scanResults.score.grade, violationCount: scanResults.violations.length,
            passCount: scanResults.passes.length, status: 'complete', scannedAt: new Date().toISOString(),
          });

          const crawl = getCrawl(crawlId);
          if (crawl) {
            const newCompletedCount = crawl.completedPageCount + 1;
            const totalPages = Math.max(crawl.totalPageCount, newCompletedCount + crawl.failedPageCount);
            const progressPct = Math.min(90, Math.round(((newCompletedCount + crawl.failedPageCount) / totalPages) * 80) + 10);
            updateCrawl(crawlId, {
              completedPageCount: newCompletedCount, totalPageCount: totalPages,
              pageIds: [...crawl.pageIds, pageId], progress: progressPct,
              message: `Scanned ${newCompletedCount} of ${totalPages} pages`,
            });
          }
        } catch (scanError: unknown) {
          const errorMsg = scanError instanceof Error ? scanError.message : 'Unknown scan error';
          updateScan(pageId, {
            status: 'error', progress: 100, message: errorMsg, error: errorMsg,
            completedAt: new Date().toISOString(),
          });
          const crawl = getCrawl(crawlId);
          if (crawl) updateCrawl(crawlId, {
            failedPageCount: crawl.failedPageCount + 1,
            pageIds: [...crawl.pageIds, pageId],
          });
        }

        emitProgress(crawlId, completedPages, onProgress);

        const currentDepth = urlDepth.get(currentUrl) ?? 0;
        if (currentDepth < config.maxDepth) {
          await enqueueLinks({
            strategy: 'same-hostname',
            transformRequestFunction: (req) => {
              const normalized = normalizeUrl(req.url);
              if (!isScannable(normalized)) return false;
              if (!isWithinDomainBoundary(normalized, effectiveSeedUrl, config.domainStrategy)) return false;
              if (!matchesPatterns(normalized, config.includePatterns, config.excludePatterns)) return false;
              if (visitedUrls.has(normalized)) return false;
              if (!urlDepth.has(normalized)) urlDepth.set(normalized, currentDepth + 1);
              req.url = normalized;
              return req;
            },
          });
        }

        if (effectiveDelay > 0) await new Promise(resolve => setTimeout(resolve, effectiveDelay));
      },

      async failedRequestHandler({ request }, error) {
        const failUrl = normalizeUrl(request.url);
        if (visitedUrls.has(failUrl)) return;
        visitedUrls.add(failUrl);
        const pageId = uuidv4();
        createScan(pageId, failUrl);
        const errorMsg = error instanceof Error ? error.message : 'Navigation failed';
        updateScan(pageId, {
          status: 'error', progress: 100, message: errorMsg, error: errorMsg,
          completedAt: new Date().toISOString(),
        });
        const crawl = getCrawl(crawlId);
        if (crawl) updateCrawl(crawlId, {
          failedPageCount: crawl.failedPageCount + 1,
          pageIds: [...crawl.pageIds, pageId],
        });
        emitProgress(crawlId, completedPages, onProgress);
      },
    });

    await crawler.run([primarySeed]);

    updateCrawl(crawlId, { status: 'aggregating', progress: 95, message: 'Aggregating results...' });
    emitProgress(crawlId, completedPages, onProgress);

    const finalCrawl = getCrawl(crawlId);
    updateCrawl(crawlId, {
      status: 'complete', progress: 100,
      message: `Crawl complete: ${finalCrawl?.completedPageCount ?? 0} pages scanned`,
      completedAt: new Date().toISOString(),
    });
    emitProgress(crawlId, completedPages, onProgress);
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : 'Crawl failed';
    const crawl = getCrawl(crawlId);
    if (crawl && crawl.status !== 'cancelled') {
      updateCrawl(crawlId, { status: 'error', progress: 100, message: errorMsg, error: errorMsg, completedAt: new Date().toISOString() });
    }
    emitProgress(crawlId, completedPages, onProgress);
  } finally {
    activeAbortControllers.delete(crawlId);
    clearRobotsCache();
    if (requestQueue) await requestQueue.drop().catch(() => {});
  }
}

export function cancelCrawl(crawlId: string): boolean {
  const controller = activeAbortControllers.get(crawlId);
  if (!controller) return false;
  controller.abort();
  activeAbortControllers.delete(crawlId);
  updateCrawl(crawlId, { status: 'cancelled', progress: 100, message: 'Crawl cancelled by user', completedAt: new Date().toISOString() });
  return true;
}

function emitProgress(crawlId: string, completedPages: PageSummary[], onProgress?: ProgressCallback): void {
  if (!onProgress) return;
  const crawl = getCrawl(crawlId);
  if (!crawl) return;
  onProgress({
    status: crawl.status,
    progress: crawl.progress,
    message: crawl.message,
    completedPages: completedPages.length,
    failedPages: crawl.failedPageCount,
    totalPages: crawl.totalPageCount,
    pagesCompleted: completedPages,
  });
}
