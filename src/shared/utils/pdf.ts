import PDFDocument from 'pdfkit';
import type { IPerformanceReview } from '../../features/performance-reviews/performanceReview.types';

const REVIEW_TYPE_LABELS: Record<string, string> = {
  '30_day': '30-Day Review',
  '60_day': '60-Day Review',
  '90_day': '90-Day Review',
  annual: 'Annual Review',
  client_satisfaction: 'Client Satisfaction Review',
  corrective_coaching: 'Corrective Coaching Review',
};

const RATING_LABELS: Record<number, string> = {
  1: 'Unsatisfactory',
  2: 'Needs Improvement',
  3: 'Meets Expectations',
  4: 'Exceeds Expectations',
  5: 'Outstanding',
};

const ratingLabel = (r: number | null | undefined): string =>
  r ? `${r} — ${RATING_LABELS[r] ?? ''}` : 'N/A';

const formatDate = (d: unknown): string => {
  if (!d) return '\u2014';
  try {
    return new Date(d as string).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return String(d);
  }
};

/**
 * Build a PDF buffer for the given performance review.
 */
export const buildReviewPdf = (
  review: IPerformanceReview & {
    candidateName?: string;
    clientName?: string;
    jobTitle?: string;
  }
): Promise<Buffer> => {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'LETTER' });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = doc.page.width - 100;

    // ── Header ──────────────────────────────────────────────────────────
    doc.rect(50, 50, W, 36).fill('#1e3a5f');
    doc
      .fontSize(16)
      .fillColor('#ffffff')
      .font('Helvetica-Bold')
      .text('Performance Review', 60, 61, { width: W - 20 });
    doc.moveDown(2).fillColor('#000000');

    // ── Disclaimer ──────────────────────────────────────────────────────
    if (review.status !== 'completed') {
      doc
        .fontSize(8)
        .fillColor('#c0392b')
        .font('Helvetica-Oblique')
        .text('\u26A0  AI-generated draft. Please review before finalizing.', {
          align: 'center',
        });
      doc.moveDown(0.5).fillColor('#000000');
    }

    // ── Meta section ────────────────────────────────────────────────────
    const meta: Array<[string, string]> = [
      ['Candidate', review.candidateName ?? review.candidateId],
      ['Client', review.clientName ?? review.clientId],
      ['Job Title', review.jobTitle ?? review.jobId],
      [
        'Review Type',
        REVIEW_TYPE_LABELS[review.reviewType] ?? review.reviewType,
      ],
      ['Status', review.status],
      [
        'Review Period',
        `${formatDate(review.reviewPeriodStart)} \u2013 ${formatDate(review.reviewPeriodEnd)}`,
      ],
      ['Overall Rating', ratingLabel(review.overallRating)],
      ['Client Satisfaction', ratingLabel(review.clientSatisfactionScore)],
      ['Final Recommendation', review.finalRecommendation ?? '\u2014'],
      ['Generated', formatDate(review.createdAt)],
    ];

    doc.font('Helvetica-Bold').fontSize(11).text('Review Details');
    doc
      .moveTo(50, doc.y)
      .lineTo(50 + W, doc.y)
      .lineWidth(0.5)
      .strokeColor('#888')
      .stroke();
    doc.moveDown(0.3);

    meta.forEach(([label, value]) => {
      doc
        .font('Helvetica-Bold')
        .fontSize(9)
        .fillColor('#444')
        .text(`${label}:`, 50, doc.y, { continued: true, width: 160 });
      doc.font('Helvetica').fontSize(9).fillColor('#000').text(value);
    });

    doc.moveDown(0.8);

    // ── AI-Generated content ────────────────────────────────────────────
    const ai = review.aiGenerated;
    if (ai) {
      const sections: Array<{ title: string; body: string }> = [
        { title: 'Role Summary', body: ai.roleSummary },
        { title: 'Core Responsibilities', body: ai.coreResponsibilities },
        { title: 'Strengths', body: ai.strengths },
        { title: 'Areas for Improvement', body: ai.areasForImprovement },
      ];

      sections.forEach(({ title, body }) => {
        if (!body) return;
        const h = doc.y;
        if (h > doc.page.height - 120) doc.addPage();

        doc
          .font('Helvetica-Bold')
          .fontSize(11)
          .fillColor('#1e3a5f')
          .text(title);
        doc
          .moveTo(50, doc.y)
          .lineTo(50 + W, doc.y)
          .lineWidth(0.3)
          .strokeColor('#ccc')
          .stroke();
        doc.moveDown(0.3);
        doc
          .font('Helvetica')
          .fontSize(9.5)
          .fillColor('#222')
          .text(body, { lineGap: 2 });
        doc.moveDown(0.5);
      });

      // Goals
      if (ai.goals && ai.goals.length > 0) {
        doc.moveDown(0.3);
        doc
          .font('Helvetica-Bold')
          .fontSize(11)
          .fillColor('#1e3a5f')
          .text('Goals');
        doc
          .moveTo(50, doc.y)
          .lineTo(50 + W, doc.y)
          .lineWidth(0.3)
          .strokeColor('#ccc')
          .stroke();
        doc.moveDown(0.3);
        ai.goals.forEach(goal => {
          doc
            .font('Helvetica')
            .fontSize(9.5)
            .fillColor('#222')
            .text(`\u2022  ${goal}`, { indent: 10, lineGap: 2 });
        });
      }
    }

    // ── Categories ──────────────────────────────────────────────────────
    if (review.categories && review.categories.length > 0) {
      const h = doc.y;
      if (h > doc.page.height - 100) doc.addPage();

      doc.moveDown(0.5);
      doc
        .font('Helvetica-Bold')
        .fontSize(11)
        .fillColor('#1e3a5f')
        .text('Category Ratings');
      doc
        .moveTo(50, doc.y)
        .lineTo(50 + W, doc.y)
        .lineWidth(0.5)
        .strokeColor('#888')
        .stroke();
      doc.moveDown(0.3);

      review.categories
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .forEach(cat => {
          const h2 = doc.y;
          if (h2 > doc.page.height - 80) doc.addPage();

          doc
            .font('Helvetica-Bold')
            .fontSize(10)
            .fillColor('#333')
            .text(`${cat.categoryName}  \u2014  ${ratingLabel(cat.rating)}`);
          if (cat.managerComments) {
            doc
              .font('Helvetica')
              .fontSize(9)
              .fillColor('#555')
              .text(cat.managerComments, { indent: 10, lineGap: 1 });
          }
          doc.moveDown(0.3);
        });
    }

    // ── Footer ──────────────────────────────────────────────────────────
    doc.addPage();
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#999')
      .text(
        `Generated on ${new Date().toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })} | This is an AI-assisted document.`,
        { align: 'center' }
      );

    doc.end();
  });
};
