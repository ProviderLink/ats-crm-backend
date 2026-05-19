/**
 * One-time migration: backfill icon field on existing pipeline stages.
 * Run once after deploying the icon feature:
 *   npx ts-node src/scripts/migrateStageIcons.ts
 */
import mongoose from 'mongoose';
import { env } from '../config/env';

const DEFAULT_ICON = 'ClipboardList';

async function run(): Promise<void> {
  await mongoose.connect(env.MONGODB_URI);
  console.log('Connected to MongoDB');

  const db = mongoose.connection.db;
  if (!db) throw new Error('No database connection');

  // --- PipelineTemplate stages ---
  const templateResult = await db
    .collection('pipelinetemplates')
    .updateMany(
      { 'stages.icon': { $exists: false } },
      { $set: { 'stages.$[stage].icon': DEFAULT_ICON } },
      { arrayFilters: [{ 'stage.icon': { $exists: false } }] }
    );

  console.log(
    `PipelineTemplates — matched: ${templateResult.matchedCount}, modified: ${templateResult.modifiedCount}`
  );

  // --- Job pipeline stages ---
  const jobResult = await db
    .collection('jobs')
    .updateMany(
      { 'pipeline.stages.icon': { $exists: false } },
      { $set: { 'pipeline.stages.$[stage].icon': DEFAULT_ICON } },
      { arrayFilters: [{ 'stage.icon': { $exists: false } }] }
    );

  console.log(
    `Jobs — matched: ${jobResult.matchedCount}, modified: ${jobResult.modifiedCount}`
  );

  await mongoose.disconnect();
  console.log('Done.');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
