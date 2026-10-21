import { env } from '../../config/env';
import { clearAiProviderCache } from '../../shared/utils/ai/index';
import { clearCompanyTimezoneCache } from '../../shared/utils/companyTimezone';
import { clearEmailSenderCache } from '../../shared/utils/emailSender';
import { createLog } from '../activity-logs/activityLog.service';
import Settings from './settings.model';
import type { ISettings, UpdateSettingsInput } from './settings.types';

const onOff = (value: boolean) => (value ? 'on' : 'off');

/** One short line per setting that actually changed, for the activity log. */
function describeSettingsChanges(before: ISettings, after: ISettings): string[] {
  const changes: string[] = [];
  if (before.email.fromName !== after.email.fromName) {
    changes.push(
      `Sender name changed from "${before.email.fromName}" to "${after.email.fromName}"`
    );
  }
  if (before.ai.provider !== after.ai.provider) {
    changes.push(
      `AI provider changed from "${before.ai.provider}" to "${after.ai.provider}"`
    );
  }
  const toggles: [string, boolean, boolean][] = [
    ['Resume validation', before.ai.resumeValidation, after.ai.resumeValidation],
    ['Candidate scoring', before.ai.candidateScoring, after.ai.candidateScoring],
    ['Resume parsing', before.ai.resumeParsing, after.ai.resumeParsing],
    [
      'Application confirmation email',
      before.applicationConfirmation.enabled,
      after.applicationConfirmation.enabled,
    ],
  ];
  for (const [name, was, now] of toggles) {
    if (was !== now) {
      changes.push(`${name} changed from "${onOff(was)}" to "${onOff(now)}"`);
    }
  }
  if (
    String(before.applicationConfirmation.templateId ?? '') !==
    String(after.applicationConfirmation.templateId ?? '')
  ) {
    changes.push('Confirmation email template updated');
  }
  if (before.companyTimezone !== after.companyTimezone) {
    changes.push(
      `Company timezone changed from "${before.companyTimezone}" to "${after.companyTimezone}"`
    );
  }
  return changes;
}

/**
 * Outbound mail is always sent from `COMPANY_EMAIL` (see emailSender.ts), so
 * that is the address the UI must show — the value stored in the settings row
 * is legacy and can be stale. Display-only: nothing is written back.
 */
const withLiveSender = (settings: ISettings): ISettings => ({
  ...settings,
  email: { ...settings.email, fromEmail: env.COMPANY_EMAIL },
});

export const getSettings = async (): Promise<ISettings> => {
  const settings = await Settings.getSettings();
  return withLiveSender(settings.toSafeObject());
};

export const updateSettings = async (
  input: UpdateSettingsInput,
  updatedBy?: string | null
): Promise<ISettings> => {
  const settings = await Settings.getSettings();
  const before = settings.toSafeObject();

  if (input.email) {
    if (input.email.fromEmail) {
      settings.email.fromEmail = input.email.fromEmail;
    }
    if (input.email.fromName) {
      settings.email.fromName = input.email.fromName;
    }
    settings.markModified('email');
    // The sender identity caches for 60s — drop it so a new display name
    // applies to the very next outbound email.
    clearEmailSenderCache();
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

  // The resolver caches for 60s — drop it so the new value applies immediately.
  if (input.companyTimezone) clearCompanyTimezoneCache();

  const after = settings.toSafeObject();
  const changes = describeSettingsChanges(before, after);

  createLog({
    action: 'settings_updated',
    resourceType: 'settings',
    resourceId: settings._id.toString(),
    metadata: changes.length > 0 ? { changes } : {},
    performedBy: updatedBy ?? null,
  });

  return withLiveSender(after);
};
