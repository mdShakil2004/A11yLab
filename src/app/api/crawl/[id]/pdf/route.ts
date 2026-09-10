import { NextRequest, NextResponse } from 'next/server';
import { getCrawl } from '@/lib/scanner/store';
import { generateSiteReport } from '@/lib/report/site-generator';
import { generateSiteReportHtml } from '@/lib/report/templates/site-report-template';
import { generatePdf } from '@/lib/report/pdf-generator';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const crawl = getCrawl(id);

  if (!crawl) {
    return NextResponse.json({ error: 'Crawl not found' }, { status: 404 });
  }

  if (crawl.status !== 'complete') {
    return NextResponse.json({ error: 'Crawl not yet complete' }, { status: 409 });
  }

  const reportData = generateSiteReport(crawl);
  const html = generateSiteReportHtml(reportData);
  const pdfBuffer = await generatePdf(html);

  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="wcag-site-report-${id}.pdf"`,
    },
  });
}
