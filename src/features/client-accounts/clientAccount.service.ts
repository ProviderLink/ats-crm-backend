import mongoose from 'mongoose';
import { createLog } from '../activity-logs/activityLog.service';
import Client from '../clients/client.model';
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
