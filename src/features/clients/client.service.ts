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
    tags: input.tags?.map(id => new mongoose.Types.ObjectId(id)) ?? [],
    createdBy: createdBy ? new mongoose.Types.ObjectId(createdBy) : null,
  });

  createLog({
    action: 'created',
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

  const changes: string[] = [];

  if (
    input.companyName !== undefined &&
    input.companyName !== client.companyName
  ) {
    changes.push(
      `Company name changed from "${client.companyName}" to "${input.companyName}"`
    );
    client.companyName = input.companyName;
  } else if (input.companyName !== undefined) {
    client.companyName = input.companyName;
  }
  if (input.email !== undefined && input.email !== client.email) {
    changes.push(`Email changed from "${client.email}" to "${input.email}"`);
    client.email = input.email;
  } else if (input.email !== undefined) {
    client.email = input.email;
  }
  if (input.phone !== undefined && input.phone !== client.phone) {
    changes.push('Phone number updated');
    client.phone = input.phone;
  } else if (input.phone !== undefined) {
    client.phone = input.phone;
  }
  if (input.website !== undefined && input.website !== client.website) {
    changes.push('Website updated');
    client.website = input.website;
  } else if (input.website !== undefined) {
    client.website = input.website;
  }
  if (input.logo !== undefined) {
    changes.push('Logo updated');
    client.logo = input.logo;
  }
  if (input.industry !== undefined && input.industry !== client.industry) {
    changes.push(
      `Industry changed from "${client.industry}" to "${input.industry}"`
    );
    client.industry = input.industry;
  } else if (input.industry !== undefined) {
    client.industry = input.industry;
  }
  if (
    input.companySize !== undefined &&
    input.companySize !== client.companySize
  ) {
    changes.push(
      `Company size changed from "${client.companySize}" to "${input.companySize}"`
    );
    client.companySize = input.companySize;
  } else if (input.companySize !== undefined) {
    client.companySize = input.companySize;
  }
  if (input.status !== undefined && input.status !== client.status) {
    changes.push(`Status changed from "${client.status}" to "${input.status}"`);
    client.status = input.status;
  } else if (input.status !== undefined) {
    client.status = input.status;
  }
  if (
    input.description !== undefined &&
    input.description !== client.description
  ) {
    changes.push('Description updated');
    client.description = input.description;
  } else if (input.description !== undefined) {
    client.description = input.description;
  }
  if (input.address !== undefined) {
    changes.push('Address updated');
    client.address = { ...client.address, ...input.address };
    client.markModified('address');
  }
  if (input.tags !== undefined) {
    changes.push('Tags updated');
    client.tags = input.tags.map(id => new mongoose.Types.ObjectId(id));
    client.markModified('tags');
  }
  if (updatedBy) client.updatedBy = new mongoose.Types.ObjectId(updatedBy);

  await client.save();

  createLog({
    action: 'updated',
    resourceType: 'client',
    resourceId: id,
    metadata: changes.length > 0 ? { changes } : {},
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
    action: 'contact_added',
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

  const changes: string[] = [];
  const contactNameBefore = contact.name;

  if (input.isPrimary) {
    client.contacts.forEach(c => {
      c.isPrimary = false;
    });
  }

  if (input.name !== undefined && input.name !== contact.name) {
    changes.push(`Name changed from "${contact.name}" to "${input.name}"`);
    contact.name = input.name;
  } else if (input.name !== undefined) {
    contact.name = input.name;
  }
  if (input.email !== undefined && input.email !== contact.email) {
    changes.push(`Email changed from "${contact.email}" to "${input.email}"`);
    contact.email = input.email;
  } else if (input.email !== undefined) {
    contact.email = input.email;
  }
  if (input.phone !== undefined && input.phone !== contact.phone) {
    changes.push('Phone number updated');
    contact.phone = input.phone;
  } else if (input.phone !== undefined) {
    contact.phone = input.phone;
  }
  if (input.position !== undefined && input.position !== contact.position) {
    changes.push(
      `Position changed from "${contact.position}" to "${input.position}"`
    );
    contact.position = input.position;
  } else if (input.position !== undefined) {
    contact.position = input.position;
  }
  if (input.isPrimary !== undefined && input.isPrimary !== contact.isPrimary) {
    changes.push(
      input.isPrimary ? 'Set as primary contact' : 'Removed as primary contact'
    );
    contact.isPrimary = input.isPrimary;
  } else if (input.isPrimary !== undefined) {
    contact.isPrimary = input.isPrimary;
  }

  if (updatedBy) client.updatedBy = new mongoose.Types.ObjectId(updatedBy);
  client.markModified('contacts');

  await client.save();

  createLog({
    action: 'contact_updated',
    resourceType: 'client',
    resourceId: clientId,
    metadata: { contactName: contactNameBefore, contactId, changes },
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
    action: 'contact_removed',
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
    action: 'deleted',
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
  const changes: string[] = [];

  if (
    input.healthStatus !== undefined &&
    input.healthStatus !== profile.healthStatus
  ) {
    changes.push(
      `Health status changed from "${profile.healthStatus}" to "${input.healthStatus}"`
    );
    profile.healthStatus = input.healthStatus;
  } else if (input.healthStatus !== undefined) {
    profile.healthStatus = input.healthStatus;
  }
  if (input.baaSign !== undefined && input.baaSign !== profile.baaSign) {
    changes.push(
      input.baaSign ? 'BAA marked as signed' : 'BAA marked as unsigned'
    );
    profile.baaSign = input.baaSign;
  } else if (input.baaSign !== undefined) {
    profile.baaSign = input.baaSign;
  }
  if (input.baaSignedDate !== undefined) {
    changes.push(
      input.baaSignedDate
        ? 'BAA signed date updated'
        : 'BAA signed date cleared'
    );
    profile.baaSignedDate = input.baaSignedDate;
  }
  if (input.emrSystem !== undefined && input.emrSystem !== profile.emrSystem) {
    changes.push(
      `EMR system changed from "${profile.emrSystem}" to "${input.emrSystem}"`
    );
    profile.emrSystem = input.emrSystem;
  } else if (input.emrSystem !== undefined) {
    profile.emrSystem = input.emrSystem;
  }
  if (
    input.onboardingComplete !== undefined &&
    input.onboardingComplete !== profile.onboardingComplete
  ) {
    changes.push(
      `Onboarding ${input.onboardingComplete ? 'marked complete' : 'marked incomplete'}`
    );
    profile.onboardingComplete = input.onboardingComplete;
  } else if (input.onboardingComplete !== undefined) {
    profile.onboardingComplete = input.onboardingComplete;
  }
  if (
    input.sopReceived !== undefined &&
    input.sopReceived !== profile.sopReceived
  ) {
    changes.push(
      `SOP ${input.sopReceived ? 'marked as received' : 'marked as not received'}`
    );
    profile.sopReceived = input.sopReceived;
  } else if (input.sopReceived !== undefined) {
    profile.sopReceived = input.sopReceived;
  }
  if (
    input.satisfactionScore !== undefined &&
    input.satisfactionScore !== profile.satisfactionScore
  ) {
    changes.push(`Satisfaction score updated to ${input.satisfactionScore}`);
    profile.satisfactionScore = input.satisfactionScore;
  } else if (input.satisfactionScore !== undefined) {
    profile.satisfactionScore = input.satisfactionScore;
  }
  if (
    input.openIssuesCount !== undefined &&
    input.openIssuesCount !== profile.openIssuesCount
  ) {
    changes.push(
      `Open issues count changed from ${profile.openIssuesCount} to ${input.openIssuesCount}`
    );
    profile.openIssuesCount = input.openIssuesCount;
  } else if (input.openIssuesCount !== undefined) {
    profile.openIssuesCount = input.openIssuesCount;
  }
  if (input.lastClientCheckin !== undefined) {
    changes.push('Last client check-in date updated');
    profile.lastClientCheckin = input.lastClientCheckin;
  }
  if (input.notes !== undefined) {
    changes.push('CRM notes updated');
    profile.notes = input.notes;
  }

  client.markModified('crmProfile');
  if (updatedBy) client.updatedBy = new mongoose.Types.ObjectId(updatedBy);

  await client.save();

  createLog({
    action: 'crm_profile_updated',
    resourceType: 'client',
    resourceId: clientId,
    metadata: changes.length > 0 ? { changes } : {},
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
    action: 'note_added',
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
    action: 'note_updated',
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
    action: 'note_deleted',
    resourceType: 'client',
    resourceId: clientId,
    metadata: { noteId },
    performedBy: updatedBy ?? null,
  });

  return { deleted: true };
};
