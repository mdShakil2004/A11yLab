import type { ScanResults, AxeViolation, AxePass, AxeIncomplete, AxeInapplicable, MultiEngineResults } from '../types/scan';
import type { AxeResults } from 'axe-core';
import { mapTagToPrinciple } from '../scoring/wcag-mapper';
import { calculateScore } from '../scoring/calculator';

function isMultiEngineResults(raw: AxeResults | MultiEngineResults): raw is MultiEngineResults {
  return 'engineVersions' in raw;
}

export function parseAxeResults(url: string, raw: AxeResults | MultiEngineResults): ScanResults {
  if (isMultiEngineResults(raw)) {
    return parseMultiEngineResults(url, raw);
  }

  return parseSingleEngineResults(url, raw);
}

function parseMultiEngineResults(url: string, raw: MultiEngineResults): ScanResults {
  // Violations are already in NormalizedViolation format with principle set
  const violations: AxeViolation[] = raw.violations.map(v => ({
    ...v,
    principle: v.principle ?? mapTagToPrinciple(v.tags),
  }));

  const score = calculateScore(violations, raw.passes, raw.incomplete.length);

  const engineVersionStr = Object.entries(raw.engineVersions)
    .map(([name, version]) => `${name} ${version}`)
    .join(', ');

  return {
    url,
    timestamp: new Date().toISOString(),
    engineVersion: engineVersionStr,
    violations,
    passes: raw.passes,
    incomplete: raw.incomplete,
    inapplicable: raw.inapplicable,
    score,
  };
}

function parseSingleEngineResults(url: string, raw: AxeResults): ScanResults {
  const violations: AxeViolation[] = raw.violations.map(v => ({
    id: v.id,
    impact: (v.impact as AxeViolation['impact']) || 'minor',
    tags: v.tags,
    description: v.description,
    help: v.help,
    helpUrl: v.helpUrl,
    nodes: v.nodes.map(n => ({
      html: n.html,
      target: n.target.map(String),
      impact: n.impact || 'minor',
      failureSummary: n.failureSummary,
    })),
    principle: mapTagToPrinciple(v.tags),
  }));

  const passes: AxePass[] = raw.passes.map(p => ({
    id: p.id,
    tags: p.tags,
    description: p.description,
    nodes: p.nodes.map(n => ({
      html: n.html,
      target: n.target.map(String),
    })),
  }));

  const incomplete: AxeIncomplete[] = raw.incomplete.map(i => ({
    id: i.id,
    impact: i.impact || null,
    tags: i.tags,
    description: i.description,
    help: i.help,
    helpUrl: i.helpUrl,
    nodes: i.nodes.map(n => ({
      html: n.html,
      target: n.target.map(String),
      impact: n.impact || 'minor',
      failureSummary: n.failureSummary,
    })),
  }));

  const inapplicable: AxeInapplicable[] = raw.inapplicable.map(ia => ({
    id: ia.id,
    tags: ia.tags,
    description: ia.description,
  }));

  const score = calculateScore(violations, passes, incomplete.length);

  return {
    url,
    timestamp: new Date().toISOString(),
    engineVersion: `axe-core ${raw.testEngine?.version || 'unknown'}`,
    violations,
    passes,
    incomplete,
    inapplicable,
    score,
  };
}
