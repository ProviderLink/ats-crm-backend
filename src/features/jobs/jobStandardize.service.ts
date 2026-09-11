import AppError from '../../shared/utils/AppError';
import {
  getAiProvider,
  parseJsonResponse,
  withRetry,
} from '../../shared/utils/ai/index';
import { toStringArray } from './jobDraft.service';

export interface StandardizeJobContentInput {
  requirements: string[];
  responsibilities: string[];
  skills: string[];
  benefits: string[];
}

export type StandardizedJobContent = StandardizeJobContentInput;

/**
 * Input limits: these lists already exist on stored jobs, so they must be
 * accepted generously. Nothing may be silently truncated on the way in.
 */
const INPUT_MAX_ITEMS = 60;
const INPUT_MAX_ITEM_LENGTH = 1000;

/** Output limits: the AI only tidies, so the result cannot need more room. */
const OUTPUT_MAX_ITEMS = 50;
const OUTPUT_MAX_ITEM_LENGTH = 1000;

const SYSTEM_RULES = `
You tidy up the list fields of a JOB RECORD THAT ALREADY EXISTS. The lists you
receive are already stored on the job; they are often inconsistent, repetitive,
or badly formatted, and your job is to clean them up.

THE LISTS BELOW ARE THE ONLY SOURCE OF TRUTH.
You are cleaning existing text, not writing a new job posting.

ABSOLUTE RULES:
1. NEVER INVENT. Add no requirement, duty, skill, benefit, tool, technology,
   number, or detail that is not already present in the lists you receive. If a
   list looks incomplete, leave it incomplete.
2. NEVER DELETE A FACT. Every distinct fact in the input must still appear
   somewhere in the output. Tidying is allowed; losing information is not.
3. NEVER change meaning or scope: keep every number, year of experience,
   seniority level, certification, tool name, and client requirement exactly as
   written. Do not soften or strengthen anything.
4. NEVER rename the terminology that is already in the record.
5. Keep the record's language (do not translate).
6. DO NOT SUMMARISE. Do not collapse several distinct points into one vaguer
   point. Six real duties must not become three generic ones.
7. DO NOT GENERALISE. "Comfortable working directly with US clients" must stay
   close to that, not become "good communication skills".
8. An empty list stays empty. Never fill a gap with a guess.
9. If a list is already clean, return it unchanged. Tidying is not a rewrite.
10. A FACT RESTATED IN TWO LISTS IS A DUPLICATE. When the same subject appears
    in more than one list — most often a named tool sitting in both
    "requirements" and "skills" — keep a single entry in the correct list and
    remove the restatement from the other one. Removing a restatement is a
    merge, not a lost fact, so rule 2 does not forbid it.
    Worked example. Given requirements ["Epic experience is a must",
    "Knowledge of CPT and ICD-10 coding", "3+ years experience"] and
    skills ["Epic", "CPT and ICD-10"], the result must be
    requirements ["3+ years experience"] and skills ["Epic", "CPT and ICD-10"].
    The tools appear only under "skills", and the remaining requirement keeps
    its own distinct fact.

ALLOWED AND EXPECTED IMPROVEMENTS:
- Merge exact or near-identical duplicates into a single entry — both within one
  list and across lists (a point must appear in exactly one list).
- Move a point into the list it clearly belongs in when it is misplaced, using
  the category definitions below. A named tool, technology, platform, or coding
  standard belongs in "skills"; do not leave it under "requirements".
- Fix grammar, spelling, punctuation, and capitalization.
- Standardize formatting consistently: responsibilities start with an action
  verb; requirements and skills are concise phrases; no trailing periods.
- Split a single run-on entry that plainly contains two or more separate points.

CATEGORY DEFINITIONS:
- "requirements": must-haves (experience, education, certifications,
  eligibility, work schedule such as hours per week or timezone overlap). Not
  duties, not perks, and not tools — a named tool, platform, or coding standard
  belongs in "skills".
- "responsibilities": what the person will do day to day. Not requirements.
- "skills": concrete tools, technologies, platforms, or coding standards named
  in the record. These must not be repeated under "requirements".
- "benefits": perks/offerings explicitly stated (insurance, PTO, equipment).

OUTPUT FORMAT:
Respond with ONLY a valid JSON object. No markdown code fences, no explanation,
no text before or after. Use exactly this structure and the same four keys:

{
  "requirements": ["string"],
  "responsibilities": ["string"],
  "skills": ["string"],
  "benefits": ["string"]
}
`.trim();

function formatList(label: string, items: string[]): string {
  if (items.length === 0) return `${label}:\n(none)`;
  return `${label}:\n${items.map(item => `- ${item}`).join('\n')}`;
}

/**
 * Tidy and standardize the list fields of a job that is already stored.
 *
 * Stateless: it reads the lists the client sends, returns cleaned copies, and
 * persists nothing. The client decides whether to apply them.
 */
export async function standardizeJobContent(
  input: StandardizeJobContentInput
): Promise<StandardizedJobContent> {
  const requirements = toStringArray(input.requirements, {
    maxItems: INPUT_MAX_ITEMS,
    maxItemLength: INPUT_MAX_ITEM_LENGTH,
  });
  const responsibilities = toStringArray(input.responsibilities, {
    maxItems: INPUT_MAX_ITEMS,
    maxItemLength: INPUT_MAX_ITEM_LENGTH,
  });
  const skills = toStringArray(input.skills, {
    maxItems: INPUT_MAX_ITEMS,
    maxItemLength: INPUT_MAX_ITEM_LENGTH,
  });
  const benefits = toStringArray(input.benefits, {
    maxItems: INPUT_MAX_ITEMS,
    maxItemLength: INPUT_MAX_ITEM_LENGTH,
  });

  const hasContent =
    requirements.length > 0 ||
    responsibilities.length > 0 ||
    skills.length > 0 ||
    benefits.length > 0;

  if (!hasContent) {
    throw new AppError(
      422,
      'AI_EMPTY_CONTENT',
      'There is nothing to improve yet — this job has no requirements, responsibilities, skills or benefits.'
    );
  }

  const prompt = `${SYSTEM_RULES}

CURRENT JOB RECORD LISTS (the only source of truth):
${formatList('REQUIREMENTS', requirements)}

${formatList('RESPONSIBILITIES', responsibilities)}

${formatList('SKILLS', skills)}

${formatList('BENEFITS', benefits)}
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

  const limits = {
    maxItems: OUTPUT_MAX_ITEMS,
    maxItemLength: OUTPUT_MAX_ITEM_LENGTH,
  };

  /**
   * Safety net: a list that had content must never come back empty. If the
   * model fails to echo a list, fall back to the original so the user cannot
   * lose data through a single bad response.
   */
  function keep(value: unknown, original: string[]): string[] {
    const cleaned = toStringArray(value, limits);
    return cleaned.length > 0 ? cleaned : original;
  }

  return {
    requirements: keep(parsed['requirements'], requirements),
    responsibilities: keep(parsed['responsibilities'], responsibilities),
    skills: keep(parsed['skills'], skills),
    benefits: keep(parsed['benefits'], benefits),
  };
}
