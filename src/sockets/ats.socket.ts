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

    socket.join(`user:${decoded._id}`);

    // Each room carries data the HTTP API gates behind a permission, so a
    // member joins only the rooms they could read over REST. Interviews and
    // external meetings travel in the 'applications' room.
    const permUser = { roles, permissions: decoded.permissions };
    const ROOM_PERMISSIONS: [string, string][] = [
      ['applications', 'candidates'],
      ['candidates', 'candidates'],
      ['jobs', 'jobs'],
      ['clients', 'clients'],
      ['tags', 'tags'],
      ['pipeline-templates', 'pipelineTemplates'],
      ['email-templates', 'emailTemplates'],
      ['emails', 'emails'],
      ['team', 'team'],
      ['scorecards', 'interviewScorecards'],
    ];
    for (const [room, resource] of ROOM_PERMISSIONS) {
      if (hasPermission(permUser, resource, 'read')) socket.join(room);
    }

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
