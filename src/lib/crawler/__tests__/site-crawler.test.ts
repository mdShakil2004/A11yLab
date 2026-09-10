import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { CrawlConfig } from '../../types/crawl';

// Capture the handlers passed to PlaywrightCrawler constructor
let _capturedOptions: Record<string, unknown>;

vi.mock('crawlee', () => ({
  PlaywrightCrawler: vi.fn().mockImplementation(function (this: Record<string, unknown>, options: Record<string, unknown>) {
    _capturedOptions = options;
    this.run = vi.fn().mockResolvedValue(undefined);
    return this;
  }),
  Configuration: {
    getGlobalConfig: vi.fn().mockReturnValue({ set: vi.fn() }),
  },
  RequestQueue: {
    open: vi.fn().mockResolvedValue({
      drop: vi.fn().mockResolvedValue(undefined),
    }),
  },
  purgeDefaultStorages: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('uuid', () => ({ v4: vi.fn().mockReturnValue('mock-page-id') }));

vi.mock('../../scanner/engine', () => ({
  scanPage: vi.fn().mockResolvedValue({
    violations: [],
    passes: [],
    incomplete: [],
    inapplicable: [],
    testEngine: { name: 'axe-core', version: '4.10.0' },
  }),
}));

vi.mock('../../scanner/result-parser', () => ({
  parseAxeResults: vi.fn().mockReturnValue({
    violations: [],
    passes: [],
    score: { overallScore: 95, grade: 'A' },
  }),
}));

vi.mock('../../scanner/store', () => ({
  createScan: vi.fn(),
  updateScan: vi.fn(),
  getCrawl: vi.fn().mockReturnValue({
    id: 'crawl-1',
    status: 'scanning',
    progress: 10,
    message: '',
    completedPageCount: 0,
    failedPageCount: 0,
    totalPageCount: 1,
    pageIds: [],
  }),
  updateCrawl: vi.fn(),
}));

vi.mock('../url-utils', () => ({
  normalizeUrl: vi.fn((url: string) => url),
  isWithinDomainBoundary: vi.fn().mockReturnValue(true),
  isScannable: vi.fn().mockReturnValue(true),
  matchesPatterns: vi.fn().mockReturnValue(true),
}));

vi.mock('../robots', () => ({
  isAllowedByRobots: vi.fn().mockResolvedValue(true),
  getCrawlDelay: vi.fn().mockResolvedValue(null),
  getSitemapUrls: vi.fn().mockResolvedValue([]),
  clearRobotsCache: vi.fn(),
}));

vi.mock('../sitemap', () => ({
  discoverSitemapUrls: vi.fn().mockResolvedValue([]),
}));

import { startCrawl, cancelCrawl } from '../site-crawler';
import { getCrawlDelay, getSitemapUrls, clearRobotsCache, isAllowedByRobots } from '../robots';
import { discoverSitemapUrls } from '../sitemap';
import { updateCrawl, getCrawl, createScan, updateScan } from '../../scanner/store';
import { scanPage } from '../../scanner/engine';
import { parseAxeResults } from '../../scanner/result-parser';
import { isWithinDomainBoundary, isScannable, matchesPatterns } from '../url-utils';

const defaultConfig: CrawlConfig = {
  maxPages: 50,
  maxDepth: 3,
  concurrency: 3,
  delayMs: 1000,
  includePatterns: [],
  excludePatterns: [],
  respectRobotsTxt: true,
  followSitemaps: true,
  domainStrategy: 'same-hostname',
};

describe('site-crawler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _capturedOptions = {};
    vi.mocked(getCrawl).mockReturnValue({
      id: 'crawl-1',
      seedUrl: 'https://example.com',
      config: defaultConfig,
      status: 'scanning',
      progress: 10,
      message: '',
      startedAt: new Date().toISOString(),
      completedPageCount: 0,
      failedPageCount: 0,
      totalPageCount: 1,
      pageIds: [],
      discoveredUrls: [],
    });
  });

  describe('startCrawl', () => {
    it('transitions through discovering → scanning → aggregating → complete', async () => {
      await startCrawl('crawl-1', 'https://example.com', defaultConfig);

      const statusCalls = vi.mocked(updateCrawl).mock.calls;
      const statuses = statusCalls
        .filter(([, data]) => data.status)
        .map(([, data]) => data.status);

      expect(statuses).toContain('discovering');
      expect(statuses).toContain('scanning');
      expect(statuses).toContain('aggregating');
      expect(statuses).toContain('complete');
    });

    it('calls getCrawlDelay and getSitemapUrls when respectRobotsTxt is true', async () => {
      await startCrawl('crawl-1', 'https://example.com', {
        ...defaultConfig,
        respectRobotsTxt: true,
      });

      expect(getCrawlDelay).toHaveBeenCalledWith('https://example.com');
      expect(getSitemapUrls).toHaveBeenCalledWith('https://example.com');
    });

    it('skips robot functions when respectRobotsTxt is false', async () => {
      await startCrawl('crawl-1', 'https://example.com', {
        ...defaultConfig,
        respectRobotsTxt: false,
      });

      expect(getCrawlDelay).not.toHaveBeenCalled();
      expect(getSitemapUrls).not.toHaveBeenCalled();
    });

    it('calls discoverSitemapUrls when followSitemaps is true', async () => {
      await startCrawl('crawl-1', 'https://example.com', {
        ...defaultConfig,
        followSitemaps: true,
      });

      expect(discoverSitemapUrls).toHaveBeenCalled();
    });

    it('skips sitemap discovery when followSitemaps is false', async () => {
      await startCrawl('crawl-1', 'https://example.com', {
        ...defaultConfig,
        followSitemaps: false,
      });

      expect(discoverSitemapUrls).not.toHaveBeenCalled();
    });

    it('calls clearRobotsCache in finally block', async () => {
      await startCrawl('crawl-1', 'https://example.com', defaultConfig);

      expect(clearRobotsCache).toHaveBeenCalled();
    });

    it('calls clearRobotsCache even when crawler.run rejects', async () => {
      const crawlee = await import('crawlee');
      vi.mocked(crawlee.PlaywrightCrawler).mockImplementationOnce(function (this: Record<string, unknown>, options: Record<string, unknown>) {
        _capturedOptions = options;
        this.run = vi.fn().mockRejectedValue(new Error('Crawl failed'));
        return this;
      });

      await startCrawl('crawl-err', 'https://example.com', defaultConfig);

      expect(clearRobotsCache).toHaveBeenCalled();
    });

    it('sets status to error when crawl throws', async () => {
      const crawlee = await import('crawlee');
      vi.mocked(crawlee.PlaywrightCrawler).mockImplementationOnce(function (this: Record<string, unknown>, options: Record<string, unknown>) {
        _capturedOptions = options;
        this.run = vi.fn().mockRejectedValue(new Error('Crawl failed'));
        return this;
      });

      await startCrawl('crawl-1', 'https://example.com', defaultConfig);

      const statusCalls = vi.mocked(updateCrawl).mock.calls;
      const errorUpdate = statusCalls.find(([, data]) => data.status === 'error');
      expect(errorUpdate).toBeDefined();
    });

    it('calls onProgress callback during crawl', async () => {
      const onProgress = vi.fn();

      await startCrawl('crawl-1', 'https://example.com', defaultConfig, onProgress);

      expect(onProgress).toHaveBeenCalled();
      // Verify at least one call has the expected shape
      const firstCall = onProgress.mock.calls[0][0];
      expect(firstCall).toHaveProperty('status');
      expect(firstCall).toHaveProperty('progress');
      expect(firstCall).toHaveProperty('message');
    });

    it('stores abortController on the crawl record', async () => {
      await startCrawl('crawl-1', 'https://example.com', defaultConfig);

      const calls = vi.mocked(updateCrawl).mock.calls;
      const abortUpdate = calls.find(([, data]) => 'abortController' in data);
      expect(abortUpdate).toBeDefined();
    });

    it('seeds only the primary URL regardless of sitemap size', async () => {
      // Simulate a large sitemap that returns many URLs
      const sitemapUrls = Array.from({ length: 200 }, (_, i) => `https://example.com/page${i}`);
      vi.mocked(discoverSitemapUrls).mockResolvedValueOnce(sitemapUrls);

      const crawlee = await import('crawlee');
      let capturedRunArg: string[] = [];
      vi.mocked(crawlee.PlaywrightCrawler).mockImplementationOnce(function (this: Record<string, unknown>, options: Record<string, unknown>) {
        _capturedOptions = options;
        this.run = vi.fn().mockImplementation((urls: string[]) => {
          capturedRunArg = urls;
          return Promise.resolve();
        });
        return this;
      });

      const config = { ...defaultConfig, maxPages: 50 };
      await startCrawl('crawl-cap', 'https://example.com', config);

      // Only the primary seed should be passed to crawler.run()
      expect(capturedRunArg).toEqual(['https://example.com']);
    });
  });

  describe('cancelCrawl', () => {
    it('returns true and sets cancelled status when crawl exists', async () => {
      // Start a crawl that hangs on run() so we can cancel it
      let resolveRun: () => void;
      const runPromise = new Promise<void>((resolve) => { resolveRun = resolve; });
      const crawlee = await import('crawlee');
      vi.mocked(crawlee.PlaywrightCrawler).mockImplementationOnce(function (this: Record<string, unknown>, options: Record<string, unknown>) {
        _capturedOptions = options;
        this.run = vi.fn().mockReturnValue(runPromise);
        return this;
      });

      // Start without awaiting — crawl will hang on run()
      const crawlPromise = startCrawl('crawl-cancel', 'https://example.com', defaultConfig);

      // Wait for async setup to register the abort controller
      await new Promise(resolve => setTimeout(resolve, 50));

      const result = cancelCrawl('crawl-cancel');

      expect(result).toBe(true);

      const statusCalls = vi.mocked(updateCrawl).mock.calls;
      const cancelUpdate = statusCalls.find(([, data]) => data.status === 'cancelled');
      expect(cancelUpdate).toBeDefined();

      // Resolve the hanging run to let the promise settle
      resolveRun!();
      await crawlPromise;
    });

    it('returns false when crawl does not exist', () => {
      const result = cancelCrawl('nonexistent-crawl');

      expect(result).toBe(false);
    });
  });

  describe('requestHandler', () => {
    async function getRequestHandler(crawlId = 'crawl-rh', seed = 'https://example.com') {
      const crawlee = await import('crawlee');
      vi.mocked(crawlee.PlaywrightCrawler).mockImplementationOnce(function (this: Record<string, unknown>, options: Record<string, unknown>) {
        _capturedOptions = options;
        this.run = vi.fn().mockResolvedValue(undefined);
        return this;
      });
      await startCrawl(crawlId, seed, defaultConfig);
      return _capturedOptions.requestHandler as (ctx: Record<string, unknown>) => Promise<void>;
    }

    function createMockContext(url = 'https://example.com/page1') {
      return {
        page: { evaluate: vi.fn() },
        request: { url, loadedUrl: url },
        enqueueLinks: vi.fn().mockResolvedValue(undefined),
      };
    }

    it('scans a page and stores results on success', async () => {
      const handler = await getRequestHandler();
      const ctx = createMockContext();

      await handler(ctx);

      expect(createScan).toHaveBeenCalled();
      expect(scanPage).toHaveBeenCalled();
      expect(parseAxeResults).toHaveBeenCalled();
      expect(vi.mocked(updateScan).mock.calls.some(([, data]) => data.status === 'complete')).toBe(true);
    });

    it('skips already visited URLs', async () => {
      const handler = await getRequestHandler();
      const ctx = createMockContext('https://example.com/dupe');

      await handler(ctx);
      vi.mocked(createScan).mockClear();

      await handler(ctx);
      expect(createScan).not.toHaveBeenCalled();
    });

    it('skips URLs outside domain boundary', async () => {
      vi.mocked(isWithinDomainBoundary).mockReturnValueOnce(false);
      const handler = await getRequestHandler();
      const ctx = createMockContext('https://other.com/page');

      await handler(ctx);
      expect(createScan).not.toHaveBeenCalled();
    });

    it('skips URLs that fail pattern matching', async () => {
      vi.mocked(matchesPatterns).mockReturnValueOnce(false);
      const handler = await getRequestHandler();
      const ctx = createMockContext('https://example.com/excluded');

      await handler(ctx);
      expect(createScan).not.toHaveBeenCalled();
    });

    it('skips non-scannable URLs', async () => {
      vi.mocked(isScannable).mockReturnValueOnce(false);
      const handler = await getRequestHandler();
      const ctx = createMockContext('https://example.com/file.pdf');

      await handler(ctx);
      expect(createScan).not.toHaveBeenCalled();
    });

    it('skips URLs blocked by robots.txt', async () => {
      vi.mocked(isAllowedByRobots).mockResolvedValueOnce(false);
      const handler = await getRequestHandler();
      const ctx = createMockContext('https://example.com/blocked');

      await handler(ctx);
      expect(createScan).not.toHaveBeenCalled();
    });

    it('handles scan errors gracefully', async () => {
      vi.mocked(scanPage).mockRejectedValueOnce(new Error('Scan crashed'));
      const handler = await getRequestHandler();
      const ctx = createMockContext('https://example.com/error-page');

      await handler(ctx);
      expect(vi.mocked(updateScan).mock.calls.some(([, data]) => data.status === 'error')).toBe(true);
    });

    it('enqueues links when within depth limit', async () => {
      const handler = await getRequestHandler();
      const ctx = createMockContext('https://example.com/shallow');

      await handler(ctx);
      expect(ctx.enqueueLinks).toHaveBeenCalled();
    });

    it('handles seed URL redirect by updating effective seed for domain checks', async () => {
      // Simulate: seed is https://ontario.ca, but it redirects to https://www.ontario.ca
      // With same-hostname strategy, domain check must still pass after redirect
      vi.mocked(isWithinDomainBoundary).mockImplementation((candidate: string, seed: string) => {
        const candidateHost = new URL(candidate).hostname;
        const seedHost = new URL(seed).hostname;
        return candidateHost === seedHost;
      });

      const handler = await getRequestHandler('crawl-redirect', 'https://ontario.ca');
      const ctx = {
        page: { evaluate: vi.fn() },
        request: {
          url: 'https://ontario.ca',
          loadedUrl: 'https://www.ontario.ca/page/government-ontario',
        },
        enqueueLinks: vi.fn().mockResolvedValue(undefined),
      };

      await handler(ctx);

      // The page should have been scanned despite the hostname mismatch
      expect(createScan).toHaveBeenCalled();
      expect(scanPage).toHaveBeenCalled();
    });
  });

  describe('failedRequestHandler', () => {
    async function getFailedRequestHandler() {
      const crawlee = await import('crawlee');
      vi.mocked(crawlee.PlaywrightCrawler).mockImplementationOnce(function (this: Record<string, unknown>, options: Record<string, unknown>) {
        _capturedOptions = options;
        this.run = vi.fn().mockResolvedValue(undefined);
        return this;
      });
      await startCrawl('crawl-fh', 'https://example.com', defaultConfig);
      return _capturedOptions.failedRequestHandler as (ctx: Record<string, unknown>, error: Error) => Promise<void>;
    }

    it('records failed page with error status', async () => {
      const handler = await getFailedRequestHandler();

      await handler(
        { request: { url: 'https://example.com/fail' } },
        new Error('Navigation timeout')
      );

      expect(createScan).toHaveBeenCalled();
      expect(vi.mocked(updateScan).mock.calls.some(
        ([, data]) => data.status === 'error' && data.message === 'Navigation timeout'
      )).toBe(true);
    });

    it('increments failedPageCount on the crawl record', async () => {
      const handler = await getFailedRequestHandler();

      await handler(
        { request: { url: 'https://example.com/fail2' } },
        new Error('Connection refused')
      );

      expect(vi.mocked(updateCrawl).mock.calls.some(
        ([, data]) => typeof data.failedPageCount === 'number'
      )).toBe(true);
    });
  });
});
