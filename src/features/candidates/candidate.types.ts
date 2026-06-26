export interface ICandidateExperience {
  company: string;
  title: string;
  duration: string;
  description: string;
}

export interface ICandidateEducation {
  institution: string;
  degree: string;
  field: string;
  year: string;
}

export interface ICandidateParsedData {
  summary: string;
  yearsOfExperience: number;
  skills: string[];
  languages: string[];
  certifications: string[];
  experience: ICandidateExperience[];
  education: ICandidateEducation[];
}

export interface ICandidateAiValidation {
  isValid: boolean;
  score: number;
  reason: string;
  completedAt: Date;
}

export interface ICandidateAiScore {
  score: number;
  recommendation: string;
  summary: string;
  strengths: string[];
  concerns: string[];
}

export interface ICandidateCrmProfile {
  workloadLevel: string;
  satisfactionScore: number | null;
  burnoutRiskFlag: boolean;
  replacementRiskFlag: boolean;
  lastVaCheckin: Date | null;
  notes: string;
}

export interface ICandidate {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  avatar: string | null;
  resumeUrl: string;
  resumeOriginalName: string;
  resumeRawText: string;
  videoIntroUrl: string | null;
  videoIntroSource: string | null;
  parsedData: ICandidateParsedData | null;
  aiValidation: ICandidateAiValidation | null;
  aiScore: ICandidateAiScore | null;
  appliedJobId: string | null;
  yearsOfExperience: number;
  englishProficiency:
    | 'basic'
    | 'conversational'
    | 'professional'
    | 'fluent'
    | 'native'
    | null;
  currentSalaryPHP: number | null;
  currentSalaryUSD: number | null;
  reasonForLeaving: string | null;
  cityOfResidence: string | null;
  source: string;
  tags: string[];
  inTalentPool: boolean;
  talentPoolAddedAt: Date | null;
  talentPoolNotes: string | null;
  status: string;
  crmProfile: ICandidateCrmProfile | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCandidateInput {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  resumeUrl: string;
  resumeOriginalName: string;
  resumeRawText?: string;
  videoIntroUrl?: string | null;
  videoIntroSource?: string | null;
  yearsOfExperience?: number;
  englishProficiency?:
    | 'basic'
    | 'conversational'
    | 'professional'
    | 'fluent'
    | 'native'
    | null;
  currentSalaryPHP?: number | null;
  currentSalaryUSD?: number | null;
  reasonForLeaving?: string | null;
  cityOfResidence?: string | null;
  source: 'applied' | 'internal_upload';
  tags?: string[];
}

export interface UpdateCandidateInput {
  firstName?: string;
  lastName?: string;
  phone?: string;
  avatar?: string | null;
  videoIntroUrl?: string | null;
  videoIntroSource?: string | null;
  yearsOfExperience?: number;
  tags?: string[];
  parsedData?: ICandidateParsedData | null;
  appliedJobId?: string | null;
  englishProficiency?:
    | 'basic'
    | 'conversational'
    | 'professional'
    | 'fluent'
    | 'native'
    | null;
  currentSalaryPHP?: number | null;
  currentSalaryUSD?: number | null;
  reasonForLeaving?: string | null;
  cityOfResidence?: string | null;
}
