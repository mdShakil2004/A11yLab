import type { CiResult } from '../../types/crawl';

export function formatJson(result: CiResult): string {
  return JSON.stringify(result, null, 2);
}
