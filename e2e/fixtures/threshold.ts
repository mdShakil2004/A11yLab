import { evaluateThreshold } from '../../src/lib/ci/threshold';
import type { ThresholdConfig } from '../../src/lib/types/crawl';
import type { AxeViolation } from '../../src/lib/types/scan';
import type { Result } from 'axe-core';

const DEFAULT_THRESHOLD: ThresholdConfig = {
  score: 90,
  maxViolations: {
    critical: 0,
    serious: 0,
    moderate: 3,
    minor: 5,
  },
};

function mapAxeResults(violations: Result[]): AxeViolation[] {
  return violations.map((v) => ({
    id: v.id,
    impact: (v.impact ?? 'minor') as AxeViolation['impact'],
    description: v.description,
    help: v.help,
    helpUrl: v.helpUrl,
    tags: v.tags,
    nodes: v.nodes.map((n) => ({
      html: n.html,
      target: n.target.map(String),
      impact: n.impact ?? v.impact ?? 'minor',
      failureSummary: n.failureSummary ?? '',
    })),
  }));
}

export function evaluateAccessibility(
  score: number,
  violations: Result[],
  config: ThresholdConfig = DEFAULT_THRESHOLD
) {
  const mapped = mapAxeResults(violations);
  const result = evaluateThreshold(score, mapped, config);
  return {
    passed: result.scorePassed && result.countPassed && result.rulePassed,
    details: result.details,
  };
}

export { DEFAULT_THRESHOLD };
export type { ThresholdConfig };
