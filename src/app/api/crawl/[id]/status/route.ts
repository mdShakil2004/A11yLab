import { NextRequest } from 'next/server';
import { getCrawl, getScan } from '@/lib/scanner/store';
import { generatePageSummaries } from '@/lib/scoring/site-calculator';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const crawl = getCrawl(id);
  if (!crawl) {
    return new Response(
      `data: ${JSON.stringify({ status: 'error', progress: 0, message: 'Crawl not found' })}\n\n`,
      {
        status: 404,
        headers: { 'Content-Type': 'text/event-stream' },
      }
    );
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      const interval = setInterval(() => {
        const current = getCrawl(id);
        if (!current) {
          send({ status: 'error', progress: 0, message: 'Crawl not found', totalPages: 0, completedPages: 0, failedPages: 0, pagesCompleted: [] });
          clearInterval(interval);
          controller.close();
          return;
        }

        // Build page summaries from stored scan records
        const pageRecords = current.pageIds
          .map((pid) => getScan(pid))
          .filter((s) => s != null);
        const pagesCompleted = generatePageSummaries(pageRecords);

        send({
          status: current.status,
          progress: current.progress,
          message: current.message,
          totalPages: current.totalPageCount,
          completedPages: current.completedPageCount,
          failedPages: current.failedPageCount,
          currentPage: current.discoveredUrls[current.discoveredUrls.length - 1],
          pagesCompleted,
        });

        if (current.status === 'complete' || current.status === 'error' || current.status === 'cancelled') {
          clearInterval(interval);
          controller.close();
        }
      }, 500);

      // Clean up if the client disconnects
      _request.signal.addEventListener('abort', () => {
        clearInterval(interval);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
