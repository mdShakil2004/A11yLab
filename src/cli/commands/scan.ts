import { Command } from 'commander';
import { scanUrl } from '../../lib/scanner/engine';
import { parseAxeResults } from '../../lib/scanner/result-parser';
import { evaluateThreshold, getDefaultThreshold } from '../../lib/ci/threshold';
import { formatJson } from '../../lib/ci/formatters/json';
import { formatSarif } from '../../lib/ci/formatters/sarif';
import { formatJunit } from '../../lib/ci/formatters/junit';
import { loadConfig, mergeConfig } from '../config/loader';
import type { CiResult, CiViolationSummary, ThresholdConfig } from '../../lib/types/crawl';
import * as fs from 'fs';

export const scanCommand = new Command('scan')
  .description('Run a single-page accessibility scan')
  .requiredOption('--url <url>', 'URL to scan')
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

      const thresholdScore = Number(opts.threshold) || merged.threshold?.score || 70;

      process.stderr.write(`Scanning ${url}...\n`);

      // Run scan in-process
      const axeResults = await scanUrl(url, (status, progress) => {
        process.stderr.write(`  [${progress}%] ${status}\n`);
      });

      // Parse results
      const scanResults = parseAxeResults(url, axeResults);

      // Build threshold config
      const thresholdConfig: ThresholdConfig = {
        ...getDefaultThreshold(),
        ...merged.threshold,
        score: thresholdScore,
      };

      // Evaluate threshold
      const evaluation = evaluateThreshold(
        scanResults.score.overallScore,
        scanResults.violations,
        thresholdConfig
      );

      const passed = evaluation.scorePassed && evaluation.countPassed && evaluation.rulePassed;

      // Build violation summaries
      const violations: CiViolationSummary[] = scanResults.violations.map((v) => ({
        ruleId: v.id,
        impact: v.impact,
        description: v.description,
        instanceCount: v.nodes.length,
        helpUrl: v.helpUrl,
      }));

      // Build CiResult
      const ciResult: CiResult = {
        passed,
        score: scanResults.score.overallScore,
        grade: scanResults.score.grade,
        url,
        timestamp: new Date().toISOString(),
        violationCount: scanResults.violations.length,
        thresholdEvaluation: evaluation,
        violations,
      };

      // Format output
      const format = (opts.format as string) || merged.output?.format?.[0] || 'json';
      let output: string;
      switch (format) {
        case 'sarif':
          output = formatSarif(url, scanResults.violations, scanResults.engineVersion);
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

      // Exit code
      process.stderr.write(
        passed
          ? `\nPASSED — Score: ${ciResult.score} (${ciResult.grade})\n`
          : `\nFAILED — Score: ${ciResult.score} (${ciResult.grade})\n`
      );
      process.exit(passed ? 0 : 1);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      process.stderr.write(`Error: ${msg}\n`);
      process.exit(2);
    }
  });
