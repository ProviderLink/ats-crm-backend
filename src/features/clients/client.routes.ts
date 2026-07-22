import { Router } from 'express';
import { z } from 'zod';
import authenticate from '../../shared/middleware/authenticate';
import {
  requireAppAccess,
  requirePermission,
} from '../../shared/middleware/authorize';
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
  tags: z.array(z.string()).optional(),
});

const updateClientSchema = createClientSchema.partial().extend({
  status: z.enum(['active', 'inactive', 'suspended']).optional(),
  tags: z.array(z.string()).optional(),
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
  baaSigned: z.boolean().optional(), // alias accepted by CRM
  baaSignedDate: z.string().datetime().optional().nullable(),
  emrSystem: z.string().optional(),
  onboardingComplete: z.boolean().optional(),
  sopReceived: z.boolean().optional(),
  satisfactionScore: z.number().min(1).max(5).optional(),
  openIssuesCount: z.number().min(0).optional(),
  lastClientCheckin: z.string().datetime().optional().nullable(),
  notes: z.string().optional(),
  accountOwnerId: z.string().optional().nullable(),
  serviceStartDate: z.string().datetime().optional().nullable(),
  primaryContact: z.string().optional(),
  secondaryContact: z.string().optional(),
});

const router = Router();

router.use(authenticate);
router.use(requireAppAccess('ats'));

router.get('/', requirePermission('clients', 'read'), getAllClients);

router.post(
  '/',
  requirePermission('clients', 'write'),
  validate(createClientSchema),
  createClient
);

router.get('/:id', requirePermission('clients', 'read'), getClientById);

router.patch(
  '/:id',
  requirePermission('clients', 'write'),
  validate(updateClientSchema),
  updateClient
);

router.delete('/:id', requirePermission('clients', 'manage'), deleteClient);

router.post(
  '/:id/logo',
  requirePermission('clients', 'write'),
  uploadLogoMiddleware,
  uploadLogo
);

router.post(
  '/:id/contacts',
  requirePermission('clients', 'write'),
  validate(createContactSchema),
  addContact
);

router.patch(
  '/:id/contacts/:contactId',
  requirePermission('clients', 'write'),
  validate(updateContactSchema),
  updateContact
);

router.delete(
  '/:id/contacts/:contactId',
  requirePermission('clients', 'write'),
  deleteContact
);

router.patch(
  '/:id/crm-profile',
  requirePermission('clients', 'write'),
  validate(updateCrmProfileSchema),
  updateCrmProfile
);

// --- Client notes sub-resource -------------------------------------------
router.get(
  '/:clientId/notes',
  requirePermission('clients', 'read'),
  listClientNotes
);

router.post(
  '/:clientId/notes',
  requirePermission('clients', 'write'),
  validate(createClientNoteSchema),
  createClientNote
);

router.patch(
  '/:clientId/notes/:noteId',
  requirePermission('clients', 'write'),
  validate(updateClientNoteSchema),
  updateClientNote
);

router.delete(
  '/:clientId/notes/:noteId',
  requirePermission('clients', 'write'),
  deleteClientNote
);

export default router;
