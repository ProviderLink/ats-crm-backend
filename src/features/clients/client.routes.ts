import { Router } from 'express';
import { z } from 'zod';
import authenticate from '../../shared/middleware/authenticate';
import { requireRoles } from '../../shared/middleware/authorize';
import { uploadLogo as uploadLogoMiddleware } from '../../shared/middleware/upload';
import { validate } from '../../shared/validators/common.validator';
import {
  addContact,
  createClient,
  createClientNote,
  deleteClient,
  deleteClientNote,
  deleteContact,
  getAllClients,
  getClientById,
  listClientNotes,
  updateClient,
  updateClientNote,
  updateContact,
  updateCrmProfile,
  uploadLogo,
} from './client.controller';

const createClientSchema = z.object({
  companyName: z.string().min(1).max(100),
  email: z.string().email(),
  phone: z.string().optional(),
  website: z.string().url().optional().or(z.literal('')),
  industry: z.string().optional(),
  companySize: z
    .enum(['1-10', '11-50', '51-200', '201-500', '500+'])
    .optional(),
  description: z.string().optional(),
  address: z
    .object({
      street: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      country: z.string().optional(),
      postalCode: z.string().optional(),
    })
    .optional(),
});

const updateClientSchema = createClientSchema.partial().extend({
  status: z.enum(['active', 'inactive', 'suspended']).optional(),
});

const createContactSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  phone: z.string().optional(),
  position: z.string().optional(),
  isPrimary: z.boolean().optional(),
});

const updateContactSchema = createContactSchema.partial();

const createClientNoteSchema = z.object({
  method: z.enum(['call', 'email', 'meeting', 'message', 'other']),
  content: z.string().min(1).max(5000),
});

const updateClientNoteSchema = createClientNoteSchema.partial();

const updateCrmProfileSchema = z.object({
  healthStatus: z.enum(['green', 'yellow', 'red']).optional(),
  baaSign: z.boolean().optional(),
  baaSignedDate: z.string().datetime().optional().nullable(),
  emrSystem: z.string().optional(),
  onboardingComplete: z.boolean().optional(),
  sopReceived: z.boolean().optional(),
  satisfactionScore: z.number().min(1).max(5).optional(),
  openIssuesCount: z.number().min(0).optional(),
  lastClientCheckin: z.string().datetime().optional().nullable(),
  notes: z.string().optional(),
});

const router = Router();

router.use(authenticate);

router.get(
  '/',
  requireRoles(
    'admin',
    'hiring_manager',
    'recruiter',
    'coordinator',
    'account_manager'
  ),
  getAllClients
);

router.post(
  '/',
  requireRoles('admin'),
  validate(createClientSchema),
  createClient
);

router.get(
  '/:id',
  requireRoles(
    'admin',
    'hiring_manager',
    'recruiter',
    'coordinator',
    'account_manager',
    'client'
  ),
  getClientById
);

router.patch(
  '/:id',
  requireRoles('admin'),
  validate(updateClientSchema),
  updateClient
);

router.delete('/:id', requireRoles('admin'), deleteClient);

router.post(
  '/:id/logo',
  requireRoles('admin'),
  uploadLogoMiddleware,
  uploadLogo
);

router.post(
  '/:id/contacts',
  requireRoles('admin', 'account_manager'),
  validate(createContactSchema),
  addContact
);

router.patch(
  '/:id/contacts/:contactId',
  requireRoles('admin', 'account_manager'),
  validate(updateContactSchema),
  updateContact
);

router.delete(
  '/:id/contacts/:contactId',
  requireRoles('admin', 'account_manager'),
  deleteContact
);

router.patch(
  '/:id/crm-profile',
  requireRoles('admin', 'account_manager'),
  validate(updateCrmProfileSchema),
  updateCrmProfile
);

// --- Client notes sub-resource -------------------------------------------
router.get(
  '/:clientId/notes',
  requireRoles(
    'admin',
    'hiring_manager',
    'recruiter',
    'coordinator',
    'account_manager',
    'client'
  ),
  listClientNotes
);

router.post(
  '/:clientId/notes',
  requireRoles('admin', 'account_manager', 'recruiter', 'coordinator'),
  validate(createClientNoteSchema),
  createClientNote
);

router.patch(
  '/:clientId/notes/:noteId',
  requireRoles('admin', 'account_manager', 'recruiter', 'coordinator'),
  validate(updateClientNoteSchema),
  updateClientNote
);

router.delete(
  '/:clientId/notes/:noteId',
  requireRoles('admin', 'account_manager'),
  deleteClientNote
);

export default router;
