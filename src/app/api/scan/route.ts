import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { createScan, updateScan } from '@/lib/scanner/store';
import { scanUrl } from '@/lib/scanner/engine';
import { parseAxeResults } from '@/lib/scanner/result-parser';
import { trackScanStart, trackScanComplete, trackScanError } from '@/lib/telemetry';
import { createLogger } from '@/lib/logger';

const log = createLogger('api:scan');

function isValidScanUrl(input: string): boolean {
  if (!input || typeof input !== 'string' || input.length > 2048) return false;

  let parsed: URL;
  try {
    parsed = new URL(input.trim());
  } catch {
    return false;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;

  const hostname = parsed.hostname;

  // Block private/internal IPs (SSRF prevention)
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '0.0.0.0' ||
    hostname.startsWith('10.') ||
    hostname.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
    hostname.startsWith('fc') ||
    hostname.startsWith('fd') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    return false;
  }

  return true;
}

export async function POST(request: NextRequest) {
  let body: { url?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { url } = body;

  if (!url || typeof url !== 'string') {
    return NextResponse.json({ error: 'URL is required' }, { status: 400 });
  }

  if (!isValidScanUrl(url)) {
    return NextResponse.json({ error: 'Invalid URL. Only public HTTP/HTTPS URLs are allowed.' }, { status: 400 });
  }

  const scanId = uuidv4();
  log.info('Scan requested', { scanId, url: url.trim() });
  createScan(scanId, url.trim());

  // Start scan asynchronously — do not await
  runScan(scanId, url.trim());

  return NextResponse.json({ scanId }, { status: 202 });
}

async function runScan(scanId: string, url: string) {
  const startTime = Date.now();
  const span = trackScanStart(scanId, url);
  try {
    updateScan(scanId, { status: 'navigating', progress: 10, message: 'Navigating to page...' });

    const rawResults = await scanUrl(url, (status, progress) => {
      updateScan(scanId, { status: status as 'navigating' | 'scanning' | 'scoring', progress, message: getStatusMessage(status) });
    });

    updateScan(scanId, { status: 'scoring', progress: 80, message: 'Calculating scores...' });

    const results = parseAxeResults(url, rawResults);

    updateScan(scanId, {
      status: 'complete',
      progress: 100,
      message: 'Scan complete',
      completedAt: new Date().toISOString(),
      results,
    });

    trackScanComplete(span, scanId, url, Date.now() - startTime, results.score.overallScore, results.violations.length);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Scan failed';
    updateScan(scanId, {
      status: 'error',
      progress: 0,
      message: errorMsg,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    trackScanError(span, scanId, url, errorMsg);
  }
}

function getStatusMessage(status: string): string {
  switch (status) {
    case 'navigating': return 'Navigating to page...';
    case 'scanning': return 'Running accessibility tests...';
    case 'scoring': return 'Calculating scores...';
    default: return 'Processing...';
  }
}
