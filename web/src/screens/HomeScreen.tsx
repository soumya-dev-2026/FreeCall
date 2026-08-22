import { useEffect, useMemo, useState } from "react";
import { Avatar } from "../components/Avatar";
import {
  ArrowIncomingIcon,
  ArrowOutgoingIcon,
  BellIcon,
  ClockIcon,
  LogOutIcon,
  PhoneIcon,
  PhoneOffIcon,
  SpinnerIcon,
  UsersIcon,
  VideoIcon,
} from "../components/Icons";
import { api } from "../lib/api";
import {
  currentPermission,
  enablePush,
  pushSupported,
  type PushStatus,
} from "../lib/push";
import { cx, formatDuration, formatRelative, joinNames } from "../lib/utils";
import type { AuthUser, CallHistoryEntry, PublicUser } from "../shared/types";

interface Props {
  self: AuthUser;
  users: PublicUser[];
  usersLoading: boolean;
  connected: boolean;
  historyVersion: number;
  onCall: (callees: PublicUser[], video: boolean) => void;
  onLogout: () => void;
}

type Tab = "contacts" | "history";

export function HomeScreen({
  self,
  users,
  usersLoading,
  connected,
  historyVersion,
  onCall,
  onLogout,
}: Props) {
  const [tab, setTab] = useState<Tab>("contacts");
  const [query, setQuery] = useState("");
  /** Multi-select mode for starting a group call. */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<CallHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [push, setPush] = useState<PushStatus>(() => currentPermission());
  const [pushBusy, setPushBusy] = useState(false);

  /* ------------------------------------------------------------ history */
  useEffect(() => {
    let cancelled = false;
    setHistoryLoading(true);
    api
      .history()
      .then(({ history: h }) => {
        if (!cancelled) setHistory(h);
      })
      .catch(() => {
        /* non-fatal */
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [historyVersion]);

  /* ------------------------------------------------------------ filtering */
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.displayName.toLowerCase().includes(q) ||
        u.username.toLowerCase().includes(q)
    );
  }, [users, query]);

  const onlineCount = users.filter((u) => u.online).length;
  const selectedUsers = users.filter((u) => selected.has(u.id));
  const groupMode = selected.size > 0;

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 5) next.add(id);
      return next;
    });
  };

  const startGroup = (video: boolean) => {
    if (!selectedUsers.length) return;
    onCall(selectedUsers, video);
    setSelected(new Set());
  };

  const handleEnablePush = async () => {
    setPushBusy(true);
    setPush(await enablePush());
    setPushBusy(false);
  };

  /* ---------------------------------------------------------------- render */
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ------------------------------------------------------- header */}
      <header className="shrink-0 border-b border-white/10 px-4 py-3.5 safe-top">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <Avatar
            src={self.avatarUrl}
            name={self.displayName}
            id={self.id}
            size="h-11 w-11"
            online={connected}
            ring
          />
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{self.displayName}</p>
            <p className="flex items-center gap-1.5 text-xs text-slate-400">
              <span
                className={cx(
                  "inline-block h-1.5 w-1.5 rounded-full",
                  connected ? "bg-emerald-400" : "bg-amber-400"
                )}
              />
              {connected ? "Online" : "Connecting…"}
            </p>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="rounded-xl p-2.5 text-slate-400 transition hover:bg-white/10 hover:text-white"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOutIcon className="h-5 w-5" />
          </button>
        </div>
      </header>

      {/* --------------------------------------------------------- tabs */}
      <div className="shrink-0 px-4 pt-4">
        <div className="mx-auto flex max-w-3xl gap-1 rounded-xl bg-ink-800/70 p-1 text-sm font-medium">
          <button
            type="button"
            onClick={() => setTab("contacts")}
            className={cx(
              "flex flex-1 items-center justify-center gap-2 rounded-lg py-2 transition",
              tab === "contacts"
                ? "bg-accent-500 text-white shadow"
                : "text-slate-400 hover:text-slate-200"
            )}
          >
            <UsersIcon className="h-4 w-4" />
            Contacts
            <span className="text-xs opacity-70">({onlineCount} online)</span>
          </button>
          <button
            type="button"
            onClick={() => setTab("history")}
            className={cx(
              "flex flex-1 items-center justify-center gap-2 rounded-lg py-2 transition",
              tab === "history"
                ? "bg-accent-500 text-white shadow"
                : "text-slate-400 hover:text-slate-200"
            )}
          >
            <ClockIcon className="h-4 w-4" />
            History
          </button>
        </div>
      </div>

      {/* ------------------------------------------------------- content */}
      <div className="scroll-slim min-h-0 flex-1 overflow-y-auto px-4 pb-28 pt-4">
        <div className="mx-auto max-w-3xl">
          {/* push notification nudge */}
          {tab === "contacts" &&
            pushSupported() &&
            push !== "granted" &&
            push !== "server-disabled" && (
              <div className="card mb-4 flex items-center gap-3 p-3.5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-500/15 text-accent-400">
                  <BellIcon className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {push === "denied"
                      ? "Notifications are blocked"
                      : "Get notified about calls"}
                  </p>
                  <p className="text-xs text-slate-400">
                    {push === "denied"
                      ? "Re-enable notifications in your browser's site settings."
                      : "So you don't miss a call while this tab is in the background."}
                  </p>
                </div>
                {push !== "denied" && (
                  <button
                    type="button"
                    onClick={() => void handleEnablePush()}
                    disabled={pushBusy}
                    className="btn-ghost shrink-0 !px-3 !py-2 text-sm"
                  >
                    {pushBusy ? <SpinnerIcon className="h-4 w-4" /> : "Enable"}
                  </button>
                )}
              </div>
            )}

          {tab === "contacts" ? (
            <>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search people…"
                className="field mb-4 !py-2.5"
                aria-label="Search people"
              />

              {usersLoading ? (
                <div className="flex justify-center py-14 text-slate-400">
                  <SpinnerIcon className="h-6 w-6" />
                </div>
              ) : filtered.length === 0 ? (
                <div className="py-14 text-center">
                  <p className="text-sm text-slate-400">
                    {users.length === 0
                      ? "No one else has signed up yet."
                      : "No one matches that search."}
                  </p>
                  {users.length === 0 && (
                    <p className="mt-2 text-xs text-slate-500">
                      Open a second browser window and sign in as another demo
                      account to try a call.
                    </p>
                  )}
                </div>
              ) : (
                <ul className="space-y-2">
                  {filtered.map((u) => {
                    const isSelected = selected.has(u.id);
                    return (
                      <li
                        key={u.id}
                        className={cx(
                          "card flex items-center gap-3 p-3 transition",
                          isSelected && "ring-1 ring-accent-500/60"
                        )}
                      >
                        {/* selection checkbox for group calls */}
                        <button
                          type="button"
                          onClick={() => toggleSelect(u.id)}
                          className="shrink-0"
                          aria-label={
                            isSelected
                              ? `Remove ${u.displayName} from group call`
                              : `Add ${u.displayName} to group call`
                          }
                          aria-pressed={isSelected}
                        >
                          <span className="relative block">
                            <Avatar
                              src={u.avatarUrl}
                              name={u.displayName}
                              id={u.id}
                              size="h-12 w-12"
                              online={u.online}
                            />
                            {isSelected && (
                              <span className="absolute inset-0 flex items-center justify-center rounded-full bg-accent-500/85">
                                <svg
                                  className="h-6 w-6 text-white"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="3"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>
                              </span>
                            )}
                          </span>
                        </button>

                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">
                            {u.displayName}
                          </p>
                          <p className="truncate text-xs text-slate-400">
                            {u.online
                              ? "Online"
                              : u.lastSeen
                              ? `Last seen ${formatRelative(u.lastSeen)}`
                              : "Offline"}
                          </p>
                        </div>

                        {!groupMode && (
                          <div className="flex shrink-0 gap-1.5">
                            <button
                              type="button"
                              onClick={() => onCall([u], false)}
                              disabled={!u.online || !connected}
                              className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-500/90 text-white transition hover:bg-emerald-500 active:scale-95 disabled:opacity-40 disabled:hover:bg-emerald-500/90"
                              aria-label={`Audio call ${u.displayName}`}
                              title={
                                u.online ? "Audio call" : "User is offline"
                              }
                            >
                              <PhoneIcon className="h-5 w-5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onCall([u], true)}
                              disabled={!u.online || !connected}
                              className="flex h-11 w-11 items-center justify-center rounded-full bg-accent-500/90 text-white transition hover:bg-accent-500 active:scale-95 disabled:opacity-40 disabled:hover:bg-accent-500/90"
                              aria-label={`Video call ${u.displayName}`}
                              title={
                                u.online ? "Video call" : "User is offline"
                              }
                            >
                              <VideoIcon className="h-5 w-5" />
                            </button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          ) : (
            /* --------------------------------------------------- history */
            <>
              {historyLoading ? (
                <div className="flex justify-center py-14 text-slate-400">
                  <SpinnerIcon className="h-6 w-6" />
                </div>
              ) : history.length === 0 ? (
                <div className="py-14 text-center">
                  <ClockIcon className="mx-auto mb-3 h-10 w-10 text-slate-600" />
                  <p className="text-sm text-slate-400">No calls yet.</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Your call history lives here.
                  </p>
                </div>
              ) : (
                <ul className="space-y-2">
                  {history.map((h) => {
                    const outgoing = h.initiatorId === self.id;
                    const others = h.participants.filter(
                      (p) => p.id !== self.id
                    );
                    const missed =
                      h.status === "missed" ||
                      (h.status === "rejected" && !outgoing);
                    const label =
                      joinNames(others.map((o) => o.displayName), 2) ||
                      "Unknown";

                    const statusText =
                      h.status === "completed"
                        ? formatDuration(h.durationSec)
                        : h.status === "missed"
                        ? outgoing
                          ? "No answer"
                          : "Missed"
                        : h.status === "rejected"
                        ? outgoing
                          ? "Declined"
                          : "You declined"
                        : "Canceled";

                    return (
                      <li key={h.id} className="card flex items-center gap-3 p-3">
                        <div className="relative shrink-0">
                          <Avatar
                            src={others[0]?.avatarUrl}
                            name={others[0]?.displayName ?? "?"}
                            id={others[0]?.id}
                            size="h-11 w-11"
                          />
                          {others.length > 1 && (
                            <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-ink-700 text-[10px] font-semibold ring-2 ring-ink-900">
                              +{others.length - 1}
                            </span>
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <p
                            className={cx(
                              "truncate font-medium",
                              missed && "text-rose-300"
                            )}
                          >
                            {label}
                          </p>
                          <p className="flex items-center gap-1.5 truncate text-xs text-slate-400">
                            {h.status === "completed" ? (
                              outgoing ? (
                                <ArrowOutgoingIcon className="h-3.5 w-3.5 text-emerald-400" />
                              ) : (
                                <ArrowIncomingIcon className="h-3.5 w-3.5 text-emerald-400" />
                              )
                            ) : (
                              <PhoneOffIcon className="h-3.5 w-3.5 text-rose-400" />
                            )}
                            {statusText}
                            <span className="text-slate-600">·</span>
                            {h.video ? "Video" : "Audio"}
                            <span className="text-slate-600">·</span>
                            {formatRelative(h.startedAt)}
                          </p>
                        </div>

                        {others.length === 1 && (
                          <button
                            type="button"
                            onClick={() => {
                              const target = users.find(
                                (u) => u.id === others[0].id
                              );
                              if (target) onCall([target], h.video);
                            }}
                            disabled={
                              !connected ||
                              !users.find((u) => u.id === others[0].id)?.online
                            }
                            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/5 text-slate-300 transition hover:bg-white/15 hover:text-white active:scale-95 disabled:opacity-30"
                            aria-label={`Call ${others[0].displayName} back`}
                            title="Call back"
                          >
                            <PhoneIcon className="h-4.5 w-4.5" />
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </div>
      </div>

      {/* --------------------------------- group call action bar (sticky) */}
      {groupMode && tab === "contacts" && (
        <div className="fixed inset-x-0 bottom-0 z-20 animate-slide-up border-t border-white/10 bg-ink-900/95 px-4 py-3 backdrop-blur-xl safe-bottom">
          <div className="mx-auto flex max-w-3xl items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {joinNames(
                  selectedUsers.map((u) => u.displayName),
                  2
                )}
              </p>
              <p className="text-xs text-slate-400">
                {selected.size + 1} participants
                {selectedUsers.some((u) => !u.online) &&
                  " · some are offline"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="btn-ghost shrink-0 !px-3 !py-2 text-sm"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => startGroup(false)}
              disabled={!connected}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white transition hover:bg-emerald-600 active:scale-95 disabled:opacity-40"
              aria-label="Start group audio call"
              title="Group audio call"
            >
              <PhoneIcon className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => startGroup(true)}
              disabled={!connected}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent-500 text-white transition hover:bg-accent-600 active:scale-95 disabled:opacity-40"
              aria-label="Start group video call"
              title="Group video call"
            >
              <VideoIcon className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
