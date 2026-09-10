import { NextRequest, NextResponse } from 'next/server';
import { getCrawl } from '@/lib/scanner/store';
import { cancelCrawl } from '@/lib/crawler/site-crawler';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const crawl = getCrawl(id);

  if (!crawl) {
    return NextResponse.json({ error: 'Crawl not found' }, { status: 404 });
  }

  if (crawl.status === 'complete' || crawl.status === 'error' || crawl.status === 'cancelled') {
    return NextResponse.json(
      { error: `Crawl is not running (status: ${crawl.status})` },
      { status: 409 }
    );
  }

  cancelCrawl(id);

  return NextResponse.json({ message: 'Crawl cancelled', crawlId: id });
}
