import robotsParser from 'robots-parser';

const CUSTOM_USER_AGENT = 'AccessibilityScanBot/1.0';

// Cache robots.txt parsers per hostname to avoid repeated fetches during a crawl
const robotsCache = new Map<string, ReturnType<typeof robotsParser>>();

/**
 * Fetch and parse robots.txt for a given URL's origin.
 * Caches per hostname to avoid repeated fetches during a crawl.
 * Gracefully handles missing or malformed robots.txt (allows all).
 */
export async function getRobotsParser(originUrl: string): Promise<ReturnType<typeof robotsParser>> {
  let origin: URL;
  try {
    origin = new URL(originUrl);
  } catch {
    // Invalid URL — return a permissive parser
    return robotsParser('', '');
  }

  const hostname = origin.hostname.toLowerCase();
  const cached = robotsCache.get(hostname);
  if (cached) return cached;

  const robotsUrl = `${origin.protocol}//${origin.host}/robots.txt`;
  let robotsTxt = '';
  try {
    const response = await fetch(robotsUrl, {
      headers: { 'User-Agent': CUSTOM_USER_AGENT },
      signal: AbortSignal.timeout(10000),
    });
    if (response.ok) {
      robotsTxt = await response.text();
    }
  } catch {
    // Network error or timeout — allow all
  }

  const parser = robotsParser(robotsUrl, robotsTxt);
  robotsCache.set(hostname, parser);
  return parser;
}

/**
 * Check if a URL is allowed by robots.txt for our user agent.
 * Returns true if allowed or if robots.txt is unavailable.
 */
export async function isAllowedByRobots(url: string): Promise<boolean> {
  const parser = await getRobotsParser(url);
  const result = parser.isAllowed(url, CUSTOM_USER_AGENT);
  // isAllowed returns undefined if no matching rule — treat as allowed
  return result !== false;
}

/**
 * Get the crawl delay from robots.txt (for our user agent or wildcard).
 * Returns delay in milliseconds, or null if not specified.
 */
export async function getCrawlDelay(originUrl: string): Promise<number | null> {
  const parser = await getRobotsParser(originUrl);
  const delay = parser.getCrawlDelay(CUSTOM_USER_AGENT);
  if (delay !== undefined) return delay * 1000; // convert seconds to ms
  return null;
}

/**
 * Get sitemap URLs listed in robots.txt.
 */
export async function getSitemapUrls(originUrl: string): Promise<string[]> {
  const parser = await getRobotsParser(originUrl);
  return parser.getSitemaps();
}

/**
 * Clear the robots.txt cache (called when a crawl finishes).
 */
export function clearRobotsCache(): void {
  robotsCache.clear();
}
