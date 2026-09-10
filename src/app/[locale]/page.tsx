import ScanForm from '@/components/ScanForm';
import { setRequestLocale, getTranslations } from 'next-intl/server';

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'HomePage' });

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8">
      <div className="w-full max-w-2xl space-y-8">
        {/* Hero */}
        <div className="text-center space-y-3">
          <h1 className="text-3xl sm:text-4xl font-bold">{t('title')}</h1>
          <p className="text-gray-600 text-lg">{t('subtitle')}</p>
        </div>
        <ScanForm />
        <ol className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-8 border-t border-gray-200 dark:border-gray-700 list-none p-0 m-0">
          <li className="text-center space-y-2">
            <div className="text-2xl" aria-hidden="true">1</div>
            <h2 className="font-medium">{t('step1Title')}</h2>
            <p className="text-sm text-gray-600">{t('step1Description')}</p>
          </li>
          <li className="text-center space-y-2">
            <div className="text-2xl" aria-hidden="true">2</div>
            <h2 className="font-medium">{t('step2Title')}</h2>
            <p className="text-sm text-gray-600">{t('step2Description')}</p>
          </li>
          <li className="text-center space-y-2">
            <div className="text-2xl" aria-hidden="true">3</div>
            <h2 className="font-medium">{t('step3Title')}</h2>
            <p className="text-sm text-gray-600">{t('step3Description')}</p>
          </li>
        </ol>
        <p className="text-center text-xs text-gray-600 pt-4">{t('footer')}</p>
      </div>
    </div>
  );
}
