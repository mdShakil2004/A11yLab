import { NextRequest, NextResponse } from 'next/server';
import { getCrawl, getScan } from '@/lib/scanner/store';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; pageId: string }> }
) {
  const { id, pageId } = await params;
  const crawl = getCrawl(id);

  if (!crawl) {
    return NextResponse.json({ error: 'Crawl not found' }, { status: 404 });
  }

  if (!crawl.pageIds.includes(pageId)) {
    return NextResponse.json({ error: 'Page not found in this crawl' }, { status: 404 });
  }

  const scan = getScan(pageId);
  if (!scan) {
    return NextResponse.json({ error: 'Page scan record not found' }, { status: 404 });
  }

  return NextResponse.json(scan);
}
