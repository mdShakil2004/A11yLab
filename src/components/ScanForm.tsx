'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';

type ScanMode = 'single' | 'crawl';

export default function ScanForm() {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<ScanMode>('single');
  const [maxPages, setMaxPages] = useState(50);
  const [maxDepth, setMaxDepth] = useState(3);
  const router = useRouter();
  const t = useTranslations('ScanForm');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (!url.trim()) {
      setError(t('urlRequired'));
      return;
    }

    try {
      new URL(url.trim());
    } catch {
      setError(t('urlInvalid'));
      return;
    }

    if (!/^https?:\/\//i.test(url.trim())) {
      setError(t('urlHttpOnly'));
      return;
    }

    setLoading(true);
    try {
      if (mode === 'crawl') {
        const res = await fetch('/api/crawl', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: url.trim(), maxPages, maxDepth }),
        });

        if (!res.ok) {
          const data = await res.json();
          setError(data.error || t('crawlFailed'));
          return;
        }

        const { crawlId } = await res.json();
        router.push(`/crawl/${crawlId}`);
      } else {
        const res = await fetch('/api/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: url.trim() }),
        });

        if (!res.ok) {
          const data = await res.json();
          setError(data.error || t('scanFailed'));
          return;
        }

        const { scanId } = await res.json();
        router.push(`/scan/${scanId}`);
      }
    } catch {
      setError(t('networkError'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-2xl mx-auto">
      <div className="flex flex-col gap-3">
        {/* Mode Toggle */}
        <div role="radiogroup" aria-label={t('scanMode')} className="flex gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="scan-mode"
              value="single"
              checked={mode === 'single'}
              onChange={() => setMode('single')}
              className="accent-blue-600"
            />
            <span className="text-sm font-medium">{t('singlePage')}</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="scan-mode"
              value="crawl"
              checked={mode === 'crawl'}
              onChange={() => setMode('crawl')}
              className="accent-blue-600"
            />
            <span className="text-sm font-medium">{t('siteWideCrawl')}</span>
          </label>
        </div>

        <label htmlFor="scan-url" className="text-lg font-medium">
          {t('urlLabel')}
        </label>
        <p id="scan-url-help" className="text-sm text-gray-600">
          {mode === 'crawl' ? t('urlHelp_crawl') : t('urlHelp_single')}
        </p>
        <div className="flex gap-2">
          <input
            id="scan-url"
            type="url"
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder={t('urlPlaceholder')}
            aria-describedby="scan-url-help"
            className="flex-1 px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={loading}
            required
          />
          <button
            type="submit"
            disabled={loading}
            className="px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
          >
            {loading ? t('scanning') : mode === 'crawl' ? t('crawlButton') : t('scanButton')}
          </button>
        </div>

        {/* Crawl Configuration */}
        {mode === 'crawl' && (
          <div className="grid grid-cols-2 gap-4 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
            <div className="flex flex-col gap-1">
              <label htmlFor="max-pages" className="text-sm font-medium">
                {t('maxPages')}
              </label>
              <input
                id="max-pages"
                type="number"
                value={maxPages}
                onChange={e => setMaxPages(Number(e.target.value))}
                min={1}
                max={200}
                className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={loading}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="max-depth" className="text-sm font-medium">
                {t('maxDepth')}
              </label>
              <input
                id="max-depth"
                type="number"
                value={maxDepth}
                onChange={e => setMaxDepth(Number(e.target.value))}
                min={1}
                max={10}
                className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={loading}
              />
            </div>
          </div>
        )}

        {error && (
          <p role="alert" className="text-red-600 dark:text-red-400 text-sm">
            {error}
          </p>
        )}
      </div>
    </form>
  );
}
