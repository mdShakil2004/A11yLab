import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { CrawlRecord, CrawlConfig } from '../../../types/crawl';

vi.mock('../../scanner/store', () => ({
  getScan: vi.fn(),
}));

vi.mock('../../scoring/site-calculator', () => ({
  calculateSiteScore: vi.fn(),
  aggregateViolations: vi.fn(),
  generatePageSummaries: vi.fn(),
}));

import { generateSiteReport } from '../site-generator';
import { getScan } from '../../scanner/store';
import { calculateSiteScore, aggregateViolations, generatePageSummaries } from '../../scoring/site-calculator';

const mockGetScan = vi.mocked(getScan);
const mockCalculateSiteScore = vi.mocked(calculateSiteScore);
const mockAggregateViolations = vi.mocked(aggregateViolations);
const mockGeneratePageSummaries = vi.mocked(generatePageSummaries);

function makeConfig(): CrawlConfig {
  return {
    maxPages: 50,
    maxDepth: 3,
    concurrency: 3,
    delayMs: 1000,
    includePatterns: [],
    excludePatterns: [],
    respectRobotsTxt: true,
    followSitemaps: true,
    domainStrategy: 'same-hostname',
  };
}

function makeCrawl(overrides: Partial<CrawlRecord> = {}): CrawlRecord {
  return {
    id: 'crawl-1',
    seedUrl: 'https://example.com',
    config: makeConfig(),
    status: 'complete',
    progress: 100,
    message: 'Complete',
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:05:00.000Z',
    discoveredUrls: ['https://example.com', 'https://example.com/about'],
    pageIds: ['p1', 'p2'],
    completedPageCount: 2,
    failedPageCount: 0,
    totalPageCount: 2,
    ...overrides,
  };
}

function makeScanRecord(id: string, url: string) {
  return {
    id,
    url,
    status: 'complete' as const,
    progress: 100,
    message: 'Done',
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:01:00.000Z',
    results: {
      url,
      timestamp: '2026-01-01T00:01:00.000Z',
      engineVersion: 'axe-core 4.10',
      violations: [],
      passes: [],
      incomplete: [],
      inapplicable: [],
      score: {
        overallScore: 100,
        grade: 'A' as const,
        principleScores: {
          perceivable: { score: 100, violationCount: 0, passCount: 0 },
          operable: { score: 100, violationCount: 0, passCount: 0 },
          understandable: { score: 100, violationCount: 0, passCount: 0 },
          robust: { score: 100, violationCount: 0, passCount: 0 },
        },
        impactBreakdown: {
          critical: { passed: 0, failed: 0 },
          serious: { passed: 0, failed: 0 },
          moderate: { passed: 0, failed: 0 },
          minor: { passed: 0, failed: 0 },
        },
        totalViolations: 0,
        totalElementViolations: 0,
        totalPasses: 0,
        totalIncomplete: 0,
        aodaCompliant: true,
      },
    },
  };
}

const mockSiteScore = {
  overallScore: 95,
  grade: 'A' as const,
  lowestPageScore: 90,
  highestPageScore: 100,
  medianPageScore: 95,
  pageCount: 2,
  principleScores: {
    perceivable: { score: 100, violationCount: 0, passCount: 0 },
    operable: { score: 100, violationCount: 0, passCount: 0 },
    understandable: { score: 100, violationCount: 0, passCount: 0 },
    robust: { score: 100, violationCount: 0, passCount: 0 },
  },
  impactBreakdown: {
    critical: { passed: 0, failed: 0 },
    serious: { passed: 0, failed: 0 },
    moderate: { passed: 0, failed: 0 },
    minor: { passed: 0, failed: 0 },
  },
  totalUniqueViolations: 0,
  totalViolationInstances: 0,
  totalPasses: 0,
  aodaCompliant: true,
};

describe('generateSiteReport', () => {
  beforeEach(() => {
    mockGetScan.mockReset();
    mockCalculateSiteScore.mockReset();
    mockAggregateViolations.mockReset();
    mockGeneratePageSummaries.mockReset();

    mockCalculateSiteScore.mockReturnValue(mockSiteScore);
    mockAggregateViolations.mockReturnValue([]);
    mockGeneratePageSummaries.mockReturnValue([]);
  });

  it('retrieves scan records for each pageId and assembles site report', () => {
    const scan1 = makeScanRecord('p1', 'https://example.com');
    const scan2 = makeScanRecord('p2', 'https://example.com/about');
    mockGetScan.mockImplementation((id: string) => {
      if (id === 'p1') return scan1;
      if (id === 'p2') return scan2;
      return undefined;
    });

    const crawl = makeCrawl();
    const report = generateSiteReport(crawl);

    expect(mockGetScan).toHaveBeenCalledWith('p1');
    expect(mockGetScan).toHaveBeenCalledWith('p2');
    expect(report.seedUrl).toBe('https://example.com');
    expect(report.siteScore).toEqual(mockSiteScore);
    expect(report.config).toEqual(crawl.config);
  });

  it('calls scoring functions with completed page records', () => {
    const scan1 = makeScanRecord('p1', 'https://example.com');
    mockGetScan.mockImplementation((id: string) => {
      if (id === 'p1') return scan1;
      return undefined;
    });

    generateSiteReport(makeCrawl({ pageIds: ['p1'] }));

    expect(mockCalculateSiteScore).toHaveBeenCalledTimes(1);
    expect(mockAggregateViolations).toHaveBeenCalledTimes(1);
    expect(mockGeneratePageSummaries).toHaveBeenCalledTimes(1);

    // Should be called with array containing the scan record
    const passedRecords = mockCalculateSiteScore.mock.calls[0][0];
    expect(passedRecords).toHaveLength(1);
    expect(passedRecords[0].id).toBe('p1');
  });

  it('skips pages where getScan returns undefined', () => {
    mockGetScan.mockReturnValue(undefined);

    const report = generateSiteReport(makeCrawl({ pageIds: ['missing1', 'missing2'] }));

    // Should still call scoring functions with empty array
    const passedRecords = mockCalculateSiteScore.mock.calls[0][0];
    expect(passedRecords).toHaveLength(0);
    expect(report.engineVersion).toBe('unknown');
  });

  it('handles empty pageIds', () => {
    const report = generateSiteReport(makeCrawl({ pageIds: [] }));

    expect(mockGetScan).not.toHaveBeenCalled();
    expect(report.engineVersion).toBe('unknown');
    expect(report.siteScore).toEqual(mockSiteScore);
  });

  it('includes aodaNote and disclaimer', () => {
    mockGetScan.mockReturnValue(undefined);
    const report = generateSiteReport(makeCrawl({ pageIds: [] }));

    expect(report.aodaNote).toContain('AODA');
    expect(report.aodaNote).toContain('WCAG');
    expect(report.disclaimer).toContain('Automated accessibility testing');
  });

  it('extracts engineVersion from first completed page', () => {
    const scan1 = makeScanRecord('p1', 'https://example.com');
    mockGetScan.mockImplementation((id: string) => {
      if (id === 'p1') return scan1;
      return undefined;
    });

    const report = generateSiteReport(makeCrawl({ pageIds: ['p1'] }));
    expect(report.engineVersion).toBe('axe-core 4.10');
  });
});
