import puppeteer from 'puppeteer';

export async function generatePdf(reportHtml: string): Promise<Buffer> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(reportHtml, { waitUntil: 'networkidle0' });

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '1.5cm', right: '1.5cm', bottom: '1.5cm', left: '1.5cm' },
      displayHeaderFooter: true,
      headerTemplate:
        '<div style="font-size:9px;text-align:center;width:100%;color:#666;">WCAG 2.2 Accessibility Report</div>',
      footerTemplate:
        '<div style="font-size:9px;text-align:center;width:100%;color:#666;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
    });

    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
