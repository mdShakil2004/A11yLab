import { PlaywrightCrawler, Configuration, RequestQueue, purgeDefaultStorages, type PlaywrightCrawlingContext } from 'crawlee';
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

/**
 * True when running inside a serverless/Lambda-style environment (Vercel
 * Functions, AWS Lambda) where the filesystem is read-only/ephemeral and
 * Playwright's own browser download is unavailable. Mirrors the same check
 * in scanner/engine.ts — kept local here to avoid a runtime import cycle.
 */
function isServerlessEnv(): boolean {
  const hasVercelEnv = !!process.env.VERCEL || !!process.env.VERCEL_ENV;
  const hasLambdaEnv = !!process.env.AWS_LAMBDA_FUNCTION_VERSION;
  const looksLikeProdLinux =
    process.platform !== 'win32' && process.env.NODE_ENV === 'production';
  return hasVercelEnv || hasLambdaEnv || looksLikeProdLinux;
}

/**
 * Start a site crawl. Runs asynchronously, updates store as pages complete.
 *
 * Flow:
 * 1. Validate seed URL and fetch robots.txt
 * 2. Discover sitemap URLs and seed the queue
 * 3. Launch PlaywrightCrawler with BFS traversal
 * 4. For each page: navigate → scanPage() → parse → score → store
 * 5. Emit progress events per page completion
 * 6. On completion: update crawl record to 'complete'
 */
export async function startCrawl(
  crawlId: string,
  seedUrl: string,
  config: CrawlConfig,
  onProgress?: ProgressCallback
): Promise<void> {
  const abortController = new AbortController();
  activeAbortControllers.set(crawlId, abortController);

  // Also store on the CrawlRecord for external access
  updateCrawl(crawlId, { abortController });

  const completedPages: PageSummary[] = [];
  const visitedUrls = new Set<string>();

  // The effective seed URL may change if the seed redirects (e.g. ontario.ca → www.ontario.ca).
  // We update this on the first request so domain boundary checks use the post-redirect hostname.
  let effectiveSeedUrl = seedUrl;

  // Per-crawl request queue — declared here so it can be dropped in finally
  let requestQueue: Awaited<ReturnType<typeof RequestQueue.open>> | undefined;

  try {
    // Phase: discovering
    updateCrawl(crawlId, { status: 'discovering', progress: 5, message: 'Fetching robots.txt and sitemaps...' });
    emitProgress(crawlId, completedPages, onProgress);

    // Fetch robots.txt info
    let robotsCrawlDelay: number | null = null;
    let robotsSitemapUrls: string[] = [];
    if (config.respectRobotsTxt) {
      robotsCrawlDelay = await getCrawlDelay(seedUrl);
      robotsSitemapUrls = await getSitemapUrls(seedUrl);
    }

    // Use robots.txt crawl delay if present and larger than configured delay
    const effectiveDelay = robotsCrawlDelay !== null
      ? Math.max(config.delayMs, robotsCrawlDelay)
      : config.delayMs;

    // Discover sitemap URLs
    let sitemapUrls: string[] = [];
    if (config.followSitemaps) {
      sitemapUrls = await discoverSitemapUrls(seedUrl, robotsSitemapUrls);
    }

    // Only seed the primary URL into crawlee's queue. Sitemap URLs are NOT
    // pre-loaded because crawlee counts every enqueued URL against
    // maxRequestsPerCrawl — pre-loading hundreds of sitemap URLs exhausts
    // the budget before the processing loop starts, causing 0-result crawls.
    // Pages are discovered naturally via enqueueLinks during BFS traversal.
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

    // Purge default storages before each crawl to clear any stale state,
    // then open a uniquely-named RequestQueue so this crawl is fully isolated
    // from previous runs. Without this, crawlee's default singleton queue
    // retains "already handled" URLs, causing subsequent crawls to shut down
    // with 0 results.
    Configuration.getGlobalConfig().set('persistStorage', false);
    await purgeDefaultStorages();
    requestQueue = await RequestQueue.open(`crawl-${crawlId}`);

    // Track depth per URL
    const urlDepth = new Map<string, number>();
    urlDepth.set(primarySeed, 0);

    // Resolve the serverless-compatible Chromium executable path once, up
    // front, so it's ready before the crawler is constructed. Locally (dev,
    // non-serverless) this stays undefined and Playwright falls back to the
    // browser cached via `npx playwright install`, same as before.
    const serverless = isServerlessEnv();
    const executablePath = serverless ? await chromiumBinary.executablePath() : undefined;

    const crawler = new PlaywrightCrawler({
      maxRequestsPerCrawl: config.maxPages,
      maxConcurrency: config.concurrency,
      requestHandlerTimeoutSecs: 60,
      navigationTimeoutSecs: 30,
      requestQueue,
      launchContext: {
        // Use our own playwright-core `chromium` launcher instead of letting
        // Crawlee import the full `playwright` package internally. This is
        // what keeps the Page type consistent with scanner/engine.ts (both
        // now resolve to the same playwright-core types, avoiding the
        // "Page is missing properties" TS error), and it's also what lets us
        // point at @sparticuz/chromium's serverless binary on Vercel.
        //
        // Type assertion needed: Crawlee's PlaywrightLaunchContext types
        // `launcher` against the full `playwright` package's BrowserType,
        // not `playwright-core`'s. The two are structurally near-identical
        // (playwright is a thin wrapper around playwright-core) and the
        // runtime object works correctly either way — this mismatch is a
        // types-only artifact of having two separately-versioned copies of
        // playwright-core in node_modules (top-level, and nested under
        // playwright/node_modules via @playwright/test), not a real
        // incompatibility.
        launcher: chromium as any, // eslint-disable-line @typescript-eslint/no-explicit-any
        launchOptions: {
          headless: true,
          executablePath,
          args: serverless
            ? chromiumBinary.args
            : [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--single-process',
              ],
        },
      },
      browserPoolOptions: {
        useFingerprints: false,
      },

      async requestHandler(context: PlaywrightCrawlingContext) {
        const { page, request, enqueueLinks } = context;
        const currentUrl = normalizeUrl(request.loadedUrl || request.url);

        // If the seed URL redirected (e.g. ontario.ca → www.ontario.ca),
        // update the effective seed so domain boundary checks pass for
        // the redirected hostname.
        if (request.loadedUrl && visitedUrls.size === 0) {
          const requestedUrl = normalizeUrl(request.url);
          if (requestedUrl === primarySeed && currentUrl !== primarySeed) {
            effectiveSeedUrl = currentUrl;
          }
        }

        // Check abort
        if (abortController.signal.aborted) return;

        // Skip if already visited
        if (visitedUrls.has(currentUrl)) return;

        // Domain boundary check
        if (!isWithinDomainBoundary(currentUrl, effectiveSeedUrl, config.domainStrategy)) return;

        // Pattern check
        if (!matchesPatterns(currentUrl, config.includePatterns, config.excludePatterns)) return;

        // Scannable check
        if (!isScannable(currentUrl)) return;

        // Robots.txt check
        if (config.respectRobotsTxt) {
          const allowed = await isAllowedByRobots(currentUrl);
          if (!allowed) return;
        }

        visitedUrls.add(currentUrl);

        const pageId = uuidv4();
        createScan(pageId, currentUrl);
        updateScan(pageId, { status: 'scanning', progress: 30, message: 'Running accessibility scan...' });

        try {
          // Scan the page with axe-core
          const axeResults = await scanPage(page);
          const scanResults = parseAxeResults(currentUrl, axeResults);

          // Store scan result
          updateScan(pageId, {
            status: 'complete',
            progress: 100,
            message: 'Scan complete',
            completedAt: new Date().toISOString(),
            results: scanResults,
          });

          // Build page summary
          const pageSummary: PageSummary = {
            pageId,
            url: currentUrl,
            score: scanResults.score.overallScore,
            grade: scanResults.score.grade,
            violationCount: scanResults.violations.length,
            passCount: scanResults.passes.length,
            status: 'complete',
            scannedAt: new Date().toISOString(),
          };
          completedPages.push(pageSummary);

          // Update crawl record
          const crawl = getCrawl(crawlId);
          if (crawl) {
            const newCompletedCount = crawl.completedPageCount + 1;
            const totalPages = Math.max(crawl.totalPageCount, newCompletedCount + crawl.failedPageCount);
            const progressPct = Math.min(90, Math.round(((newCompletedCount + crawl.failedPageCount) / totalPages) * 80) + 10);

            updateCrawl(crawlId, {
              completedPageCount: newCompletedCount,
              totalPageCount: totalPages,
              pageIds: [...crawl.pageIds, pageId],
              progress: progressPct,
              message: `Scanned ${newCompletedCount} of ${totalPages} pages`,
            });
          }
        } catch (scanError: unknown) {
          // Failed page — log but don't halt crawl
          const errorMsg = scanError instanceof Error ? scanError.message : 'Unknown scan error';
          updateScan(pageId, {
            status: 'error',
            progress: 100,
            message: errorMsg,
            error: errorMsg,
            completedAt: new Date().toISOString(),
          });

          const crawl = getCrawl(crawlId);
          if (crawl) {
            updateCrawl(crawlId, {
              failedPageCount: crawl.failedPageCount + 1,
              pageIds: [...crawl.pageIds, pageId],
            });
          }
        }

        // Emit progress
        emitProgress(crawlId, completedPages, onProgress);

        // Enqueue discovered links for BFS (respecting depth)
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

              // Track depth for newly discovered URLs
              if (!urlDepth.has(normalized)) {
                urlDepth.set(normalized, currentDepth + 1);
              }

              req.url = normalized;
              return req;
            },
          });
        }

        // Respect crawl delay between requests
        if (effectiveDelay > 0) {
          await new Promise(resolve => setTimeout(resolve, effectiveDelay));
        }
      },

      async failedRequestHandler({ request }, error) {
        const failUrl = normalizeUrl(request.url);
        if (visitedUrls.has(failUrl)) return;
        visitedUrls.add(failUrl);

        const pageId = uuidv4();
        createScan(pageId, failUrl);
        const errorMsg = error instanceof Error ? error.message : 'Navigation failed';
        updateScan(pageId, {
          status: 'error',
          progress: 100,
          message: errorMsg,
          error: errorMsg,
          completedAt: new Date().toISOString(),
        });

        const crawl = getCrawl(crawlId);
        if (crawl) {
          updateCrawl(crawlId, {
            failedPageCount: crawl.failedPageCount + 1,
            pageIds: [...crawl.pageIds, pageId],
          });
        }
        emitProgress(crawlId, completedPages, onProgress);
      },
    });

    // Seed only the primary URL. Pages are discovered via enqueueLinks
    // during BFS traversal, which keeps maxRequestsPerCrawl from being
    // exhausted before the processing loop starts.
    await crawler.run([primarySeed]);

    // Aggregation phase
    updateCrawl(crawlId, { status: 'aggregating', progress: 95, message: 'Aggregating results...' });
    emitProgress(crawlId, completedPages, onProgress);

    // Mark crawl complete
    const finalCrawl = getCrawl(crawlId);
    updateCrawl(crawlId, {
      status: 'complete',
      progress: 100,
      message: `Crawl complete: ${finalCrawl?.completedPageCount ?? 0} pages scanned`,
      completedAt: new Date().toISOString(),
    });
    emitProgress(crawlId, completedPages, onProgress);

  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : 'Crawl failed';
    const crawl = getCrawl(crawlId);
    if (crawl && crawl.status !== 'cancelled') {
      updateCrawl(crawlId, {
        status: 'error',
        progress: 100,
        message: errorMsg,
        error: errorMsg,
        completedAt: new Date().toISOString(),
      });
    }
    emitProgress(crawlId, completedPages, onProgress);
  } finally {
    activeAbortControllers.delete(crawlId);
    clearRobotsCache();
    // Drop the per-crawl request queue to free memory
    if (requestQueue) {
      await requestQueue.drop().catch(() => {});
    }
  }
}

/**
 * Cancel a running crawl by aborting its AbortController.
 * Returns true if the crawl was found and cancelled.
 */
export function cancelCrawl(crawlId: string): boolean {
  const controller = activeAbortControllers.get(crawlId);
  if (!controller) return false;

  controller.abort();
  activeAbortControllers.delete(crawlId);

  updateCrawl(crawlId, {
    status: 'cancelled',
    progress: 100,
    message: 'Crawl cancelled by user',
    completedAt: new Date().toISOString(),
  });

  return true;
}

function emitProgress(
  crawlId: string,
  completedPages: PageSummary[],
  onProgress?: ProgressCallback
): void {
  if (!onProgress) return;

  const crawl = getCrawl(crawlId);
  if (!crawl) return;

  onProgress({
    status: crawl.status,
    progress: crawl.progress,
    message: crawl.message,
    totalPages: crawl.totalPageCount,
    completedPages: crawl.completedPageCount,
    failedPages: crawl.failedPageCount,
    pagesCompleted: completedPages,
  });
}
