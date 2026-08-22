import { Router } from "express";
import { config, iceServers, pushEnabled } from "./config";
import { requireAuth, signToken, type AuthedRequest } from "./auth";
import {
  addExpoToken,
  addPushSub,
  allUsers,
  createUser,
  findUserByUsername,
  historyFor,
  publicUser,
  removeExpoToken,
  removePushSub,
  toPublicUser,
  verifyPassword,
} from "./store";

export const api = Router();

/* ----------------------------------------------------------------- auth */

api.post("/auth/register", (req, res) => {
  const { username, displayName, password, avatarUrl } = req.body ?? {};

  if (typeof username !== "string" || username.trim().length < 3) {
    return res
      .status(400)
      .json({ error: "Username must be at least 3 characters" });
  }
  if (typeof password !== "string" || password.length < 6) {
    return res
      .status(400)
      .json({ error: "Password must be at least 6 characters" });
  }
  if (!/^[a-zA-Z0-9_.-]+$/.test(username.trim())) {
    return res.status(400).json({
      error: "Username may only contain letters, numbers, dot, dash, underscore",
    });
  }

  try {
    const user = createUser({
      username: username.trim(),
      displayName:
        typeof displayName === "string" && displayName.trim()
          ? displayName.trim()
          : username.trim(),
      password,
      avatarUrl: typeof avatarUrl === "string" ? avatarUrl : undefined,
    });
    return res
      .status(201)
      .json({ token: signToken(user), user: toPublicUser(user) });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    return res.status(status).json({ error: (err as Error).message });
  }
});

api.post("/auth/login", (req, res) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "username and password are required" });
  }
  const user = findUserByUsername(username.trim());
  if (!user || !verifyPassword(user, password)) {
    return res.status(401).json({ error: "Invalid username or password" });
  }
  return res.json({ token: signToken(user), user: toPublicUser(user) });
});

api.get("/auth/me", requireAuth, (req: AuthedRequest, res) => {
  return res.json({ user: toPublicUser(req.user!) });
});

/* ---------------------------------------------------------------- users */

api.get("/users", requireAuth, (req: AuthedRequest, res) => {
  const me = req.user!.id;
  return res.json({ users: allUsers().filter((u) => u.id !== me) });
});

api.get("/users/:id", requireAuth, (req, res) => {
  const user = publicUser(req.params.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  return res.json({ user });
});

/* -------------------------------------------------------------- history */

api.get("/history", requireAuth, (req: AuthedRequest, res) => {
  return res.json({ history: historyFor(req.user!.id) });
});

/* --------------------------------------------------------------- config */

api.get("/config/ice", requireAuth, (_req, res) => {
  return res.json({ iceServers: iceServers() });
});

/* ----------------------------------------------------------------- push */

api.get("/push/vapidPublicKey", (_req, res) => {
  return res.json({ key: pushEnabled() ? config.vapidPublic : null });
});

api.post("/push/subscribe", requireAuth, (req: AuthedRequest, res) => {
  const sub = req.body?.subscription;
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    return res.status(400).json({ error: "Invalid push subscription" });
  }
  addPushSub(req.user!.id, {
    endpoint: sub.endpoint,
    keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
  });
  return res.json({ ok: true });
});

api.post("/push/unsubscribe", requireAuth, (req: AuthedRequest, res) => {
  const endpoint = req.body?.endpoint;
  if (typeof endpoint !== "string") {
    return res.status(400).json({ error: "endpoint is required" });
  }
  removePushSub(req.user!.id, endpoint);
  return res.json({ ok: true });
});

/**
 * Expo push tokens (mobile). Separate endpoints because an Expo token is just
 * a string, not a VAPID subscription object, and it needs no server keys.
 */
api.post("/push/expo/register", requireAuth, (req: AuthedRequest, res) => {
  const token = req.body?.token;
  if (typeof token !== "string" || !token.trim()) {
    return res.status(400).json({ error: "token is required" });
  }
  addExpoToken(req.user!.id, token.trim());
  return res.json({ ok: true });
});

api.post("/push/expo/unregister", requireAuth, (req: AuthedRequest, res) => {
  const token = req.body?.token;
  if (typeof token !== "string") {
    return res.status(400).json({ error: "token is required" });
  }
  removeExpoToken(req.user!.id, token);
  return res.json({ ok: true });
});
