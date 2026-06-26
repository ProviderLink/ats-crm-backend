import { createLog } from '../features/activity-logs/activityLog.service';
import Candidate from '../features/candidates/candidate.model';
import { updateAiValidation } from '../features/candidates/candidate.service';
import { getSettings } from '../features/settings/settings.service';
import {
  getAiProvider,
  parseJsonResponse,
  withRetry,
} from '../shared/utils/ai/index';
import logger from '../shared/utils/logger';

/**
 * TYPE 1 — Candidacy Validation
 *
 * Runs ONCE when a candidate first applies (public apply, status: pending).
 * Determines if the candidate/resume is real or fake/garbage.
 * Result is stored on Candidate.aiValidation.
 */
export async function runCandidacyValidation(
  candidateId: string
): Promise<void> {
  const candidate = await Candidate.findById(candidateId);
  if (!candidate) return;

  // Idempotent: skip if already validated
  if (candidate.aiValidation !== null && candidate.aiValidation !== undefined) {
    logger.debug('Candidate already has candidacy validation, skipping', {
      candidateId,
    });
    return;
  }

  if (!candidate.resumeRawText || candidate.resumeRawText.trim() === '') {
    logger.debug('No resume text for candidacy validation', { candidateId });
    return;
  }

  const settings = await getSettings();
  if (!settings.ai.resumeValidation) {
    logger.debug('Resume validation disabled in settings', { candidateId });
    return;
  }

  const prompt = `
You are a candidacy validation assistant. Your job is to determine if a job application is from a real person with legitimate data, or if it's fake, spam, garbage, or nonsensical.

Analyze the resume text below and answer: is this a real candidate?

Resume Text:
${candidate.resumeRawText}

Respond with ONLY a JSON object, no markdown, no explanation:
{
  "isValid": true or false,
  "score": number between 0 and 100 (100 = definitely real, 0 = definitely fake/garbage),
  "reason": "one sentence explaining your verdict"
}

Fake/garbage indicators:
- Random characters, lorem ipsum, or gibberish
- Obviously fake names like "Test User", "John Doe", "asdf asdf"
- No real work experience or education (entirely empty or template text)
- Copied job description pasted as resume
- Single-line or extremely short submissions with no substance

Real candidate indicators:
- Coherent professional summary
- Actual company names and job titles
- Realistic work history with dates
- Educational background with institution names
- Specific technical skills matching the experience

Be conservative — only mark as invalid (isValid: false) if clearly fake/garbage. Borderline or thin resumes should still pass with a moderate score.
`.trim();

  try {
    const provider = await getAiProvider();
    const text = await withRetry(() => provider.generate(prompt, 1000));
    const result = parseJsonResponse<{
      isValid: boolean;
      score: number;
      reason: string;
    }>(text);

    if (result) {
      await updateAiValidation(candidateId, {
        isValid: result.isValid,
        score: result.score,
        reason: result.reason,
        completedAt: new Date(),
      });
      await createLog({
        type: 'ai_candidacy_validation_completed',
        resourceType: 'candidate',
        resourceId: candidateId,
        metadata: {
          score: result.score,
          isValid: result.isValid,
          provider: provider.name,
        },
      });
      logger.info('Candidacy validation completed', {
        candidateId,
        score: result.score,
        isValid: result.isValid,
        provider: provider.name,
      });
    } else {
      logger.error('Failed to parse candidacy validation response', {
        candidateId,
      });
    }
  } catch (error) {
    logger.error('Candidacy validation failed', {
      candidateId,
      error: (error as Error).message,
    });
  }
}
