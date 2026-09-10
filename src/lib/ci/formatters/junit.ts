import type { CiResult } from '../../types/crawl';

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function formatJunit(result: CiResult): string {
  const failures = result.violations.length;
  const tests = failures;
  const timestamp = new Date(result.timestamp).toISOString();

  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites>`,
    `  <testsuite name="${escapeXml(result.url)}" tests="${tests}" failures="${failures}" timestamp="${timestamp}" time="0">`,
  ];

  for (const violation of result.violations) {
    lines.push(
      `    <testcase name="${escapeXml(violation.ruleId)}" classname="${escapeXml(result.url)}">`,
      `      <failure message="${escapeXml(violation.description)}">${escapeXml(violation.description)} (${violation.instanceCount} instance${violation.instanceCount !== 1 ? 's' : ''}) — ${escapeXml(violation.helpUrl)}</failure>`,
      `    </testcase>`
    );
  }

  lines.push('  </testsuite>', '</testsuites>', '');

  return lines.join('\n');
}
