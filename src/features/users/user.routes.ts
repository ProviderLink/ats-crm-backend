import { Router } from 'express';
import { z } from 'zod';
import authenticate from '../../shared/middleware/authenticate';
import { requireRoles } from '../../shared/middleware/authorize';
import { uploadUserAvatarFile } from '../../shared/middleware/upload';
import { validate } from '../../shared/validators/common.validator';
import {
  createUser,
  deactivateUser,
  getAllUsers,
  getUserById,
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

router.use(authenticate);

// Self-service routes (any authenticated user)
router.patch('/me', validate(updateMeSchema), updateMe);
router.post('/me/avatar', uploadUserAvatarFile, uploadAvatar);

// Admin-only routes
router.use(requireRoles('admin'));

router.get('/', getAllUsers);
router.post('/', validate(createUserSchema), createUser);
router.get('/:id', getUserById);
router.patch('/:id', validate(updateUserSchema), updateUser);
router.delete('/:id', deactivateUser);
router.patch(
  '/:id/permissions',
  validate(updatePermissionsSchema),
  updatePermissions
);

export default router;
