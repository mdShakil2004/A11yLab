import { vi, describe, it, expect, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const mockPage = {
    setContent: vi.fn().mockResolvedValue(undefined),
    pdf: vi.fn().mockResolvedValue(Buffer.from('mock-pdf-content')),
  };
  const mockBrowser = {
    newPage: vi.fn().mockResolvedValue(mockPage),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return { mockPage, mockBrowser, launch: vi.fn().mockResolvedValue(mockBrowser) };
});

vi.mock('puppeteer', () => ({
  default: { launch: mocks.launch },
}));

import { generatePdf } from '../pdf-generator';

describe('generatePdf', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.launch.mockResolvedValue(mocks.mockBrowser);
    mocks.mockBrowser.newPage.mockResolvedValue(mocks.mockPage);
    mocks.mockPage.setContent.mockResolvedValue(undefined);
    mocks.mockPage.pdf.mockResolvedValue(Buffer.from('mock-pdf-content'));
  });

  it('launches puppeteer, creates page, sets content, and returns PDF buffer', async () => {
    const result = await generatePdf('<html><body>Report</body></html>');

    expect(mocks.launch).toHaveBeenCalledWith({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    expect(mocks.mockBrowser.newPage).toHaveBeenCalled();
    expect(mocks.mockPage.setContent).toHaveBeenCalled();
    expect(mocks.mockPage.pdf).toHaveBeenCalled();
    expect(result).toBeInstanceOf(Buffer);
  });

  it('calls setContent with correct HTML and waitUntil option', async () => {
    const html = '<html><body><h1>Test Report</h1></body></html>';
    await generatePdf(html);

    expect(mocks.mockPage.setContent).toHaveBeenCalledWith(html, {
      waitUntil: 'networkidle0',
    });
  });

  it('calls page.pdf with A4 format, margins, and header/footer templates', async () => {
    await generatePdf('<html></html>');

    expect(mocks.mockPage.pdf).toHaveBeenCalledWith({
      format: 'A4',
      printBackground: true,
      margin: { top: '1.5cm', right: '1.5cm', bottom: '1.5cm', left: '1.5cm' },
      displayHeaderFooter: true,
      headerTemplate: expect.stringContaining('WCAG 2.2 Accessibility Report'),
      footerTemplate: expect.stringContaining('pageNumber'),
    });
  });

  it('returns a Buffer instance', async () => {
    const result = await generatePdf('<html></html>');
    expect(Buffer.isBuffer(result)).toBe(true);
  });

  it('closes the browser after successful PDF generation', async () => {
    await generatePdf('<html></html>');
    expect(mocks.mockBrowser.close).toHaveBeenCalled();
  });

  it('closes the browser even when setContent throws', async () => {
    mocks.mockPage.setContent.mockRejectedValueOnce(new Error('Content error'));

    await expect(generatePdf('<html></html>')).rejects.toThrow('Content error');
    expect(mocks.mockBrowser.close).toHaveBeenCalled();
  });

  it('closes the browser even when page.pdf throws', async () => {
    mocks.mockPage.pdf.mockRejectedValueOnce(new Error('PDF error'));

    await expect(generatePdf('<html></html>')).rejects.toThrow('PDF error');
    expect(mocks.mockBrowser.close).toHaveBeenCalled();
  });

  it('propagates the error from setContent', async () => {
    mocks.mockPage.setContent.mockRejectedValueOnce(new Error('Navigation failed'));

    await expect(generatePdf('<html></html>')).rejects.toThrow('Navigation failed');
  });
});
