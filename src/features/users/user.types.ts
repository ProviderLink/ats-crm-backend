export type UserRole =
  | 'admin'
  | 'hiring_manager'
  | 'recruiter'
  | 'coordinator'
  | 'interviewer'
  | 'account_manager'
  | 'client'
  | 'va';

export type AppAccess = 'ats' | 'crm';

export interface UserPermissions {
  candidates?: { read?: boolean; write?: boolean; manage?: boolean };
  jobs?: { read?: boolean; write?: boolean; manage?: boolean };
  interviews?: { read?: boolean; write?: boolean; schedule?: boolean };
  interviewScorecards?: { read?: boolean; write?: boolean };
  clients?: { read?: boolean; write?: boolean; manage?: boolean };
  emails?: { read?: boolean; write?: boolean };
  tags?: { read?: boolean; write?: boolean; manage?: boolean };
  settings?: { read?: boolean; write?: boolean };
  dashboard?: { read?: boolean };
  team?: { read?: boolean; write?: boolean; manage?: boolean };
  pipelineTemplates?: { read?: boolean; write?: boolean };
  emailTemplates?: { read?: boolean; write?: boolean };
  activityLogs?: { read?: boolean };
  assignments?: { read?: boolean; write?: boolean; manage?: boolean };
  reports?: { read?: boolean; write?: boolean; manage?: boolean };
  eod?: { read?: boolean; write?: boolean; approve?: boolean };
  performanceReview?: { read?: boolean; write?: boolean; approve?: boolean };
}

export interface IUser {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  avatar: string | null;
  roles: UserRole[];
  appAccess: AppAccess[];
  permissions: UserPermissions;
  isActive: boolean;
  emailVerified: boolean;
  passwordHash: string;
  refreshTokenAts: string | null;
  refreshTokenCrm: string | null;
  passwordResetToken: string | null;
  passwordResetExpires: Date | null;
  inviteToken: string | null;
  inviteTokenExpires: Date | null;
  isInviteAccepted: boolean;
  lastLoginAts: Date | null;
  lastLoginCrm: Date | null;
  clientRef: string | null;
  candidateRef: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type SafeUser = Omit<
  IUser,
  | 'passwordHash'
  | 'refreshTokenAts'
  | 'refreshTokenCrm'
  | 'passwordResetToken'
  | 'inviteToken'
>;

export interface CreateUserInput {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  roles: UserRole[];
  createdBy?: string;
}

export interface UpdateUserInput {
  firstName?: string;
  lastName?: string;
  phone?: string;
  avatar?: string;
  roles?: UserRole[];
  permissions?: UserPermissions;
  isActive?: boolean;
}
