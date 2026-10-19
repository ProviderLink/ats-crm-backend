import { safeEmitToAts } from '../../sockets';
import { disconnectUser } from '../../sockets/presence';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { env } from '../../config/env';
import { AppError } from '../../shared/utils/AppError';
import { sendEmail } from '../../shared/utils/email';
import logger from '../../shared/utils/logger';
import { createLog } from '../activity-logs/activityLog.service';
import { upsertVaProfile } from '../va-profiles/vaProfile.service';
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

export function buildPermissionsForRoles(roles: UserRole[]): UserPermissions {
  // ── Admin: everything ──────────────────────────────────────────────
  if (roles.includes('admin')) {
    return {
      candidates: { read: true, write: true, manage: true },
      jobs: { read: true, write: true, manage: true },
      interviews: { read: true, write: true, schedule: true },
      interviewScorecards: { read: true, write: true },
      clients: { read: true, write: true, manage: true },
      emails: { read: true, write: true },
      tags: { read: true, write: true, manage: true },
      settings: { read: true, write: true },
      dashboard: { read: true },
      team: { read: true, write: true, manage: true },
      pipelineTemplates: { read: true, write: true },
      emailTemplates: { read: true, write: true },
      activityLogs: { read: true },
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
      // ── ATS roles ────────────────────────────────────────────────
      case 'hiring_manager':
        merge('candidates', { read: true, write: true, manage: true });
        merge('jobs', { read: true, write: true, manage: true });
        merge('interviews', { read: true, write: true });
        merge('interviewScorecards', { read: true, write: true });
        merge('team', { read: true });
        merge('clients', { read: true });
        merge('emails', { read: true, write: true });
        merge('tags', { read: true, write: true });
        merge('settings', { read: true });
        merge('dashboard', { read: true });
        merge('pipelineTemplates', { read: true });
        merge('emailTemplates', { read: true });
        break;

      case 'recruiter':
        merge('candidates', { read: true, write: true, manage: true });
        merge('jobs', { read: true });
        merge('interviews', { read: true, write: true });
        merge('interviewScorecards', { read: true, write: true });
        merge('team', { read: true });
        merge('clients', { read: true });
        merge('emails', { read: true, write: true });
        merge('tags', { read: true });
        merge('settings', { read: true });
        merge('dashboard', { read: true });
        merge('pipelineTemplates', { read: true });
        merge('emailTemplates', { read: true });
        break;

      case 'coordinator':
        merge('candidates', { read: true, write: true });
        merge('jobs', { read: true });
        merge('interviews', { read: true, write: true, schedule: true });
        merge('interviewScorecards', { read: true, write: true });
        merge('team', { read: true });
        merge('clients', { read: true });
        merge('emails', { read: true, write: true });
        merge('tags', { read: true });
        merge('settings', { read: true });
        merge('dashboard', { read: true });
        merge('pipelineTemplates', { read: true });
        merge('emailTemplates', { read: true });
        break;

      case 'interviewer':
        merge('candidates', { read: true });
        merge('interviews', { read: true, write: true });
        merge('interviewScorecards', { read: true, write: true });
        merge('team', { read: true });
        merge('tags', { read: true });
        break;

      // ── CRM roles ────────────────────────────────────────────────
      case 'account_manager':
        merge('clients', { read: true, write: true });
        merge('dashboard', { read: true });
        merge('activityLogs', { read: true });
        merge('assignments', { read: true, write: true, manage: true });
        merge('reports', { read: true, write: true, manage: true });
        merge('eod', { read: true, write: true, approve: true });
        merge('performanceReview', { read: true, write: true, approve: true });
        break;

      case 'client':
        merge('clients', { read: true });
        merge('assignments', { read: true });
        merge('reports', { read: true });
        merge('eod', { read: true });
        break;

      case 'va':
        merge('assignments', { read: true });
        merge('eod', { write: true });
        break;
    }
  }

  return perms;
}

export const getAllUsers = async (filters: {
  role?: string;
  roles?: string[];
  appAccess?: string;
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
  const { role, roles, appAccess, isActive, page = 1, limit = 20 } = filters;
  const query: Record<string, unknown> = {};

  if (role !== undefined) query['roles'] = role;
  // Several roles at once — `roles` is an array field, so `$in` means "has any
  // of these". Used by the interviewer picker to ask for the ATS staff roles
  // without a separate request per role.
  else if (roles && roles.length > 0) query['roles'] = { $in: roles };
  // `appAccess` is an array field, so a plain equality check matches any
  // document containing that value.
  if (appAccess !== undefined) query['appAccess'] = appAccess;
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

  createLog({
    action: 'created',
    resourceType: 'user',
    resourceId: user._id.toString(),
    metadata: { roles: input.roles },
    performedBy: createdBy ?? null,
  });

  safeEmitToAts('team', 'user:created', user.toSafeObject());
  return { user: user.toSafeObject(), inviteToken };
};

/**
 * Build an HTML invite email for new team members.
 */
function buildInviteEmailHtml(params: {
  firstName: string;
  companyName: string;
  invitedBy: string;
  inviteUrl: string;
}): string {
  const { firstName, companyName, invitedBy, inviteUrl } = params;
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>You've been invited to join ${companyName}</title>
</head>
<body style="font-family: Arial, Helvetica, sans-serif; background-color: #f4f4f4; margin: 0; padding: 0;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4; padding: 20px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
          <tr>
            <td style="background-color: #1a1a2e; padding: 30px; text-align: center;">
              <h1 style="color: #ffffff; font-size: 24px; margin: 0;">${companyName}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 40px 30px;">
              <h2 style="color: #1a1a2e; font-size: 20px; margin: 0 0 20px;">You've been invited! 🎉</h2>
              <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">
                Hello ${firstName},
              </p>
              <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">
                <strong>${invitedBy}</strong> has invited you to join <strong>${companyName}</strong> on the team portal.
              </p>
              <div style="background-color: #eff6ff; padding: 20px; border-radius: 8px; border: 1px solid #bfdbfe; margin: 24px 0;">
                <p style="color: #1e40af; font-size: 14px; line-height: 1.6; margin: 0;">
                  Click the button below to accept your invitation and set up your account. This link will expire in 24 hours.
                </p>
              </div>
              <div style="text-align: center; margin: 32px 0;">
                <a href="${inviteUrl}" style="display: inline-block; background-color: #71abbf; color: #ffffff; font-size: 16px; font-weight: 600; padding: 14px 32px; border-radius: 6px; text-decoration: none;">
                  Accept Invitation
                </a>
              </div>
              <p style="color: #666666; font-size: 14px; line-height: 1.6; margin: 0 0 8px;">
                Or copy and paste this URL into your browser:
              </p>
              <p style="color: #71abbf; font-size: 14px; line-height: 1.6; margin: 0 0 24px; word-break: break-all;">
                <a href="${inviteUrl}" style="color: #71abbf;">${inviteUrl}</a>
              </p>
              <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
              <p style="color: #999999; font-size: 12px; line-height: 1.6; margin: 0;">
                This invitation was sent by ${invitedBy}. If you weren't expecting this invitation, you can safely ignore this email.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Send invitation email to a newly created team member.
 */
export const sendTeamMemberInvite = async (params: {
  email: string;
  firstName: string;
  inviteToken: string;
  invitedByName?: string;
  /** Override the default ATS invite URL. Use env.CRM_FRONTEND_URL for CRM roles. */
  inviteUrl?: string;
}): Promise<void> => {
  const { email, firstName, inviteToken, invitedByName } = params;

  const inviteUrl =
    params.inviteUrl ??
    `${env.ATS_FRONTEND_URL}/ats/verify-email/${inviteToken}`;
  const companyName = env.COMPANY_NAME;
  const invitedBy = invitedByName || 'Administrator';

  const html = buildInviteEmailHtml({
    firstName,
    companyName,
    invitedBy,
    inviteUrl,
  });

  const text = `Welcome to ${companyName}!\n\nHi ${firstName},\n\n${invitedBy} has invited you to join ${companyName} on the team portal.\n\nAccept your invitation by visiting: ${inviteUrl}\n\nThis link will expire in 24 hours.\n\nIf you weren't expecting this invitation, you can safely ignore this email.`;

  try {
    await sendEmail({
      to: [email],
      subject: `You've been invited to join ${companyName}`,
      html,
      text,
    });
    logger.info(`Invite email sent to ${email}`);
  } catch (err) {
    // Log but don't throw — user was created successfully
    logger.error(`Failed to send invite email to ${email}`, err);
  }
};

export const updateUser = async (
  id: string,
  input: UpdateUserInput,
  updatedBy?: string | null
): Promise<SafeUser> => {
  const user = await User.findById(id);
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');

  const changes: string[] = [];
  const label = (roles: string[]) =>
    [...roles]
      .sort()
      .map(r => r.replace(/_/g, ' '))
      .join(', ') || 'none';
  if (input.roles !== undefined) {
    const before = label(user.roles);
    const after = label(input.roles);
    if (before !== after) {
      changes.push(`Roles changed from "${before}" to "${after}"`);
    }
    user.roles = input.roles as UserRole[];
    user.appAccess = deriveAppAccess(input.roles) as AppAccess[];
    user.permissions = buildPermissionsForRoles(input.roles);
    user.markModified('permissions');
  }
  const nameBefore = `${user.firstName} ${user.lastName}`.trim();
  if (input.firstName !== undefined) user.firstName = input.firstName;
  if (input.lastName !== undefined) user.lastName = input.lastName;
  const nameAfter = `${user.firstName} ${user.lastName}`.trim();
  if (nameBefore !== nameAfter) {
    changes.push(`Name changed from "${nameBefore}" to "${nameAfter}"`);
  }
  if (input.phone !== undefined && input.phone !== user.phone) {
    changes.push('Phone number updated');
  }
  if (input.phone !== undefined) user.phone = input.phone;
  if (input.avatar !== undefined) {
    changes.push('Profile photo updated');
    user.avatar = input.avatar;
  }
  if (input.permissions !== undefined) {
    changes.push('Permissions updated');
    user.permissions = input.permissions;
    user.markModified('permissions');
  }
  if (input.isActive !== undefined && input.isActive !== user.isActive) {
    changes.push(input.isActive ? 'Account activated' : 'Account deactivated');
  }
  if (input.isActive !== undefined) user.isActive = input.isActive;
  if (input.isActive === false) {
    // Deactivation ends existing sessions: without this the refresh cookie
    // stays valid for its full lifetime.
    user.refreshTokenAts = null;
    user.refreshTokenCrm = null;
  }

  await user.save();
  if (input.isActive === false) disconnectUser(id);

  createLog({
    action: 'updated',
    resourceType: 'user',
    resourceId: id,
    metadata: changes.length > 0 ? { changes } : {},
    performedBy: updatedBy ?? null,
  });

  safeEmitToAts('team', 'user:updated', user.toSafeObject());
  return user.toSafeObject();
};

export const updatePermissions = async (
  id: string,
  permissions: UserPermissions,
  updatedBy?: string | null
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

  const changedResources = Object.keys(merged).filter(
    key => JSON.stringify(merged[key]) !== JSON.stringify(current[key] ?? {})
  );

  user.permissions = merged as unknown as UserPermissions;
  user.markModified('permissions');
  await user.save();

  createLog({
    action: 'permissions_updated',
    resourceType: 'user',
    resourceId: id,
    metadata: { resources: changedResources },
    performedBy: updatedBy ?? null,
  });

  safeEmitToAts('team', 'user:updated', user.toSafeObject());
  return user.toSafeObject();
};

export const deactivateUser = async (
  id: string,
  deactivatedBy?: string | null
): Promise<SafeUser> => {
  const user = await User.findById(id);
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');

  const safeUser = user.toSafeObject();
  await User.findByIdAndDelete(id);
  disconnectUser(id);

  // This removes the account, so say so — and keep who it was, because the
  // user record is gone and the id alone would identify nobody.
  createLog({
    action: 'deleted',
    resourceType: 'user',
    resourceId: id,
    metadata: {
      name: `${safeUser.firstName} ${safeUser.lastName}`.trim(),
      email: safeUser.email,
      roles: safeUser.roles,
    },
    performedBy: deactivatedBy ?? null,
  });

  safeEmitToAts('team', 'user:deleted', { _id: id });

  return safeUser;
};

export const updateMe = async (
  id: string,
  input: { firstName?: string; lastName?: string; phone?: string }
): Promise<SafeUser> => {
  const user = await User.findById(id);
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');

  const changes: string[] = [];
  const nameBefore = `${user.firstName} ${user.lastName}`.trim();
  if (input.firstName !== undefined) user.firstName = input.firstName;
  if (input.lastName !== undefined) user.lastName = input.lastName;
  const nameAfter = `${user.firstName} ${user.lastName}`.trim();
  if (nameBefore !== nameAfter) {
    changes.push(`Name changed from "${nameBefore}" to "${nameAfter}"`);
  }
  if (input.phone !== undefined && input.phone !== user.phone) {
    changes.push('Phone number updated');
  }
  if (input.phone !== undefined) user.phone = input.phone;

  await user.save();

  if (changes.length > 0) {
    createLog({
      action: 'updated',
      resourceType: 'user',
      resourceId: id,
      metadata: { changes, self: true },
      performedBy: id,
    });
  }
  safeEmitToAts('team', 'user:updated', user.toSafeObject());
  return user.toSafeObject();
};

export const provisionVA = async (
  candidateId: string,
  firstName: string,
  lastName: string,
  email: string,
  createdBy?: string | null
): Promise<{ user: SafeUser; inviteToken: string | null }> => {
  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    // If the user was previously deactivated / CRM revoked, re-activate and re-invite
    if (
      !existing.isActive ||
      !(existing.appAccess as AppAccess[]).includes('crm')
    ) {
      const newInviteToken = crypto.randomBytes(32).toString('hex');
      const newInviteTokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
      existing.isActive = true;
      const access = existing.appAccess as AppAccess[];
      if (!access.includes('crm')) {
        access.push('crm');
        existing.appAccess = access;
        existing.markModified('appAccess');
      }
      existing.inviteToken = newInviteToken;
      existing.inviteTokenExpires = newInviteTokenExpires;
      existing.candidateRef = new mongoose.Types.ObjectId(candidateId);
      await existing.save();
      upsertVaProfile(candidateId, {}).catch(() => {});
      createLog({
        action: 'provisioned_va',
        resourceType: 'user',
        resourceId: existing._id.toString(),
        relatedType: 'candidate',
        relatedId: candidateId,
        performedBy: createdBy ?? null,
      });
      return { user: existing.toSafeObject(), inviteToken: newInviteToken };
    }
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

  createLog({
    action: 'provisioned_va',
    resourceType: 'user',
    resourceId: user._id.toString(),
    relatedType: 'candidate',
    relatedId: candidateId,
  });

  upsertVaProfile(candidateId, {}).catch(() => {});

  return { user: user.toSafeObject(), inviteToken };
};

export const provisionClient = async (
  clientId: string,
  firstName: string,
  lastName: string,
  email: string,
  createdBy?: string | null
): Promise<{ user: SafeUser; inviteToken: string | null }> => {
  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    // If the user was previously deactivated / CRM revoked, re-activate and re-invite
    if (
      !existing.isActive ||
      !(existing.appAccess as AppAccess[]).includes('crm')
    ) {
      const newInviteToken = crypto.randomBytes(32).toString('hex');
      const newInviteTokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
      existing.isActive = true;
      const access = existing.appAccess as AppAccess[];
      if (!access.includes('crm')) {
        access.push('crm');
        existing.appAccess = access;
        existing.markModified('appAccess');
      }
      existing.inviteToken = newInviteToken;
      existing.inviteTokenExpires = newInviteTokenExpires;
      existing.clientRef = new mongoose.Types.ObjectId(clientId);
      await existing.save();
      createLog({
        action: 'provisioned_client',
        resourceType: 'user',
        resourceId: existing._id.toString(),
        relatedType: 'client',
        relatedId: clientId,
        performedBy: createdBy ?? null,
      });
      return { user: existing.toSafeObject(), inviteToken: newInviteToken };
    }
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

  createLog({
    action: 'provisioned_client',
    resourceType: 'user',
    resourceId: user._id.toString(),
    relatedType: 'client',
    relatedId: clientId,
    performedBy: createdBy ?? null,
  });

  return { user: user.toSafeObject(), inviteToken };
};

/**
 * Revoke CRM access for a user.
 * Removes 'crm' from appAccess and deactivates the account.
 */
export const revokeCrmAccess = async (
  id: string,
  revokedBy?: string | null
): Promise<SafeUser> => {
  const user = await User.findById(id);
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');

  user.appAccess = (user.appAccess as AppAccess[]).filter(a => a !== 'crm');
  user.isActive = false;
  user.refreshTokenAts = null;
  user.refreshTokenCrm = null;
  user.markModified('appAccess');
  await user.save();

  createLog({
    action: 'revoked_crm',
    resourceType: 'user',
    resourceId: id,
    performedBy: revokedBy ?? null,
  });

  safeEmitToAts('team', 'user:updated', user.toSafeObject());
  return user.toSafeObject();
};
