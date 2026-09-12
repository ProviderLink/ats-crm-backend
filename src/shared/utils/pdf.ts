import PDFDocument from 'pdfkit';
import type { IPerformanceReview } from '../../features/performance-reviews/performanceReview.types';
import {
  DEFAULT_TIMEZONE,
  formatInTimeZone,
  isValidTimeZone,
} from './timezone';

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
  r != null ? `${r} — ${RATING_LABELS[r] ?? ''}` : 'N/A';

const formatDate = (d: unknown, timeZone: string): string => {
  if (!d) return '\u2014';
  try {
    return formatInTimeZone(new Date(d as string), timeZone, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return String(d);
  }
};

/**
 * Render a two-column meta row without `continued: true` to prevent text overlap.
 * Column 1 (label): x=50, width=130
 * Column 2 (value): x=190, width=W-140
 */
function metaRow(
  doc: InstanceType<typeof PDFDocument>,
  label: string,
  value: string,
  W: number
): void {
  const rowY = doc.y;
  // Label column
  doc
    .font('Helvetica-Bold')
    .fontSize(9)
    .fillColor('#444444')
    .text(`${label}:`, 50, rowY, { width: 130, lineBreak: false });

  // Value column — start at same Y, wider column
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor('#000000')
    .text(value, 190, rowY, { width: W - 140 });

  // After writing value, doc.y is below it. Add small row gap.
  doc.moveDown(0.15);
}

function sectionHeading(
  doc: InstanceType<typeof PDFDocument>,
  title: string,
  W: number
): void {
  if (doc.y > doc.page.height - 120) doc.addPage();
  doc
    .font('Helvetica-Bold')
    .fontSize(11)
    .fillColor('#1e3a5f')
    .text(title, 50, doc.y, { align: 'left', width: W });
  doc
    .moveTo(50, doc.y)
    .lineTo(50 + W, doc.y)
    .lineWidth(0.3)
    .strokeColor('#cccccc')
    .stroke();
  doc.moveDown(0.3);
}

/**
 * Build a PDF buffer for the given performance review.
 */
export const buildReviewPdf = (
  review: IPerformanceReview & {
    candidateName?: string;
    clientName?: string;
    jobTitle?: string;
  },
  timezone?: string
): Promise<Buffer> => {
  return new Promise((resolve, reject) => {
    const timeZone = isValidTimeZone(timezone)
      ? (timezone as string)
      : DEFAULT_TIMEZONE;
    const doc = new PDFDocument({ margin: 50, size: 'LETTER' });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = doc.page.width - 100; // usable width (612 - 100 = 512)

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

    // ── Review Details (meta) ────────────────────────────────────────────
    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor('#000000')
      .text('Review Details', 50, doc.y, { align: 'left', width: W });
    doc
      .moveTo(50, doc.y)
      .lineTo(50 + W, doc.y)
      .lineWidth(0.5)
      .strokeColor('#888888')
      .stroke();
    doc.moveDown(0.4);

    const candidateName = review.candidateName ?? review.candidateId;
    const clientName = review.clientName ?? review.clientId;
    const reviewTypeLabel =
      REVIEW_TYPE_LABELS[review.reviewType] ?? review.reviewType;
    const statusLabel = review.status
      ? review.status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
      : '—';
    const reviewPeriod = `${formatDate(review.reviewPeriodStart, timeZone)} \u2013 ${formatDate(review.reviewPeriodEnd, timeZone)}`;

    metaRow(doc, 'Candidate (VA)', candidateName, W);
    metaRow(doc, 'Client', clientName, W);
    if (review.jobTitle) metaRow(doc, 'Job Title', review.jobTitle, W);
    metaRow(doc, 'Review Type', reviewTypeLabel, W);
    metaRow(doc, 'Status', statusLabel, W);
    metaRow(doc, 'Review Period', reviewPeriod, W);
    metaRow(doc, 'Overall Rating', ratingLabel(review.overallRating), W);
    if (review.clientSatisfactionScore != null) {
      metaRow(
        doc,
        'Client Satisfaction',
        ratingLabel(review.clientSatisfactionScore),
        W
      );
    }
    metaRow(
      doc,
      'Final Recommendation',
      review.finalRecommendation ?? '\u2014',
      W
    );
    metaRow(doc, 'Generated', formatDate(review.createdAt, timeZone), W);

    doc.moveDown(0.8);

    // ── AI-Generated content ────────────────────────────────────────────
    const ai = review.aiGenerated;
    if (ai) {
      // Role Summary
      if (ai.roleSummary) {
        sectionHeading(doc, 'Role Summary', W);
        doc
          .font('Helvetica')
          .fontSize(9.5)
          .fillColor('#222222')
          .text(ai.roleSummary, 50, doc.y, {
            align: 'left',
            width: W,
            lineGap: 2,
          });
        doc.moveDown(0.6);
      }

      // Core Responsibilities — stored as string[]
      const responsibilities = Array.isArray(ai.coreResponsibilities)
        ? ai.coreResponsibilities
        : ai.coreResponsibilities
          ? [String(ai.coreResponsibilities)]
          : [];
      if (responsibilities.length > 0) {
        sectionHeading(doc, 'Core Responsibilities', W);
        responsibilities.forEach(resp => {
          doc
            .font('Helvetica')
            .fontSize(9.5)
            .fillColor('#222222')
            .text(`\u2022  ${resp}`, 50, doc.y, {
              align: 'left',
              width: W,
              indent: 10,
              lineGap: 2,
            });
        });
        doc.moveDown(0.6);
      }

      // Strengths
      if (ai.strengths) {
        sectionHeading(doc, 'Strengths', W);
        doc
          .font('Helvetica')
          .fontSize(9.5)
          .fillColor('#222222')
          .text(ai.strengths, 50, doc.y, {
            align: 'left',
            width: W,
            lineGap: 2,
          });
        doc.moveDown(0.6);
      }

      // Areas for Improvement
      if (ai.areasForImprovement) {
        sectionHeading(doc, 'Areas for Improvement', W);
        doc
          .font('Helvetica')
          .fontSize(9.5)
          .fillColor('#222222')
          .text(ai.areasForImprovement, 50, doc.y, {
            align: 'left',
            width: W,
            lineGap: 2,
          });
        doc.moveDown(0.6);
      }

      // Goals
      if (ai.goals && ai.goals.length > 0) {
        sectionHeading(doc, 'Goals — Next Period', W);
        ai.goals.forEach(goal => {
          doc
            .font('Helvetica')
            .fontSize(9.5)
            .fillColor('#222222')
            .text(`\u2022  ${goal}`, 50, doc.y, {
              align: 'left',
              width: W,
              indent: 10,
              lineGap: 2,
            });
        });
        doc.moveDown(0.6);
      }

      // Final Manager Summary
      if (review.finalManagerSummary) {
        sectionHeading(doc, 'Manager Summary', W);
        doc
          .font('Helvetica')
          .fontSize(9.5)
          .fillColor('#222222')
          .text(review.finalManagerSummary, 50, doc.y, {
            align: 'left',
            width: W,
            lineGap: 2,
          });
        doc.moveDown(0.6);
      }
    }

    // ── Category Ratings ────────────────────────────────────────────────
    if (review.categories && review.categories.length > 0) {
      if (doc.y > doc.page.height - 100) doc.addPage();

      doc.moveDown(0.3);
      doc
        .font('Helvetica-Bold')
        .fontSize(11)
        .fillColor('#1e3a5f')
        .text('Category Ratings', 50, doc.y, { align: 'left', width: W });
      doc
        .moveTo(50, doc.y)
        .lineTo(50 + W, doc.y)
        .lineWidth(0.5)
        .strokeColor('#888888')
        .stroke();
      doc.moveDown(0.4);

      review.categories
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .forEach(cat => {
          if (doc.y > doc.page.height - 80) doc.addPage();

          doc
            .font('Helvetica-Bold')
            .fontSize(10)
            .fillColor('#333333')
            .text(
              `${cat.categoryName}  \u2014  ${ratingLabel(cat.rating)}`,
              50,
              doc.y,
              { align: 'left', width: W }
            );

          if (cat.categoryDescription) {
            doc
              .font('Helvetica-Oblique')
              .fontSize(8.5)
              .fillColor('#666666')
              .text(cat.categoryDescription, 50, doc.y, {
                align: 'left',
                width: W,
                indent: 10,
                lineGap: 1,
              });
          }

          if (cat.managerComments) {
            doc
              .font('Helvetica')
              .fontSize(9)
              .fillColor('#555555')
              .text(cat.managerComments, 50, doc.y, {
                align: 'left',
                width: W,
                indent: 10,
                lineGap: 1,
              });
          }
          doc.moveDown(0.4);
        });
    }

    // ── Footer ──────────────────────────────────────────────────────────
    doc.moveDown(1);
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#999999')
      .text(
        `Generated on ${formatInTimeZone(new Date(), timeZone, {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })} | This is an AI-assisted document.`,
        { align: 'center' }
      );

    doc.end();
  });
};
