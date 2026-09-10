import type { CrawlRecord, SiteReportData } from '../types/crawl';
import type { ScanRecord } from '../types/scan';
import { getScan } from '../scanner/store';
import { calculateSiteScore, aggregateViolations, generatePageSummaries } from '../scoring/site-calculator';

export function generateSiteReport(crawl: CrawlRecord): SiteReportData {
  const pageRecords: ScanRecord[] = [];

  for (const pageId of crawl.pageIds) {
    const scan = getScan(pageId);
    if (scan) {
      pageRecords.push(scan);
    }
  }

  const completedPages = pageRecords.filter(
    (p) => p.status === 'complete' && p.results != null
  );

  const engineVersion =
    completedPages.length > 0
      ? completedPages[0].results!.engineVersion
      : 'unknown';

  const siteScore = calculateSiteScore(pageRecords);
  const violations = aggregateViolations(pageRecords);
  const pageSummaries = generatePageSummaries(pageRecords);

  return {
    seedUrl: crawl.seedUrl,
    scanDate: new Date(crawl.startedAt).toLocaleString(),
    engineVersion,
    siteScore,
    aggregatedViolations: violations,
    pageSummaries,
    config: crawl.config,
    aodaNote:
      'The Accessibility for Ontarians with Disabilities Act (AODA) requires compliance with WCAG 2.0 Level AA ' +
      'under the Integrated Accessibility Standards Regulation (IASR). WCAG 2.2 Level AA is a superset of ' +
      'WCAG 2.0 Level AA — a website that passes WCAG 2.2 AA also satisfies the AODA requirement. ' +
      'This scan tests against WCAG 2.2 Level AA criteria.',
    disclaimer:
      'Automated accessibility testing can detect approximately 30-57% of WCAG failures. ' +
      'This report should be supplemented with manual testing, assisted technology testing, and expert review ' +
      'for comprehensive accessibility assessment. Scan results are point-in-time and may not reflect ' +
      'dynamic content changes.',
  };
}
