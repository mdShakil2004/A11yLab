'use client';

import { useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import ScanProgress from '@/components/ScanProgress';
import ReportView from '@/components/ReportView';
import type { ScanRecord } from '@/lib/types/scan';

export default function ScanResultPage() {
  const params = useParams<{ id: string }>();
  const scanId = params.id;
  const t = useTranslations('ScanResult');
  const tCommon = useTranslations('Common');

  const [state, setState] = useState<'scanning' | 'results' | 'error'>('scanning');
  const [scanData, setScanData] = useState<ScanRecord | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  const handleComplete = useCallback(async () => {
    try {
      const res = await fetch(`/api/scan/${scanId}`);
      if (!res.ok) {
        setErrorMessage(t('fetchFailed'));
        setState('error');
        return;
      }
      const data: ScanRecord = await res.json();
      setScanData(data);
      setState('results');
    } catch {
      setErrorMessage(t('networkError'));
      setState('error');
    }
  }, [scanId, t]);

  const handleError = useCallback((message: string) => {
    setErrorMessage(message);
    setState('error');
  }, []);

  if (state === 'error') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-8">
        <div className="text-center space-y-4">
          <h1 className="text-2xl font-bold text-red-600">{t('errorTitle')}</h1>
          <p className="text-gray-600">{errorMessage}</p>
          <Link
            href="/"
            className="inline-block px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            {tCommon('tryAgain')}
          </Link>
        </div>
      </div>
    );
  }

  if (state === 'scanning') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-8">
        <ScanProgress scanId={scanId} onComplete={handleComplete} onError={handleError} />
      </div>
    );
  }

  if (state === 'results' && scanData?.results) {
    return (
      <div className="min-h-screen p-8 py-12">
        <ReportView results={scanData.results} scanId={scanId} />
      </div>
    );
  }

  return null;
}
