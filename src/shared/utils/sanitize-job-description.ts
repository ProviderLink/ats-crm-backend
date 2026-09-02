import sanitizeHtml from 'sanitize-html';

/**
 * Allowlist for job description HTML. Kept in sync with the client-side
 * sanitizer in ats-ui (`src/components/rich-text.tsx`).
 */
const ALLOWED_TAGS = [
  'p',
  'br',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'strike',
  'ul',
  'ol',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'pre',
  'code',
  'a',
  'hr',
];

/**
 * Strip unsafe HTML from a job description string. Legacy plain-text
 * descriptions pass through unchanged.
 */
export function sanitizeJobDescription(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
  });
}
