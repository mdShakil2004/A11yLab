import type { APIRequestContext } from '@playwright/test';

/**
 * Seed a scan result by triggering a scan via the API.
 * Polls until complete before returning the scan ID.
 */
export async function seedScanResult(
  request: APIRequestContext
): Promise<string> {
  const response = await request.post('/api/scan', {
    data: { url: 'https://example.com' },
  });
  if (!response.ok()) {
    throw new Error(`Failed to start scan: ${response.status()}`);
  }
  const { scanId } = await response.json();

  // Poll until complete or error
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const poll = await request.get(`/api/scan/${scanId}`);
    if (!poll.ok()) continue;
    const data = await poll.json();
    if (data.status === 'complete') return scanId;
    if (data.status === 'error')
      throw new Error(`Scan failed: ${data.error || data.message}`);
  }
  throw new Error('Scan timed out after 120 seconds');
}

/**
 * Seed a crawl result by triggering a crawl via the API.
 * Uses minimal settings (maxPages: 2, maxDepth: 1) for speed.
 * Polls until complete before returning the crawl ID.
 */
export async function seedCrawlResult(
  request: APIRequestContext
): Promise<string> {
  const response = await request.post('/api/crawl', {
    data: { url: 'https://example.com', maxPages: 2, maxDepth: 1 },
  });
  if (!response.ok()) {
    throw new Error(`Failed to start crawl: ${response.status()}`);
  }
  const { crawlId } = await response.json();

  // Poll until complete or error
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const poll = await request.get(`/api/crawl/${crawlId}`);
    if (!poll.ok()) continue;
    const data = await poll.json();
    if (data.status === 'complete') return crawlId;
    if (data.status === 'error' || data.status === 'cancelled') {
      throw new Error(`Crawl failed: ${data.error || data.message}`);
    }
  }
  throw new Error('Crawl timed out after 180 seconds');
}
