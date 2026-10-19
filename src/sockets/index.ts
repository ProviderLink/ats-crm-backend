import { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { env } from '../config/env';
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
  io.of('/ats').to(room).emit(event, payload);
};

export const emitToCrm = (
  room: string,
  event: string,
  payload: unknown
): void => {
  io.of('/crm').to(room).emit(event, payload);
};
