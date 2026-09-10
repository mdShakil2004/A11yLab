import { NextRequest, NextResponse } from 'next/server';
import { getCrawl, getScan } from '@/lib/scanner/store';
import { generatePageSummaries } from '@/lib/scoring/site-calculator';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const crawl = getCrawl(id);

  if (!crawl) {
    return NextResponse.json({ error: 'Crawl not found' }, { status: 404 });
  }

  const pageRecords = crawl.pageIds
    .map((pid) => getScan(pid))
    .filter((s) => s != null);

  const pages = generatePageSummaries(pageRecords);

  return NextResponse.json({ pages });
}
