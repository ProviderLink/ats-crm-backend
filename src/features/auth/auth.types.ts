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
}
