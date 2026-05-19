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
    if (input.ai.resumeValidation !== undefined) {
      settings.ai.resumeValidation = input.ai.resumeValidation;
    }
    if (input.ai.candidateScoring !== undefined) {
      settings.ai.candidateScoring = input.ai.candidateScoring;
    }
    settings.markModified('ai');
  }

  if (input.companyTimezone) {
    settings.companyTimezone = input.companyTimezone;
  }

  await settings.save();
  return settings.toSafeObject();
};
