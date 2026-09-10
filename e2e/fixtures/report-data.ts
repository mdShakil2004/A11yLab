import type { ScanResults } from '../../src/lib/types/scan';
import type { ReportData } from '../../src/lib/types/report';
import type { SiteReportData } from '../../src/lib/types/crawl';
import { assembleReportData } from '../../src/lib/report/generator';

/**
 * Creates a minimal valid ScanResults object with realistic data:
 * 1 critical violation, 1 minor violation, 3 passes, 1 incomplete.
 * Overall score lands in the 60-80 range to exercise color-coded rendering.
 */
export function createMockScanResults(): ScanResults {
  return {
    url: 'https://example.com',
    timestamp: '2026-03-01T12:00:00Z',
    engineVersion: 'axe-core@4.10.0',
    violations: [
      {
        id: 'image-alt',
        impact: 'critical',
        tags: ['wcag2a', 'wcag111', 'cat.text-alternatives'],
        description: 'Images must have alternate text',
        help: 'Images must have alternate text',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/image-alt',
        nodes: [
          {
            html: '<img src="logo.png">',
            target: ['img'],
            impact: 'critical',
            failureSummary: 'Fix any of the following: Element does not have an alt attribute',
          },
        ],
        principle: 'perceivable',
      },
      {
        id: 'link-name',
        impact: 'minor',
        tags: ['wcag2a', 'wcag412', 'cat.name-role-value'],
        description: 'Links must have discernible text',
        help: 'Links must have discernible text',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name',
        nodes: [
          {
            html: '<a href="/about"><span></span></a>',
            target: ['a[href="/about"]'],
            impact: 'minor',
            failureSummary: 'Fix all of the following: Element is in tab order and does not have accessible text',
          },
        ],
        principle: 'operable',
      },
    ],
    passes: [
      {
        id: 'html-has-lang',
        tags: ['wcag2a', 'wcag311', 'cat.language'],
        description: '<html> element must have a lang attribute',
        nodes: [{ html: '<html lang="en">', target: ['html'] }],
      },
      {
        id: 'document-title',
        tags: ['wcag2a', 'wcag242', 'cat.text-alternatives'],
        description: 'Documents must have a <title> element',
        nodes: [{ html: '<title>Example</title>', target: ['title'] }],
      },
      {
        id: 'color-contrast',
        tags: ['wcag2aa', 'wcag143', 'cat.color'],
        description: 'Elements must meet minimum color contrast ratio thresholds',
        nodes: [{ html: '<p>Hello</p>', target: ['p'] }],
      },
    ],
    incomplete: [
      {
        id: 'aria-required-attr',
        impact: 'serious',
        tags: ['wcag2a', 'wcag412', 'cat.aria'],
        description: 'Required ARIA attributes must be provided',
        help: 'Required ARIA attributes must be provided',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-attr',
        nodes: [
          {
            html: '<div role="slider">',
            target: ['div[role="slider"]'],
            impact: 'serious',
            failureSummary: 'Check that element has required ARIA attributes',
          },
        ],
      },
    ],
    inapplicable: [],
    score: {
      overallScore: 72,
      grade: 'C',
      principleScores: {
        perceivable: { score: 65, violationCount: 1, passCount: 2 },
        operable: { score: 80, violationCount: 1, passCount: 0 },
        understandable: { score: 100, violationCount: 0, passCount: 1 },
        robust: { score: 85, violationCount: 0, passCount: 0 },
      },
      impactBreakdown: {
        critical: { passed: 0, failed: 1 },
        serious: { passed: 0, failed: 0 },
        moderate: { passed: 0, failed: 0 },
        minor: { passed: 0, failed: 1 },
      },
      totalViolations: 2,
      totalElementViolations: 2,
      totalPasses: 3,
      totalIncomplete: 1,
      aodaCompliant: false,
    },
  };
}

/**
 * Returns a valid ReportData object by running assembleReportData on mock scan results.
 */
export function createMockReportData(): ReportData {
  return assembleReportData(createMockScanResults());
}

/**
 * Returns a valid SiteReportData with multiple page results and aggregated violations.
 */
export function createMockSiteReportData(): SiteReportData {
  return {
    seedUrl: 'https://example.com',
    scanDate: '2026-03-01T12:00:00Z',
    engineVersion: 'axe-core@4.10.0',
    siteScore: {
      overallScore: 75,
      grade: 'C',
      lowestPageScore: 68,
      highestPageScore: 82,
      medianPageScore: 75,
      pageCount: 3,
      principleScores: {
        perceivable: { score: 70, violationCount: 2, passCount: 4 },
        operable: { score: 80, violationCount: 1, passCount: 3 },
        understandable: { score: 90, violationCount: 0, passCount: 2 },
        robust: { score: 85, violationCount: 1, passCount: 1 },
      },
      impactBreakdown: {
        critical: { passed: 1, failed: 1 },
        serious: { passed: 2, failed: 0 },
        moderate: { passed: 1, failed: 1 },
        minor: { passed: 3, failed: 1 },
      },
      totalUniqueViolations: 3,
      totalViolationInstances: 5,
      totalPasses: 10,
      aodaCompliant: false,
    },
    aggregatedViolations: [
      {
        ruleId: 'image-alt',
        impact: 'critical',
        description: 'Images must have alternate text',
        help: 'Images must have alternate text',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/image-alt',
        principle: 'perceivable',
        totalInstances: 2,
        affectedPages: [
          { url: 'https://example.com', pageId: 'page-1', nodeCount: 1 },
          { url: 'https://example.com/about', pageId: 'page-2', nodeCount: 1 },
        ],
        tags: ['wcag2a', 'wcag111', 'cat.text-alternatives'],
      },
      {
        ruleId: 'color-contrast',
        impact: 'moderate',
        description: 'Elements must meet minimum color contrast ratio thresholds',
        help: 'Elements must meet minimum color contrast ratio thresholds',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast',
        principle: 'perceivable',
        totalInstances: 1,
        affectedPages: [
          { url: 'https://example.com/contact', pageId: 'page-3', nodeCount: 1 },
        ],
        tags: ['wcag2aa', 'wcag143', 'cat.color'],
      },
      {
        ruleId: 'link-name',
        impact: 'minor',
        description: 'Links must have discernible text',
        help: 'Links must have discernible text',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name',
        principle: 'operable',
        totalInstances: 2,
        affectedPages: [
          { url: 'https://example.com', pageId: 'page-1', nodeCount: 1 },
          { url: 'https://example.com/contact', pageId: 'page-3', nodeCount: 1 },
        ],
        tags: ['wcag2a', 'wcag412', 'cat.name-role-value'],
      },
    ],
    pageSummaries: [
      {
        pageId: 'page-1',
        url: 'https://example.com',
        score: 68,
        grade: 'D',
        violationCount: 2,
        passCount: 3,
        status: 'complete',
        scannedAt: '2026-03-01T12:00:10Z',
      },
      {
        pageId: 'page-2',
        url: 'https://example.com/about',
        score: 82,
        grade: 'B',
        violationCount: 1,
        passCount: 4,
        status: 'complete',
        scannedAt: '2026-03-01T12:00:20Z',
      },
      {
        pageId: 'page-3',
        url: 'https://example.com/contact',
        score: 75,
        grade: 'C',
        violationCount: 2,
        passCount: 3,
        status: 'complete',
        scannedAt: '2026-03-01T12:00:30Z',
      },
    ],
    config: {
      maxPages: 50,
      maxDepth: 3,
      concurrency: 3,
      delayMs: 1000,
      includePatterns: [],
      excludePatterns: [],
      respectRobotsTxt: true,
      followSitemaps: true,
      domainStrategy: 'same-hostname',
    },
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
