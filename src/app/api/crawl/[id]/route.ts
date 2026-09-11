import { NextRequest, NextResponse } from 'next/server';
import { getCrawlAsync } from '@/lib/scanner/store';
import { createLogger } from '@/lib/logger';

const log = createLogger('api:crawl:id');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const crawl = await getCrawlAsync(id);

  if (!crawl) {
    log.warn('Crawl not found', { id });
    return NextResponse.json({ error: 'Crawl not found' }, { status: 404 });
  }

  const { abortController: _ac, ...serializable } = crawl;
  return NextResponse.json(serializable, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
