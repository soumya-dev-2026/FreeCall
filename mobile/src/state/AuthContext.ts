import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, tokenStore } from "../lib/api";
import { connectSocket, disconnectSocket, type AppSocket } from "../lib/socket";
import { registerForPush, unregisterPush } from "../lib/push";
import type { AuthUser } from "../shared/types";

interface AuthState {
  user: AuthUser | null;
  socket: AppSocket | null;
  /** true until we've checked for an existing session */
  loading: boolean;
  connected: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (input: {
    username: string;
    displayName: string;
    password: string;
    avatarUrl?: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [socket, setSocket] = useState<AppSocket | null>(null);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);

  const openSocket = useCallback((token: string) => {
    const s = connectSocket(token);
    setSocket(s);

    s.on("connect", () => setConnected(true));
    s.on("disconnect", () => setConnected(false));
    s.on("connect_error", (err: Error) => {
      setConnected(false);
      // An auth failure means the stored token is stale — force a re-login.
      if (/token|auth|user/i.test(err.message)) {
        void tokenStore.clear();
        setUser(null);
        disconnectSocket();
        setSocket(null);
      }
    });

    // Fire-and-forget: push is a nice-to-have, never a blocker.
    void registerForPush();
    return s;
  }, []);

  // Restore an existing session on launch.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await tokenStore.get();
        if (!token) return;
        const { user: me } = await api.me();
        if (cancelled) return;
        setUser(me);
        openSocket(token);
      } catch {
        await tokenStore.clear();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [openSocket]);

  const login = useCallback(
    async (username: string, password: string) => {
      const { token, user: me } = await api.login({ username, password });
      await tokenStore.set(token);
      setUser(me);
      openSocket(token);
    },
    [openSocket]
  );

  const register = useCallback(
    async (input: {
      username: string;
      displayName: string;
      password: string;
      avatarUrl?: string;
    }) => {
      const { token, user: me } = await api.register(input);
      await tokenStore.set(token);
      setUser(me);
      openSocket(token);
    },
    [openSocket]
  );

  const logout = useCallback(async () => {
    await unregisterPush();
    await tokenStore.clear();
    disconnectSocket();
    setSocket(null);
    setUser(null);
    setConnected(false);
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, socket, loading, connected, login, register, logout }),
    [user, socket, loading, connected, login, register, logout]
  );

  return createElement(AuthContext.Provider, { value }, children);
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
