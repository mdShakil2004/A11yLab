import { NextRequest, NextResponse } from 'next/server';
import { getCrawl } from '@/lib/scanner/store';
import { createLogger } from '@/lib/logger';

const log = createLogger('api:crawl:id');

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const crawl = getCrawl(id);

  if (!crawl) {
    log.warn('Crawl not found', { id });
    return NextResponse.json({ error: 'Crawl not found' }, { status: 404 });
  }

  // Strip abortController before serializing — it's not serializable
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { abortController: _ac, ...serializable } = crawl;
  return NextResponse.json(serializable);
}
