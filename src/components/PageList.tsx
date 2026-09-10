import type { PageSummary } from '@/lib/types/crawl';
import { useTranslations } from 'next-intl';

interface PageListProps {
  pages: PageSummary[];
  crawlId: string;
}

const gradeColors: Record<string, string> = {
  A: 'text-green-600 dark:text-green-400',
  B: 'text-blue-600 dark:text-blue-400',
  C: 'text-yellow-600 dark:text-yellow-400',
  D: 'text-orange-600 dark:text-orange-400',
  F: 'text-red-600 dark:text-red-400',
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default function PageList({ pages, crawlId: _crawlId }: PageListProps) {
  const sorted = [...pages].sort((a, b) => a.score - b.score);
  const t = useTranslations('PageList');

  return (
    <div className="space-y-3">
      <h3 className="text-xl font-semibold">{t('title', { count: pages.length })}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700">
              <th scope="col" className="text-left py-2 px-3 font-medium">{t('url')}</th>
              <th scope="col" className="text-right py-2 px-3 font-medium">{t('score')}</th>
              <th scope="col" className="text-center py-2 px-3 font-medium">{t('grade')}</th>
              <th scope="col" className="text-right py-2 px-3 font-medium">{t('violations')}</th>
              <th scope="col" className="text-center py-2 px-3 font-medium">{t('status')}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((page) => (
              <tr
                key={page.pageId}
                className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50"
              >
                <td className="py-2 px-3 max-w-xs truncate" title={page.url}>
                  <span className="font-mono text-xs">{page.url}</span>
                </td>
                <td className="py-2 px-3 text-right font-medium">{page.score}</td>
                <td className={`py-2 px-3 text-center font-bold ${gradeColors[page.grade] || 'text-gray-500'}`}>
                  {page.grade}
                </td>
                <td className="py-2 px-3 text-right text-red-600 dark:text-red-400">
                  {page.violationCount}
                </td>
                <td className="py-2 px-3 text-center">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                    page.status === 'complete'
                      ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200'
                      : page.status === 'error'
                      ? 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-600'
                  }`}>
                    {page.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages.length === 0 && (
        <p className="text-gray-600 text-sm">{t('noPagesYet')}</p>
      )}
    </div>
  );
}
