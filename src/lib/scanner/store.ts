import type { ScanRecord } from '../types/scan';
import type { CrawlRecord, CrawlConfig } from '../types/crawl';

// In-memory store. Crawl requests run to completion in one Vercel Function
// invocation, so the crawl lifecycle remains on the same instance without
// requiring an external database or Redis service.
const scans = new Map<string, ScanRecord>();
const crawls = new Map<string, CrawlRecord>();

export function createScan(id: string, url: string): ScanRecord {
  const record: ScanRecord = {
    id,
    url,
    status: 'pending',
    progress: 0,
    message: 'Scan queued',
    startedAt: new Date().toISOString(),
  };
  scans.set(id, record);
  return record;
}

export function getScan(id: string): ScanRecord | undefined {
  return scans.get(id);
}

export async function getScanAsync(id: string): Promise<ScanRecord | undefined> {
  return scans.get(id);
}

export function updateScan(id: string, updates: Partial<ScanRecord>): void {
  const scan = scans.get(id);
  if (scan) Object.assign(scan, updates);
}

export function createCrawl(id: string, seedUrl: string, config: CrawlConfig): CrawlRecord {
  const record: CrawlRecord = {
    id,
    seedUrl,
    config,
    status: 'pending',
    progress: 0,
    message: 'Crawl queued',
    startedAt: new Date().toISOString(),
    discoveredUrls: [],
    pageIds: [],
    completedPageCount: 0,
    failedPageCount: 0,
    totalPageCount: 0,
  };
  crawls.set(id, record);
  return record;
}

export function getCrawl(id: string): CrawlRecord | undefined {
  return crawls.get(id);
}

export async function getCrawlAsync(id: string): Promise<CrawlRecord | undefined> {
  return crawls.get(id);
}

export function updateCrawl(id: string, updates: Partial<CrawlRecord>): void {
  const crawl = crawls.get(id);
  if (crawl) Object.assign(crawl, updates);
}

export function deleteCrawl(id: string): void {
  crawls.delete(id);
}

export function getAllCrawls(): CrawlRecord[] {
  return Array.from(crawls.values());
}

const SCAN_TTL_MS = 15 * 60 * 1000;
const CRAWL_TTL_MS = 30 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

function cleanupExpired(): void {
  const now = Date.now();
  for (const [id, scan] of scans) {
    if (scan.status === 'complete' || scan.status === 'error') {
      if (now - new Date(scan.startedAt).getTime() > SCAN_TTL_MS) scans.delete(id);
    }
  }
  for (const [id, crawl] of crawls) {
    if (crawl.status === 'complete' || crawl.status === 'error' || crawl.status === 'cancelled') {
      if (now - new Date(crawl.startedAt).getTime() > CRAWL_TTL_MS) {
        for (const pageId of crawl.pageIds) scans.delete(pageId);
        crawls.delete(id);
      }
    }
  }
}

setInterval(cleanupExpired, CLEANUP_INTERVAL_MS);
