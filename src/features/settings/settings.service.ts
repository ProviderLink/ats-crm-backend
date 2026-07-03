import { clearAiProviderCache } from '../../shared/utils/ai/index';
import { createLog } from '../activity-logs/activityLog.service';
import Settings from './settings.model';
import type { ISettings, UpdateSettingsInput } from './settings.types';

export const getSettings = async (): Promise<ISettings> => {
  const settings = await Settings.getSettings();
  return settings.toSafeObject();
};

export const updateSettings = async (
  input: UpdateSettingsInput
): Promise<ISettings> => {
  const settings = await Settings.getSettings();

  if (input.email) {
    if (input.email.fromEmail) {
      settings.email.fromEmail = input.email.fromEmail;
    }
    if (input.email.fromName) {
      settings.email.fromName = input.email.fromName;
    }
    settings.markModified('email');
  }

  if (input.ai) {
    if (input.ai.provider !== undefined) {
      settings.ai.provider = input.ai.provider;
    }
    if (input.ai.resumeValidation !== undefined) {
      settings.ai.resumeValidation = input.ai.resumeValidation;
    }
    if (input.ai.candidateScoring !== undefined) {
      settings.ai.candidateScoring = input.ai.candidateScoring;
    }
    if (input.ai.resumeParsing !== undefined) {
      settings.ai.resumeParsing = input.ai.resumeParsing;
    }
    settings.markModified('ai');
    clearAiProviderCache();
  }

  if (input.applicationConfirmation) {
    if (input.applicationConfirmation.enabled !== undefined) {
      settings.applicationConfirmation.enabled =
        input.applicationConfirmation.enabled;
    }
    if (input.applicationConfirmation.templateId !== undefined) {
      settings.applicationConfirmation.templateId = input
        .applicationConfirmation
        .templateId as unknown as typeof settings.applicationConfirmation.templateId;
    }
    settings.markModified('applicationConfirmation');
  }

  if (input.companyTimezone) {
    settings.companyTimezone = input.companyTimezone;
  }

  await settings.save();

  createLog({
    type: 'settings_updated',
    resourceType: 'settings',
    resourceId: settings._id.toString(),
  });

  return settings.toSafeObject();
};
