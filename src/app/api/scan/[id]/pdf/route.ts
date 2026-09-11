import { NextRequest, NextResponse } from 'next/server';
import { getScan } from '@/lib/scanner/store';
import type { ScanResults } from '@/lib/types/scan';
import { assembleReportData } from '@/lib/report/generator';
import { generateReportHtml } from '@/lib/report/templates/report-template';
import { generatePdf } from '@/lib/report/pdf-generator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isScanResults(value: unknown): value is ScanResults {
  if (!value || typeof value !== 'object') return false;

  const results = value as Partial<ScanResults>;
  return (
    typeof results.url === 'string' &&
    typeof results.timestamp === 'string' &&
    typeof results.engineVersion === 'string' &&
    Array.isArray(results.violations) &&
    Array.isArray(results.passes) &&
    Array.isArray(results.incomplete) &&
    typeof results.score === 'object' &&
    results.score !== null
  );
}

async function createPdfResponse(results: ScanResults, id: string) {
  const reportData = assembleReportData(results);
  const html = generateReportHtml(reportData);
  const pdfBuffer = await generatePdf(html);

  return new NextResponse(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="wcag-report-${id}.pdf"`,
      'Content-Length': String(pdfBuffer.byteLength),
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const scan = getScan(id);

  if (!scan) {
    return NextResponse.json(
      { error: 'Scan not found. The serverless instance no longer has this scan in memory.' },
      { status: 404 }
    );
  }

  if (scan.status !== 'complete' || !scan.results) {
    return NextResponse.json({ error: 'Scan not yet complete' }, { status: 400 });
  }

  try {
    return await createPdfResponse(scan.results, id);
  } catch (error) {
    console.error('PDF generation failed:', error);
    return NextResponse.json(
      { error: 'Failed to generate PDF report' },
      { status: 500 }
    );
  }
}

/**
 * Generate from the results already loaded by the report page.
 * This is the reliable path on Vercel because serverless requests can land
 * on different instances and the in-memory scan store is not shared.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = await request.json();
    const results = body?.results;

    if (!isScanResults(results)) {
      return NextResponse.json(
        { error: 'Invalid scan results supplied for PDF generation' },
        { status: 400 }
      );
    }

    return await createPdfResponse(results, id);
  } catch (error) {
    console.error('PDF generation failed:', error);
    return NextResponse.json(
      { error: 'Failed to generate PDF report' },
      { status: 500 }
    );
  }
}
