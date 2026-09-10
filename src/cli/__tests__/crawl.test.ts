import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('uuid', () => ({ v4: vi.fn().mockReturnValue('mock-crawl-id') }));
vi.mock('../../lib/scanner/store', () => ({
  createCrawl: vi.fn(),
  getCrawl: vi.fn(),
  getScan: vi.fn(),
}));
vi.mock('../../lib/crawler/site-crawler', () => ({
  startCrawl: vi.fn(),
}));
vi.mock('../../lib/scoring/site-calculator', () => ({
  calculateSiteScore: vi.fn(),
  aggregateViolations: vi.fn(),
}));
vi.mock('../../lib/ci/threshold', () => ({
  evaluateThreshold: vi.fn(),
  getDefaultThreshold: vi.fn(),
}));
vi.mock('../../lib/ci/formatters/json', () => ({
  formatJson: vi.fn(),
}));
vi.mock('../../lib/ci/formatters/sarif', () => ({
  formatSarif: vi.fn(),
}));
vi.mock('../../lib/ci/formatters/junit', () => ({
  formatJunit: vi.fn(),
}));
vi.mock('../config/loader', () => ({
  loadConfig: vi.fn(),
  mergeConfig: vi.fn(),
}));
vi.mock('fs', () => ({
  writeFileSync: vi.fn(),
}));

import { createCrawl, getCrawl, getScan } from '../../lib/scanner/store';
import { startCrawl } from '../../lib/crawler/site-crawler';
import { calculateSiteScore, aggregateViolations } from '../../lib/scoring/site-calculator';
import { evaluateThreshold, getDefaultThreshold } from '../../lib/ci/threshold';
import { formatJson } from '../../lib/ci/formatters/json';
import { formatSarif } from '../../lib/ci/formatters/sarif';
import { formatJunit } from '../../lib/ci/formatters/junit';
import { loadConfig, mergeConfig } from '../config/loader';
import * as fs from 'fs';
import { crawlCommand } from '../commands/crawl';

// Mock data
const mockScanRecord = {
  id: 'page-1',
  url: 'https://example.com',
  status: 'complete' as const,
  progress: 100,
  message: 'Done',
  startedAt: '2026-01-01T00:00:00.000Z',
  completedAt: '2026-01-01T00:00:01.000Z',
  results: {
    url: 'https://example.com',
    timestamp: '2026-01-01T00:00:00.000Z',
    engineVersion: 'axe-core 4.10.0',
    violations: [],
    passes: [],
    incomplete: [],
    inapplicable: [],
    score: {
      overallScore: 95,
      grade: 'A' as const,
      principleScores: {},
      impactBreakdown: {},
      totalViolations: 0,
      totalElementViolations: 0,
      totalPasses: 10,
      totalIncomplete: 0,
      aodaCompliant: true,
    },
  },
};

const mockCrawlRecord = {
  id: 'mock-crawl-id',
  seedUrl: 'https://example.com',
  config: {} as Record<string, unknown>,
  status: 'complete' as const,
  progress: 100,
  message: 'Done',
  startedAt: '2026-01-01T00:00:00.000Z',
  completedAt: '2026-01-01T00:00:05.000Z',
  discoveredUrls: ['https://example.com'],
  pageIds: ['page-1'],
  completedPageCount: 1,
  failedPageCount: 0,
  totalPageCount: 1,
};

const mockSiteScore = {
  overallScore: 95,
  grade: 'A' as const,
  lowestPageScore: 95,
  highestPageScore: 95,
  medianPageScore: 95,
  pageCount: 1,
  principleScores: {},
  impactBreakdown: {},
  totalUniqueViolations: 0,
  totalViolationInstances: 0,
  totalPasses: 10,
  aodaCompliant: true,
};

const mockEvaluation = {
  scorePassed: true,
  countPassed: true,
  rulePassed: true,
  details: [],
};

const mockDefaultThreshold = { score: 70 };

describe('crawl command', () => {
  let mockExit: ReturnType<typeof vi.spyOn>;
  let mockStdout: ReturnType<typeof vi.spyOn>;
  let mockStderr: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as unknown as (code?: number) => never);
    mockStdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    mockStderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    // Default mock setups
    vi.mocked(loadConfig).mockReturnValue({});
    vi.mocked(mergeConfig).mockImplementation((config, opts) => ({ ...config, ...opts }));
    vi.mocked(startCrawl).mockResolvedValue(undefined);
    vi.mocked(getCrawl).mockReturnValue(mockCrawlRecord);
    vi.mocked(getScan).mockReturnValue(mockScanRecord);
    vi.mocked(calculateSiteScore).mockReturnValue(mockSiteScore);
    vi.mocked(aggregateViolations).mockReturnValue([]);
    vi.mocked(getDefaultThreshold).mockReturnValue(mockDefaultThreshold);
    vi.mocked(evaluateThreshold).mockReturnValue(mockEvaluation);
    vi.mocked(formatJson).mockReturnValue('{"passed":true}');
    vi.mocked(formatSarif).mockReturnValue('{"$schema":"sarif"}');
    vi.mocked(formatJunit).mockReturnValue('<testsuites/>');
  });

  afterEach(() => {
    mockExit.mockRestore();
    mockStdout.mockRestore();
    mockStderr.mockRestore();
  });

  it('runs crawl with --url flag and exits 0 on passing threshold', async () => {
    await crawlCommand.parseAsync(['node', 'test', '--url', 'https://example.com']);

    expect(createCrawl).toHaveBeenCalled();
    expect(startCrawl).toHaveBeenCalled();
    expect(getCrawl).toHaveBeenCalledWith('mock-crawl-id');
    expect(calculateSiteScore).toHaveBeenCalled();
    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it('passes max-pages option to crawl config', async () => {
    await crawlCommand.parseAsync(['node', 'test', '--url', 'https://example.com', '--max-pages', '10']);

    expect(createCrawl).toHaveBeenCalledWith(
      'mock-crawl-id',
      'https://example.com',
      expect.objectContaining({ maxPages: 10 })
    );
  });

  it('passes max-depth option to crawl config', async () => {
    await crawlCommand.parseAsync(['node', 'test', '--url', 'https://example.com', '--max-depth', '5']);

    expect(createCrawl).toHaveBeenCalledWith(
      'mock-crawl-id',
      'https://example.com',
      expect.objectContaining({ maxDepth: 5 })
    );
  });

  it('passes concurrency option to crawl config', async () => {
    await crawlCommand.parseAsync(['node', 'test', '--url', 'https://example.com', '--concurrency', '5']);

    expect(createCrawl).toHaveBeenCalledWith(
      'mock-crawl-id',
      'https://example.com',
      expect.objectContaining({ concurrency: 5 })
    );
  });

  it('outputs JSON to stdout by default', async () => {
    await crawlCommand.parseAsync(['node', 'test', '--url', 'https://example.com']);

    expect(formatJson).toHaveBeenCalled();
    expect(mockStdout).toHaveBeenCalledWith(expect.stringContaining('{"passed":true}'));
  });

  it('uses sarif format when --format sarif is specified', async () => {
    await crawlCommand.parseAsync(['node', 'test', '--url', 'https://example.com', '--format', 'sarif']);

    expect(formatSarif).toHaveBeenCalled();
    expect(mockStdout).toHaveBeenCalledWith(expect.stringContaining('sarif'));
  });

  it('uses junit format when --format junit is specified', async () => {
    await crawlCommand.parseAsync(['node', 'test', '--url', 'https://example.com', '--format', 'junit']);

    expect(formatJunit).toHaveBeenCalled();
  });

  it('writes to file when --output is specified', async () => {
    await crawlCommand.parseAsync(['node', 'test', '--url', 'https://example.com', '--output', 'crawl-results.json']);

    expect(fs.writeFileSync).toHaveBeenCalledWith('crawl-results.json', expect.any(String), 'utf-8');
  });

  it('exits 1 when threshold fails', async () => {
    vi.mocked(evaluateThreshold).mockReturnValue({
      scorePassed: false,
      countPassed: true,
      rulePassed: true,
      details: ['Score below threshold'],
    });

    await crawlCommand.parseAsync(['node', 'test', '--url', 'https://example.com']);

    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('exits 2 and writes error to stderr when crawler throws', async () => {
    vi.mocked(startCrawl).mockRejectedValueOnce(new Error('Crawl failed'));

    await crawlCommand.parseAsync(['node', 'test', '--url', 'https://example.com']);

    expect(mockStderr).toHaveBeenCalledWith(expect.stringContaining('Crawl failed'));
    expect(mockExit).toHaveBeenCalledWith(2);
  });

  it('exits 2 when getCrawl returns undefined', async () => {
    vi.mocked(getCrawl).mockReturnValue(undefined as unknown as ReturnType<typeof getCrawl>);

    await crawlCommand.parseAsync(['node', 'test', '--url', 'https://example.com']);

    expect(mockStderr).toHaveBeenCalledWith(expect.stringContaining('Crawl record not found'));
    expect(mockExit).toHaveBeenCalledWith(2);
  });

  it('calls loadConfig with config path when --config is specified', async () => {
    await crawlCommand.parseAsync(['node', 'test', '--url', 'https://example.com', '--config', 'crawl-config.json']);

    expect(loadConfig).toHaveBeenCalledWith('crawl-config.json');
  });
});
