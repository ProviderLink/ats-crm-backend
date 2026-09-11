import AppError from '../../shared/utils/AppError';
import {
  getAiProvider,
  parseJsonResponse,
  withRetry,
} from '../../shared/utils/ai/index';

export interface GenerateJobDraftInput {
  notes: string;
}

/**
 * Structured draft produced from a free-form brief. Only fields that exist on
 * the job schema are returned, and enums (jobType, locationType,
 * experienceLevel) are deliberately excluded so a wrong guess can never be
 * persisted silently.
 */
export interface GeneratedJobDraft {
  title: string;
  description: string;
  requirements: string[];
  responsibilities: string[];
  skills: string[];
  benefits: string[];
}

const MAX_TITLE_LENGTH = 200;
const MAX_LIST_ITEMS = 30;
const MAX_ITEM_LENGTH = 300;

const SYSTEM_RULES = `
You convert a hiring manager's rough, free-form notes about a job into a
structured draft for a job posting form.

ABSOLUTE RULES:
1. EXTRACT ONLY. Use only information present in the notes. Never invent,
   assume, or add requirements, duties, skills, benefits, perks, tools,
   technologies, numbers, or company details that were not stated.
2. WHEN IN DOUBT, LEAVE IT OUT. If the notes do not mention a category at all,
   return an empty array for it (or an empty string for "title"/"description").
   An empty field is always better than a guessed one.
   This rule is ONLY about refusing to invent missing information. It is never
   a licence to delete information the author did supply — see rule 6.
3. NEVER change meaning or scope: keep every number, year of experience,
   seniority level, certification, technology name, client requirement, and
   salary detail exactly as written by the author.
4. NEVER rename the author's terminology. If they write "Salesforce admin",
   keep "Salesforce admin".
5. Keep the author's language (do not translate).
6. NEVER DROP A STATED FACT. Every concrete detail in the notes must appear
   somewhere in the draft — weekly hours, shift or timezone overlap, work
   location, eligibility, pay terms, certifications, team structure. If a
   detail does not obviously fit a list, place it in the closest one instead of
   discarding it. Work-schedule details (hours per week, shift, timezone
   overlap) belong in "requirements".
7. NEVER DUPLICATE A POINT ACROSS CATEGORIES. Each fact must appear in exactly
   one list, never in two. When a note could fit more than one category, pick
   the best one and keep it only there.
   Precedence: a named tool, technology, platform, or coding standard belongs
   in "skills". Do not also list it under "requirements".
   Example: "epic experience is a must" plus "must know epic" becomes one entry
   "Epic" under "skills" — and must NOT also appear under "requirements".

ALLOWED IMPROVEMENTS (formatting and clarity only):
- Fix grammar, spelling, punctuation, and capitalization.
- Improve wording and tone for a professional job posting, without changing
  the underlying facts.
- Merge duplicated or near-identical points into one, both within a category
  and across categories (see rule 7).
- Never generalise a specific point into a vaguer one. Keep the concrete
  detail: "we deal with US clients directly" must stay close to that (e.g.
  "Comfortable working directly with US clients"), not be reduced to
  "good communication skills".
- Split long run-on notes into separate, clean points.
- Standardize formatting consistently: responsibilities start with an action
  verb, requirements/skills are concise phrases, no trailing periods.
- Group related points into the correct category.

CATEGORY DEFINITIONS:
- "title": the job/role title.
- "description": the overview of the role and working context, as flowing
  prose in Markdown. Do NOT include "Requirements", "Responsibilities",
  "Skills", or "Benefits" sections here — those are captured separately.
  Do not start it with a heading; the UI already renders a section heading.
  Only add a subheading if the notes genuinely cover multiple distinct topics.
- "requirements": must-haves the candidate needs (experience, education,
  certifications, eligibility, work schedule such as hours per week or
  timezone overlap). Not duties, not perks, and not tools — a named tool,
  platform, or coding standard belongs in "skills".
- "responsibilities": what the person will do day to day. Not requirements.
- "skills": concrete tools, technologies, platforms, or coding standards named
  in the notes (e.g. Epic, Availity, Waystar, CPT, ICD-10). These must not be
  repeated under "requirements".
- "benefits": perks/offerings explicitly stated (insurance, PTO, equipment).

OUTPUT FORMAT:
Respond with ONLY a valid JSON object. No markdown code fences, no
explanation, no text before or after. Use exactly this structure:

{
  "title": "string",
  "description": "markdown string",
  "requirements": ["string"],
  "responsibilities": ["string"],
  "skills": ["string"],
  "benefits": ["string"]
}
`.trim();

/**
 * Optional overrides so other AI helpers (e.g. the job standardizer, which
 * rewrites lists that already exist on stored jobs) can use far more generous
 * limits without duplicating the sanitising logic.
 */
export interface ListLimits {
  maxItems?: number;
  maxItemLength?: number;
}

export function toStringArray(
  value: unknown,
  limits: ListLimits = {}
): string[] {
  const maxItems = limits.maxItems ?? MAX_LIST_ITEMS;
  const maxItemLength = limits.maxItemLength ?? MAX_ITEM_LENGTH;

  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of value) {
    if (typeof raw !== 'string') continue;
    const item = raw
      .replace(/^\s*(?:[-*•·]|\d+[.)])\s*/, '')
      .trim()
      .slice(0, maxItemLength);
    if (!item) continue;

    const key = item.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    result.push(item);
    if (result.length >= maxItems) break;
  }

  return result;
}

export function toCleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Turn a free-form job brief into a structured draft.
 *
 * The result is never persisted directly — the client populates the job form
 * with it so the user can review and edit every field before saving.
 */
export async function generateJobDraft(
  input: GenerateJobDraftInput
): Promise<GeneratedJobDraft> {
  const notes = input.notes.trim();

  const prompt = `${SYSTEM_RULES}

HIRING MANAGER'S NOTES (the only source of truth):
"""
${notes}
"""
`.trim();

  const provider = await getAiProvider();
  const text = await withRetry(() =>
    provider.generate(prompt, { maxTokens: 4000 })
  );

  const parsed = parseJsonResponse<Record<string, unknown>>(text);

  if (!parsed || typeof parsed !== 'object') {
    throw new AppError(
      500,
      'AI_API_ERROR',
      'AI returned an unreadable response. Please try again.'
    );
  }

  const draft: GeneratedJobDraft = {
    title: toCleanString(parsed['title']).slice(0, MAX_TITLE_LENGTH),
    description: toCleanString(parsed['description']),
    requirements: toStringArray(parsed['requirements']),
    responsibilities: toStringArray(parsed['responsibilities']),
    skills: toStringArray(parsed['skills']),
    benefits: toStringArray(parsed['benefits']),
  };

  const hasContent =
    draft.title ||
    draft.description ||
    draft.requirements.length > 0 ||
    draft.responsibilities.length > 0 ||
    draft.skills.length > 0 ||
    draft.benefits.length > 0;

  if (!hasContent) {
    throw new AppError(
      422,
      'AI_EMPTY_DRAFT',
      'Could not extract job details from those notes. Add more detail and try again.'
    );
  }

  return draft;
}
