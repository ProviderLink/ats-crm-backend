import { createLog } from '../features/activity-logs/activityLog.service';
import Candidate from '../features/candidates/candidate.model';
import { updateParsedData } from '../features/candidates/candidate.service';
import type { ICandidateParsedData } from '../features/candidates/candidate.types';
import { getSettings } from '../features/settings/settings.service';
import {
  getAiProvider,
  parseJsonResponse,
  withRetry,
} from '../shared/utils/ai';
import logger from '../shared/utils/logger';

export async function runResumeParsing(candidateId: string): Promise<void> {
  const candidate = await Candidate.findById(candidateId);
  if (!candidate) return;

  // Idempotent: skip if already parsed
  if (candidate.parsedData !== null && candidate.parsedData !== undefined) {
    logger.debug('Candidate already has parsed data, skipping', {
      candidateId,
    });
    return;
  }

  if (!candidate.resumeRawText || candidate.resumeRawText.trim() === '') {
    logger.debug('No resume text to parse', { candidateId });
    return;
  }

  const settings = await getSettings();
  if (!settings.ai.resumeParsing) {
    logger.debug('Resume parsing disabled in settings', { candidateId });
    return;
  }

  const prompt = `
You are a resume parsing assistant.
Extract structured information from the resume text below.
Respond with ONLY a JSON object, no markdown, no explanation.

Resume Text:
${candidate.resumeRawText}

Respond with exactly this JSON structure:
{
  "summary": "2-3 sentence professional summary of the candidate",
  "skills": ["skill1", "skill2", "..."],
  "languages": ["language1", "language2", "..."],
  "certifications": ["certification1", "certification2", "..."],
  "experience": [
    {
      "company": "Company Name",
      "title": "Job Title",
      "duration": "e.g. Jan 2020 - Dec 2023 or 3 years",
      "description": "1-2 sentences describing responsibilities"
    }
  ],
  "education": [
    {
      "institution": "University Name",
      "degree": "e.g. Bachelor of Science",
      "field": "e.g. Computer Science",
      "year": "e.g. 2019"
    }
  ]
}

Rules:
- If a field is not found in the resume, use an empty array [].
- Limit skills to the 15 most relevant.
- Limit experience entries to the last 5 positions.
- Limit education entries to the top 3.
- Infer languages from the resume content and context.
- Be accurate — do not fabricate information not present in the resume.
`;

  try {
    const provider = await getAiProvider();
    const text = await withRetry(() => provider.generate(prompt, 2000));
    const result = parseJsonResponse<ICandidateParsedData>(text);

    if (result) {
      await updateParsedData(candidateId, {
        summary: result.summary ?? '',
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
          provider: provider.name,
        },
      });
      logger.info('AI resume parsing completed', {
        candidateId,
        skillsCount: result.skills?.length ?? 0,
        provider: provider.name,
      });
    } else {
      logger.error('Failed to parse AI resume parsing response', {
        candidateId,
      });
    }
  } catch (error) {
    logger.error('AI resume parsing failed', {
      candidateId,
      error: (error as Error).message,
    });
  }
}
