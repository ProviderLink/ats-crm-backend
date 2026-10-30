import { Router } from 'express';
import { z } from 'zod';
import authenticate from '../../shared/middleware/authenticate';
import {
  requireAppAccess,
  requireRoles,
} from '../../shared/middleware/authorize';
import { validate } from '../../shared/validators/common.validator';
import * as controller from './clientAccount.controller';

const updateClientAccountSchema = z.object({
  healthStatus: z.enum(['green', 'yellow', 'red']).optional(),
  baaSigned: z.boolean().optional(),
  baaSignedDate: z.string().datetime().optional().nullable(),
  emrSystem: z.string().optional(),
  onboardingComplete: z.boolean().optional(),
  sopReceived: z.boolean().optional(),
  satisfactionScore: z.number().min(1).max(5).optional().nullable(),
  openIssuesCount: z.number().min(0).optional(),
  lastClientCheckin: z.string().datetime().optional().nullable(),
  notes: z.string().optional(),
  accountOwnerId: z.string().optional().nullable(),
  serviceStartDate: z.string().datetime().optional().nullable(),
  primaryContact: z.string().optional(),
  secondaryContact: z.string().optional(),
});

const createClientNoteSchema = z.object({
  method: z.enum(['call', 'email', 'meeting', 'message', 'other']),
  content: z.string().min(1).max(5000),
});

const router = Router();

router.use(authenticate);
router.use(requireAppAccess('crm'));

router.get(
  '/provisioned',
  requireRoles('admin', 'account_manager'),
  controller.getProvisionedClients
);

router.get(
  '/:id/hired-vas',
  requireRoles('admin', 'account_manager', 'client'),
  controller.getHiredVasForClient
);

router.get(
  '/',
  requireRoles('admin', 'account_manager'),
  controller.getAllClientAccounts
);

router.get(
  '/:id',
  requireRoles('admin', 'account_manager'),
  controller.getClientAccountById
);

// Internal notes thread. Admin, or the account manager of that client (checked
// in the controller); editing and deleting notes stays with the ATS routes.
router.get(
  '/:id/notes',
  requireRoles('admin', 'account_manager'),
  controller.listClientNotes
);

router.post(
  '/:id/notes',
  requireRoles('admin', 'account_manager'),
  validate(createClientNoteSchema),
  controller.createClientNote
);

// Editing a client's CRM profile is admin-only; account managers can read the
// clients they manage and add notes.
router.patch(
  '/:id',
  requireRoles('admin'),
  validate(updateClientAccountSchema),
  controller.updateClientAccount
);

export default router;
