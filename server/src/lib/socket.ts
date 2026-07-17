// Socket.io — each dashboard joins its tenant room; events stay tenant-scoped.
import { Server } from 'socket.io';
import http from 'http';
import jwt from 'jsonwebtoken';
import { config } from '../config';

let io: Server;

export function initSocket(server: http.Server) {
  io = new Server(server, {
    cors: { origin: config.clientUrl, credentials: true },
  });

  io.on('connection', (socket) => {
    // The client sends its access token; we verify it and join the tenant room.
    socket.on('join', (token: string) => {
      try {
        const payload = jwt.verify(token, config.jwtAccessSecret) as { tenantId: string };
        socket.join(`tenant:${payload.tenantId}`);
      } catch {
        socket.disconnect(); // invalid token -> no live updates
      }
    });
  });

  return io;
}

// Broadcast an event to one tenant's dashboards only.
export function emitToTenant(tenantId: string, event: string, data: unknown) {
  if (io) io.to(`tenant:${tenantId}`).emit(event, data);
}
