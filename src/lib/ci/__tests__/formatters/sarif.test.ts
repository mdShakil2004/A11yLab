import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { AxeViolation } from '../../../types/scan';

vi.mock('../../../report/sarif-generator', () => ({
  generateSarif: vi.fn(),
}));

import { formatSarif } from '../../formatters/sarif';
import { generateSarif } from '../../../report/sarif-generator';

const mockGenerateSarif = vi.mocked(generateSarif);

function makeViolation(overrides: Partial<AxeViolation> = {}): AxeViolation {
  return {
    id: 'color-contrast',
    impact: 'serious',
    tags: ['wcag2aa', 'wcag143'],
    description: 'Insufficient contrast',
    help: 'Ensure contrast ratio',
    helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast',
    nodes: [{ html: '<p>text</p>', target: ['p'], impact: 'serious', failureSummary: 'Fix' }],
    ...overrides,
  };
}

describe('formatSarif', () => {
  beforeEach(() => {
    mockGenerateSarif.mockReset();
  });

  it('calls generateSarif with correct arguments', () => {
    const mockSarifLog = { $schema: 'test', version: '2.1.0', runs: [] };
    mockGenerateSarif.mockReturnValue(mockSarifLog as ReturnType<typeof generateSarif>);

    const violations = [makeViolation()];
    formatSarif('https://example.com', violations, '1.0.0');

    expect(mockGenerateSarif).toHaveBeenCalledWith('https://example.com', violations, '1.0.0');
    expect(mockGenerateSarif).toHaveBeenCalledTimes(1);
  });

  it('returns JSON stringified result', () => {
    const mockSarifLog = { $schema: 'test', version: '2.1.0', runs: [{ tool: { driver: { name: 'test' } } }] };
    mockGenerateSarif.mockReturnValue(mockSarifLog as ReturnType<typeof generateSarif>);

    const result = formatSarif('https://example.com', [makeViolation()], '1.0.0');
    expect(result).toBe(JSON.stringify(mockSarifLog, null, 2));
  });

  it('returns valid parseable JSON', () => {
    const mockSarifLog = { $schema: 'test', version: '2.1.0', runs: [] };
    mockGenerateSarif.mockReturnValue(mockSarifLog as ReturnType<typeof generateSarif>);

    const result = formatSarif('https://example.com', [makeViolation()], '1.0.0');
    expect(() => JSON.parse(result)).not.toThrow();
  });

  it('handles empty violations', () => {
    const mockSarifLog = { $schema: 'test', version: '2.1.0', runs: [{ tool: { driver: { name: 'scanner', rules: [] } }, results: [] }] };
    mockGenerateSarif.mockReturnValue(mockSarifLog as ReturnType<typeof generateSarif>);

    const result = formatSarif('https://example.com', [], '1.0.0');
    expect(() => JSON.parse(result)).not.toThrow();
    expect(mockGenerateSarif).toHaveBeenCalledWith('https://example.com', [], '1.0.0');
  });
});
