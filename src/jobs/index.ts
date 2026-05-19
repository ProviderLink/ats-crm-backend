import { scheduleEodComplianceJob } from './eodCompliance.job';
import { scheduleSurveyDispatcherJob } from './surveyDispatcher.job';
import logger from '../shared/utils/logger';

export function startBackgroundJobs(): void {
  scheduleEodComplianceJob();
  scheduleSurveyDispatcherJob();
  logger.info('Background jobs scheduled');
}

export { runResumeValidation } from './aiResumeValidation.job';
export { runCandidateScoring } from './aiCandidateScoring.job';
