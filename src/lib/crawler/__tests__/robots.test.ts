import { vi, describe, it, expect, beforeEach } from 'vitest';
import robotsParser from 'robots-parser';

vi.mock('robots-parser', () => ({
  default: vi.fn(),
}));

const mockRobotsParser = vi.mocked(robotsParser);

describe('robots', () => {
  let mockParser: {
    isAllowed: ReturnType<typeof vi.fn>;
    getCrawlDelay: ReturnType<typeof vi.fn>;
    getSitemaps: ReturnType<typeof vi.fn>;
  };

  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    mockParser = {
      isAllowed: vi.fn().mockReturnValue(true),
      getCrawlDelay: vi.fn().mockReturnValue(undefined),
      getSitemaps: vi.fn().mockReturnValue([]),
    };
    mockRobotsParser.mockReturnValue(mockParser as never);

    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue('User-agent: *\nAllow: /'),
    });
  });

  async function importRobots() {
    return await import('../robots');
  }

  describe('isAllowedByRobots', () => {
    it('returns true for allowed URL', async () => {
      const { isAllowedByRobots } = await importRobots();
      mockParser.isAllowed.mockReturnValue(true);

      const result = await isAllowedByRobots('https://example.com/page');

      expect(result).toBe(true);
    });

    it('returns false for disallowed URL', async () => {
      const { isAllowedByRobots } = await importRobots();
      mockParser.isAllowed.mockReturnValue(false);

      const result = await isAllowedByRobots('https://example.com/private');

      expect(result).toBe(false);
    });

    it('treats undefined parser result as allowed', async () => {
      const { isAllowedByRobots } = await importRobots();
      mockParser.isAllowed.mockReturnValue(undefined);

      const result = await isAllowedByRobots('https://example.com/unknown');

      expect(result).toBe(true);
    });
  });

  describe('caching', () => {
    it('caches parser per hostname — fetch called only once for same domain', async () => {
      const { isAllowedByRobots } = await importRobots();

      await isAllowedByRobots('https://example.com/page1');
      await isAllowedByRobots('https://example.com/page2');

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('fetches again after clearRobotsCache', async () => {
      const { isAllowedByRobots, clearRobotsCache } = await importRobots();

      await isAllowedByRobots('https://example.com/page1');
      clearRobotsCache();
      await isAllowedByRobots('https://example.com/page2');

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('error handling', () => {
    it('returns permissive parser on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      const { isAllowedByRobots } = await importRobots();

      const result = await isAllowedByRobots('https://example.com/page');

      // robotsParser called with empty robots txt → permissive
      expect(result).toBe(true);
    });

    it('returns permissive parser on HTTP 404', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
      const { isAllowedByRobots } = await importRobots();

      const result = await isAllowedByRobots('https://example.com/page');

      expect(result).toBe(true);
    });

    it('returns permissive parser for invalid URL', async () => {
      const { isAllowedByRobots } = await importRobots();

      const result = await isAllowedByRobots('not-a-valid-url');

      expect(result).toBe(true);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('getCrawlDelay', () => {
    it('returns delay in milliseconds when specified', async () => {
      mockParser.getCrawlDelay.mockReturnValue(2);
      const { getCrawlDelay } = await importRobots();

      const delay = await getCrawlDelay('https://example.com');

      expect(delay).toBe(2000);
    });

    it('returns null when no crawl delay specified', async () => {
      mockParser.getCrawlDelay.mockReturnValue(undefined);
      const { getCrawlDelay } = await importRobots();

      const delay = await getCrawlDelay('https://example.com');

      expect(delay).toBeNull();
    });
  });

  describe('getSitemapUrls', () => {
    it('returns sitemaps from parser', async () => {
      const sitemaps = ['https://example.com/sitemap.xml', 'https://example.com/sitemap2.xml'];
      mockParser.getSitemaps.mockReturnValue(sitemaps);
      const { getSitemapUrls } = await importRobots();

      const result = await getSitemapUrls('https://example.com');

      expect(result).toEqual(sitemaps);
    });

    it('returns empty array when no sitemaps', async () => {
      mockParser.getSitemaps.mockReturnValue([]);
      const { getSitemapUrls } = await importRobots();

      const result = await getSitemapUrls('https://example.com');

      expect(result).toEqual([]);
    });
  });
});
