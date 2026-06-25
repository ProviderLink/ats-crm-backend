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
  companyTimezone?: string;
}
