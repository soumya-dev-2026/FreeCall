/**
 * Socket.IO client singleton.
 *
 * Created lazily once we have a JWT, and torn down on logout. Keeping it
 * outside React means reconnects don't get tangled up with render cycles.
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
  if (socket?.connected && socket.auth) return socket;
  disconnectSocket();

  socket = io(SERVER_URL, {
    auth: { token },
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionDelay: 600,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: Infinity,
    timeout: 12_000,
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
