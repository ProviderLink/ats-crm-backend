import { Request, Response } from 'express';
import mongoose from 'mongoose';
import {
  deleteFromCloudinary,
  uploadToCloudinary,
} from '../../config/cloudinary';
import { env } from '../../config/env';
import AppError from '../../shared/utils/AppError';
import catchAsync from '../../shared/utils/catchAsync';
import logger from '../../shared/utils/logger';
import { sendSuccess } from '../../shared/utils/response';
import Assignment from '../assignments/assignment.model';
import Candidate from '../candidates/candidate.model';
import Client from '../clients/client.model';
import User from './user.model';
import * as userService from './user.service';

const isAdminRequest = (req: Request): boolean =>
  req.user!.roles.includes('admin');

/** Only an admin may hand out the admin role. */
const assertCanAssignRoles = (req: Request, roles?: string[]): void => {
  if (roles?.includes('admin') && !isAdminRequest(req)) {
    throw new AppError(
      403,
      'AUTH_INSUFFICIENT_PERMISSIONS',
      'Only an administrator can assign the admin role'
    );
  }
};

/** Team permissions never extend to editing, deactivating or removing an admin. */
const assertCanManageTarget = async (
  req: Request,
  targetId: string
): Promise<void> => {
  if (isAdminRequest(req)) return;
  const target = await User.findById(targetId).select('roles');
  if (target?.roles.includes('admin')) {
    throw new AppError(
      403,
      'AUTH_INSUFFICIENT_PERMISSIONS',
      'Only an administrator can change an administrator account'
    );
  }
};

export const getAllUsers = catchAsync(async (req: Request, res: Response) => {
  const {
    role,
    roles,
    appAccess,
    isActive: isActiveRaw,
    page,
    limit,
  } = req.query as Record<string, string | undefined>;

  const isActive =
    isActiveRaw === 'true' ? true : isActiveRaw === 'false' ? false : undefined;

  // A valueless `?page=` yields `''`, and `Number('')` is 0 — which is not
  // `undefined`, so the service default never fires and Mongo rejects a negative
  // `skip`. Normalise instead of trusting the raw query string.
  const toPositiveInt = (raw?: string): number | undefined => {
    const n = Number(raw);
    return raw !== undefined && Number.isFinite(n) && n > 0
      ? Math.floor(n)
      : undefined;
  };

  const result = await userService.getAllUsers({
    role,
    // Comma-separated so the picker can request several roles in one call.
    roles: roles
      ? roles
          .split(',')
          .map(r => r.trim())
          .filter(Boolean)
      : undefined,
    appAccess,
    isActive,
    page: toPositiveInt(page),
    limit: toPositiveInt(limit),
  });

  sendSuccess(res, result.users, 'Users retrieved', 200, {
    total: result.total,
    page: result.page,
    limit: result.limit,
    totalPages: result.totalPages,
  });
});

/**
 * GET /shared/users/crm-accounts — returns CRM client & VA users, scoped to
 * the caller. Account managers get only the clients/VAs tied to their own
 * assignments; admins get everyone. Requires only authentication (no team.read).
 */
export const getCrmAccountsList = catchAsync(
  async (req: Request, res: Response) => {
    const user = req.user!;
    const isAdmin = user.roles.includes('admin');
    const isAM = user.roles.includes('account_manager');

    let scopedClientIds: Set<string> | undefined;
    let scopedCandidateIds: Set<string> | undefined;

    if (!isAdmin) {
      if (!isAM) {
        // Non-admin, non-AM callers (e.g. va/client) have no reason to see
        // CRM account lists; return empty.
        sendSuccess(res, { clients: [], vas: [] }, 'OK', 200);
        return;
      }
      const assignments = await Assignment.find({
        accountManagerId: new mongoose.Types.ObjectId(String(user._id)),
      }).select('clientId candidateId');
      scopedClientIds = new Set(assignments.map(a => String(a.clientId)));
      scopedCandidateIds = new Set(assignments.map(a => String(a.candidateId)));
    }

    const userQuery: Record<string, unknown> = {};
    const [clientUsers, vaUsers] = await Promise.all([
      (async () => {
        if (scopedClientIds && scopedClientIds.size === 0) return [];
        const q: Record<string, unknown> = {
          roles: 'client',
          clientRef: { $ne: null },
        };
        if (scopedClientIds) q['clientRef'] = { $in: [...scopedClientIds] };
        return User.find(q);
      })(),
      (async () => {
        if (scopedCandidateIds && scopedCandidateIds.size === 0) return [];
        const q: Record<string, unknown> = {
          roles: 'va',
          candidateRef: { $ne: null },
        };
        if (scopedCandidateIds)
          q['candidateRef'] = { $in: [...scopedCandidateIds] };
        return User.find(q);
      })(),
    ]);

    sendSuccess(
      res,
      {
        clients: clientUsers.map(u => u.toSafeObject()),
        vas: vaUsers.map(u => u.toSafeObject()),
      },
      'CRM accounts retrieved',
      200
    );
  }
);

export const getUserById = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const user = await userService.getUserById(id);
  sendSuccess(res, user, 'User retrieved', 200);
});

export const createUser = catchAsync(async (req: Request, res: Response) => {
  const body = req.body;
  assertCanAssignRoles(req, body.roles);
  const createdBy = req.user!._id;
  const { user, inviteToken } = await userService.createUser(body, createdBy);

  // CRM roles get the CRM invite URL; ATS roles get the ATS URL
  const isCrmOnly =
    user.appAccess?.includes('crm') && !user.appAccess?.includes('ats');
  const inviteUrl = isCrmOnly
    ? `${env.CRM_FRONTEND_URL}/accept-invitation?token=${inviteToken}`
    : undefined; // undefined = default ATS URL

  // Send invite email asynchronously (don't block the response)
  userService
    .sendTeamMemberInvite({
      email: user.email,
      firstName: user.firstName,
      inviteToken,
      invitedByName: `${req.user!.firstName} ${req.user!.lastName}`,
      inviteUrl,
    })
    .catch(err => {
      logger.error('Failed to send team member invite email', err);
    });

  sendSuccess(
    res,
    { user, inviteToken },
    'User created successfully. Invite email will be sent.',
    201
  );
});

export const updateUser = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const body = req.body;
  assertCanAssignRoles(req, body.roles);
  await assertCanManageTarget(req, id);
  const user = await userService.updateUser(id, body, req.user!._id);
  sendSuccess(res, user, 'User updated', 200);
});

export const updateMe = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user!._id;
  const body = req.body;
  const user = await userService.updateMe(userId, body);
  sendSuccess(res, user, 'Profile updated', 200);
});

export const deactivateUser = catchAsync(
  async (req: Request, res: Response) => {
    const { id } = req.params;

    if (id === req.user!._id) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        'You cannot deactivate your own account'
      );
    }

    await assertCanManageTarget(req, id);
    const user = await userService.deactivateUser(id, req.user!._id);
    sendSuccess(res, user, 'User deactivated', 200);
  }
);

export const updatePermissions = catchAsync(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const body = req.body;
    await assertCanManageTarget(req, id);
    const user = await userService.updatePermissions(
      id,
      body.permissions,
      req.user!._id
    );
    sendSuccess(res, user, 'Permissions updated', 200);
  }
);

export const uploadAvatar = catchAsync(async (req: Request, res: Response) => {
  if (!req.file) {
    throw new AppError(400, 'VALIDATION_ERROR', 'No file provided');
  }

  const userId = req.user!._id;
  const user = await userService.getUserById(userId);

  const { url } = await uploadToCloudinary(req.file, 'avatars');

  // Delete old avatar if exists
  if (user.avatar) {
    const match = user.avatar.match(/\/upload\/(?:v\d+\/)?(.+)\.[^.]+$/);
    const publicId = match ? match[1] : null;
    if (publicId) {
      deleteFromCloudinary(publicId, 'image');
    }
  }

  const updatedUser = await userService.updateUser(
    userId,
    { avatar: url },
    userId
  );
  sendSuccess(res, updatedUser, 'Avatar uploaded', 200);
});

// ─── CRM Provisioning ─────────────────────────────────────────────────────────

/**
 * POST /shared/users/provision-client
 * Admin manually provisions CRM access for a client.
 * Looks up the client's primary contact and creates a CRM user (role=client).
 */
export const provisionClient = catchAsync(
  async (req: Request, res: Response) => {
    const { clientId } = req.body;

    const client = await Client.findById(clientId);
    if (!client) {
      throw new AppError(404, 'CLIENT_NOT_FOUND', 'Client not found');
    }

    const primaryContact = client.contacts?.find(
      (c: { isPrimary: boolean }) => c.isPrimary
    );
    const email = primaryContact?.email ?? (client as any).email;
    if (!email) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        'Client has no email address on file'
      );
    }

    const nameParts = (primaryContact?.name ?? '').split(' ');
    const firstName = nameParts[0] || 'Client';
    const lastName = nameParts.slice(1).join(' ') || '';

    const { user, inviteToken } = await userService.provisionClient(
      clientId,
      firstName,
      lastName,
      email,
      req.user!._id
    );

    if (inviteToken) {
      userService
        .sendTeamMemberInvite({
          email: user.email,
          firstName: user.firstName,
          inviteToken,
          invitedByName: `${req.user!.firstName} ${req.user!.lastName}`,
          inviteUrl: `${env.CRM_FRONTEND_URL}/accept-invitation?token=${inviteToken}`,
        })
        .catch(err => {
          logger.error('Failed to send client invite email', err);
        });
    }

    sendSuccess(
      res,
      user,
      inviteToken
        ? 'Client provisioned. Invite email will be sent.'
        : 'Client already has CRM access.',
      201
    );
  }
);

/**
 * POST /shared/users/provision-va
 * Admin manually provisions CRM access for a hired candidate (VA).
 * Looks up the candidate and creates a CRM user (role=va).
 */
export const provisionVA = catchAsync(async (req: Request, res: Response) => {
  const { candidateId } = req.body;

  const candidate = await Candidate.findById(candidateId);
  if (!candidate) {
    throw new AppError(404, 'CANDIDATE_NOT_FOUND', 'Candidate not found');
  }
  if (!candidate.email) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Candidate has no email address on file'
    );
  }

  const { user, inviteToken } = await userService.provisionVA(
    candidateId,
    candidate.firstName,
    candidate.lastName,
    candidate.email,
    req.user!._id
  );

  if (inviteToken) {
    userService
      .sendTeamMemberInvite({
        email: user.email,
        firstName: user.firstName,
        inviteToken,
        invitedByName: `${req.user!.firstName} ${req.user!.lastName}`,
        inviteUrl: `${env.CRM_FRONTEND_URL}/accept-invitation?token=${inviteToken}`,
      })
      .catch(err => {
        logger.error('Failed to send VA invite email', err);
      });
  }

  sendSuccess(
    res,
    user,
    inviteToken
      ? 'VA provisioned. Invite email will be sent.'
      : 'VA already has CRM access.',
    201
  );
});

/**
 * POST /shared/users/:id/revoke-crm
 * Revokes CRM access: removes 'crm' from appAccess, sets isActive = false.
 */
export const revokeCrmAccess = catchAsync(
  async (req: Request, res: Response) => {
    const { id } = req.params;

    if (id === req.user!._id) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        'You cannot revoke your own CRM access'
      );
    }

    await assertCanManageTarget(req, id);
    const user = await userService.revokeCrmAccess(id, req.user!._id);
    sendSuccess(res, user, 'CRM access revoked', 200);
  }
);
