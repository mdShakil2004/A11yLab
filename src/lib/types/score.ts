export interface ScoreResult {
  overallScore: number;
  grade: ScoreGrade;
  principleScores: PrincipleScores;
  impactBreakdown: ImpactBreakdown;
  totalViolations: number;
  totalElementViolations: number;
  totalPasses: number;
  totalIncomplete: number;
  aodaCompliant: boolean;
}

export type ScoreGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface PrincipleScores {
  perceivable: PrincipleScore;
  operable: PrincipleScore;
  understandable: PrincipleScore;
  robust: PrincipleScore;
}

export interface PrincipleScore {
  score: number;
  violationCount: number;
  passCount: number;
}

export interface ImpactBreakdown {
  critical: { passed: number; failed: number };
  serious: { passed: number; failed: number };
  moderate: { passed: number; failed: number };
  minor: { passed: number; failed: number };
}
