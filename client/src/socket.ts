import { io } from 'socket.io-client';
import { getToken } from './api';

// The token is read on every (re)connect so the server can put this tab in the user's private room.
export const socket = io({ auth: (cb) => cb({ token: getToken() }) });

export function reconnectSocket() {
  socket.disconnect().connect();
}
