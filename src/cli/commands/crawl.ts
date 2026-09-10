import { Command } from 'commander';
import { v4 as uuidv4 } from 'uuid';
import { createCrawl, getCrawl, getScan } from '../../lib/scanner/store';
import { startCrawl } from '../../lib/crawler/site-crawler';
import { calculateSiteScore, aggregateViolations } from '../../lib/scoring/site-calculator';
import { evaluateThreshold, getDefaultThreshold } from '../../lib/ci/threshold';
import { formatJson } from '../../lib/ci/formatters/json';
import { formatSarif } from '../../lib/ci/formatters/sarif';
import { formatJunit } from '../../lib/ci/formatters/junit';
import { loadConfig, mergeConfig } from '../config/loader';
import type { CiResult, CiViolationSummary, CrawlConfig } from '../../lib/types/crawl';
import type { ScanRecord } from '../../lib/types/scan';
import * as fs from 'fs';

export const crawlCommand = new Command('crawl')
  .description('Run a site-wide accessibility crawl')
  .requiredOption('--url <url>', 'Seed URL to crawl')
  .option('--max-pages <n>', 'Maximum pages to scan', '50')
  .option('--max-depth <n>', 'Maximum crawl depth', '3')
  .option('--concurrency <n>', 'Concurrent page scans', '3')
  .option('--threshold <score>', 'Minimum accessibility score (0-100)', '70')
  .option('--format <format>', 'Output format: json, sarif, junit', 'json')
  .option('--output <path>', 'Output file path')
  .option('--config <path>', 'Path to .a11yrc.json config file')
  .action(async (opts) => {
    try {
      // Load and merge config
      const fileConfig = loadConfig(opts.config);
      const merged = mergeConfig(fileConfig, opts);

      const url = (opts.url as string) || merged.url;
      if (!url) {
        process.stderr.write('Error: --url is required\n');
        process.exit(2);
      }

      const maxPages = Number(opts.maxPages) || merged.crawl?.maxPages || 50;
      const maxDepth = Number(opts.maxDepth) || merged.crawl?.maxDepth || 3;
      const concurrency = Number(opts.concurrency) || merged.crawl?.concurrency || 3;
      const thresholdScore = Number(opts.threshold) || merged.threshold?.score || 70;

      // Build CrawlConfig
      const crawlConfig: CrawlConfig = {
        maxPages,
        maxDepth,
        concurrency,
        delayMs: 1000,
        includePatterns: [],
        excludePatterns: [],
        respectRobotsTxt: true,
        followSitemaps: true,
        domainStrategy: 'same-hostname',
      };

      const crawlId = uuidv4();
      createCrawl(crawlId, url, crawlConfig);

      process.stderr.write(`Crawling ${url} (max ${maxPages} pages, depth ${maxDepth})...\n`);

      // Run crawl with progress on stderr
      await startCrawl(crawlId, url, crawlConfig, (event) => {
        process.stderr.write(
          `  [${event.progress}%] ${event.message} (${event.completedPages}/${event.totalPages} pages)\n`
        );
      });

      // Get crawl record and collect page scan records
      const crawl = getCrawl(crawlId);
      if (!crawl) {
        process.stderr.write('Error: Crawl record not found\n');
        process.exit(2);
      }

      const pageRecords: ScanRecord[] = crawl.pageIds
        .map((id) => getScan(id))
        .filter((r): r is ScanRecord => r !== undefined);

      // Calculate site score and aggregate violations
      const siteScore = calculateSiteScore(pageRecords);
      const aggregated = aggregateViolations(pageRecords);

      // Build threshold config
      const thresholdConfig = {
        ...getDefaultThreshold(),
        ...merged.threshold,
        score: thresholdScore,
      };

      // Flatten violations for threshold evaluation
      const allViolations = pageRecords.flatMap((r) => r.results?.violations ?? []);

      // Evaluate threshold
      const evaluation = evaluateThreshold(
        siteScore.overallScore,
        allViolations,
        thresholdConfig
      );

      const passed = evaluation.scorePassed && evaluation.countPassed && evaluation.rulePassed;

      // Build violation summaries from aggregated data
      const violations: CiViolationSummary[] = aggregated.map((v) => ({
        ruleId: v.ruleId,
        impact: v.impact,
        description: v.description,
        instanceCount: v.totalInstances,
        helpUrl: v.helpUrl,
      }));

      // Build CiResult
      const ciResult: CiResult = {
        passed,
        score: siteScore.overallScore,
        grade: siteScore.grade,
        url,
        timestamp: new Date().toISOString(),
        violationCount: aggregated.length,
        thresholdEvaluation: evaluation,
        violations,
      };

      // Format output
      const format = (opts.format as string) || merged.output?.format?.[0] || 'json';
      let output: string;
      switch (format) {
        case 'sarif':
          output = formatSarif(url, allViolations, 'a11y-scan 0.1.0');
          break;
        case 'junit':
          output = formatJunit(ciResult);
          break;
        default:
          output = formatJson(ciResult);
          break;
      }

      // Write output
      if (opts.output) {
        fs.writeFileSync(opts.output as string, output, 'utf-8');
        process.stderr.write(`Results written to ${opts.output}\n`);
      } else {
        process.stdout.write(output + '\n');
      }

      // Summary on stderr
      process.stderr.write(
        `\n${passed ? 'PASSED' : 'FAILED'} — Site score: ${siteScore.overallScore} (${siteScore.grade}), ` +
        `${crawl.completedPageCount} pages scanned, ${aggregated.length} unique violations\n`
      );
      process.exit(passed ? 0 : 1);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      process.stderr.write(`Error: ${msg}\n`);
      process.exit(2);
    }
  });
