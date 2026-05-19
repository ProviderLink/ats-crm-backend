export interface ISettings {
  _id: string;
  email: {
    fromEmail: string;
    fromName: string;
  };
  ai: {
    resumeValidation: boolean;
    candidateScoring: boolean;
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
    resumeValidation?: boolean;
    candidateScoring?: boolean;
  };
  companyTimezone?: string;
}
