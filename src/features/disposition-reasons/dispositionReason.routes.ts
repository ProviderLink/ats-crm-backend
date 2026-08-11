import { Router } from 'express';
import { z } from 'zod';
import authenticate from '../../shared/middleware/authenticate';
import {
  requireAppAccess,
  requirePermission,
} from '../../shared/middleware/authorize';
import { validate } from '../../shared/validators/common.validator';
import {
  createReason,
  deactivateReason,
  getActiveReasons,
  getReasonById,
  listReasons,
  reorderReason,
  updateReason,
} from './dispositionReason.controller';

const createReasonSchema = z.object({
  label: z.string().min(1).max(200),
  category: z.enum([
    'experience_and_qualifications',
    'interview_performance',
    'availability_and_employment',
    'recruiter_or_client_selection',
    'candidate_actions',
    'permanently_ineligible_reasons',
    'other',
  ]),
  isActive: z.boolean().optional(),
  order: z.number().int().min(0).optional(),
  applicableStages: z.array(z.string()).optional(),
  defaultEligibility: z.enum(['eligible', 'permanently_ineligible']).optional(),
  requireInternalNotes: z.boolean().optional(),
});

const updateReasonSchema = z.object({
  label: z.string().min(1).max(200).optional(),
  category: z
    .enum([
      'experience_and_qualifications',
      'interview_performance',
      'availability_and_employment',
      'recruiter_or_client_selection',
      'candidate_actions',
      'permanently_ineligible_reasons',
      'other',
    ])
    .optional(),
  isActive: z.boolean().optional(),
  order: z.number().int().min(0).optional(),
  applicableStages: z.array(z.string()).optional(),
  defaultEligibility: z.enum(['eligible', 'permanently_ineligible']).optional(),
  requireInternalNotes: z.boolean().optional(),
});

const reorderSchema = z.object({
  order: z.number().int().min(0),
});

const router = Router();

router.use(authenticate);
router.use(requireAppAccess('ats'));

// ── Read routes (accessible to anyone with candidates read or settings read) ──

// Used by disposition dialog to fetch active reasons
router.get(
  '/active',
  requirePermission('candidates', 'read'),
  getActiveReasons
);

// Admin: list all reasons (including inactive)
router.get('/', requirePermission('settings', 'read'), listReasons);

router.get('/:id', requirePermission('settings', 'read'), getReasonById);

// ── Write routes (admin settings) ──

router.post(
  '/',
  requirePermission('settings', 'write'),
  validate(createReasonSchema, 'body'),
  createReason
);

router.patch(
  '/:id',
  requirePermission('settings', 'write'),
  validate(updateReasonSchema, 'body'),
  updateReason
);

router.patch(
  '/:id/deactivate',
  requirePermission('settings', 'write'),
  deactivateReason
);

router.patch(
  '/:id/reorder',
  requirePermission('settings', 'write'),
  validate(reorderSchema, 'body'),
  reorderReason
);

export default router;
