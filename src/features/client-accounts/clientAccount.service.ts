import mongoose from 'mongoose';
import { createLog } from '../activity-logs/activityLog.service';
import Application from '../applications/application.model';
import Candidate from '../candidates/candidate.model';
import Client from '../clients/client.model';
import { addNote, listNotes } from '../clients/client.service';
import type { ClientNote, CreateClientNoteInput } from '../clients/client.types';
import User from '../users/user.model';
import type {
  IClientAccount,
  UpdateClientAccountInput,
} from './clientAccount.types';

function toClientAccount(client: any): IClientAccount | null {
  if (!client) return null;
  const raw = client.toObject
    ? (client.toObject({ versionKey: false }) as Record<string, unknown>)
    : (client as Record<string, unknown>);
  const profile = raw['crmProfile'] as Record<string, unknown> | null;

  const contacts = (raw['contacts'] as Array<Record<string, unknown>>) ?? [];
  const primaryAtsCt = contacts.find(c => c['isPrimary']) ?? contacts[0] ?? null;
  const secondaryAtsCt = contacts.find(c => !c['isPrimary'] && c !== primaryAtsCt) ?? null;

  return {
    id: String(raw['_id']),
    clientId: String(raw['_id']),
    companyName: String(raw['companyName'] ?? ''),
    accountOwnerId: profile?.accountOwnerId
      ? String(profile.accountOwnerId)
      : null,
    serviceStartDate: (profile?.serviceStartDate as Date) ?? null,
    emrSystem: String(profile?.emrSystem ?? ''),
    baaSigned: Boolean(profile?.baaSign ?? false),
    baaSignedDate: (profile?.baaSignedDate as Date) ?? null,
    onboardingComplete: Boolean(profile?.onboardingComplete ?? false),
    sopReceived: Boolean(profile?.sopReceived ?? false),
    primaryContact: String(profile?.primaryContact || primaryAtsCt?.['name'] || ''),
    primaryContactEmail: String(primaryAtsCt?.['email'] ?? ''),
    primaryContactPhone: String(primaryAtsCt?.['phone'] ?? ''),
    secondaryContact: String(profile?.secondaryContact || secondaryAtsCt?.['name'] || ''),
    secondaryContactEmail: String(secondaryAtsCt?.['email'] ?? ''),
    secondaryContactPhone: String(secondaryAtsCt?.['phone'] ?? ''),
    lastClientCheckin: (profile?.lastClientCheckin as Date) ?? null,
    satisfactionScore: (profile?.satisfactionScore as number) ?? null,
    healthStatus: String(profile?.healthStatus ?? 'green'),
    openIssuesCount: Number(profile?.openIssuesCount ?? 0),
    notes: String(profile?.notes ?? ''),
    createdAt: raw['createdAt'] as Date,
    updatedAt: raw['updatedAt'] as Date,
  };
}

export const getProvisionedClients = async (): Promise<
  { clientId: string; companyName: string }[]
> => {
  // Find all CRM client users that are linked to an ATS client record
  const clientUsers = await User.find({
    roles: 'client',
    clientRef: { $ne: null },
    isActive: true,
  }).select('clientRef');

  const clientRefIds = [
    ...new Set(clientUsers.map(u => String(u.clientRef))),
  ].filter(Boolean);

  if (clientRefIds.length === 0) return [];

  const clients = await Client.find({
    _id: { $in: clientRefIds.map(id => new mongoose.Types.ObjectId(id)) },
  }).select('_id companyName');

  return clients.map(c => ({
    clientId: String(c._id),
    companyName: String((c as any).companyName ?? ''),
  }));
};

export const getAllClientAccounts = async (filters: {
  /** Extra Mongo conditions, e.g. an account manager's managed clients. */
  scope?: Record<string, unknown>;
  page?: number;
  limit?: number;
}): Promise<{
  accounts: IClientAccount[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> => {
  const { scope = {}, page = 1, limit = 20 } = filters;
  const skip = (page - 1) * limit;
  const query = { crmProfile: { $ne: null }, ...scope };

  // Only return clients that have a crmProfile (i.e., CRM-relevant clients)
  const [clients, total] = await Promise.all([
    Client.find(query)
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit),
    Client.countDocuments(query),
  ]);

  return {
    accounts: clients
      .map(c => toClientAccount(c))
      .filter(Boolean) as IClientAccount[],
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
};

export const getClientAccountById = async (
  id: string
): Promise<IClientAccount> => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new Error('CLIENT_NOT_FOUND');
  }
  const client = await Client.findById(id);
  if (!client) throw new Error('CLIENT_NOT_FOUND');
  const account = toClientAccount(client);
  if (!account) throw new Error('CLIENT_NOT_FOUND');
  return account;
};

export const updateClientAccount = async (
  clientId: string,
  input: UpdateClientAccountInput,
  updatedBy?: string
): Promise<IClientAccount> => {
  const client = await Client.findById(clientId);
  if (!client) throw new Error('CLIENT_NOT_FOUND');

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
      accountOwnerId: null,
      serviceStartDate: null,
      primaryContact: '',
      secondaryContact: '',
    };
  }

  const profile = client.crmProfile;

  if (input.healthStatus !== undefined)
    profile.healthStatus = input.healthStatus;
  if (input.baaSigned !== undefined) profile.baaSign = input.baaSigned;
  if (input.baaSignedDate !== undefined)
    profile.baaSignedDate = input.baaSignedDate
      ? new Date(input.baaSignedDate)
      : null;
  if (input.emrSystem !== undefined) profile.emrSystem = input.emrSystem;
  if (input.onboardingComplete !== undefined)
    profile.onboardingComplete = input.onboardingComplete;
  if (input.sopReceived !== undefined) profile.sopReceived = input.sopReceived;
  if (input.satisfactionScore !== undefined)
    profile.satisfactionScore = input.satisfactionScore;
  if (input.openIssuesCount !== undefined)
    profile.openIssuesCount = input.openIssuesCount;
  if (input.lastClientCheckin !== undefined)
    profile.lastClientCheckin = input.lastClientCheckin
      ? new Date(input.lastClientCheckin)
      : null;
  if (input.notes !== undefined) profile.notes = input.notes;
  if (input.accountOwnerId !== undefined)
    profile.accountOwnerId =
      input.accountOwnerId !== null
        ? (new mongoose.Types.ObjectId(input.accountOwnerId) as any)
        : null;
  if (input.serviceStartDate !== undefined)
    profile.serviceStartDate = input.serviceStartDate
      ? new Date(input.serviceStartDate)
      : null;
  if (input.primaryContact !== undefined)
    profile.primaryContact = input.primaryContact;
  if (input.secondaryContact !== undefined)
    profile.secondaryContact = input.secondaryContact;

  client.markModified('crmProfile');
  if (updatedBy) client.updatedBy = new mongoose.Types.ObjectId(updatedBy);
  await client.save();

  const FIELD_LABELS: Record<string, string> = {
    healthStatus: 'Health status',
    baaSigned: 'BAA signed',
    baaSignedDate: 'BAA signed date',
    emrSystem: 'EMR system',
    onboardingComplete: 'Onboarding',
    sopReceived: 'SOP received',
    satisfactionScore: 'Satisfaction score',
    openIssuesCount: 'Open issues',
    lastClientCheckin: 'Last check-in',
    notes: 'Notes',
    accountOwnerId: 'Account owner',
    serviceStartDate: 'Service start date',
    primaryContact: 'Primary contact',
    secondaryContact: 'Secondary contact',
  };
  const changes = Object.keys(input)
    .filter(key => (input as Record<string, unknown>)[key] !== undefined)
    .map(key => `${FIELD_LABELS[key] ?? key} updated`);

  await createLog({
    action: 'crm_client_account_updated',
    resourceType: 'client',
    resourceId: clientId,
    metadata: changes.length > 0 ? { changes } : {},
    performedBy: updatedBy ?? null,
  });

  return toClientAccount(client)!;
};

export const getHiredVasForClient = async (
  clientId: string
): Promise<{ id: string; firstName: string; lastName: string }[]> => {
  if (!mongoose.Types.ObjectId.isValid(clientId)) return [];

  const candidateIds = await Application.find({
    clientId: new mongoose.Types.ObjectId(clientId),
    phase: 'hired',
  }).distinct('candidateId');

  if (candidateIds.length === 0) return [];

  const candidates = await Candidate.find({
    _id: { $in: candidateIds },
  }).select('_id firstName lastName');

  return candidates.map(c => ({
    id: String(c._id),
    firstName: String((c as any).firstName ?? ''),
    lastName: String((c as any).lastName ?? ''),
  }));
};

type NoteWithAuthor = ClientNote & { authorName: string };

/** Looks up the display name of each note author, so the thread can show it. */
async function authorNames(
  authorIds: Array<string | null | undefined>
): Promise<Record<string, string>> {
  const ids = [...new Set(authorIds.filter((a): a is string => !!a))];
  if (ids.length === 0) return {};
  const docs = await User.find({ _id: { $in: ids } }).select(
    'firstName lastName'
  );
  return Object.fromEntries(
    docs.map(u => [
      String(u._id),
      `${(u as any).firstName ?? ''} ${(u as any).lastName ?? ''}`.trim(),
    ])
  );
}

/** A client's internal notes thread, each note with its author's name. */
export const listClientNotes = async (
  clientId: string
): Promise<NoteWithAuthor[]> => {
  const notes = await listNotes(clientId);
  const names = await authorNames(notes.map(n => n.author));
  return notes.map(n => ({
    ...n,
    authorName: n.author ? (names[n.author] ?? '') : '',
  }));
};

export const addClientNote = async (
  clientId: string,
  input: CreateClientNoteInput,
  authorId: string
): Promise<NoteWithAuthor> => {
  const note = await addNote(clientId, input, authorId);
  const names = await authorNames([authorId]);
  return { ...note, authorName: names[authorId] ?? '' };
};
