/**
 * In-process coalescing guard for the fire-and-forget AI jobs.
 *
 * Each of these jobs is started with `void runX(...)` from several call sites
 * (public apply, internal create, assign-job, approve, score endpoint). A
 * single user action can therefore start the same job 2–4 times within a few
 * hundred milliseconds, because none of the call sites await the previous run
 * and the jobs' own idempotency checks read the database *before* the first run
 * has written anything.
 *
 * The effect was visible in the activity timeline as up to four near-identical
 * entries per action — e.g. four `parsed_data_updated` rows, milliseconds
 * apart, each reporting a different `skillsCount` because each had parsed the
 * resume independently.
 *
 * This guard collapses concurrent runs for the same entity: while a run for a
 * given key is in flight, further calls reuse its promise instead of starting
 * new work.
 *
 * Scope: the process. That is sufficient because the backend runs as a single
 * `node dist/app.js` process (see Procfile) — every duplicate trigger lands
 * here. If the app is ever scaled to multiple instances, concurrent runs from
 * different instances would need a database-backed lock instead (see
 * `cronLock.ts` for the existing pattern).
 */

/** Key -> promise of the run currently in flight. */
const inFlight = new Map<string, Promise<void>>();

/**
 * Run `task` unless an identical run is already in flight.
 *
 * @param key  Unique identity of the work, e.g. `parse:<candidateId>`. Include
 *             every input that would make two calls genuinely different.
 * @param task Started only when nothing is in flight for `key`.
 * @returns The in-flight promise, so callers awaiting it get the real result.
 */
export function coalesce(
  key: string,
  task: () => Promise<void>
): Promise<void> {
  const existing = inFlight.get(key);
  if (existing) return existing;

  const run = (async () => {
    try {
      await task();
    } finally {
      // Cleared before the promise settles, so a later legitimate run (e.g. a
      // genuine re-parse after an edit) is not blocked by this one.
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, run);

  // Swallow rejections on the *stored* promise so a failed run cannot surface
  // as an unhandled rejection; callers still receive the real rejection from
  // the value returned below.
  run.catch(() => undefined);

  return run;
}

/** Number of runs currently in flight — for diagnostics only. */
export function inFlightCount(): number {
  return inFlight.size;
}
