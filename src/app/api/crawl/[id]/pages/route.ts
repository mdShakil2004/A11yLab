import { NextRequest, NextResponse } from 'next/server';
import { getCrawlAsync, getScanAsync } from '@/lib/scanner/store';
import { generatePageSummaries } from '@/lib/scoring/site-calculator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const crawl = await getCrawlAsync(id);

  if (!crawl) {
    return NextResponse.json({ error: 'Crawl not found' }, { status: 404 });
  }

  const pageRecords = (
    await Promise.all(crawl.pageIds.map((pid) => getScanAsync(pid)))
  ).filter((s) => s != null);

  const pages = generatePageSummaries(pageRecords);

  return NextResponse.json({ pages }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
