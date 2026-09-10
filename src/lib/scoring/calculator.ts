import type { ScoreResult, ScoreGrade, PrincipleScores, ImpactBreakdown } from '../types/score';
import type { AxeViolation, AxePass } from '../types/scan';
import { mapTagToPrinciple } from './wcag-mapper';

const IMPACT_WEIGHTS: Record<string, number> = {
  critical: 10,
  serious: 7,
  moderate: 3,
  minor: 1,
};

function getGrade(score: number): ScoreGrade {
  if (score >= 90) return 'A';
  if (score >= 70) return 'B';
  if (score >= 50) return 'C';
  if (score >= 30) return 'D';
  return 'F';
}

export function calculateScore(
  violations: AxeViolation[],
  passes: AxePass[],
  incompleteCount: number
): ScoreResult {
  const impactBreakdown: ImpactBreakdown = {
    critical: { passed: 0, failed: 0 },
    serious: { passed: 0, failed: 0 },
    moderate: { passed: 0, failed: 0 },
    minor: { passed: 0, failed: 0 },
  };

  const principleData: Record<string, { violations: number; passes: number }> = {
    perceivable: { violations: 0, passes: 0 },
    operable: { violations: 0, passes: 0 },
    understandable: { violations: 0, passes: 0 },
    robust: { violations: 0, passes: 0 },
  };

  // Count violations by impact and principle
  for (const violation of violations) {
    const impact = violation.impact || 'minor';
    if (impact in impactBreakdown) {
      impactBreakdown[impact as keyof ImpactBreakdown].failed++;
    }
    const principle = mapTagToPrinciple(violation.tags);
    if (principle in principleData) {
      principleData[principle].violations++;
    }
  }

  // Count passes by impact (assume minor weight) and principle
  for (const pass of passes) {
    // Passes don't have impact level — count as minor weight for scoring
    impactBreakdown.minor.passed++;
    const principle = mapTagToPrinciple(pass.tags);
    if (principle in principleData) {
      principleData[principle].passes++;
    }
  }

  // Calculate weighted score
  let weightedPassed = 0;
  let weightedTotal = 0;

  for (const [impact, counts] of Object.entries(impactBreakdown)) {
    const weight = IMPACT_WEIGHTS[impact] || 1;
    weightedPassed += weight * counts.passed;
    weightedTotal += weight * (counts.passed + counts.failed);
  }

  const overallScore = weightedTotal > 0
    ? Math.round((weightedPassed / weightedTotal) * 100)
    : 100;

  // Calculate principle scores
  const principleScores: PrincipleScores = {
    perceivable: computePrincipleScore(principleData.perceivable),
    operable: computePrincipleScore(principleData.operable),
    understandable: computePrincipleScore(principleData.understandable),
    robust: computePrincipleScore(principleData.robust),
  };

  const totalElementViolations = violations.reduce((sum, v) => sum + v.nodes.length, 0);

  return {
    overallScore,
    grade: getGrade(overallScore),
    principleScores,
    impactBreakdown,
    totalViolations: violations.length,
    totalElementViolations,
    totalPasses: passes.length,
    totalIncomplete: incompleteCount,
    aodaCompliant: violations.length === 0,
  };
}

function computePrincipleScore(data: { violations: number; passes: number }) {
  const total = data.violations + data.passes;
  return {
    score: total > 0 ? Math.round((data.passes / total) * 100) : 100,
    violationCount: data.violations,
    passCount: data.passes,
  };
}
