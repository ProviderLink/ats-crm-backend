import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';
import { env } from '../config/env';

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

    socket.join('applications');
    socket.join('email-templates');
    socket.join(`user:${decoded._id}`);

    socket.on('join:job', (jobId: string) => {
      socket.join(`job:${jobId}`);
    });

    socket.on('leave:job', (jobId: string) => {
      socket.leave(`job:${jobId}`);
    });

    socket.on('disconnect', () => {
      console.log(`ATS socket disconnected: ${socket.id}`);
    });
  });
};
