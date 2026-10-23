/**
 * Short-lived in-memory copy of the data the Candidates table is computed from.
 *
 * Every page change, search keystroke and sort used to re-read four collections
 * from the database. The copy is shared by all requests, rebuilt at most once
 * per TTL (the old copy keeps serving while it reloads), and dropped immediately when this server emits a candidate,
 * application, job or client change (which every write path does), so the page
 * a user sees after their own edit is never stale. Writes made by ANOTHER
 * server process are picked up when the TTL runs out.
 */

const TTL_MS = 20_000;
/** Past this age the copy is not served; the caller waits for fresh data. */
const MAX_STALE_MS = 120_000;
/** Rooms whose events change what the table shows. */
const WATCHED_ROOMS = new Set(['candidates', 'applications', 'jobs', 'clients']);

let cached: { at: number; data: unknown } | null = null;
let inflight: Promise<unknown> | null = null;
let version = 0;

export function invalidateTableData(): void {
  cached = null;
  version++;
  scheduleWarmUp();
}

// Once the table has been used, rebuild right after a change (debounced) so
// the next page change or search finds warm data instead of paying the rebuild.
let warmLoader: (() => Promise<unknown>) | null = null;
let warmTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleWarmUp(): void {
  if (!warmLoader || warmTimer) return;
  warmTimer = setTimeout(() => {
    warmTimer = null;
    if (warmLoader) void getCachedTableData(warmLoader).catch(() => undefined);
  }, 800);
}

/** Called for every realtime emit; cheap no-op for unrelated rooms. */
export function onRealtimeEmit(room: string): void {
  if (WATCHED_ROOMS.has(room)) invalidateTableData();
}

function refresh<T>(load: () => Promise<T>): Promise<T> {
  if (inflight) return inflight as Promise<T>;
  const startedAt = version;
  const promise = load()
    .then(data => {
      // A change landed while loading: serve this result once, don't keep it.
      if (startedAt === version) cached = { at: Date.now(), data };
      return data;
    })
    .finally(() => {
      inflight = null;
    });
  inflight = promise;
  return promise;
}

export async function getCachedTableData<T>(load: () => Promise<T>): Promise<T> {
  warmLoader = load;
  if (cached && Date.now() - cached.at < MAX_STALE_MS) {
    // Past the TTL the old copy is still served instantly while a fresh one
    // loads, so the table never waits on the database for a mere expiry.
    // (A change emitted by this server clears `cached`, so edits never see it.)
    if (Date.now() - cached.at >= TTL_MS) void refresh(load).catch(() => undefined);
    return cached.data as T;
  }
  return refresh(load);
}
