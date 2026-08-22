/**
 * REST client + token storage (AsyncStorage instead of localStorage).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import type {
  AuthResponse,
  AuthUser,
  CallHistoryEntry,
  PublicUser,
} from "../shared/types";

/**
 * The signaling server URL.
 *
 * A phone can't reach "localhost" on your computer, so this must be your dev
 * machine's LAN IP. Set it in mobile/app.json under `expo.extra.serverUrl`.
 */
export const SERVER_URL: string =
  (Constants.expoConfig?.extra?.serverUrl as string | undefined) ??
  "http://192.168.1.100:4000";

const TOKEN_KEY = "freecall.token";

export const tokenStore = {
  async get(): Promise<string | null> {
    try {
      return await AsyncStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  async set(token: string): Promise<void> {
    try {
      await AsyncStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* ignore */
    }
  },
  async clear(): Promise<void> {
    try {
      await AsyncStorage.removeItem(TOKEN_KEY);
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
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((init.headers as Record<string, string>) ?? {}),
  };
  if (auth) {
    const token = await tokenStore.get();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(`${SERVER_URL}/api${path}`, { ...init, headers });
  } catch {
    throw new Error(
      `Cannot reach the server at ${SERVER_URL}. ` +
        `Check that it's running and that this device is on the same network.`
    );
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      /* non-JSON body */
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
  users() {
    return request<{ users: PublicUser[] }>("/users");
  },
  history() {
    return request<{ history: CallHistoryEntry[] }>("/history");
  },
  iceConfig() {
    return request<{ iceServers: RTCIceServer[] }>("/config/ice");
  },
  registerExpoToken(token: string) {
    return request<{ ok: true }>("/push/expo/register", {
      method: "POST",
      body: JSON.stringify({ token }),
    });
  },
  unregisterExpoToken(token: string) {
    return request<{ ok: true }>("/push/expo/unregister", {
      method: "POST",
      body: JSON.stringify({ token }),
    });
  },
};
