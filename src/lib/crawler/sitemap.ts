import Sitemapper from 'sitemapper';

/**
 * Discover and parse sitemaps for a given origin URL.
 * Discovery order:
 * 1. Try sitemap URLs provided by robots.txt
 * 2. Try standard /sitemap.xml location
 * 3. Try /sitemap_index.xml
 * Returns deduplicated array of page URLs from all discovered sitemaps.
 * Gracefully handles missing or invalid sitemaps (returns empty array).
 */
export async function discoverSitemapUrls(
  originUrl: string,
  sitemapUrlsFromRobots: string[]
): Promise<string[]> {
  let origin: URL;
  try {
    origin = new URL(originUrl);
  } catch {
    return [];
  }

  const discoveredUrls = new Set<string>();
  const sitemapper = new Sitemapper({ timeout: 15000, requestHeaders: { 'User-Agent': 'AccessibilityScanBot/1.0' } });

  // Build the list of sitemap URLs to try
  const sitemapCandidates = [
    ...sitemapUrlsFromRobots,
    `${origin.protocol}//${origin.host}/sitemap.xml`,
    `${origin.protocol}//${origin.host}/sitemap_index.xml`,
  ];

  // Deduplicate candidates
  const uniqueCandidates = [...new Set(sitemapCandidates)];

  for (const sitemapUrl of uniqueCandidates) {
    try {
      const result = await sitemapper.fetch(sitemapUrl);
      if (result.sites && Array.isArray(result.sites)) {
        for (const site of result.sites) {
          if (typeof site === 'string') {
            discoveredUrls.add(site);
          }
        }
      }
    } catch {
      // Invalid or unreachable sitemap — continue to next candidate
    }
  }

  return Array.from(discoveredUrls);
}
