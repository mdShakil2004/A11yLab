import { Redis } from '@upstash/redis';
import type { ScanRecord } from '../types/scan';
import type { CrawlRecord, CrawlConfig } from '../types/crawl';

const scans = new Map<string, ScanRecord>();
const crawls = new Map<string, CrawlRecord>();

/**
 * Vercel Functions are stateless and different requests can execute on
 * different instances. Use Upstash Redis when configured so crawl progress,
 * page scans, and reports survive instance changes. Local/in-memory storage
 * remains available for development when Redis is not configured.
 *
 * Supported environment variable pairs:
 * - UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
 * - KV_REST_API_URL / KV_REST_API_TOKEN (Vercel Marketplace integration)
 */
const redisUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const redis = redisUrl && redisToken ? new Redis({ url: redisUrl, token: redisToken }) : null;

const SCAN_TTL_SECONDS = 15 * 60;
const CRAWL_TTL_SECONDS = 30 * 60;

const crawlWriteChains = new Map<string, Promise<void>>();
const scanWriteChains = new Map<string, Promise<void>>();

function crawlKey(id: string): string {
  return `a11ylab:crawl:${id}`;
}

function scanKey(id: string): string {
  return `a11ylab:scan:${id}`;
}

function serializableCrawl(record: CrawlRecord): Omit<CrawlRecord, 'abortController'> {
  const { abortController: _abortController, ...serializable } = record;
  return serializable;
}

function queueCrawlPersist(record: CrawlRecord): void {
  if (!redis) return;

  const snapshot = serializableCrawl(record);
  const key = crawlKey(record.id);
  const previous = crawlWriteChains.get(key) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(() => redis.set(key, snapshot, { ex: CRAWL_TTL_SECONDS }).then(() => undefined));

  crawlWriteChains.set(key, next);
  void next.finally(() => {
    if (crawlWriteChains.get(key) === next) crawlWriteChains.delete(key);
  });
}

function queueScanPersist(record: ScanRecord): void {
  if (!redis) return;

  const snapshot = { ...record };
  const key = scanKey(record.id);
  const previous = scanWriteChains.get(key) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(() => redis.set(key, snapshot, { ex: SCAN_TTL_SECONDS }).then(() => undefined));

  scanWriteChains.set(key, next);
  void next.finally(() => {
    if (scanWriteChains.get(key) === next) scanWriteChains.delete(key);
  });
}

/** Awaitable persistence used by the API immediately after creating a job. */
export async function persistCrawl(id: string): Promise<void> {
  const crawl = crawls.get(id);
  if (!crawl || !redis) return;
  queueCrawlPersist(crawl);
  await (crawlWriteChains.get(crawlKey(id)) ?? Promise.resolve());
}

/** Awaitable persistence used when an API needs a scan available remotely. */
export async function persistScan(id: string): Promise<void> {
  const scan = scans.get(id);
  if (!scan || !redis) return;
  queueScanPersist(scan);
  await (scanWriteChains.get(scanKey(id)) ?? Promise.resolve());
}

// ---------- Scan CRUD ----------

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
  queueScanPersist(record);
  return record;
}

export function getScan(id: string): ScanRecord | undefined {
  return scans.get(id);
}

export async function getScanAsync(id: string): Promise<ScanRecord | undefined> {
  const local = scans.get(id);
  if (local || !redis) return local;

  const remote = await redis.get<ScanRecord>(scanKey(id));
  if (remote) scans.set(id, remote);
  return remote ?? undefined;
}

export function updateScan(id: string, updates: Partial<ScanRecord>): void {
  const scan = scans.get(id);
  if (scan) {
    Object.assign(scan, updates);
    queueScanPersist(scan);
  }
}

// ---------- Crawl CRUD ----------

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
  queueCrawlPersist(record);
  return record;
}

export function getCrawl(id: string): CrawlRecord | undefined {
  return crawls.get(id);
}

export async function getCrawlAsync(id: string): Promise<CrawlRecord | undefined> {
  const local = crawls.get(id);
  if (local || !redis) return local;

  const remote = await redis.get<Omit<CrawlRecord, 'abortController'>>(crawlKey(id));
  if (!remote) return undefined;

  const record: CrawlRecord = { ...remote };
  crawls.set(id, record);
  return record;
}

export function updateCrawl(id: string, updates: Partial<CrawlRecord>): void {
  const crawl = crawls.get(id);
  if (crawl) {
    Object.assign(crawl, updates);
    queueCrawlPersist(crawl);
  }
}

export function deleteCrawl(id: string): void {
  crawls.delete(id);
  if (redis) {
    void redis.del(crawlKey(id));
  }
}

export function getAllCrawls(): CrawlRecord[] {
  return Array.from(crawls.values());
}

// ---------- Local TTL Cleanup ----------

const SCAN_TTL_MS = 15 * 60 * 1000;
const CRAWL_TTL_MS = 30 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

function cleanupExpired(): void {
  const now = Date.now();
  for (const [id, scan] of scans) {
    if (scan.status === 'complete' || scan.status === 'error') {
      const age = now - new Date(scan.startedAt).getTime();
      if (age > SCAN_TTL_MS) scans.delete(id);
    }
  }
  for (const [id, crawl] of crawls) {
    if (crawl.status === 'complete' || crawl.status === 'error' || crawl.status === 'cancelled') {
      const age = now - new Date(crawl.startedAt).getTime();
      if (age > CRAWL_TTL_MS) {
        for (const pageId of crawl.pageIds) scans.delete(pageId);
        crawls.delete(id);
      }
    }
  }
}

setInterval(cleanupExpired, CLEANUP_INTERVAL_MS);
