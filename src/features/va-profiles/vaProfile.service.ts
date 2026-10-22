import mongoose from 'mongoose';
import AppError from '../../shared/utils/AppError';
import { createLog } from '../activity-logs/activityLog.service';
import User from '../users/user.model';
import VaProfile from './vaProfile.model';
import type {
  CreateVaNoteInput,
  IVaNote,
  IVaProfile,
  UpdateVaProfileInput,
} from './vaProfile.types';

export const getAllVaProfiles = async (filters: {
  /** Extra Mongo conditions, e.g. an account manager's managed VAs. */
  scope?: Record<string, unknown>;
  page?: number;
  limit?: number;
}): Promise<{
  profiles: IVaProfile[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> => {
  const { scope = {}, page = 1, limit = 20 } = filters;
  const skip = (page - 1) * limit;

  const [profiles, total] = await Promise.all([
    VaProfile.find(scope).sort({ updatedAt: -1 }).skip(skip).limit(limit),
    VaProfile.countDocuments(scope),
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

// ---------------------------------------------------------------------------
// Admin internal notes thread (Requirement 4)
// ---------------------------------------------------------------------------

/**
 * Ensure a VaProfile exists for the given vaId (Candidate _id), creating one
 * with defaults if missing. Mirrors getVaProfileById's auto-create behavior so
 * the notes sub-resource can be used on VAs that have never been opened.
 */
const ensureVaProfile = async (vaId: string) => {
  if (!mongoose.Types.ObjectId.isValid(vaId)) {
    throw new AppError(404, 'VA_PROFILE_NOT_FOUND', 'VA profile not found');
  }
  let profile = await VaProfile.findOne({
    vaId: new mongoose.Types.ObjectId(vaId),
  });
  if (!profile) {
    profile = await VaProfile.create({
      vaId: new mongoose.Types.ObjectId(vaId),
      workloadLevel: 'normal',
      satisfactionScore: null,
      burnoutRiskFlag: false,
      replacementRiskFlag: false,
      lastVaCheckin: null,
      notes: '',
    });
  }
  return profile;
};

/**
 * List admin notes for a VA, oldest-first (continuous chronological thread).
 * Enriches each note with `authorName` from the User collection.
 */
export const listVaNotes = async (
  vaId: string
): Promise<(IVaNote & { authorName?: string })[]> => {
  const profile = await ensureVaProfile(vaId);
  const notes = profile.toSafeObject().noteThread ?? [];
  const oldestFirst = [...notes].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  const authorIds = [
    ...new Set(
      oldestFirst
        .map(n => n.author)
        .filter((a): a is string => a !== null && a !== undefined)
    ),
  ];
  const authorDocs =
    authorIds.length > 0
      ? await User.find({ _id: { $in: authorIds } }).select(
          'firstName lastName'
        )
      : [];
  const authorNameMap: Record<string, string> = Object.fromEntries(
    authorDocs.map(u => [
      String(u._id),
      `${(u as any).firstName ?? ''} ${(u as any).lastName ?? ''}`.trim(),
    ])
  );

  return oldestFirst.map(n => ({
    ...n,
    authorName: n.author ? (authorNameMap[n.author] ?? '') : '',
  }));
};

/**
 * Append an admin note to a VA's thread. Hidden fields are left untouched.
 */
export const addVaNote = async (
  vaId: string,
  input: CreateVaNoteInput,
  authorId?: string
): Promise<IVaNote & { authorName?: string }> => {
  const profile = await ensureVaProfile(vaId);

  const note = {
    method: input.method,
    content: input.content,
    author: authorId ? new mongoose.Types.ObjectId(authorId) : null,
  } as IVaNote;
  profile.noteThread.push(note as any);
  await profile.save();

  await createLog({
    action: 'note_added',
    resourceType: 'vaProfile',
    resourceId: profile._id.toString(),
    metadata: { vaId, method: input.method },
    performedBy: authorId ?? null,
  });

  const saved = note as unknown as IVaNote & {
    _id: mongoose.Types.ObjectId;
    author: mongoose.Types.ObjectId | null;
  };
  let authorName = '';
  if (authorId) {
    const authorDoc =
      await User.findById(authorId).select('firstName lastName');
    if (authorDoc) {
      authorName = `${(authorDoc as any).firstName ?? ''} ${
        (authorDoc as any).lastName ?? ''
      }`.trim();
    }
  }
  return {
    _id: String(saved._id),
    method: saved.method,
    content: saved.content,
    author: saved.author ? String(saved.author) : null,
    createdAt: saved.createdAt,
    updatedAt: saved.updatedAt,
    authorName,
  };
};
