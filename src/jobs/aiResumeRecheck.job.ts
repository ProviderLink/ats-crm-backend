import Application from '../features/applications/application.model';
import Candidate from '../features/candidates/candidate.model';
import { updateAiValidation } from '../features/candidates/candidate.service';
import {
  RESUME_TEXT_SCHEMA,
  getAiProvider,
  parseJsonResponse,
  withRetry,
} from '../shared/utils/ai/index';
import { extractResumeText } from '../shared/utils/extract-resume-text';
import logger from '../shared/utils/logger';
import { runCandidacyValidation } from './aiCandidacyValidation.job';
import { runCandidateScoring } from './aiCandidateScoring.job';
import { runResumeParsing } from './aiResumeParsing.job';
import { runResumeValidation } from './aiResumeValidation.job';

/**
 * Manual AI re-check of a candidate, started from the Candidates page (one
 * candidate or many).
 *
 * 1. Reads the stored resume file again. When the PDF has no text layer
 *    (scanned / image-only), or plain extraction finds almost nothing, the AI
 *    reads the PDF pages directly.
 * 2. Saves the fresh text, re-parses the profile from it, then
 *    re-runs candidacy validation, and validation and scoring for every
 *    application, replacing the old results.
 *
 * Old results stay in place until a new one is written, so a failed AI call
 * never wipes a score.
 */

/** Less real text than this means the file was not actually read. */
const MIN_TEXT_CHARS = 50;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 20_000;
/** Candidates re-checked at the same time; each makes several AI calls. */
const CONCURRENCY = 2;

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const queue: string[] = [];
const pending = new Set<string>();
let running = 0;

/**
 * Queue candidates for a re-check. Returns how many were newly queued (ids
 * already waiting or running are skipped).
 */
export function queueAiRecheck(candidateIds: string[]): number {
  let added = 0;
  for (const id of candidateIds) {
    if (pending.has(id)) continue;
    pending.add(id);
    queue.push(id);
    added++;
  }
  pump();
  return added;
}

function pump(): void {
  while (running < CONCURRENCY && queue.length > 0) {
    const id = queue.shift()!;
    running++;
    recheckCandidate(id)
      .catch(error =>
        logger.error('AI re-check failed', {
          candidateId: id,
          error: (error as Error).message,
        })
      )
      .finally(() => {
        running--;
        pending.delete(id);
        pump();
      });
  }
}

async function recheckCandidate(candidateId: string): Promise<void> {
  const candidate = await Candidate.findById(candidateId).select(
    'resumeUrl resumeRawText'
  );
  if (!candidate) return;

  const text = await readResume(candidate.resumeUrl, candidateId);
  // File not reachable: change nothing, the old results stay.
  if (text === null) return;

  if (text.length < MIN_TEXT_CHARS) {
    await updateAiValidation(candidateId, {
      isValid: false,
      score: 0,
      reason:
        "We couldn't read any text from the resume file, even with AI. Ask the candidate for a new copy.",
      completedAt: new Date(),
    });
    logger.warn('AI re-check: resume has no readable text', { candidateId });
    return;
  }

  if (text !== candidate.resumeRawText) {
    await Candidate.updateOne(
      { _id: candidateId },
      { $set: { resumeRawText: text } }
    );
  }

  // Re-collect the profile (summary, skills, experience, education, years)
  // from the fresh text, so anything missed the first time is filled in.
  await runResumeParsing(candidateId, { force: true }).catch(() => undefined);

  await runCandidacyValidation(candidateId, { force: true });

  // Oldest first, so the newest application's score ends up as the
  // candidate's list-view copy.
  const applications = await Application.find({ candidateId })
    .select('_id jobId')
    .sort({ createdAt: 1 });
  for (const app of applications) {
    await runResumeValidation(app._id.toString(), { force: true });
    if (app.jobId) {
      await runCandidateScoring(candidateId, app.jobId.toString(), {
        force: true,
      });
    }
  }

  logger.info('AI re-check completed', {
    candidateId,
    textChars: text.length,
    applications: applications.length,
  });
}

/**
 * Resume text from the stored file: '' when the file has no readable text,
 * null when the file itself could not be downloaded.
 */
async function readResume(
  url: string,
  candidateId: string
): Promise<string | null> {
  const buffer = await download(url);
  if (!buffer) return null;

  const isPdf = buffer.subarray(0, 5).toString('latin1') === '%PDF-';
  const isZip = buffer[0] === 0x50 && buffer[1] === 0x4b; // "PK" = docx

  if (isZip) {
    return (await extractResumeText(buffer, DOCX_MIME).catch(() => '')).trim();
  }
  if (!isPdf) {
    logger.warn('AI re-check: resume is not a PDF or DOCX', { candidateId });
    return '';
  }

  // Throws for image-only or unreadable PDFs; the AI gets a go at those.
  const plain = await extractResumeText(buffer, 'application/pdf').catch(
    () => ''
  );
  if (plain.trim().length >= MIN_TEXT_CHARS) return plain.trim();

  return readPdfWithAi(buffer, candidateId);
}

async function download(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > MAX_FILE_BYTES) throw new Error('file too large');
    return buffer;
  } catch (error) {
    logger.error('AI re-check: resume download failed', {
      url,
      error: (error as Error).message,
    });
    return null;
  }
}

async function readPdfWithAi(
  pdf: Buffer,
  candidateId: string
): Promise<string> {
  const prompt = `
This file is a resume. Copy out all of its text, top to bottom, exactly as written.
Keep headings, dates, company names, job titles and bullet points. Do not summarise,
fix or add anything. If the file has no readable text, return an empty string.

Respond with only this JSON: { "text": "<the resume text>" }
`.trim();

  try {
    const provider = await getAiProvider();
    const reply = await withRetry(
      () =>
        provider.generate(prompt, {
          pdf,
          maxTokens: 8000,
          jsonSchema: RESUME_TEXT_SCHEMA,
          timeoutMs: 120_000,
        }),
      2
    );
    const text = parseJsonResponse<{ text: string }>(reply)?.text ?? '';
    logger.info('AI re-check: resume read with AI', {
      candidateId,
      chars: text.length,
      provider: provider.name,
    });
    return text.trim();
  } catch (error) {
    logger.error('AI re-check: AI could not read the PDF', {
      candidateId,
      error: (error as Error).message,
    });
    return '';
  }
}
