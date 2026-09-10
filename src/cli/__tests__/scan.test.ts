import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('../../lib/scanner/engine', () => ({
  scanUrl: vi.fn(),
}));
vi.mock('../../lib/scanner/result-parser', () => ({
  parseAxeResults: vi.fn(),
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

import { scanUrl } from '../../lib/scanner/engine';
import { parseAxeResults } from '../../lib/scanner/result-parser';
import { evaluateThreshold, getDefaultThreshold } from '../../lib/ci/threshold';
import { formatJson } from '../../lib/ci/formatters/json';
import { formatSarif } from '../../lib/ci/formatters/sarif';
import { formatJunit } from '../../lib/ci/formatters/junit';
import { loadConfig, mergeConfig } from '../config/loader';
import * as fs from 'fs';
import { scanCommand } from '../commands/scan';

// Standard mock data — uses MultiEngineResults shape (returned by scanUrl)
const mockAxeResults = {
  violations: [],
  passes: [],
  incomplete: [],
  inapplicable: [],
  engineVersions: { 'axe-core': '4.10.0' },
};

const mockScanResults = {
  url: 'https://example.com',
  timestamp: '2026-01-01T00:00:00.000Z',
  engineVersion: 'axe-core 4.10.0',
  violations: [],
  passes: [],
  incomplete: [],
  inapplicable: [],
  score: {
    overallScore: 100,
    grade: 'A' as const,
    principleScores: {},
    impactBreakdown: {},
    totalViolations: 0,
    totalElementViolations: 0,
    totalPasses: 0,
    totalIncomplete: 0,
    aodaCompliant: true,
  },
};

const mockEvaluation = {
  scorePassed: true,
  countPassed: true,
  rulePassed: true,
  details: [],
};

const mockDefaultThreshold = { score: 70 };

describe('scan command', () => {
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
    vi.mocked(scanUrl).mockResolvedValue(mockAxeResults);
    vi.mocked(parseAxeResults).mockReturnValue(mockScanResults);
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

  it('runs scan with --url flag and exits 0 on passing threshold', async () => {
    await scanCommand.parseAsync(['node', 'test', '--url', 'https://example.com']);

    expect(scanUrl).toHaveBeenCalled();
    expect(parseAxeResults).toHaveBeenCalled();
    expect(evaluateThreshold).toHaveBeenCalled();
    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it('outputs JSON to stdout by default', async () => {
    await scanCommand.parseAsync(['node', 'test', '--url', 'https://example.com']);

    expect(formatJson).toHaveBeenCalled();
    expect(mockStdout).toHaveBeenCalledWith(expect.stringContaining('{"passed":true}'));
  });

  it('uses sarif format when --format sarif is specified', async () => {
    await scanCommand.parseAsync(['node', 'test', '--url', 'https://example.com', '--format', 'sarif']);

    expect(formatSarif).toHaveBeenCalled();
    expect(mockStdout).toHaveBeenCalledWith(expect.stringContaining('sarif'));
  });

  it('uses junit format when --format junit is specified', async () => {
    await scanCommand.parseAsync(['node', 'test', '--url', 'https://example.com', '--format', 'junit']);

    expect(formatJunit).toHaveBeenCalled();
    expect(mockStdout).toHaveBeenCalledWith(expect.stringContaining('<testsuites/>'));
  });

  it('writes to file when --output is specified', async () => {
    await scanCommand.parseAsync(['node', 'test', '--url', 'https://example.com', '--output', 'results.json']);

    expect(fs.writeFileSync).toHaveBeenCalledWith('results.json', expect.any(String), 'utf-8');
    // Should NOT write to stdout when outputting to file
  });

  it('exits 1 when threshold fails', async () => {
    vi.mocked(evaluateThreshold).mockReturnValue({
      scorePassed: false,
      countPassed: true,
      rulePassed: true,
      details: ['Score 40 below threshold 70'],
    });

    await scanCommand.parseAsync(['node', 'test', '--url', 'https://example.com']);

    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('exits 2 and writes error to stderr when scanner throws', async () => {
    vi.mocked(scanUrl).mockRejectedValueOnce(new Error('Network timeout'));

    await scanCommand.parseAsync(['node', 'test', '--url', 'https://example.com']);

    expect(mockStderr).toHaveBeenCalledWith(expect.stringContaining('Network timeout'));
    expect(mockExit).toHaveBeenCalledWith(2);
  });

  it('calls loadConfig with config path when --config is specified', async () => {
    await scanCommand.parseAsync(['node', 'test', '--url', 'https://example.com', '--config', 'my-config.json']);

    expect(loadConfig).toHaveBeenCalledWith('my-config.json');
  });

  it('calls scanUrl with the provided URL', async () => {
    await scanCommand.parseAsync(['node', 'test', '--url', 'https://test-scan.com']);

    expect(scanUrl).toHaveBeenCalledWith('https://test-scan.com', expect.any(Function));
  });

  it('passes threshold score from --threshold option', async () => {
    await scanCommand.parseAsync(['node', 'test', '--url', 'https://example.com', '--threshold', '90']);

    expect(evaluateThreshold).toHaveBeenCalledWith(
      expect.any(Number),
      expect.any(Array),
      expect.objectContaining({ score: 90 })
    );
  });
});
