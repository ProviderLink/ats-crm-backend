import { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { env } from '../config/env';
import { onRealtimeEmit } from '../features/candidates/candidate.table.cache';
import { invalidateListsForRoom } from '../shared/utils/listCache';
import { initializeAtsSocket } from './ats.socket';
import { initializeCrmSocket } from './crm.socket';

export let io: Server;

export const initializeSockets = (server: HttpServer): void => {
  io = new Server(server, {
    cors: {
      origin: [env.ATS_FRONTEND_URL, env.CRM_FRONTEND_URL],
      credentials: true,
    },
    // Faster dead-connection detection so presence turns offline within ~25s.
    pingInterval: 10_000,
    pingTimeout: 15_000,
  });

  initializeAtsSocket(io);
  initializeCrmSocket(io);
};

export const emitToAts = (
  room: string,
  event: string,
  payload: unknown
): void => {
  // Drop the cached Candidates-table data before clients refetch it.
  onRealtimeEmit(room);
  invalidateListsForRoom(room);
  io.of('/ats').to(room).emit(event, payload);
};

export const emitToCrm = (
  room: string,
  event: string,
  payload: unknown
): void => {
  io.of('/crm').to(room).emit(event, payload);
};

/**
 * Fire-and-forget variant for emitters that run AFTER a successful database
 * write: a socket problem must never fail the request that triggered it, so
 * errors are logged and swallowed. Clients that miss an event catch up on
 * their next reconnect refetch.
 */
export const safeEmitToAts = (
  room: string,
  event: string,
  payload: unknown
): void => {
  try {
    emitToAts(room, event, payload);
  } catch (error) {
    console.warn(`Realtime ${event} failed: ${(error as Error).message}`);
  }
};
