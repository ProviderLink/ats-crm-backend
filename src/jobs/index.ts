import logger from '../shared/utils/logger';
import { scheduleAmDigestJob } from './amDigest.job';
import { scheduleEodComplianceJob } from './eodCompliance.job';
import { scheduleScorecardJob } from './scorecardWeekly.job';
import { scheduleSurveyDispatcherJob } from './surveyDispatcher.job';

export function startBackgroundJobs(): void {
  scheduleEodComplianceJob();
  scheduleSurveyDispatcherJob();
  scheduleScorecardJob();
  scheduleAmDigestJob();
  logger.info('Background jobs scheduled');
}

export { runCandidacyValidation } from './aiCandidacyValidation.job';
export { runCandidateScoring } from './aiCandidateScoring.job';
export { runResumeParsing } from './aiResumeParsing.job';
export { runResumeValidation } from './aiResumeValidation.job';
