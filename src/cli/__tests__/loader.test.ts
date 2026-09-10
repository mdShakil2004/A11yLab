import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  resolve: vi.fn((p: string) => `/resolved/${p}`),
  parse: vi.fn(() => ({ root: '/' })),
  join: vi.fn((...parts: string[]) => parts.join('/')),
  dirname: vi.fn((p: string) => {
    const parts = p.split('/').filter(Boolean);
    if (parts.length <= 1) return '/';
    return '/' + parts.slice(0, -1).join('/');
  }),
}));

vi.mock('fs', () => ({
  existsSync: mocks.existsSync,
  readFileSync: mocks.readFileSync,
}));

vi.mock('path', () => ({
  resolve: mocks.resolve,
  parse: mocks.parse,
  join: mocks.join,
  dirname: mocks.dirname,
}));

import { loadConfig, mergeConfig } from '../config/loader';

describe('loadConfig', () => {
  let mockCwd: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Re-set implementations after clearAllMocks clears call data
    mocks.resolve.mockImplementation((p: string) => `/resolved/${p}`);
    mocks.parse.mockImplementation(() => ({ root: '/' }));
    mocks.join.mockImplementation((...parts: string[]) => parts.join('/'));
    mocks.dirname.mockImplementation((p: string) => {
      const parts = p.split('/').filter(Boolean);
      if (parts.length <= 1) return '/';
      return '/' + parts.slice(0, -1).join('/');
    });
    mockCwd = vi.spyOn(process, 'cwd').mockReturnValue('/home/user/project');
  });

  afterEach(() => {
    mockCwd.mockRestore();
  });

  it('reads and parses JSON when explicit path exists', () => {
    const mockConfig = { url: 'https://example.com', standard: 'WCAG2AA' };
    mocks.existsSync.mockReturnValue(true);
    mocks.readFileSync.mockReturnValue(JSON.stringify(mockConfig));

    const result = loadConfig('config.json');

    expect(mocks.resolve).toHaveBeenCalledWith('config.json');
    expect(mocks.existsSync).toHaveBeenCalledWith('/resolved/config.json');
    expect(mocks.readFileSync).toHaveBeenCalledWith('/resolved/config.json', 'utf-8');
    expect(result).toEqual(mockConfig);
  });

  it('throws Error when explicit path does not exist', () => {
    mocks.existsSync.mockReturnValue(false);

    expect(() => loadConfig('missing.json')).toThrow('Config file not found');
  });

  it('finds .a11yrc.json in cwd when no path given', () => {
    const mockConfig = { url: 'https://test.com' };
    mocks.existsSync.mockImplementation((p: string) => {
      return p === '/home/user/project/.a11yrc.json';
    });
    mocks.readFileSync.mockReturnValue(JSON.stringify(mockConfig));

    const result = loadConfig();

    expect(result).toEqual(mockConfig);
  });

  it('walks up directories to find .a11yrc.json in parent', () => {
    const mockConfig = { url: 'https://parent.com' };
    mocks.existsSync.mockImplementation((p: string) => {
      return p === '/home/user/.a11yrc.json';
    });
    mocks.readFileSync.mockReturnValue(JSON.stringify(mockConfig));

    const result = loadConfig();

    expect(result).toEqual(mockConfig);
  });

  it('returns empty object when no .a11yrc.json found anywhere', () => {
    mocks.existsSync.mockReturnValue(false);

    const result = loadConfig();

    expect(result).toEqual({});
  });

  it('throws SyntaxError when file contains invalid JSON', () => {
    mocks.existsSync.mockReturnValue(true);
    mocks.readFileSync.mockReturnValue('{ invalid json }');

    expect(() => loadConfig('bad.json')).toThrow(SyntaxError);
  });
});

describe('mergeConfig', () => {
  it('CLI url overrides config url', () => {
    const config = { url: 'https://config.com' };
    const result = mergeConfig(config, { url: 'https://cli.com' });
    expect(result.url).toBe('https://cli.com');
  });

  it('CLI threshold sets score', () => {
    const config = {};
    const result = mergeConfig(config, { threshold: '90' });
    expect(result.threshold?.score).toBe(90);
  });

  it('CLI format sets output format array', () => {
    const config = {};
    const result = mergeConfig(config, { format: 'sarif' });
    expect(result.output?.format).toEqual(['sarif']);
  });

  it('CLI maxPages sets crawl maxPages option', () => {
    const config = {};
    const result = mergeConfig(config, { maxPages: '10' });
    expect(result.crawl?.maxPages).toBe(10);
  });

  it('CLI maxDepth sets crawl maxDepth option', () => {
    const config = {};
    const result = mergeConfig(config, { maxDepth: '5' });
    expect(result.crawl?.maxDepth).toBe(5);
  });

  it('CLI concurrency sets crawl concurrency option', () => {
    const config = {};
    const result = mergeConfig(config, { concurrency: '4' });
    expect(result.crawl?.concurrency).toBe(4);
  });

  it('preserves config values when CLI options are missing', () => {
    const config = {
      url: 'https://keep.com',
      threshold: { score: 80 },
      output: { format: ['json' as const] },
      crawl: { maxPages: 20, maxDepth: 2, concurrency: 2 },
    };
    const result = mergeConfig(config, {});
    expect(result.url).toBe('https://keep.com');
    expect(result.threshold?.score).toBe(80);
    expect(result.output?.format).toEqual(['json']);
    expect(result.crawl?.maxPages).toBe(20);
  });

  it('applies CLI values to empty config', () => {
    const result = mergeConfig({}, {
      url: 'https://new.com',
      threshold: '95',
      format: 'junit',
      maxPages: '100',
      maxDepth: '5',
      concurrency: '5',
    });
    expect(result.url).toBe('https://new.com');
    expect(result.threshold?.score).toBe(95);
    expect(result.output?.format).toEqual(['junit']);
    expect(result.crawl?.maxPages).toBe(100);
    expect(result.crawl?.maxDepth).toBe(5);
    expect(result.crawl?.concurrency).toBe(5);
  });
});
