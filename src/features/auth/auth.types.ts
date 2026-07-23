export interface LoginInput {
  email: string;
  password: string;
  app?: 'ats' | 'crm';
}

export interface AuthTokenPayload {
  _id: string;
  firstName: string;
  lastName: string;
  roles: string[];
  appAccess: string[];
  permissions: Record<string, Record<string, boolean>>;
  /** ATS Candidate document ID — only set for VA users */
  candidateRef: string | null;
  /** ATS Client document ID — only set for client users */
  clientRef: string | null;
}
