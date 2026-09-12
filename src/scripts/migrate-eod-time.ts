/**
 * Migrate EOD submissions to the company business-day model.
 *
 * Background: `date` used to be stored as UTC midnight of a calendar day, which
 * meant "the day" was ambiguous for virtual assistants working outside the
 * company timezone. The model now stores three coherent fields:
 *
 *   date          → UTC instant at which the company day started
 *   dateKey       → 'YYYY-MM-DD' company business day (the field filters use)
 *   dateTimezone  → IANA timezone that defined the key (audit)
 *
 * This script also drops the old `{ assignmentId, date }` unique index and
 * creates the new `{ assignmentId, dateKey }` one, which Mongoose will not do on
 * its own.
 *
 * Safe to run multiple times.
 *
 * Usage:
 *   pnpm migrate:eod-time            # dry run (reports what would change)
 *   pnpm migrate:eod-time --apply    # apply
 */

import mongoose from 'mongoose';
import { connectDB } from '../config/db';
import '../config/env';
import EodSubmission from '../features/eod-submissions/eodSubmission.model';
import {
  clearCompanyTimezoneCache,
  getCompanyTimezone,
} from '../shared/utils/companyTimezone';
import logger from '../shared/utils/logger';
import {
  DEFAULT_TIMEZONE,
  getDayRangeForDateKey,
} from '../shared/utils/timezone';

const APPLY = process.argv.includes('--apply');

/** Index names may differ per environment; match on the key pattern instead. */
const OLD_UNIQUE_KEYS = { assignmentId: 1, date: 1 };
const NEW_UNIQUE_KEYS = { assignmentId: 1, dateKey: 1 };

async function run(): Promise<void> {
  await connectDB();

  const timezone = await getCompanyTimezone();
  logger.info(
    `EOD time migration — mode: ${APPLY ? 'APPLY' : 'DRY RUN'}, company timezone: ${timezone}`
  );

  const collection = EodSubmission.collection;

  // 1. Drop the legacy unique index (if still present).
  const indexes = await collection.indexes();
  const oldUnique = indexes.find(
    idx =>
      idx.unique === true &&
      idx.key &&
      JSON.stringify(idx.key) === JSON.stringify(OLD_UNIQUE_KEYS)
  );

  if (oldUnique) {
    const name = oldUnique.name ?? 'assignmentId_1_date_1';
    logger.info(`Dropping legacy unique index "${name}"`);
    if (APPLY) await collection.dropIndex(name);
  } else {
    logger.info(
      'Legacy { assignmentId, date } unique index not found — skipping'
    );
  }

  // 2. Backfill `dateKey` / `dateTimezone` and normalise `date` to the company
  //    day start. Pre-migration rows have `date` at UTC midnight; reinterpreting
  //    that calendar day in the company timezone gives the correct instant.
  const cursor = EodSubmission.find({
    $or: [{ dateKey: { $exists: false } }, { dateKey: null }],
  }).cursor();

  let scanned = 0;
  let updated = 0;
  const conflicts: string[] = [];

  for await (const doc of cursor) {
    scanned += 1;

    const legacyDate = doc.date as unknown as Date;
    if (!(legacyDate instanceof Date) || Number.isNaN(legacyDate.getTime())) {
      logger.warn(`Skipping EOD ${String(doc._id)} — unusable date value`);
      continue;
    }

    // The stored UTC midnight names the calendar day the sheet was filled for.
    const dateKey = legacyDate.toISOString().slice(0, 10);
    const { start } = getDayRangeForDateKey(dateKey, timezone);
    const clash = await EodSubmission.findOne({
      _id: { $ne: doc._id },
      assignmentId: doc.assignmentId,
      dateKey,
    });
    if (clash) {
      conflicts.push(
        `${String(doc._id)} duplicates ${String(clash._id)} on ${dateKey}`
      );
      continue;
    }

    updated += 1;
    if (APPLY) {
      await collection.updateOne(
        { _id: doc._id },
        {
          $set: {
            date: start,
            dateKey,
            dateTimezone: timezone || DEFAULT_TIMEZONE,
          },
        }
      );
    }
  }

  // 3. Ensure the new unique index exists.
  if (APPLY) {
    logger.info('Ensuring { assignmentId, dateKey } unique index');
    await collection.createIndex(NEW_UNIQUE_KEYS, { unique: true });
  }

  logger.info(
    `EOD time migration finished — scanned: ${scanned}, ${APPLY ? 'updated' : 'would update'}: ${updated}, conflicts: ${conflicts.length}`
  );

  if (conflicts.length > 0) {
    logger.warn(
      'Conflicting submissions left untouched (resolve manually, then re-run):'
    );
    for (const c of conflicts) logger.warn(`  - ${c}`);
  }

  clearCompanyTimezoneCache();
  await mongoose.disconnect();
}

run().catch(error => {
  logger.error('EOD time migration failed', { error });
  process.exitCode = 1;
});
