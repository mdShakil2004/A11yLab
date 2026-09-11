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
    return NextResponse.json(
      { status: 'not_found', progress: 0, message: 'Crawl is initializing', totalPages: 0, completedPages: 0, failedPages: 0, pagesCompleted: [] },
      { status: 404, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const pageRecords = (
    await Promise.all(crawl.pageIds.map((pid) => getScanAsync(pid)))
  ).filter((scan) => scan != null);
  const pagesCompleted = generatePageSummaries(pageRecords);

  return NextResponse.json(
    {
      status: crawl.status,
      progress: crawl.progress,
      message: crawl.message,
      totalPages: crawl.totalPageCount,
      completedPages: crawl.completedPageCount,
      failedPages: crawl.failedPageCount,
      currentPage: crawl.discoveredUrls[crawl.discoveredUrls.length - 1],
      pagesCompleted,
    },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        Pragma: 'no-cache',
      },
    },
  );
}
