import { NextRequest } from 'next/server';
import { getScan } from '@/lib/scanner/store';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      const interval = setInterval(() => {
        const scan = getScan(id);
        if (!scan) {
          send({ status: 'error', progress: 0, message: 'Scan not found' });
          clearInterval(interval);
          controller.close();
          return;
        }

        send({ status: scan.status, progress: scan.progress, message: scan.message });

        if (scan.status === 'complete' || scan.status === 'error') {
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
