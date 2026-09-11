import { chromium, type Browser } from 'playwright-core';
import chromiumBinary from '@sparticuz/chromium';

async function launchPdfBrowser(): Promise<Browser> {
  // Use the same serverless-compatible Chromium binary as the accessibility
  // scanner. Puppeteer's bundled browser is not reliably available in Vercel
  // serverless deployments.
  chromiumBinary.setGraphicsMode = false;

  const executablePath = await chromiumBinary.executablePath();

  const browser = await chromium.launch({
    executablePath,
    args: chromiumBinary.args,
    headless: true,
    timeout: 60000,
  });

  if (!browser.isConnected()) {
    throw new Error('Chromium launched but disconnected before PDF generation.');
  }

  return browser;
}

export async function generatePdf(reportHtml: string): Promise<Buffer> {
  const browser = await launchPdfBrowser();

  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
    });

    await page.setContent(reportHtml, {
      waitUntil: 'load',
      timeout: 30000,
    });

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '1.5cm',
        right: '1.5cm',
        bottom: '1.5cm',
        left: '1.5cm',
      },
      displayHeaderFooter: true,
      headerTemplate:
        '<div style="font-size:9px;text-align:center;width:100%;color:#666;">WCAG 2.2 Accessibility Report</div>',
      footerTemplate:
        '<div style="font-size:9px;text-align:center;width:100%;color:#666;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
    });

    return Buffer.from(pdf);
  } finally {
    await browser.close().catch(() => undefined);
  }
}
