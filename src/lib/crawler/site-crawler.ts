import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
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

const activeAbortControllers = new Map<string, AbortController>();

function isServerlessEnv(): boolean {
  return Boolean(
    process.env.VERCEL ||
    process.env.VERCEL_ENV ||
    process.env.AWS_LAMBDA_FUNCTION_VERSION ||
    (process.platform !== 'win32' && process.env.NODE_ENV === 'production'),
  );
}

function delay(ms: number): Promise<void> {
  return ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve();
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

async function extractLinks(page: Page): Promise<string[]> {
  try {
    return await page.evaluate(() =>
      Array.from(document.querySelectorAll('a[href]')).map(a => (a as HTMLAnchorElement).href),
    );
  } catch {
    return [];
  }
}

function addCandidate(
  url: string,
  depth: number,
  seedUrl: string,
  config: CrawlConfig,
  queue: { url: string; depth: number }[],
  scheduled: Set<string>,
): boolean {
  const normalized = normalizeUrl(url);
  if (!isScannable(normalized)) return false;
  if (!isWithinDomainBoundary(normalized, seedUrl, config.domainStrategy)) return false;
  if (!matchesPatterns(normalized, config.includePatterns, config.excludePatterns)) return false;
  if (depth > config.maxDepth || scheduled.has(normalized) || scheduled.size >= config.maxPages) return false;
  scheduled.add(normalized);
  queue.push({ url: normalized, depth });
  return true;
}

async function launchBrowser(serverless: boolean): Promise<Browser> {
  if (serverless) {
    // Accessibility scanning does not require WebGL. Disabling the graphics
    // stack reduces Chromium's memory/CPU footprint in a serverless runtime.
    chromiumBinary.setGraphicsMode = false;
  }

  const executablePath = serverless ? await chromiumBinary.executablePath() : undefined;
  const args = serverless
    ? chromiumBinary.args
    : ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'];

  const browser = await chromium.launch({
    executablePath,
    args,
    headless: true,
    timeout: 60000,
  });

  if (!browser.isConnected()) {
    throw new Error('Chromium launched but disconnected immediately. Check the Vercel Chromium binary/runtime configuration.');
  }

  return browser;
}

async function openPage(context: BrowserContext): Promise<Page> {
  if (!context.browser()?.isConnected()) {
    throw new Error('Chromium browser disconnected before opening a page.');
  }
  return context.newPage();
}

export async function startCrawl(
  crawlId: string,
  seedUrl: string,
  config: CrawlConfig,
  onProgress?: ProgressCallback,
): Promise<void> {
  const abortController = new AbortController();
  activeAbortControllers.set(crawlId, abortController);
  updateCrawl(crawlId, { abortController });

  const completedPages: PageSummary[] = [];
  const queue: { url: string; depth: number }[] = [];
  const scheduled = new Set<string>();
  let effectiveSeedUrl = normalizeUrl(seedUrl);
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;

  try {
    updateCrawl(crawlId, {
      status: 'discovering',
      progress: 5,
      message: 'Fetching robots.txt and sitemaps...',
    });
    emitProgress(crawlId, completedPages, onProgress);

    let robotsSitemapUrls: string[] = [];
    if (config.respectRobotsTxt) {
      await getCrawlDelay(seedUrl);
      robotsSitemapUrls = await getSitemapUrls(seedUrl);
    }
    const sitemapUrls = config.followSitemaps
      ? await discoverSitemapUrls(seedUrl, robotsSitemapUrls)
      : [];

    addCandidate(effectiveSeedUrl, 0, effectiveSeedUrl, config, queue, scheduled);
    for (const sitemapUrl of sitemapUrls) {
      addCandidate(sitemapUrl, 0, effectiveSeedUrl, config, queue, scheduled);
      if (scheduled.size >= config.maxPages) break;
    }

    updateCrawl(crawlId, {
      status: 'scanning',
      progress: 10,
      message: `Starting crawl of ${queue.length} discovered URLs...`,
      discoveredUrls: queue.map(item => item.url),
      totalPageCount: queue.length,
    });
    emitProgress(crawlId, completedPages, onProgress);

    const serverless = isServerlessEnv();
    browser = await launchBrowser(serverless);
    context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      ignoreHTTPSErrors: true,
    });

    // Chromium is resource-heavy on Vercel. Keep one page active at a time in
    // serverless mode; local development can use the requested concurrency.
    const workerCount = Math.max(1, Math.min(serverless ? 1 : config.concurrency, config.maxPages));
    let cursor = 0;

    while (cursor < queue.length && !abortController.signal.aborted) {
      if (!browser.isConnected()) {
        await context.close().catch(() => undefined);
        await browser.close().catch(() => undefined);
        browser = await launchBrowser(serverless);
        context = await browser.newContext({
          viewport: { width: 1440, height: 900 },
          ignoreHTTPSErrors: true,
        });
      }

      const batch = queue.slice(cursor, Math.min(cursor + workerCount, queue.length));
      cursor += batch.length;

      await Promise.all(batch.map(async item => {
        if (abortController.signal.aborted || !context) return;
        if (config.respectRobotsTxt && !(await isAllowedByRobots(item.url))) return;

        let page: Page | undefined;
        const pageId = uuidv4();
        createScan(pageId, item.url);
        updateScan(pageId, { status: 'scanning', progress: 30, message: 'Loading page...' });

        try {
          page = await openPage(context);
          await page.goto(item.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => undefined);

          const currentUrl = normalizeUrl(page.url() || item.url);
          if (item.depth === 0 && currentUrl !== item.url && item.url === effectiveSeedUrl) {
            effectiveSeedUrl = currentUrl;
          }

          updateScan(pageId, { message: 'Running accessibility scan...' });
          const axeResults = await scanPage(page);
          const scanResults = parseAxeResults(currentUrl, axeResults);
          const completedAt = new Date().toISOString();

          updateScan(pageId, {
            status: 'complete',
            progress: 100,
            message: 'Scan complete',
            completedAt,
            results: scanResults,
          });

          completedPages.push({
            pageId,
            url: currentUrl,
            score: scanResults.score.overallScore,
            grade: scanResults.score.grade,
            violationCount: scanResults.violations.length,
            passCount: scanResults.passes.length,
            status: 'complete',
            scannedAt: completedAt,
          });

          const links = item.depth < config.maxDepth ? await extractLinks(page) : [];
          for (const link of links) {
            addCandidate(link, item.depth + 1, effectiveSeedUrl, config, queue, scheduled);
          }

          const crawl = getCrawl(crawlId);
          if (crawl) {
            const completed = crawl.completedPageCount + 1;
            const total = Math.max(crawl.totalPageCount, queue.length);
            updateCrawl(crawlId, {
              completedPageCount: completed,
              totalPageCount: total,
              pageIds: [...crawl.pageIds, pageId],
              progress: Math.min(90, 10 + Math.round(((completed + crawl.failedPageCount) / Math.max(total, 1)) * 80)),
              message: `Scanned ${completed} of ${total} pages`,
              discoveredUrls: queue.map(q => q.url),
            });
          }
        } catch (error: unknown) {
          const errorMsg = error instanceof Error ? error.message : 'Navigation or scan failed';
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
              message: `Page failed: ${item.url}`,
            });
          }
        } finally {
          await page?.close().catch(() => undefined);
          await delay(config.delayMs);
        }

        emitProgress(crawlId, completedPages, onProgress);
      }));
    }

    updateCrawl(crawlId, {
      status: 'aggregating',
      progress: 95,
      message: 'Aggregating results...',
    });
    emitProgress(crawlId, completedPages, onProgress);

    const finalCrawl = getCrawl(crawlId);
    updateCrawl(crawlId, {
      status: abortController.signal.aborted ? 'cancelled' : 'complete',
      progress: 100,
      message: abortController.signal.aborted
        ? 'Crawl cancelled by user'
        : `Crawl complete: ${finalCrawl?.completedPageCount ?? completedPages.length} pages scanned`,
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
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }
}

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
