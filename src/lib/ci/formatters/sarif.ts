import type { AxeViolation, ReviewItem } from '../../types/scan';
import { generateSarif } from '../../report/sarif-generator';

export function formatSarif(
  url: string,
  violations: AxeViolation[],
  toolVersion: string,
  reviewItems?: ReviewItem[]
): string {
  const sarifLog = reviewItems
    ? generateSarif(url, violations, toolVersion, reviewItems)
    : generateSarif(url, violations, toolVersion);
  return JSON.stringify(sarifLog, null, 2);
}
