import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';
import { env } from '../config/env';
import { hasPermission } from '../shared/middleware/authorize';
import {
  initPresence,
  registerPresenceHandlers,
  trackConnect,
  trackDisconnect,
} from './presence';

export const initializeAtsSocket = (io: Server): void => {
  const ats = io.of('/ats');
  initPresence(ats);

  ats.on('connection', socket => {
    const token =
      socket.handshake.auth.token ??
      socket.handshake.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      socket.disconnect(true);
      return;
    }

    let decoded: jwt.JwtPayload;
    try {
      decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as jwt.JwtPayload;
      socket.data.user = decoded;
    } catch {
      socket.disconnect(true);
      return;
    }

    const appAccess: string[] = decoded.appAccess ?? [];
    const roles: string[] = decoded.roles ?? [];

    if (!appAccess.includes('ats') && !roles.includes('admin')) {
      socket.disconnect(true);
      return;
    }

    socket.join('applications');
    socket.join('candidates');
    socket.join('jobs');
    socket.join('clients');
    socket.join('tags');
    socket.join('pipeline-templates');
    socket.join('email-templates');
    socket.join('emails');
    socket.join(`user:${decoded._id}`);

    // Rooms for data the HTTP API gates behind a permission: only members who
    // could read it over REST receive it over the socket.
    const permUser = { roles, permissions: decoded.permissions };
    if (hasPermission(permUser, 'team', 'read')) socket.join('team');
    if (hasPermission(permUser, 'interviewScorecards', 'read'))
      socket.join('scorecards');

    const userId = String(decoded._id);
    trackConnect(userId, socket.id);
    registerPresenceHandlers(socket, decoded);

    socket.on('join:job', (jobId: string) => {
      socket.join(`job:${jobId}`);
    });

    socket.on('leave:job', (jobId: string) => {
      socket.leave(`job:${jobId}`);
    });

    socket.on('disconnect', () => {
      trackDisconnect(userId, socket.id);
      console.log(`ATS socket disconnected: ${socket.id}`);
    });
  });
};
