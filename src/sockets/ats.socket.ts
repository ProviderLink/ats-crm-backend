import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';
import { env } from '../config/env';
import { hasPermission } from '../shared/middleware/authorize';

const OBJECT_ID_RE = /^[a-f\d]{24}$/i;

export const initializeAtsSocket = (io: Server): void => {
  const ats = io.of('/ats');

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

    const subject = {
      roles,
      permissions: decoded.permissions as unknown,
    };

    // Rooms mirror the REST permission model. `applications` also carries the
    // interview:* events.
    const ROOM_PERMISSIONS: [room: string, resource: string][] = [
      ['applications', 'candidates'],
      ['candidates', 'candidates'],
      ['jobs', 'jobs'],
      ['clients', 'clients'],
      ['tags', 'tags'],
      ['pipeline-templates', 'pipelineTemplates'],
      ['email-templates', 'emailTemplates'],
    ];
    for (const [room, resource] of ROOM_PERMISSIONS) {
      if (hasPermission(subject, resource, 'read')) socket.join(room);
    }
    socket.join(`user:${decoded._id}`);

    socket.on('join:job', (jobId: unknown) => {
      if (typeof jobId !== 'string' || !OBJECT_ID_RE.test(jobId)) return;
      if (!hasPermission(subject, 'jobs', 'read')) return;
      socket.join(`job:${jobId}`);
    });

    socket.on('leave:job', (jobId: unknown) => {
      if (typeof jobId !== 'string' || !OBJECT_ID_RE.test(jobId)) return;
      socket.leave(`job:${jobId}`);
    });

    socket.on('disconnect', () => {
      console.log(`ATS socket disconnected: ${socket.id}`);
    });
  });
};
