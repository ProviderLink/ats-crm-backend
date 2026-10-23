/**
 * Read-through cache for list endpoints (jobs, clients, applications, ...).
 *
 * The app reads the same lists over and over: every login, page visit and
 * refresh asked the database again for data that rarely changes. Results are
 * kept in memory per (namespace, filters), served instantly, rebuilt when this
 * server emits a change for a related realtime room, and refreshed in the
 * background (old copy keeps serving) once older than the TTL, which also
 * covers writes made by another server process.
 */

interface Entry {
  at: number;
  data: unknown;
}

interface Namespace {
  rooms: Set<string>;
  ttlMs: number;
  entries: Map<string, Entry>;
  inflight: Map<string, Promise<unknown>>;
  /** Recently requested keys, rebuilt in the background after a change. */
  hot: Map<string, () => Promise<unknown>>;
  version: number;
  warmTimer: ReturnType<typeof setTimeout> | null;
}

/** Past this age an entry is not served at all; the caller waits for fresh data. */
const MAX_STALE_MS = 120_000;
const MAX_ENTRIES = 200;
const MAX_HOT = 5;
const WARM_DELAY_MS = 800;
const namespaces = new Map<string, Namespace>();

function ns(name: string, rooms: string[], ttlMs: number): Namespace {
  let n = namespaces.get(name);
  if (!n) {
    n = {
      rooms: new Set(rooms),
      ttlMs,
      entries: new Map(),
      inflight: new Map(),
      hot: new Map(),
      version: 0,
      warmTimer: null,
    };
    namespaces.set(name, n);
  }
  return n;
}

function load<T>(n: Namespace, key: string, loader: () => Promise<T>): Promise<T> {
  const running = n.inflight.get(key);
  if (running) return running as Promise<T>;
  const startedAt = n.version;
  const promise = loader()
    .then(data => {
      // A change landed while loading: serve it once, but do not keep it.
      if (startedAt === n.version) {
        if (n.entries.size >= MAX_ENTRIES) n.entries.clear();
        n.entries.set(key, { at: Date.now(), data });
      }
      return data;
    })
    .finally(() => {
      n.inflight.delete(key);
    });
  n.inflight.set(key, promise);
  return promise;
}

export async function cachedList<T>(
  name: string,
  rooms: string[],
  filters: unknown,
  loader: () => Promise<T>,
  ttlMs = 20_000
): Promise<T> {
  const n = ns(name, rooms, ttlMs);
  const key = JSON.stringify(filters ?? {});
  n.hot.delete(key);
  n.hot.set(key, loader);
  if (n.hot.size > MAX_HOT) {
    const oldest = n.hot.keys().next().value;
    if (oldest !== undefined) n.hot.delete(oldest);
  }
  const hit = n.entries.get(key);
  if (hit && Date.now() - hit.at < MAX_STALE_MS) {
    // Past the TTL the old copy still answers while a fresh one loads. (A
    // change emitted by this server removes the entry, so edits never see it.)
    if (Date.now() - hit.at >= n.ttlMs)
      void load(n, key, loader).catch(() => undefined);
    return hit.data as T;
  }
  return load(n, key, loader);
}

/** Called for every realtime emit; drops caches that depend on the room. */
export function invalidateListsForRoom(room: string): void {
  for (const n of namespaces.values()) {
    if (!n.rooms.has(room)) continue;
    n.entries.clear();
    n.version++;
    if (n.warmTimer) continue;
    n.warmTimer = setTimeout(() => {
      n.warmTimer = null;
      for (const [key, loader] of n.hot) void load(n, key, loader).catch(() => undefined);
    }, WARM_DELAY_MS);
  }
}
