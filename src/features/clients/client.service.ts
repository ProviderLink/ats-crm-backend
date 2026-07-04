import mongoose from 'mongoose';
import { AppError } from '../../shared/utils/AppError';
import { createLog } from '../activity-logs/activityLog.service';
import Job from '../jobs/job.model';
import Client from './client.model';
import type {
  ClientNote,
  CreateClientInput,
  CreateClientNoteInput,
  CreateContactInput,
  IClient,
  UpdateClientInput,
  UpdateClientNoteInput,
  UpdateContactInput,
} from './client.types';

export const getAllClients = async (filters: {
  status?: string;
  search?: string;
  page?: number;
  limit?: number;
}): Promise<{
  clients: IClient[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> => {
  const { status, search, page = 1, limit = 20 } = filters;
  const query: Record<string, unknown> = {};

  if (status !== undefined) query['status'] = status;
  if (search !== undefined) query['$text'] = { $search: search };

  const skip = (page - 1) * limit;
  const [clients, total] = await Promise.all([
    Client.find(query).skip(skip).limit(limit),
    Client.countDocuments(query),
  ]);

  return {
    clients: clients.map(c => c.toSafeObject()),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
};

export const getClientById = async (id: string): Promise<IClient> => {
  const client = await Client.findById(id);
  if (!client) throw new AppError(404, 'CLIENT_NOT_FOUND', 'Client not found');
  return client.toSafeObject();
};

export const createClient = async (
  input: CreateClientInput,
  createdBy?: string
): Promise<IClient> => {
  const existing = await Client.findOne({ email: input.email.toLowerCase() });
  if (existing) {
    throw new AppError(
      409,
      'CLIENT_ALREADY_EXISTS',
      'A client with this email already exists'
    );
  }

  const client = await Client.create({
    companyName: input.companyName,
    email: input.email,
    phone: input.phone ?? '',
    website: input.website ?? '',
    industry: input.industry ?? '',
    companySize: input.companySize ?? '1-10',
    description: input.description ?? '',
    address: input.address ?? {},
    createdBy: createdBy ? new mongoose.Types.ObjectId(createdBy) : null,
  });

  createLog({
    type: 'client_created',
    resourceType: 'client',
    resourceId: client._id.toString(),
    performedBy: createdBy ?? null,
  });

  return client.toSafeObject();
};

export const updateClient = async (
  id: string,
  input: UpdateClientInput,
  updatedBy?: string
): Promise<IClient> => {
  const client = await Client.findById(id);
  if (!client) throw new AppError(404, 'CLIENT_NOT_FOUND', 'Client not found');

  if (input.companyName !== undefined) client.companyName = input.companyName;
  if (input.email !== undefined) client.email = input.email;
  if (input.phone !== undefined) client.phone = input.phone;
  if (input.website !== undefined) client.website = input.website;
  if (input.logo !== undefined) client.logo = input.logo;
  if (input.industry !== undefined) client.industry = input.industry;
  if (input.companySize !== undefined) client.companySize = input.companySize;
  if (input.status !== undefined) client.status = input.status;
  if (input.description !== undefined) client.description = input.description;
  if (input.address !== undefined) {
    client.address = { ...client.address, ...input.address };
    client.markModified('address');
  }
  if (input.tags !== undefined) {
    client.tags = input.tags.map(id => new mongoose.Types.ObjectId(id));
    client.markModified('tags');
  }
  if (updatedBy) client.updatedBy = new mongoose.Types.ObjectId(updatedBy);

  await client.save();

  createLog({
    type: 'client_updated',
    resourceType: 'client',
    resourceId: id,
    performedBy: updatedBy ?? null,
  });

  return client.toSafeObject();
};

export const addContact = async (
  clientId: string,
  input: CreateContactInput,
  updatedBy?: string
): Promise<IClient> => {
  const client = await Client.findById(clientId);
  if (!client) throw new AppError(404, 'CLIENT_NOT_FOUND', 'Client not found');

  if (input.isPrimary) {
    client.contacts.forEach(c => {
      c.isPrimary = false;
    });
  }

  client.contacts.push({
    name: input.name,
    email: input.email,
    phone: input.phone ?? '',
    position: input.position ?? '',
    isPrimary: input.isPrimary ?? false,
  } as never);

  if (updatedBy) client.updatedBy = new mongoose.Types.ObjectId(updatedBy);

  await client.save();

  createLog({
    type: 'client_contact_added',
    resourceType: 'client',
    resourceId: clientId,
    metadata: { contactName: input.name, contactEmail: input.email },
    performedBy: updatedBy ?? null,
  });

  return client.toSafeObject();
};

export const updateContact = async (
  clientId: string,
  contactId: string,
  input: UpdateContactInput,
  updatedBy?: string
): Promise<IClient> => {
  const client = await Client.findById(clientId);
  if (!client) throw new AppError(404, 'CLIENT_NOT_FOUND', 'Client not found');

  const contact = client.contacts.find(c => String(c._id) === contactId);
  if (!contact) {
    throw new AppError(404, 'CONTACT_NOT_FOUND', 'Contact not found');
  }

  if (input.isPrimary) {
    client.contacts.forEach(c => {
      c.isPrimary = false;
    });
  }

  if (input.name !== undefined) contact.name = input.name;
  if (input.email !== undefined) contact.email = input.email;
  if (input.phone !== undefined) contact.phone = input.phone;
  if (input.position !== undefined) contact.position = input.position;
  if (input.isPrimary !== undefined) contact.isPrimary = input.isPrimary;

  if (updatedBy) client.updatedBy = new mongoose.Types.ObjectId(updatedBy);
  client.markModified('contacts');

  await client.save();

  createLog({
    type: 'client_contact_updated',
    resourceType: 'client',
    resourceId: clientId,
    metadata: { contactId },
    performedBy: updatedBy ?? null,
  });

  return client.toSafeObject();
};

export const removeContact = async (
  clientId: string,
  contactId: string,
  updatedBy?: string
): Promise<IClient> => {
  const client = await Client.findById(clientId);
  if (!client) throw new AppError(404, 'CLIENT_NOT_FOUND', 'Client not found');

  const index = client.contacts.findIndex(c => String(c._id) === contactId);
  if (index === -1) {
    throw new AppError(404, 'CONTACT_NOT_FOUND', 'Contact not found');
  }

  client.contacts.splice(index, 1);
  if (updatedBy) client.updatedBy = new mongoose.Types.ObjectId(updatedBy);

  await client.save();

  createLog({
    type: 'client_contact_removed',
    resourceType: 'client',
    resourceId: clientId,
    metadata: { contactId },
    performedBy: updatedBy ?? null,
  });

  return client.toSafeObject();
};

export const deleteClient = async (
  id: string
): Promise<{ deleted: boolean }> => {
  const client = await Client.findById(id);
  if (!client) throw new AppError(404, 'CLIENT_NOT_FOUND', 'Client not found');

  const activeJobs = await Job.countDocuments({
    clientId: id,
    status: { $in: ['open', 'on_hold'] },
  });
  if (activeJobs > 0) {
    throw new AppError(
      400,
      'CLIENT_HAS_ACTIVE_JOBS',
      'Cannot delete client with active jobs'
    );
  }

  await Client.findByIdAndDelete(id);

  createLog({
    type: 'client_deleted',
    resourceType: 'client',
    resourceId: id,
  });

  return { deleted: true };
};

export const updateCrmProfile = async (
  clientId: string,
  input: Partial<{
    healthStatus: string;
    baaSign: boolean;
    baaSignedDate: Date | null;
    emrSystem: string;
    onboardingComplete: boolean;
    sopReceived: boolean;
    satisfactionScore: number;
    openIssuesCount: number;
    lastClientCheckin: Date | null;
    notes: string;
  }>,
  updatedBy?: string
): Promise<IClient> => {
  const client = await Client.findById(clientId);
  if (!client) throw new AppError(404, 'CLIENT_NOT_FOUND', 'Client not found');

  if (!client.crmProfile) {
    client.crmProfile = {
      healthStatus: 'green',
      baaSign: false,
      baaSignedDate: null,
      emrSystem: '',
      onboardingComplete: false,
      sopReceived: false,
      satisfactionScore: null as unknown as number,
      openIssuesCount: 0,
      lastClientCheckin: null,
      notes: '',
    };
  }

  const profile = client.crmProfile;
  if (input.healthStatus !== undefined)
    profile.healthStatus = input.healthStatus;
  if (input.baaSign !== undefined) profile.baaSign = input.baaSign;
  if (input.baaSignedDate !== undefined)
    profile.baaSignedDate = input.baaSignedDate;
  if (input.emrSystem !== undefined) profile.emrSystem = input.emrSystem;
  if (input.onboardingComplete !== undefined)
    profile.onboardingComplete = input.onboardingComplete;
  if (input.sopReceived !== undefined) profile.sopReceived = input.sopReceived;
  if (input.satisfactionScore !== undefined)
    profile.satisfactionScore = input.satisfactionScore;
  if (input.openIssuesCount !== undefined)
    profile.openIssuesCount = input.openIssuesCount;
  if (input.lastClientCheckin !== undefined)
    profile.lastClientCheckin = input.lastClientCheckin;
  if (input.notes !== undefined) profile.notes = input.notes;

  client.markModified('crmProfile');
  if (updatedBy) client.updatedBy = new mongoose.Types.ObjectId(updatedBy);

  await client.save();

  createLog({
    type: 'client_crm_profile_updated',
    resourceType: 'client',
    resourceId: clientId,
    performedBy: updatedBy ?? null,
  });

  return client.toSafeObject();
};

// ---------------------------------------------------------------------------
// Client notes sub-resource
// ---------------------------------------------------------------------------

export const listNotes = async (clientId: string): Promise<ClientNote[]> => {
  const client = await Client.findById(clientId);
  if (!client) throw new AppError(404, 'CLIENT_NOT_FOUND', 'Client not found');
  const notes = client.toSafeObject().notes ?? [];
  // Newest first
  return [...notes].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
};

export const addNote = async (
  clientId: string,
  input: CreateClientNoteInput,
  authorId?: string
): Promise<ClientNote> => {
  const client = await Client.findById(clientId);
  if (!client) throw new AppError(404, 'CLIENT_NOT_FOUND', 'Client not found');

  const note = client.notes.create({
    method: input.method,
    content: input.content,
    author: authorId ? new mongoose.Types.ObjectId(authorId) : null,
  } as never);
  client.notes.push(note);

  if (authorId) client.updatedBy = new mongoose.Types.ObjectId(authorId);
  await client.save();

  createLog({
    type: 'client_note_added',
    resourceType: 'client',
    resourceId: clientId,
    metadata: { method: input.method },
    performedBy: authorId ?? null,
  });

  const saved = note as unknown as ClientNote & {
    _id: mongoose.Types.ObjectId;
    author: mongoose.Types.ObjectId | null;
  };
  return {
    _id: String(saved._id),
    method: saved.method,
    content: saved.content,
    author: saved.author ? String(saved.author) : null,
    createdAt: saved.createdAt,
    updatedAt: saved.updatedAt,
  };
};

export const updateNote = async (
  clientId: string,
  noteId: string,
  input: UpdateClientNoteInput,
  updatedBy?: string
): Promise<ClientNote> => {
  const client = await Client.findById(clientId);
  if (!client) throw new AppError(404, 'CLIENT_NOT_FOUND', 'Client not found');

  const note = client.notes.find(n => String(n._id) === noteId);
  if (!note) throw new AppError(404, 'NOTE_NOT_FOUND', 'Note not found');

  if (input.method !== undefined) note.method = input.method;
  if (input.content !== undefined) note.content = input.content;

  if (updatedBy) client.updatedBy = new mongoose.Types.ObjectId(updatedBy);
  client.markModified('notes');
  await client.save();

  createLog({
    type: 'client_note_updated',
    resourceType: 'client',
    resourceId: clientId,
    metadata: { noteId },
    performedBy: updatedBy ?? null,
  });

  return {
    _id: String(note._id),
    method: note.method,
    content: note.content,
    author: note.author ? String(note.author) : null,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
};

export const deleteNote = async (
  clientId: string,
  noteId: string,
  updatedBy?: string
): Promise<{ deleted: boolean }> => {
  const client = await Client.findById(clientId);
  if (!client) throw new AppError(404, 'CLIENT_NOT_FOUND', 'Client not found');

  const index = client.notes.findIndex(n => String(n._id) === noteId);
  if (index === -1) {
    throw new AppError(404, 'NOTE_NOT_FOUND', 'Note not found');
  }

  client.notes.splice(index, 1);
  if (updatedBy) client.updatedBy = new mongoose.Types.ObjectId(updatedBy);
  await client.save();

  createLog({
    type: 'client_note_deleted',
    resourceType: 'client',
    resourceId: clientId,
    metadata: { noteId },
    performedBy: updatedBy ?? null,
  });

  return { deleted: true };
};
