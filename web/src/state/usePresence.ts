/**
 * Tracks the user directory and live online/offline status.
 *
 * The initial list comes from REST; `presence:state` seeds who's online right
 * now, and `presence:update` keeps it current as people come and go.
 */

import { useCallback, useEffect, useState } from "react";
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
      setUsers((prev) =>
        prev.map((u) => ({ ...u, online: set.has(u.id) }))
      );
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
        // A user we've never seen just came online — pull the list again.
        if (!known && online) {
          void refresh();
          return prev;
        }
        return prev.map((u) =>
          u.id === userId ? { ...u, online, lastSeen } : u
        );
      });
    };

    // Re-sync after a reconnect: we may have missed updates while away.
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

  return { users, loading, error, refresh };
}
