import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';
import { env } from '../config/env';

export const initializeCrmSocket = (io: Server): void => {
  const crm = io.of('/crm');

  crm.on('connection', socket => {
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

    if (!appAccess.includes('crm') && !roles.includes('admin')) {
      socket.disconnect(true);
      return;
    }

    // Work, EOD and review payloads carry every assignment's data. Only an
    // admin may see them all: account managers are scoped to their own
    // assignments by the REST API, and VAs and clients to their own records.
    if (roles.includes('admin')) {
      socket.join('assignments');
    }
    socket.join(`user:${decoded._id}`);

    socket.on('disconnect', () => {
      console.log(`CRM socket disconnected: ${socket.id}`);
    });
  });
};
