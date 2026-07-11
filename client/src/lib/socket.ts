// Phase 2: Socket.io client — one shared connection for live updates.
// After login we call join(token); the server verifies the token and puts
// this browser in its tenant's room, so we only ever get OUR events.
import { io, Socket } from 'socket.io-client';
import { API_ORIGIN } from './api';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(API_ORIGIN, { withCredentials: true });
  }
  return socket;
}

export function joinTenantRoom(token: string) {
  getSocket().emit('join', token);
}
