import { NextRequest, NextResponse } from 'next/server';
import { getScan } from '@/lib/scanner/store';
import { assembleReportData } from '@/lib/report/generator';
import { generateReportHtml } from '@/lib/report/templates/report-template';
import { generatePdf } from '@/lib/report/pdf-generator';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const scan = getScan(id);

  if (!scan) {
    return NextResponse.json({ error: 'Scan not found' }, { status: 404 });
  }

  if (scan.status !== 'complete' || !scan.results) {
    return NextResponse.json({ error: 'Scan not yet complete' }, { status: 400 });
  }

  const reportData = assembleReportData(scan.results);
  const html = generateReportHtml(reportData);
  const pdfBuffer = await generatePdf(html);

  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="wcag-report-${id}.pdf"`,
    },
  });
}
