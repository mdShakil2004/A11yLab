import { NextRequest, NextResponse } from 'next/server';
import { getScan } from '@/lib/scanner/store';
import { createLogger } from '@/lib/logger';

const log = createLogger('api:scan:id');

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const scan = getScan(id);

  if (!scan) {
    log.warn('Scan not found', { id });
    return NextResponse.json({ error: 'Scan not found' }, { status: 404 });
  }

  log.debug('Scan retrieved', { id, status: scan.status });
  return NextResponse.json(scan);
}
