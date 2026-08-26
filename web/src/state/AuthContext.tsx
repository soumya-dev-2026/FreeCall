import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, tokenStore } from "../lib/api";
import { connectSocket, disconnectSocket } from "../lib/socket";
import { disablePush } from "../lib/push";
import type { AppSocket } from "../lib/socket";
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
  logout: () => void;
  updateProfile: (input: Omit<AuthUser, "id" | "username" | "online" | "lastSeen">) => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [socket, setSocket] = useState<AppSocket | null>(null);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);

  /** Open the socket for an authenticated user. */
  const openSocket = useCallback((token: string) => {
    const s = connectSocket(token);
    setSocket(s);

    s.on("connect", () => setConnected(true));
    s.on("disconnect", () => setConnected(false));
    s.on("connect_error", (err: Error) => {
      setConnected(false);
      // An auth failure means the stored token is stale — force a re-login.
      if (/token|auth|user/i.test(err.message)) {
        tokenStore.clear();
        setUser(null);
        disconnectSocket();
        setSocket(null);
      }
    });

    return s;
  }, []);

  // Restore an existing session on first load.
  useEffect(() => {
    let cancelled = false;
    const token = tokenStore.get();
    if (!token) {
      setLoading(false);
      return;
    }
    api
      .me()
      .then(({ user: me }) => {
        if (cancelled) return;
        setUser(me);
        openSocket(token);
      })
      .catch(() => {
        tokenStore.clear();
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [openSocket]);

  const login = useCallback(
    async (username: string, password: string) => {
      const { token, user: me } = await api.login({ username, password });
      tokenStore.set(token);
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
      tokenStore.set(token);
      setUser(me);
      openSocket(token);
    },
    [openSocket]
  );

  const logout = useCallback(() => {
    void disablePush();
    tokenStore.clear();
    disconnectSocket();
    setSocket(null);
    setUser(null);
    setConnected(false);
  }, []);

  const updateProfile = useCallback(async (
    input: Omit<AuthUser, "id" | "username" | "online" | "lastSeen">
  ) => {
    const { user: updated } = await api.updateProfile(input);
    setUser(updated);
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, socket, loading, connected, login, register, logout, updateProfile }),
    [user, socket, loading, connected, login, register, logout, updateProfile]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
