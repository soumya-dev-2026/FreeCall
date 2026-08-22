import http from "http";
import cors from "cors";
import express from "express";
import { Server } from "socket.io";

import { config } from "./config";
import { api } from "./routes";
import { initPush } from "./push";
import { registerSocketHandlers, type IOServer } from "./socket";
import { seedDemoUsers } from "./store";
import type {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from "./shared/types";

const app = express();

app.use(
  cors({
    origin: (origin, cb) => {
      // Allow tools with no Origin (curl, native mobile apps) and any
      // configured web origin. Mobile RN apps send no Origin header.
      if (!origin) return cb(null, true);
      if (config.clientOrigins.includes(origin)) return cb(null, true);
      // Be permissive on LAN IPs in dev so phones can reach the dev server.
      if (/^https?:\/\/(\d+\.){3}\d+(:\d+)?$/.test(origin)) return cb(null, true);
      return cb(new Error(`Origin not allowed: ${origin}`));
    },
    credentials: true,
  })
);
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) =>
  res.json({ ok: true, uptime: process.uptime() })
);
app.use("/api", api);

// Fallback error handler so thrown errors don't crash the process.
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error("[http]", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
);

const server = http.createServer(app);

const io: IOServer = new Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>(server, {
  cors: { origin: config.clientOrigins.concat("*"), credentials: true },
  // Keep connections alive through mobile network hiccups.
  pingInterval: 20_000,
  pingTimeout: 25_000,
});

initPush();
registerSocketHandlers(io);
seedDemoUsers();

server.listen(config.port, () => {
  console.log(`\n  FreeCall server listening on http://localhost:${config.port}`);
  console.log(`  Allowed web origins: ${config.clientOrigins.join(", ")}`);
  console.log(`  Demo logins: alice / bob / carol  (password: "password")\n`);
});

// Graceful shutdown so nodemon/tsx restarts don't leave the port bound.
const shutdown = () => {
  console.log("\n[server] shutting down…");
  io.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
