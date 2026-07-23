import mongoose from 'mongoose';
import { createLog } from '../activity-logs/activityLog.service';
import Application from '../applications/application.model';
import Candidate from '../candidates/candidate.model';
import Client from '../clients/client.model';
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
    primaryContact: String(profile?.primaryContact ?? ''),
    secondaryContact: String(profile?.secondaryContact ?? ''),
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
  page?: number;
  limit?: number;
}): Promise<{
  accounts: IClientAccount[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> => {
  const { page = 1, limit = 20 } = filters;
  const skip = (page - 1) * limit;

  // Only return clients that have a crmProfile (i.e., CRM-relevant clients)
  const [clients, total] = await Promise.all([
    Client.find({ crmProfile: { $ne: null } })
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit),
    Client.countDocuments({ crmProfile: { $ne: null } }),
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

  await createLog({
    action: 'crm_client_account_updated',
    resourceType: 'client',
    resourceId: clientId,
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
