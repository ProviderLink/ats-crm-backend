export interface ISettings {
  _id: string;
  email: {
    fromEmail: string;
    fromName: string;
  };
  ai: {
    provider: 'claude' | 'openai';
    resumeValidation: boolean;
    candidateScoring: boolean;
    resumeParsing: boolean;
  };
  applicationConfirmation: {
    enabled: boolean;
    templateId: string | null;
  };
  companyTimezone: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpdateSettingsInput {
  email?: {
    fromEmail?: string;
    fromName?: string;
  };
  ai?: {
    provider?: 'claude' | 'openai';
    resumeValidation?: boolean;
    candidateScoring?: boolean;
    resumeParsing?: boolean;
  };
  applicationConfirmation?: {
    enabled?: boolean;
    templateId?: string | null;
  };
  companyTimezone?: string;
}
