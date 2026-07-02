import { createLog } from '../features/activity-logs/activityLog.service';
import Candidate from '../features/candidates/candidate.model';
import { updateParsedData } from '../features/candidates/candidate.service';
import logger from '../shared/utils/logger';
import { parseResumeTextWithAI } from '../shared/utils/parseResumeWithAI';

export async function runResumeParsing(candidateId: string): Promise<void> {
  const candidate = await Candidate.findById(candidateId);
  if (!candidate) return;

  // Idempotent: skip only if parsed data has meaningful content.
  // A hollow parse (empty skills AND empty experience AND empty education)
  // is treated as "not yet parsed" so the AI gets another chance.
  const pd = candidate.parsedData;
  if (
    pd !== null &&
    pd !== undefined &&
    ((pd.skills && pd.skills.length > 0) ||
      (pd.experience && pd.experience.length > 0) ||
      (pd.education && pd.education.length > 0))
  ) {
    logger.debug('Candidate already has meaningful parsed data, skipping', {
      candidateId,
    });
    return;
  }

  if (pd) {
    logger.info('Re-parsing candidate with hollow parsed data', {
      candidateId,
      hadSummary: !!pd.summary,
      hadSkills: pd.skills?.length ?? 0,
      hadExperience: pd.experience?.length ?? 0,
    });
  }

  if (!candidate.resumeRawText || candidate.resumeRawText.trim() === '') {
    logger.debug('No resume text to parse', { candidateId });
    return;
  }

  const result = await parseResumeTextWithAI(candidate.resumeRawText);

  if (result) {
    await updateParsedData(candidateId, {
      summary: result.summary ?? '',
      yearsOfExperience:
        typeof result.yearsOfExperience === 'number'
          ? result.yearsOfExperience
          : 0,
      skills: result.skills ?? [],
      languages: result.languages ?? [],
      certifications: result.certifications ?? [],
      experience: result.experience ?? [],
      education: result.education ?? [],
    });
    await createLog({
      type: 'ai_resume_parsing_completed',
      resourceType: 'candidate',
      resourceId: candidateId,
      metadata: {
        skillsCount: result.skills?.length ?? 0,
        experienceCount: result.experience?.length ?? 0,
      },
    });
    logger.info('AI resume parsing completed', {
      candidateId,
      skillsCount: result.skills?.length ?? 0,
    });
  } else {
    logger.error('Failed to parse AI resume parsing response', {
      candidateId,
      responsePreview: 'AI returned no result',
    });
  }
}
