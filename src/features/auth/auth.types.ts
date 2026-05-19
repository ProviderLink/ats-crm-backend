export interface LoginInput {
  email: string;
  password: string;
}

export interface AuthTokenPayload {
  _id: string;
  roles: string[];
  appAccess: string[];
  permissions: Record<string, Record<string, boolean>>;
}
