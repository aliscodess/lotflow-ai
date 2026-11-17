import { Server } from 'socket.io';
import { verifyAccessToken } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';

let io = null;

export function initSocket(httpServer, corsOrigin) {
  io = new Server(httpServer, { cors: { origin: corsOrigin, credentials: true } });

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('unauthorized'));
      const payload = verifyAccessToken(token);
      socket.data.user = { id: payload.sub, role: payload.role, name: payload.name };
      return next();
    } catch {
      return next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const { role, name } = socket.data.user;
    socket.join(`role:${role}`);
    logger.debug(`[socket] ${name} (${role}) connected`);
  });
  return io;
}

/** Broadcast an event to every connected client (or to specific roles). */
export function emit(event, payload, roles) {
  if (!io) return;
  if (roles?.length) roles.forEach((r) => io.to(`role:${r}`).emit(event, payload));
  else io.emit(event, payload);
}

/** User-facing notification toast/bell entry. */
export function notify({ title, message, priority = 'MEDIUM', kind = 'info', link, vehicleId, roles }) {
  emit(
    'notification',
    { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, title, message, priority, kind, link, vehicleId, at: new Date().toISOString() },
    roles,
  );
}
