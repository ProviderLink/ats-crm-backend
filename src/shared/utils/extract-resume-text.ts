import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';

/**
 * Extract plain text from a PDF or DOCX file buffer.
 * Returns extracted text string or empty string on failure.
 */
export async function extractResumeText(
  buffer: Buffer,
  mimeType: string
): Promise<string> {
  try {
    if (mimeType === 'application/pdf') {
      const parser = new PDFParse(new Uint8Array(buffer));
      const result = await parser.getText();
      return result.text || '';
    }

    if (
      mimeType ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
      const result = await mammoth.extractRawText({ buffer });
      return result.value || '';
    }

    return '';
  } catch (error) {
    console.error('Failed to extract resume text:', error);
    return '';
  }
}
