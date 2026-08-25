import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import AppError from './AppError';

/**
 * Extract plain text from a PDF or DOCX file buffer.
 *
 * For PDFs, image-based / scanned files have no extractable text layer.
 * In that case we throw so the upload is blocked outright — no candidate
 * record is created and no file is stored to Cloudinary.
 *
 * @throws {AppError} when a PDF yields no extractable text (image-based/scanned).
 * @returns extracted text string.
 */
export async function extractResumeText(
  buffer: Buffer,
  mimeType: string
): Promise<string> {
  if (mimeType === 'application/pdf') {
    let pages: Array<{ num: number; text: string }> = [];
    try {
      const parser = new PDFParse(new Uint8Array(buffer));
      const result = await parser.getText();
      // NOTE: `result.text` is NOT reliable for detection — pdf-parse v2
      // always appends a `-- N of M --` page marker even when a page has no
      // extractable text. Use per-page `text` instead, which is the real
      // extracted content.
      pages = result.pages ?? [];
    } catch (error) {
      console.error('Failed to extract resume text:', error);
      pages = [];
    }

    // Strip pdf-parse's page markers and join the real per-page text.
    const cleanText = pages
      .map(page => (page.text ?? '').trim())
      .filter(Boolean)
      .join('\n\n');

    // Image-based or scanned PDFs have no embedded text layer. Block them
    // so they never produce an invalid candidate record.
    if (cleanText.length === 0) {
      throw new AppError(
        400,
        'FILE_IMAGE_BASED_PDF',
        'This PDF appears to be image-based or scanned. Please upload a text-based PDF instead.'
      );
    }

    return cleanText;
  }

  if (
    mimeType ===
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    try {
      const result = await mammoth.extractRawText({ buffer });
      return result.value || '';
    } catch (error) {
      console.error('Failed to extract resume text:', error);
      return '';
    }
  }

  return '';
}
