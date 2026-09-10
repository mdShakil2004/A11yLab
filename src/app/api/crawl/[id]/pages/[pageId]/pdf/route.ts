import { NextRequest, NextResponse } from 'next/server';
import { getCrawl, getScan } from '@/lib/scanner/store';
import { assembleReportData } from '@/lib/report/generator';
import { generateReportHtml } from '@/lib/report/templates/report-template';
import { generatePdf } from '@/lib/report/pdf-generator';

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
  if (!scan || scan.status !== 'complete' || !scan.results) {
    return NextResponse.json({ error: 'Page scan not yet complete' }, { status: 400 });
  }

  const reportData = assembleReportData(scan.results);
  const html = generateReportHtml(reportData);
  const pdfBuffer = await generatePdf(html);

  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="wcag-page-report-${pageId}.pdf"`,
    },
  });
}
