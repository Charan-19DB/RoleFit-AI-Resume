import pdf from 'pdf-parse';
import mammoth from 'mammoth';

export class DocumentParser {
  /**
   * Extracts clean, normalized text from PDF or DOCX buffer.
   */
  static async extractText(buffer: Buffer, mimeType: string, filename: string): Promise<string> {
    const ext = filename.split('.').pop()?.toLowerCase();

    let rawText = '';

    if (mimeType.includes('pdf') || ext === 'pdf') {
      try {
        const parsed = await pdf(buffer);
        rawText = parsed.text || '';
      } catch (err: any) {
        throw new Error(`Failed to parse PDF document (${filename}): ${err.message}`);
      }
    } else if (
      mimeType.includes('word') ||
      mimeType.includes('officedocument') ||
      ext === 'docx' ||
      ext === 'doc'
    ) {
      try {
        const result = await mammoth.extractRawText({ buffer });
        rawText = result.value || '';
      } catch (err: any) {
        throw new Error(`Failed to parse DOCX document (${filename}): ${err.message}`);
      }
    } else if (mimeType.includes('text') || ext === 'txt') {
      rawText = buffer.toString('utf-8');
    } else {
      throw new Error(`Unsupported file type: "${filename}" (MIME: ${mimeType}). Supported: PDF, DOCX, TXT.`);
    }

    const cleaned = this.normalizeText(rawText);

    if (!cleaned || cleaned.trim().length < 20) {
      throw new Error(`The document "${filename}" does not contain sufficient extractable text.`);
    }

    return cleaned;
  }

  /**
   * Normalizes document text while preserving section boundaries.
   */
  static normalizeText(text: string): string {
    return text
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/[\t ]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
}
