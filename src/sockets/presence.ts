import type { Namespace, Socket } from 'socket.io';
import { hasPermission } from '../shared/middleware/authorize';

/**
 * ATS presence: a user is online while at least one authenticated `/ats`
 * socket is open for them. State is in-memory only (single backend instance);
 * it rebuilds itself as clients reconnect after a restart.
 */

export const PRESENCE_ROOM = 'presence';
/** Wait before announcing "offline" so a page refresh does not flicker. */
const OFFLINE_GRACE_MS = 5_000;

const sockets = new Map<string, Set<string>>();
const pendingOffline = new Map<string, NodeJS.Timeout>();

let ats: Namespace | null = null;

const announce = (userId: string, online: boolean): void => {
  try {
    ats?.to(PRESENCE_ROOM).emit('presence:update', { userId, online });
  } catch {
    // Presence must never affect the socket connection itself.
  }
};

export const trackConnect = (userId: string, socketId: string): void => {
  const timer = pendingOffline.get(userId);
  if (timer) {
    clearTimeout(timer);
    pendingOffline.delete(userId);
  }
  const set = sockets.get(userId) ?? new Set<string>();
  const wasOnline = set.size > 0;
  set.add(socketId);
  sockets.set(userId, set);
  // Within the grace window the dot never went away, so nothing to announce.
  if (!wasOnline && !timer) announce(userId, true);
};

export const trackDisconnect = (userId: string, socketId: string): void => {
  const set = sockets.get(userId);
  if (!set) return;
  set.delete(socketId);
  if (set.size > 0) return;
  sockets.delete(userId);
  const timer = setTimeout(() => {
    pendingOffline.delete(userId);
    if (!sockets.has(userId)) announce(userId, false);
  }, OFFLINE_GRACE_MS);
  pendingOffline.set(userId, timer);
};

const onlineUserIds = (): string[] => [...sockets.keys()];

/** Wire the `presence:subscribe` handler for a connected, verified socket. */
export const registerPresenceHandlers = (
  socket: Socket,
  user: { [key: string]: unknown }
): void => {
  socket.on('presence:subscribe', (ack?: (ids: string[]) => void) => {
    const allowed = hasPermission(
      {
      roles: (user.roles as string[] | undefined) ?? [],
      permissions: user.permissions,
    },
      'team',
      'read'
    );
    if (!allowed) {
      if (typeof ack === 'function') ack([]);
      return;
    }
    socket.join(PRESENCE_ROOM);
    if (typeof ack === 'function') ack(onlineUserIds());
  });

  socket.on('presence:unsubscribe', () => {
    socket.leave(PRESENCE_ROOM);
  });
};

export const initPresence = (namespace: Namespace): void => {
  ats = namespace;
};

/** Force-close every ATS socket of a user (logout / deactivation). */
export const disconnectUser = (userId: string): void => {
  try {
    ats?.in(`user:${userId}`).disconnectSockets(true);
  } catch {
    // Best effort: logout must not fail because of presence.
  }
};
