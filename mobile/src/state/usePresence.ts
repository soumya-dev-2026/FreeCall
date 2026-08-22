/**
 * Tracks the user directory and live online/offline status (mobile).
 *
 * Same shape as the web hook, plus an AppState listener: when the app comes
 * back to the foreground we refetch, because the socket may have been asleep
 * and missed presence updates.
 */

import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";
import { api } from "../lib/api";
import type { AppSocket } from "../lib/socket";
import type { PublicUser } from "../shared/types";

export function usePresence(socket: AppSocket | null, enabled: boolean) {
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const { users: list } = await api.users();
      setUsers(list);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
  }, [enabled, refresh]);

  useEffect(() => {
    if (!socket) return;

    const onState = ({ online }: { online: string[] }) => {
      const set = new Set(online);
      setUsers((prev) => prev.map((u) => ({ ...u, online: set.has(u.id) })));
    };

    const onUpdate = ({
      userId,
      online,
      lastSeen,
    }: {
      userId: string;
      online: boolean;
      lastSeen: number | null;
    }) => {
      setUsers((prev) => {
        const known = prev.some((u) => u.id === userId);
        if (!known && online) {
          void refresh();
          return prev;
        }
        return prev.map((u) =>
          u.id === userId ? { ...u, online, lastSeen } : u
        );
      });
    };

    const onConnect = () => void refresh();

    socket.on("presence:state", onState);
    socket.on("presence:update", onUpdate);
    socket.on("connect", onConnect);

    return () => {
      socket.off("presence:state", onState);
      socket.off("presence:update", onUpdate);
      socket.off("connect", onConnect);
    };
  }, [socket, refresh]);

  // Refetch when the app returns to the foreground.
  useEffect(() => {
    if (!enabled) return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    return () => sub.remove();
  }, [enabled, refresh]);

  return { users, loading, error, refresh };
}
