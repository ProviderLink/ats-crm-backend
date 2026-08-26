import { connectDB } from '../config/db';
import '../config/env';
import User from '../features/users/user.model';
import { buildPermissionsForRoles } from '../features/users/user.service';
import type { UserRole } from '../features/users/user.types';
import logger from '../shared/utils/logger';

/**
 * One-time migration: recompute every user's `permissions` from their roles.
 *
 * Background: ATS roles (hiring_manager, recruiter, coordinator, interviewer)
 * gained `team.read` (to populate the interviewer dropdown) and
 * `interviewScorecards` (to create interview scorecards). `permissions` is
 * baked into each user document (and the JWT), so pre-existing users won't
 * pick up the new grants unless their stored permissions are recomputed.
 *
 * Strategy — additive & safe:
 *   merged = { ...buildPermissionsForRoles(roles), ...stored }
 * The freshly computed base adds the new resources; the stored values overlay
 * on top so any manual overrides made via the permissions UI are preserved.
 *
 * Idempotent — safe to re-run.
 */
async function run(): Promise<void> {
  await connectDB();
  logger.info('Starting user permissions migration...');

  const users = await User.find({});
  let updated = 0;

  for (const user of users) {
    const roles = (user.roles ?? []) as UserRole[];
    if (roles.length === 0) continue;

    const base = buildPermissionsForRoles(roles);
    const stored = JSON.parse(JSON.stringify(user.permissions ?? {})) as Record<
      string,
      unknown
    >;

    user.permissions = { ...base, ...stored } as typeof user.permissions;
    user.markModified('permissions');
    await user.save();
    updated++;
  }

  logger.info(`User permissions migrated: ${updated} users`);
  process.exit(0);
}

run().catch(err => {
  logger.error('User permissions migration failed', err);
  process.exit(1);
});
