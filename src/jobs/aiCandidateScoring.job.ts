import { createLog } from '../features/activity-logs/activityLog.service';
import Candidate from '../features/candidates/candidate.model';
import { updateAiScore } from '../features/candidates/candidate.service';
import Job from '../features/jobs/job.model';
import { getSettings } from '../features/settings/settings.service';
import {
  getAiProvider,
  parseJsonResponse,
  withRetry,
} from '../shared/utils/ai';
import logger from '../shared/utils/logger';

export async function runCandidateScoring(
  candidateId: string,
  jobId: string
): Promise<void> {
  const candidate = await Candidate.findById(candidateId);
  const job = await Job.findById(jobId);
  if (!candidate || !job) return;

  if (candidate.aiScore !== null) return;

  const settings = await getSettings();
  if (!settings.ai.candidateScoring) return;

  if (!candidate.parsedData) return;

  const prompt = `
You are a candidate evaluation assistant.
Evaluate this candidate for the job and respond with ONLY
a JSON object, no markdown, no explanation.

Job Title: ${job.title}
Job Description: ${job.description}
Required Skills: ${job.skills?.join(', ') ?? 'Not specified'}
Experience Level: ${job.experienceLevel}

Candidate Summary: ${candidate.parsedData.summary ?? 'Not provided'}
Candidate Skills: ${candidate.parsedData.skills?.join(', ') ?? 'Not specified'}
Years of Experience: ${candidate.yearsOfExperience}

Respond with exactly this JSON structure:
{
  "score": number between 0 and 100,
  "recommendation": one of: "poor_fit" | "moderate_fit" | "good_fit" | "strong_fit",
  "summary": "2-3 sentence evaluation",
  "strengths": ["strength1", "strength2"],
  "concerns": ["concern1", "concern2"]
}
`;

  try {
    const provider = await getAiProvider();
    const text = await withRetry(() => provider.generate(prompt, 1500));
    const result = parseJsonResponse<{
      score: number;
      recommendation: string;
      summary: string;
      strengths: string[];
      concerns: string[];
    }>(text);

    if (result) {
      await updateAiScore(candidateId, {
        score: result.score,
        recommendation: result.recommendation,
        summary: result.summary,
        strengths: result.strengths,
        concerns: result.concerns,
      });
      await createLog({
        type: 'ai_candidate_scoring_completed',
        resourceType: 'candidate',
        resourceId: candidateId,
        relatedType: 'job',
        relatedId: jobId,
        metadata: {
          score: result.score,
          recommendation: result.recommendation,
          provider: provider.name,
        },
      });
      logger.info('AI candidate scoring completed', {
        candidateId,
        jobId,
        score: result.score,
        recommendation: result.recommendation,
        provider: provider.name,
      });
    } else {
      logger.error('Failed to parse AI scoring response', {
        candidateId,
        jobId,
      });
    }
  } catch (error) {
    logger.error('AI candidate scoring failed', {
      candidateId,
      jobId,
      error: (error as Error).message,
    });
  }
}
