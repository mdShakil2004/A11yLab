import type { ScoreResult } from './score';
import type { AxeViolation, AxePass, AxeIncomplete } from './scan';

export interface ReportData {
  url: string;
  scanDate: string;
  engineVersion: string;
  score: ScoreResult;
  violations: AxeViolation[];
  passes: AxePass[];
  incomplete: AxeIncomplete[];
  aodaNote: string;
  disclaimer: string;
}
