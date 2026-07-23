import mongoose from 'mongoose';
import { createLog } from '../activity-logs/activityLog.service';
import VaProfile from './vaProfile.model';
import type { IVaProfile, UpdateVaProfileInput } from './vaProfile.types';

export const getAllVaProfiles = async (filters: {
  page?: number;
  limit?: number;
}): Promise<{
  profiles: IVaProfile[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> => {
  const { page = 1, limit = 20 } = filters;
  const skip = (page - 1) * limit;

  const [profiles, total] = await Promise.all([
    VaProfile.find().sort({ updatedAt: -1 }).skip(skip).limit(limit),
    VaProfile.countDocuments(),
  ]);

  return {
    profiles: profiles.map(p => p.toSafeObject()),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
};

export const getVaProfileById = async (id: string): Promise<IVaProfile> => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new Error('VA_PROFILE_NOT_FOUND');
  }
  const profile = await VaProfile.findOne({ vaId: id });
  if (profile) return profile.toSafeObject();

  // Auto-create with defaults so the sheet always has a profile to display
  const created = await VaProfile.create({
    vaId: new mongoose.Types.ObjectId(id),
    workloadLevel: 'normal',
    satisfactionScore: null,
    burnoutRiskFlag: false,
    replacementRiskFlag: false,
    lastVaCheckin: null,
    notes: '',
  });
  return created.toSafeObject();
};

export const upsertVaProfile = async (
  vaId: string,
  input: UpdateVaProfileInput,
  updatedBy?: string
): Promise<IVaProfile> => {
  const update: Record<string, unknown> = {};
  if (input.workloadLevel !== undefined)
    update['workloadLevel'] = input.workloadLevel;
  if (input.satisfactionScore !== undefined)
    update['satisfactionScore'] = input.satisfactionScore;
  if (input.burnoutRiskFlag !== undefined)
    update['burnoutRiskFlag'] = input.burnoutRiskFlag;
  if (input.replacementRiskFlag !== undefined)
    update['replacementRiskFlag'] = input.replacementRiskFlag;
  if (input.lastVaCheckin !== undefined)
    update['lastVaCheckin'] = input.lastVaCheckin
      ? new Date(input.lastVaCheckin)
      : null;
  if (input.notes !== undefined) update['notes'] = input.notes;

  const profile = await VaProfile.findOneAndUpdate(
    { vaId: new mongoose.Types.ObjectId(vaId) },
    { $set: update },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  await createLog({
    action: 'va_profile_updated',
    resourceType: 'vaProfile',
    resourceId: profile._id.toString(),
    metadata: { vaId, fields: Object.keys(update) },
    performedBy: updatedBy ?? null,
  });

  return profile.toSafeObject();
};
