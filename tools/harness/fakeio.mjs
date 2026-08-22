/**
 * A fake Socket.IO server, just large enough to run the real
 * server/src/socket.ts unchanged.
 *
 * Implements the surface that file actually uses: middleware via io.use, the
 * connection handler, per-socket handlers with acks, rooms, and the three
 * emit targets (socket.emit, io.to(room).emit, socket.to(room).emit — note the
 * last one excludes the acting socket, which is what the multi-device ring
 * logic depends on).
 */

export function createFakeIO() {
  /** room name -> set of socket ids */
  const rooms = new Map();
  /** socket id -> server-side socket */
  const sockets = new Map();
  const middlewares = [];
  let connectionHandler = null;
  let nextId = 1;

  const membersOf = (room) => [...(rooms.get(room) ?? [])];

  const deliver = (socketId, event, payload) => {
    const s = sockets.get(socketId);
    if (!s || s.disconnected) return;
    s.inbox.push({ event, payload });
    (s.listeners.get(event) ?? []).forEach((fn) => fn(payload));
  };

  const emitToRoom = (room, event, payload, exceptId = null) => {
    for (const id of membersOf(room)) {
      if (id !== exceptId) deliver(id, event, payload);
    }
  };

  const io = {
    use(fn) {
      middlewares.push(fn);
    },
    on(event, handler) {
      if (event === "connection") connectionHandler = handler;
    },
    emit(event, payload) {
      for (const id of sockets.keys()) deliver(id, event, payload);
    },
    to(room) {
      return { emit: (event, payload) => emitToRoom(room, event, payload) };
    },
    socketsLeave(room) {
      for (const id of membersOf(room)) {
        const s = sockets.get(id);
        if (s) s.rooms.delete(room);
      }
      rooms.delete(room);
    },

    /* ------------------------------------------------ harness-only API */

    /**
     * Simulate a client connecting with a JWT. Resolves to a client handle, or
     * rejects with the middleware's error (which is how auth failures show up
     * on a real client, as connect_error).
     */
    async connect(token, label = "") {
      const id = `sock${nextId++}${label ? `:${label}` : ""}`;
      const socket = {
        id,
        data: {},
        handshake: { auth: { token }, headers: {} },
        rooms: new Set(),
        listeners: new Map(),
        handlers: new Map(),
        inbox: [],
        disconnected: false,

        join(room) {
          this.rooms.add(room);
          if (!rooms.has(room)) rooms.set(room, new Set());
          rooms.get(room).add(id);
        },
        leave(room) {
          this.rooms.delete(room);
          rooms.get(room)?.delete(id);
        },
        emit(event, payload) {
          deliver(id, event, payload);
        },
        to(room) {
          return {
            emit: (event, payload) => emitToRoom(room, event, payload, id),
          };
        },
        on(event, handler) {
          this.handlers.set(event, handler);
        },
        disconnect() {
          this.disconnected = true;
          const h = this.handlers.get("disconnect");
          for (const room of [...this.rooms]) this.leave(room);
          sockets.delete(id);
          if (h) h();
        },
      };

      sockets.set(id, socket);

      // Run the auth middleware chain exactly as Socket.IO would.
      for (const mw of middlewares) {
        await new Promise((resolve, reject) => {
          mw(socket, (err) => (err ? reject(err) : resolve()));
        });
      }
      connectionHandler?.(socket);

      return {
        id,
        socket,
        /** Events the server sent to this client. */
        inbox: socket.inbox,
        /** Emit to the server; resolves with the ack payload if any. */
        send(event, payload) {
          const handler = socket.handlers.get(event);
          if (!handler) throw new Error(`server has no handler for "${event}"`);
          return new Promise((resolve) => {
            let acked = false;
            const ack = (value) => {
              acked = true;
              resolve(value);
            };
            const result = handler(payload, ack);
            // Handlers without an ack resolve on the next tick.
            Promise.resolve(result).then(() =>
              setImmediate(() => !acked && resolve(undefined))
            );
          });
        },
        /** All payloads received for one event name. */
        all(event) {
          return socket.inbox.filter((m) => m.event === event).map((m) => m.payload);
        },
        /** Most recent payload for an event, or undefined. */
        last(event) {
          const list = this.all(event);
          return list[list.length - 1];
        },
        got(event) {
          return socket.inbox.some((m) => m.event === event);
        },
        clear() {
          socket.inbox.length = 0;
        },
        disconnect() {
          socket.disconnect();
        },
      };
    },

    _rooms: rooms,
    _sockets: sockets,
  };

  return io;
}
