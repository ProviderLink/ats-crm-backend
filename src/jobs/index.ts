import logger from '../shared/utils/logger';
import { scheduleEodComplianceJob } from './eodCompliance.job';
import { scheduleSurveyDispatcherJob } from './surveyDispatcher.job';

export function startBackgroundJobs(): void {
  scheduleEodComplianceJob();
  scheduleSurveyDispatcherJob();
  logger.info('Background jobs scheduled');
}

export { runCandidacyValidation } from './aiCandidacyValidation.job';
export { runCandidateScoring } from './aiCandidateScoring.job';
export { runResumeParsing } from './aiResumeParsing.job';
export { runResumeValidation } from './aiResumeValidation.job';
