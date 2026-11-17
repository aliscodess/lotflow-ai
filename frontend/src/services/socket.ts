import { io, type Socket } from 'socket.io-client';
import { API_URL, tokens } from './api';

let socket: Socket | null = null;

export function connectSocket(): Socket {
  if (socket) {
    socket.auth = { token: tokens.access };
    if (!socket.connected) socket.connect();
    return socket;
  }
  socket = io(API_URL || window.location.origin, {
    auth: { token: tokens.access },
    transports: ['websocket', 'polling'],
    reconnectionDelay: 1500,
    reconnectionDelayMax: 8000,
  });
  // Refresh the token on each reconnect attempt so expired sessions recover.
  socket.io.on('reconnect_attempt', () => {
    if (socket) socket.auth = { token: tokens.access };
  });
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}

export const getSocket = () => socket;
