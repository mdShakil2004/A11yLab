import * as fs from 'fs';
import * as path from 'path';
import type { ThresholdConfig } from '../../lib/types/crawl';

export interface A11yConfig {
  url?: string;
  standard?: 'WCAG2A' | 'WCAG2AA' | 'WCAG2AAA';
  threshold?: ThresholdConfig;
  output?: {
    format?: ('json' | 'sarif' | 'junit')[];
    directory?: string;
  };
  crawl?: {
    maxPages?: number;
    maxDepth?: number;
    concurrency?: number;
  };
}

/**
 * Load .a11yrc.json from the given path or search up from cwd.
 * Returns parsed config or empty object if not found.
 */
export function loadConfig(configPath?: string): A11yConfig {
  if (configPath) {
    const resolved = path.resolve(configPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Config file not found: ${resolved}`);
    }
    return JSON.parse(fs.readFileSync(resolved, 'utf-8')) as A11yConfig;
  }

  // Walk up from cwd looking for .a11yrc.json
  let dir = process.cwd();
  const root = path.parse(dir).root;

  while (dir !== root) {
    const candidate = path.join(dir, '.a11yrc.json');
    if (fs.existsSync(candidate)) {
      return JSON.parse(fs.readFileSync(candidate, 'utf-8')) as A11yConfig;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return {};
}

/**
 * Merge CLI options with loaded config. CLI flags take precedence.
 */
export function mergeConfig(config: A11yConfig, cliOptions: Record<string, unknown>): A11yConfig {
  const merged = { ...config };

  if (cliOptions.url) {
    merged.url = cliOptions.url as string;
  }

  if (cliOptions.threshold) {
    merged.threshold = {
      ...merged.threshold,
      score: Number(cliOptions.threshold),
    };
  }

  if (cliOptions.format) {
    merged.output = {
      ...merged.output,
      format: [cliOptions.format as 'json' | 'sarif' | 'junit'],
    };
  }

  if (cliOptions.maxPages || cliOptions.maxDepth || cliOptions.concurrency) {
    merged.crawl = {
      ...merged.crawl,
      ...(cliOptions.maxPages ? { maxPages: Number(cliOptions.maxPages) } : {}),
      ...(cliOptions.maxDepth ? { maxDepth: Number(cliOptions.maxDepth) } : {}),
      ...(cliOptions.concurrency ? { concurrency: Number(cliOptions.concurrency) } : {}),
    };
  }

  return merged;
}
