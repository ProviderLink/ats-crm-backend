import Application from '../features/applications/application.model';
import * as applicationService from '../features/applications/application.service';
import Candidate from '../features/candidates/candidate.model';
import * as candidateService from '../features/candidates/candidate.service';
import Job from '../features/jobs/job.model';
import { getSettings } from '../features/settings/settings.service';
import {
  getAiProvider,
  parseJsonResponse,
  withRetry,
} from '../shared/utils/ai/index';
import { coalesce } from '../shared/utils/coalesce';
import logger from '../shared/utils/logger';

/**
 * TYPE 2 — Candidate Scoring (competency against a specific job)
 *
 * Runs when an Application is created (candidate approved).
 * Evaluates the candidate's competency for this specific job.
 * Primary result: Application.aiScore
 * Convenience copy: Candidate.aiScore (shows latest score in list views)
 *
 * Coalesced per candidate+job: the approve, assign and apply paths can all
 * trigger scoring for the same pair, which tripled the timeline entry.
 */
export function runCandidateScoring(
  candidateId: string,
  jobId: string
): Promise<void> {
  return coalesce(`score:${candidateId}:${jobId}`, () =>
    scoreCandidate(candidateId, jobId)
  );
}

async function scoreCandidate(
  candidateId: string,
  jobId: string
): Promise<void> {
  const candidate = await Candidate.findById(candidateId);
  const job = await Job.findById(jobId);
  if (!candidate || !job) return;

  // Find the Application that links this candidate to this job
  const application = await Application.findOne({ candidateId, jobId });
  if (!application) {
    logger.debug('No application found for candidate scoring', {
      candidateId,
      jobId,
    });
    return;
  }

  // Idempotent: skip if application already has aiScore
  if (application.aiScore !== null && application.aiScore !== undefined) {
    logger.debug('Application already has aiScore, skipping', {
      applicationId: application._id,
    });
    return;
  }

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
    const text = await withRetry(() =>
      provider.generate(prompt, { maxTokens: 1500, prefillAssistant: '{' })
    );
    const result = parseJsonResponse<{
      score: number;
      recommendation: string;
      summary: string;
      strengths: string[];
      concerns: string[];
    }>(text);

    if (result) {
      const scoreData = {
        score: result.score,
        recommendation: result.recommendation,
        summary: result.summary,
        strengths: result.strengths,
        concerns: result.concerns,
      };

      // Write to Application.aiScore (primary)
      await applicationService.updateApplicationAiScore(
        application._id.toString(),
        scoreData
      );

      // Also write to Candidate.aiScore (convenience copy for list views)
      await candidateService.updateAiScore(candidateId, scoreData);

      // NOTE: no createLog here. Both service calls above record their own
      // `ai_score_updated` activity, so logging again tripled the entry.
      logger.info('AI candidate scoring completed', {
        candidateId,
        applicationId: application._id.toString(),
        score: result.score,
      });
      logger.info('AI candidate scoring completed', {
        candidateId,
        jobId,
        applicationId: application._id,
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
