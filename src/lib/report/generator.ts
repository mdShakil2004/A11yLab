import type { ScanResults } from '../types/scan';
import type { ReportData } from '../types/report';

export function assembleReportData(results: ScanResults): ReportData {
  const sortedViolations = [...results.violations].sort((a, b) => {
    const order = { critical: 0, serious: 1, moderate: 2, minor: 3 };
    return (order[a.impact] ?? 4) - (order[b.impact] ?? 4);
  });

  return {
    url: results.url,
    scanDate: new Date(results.timestamp).toLocaleString(),
    engineVersion: results.engineVersion,
    score: results.score,
    violations: sortedViolations,
    passes: results.passes,
    incomplete: results.incomplete,
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
