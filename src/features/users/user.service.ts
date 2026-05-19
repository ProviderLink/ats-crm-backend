import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { AppError } from '../../shared/utils/AppError';
import User from './user.model';
import type {
  AppAccess,
  CreateUserInput,
  SafeUser,
  UpdateUserInput,
  UserPermissions,
  UserRole,
} from './user.types';

const ATS_ROLES: UserRole[] = [
  'hiring_manager',
  'recruiter',
  'coordinator',
  'interviewer',
];
const CRM_ROLES: UserRole[] = ['account_manager', 'client', 'va'];

function deriveAppAccess(roles: UserRole[]): AppAccess[] {
  if (roles.includes('admin')) return ['ats', 'crm'];
  const access: AppAccess[] = [];
  if (roles.some(r => ATS_ROLES.includes(r))) access.push('ats');
  if (roles.some(r => CRM_ROLES.includes(r))) access.push('crm');
  return access;
}

function buildPermissionsForRoles(roles: UserRole[]): UserPermissions {
  if (roles.includes('admin')) {
    return {
      candidates: { read: true, write: true, manage: true },
      jobs: { read: true, write: true, manage: true },
      interviews: { read: true, write: true, schedule: true },
      clients: { read: true, write: true, manage: true },
      team: { read: true, write: true, manage: true },
      analytics: { read: true },
      assignments: { read: true, write: true, manage: true },
      reports: { read: true, write: true, manage: true },
      eod: { read: true, write: true, approve: true },
      performanceReview: { read: true, write: true, approve: true },
    };
  }

  const perms: UserPermissions = {};

  const merge = (
    resource: keyof UserPermissions,
    additions: Record<string, boolean>
  ) => {
    perms[resource] = {
      ...(perms[resource] ?? {}),
      ...additions,
    } as UserPermissions[typeof resource];
  };

  for (const role of roles) {
    switch (role) {
      case 'hiring_manager':
        merge('jobs', { read: true, write: true, manage: true });
        merge('candidates', { read: true, write: true, manage: true });
        merge('analytics', { read: true });
        merge('interviews', { read: true });
        merge('clients', { read: true });
        break;
      case 'recruiter':
        merge('candidates', { read: true, write: true, manage: true });
        merge('jobs', { read: true });
        merge('interviews', { read: true });
        merge('clients', { read: true });
        break;
      case 'coordinator':
        merge('candidates', { read: true, write: true });
        merge('jobs', { read: true });
        merge('interviews', { read: true });
        break;
      case 'interviewer':
        merge('interviews', { read: true, write: true, schedule: true });
        merge('candidates', { read: true });
        break;
      case 'account_manager':
        merge('assignments', { read: true, write: true, manage: true });
        merge('reports', { read: true, write: true, manage: true });
        merge('eod', { read: true, write: true, approve: true });
        merge('performanceReview', { read: true, write: true, approve: true });
        break;
      case 'client':
        merge('assignments', { read: true });
        merge('reports', { read: true });
        merge('eod', { read: true });
        break;
      case 'va':
        merge('eod', { write: true });
        merge('assignments', { read: true });
        break;
    }
  }

  return perms;
}

export const getAllUsers = async (filters: {
  role?: string;
  isActive?: boolean;
  page?: number;
  limit?: number;
}): Promise<{
  users: SafeUser[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> => {
  const { role, isActive, page = 1, limit = 20 } = filters;
  const query: Record<string, unknown> = {};

  if (role !== undefined) query['roles'] = role;
  if (isActive !== undefined) query['isActive'] = isActive;

  const skip = (page - 1) * limit;
  const [users, total] = await Promise.all([
    User.find(query).skip(skip).limit(limit),
    User.countDocuments(query),
  ]);

  return {
    users: users.map(u => u.toSafeObject()),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
};

export const getUserById = async (id: string): Promise<SafeUser> => {
  const user = await User.findById(id);
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
  return user.toSafeObject();
};

export const createUser = async (
  input: CreateUserInput,
  createdBy?: string
): Promise<{ user: SafeUser; inviteToken: string }> => {
  const existing = await User.findOne({ email: input.email.toLowerCase() });
  if (existing) {
    throw new AppError(
      409,
      'USER_ALREADY_EXISTS',
      'A user with this email already exists'
    );
  }

  const appAccess = deriveAppAccess(input.roles);
  const permissions = buildPermissionsForRoles(input.roles);
  const inviteToken = crypto.randomBytes(32).toString('hex');
  const inviteTokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const passwordHash = await bcrypt.hash(
    crypto.randomBytes(32).toString('hex'),
    12
  );

  const user = await User.create({
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email,
    phone: input.phone ?? '',
    roles: input.roles,
    appAccess,
    permissions,
    passwordHash,
    inviteToken,
    inviteTokenExpires,
    createdBy: createdBy ? new mongoose.Types.ObjectId(createdBy) : null,
  });

  return { user: user.toSafeObject(), inviteToken };
};

export const updateUser = async (
  id: string,
  input: UpdateUserInput
): Promise<SafeUser> => {
  const user = await User.findById(id);
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');

  if (input.roles !== undefined) {
    user.roles = input.roles as UserRole[];
    user.appAccess = deriveAppAccess(input.roles) as AppAccess[];
  }
  if (input.firstName !== undefined) user.firstName = input.firstName;
  if (input.lastName !== undefined) user.lastName = input.lastName;
  if (input.phone !== undefined) user.phone = input.phone;
  if (input.avatar !== undefined) user.avatar = input.avatar;
  if (input.permissions !== undefined) {
    user.permissions = input.permissions;
    user.markModified('permissions');
  }
  if (input.isActive !== undefined) user.isActive = input.isActive;

  await user.save();
  return user.toSafeObject();
};

export const updatePermissions = async (
  id: string,
  permissions: UserPermissions
): Promise<SafeUser> => {
  const user = await User.findById(id);
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');

  const current = JSON.parse(JSON.stringify(user.permissions ?? {})) as Record<
    string,
    Record<string, boolean>
  >;
  const incoming = permissions as Record<string, Record<string, boolean>>;
  const allKeys = new Set([...Object.keys(current), ...Object.keys(incoming)]);

  const merged: Record<string, Record<string, boolean>> = {};
  allKeys.forEach(key => {
    merged[key] = { ...(current[key] ?? {}), ...(incoming[key] ?? {}) };
  });

  user.permissions = merged as unknown as UserPermissions;
  user.markModified('permissions');
  await user.save();
  return user.toSafeObject();
};

export const deactivateUser = async (id: string): Promise<SafeUser> => {
  const user = await User.findById(id);
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');

  user.isActive = false;
  user.refreshTokenAts = null;
  user.refreshTokenCrm = null;
  await user.save();
  return user.toSafeObject();
};

export const provisionVA = async (
  candidateId: string,
  firstName: string,
  lastName: string,
  email: string
): Promise<{ user: SafeUser; inviteToken: string | null }> => {
  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    return { user: existing.toSafeObject(), inviteToken: null };
  }

  const appAccess = deriveAppAccess(['va']);
  const permissions = buildPermissionsForRoles(['va']);
  const inviteToken = crypto.randomBytes(32).toString('hex');
  const inviteTokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const passwordHash = await bcrypt.hash(
    crypto.randomBytes(32).toString('hex'),
    12
  );

  const user = await User.create({
    firstName,
    lastName,
    email,
    roles: ['va'],
    appAccess,
    permissions,
    passwordHash,
    inviteToken,
    inviteTokenExpires,
    candidateRef: new mongoose.Types.ObjectId(candidateId),
    createdBy: null,
  });

  return { user: user.toSafeObject(), inviteToken };
};

export const provisionClient = async (
  clientId: string,
  firstName: string,
  lastName: string,
  email: string
): Promise<{ user: SafeUser; inviteToken: string | null }> => {
  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    return { user: existing.toSafeObject(), inviteToken: null };
  }

  const appAccess = deriveAppAccess(['client']);
  const permissions = buildPermissionsForRoles(['client']);
  const inviteToken = crypto.randomBytes(32).toString('hex');
  const inviteTokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const passwordHash = await bcrypt.hash(
    crypto.randomBytes(32).toString('hex'),
    12
  );

  const user = await User.create({
    firstName,
    lastName,
    email,
    roles: ['client'],
    appAccess,
    permissions,
    passwordHash,
    inviteToken,
    inviteTokenExpires,
    clientRef: new mongoose.Types.ObjectId(clientId),
    createdBy: null,
  });

  return { user: user.toSafeObject(), inviteToken };
};
