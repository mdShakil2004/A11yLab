import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
  });

  async function importStore() {
    return await import('../store');
  }

  // ---------- Scan CRUD ----------

  describe('createScan', () => {
    it('returns a new record with correct initial state', async () => {
      const store = await importStore();
      const record = store.createScan('s1', 'https://example.com');

      expect(record.id).toBe('s1');
      expect(record.url).toBe('https://example.com');
      expect(record.status).toBe('pending');
      expect(record.progress).toBe(0);
      expect(record.message).toBe('Scan queued');
      expect(record.startedAt).toBeDefined();
    });
  });

  describe('getScan', () => {
    it('returns existing scan by ID', async () => {
      const store = await importStore();
      store.createScan('s1', 'https://example.com');
      const scan = store.getScan('s1');
      expect(scan).toBeDefined();
      expect(scan!.id).toBe('s1');
    });

    it('returns undefined for nonexistent ID', async () => {
      const store = await importStore();
      expect(store.getScan('nonexistent')).toBeUndefined();
    });
  });

  describe('updateScan', () => {
    it('modifies scan fields', async () => {
      const store = await importStore();
      store.createScan('s1', 'https://example.com');
      store.updateScan('s1', { status: 'scanning', progress: 50 });

      const scan = store.getScan('s1');
      expect(scan!.status).toBe('scanning');
      expect(scan!.progress).toBe(50);
    });

    it('does nothing for nonexistent scan', async () => {
      const store = await importStore();
      // Should not throw
      store.updateScan('nonexistent', { status: 'complete' });
    });
  });

  // ---------- Crawl CRUD ----------

  describe('createCrawl', () => {
    it('returns a new crawl record with correct initial state', async () => {
      const store = await importStore();
      const config = {
        maxPages: 50,
        maxDepth: 3,
        concurrency: 3,
        delayMs: 1000,
        includePatterns: [],
        excludePatterns: [],
        respectRobotsTxt: true,
        followSitemaps: true,
        domainStrategy: 'same-hostname' as const,
      };
      const record = store.createCrawl('c1', 'https://example.com', config);

      expect(record.id).toBe('c1');
      expect(record.seedUrl).toBe('https://example.com');
      expect(record.status).toBe('pending');
      expect(record.progress).toBe(0);
      expect(record.pageIds).toEqual([]);
      expect(record.discoveredUrls).toEqual([]);
      expect(record.config).toEqual(config);
    });
  });

  describe('getCrawl', () => {
    it('returns existing crawl by ID', async () => {
      const store = await importStore();
      const config = { maxPages: 10, maxDepth: 2, concurrency: 1, delayMs: 500, includePatterns: [], excludePatterns: [], respectRobotsTxt: true, followSitemaps: true, domainStrategy: 'same-hostname' as const };
      store.createCrawl('c1', 'https://example.com', config);
      const crawl = store.getCrawl('c1');
      expect(crawl).toBeDefined();
      expect(crawl!.id).toBe('c1');
    });

    it('returns undefined for nonexistent ID', async () => {
      const store = await importStore();
      expect(store.getCrawl('nonexistent')).toBeUndefined();
    });
  });

  describe('updateCrawl', () => {
    it('modifies crawl fields', async () => {
      const store = await importStore();
      const config = { maxPages: 10, maxDepth: 2, concurrency: 1, delayMs: 500, includePatterns: [], excludePatterns: [], respectRobotsTxt: true, followSitemaps: true, domainStrategy: 'same-hostname' as const };
      store.createCrawl('c1', 'https://example.com', config);
      store.updateCrawl('c1', { status: 'scanning', progress: 30 });

      const crawl = store.getCrawl('c1');
      expect(crawl!.status).toBe('scanning');
      expect(crawl!.progress).toBe(30);
    });
  });

  describe('deleteCrawl', () => {
    it('removes crawl record', async () => {
      const store = await importStore();
      const config = { maxPages: 10, maxDepth: 2, concurrency: 1, delayMs: 500, includePatterns: [], excludePatterns: [], respectRobotsTxt: true, followSitemaps: true, domainStrategy: 'same-hostname' as const };
      store.createCrawl('c1', 'https://example.com', config);
      store.deleteCrawl('c1');
      expect(store.getCrawl('c1')).toBeUndefined();
    });
  });

  describe('getAllCrawls', () => {
    it('returns all crawl records', async () => {
      const store = await importStore();
      const config = { maxPages: 10, maxDepth: 2, concurrency: 1, delayMs: 500, includePatterns: [], excludePatterns: [], respectRobotsTxt: true, followSitemaps: true, domainStrategy: 'same-hostname' as const };
      store.createCrawl('c1', 'https://a.com', config);
      store.createCrawl('c2', 'https://b.com', config);

      const all = store.getAllCrawls();
      expect(all).toHaveLength(2);
      expect(all.map(c => c.id).sort()).toEqual(['c1', 'c2']);
    });

    it('returns empty array when no crawls', async () => {
      const store = await importStore();
      expect(store.getAllCrawls()).toHaveLength(0);
    });
  });

  // ---------- TTL Cleanup ----------

  describe('TTL cleanup', () => {
    it('removes completed scans older than 1 hour after cleanup runs', async () => {
      const store = await importStore();
      store.createScan('s1', 'https://example.com');
      store.updateScan('s1', { status: 'complete' });

      // Advance past SCAN_TTL (15min) + CLEANUP_INTERVAL (5min)
      vi.advanceTimersByTime(20 * 60 * 1000);

      expect(store.getScan('s1')).toBeUndefined();
    });

    it('preserves scans within TTL', async () => {
      const store = await importStore();
      store.createScan('s1', 'https://example.com');
      store.updateScan('s1', { status: 'complete' });

      // Advance only 3 minutes — within 15min TTL, before first cleanup fires
      vi.advanceTimersByTime(3 * 60 * 1000);

      expect(store.getScan('s1')).toBeDefined();
    });

    it('preserves pending scans regardless of age', async () => {
      const store = await importStore();
      store.createScan('s1', 'https://example.com');
      // status is 'pending' — should not be cleaned up

      vi.advanceTimersByTime(120 * 60 * 1000);

      expect(store.getScan('s1')).toBeDefined();
    });

    it('removes completed crawls and associated scans after TTL', async () => {
      const store = await importStore();
      const config = { maxPages: 10, maxDepth: 2, concurrency: 1, delayMs: 500, includePatterns: [], excludePatterns: [], respectRobotsTxt: true, followSitemaps: true, domainStrategy: 'same-hostname' as const };

      // Create a crawl with page scan references
      store.createScan('page1', 'https://example.com/1');
      store.createScan('page2', 'https://example.com/2');
      store.createCrawl('c1', 'https://example.com', config);
      store.updateCrawl('c1', { status: 'complete', pageIds: ['page1', 'page2'] });

      // Advance past CRAWL_TTL (30min) + CLEANUP_INTERVAL (5min)
      vi.advanceTimersByTime(35 * 60 * 1000);

      expect(store.getCrawl('c1')).toBeUndefined();
      // Associated page scans should also be removed
      expect(store.getScan('page1')).toBeUndefined();
      expect(store.getScan('page2')).toBeUndefined();
    });

    it('preserves crawls within TTL', async () => {
      const store = await importStore();
      const config = { maxPages: 10, maxDepth: 2, concurrency: 1, delayMs: 500, includePatterns: [], excludePatterns: [], respectRobotsTxt: true, followSitemaps: true, domainStrategy: 'same-hostname' as const };

      store.createCrawl('c1', 'https://example.com', config);
      store.updateCrawl('c1', { status: 'complete' });

      // Advance 3 minutes — within 30min TTL
      vi.advanceTimersByTime(3 * 60 * 1000);

      expect(store.getCrawl('c1')).toBeDefined();
    });
  });
});
