/**
 * REST client + token storage.
 */

import type {
  AuthResponse,
  AuthUser,
  CallHistoryEntry,
  PublicUser,
} from "../shared/types";

/** Server base URL. Override with VITE_SERVER_URL for LAN/phone testing. */
export const SERVER_URL: string =
  (import.meta.env.VITE_SERVER_URL as string | undefined) ??
  (import.meta.env.DEV
    ? `${location.protocol}//${location.hostname}:4000`
    : location.origin);

const TOKEN_KEY = "freecall.token";

export const tokenStore = {
  get(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string): void {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* private mode — token stays in memory only */
    }
  },
  clear(): void {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  },
};

async function request<T>(
  path: string,
  init: RequestInit = {},
  auth = true
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (auth) {
    const token = tokenStore.get();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }

  let res: Response;
  try {
    res = await fetch(`${SERVER_URL}/api${path}`, { ...init, headers });
  } catch {
    throw new Error(
      `Cannot reach the server at ${SERVER_URL}. Is it running?`
    );
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      /* non-JSON error body */
    }
    throw Object.assign(new Error(message), { status: res.status });
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  register(input: {
    username: string;
    displayName: string;
    password: string;
    avatarUrl?: string;
  }) {
    return request<AuthResponse>(
      "/auth/register",
      { method: "POST", body: JSON.stringify(input) },
      false
    );
  },

  login(input: { username: string; password: string }) {
    return request<AuthResponse>(
      "/auth/login",
      { method: "POST", body: JSON.stringify(input) },
      false
    );
  },

  me() {
    return request<{ user: AuthUser }>("/auth/me");
  },

  updateProfile(input: Omit<AuthUser, "id" | "username" | "online" | "lastSeen">) {
    return request<{ user: AuthUser }>("/auth/me", {
      method: "PUT",
      body: JSON.stringify(input),
    });
  },

  users() {
    return request<{ users: PublicUser[] }>("/users");
  },

  history() {
    return request<{ history: CallHistoryEntry[] }>("/history");
  },

  iceConfig() {
    return request<{ iceServers: RTCIceServer[] }>("/config/ice");
  },

  vapidPublicKey() {
    return request<{ key: string | null }>("/push/vapidPublicKey", {}, false);
  },

  pushSubscribe(subscription: PushSubscriptionJSON) {
    return request<{ ok: true }>("/push/subscribe", {
      method: "POST",
      body: JSON.stringify({ subscription }),
    });
  },

  pushUnsubscribe(endpoint: string) {
    return request<{ ok: true }>("/push/unsubscribe", {
      method: "POST",
      body: JSON.stringify({ endpoint }),
    });
  },
};
