import { trace, metrics, SpanStatusCode } from '@opentelemetry/api';
import { createLogger } from '@/lib/logger';

const log = createLogger('telemetry');
const tracer = trace.getTracer('a11y-scanner');
const meter = metrics.getMeter('a11y-scanner');

const scanDuration = meter.createHistogram('scan.duration_ms', {
  description: 'Duration of a single-page scan in milliseconds',
  unit: 'ms',
});

const scanCounter = meter.createCounter('scan.total', {
  description: 'Total number of scans initiated',
});

const scanErrorCounter = meter.createCounter('scan.errors', {
  description: 'Total number of scan errors',
});

const crawlDuration = meter.createHistogram('crawl.duration_ms', {
  description: 'Duration of a site crawl in milliseconds',
  unit: 'ms',
});

const crawlCounter = meter.createCounter('crawl.total', {
  description: 'Total number of crawls initiated',
});

const crawlErrorCounter = meter.createCounter('crawl.errors', {
  description: 'Total number of crawl errors',
});

const crawlPagesScanned = meter.createHistogram('crawl.pages_scanned', {
  description: 'Number of pages scanned per crawl',
});

export function trackScanStart(scanId: string, url: string) {
  log.info('Scan started', { scanId, url });
  scanCounter.add(1, { url: new URL(url).hostname });
  return tracer.startSpan('scan', {
    attributes: { 'scan.id': scanId, 'scan.url': url },
  });
}

export function trackScanComplete(
  span: ReturnType<typeof tracer.startSpan>,
  scanId: string,
  url: string,
  durationMs: number,
  score: number,
  violationCount: number,
) {
  log.info('Scan completed', { scanId, url, durationMs, score, violationCount });
  scanDuration.record(durationMs, { url: new URL(url).hostname });
  span.setAttributes({
    'scan.duration_ms': durationMs,
    'scan.score': score,
    'scan.violation_count': violationCount,
  });
  span.setStatus({ code: SpanStatusCode.OK });
  span.end();
}

export function trackScanError(
  span: ReturnType<typeof tracer.startSpan>,
  scanId: string,
  url: string,
  error: string,
) {
  log.error('Scan failed', { scanId, url, error });
  scanErrorCounter.add(1, { url: new URL(url).hostname });
  span.setStatus({ code: SpanStatusCode.ERROR, message: error });
  span.recordException(new Error(error));
  span.end();
}

export function trackCrawlStart(crawlId: string, url: string) {
  log.info('Crawl started', { crawlId, url });
  crawlCounter.add(1, { url: new URL(url).hostname });
  return tracer.startSpan('crawl', {
    attributes: { 'crawl.id': crawlId, 'crawl.url': url },
  });
}

export function trackCrawlComplete(
  span: ReturnType<typeof tracer.startSpan>,
  crawlId: string,
  url: string,
  durationMs: number,
  pagesScanned: number,
  pagesFailed: number,
) {
  log.info('Crawl completed', { crawlId, url, durationMs, pagesScanned, pagesFailed });
  crawlDuration.record(durationMs, { url: new URL(url).hostname });
  crawlPagesScanned.record(pagesScanned, { url: new URL(url).hostname });
  span.setAttributes({
    'crawl.duration_ms': durationMs,
    'crawl.pages_scanned': pagesScanned,
    'crawl.pages_failed': pagesFailed,
  });
  span.setStatus({ code: SpanStatusCode.OK });
  span.end();
}

export function trackCrawlError(
  span: ReturnType<typeof tracer.startSpan>,
  crawlId: string,
  url: string,
  error: string,
) {
  log.error('Crawl failed', { crawlId, url, error });
  crawlErrorCounter.add(1, { url: new URL(url).hostname });
  span.setStatus({ code: SpanStatusCode.ERROR, message: error });
  span.recordException(new Error(error));
  span.end();
}
