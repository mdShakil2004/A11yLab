import type { ThresholdConfig, ThresholdEvaluation } from '../types/crawl';
import type { AxeViolation } from '../types/scan';

export function evaluateThreshold(
  score: number,
  violations: AxeViolation[],
  config: ThresholdConfig
): ThresholdEvaluation {
  const filtered = config.ignoreRules?.length
    ? violations.filter((v) => !config.ignoreRules!.includes(v.id))
    : violations;

  const details: string[] = [];

  // Score check
  let scorePassed = true;
  if (config.score != null) {
    scorePassed = score >= config.score;
    details.push(
      scorePassed
        ? `Score ${score} meets threshold ${config.score}`
        : `Score ${score} below threshold ${config.score}`
    );
  }

  // Count check per impact level
  let countPassed = true;
  const impactLevels = ['critical', 'serious', 'moderate', 'minor'] as const;
  for (const impact of impactLevels) {
    const max = config.maxViolations?.[impact];
    if (max === undefined || max === null) continue;
    const count = filtered.filter((v) => v.impact === impact).length;
    const passed = count <= max;
    if (!passed) countPassed = false;
    details.push(
      passed
        ? `${impact} violations: ${count} (max ${max}) — passed`
        : `${impact} violations: ${count} exceeds max ${max} — failed`
    );
  }

  // Rule check
  let rulePassed = true;
  if (config.failOnRules?.length) {
    const violatedIds = new Set(filtered.map((v) => v.id));
    for (const ruleId of config.failOnRules) {
      if (violatedIds.has(ruleId)) {
        rulePassed = false;
        details.push(`Required rule "${ruleId}" has violations — failed`);
      } else {
        details.push(`Required rule "${ruleId}" has no violations — passed`);
      }
    }
  }

  return {
    scorePassed,
    countPassed,
    rulePassed,
    details,
  };
}

export function getDefaultThreshold(): ThresholdConfig {
  return {
    score: 70,
    maxViolations: {
      critical: 0,
      serious: 5,
      moderate: null,
      minor: null,
    },
    failOnRules: [],
    ignoreRules: [],
  };
}
