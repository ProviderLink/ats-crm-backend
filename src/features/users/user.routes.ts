import { Router } from 'express';
import { z } from 'zod';
import authenticate from '../../shared/middleware/authenticate';
import { requirePermission } from '../../shared/middleware/authorize';
import { uploadUserAvatarFile } from '../../shared/middleware/upload';
import { validate } from '../../shared/validators/common.validator';
import {
  createUser,
  deactivateUser,
  getAllUsers,
  getUserById,
  provisionClient,
  provisionVA,
  revokeCrmAccess,
  updateMe,
  updatePermissions,
  updateUser,
  uploadAvatar,
} from './user.controller';

const router = Router();

const createUserSchema = z.object({
  firstName: z.string().min(1).max(50),
  lastName: z.string().min(1).max(50),
  email: z.string().email(),
  phone: z.string().optional(),
  roles: z
    .array(
      z.enum([
        'admin',
        'hiring_manager',
        'recruiter',
        'coordinator',
        'interviewer',
        'account_manager',
        'client',
        'va',
      ])
    )
    .min(1),
});

const updateUserSchema = z.object({
  firstName: z.string().min(1).max(50).optional(),
  lastName: z.string().min(1).max(50).optional(),
  phone: z.string().optional(),
  roles: z
    .array(
      z.enum([
        'admin',
        'hiring_manager',
        'recruiter',
        'coordinator',
        'interviewer',
        'account_manager',
        'client',
        'va',
      ])
    )
    .optional(),
  isActive: z.boolean().optional(),
});

const updateMeSchema = z.object({
  firstName: z.string().min(1).max(50).optional(),
  lastName: z.string().min(1).max(50).optional(),
  phone: z.string().optional(),
});

const updatePermissionsSchema = z.object({
  permissions: z.record(z.record(z.boolean())),
});

const provisionClientSchema = z.object({
  clientId: z.string().min(1),
});

const provisionVASchema = z.object({
  candidateId: z.string().min(1),
});

router.use(authenticate);

// Self-service routes (any authenticated user)
router.patch('/me', validate(updateMeSchema), updateMe);
router.post('/me/avatar', uploadUserAvatarFile, uploadAvatar);

// Admin-only routes (team management)
router.get('/', requirePermission('team', 'read'), getAllUsers);
router.post(
  '/',
  requirePermission('team', 'write'),
  validate(createUserSchema),
  createUser
);
router.get('/:id', requirePermission('team', 'read'), getUserById);
router.patch(
  '/:id',
  requirePermission('team', 'write'),
  validate(updateUserSchema),
  updateUser
);
router.delete('/:id', requirePermission('team', 'manage'), deactivateUser);
router.patch(
  '/:id/permissions',
  requirePermission('team', 'manage'),
  validate(updatePermissionsSchema),
  updatePermissions
);

// CRM provisioning routes (admin only)
router.post(
  '/provision-client',
  requirePermission('team', 'write'),
  validate(provisionClientSchema),
  provisionClient
);
router.post(
  '/provision-va',
  requirePermission('team', 'write'),
  validate(provisionVASchema),
  provisionVA
);
router.post(
  '/:id/revoke-crm',
  requirePermission('team', 'manage'),
  revokeCrmAccess
);

export default router;
