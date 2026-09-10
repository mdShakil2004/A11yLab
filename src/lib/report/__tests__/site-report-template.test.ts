import { describe, it, expect } from 'vitest';
import { generateSiteReportHtml } from '../templates/site-report-template';
import type {
  SiteReportData,
  AggregatedViolation,
  PageSummary,
  SiteScoreResult,
} from '../../types/crawl';
import type { AxeNode } from '../../types/scan';

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function makeNode(overrides?: Partial<AxeNode>): AxeNode {
  return {
    html: '<img src="image.jpg">',
    target: ['img'],
    impact: 'serious',
    failureSummary: 'Fix the following: Element does not have an alt attribute',
    ...overrides,
  };
}

function makeAggregatedViolation(
  overrides?: Partial<AggregatedViolation>,
): AggregatedViolation {
  return {
    ruleId: 'image-alt',
    impact: 'serious',
    description: 'Ensures <img> elements have alternate text',
    help: 'Images must have alternate text',
    helpUrl: 'https://dequeuniversity.com/rules/axe/4.6/image-alt',
    principle: 'perceivable',
    totalInstances: 5,
    affectedPages: [
      { url: 'https://example.com', pageId: 'page-1', nodeCount: 5 },
    ],
    tags: ['wcag2aa', 'wcag111', 'cat.text-alternatives'],
    nodes: [makeNode()],
    ...overrides,
  };
}

function makePageSummary(overrides?: Partial<PageSummary>): PageSummary {
  return {
    pageId: 'page-1',
    url: 'https://example.com',
    score: 75,
    grade: 'B',
    violationCount: 3,
    passCount: 15,
    status: 'complete',
    scannedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeSiteScore(overrides?: Partial<SiteScoreResult>): SiteScoreResult {
  return {
    overallScore: 72,
    grade: 'B',
    lowestPageScore: 55,
    highestPageScore: 90,
    medianPageScore: 72,
    pageCount: 5,
    principleScores: {
      perceivable: { score: 70, violationCount: 3, passCount: 7 },
      operable: { score: 85, violationCount: 1, passCount: 6 },
      understandable: { score: 90, violationCount: 1, passCount: 9 },
      robust: { score: 100, violationCount: 0, passCount: 5 },
    },
    impactBreakdown: {
      critical: { passed: 5, failed: 1 },
      serious: { passed: 8, failed: 2 },
      moderate: { passed: 6, failed: 1 },
      minor: { passed: 10, failed: 1 },
    },
    totalUniqueViolations: 5,
    totalViolationInstances: 15,
    totalPasses: 29,
    aodaCompliant: false,
    ...overrides,
  };
}

function makeSiteReportData(
  overrides?: Partial<SiteReportData>,
): SiteReportData {
  return {
    seedUrl: 'https://example.com',
    scanDate: '2026-01-01',
    engineVersion: '4.0.0',
    siteScore: makeSiteScore(),
    aggregatedViolations: [makeAggregatedViolation()],
    pageSummaries: [makePageSummary()],
    config: {
      maxPages: 50,
      maxDepth: 3,
      concurrency: 3,
      delayMs: 1000,
      includePatterns: [],
      excludePatterns: [],
      respectRobotsTxt: true,
      followSitemaps: true,
      domainStrategy: 'same-hostname' as const,
    },
    aodaNote: 'AODA compliance note text',
    disclaimer: 'Disclaimer text',
    ...overrides,
  };
}

function makeCleanSiteData(): SiteReportData {
  return makeSiteReportData({
    aggregatedViolations: [],
    siteScore: makeSiteScore({
      overallScore: 98,
      grade: 'A',
      lowestPageScore: 95,
      highestPageScore: 100,
      medianPageScore: 98,
      principleScores: {
        perceivable: { score: 100, violationCount: 0, passCount: 10 },
        operable: { score: 100, violationCount: 0, passCount: 8 },
        understandable: { score: 100, violationCount: 0, passCount: 6 },
        robust: { score: 100, violationCount: 0, passCount: 4 },
      },
      impactBreakdown: {
        critical: { passed: 5, failed: 0 },
        serious: { passed: 8, failed: 0 },
        moderate: { passed: 10, failed: 0 },
        minor: { passed: 5, failed: 0 },
      },
      totalUniqueViolations: 0,
      totalViolationInstances: 0,
      totalPasses: 28,
      aodaCompliant: true,
    }),
  });
}

function makeDirtySiteData(): SiteReportData {
  return makeSiteReportData({
    aggregatedViolations: [
      makeAggregatedViolation({
        ruleId: 'color-contrast',
        impact: 'critical',
        totalInstances: 10,
        tags: ['wcag2aa', 'cat.color'],
      }),
      makeAggregatedViolation({
        ruleId: 'label',
        impact: 'serious',
        totalInstances: 8,
        tags: ['wcag2aa', 'cat.forms'],
      }),
      makeAggregatedViolation({
        ruleId: 'keyboard',
        impact: 'moderate',
        totalInstances: 6,
        tags: ['wcag2aa', 'cat.keyboard'],
      }),
      makeAggregatedViolation({
        ruleId: 'link-name',
        impact: 'minor',
        totalInstances: 4,
        tags: ['wcag2aa', 'cat.semantics'],
      }),
    ],
    siteScore: makeSiteScore({
      overallScore: 30,
      grade: 'F',
      lowestPageScore: 10,
      highestPageScore: 50,
      medianPageScore: 30,
      principleScores: {
        perceivable: { score: 20, violationCount: 5, passCount: 2 },
        operable: { score: 30, violationCount: 4, passCount: 3 },
        understandable: { score: 40, violationCount: 3, passCount: 2 },
        robust: { score: 25, violationCount: 2, passCount: 1 },
      },
      impactBreakdown: {
        critical: { passed: 1, failed: 3 },
        serious: { passed: 2, failed: 4 },
        moderate: { passed: 3, failed: 2 },
        minor: { passed: 4, failed: 5 },
      },
      totalUniqueViolations: 10,
      totalViolationInstances: 28,
      totalPasses: 10,
      aodaCompliant: false,
    }),
  });
}

// ---------------------------------------------------------------------------
// Structural validation tests
// ---------------------------------------------------------------------------

describe('generateSiteReportHtml', () => {
  it('contains Executive Summary with site-level stats', () => {
    const html = generateSiteReportHtml(makeSiteReportData());
    expect(html).toContain('Executive Summary');
    expect(html).toContain('Pages Scanned');
    expect(html).toContain('Unique Violations');
    expect(html).toContain('Total Instances');
  });

  it('contains WCAG Principles (POUR) section', () => {
    const html = generateSiteReportHtml(makeSiteReportData());
    expect(html).toContain('WCAG Principles');
  });

  it('contains Category Breakdown section', () => {
    const html = generateSiteReportHtml(makeSiteReportData());
    expect(html).toContain('Category Breakdown');
  });

  it('contains Impact Breakdown section', () => {
    const html = generateSiteReportHtml(makeSiteReportData());
    expect(html).toContain('Impact Breakdown');
  });

  it('contains enhanced Top Violations section with code snippets', () => {
    const html = generateSiteReportHtml(makeSiteReportData());
    expect(html).toContain('<pre');
    expect(html).toContain('<code');
    expect(html).toContain('Learn more');
  });

  it('contains Per-Page Scores table', () => {
    const html = generateSiteReportHtml(makeSiteReportData());
    expect(html).toContain('Per-Page Scores');
  });

  it('contains AODA note and Disclaimer', () => {
    const html = generateSiteReportHtml(makeSiteReportData());
    expect(html).toContain('AODA');
    expect(html).toContain('Disclaimer');
  });
});

// ---------------------------------------------------------------------------
// Scenario-based tests
// ---------------------------------------------------------------------------

describe('site report scenarios', () => {
  it('clean site scenario shows compliant status', () => {
    const html = generateSiteReportHtml(makeCleanSiteData());
    expect(html).toContain('AODA Compliant');
    expect(html).not.toContain('Learn more');
  });

  it('dirty site scenario shows violations and code snippets', () => {
    const html = generateSiteReportHtml(makeDirtySiteData());
    expect(html).toContain('Needs Remediation');
    expect(html).toContain('Learn more');
  });

  it('handles missing node data in aggregated violations gracefully', () => {
    const data = makeSiteReportData({
      aggregatedViolations: [
        makeAggregatedViolation({
          nodes: undefined,
          tags: undefined,
        }),
      ],
    });
    const html = generateSiteReportHtml(data);
    // Should not throw and should render the violation card without code snippets
    expect(html).not.toContain('<pre');
    expect(html).toContain('Learn more');
  });
});
