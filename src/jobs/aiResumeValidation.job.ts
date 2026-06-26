import { createLog } from '../features/activity-logs/activityLog.service';
import Application from '../features/applications/application.model';
import { updateAiValidation } from '../features/applications/application.service';
import Candidate from '../features/candidates/candidate.model';
import Job from '../features/jobs/job.model';
import { getSettings } from '../features/settings/settings.service';
import {
  getAiProvider,
  parseJsonResponse,
  withRetry,
} from '../shared/utils/ai/index';
import logger from '../shared/utils/logger';

export async function runResumeValidation(
  applicationId: string
): Promise<void> {
  const application = await Application.findById(applicationId);
  if (!application) return;

  const candidate = await Candidate.findById(application.candidateId);
  const job = await Job.findById(application.jobId);

  if (!candidate?.resumeRawText || candidate.resumeRawText.trim() === '') {
    logger.debug('No resume text available for validation', { applicationId });
    return;
  }

  if (application.aiValidation !== null) return;

  const settings = await getSettings();
  if (!settings.ai.resumeValidation) return;

  const prompt = `
You are a resume validation assistant.
Analyze the resume against the job requirements and respond
with ONLY a JSON object, no markdown, no explanation.

Job Title: ${job?.title ?? 'Unknown'}
Job Requirements: ${job?.requirements?.join(', ') ?? 'Not specified'}
Job Skills: ${job?.skills?.join(', ') ?? 'Not specified'}

Resume Text:
${candidate.resumeRawText}

Respond with exactly this JSON structure:
{
  "isValid": boolean,
  "score": number between 0 and 100,
  "reason": "one sentence explanation"
}
`;

  try {
    const provider = await getAiProvider();
    const text = await withRetry(() => provider.generate(prompt));
    const result = parseJsonResponse<{
      isValid: boolean;
      score: number;
      reason: string;
    }>(text);

    if (result) {
      await updateAiValidation(applicationId, {
        isValid: result.isValid,
        score: result.score,
        reason: result.reason,
      });
      await createLog({
        type: 'ai_resume_validation_completed',
        resourceType: 'application',
        resourceId: applicationId,
        metadata: {
          score: result.score,
          isValid: result.isValid,
          provider: provider.name,
        },
      });
      logger.info('AI resume validation completed', {
        applicationId,
        score: result.score,
        isValid: result.isValid,
        provider: provider.name,
      });
    } else {
      logger.error('Failed to parse AI resume validation response', {
        applicationId,
      });
    }
  } catch (error) {
    logger.error('AI resume validation failed', {
      applicationId,
      error: (error as Error).message,
    });
  }
}
