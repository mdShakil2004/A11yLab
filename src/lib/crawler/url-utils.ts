const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'gclsrc', 'dclid', 'msclkid',
]);

const NON_SCANNABLE_EXTENSIONS = new Set([
  '.pdf', '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.ico', '.bmp', '.tiff',
  '.css', '.js', '.mjs', '.cjs', '.map',
  '.zip', '.tar', '.gz', '.rar', '.7z',
  '.mp3', '.mp4', '.wav', '.avi', '.mov', '.webm', '.ogg',
  '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.xml', '.rss', '.atom', '.json', '.csv',
]);

/**
 * Normalize a URL for deduplication:
 * - Lowercase hostname
 * - Remove fragment (#...)
 * - Remove trailing slash (except root path "/")
 * - Remove tracking parameters (utm_*, fbclid, gclid, etc.)
 * - Remove default ports (80 for http, 443 for https)
 * - Sort query parameters alphabetically
 */
export function normalizeUrl(urlString: string): string {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    return urlString;
  }

  // Lowercase hostname
  parsed.hostname = parsed.hostname.toLowerCase();

  // Remove fragment
  parsed.hash = '';

  // Remove default ports
  if (
    (parsed.protocol === 'http:' && parsed.port === '80') ||
    (parsed.protocol === 'https:' && parsed.port === '443')
  ) {
    parsed.port = '';
  }

  // Remove tracking params and sort remaining
  const params = new URLSearchParams(parsed.searchParams);
  const keysToDelete: string[] = [];
  for (const key of params.keys()) {
    if (TRACKING_PARAMS.has(key.toLowerCase())) {
      keysToDelete.push(key);
    }
  }
  for (const key of keysToDelete) {
    params.delete(key);
  }
  params.sort();
  parsed.search = params.toString() ? `?${params.toString()}` : '';

  let result = parsed.toString();

  // Remove trailing slash (except root path)
  if (result.endsWith('/') && parsed.pathname !== '/') {
    result = result.slice(0, -1);
  }

  return result;
}

/**
 * Check if a URL matches the domain boundary strategy.
 * 'same-hostname': exact hostname match
 * 'same-domain': same registrable domain (e.g., sub.example.com matches example.com)
 */
export function isWithinDomainBoundary(
  candidateUrl: string,
  seedUrl: string,
  strategy: 'same-hostname' | 'same-domain'
): boolean {
  let candidate: URL;
  let seed: URL;
  try {
    candidate = new URL(candidateUrl);
    seed = new URL(seedUrl);
  } catch {
    return false;
  }

  const candidateHost = candidate.hostname.toLowerCase();
  const seedHost = seed.hostname.toLowerCase();

  if (strategy === 'same-hostname') {
    return candidateHost === seedHost;
  }

  // same-domain: extract registrable domain (last two segments, or last three for co.uk-style TLDs)
  const candidateDomain = getRegistrableDomain(candidateHost);
  const seedDomain = getRegistrableDomain(seedHost);
  return candidateDomain === seedDomain;
}

/**
 * Simple registrable domain extraction.
 * Returns the last two segments (e.g., "example.com" from "sub.example.com").
 */
function getRegistrableDomain(hostname: string): string {
  const parts = hostname.split('.');
  if (parts.length <= 2) return hostname;
  return parts.slice(-2).join('.');
}

/**
 * Check if a URL should be scanned (HTML page, not binary/asset).
 * Exclude common non-page extensions.
 */
export function isScannable(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  // Only scan http/https
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }

  const pathname = parsed.pathname.toLowerCase();
  const lastDot = pathname.lastIndexOf('.');
  if (lastDot !== -1) {
    const ext = pathname.slice(lastDot);
    if (NON_SCANNABLE_EXTENSIONS.has(ext)) {
      return false;
    }
  }

  return true;
}

/**
 * Apply include/exclude patterns (glob-style) to filter URLs.
 * If includePatterns is empty, all URLs pass the include check.
 * If any excludePattern matches, the URL is excluded.
 */
export function matchesPatterns(
  url: string,
  includePatterns: string[],
  excludePatterns: string[]
): boolean {
  // Check exclude patterns first
  for (const pattern of excludePatterns) {
    if (globMatch(url, pattern)) return false;
  }

  // If no include patterns, allow all
  if (includePatterns.length === 0) return true;

  // At least one include pattern must match
  for (const pattern of includePatterns) {
    if (globMatch(url, pattern)) return true;
  }
  return false;
}

/**
 * Simple glob matching: converts glob pattern to regex.
 * Supports * (any non-slash chars) and ** (any chars including slashes).
 */
function globMatch(input: string, pattern: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // escape regex special chars (except * and ?)
    .replace(/\*\*/g, '{{GLOBSTAR}}')       // placeholder for **
    .replace(/\*/g, '[^/]*')                // * = any non-slash
    .replace(/\?/g, '[^/]')                 // ? = single non-slash char
    .replace(/\{\{GLOBSTAR\}\}/g, '.*');    // ** = anything

  const regex = new RegExp(`^${escaped}$`, 'i');
  return regex.test(input);
}
