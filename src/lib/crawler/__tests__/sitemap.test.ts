import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockFetch = vi.fn();

vi.mock('sitemapper', () => {
  return {
    default: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
      this.fetch = mockFetch;
      return this;
    }),
  };
});

import { discoverSitemapUrls } from '../sitemap';

describe('sitemap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ sites: [] });
  });

  describe('discoverSitemapUrls', () => {
    it('returns URLs from robots.txt sitemaps', async () => {
      mockFetch.mockResolvedValue({
        sites: ['https://example.com/page1', 'https://example.com/page2'],
      });

      const urls = await discoverSitemapUrls('https://example.com', [
        'https://example.com/custom-sitemap.xml',
      ]);

      expect(urls).toContain('https://example.com/page1');
      expect(urls).toContain('https://example.com/page2');
    });

    it('checks standard /sitemap.xml location', async () => {
      mockFetch.mockResolvedValue({
        sites: ['https://example.com/about'],
      });

      const urls = await discoverSitemapUrls('https://example.com', []);

      expect(urls).toContain('https://example.com/about');
      // Should have tried /sitemap.xml and /sitemap_index.xml
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('combines and deduplicates URLs from multiple sitemaps', async () => {
      mockFetch
        .mockResolvedValueOnce({ sites: ['https://example.com/page1', 'https://example.com/page2'] })
        .mockResolvedValueOnce({ sites: ['https://example.com/page2', 'https://example.com/page3'] })
        .mockResolvedValueOnce({ sites: ['https://example.com/page1'] });

      const urls = await discoverSitemapUrls('https://example.com', [
        'https://example.com/sitemap-custom.xml',
      ]);

      // Deduplicated: page1, page2, page3
      expect(urls).toHaveLength(3);
      expect(urls).toContain('https://example.com/page1');
      expect(urls).toContain('https://example.com/page2');
      expect(urls).toContain('https://example.com/page3');
    });

    it('continues to next sitemap when one errors', async () => {
      mockFetch
        .mockRejectedValueOnce(new Error('Sitemap fetch failed'))
        .mockResolvedValueOnce({ sites: ['https://example.com/working-page'] })
        .mockResolvedValueOnce({ sites: [] });

      const urls = await discoverSitemapUrls('https://example.com', [
        'https://example.com/broken-sitemap.xml',
      ]);

      expect(urls).toContain('https://example.com/working-page');
    });

    it('returns empty array when all sitemaps fail', async () => {
      mockFetch.mockRejectedValue(new Error('All failed'));

      const urls = await discoverSitemapUrls('https://example.com', []);

      expect(urls).toEqual([]);
    });

    it('returns empty array for invalid origin URL', async () => {
      const urls = await discoverSitemapUrls('not-valid-url', []);

      expect(urls).toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('checks standard locations when sitemapUrlsFromRobots is empty', async () => {
      mockFetch.mockResolvedValue({ sites: [] });

      await discoverSitemapUrls('https://example.com', []);

      // Should try /sitemap.xml and /sitemap_index.xml
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('deduplicates candidate sitemap URLs', async () => {
      mockFetch.mockResolvedValue({ sites: ['https://example.com/page'] });

      // Provide the standard /sitemap.xml as a robots.txt sitemap too
      const urls = await discoverSitemapUrls('https://example.com', [
        'https://example.com/sitemap.xml',
      ]);

      // /sitemap.xml should be deduplicated — only 2 unique candidates
      // (robots sitemap, sitemap_index.xml) since /sitemap.xml is same as standard
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(urls).toContain('https://example.com/page');
    });
  });
});
