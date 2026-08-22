/**
 * Socket.IO client singleton (mobile).
 *
 * Identical contract to the web client; the only difference is slightly more
 * aggressive reconnection, since phones change networks and sleep radios.
 */

import { io, type Socket } from "socket.io-client";
import { SERVER_URL } from "./api";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "../shared/types";

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: AppSocket | null = null;

export function connectSocket(token: string): AppSocket {
  disconnectSocket();

  socket = io(SERVER_URL, {
    auth: { token },
    transports: ["websocket"],
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 4000,
    reconnectionAttempts: Infinity,
    timeout: 15_000,
  }) as AppSocket;

  return socket;
}

export function getSocket(): AppSocket | null {
  return socket;
}

export function disconnectSocket(): void {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}
