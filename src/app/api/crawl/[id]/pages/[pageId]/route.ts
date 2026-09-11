import { NextRequest, NextResponse } from 'next/server';
import { getCrawlAsync, getScanAsync } from '@/lib/scanner/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; pageId: string }> }
) {
  const { id, pageId } = await params;
  const crawl = await getCrawlAsync(id);

  if (!crawl) {
    return NextResponse.json({ error: 'Crawl not found' }, { status: 404 });
  }

  if (!crawl.pageIds.includes(pageId)) {
    return NextResponse.json({ error: 'Page not found in this crawl' }, { status: 404 });
  }

  const scan = await getScanAsync(pageId);
  if (!scan) {
    return NextResponse.json({ error: 'Page scan record not found' }, { status: 404 });
  }

  return NextResponse.json(scan, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
