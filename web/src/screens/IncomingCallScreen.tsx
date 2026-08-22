import { useMemo } from "react";
import { Avatar } from "../components/Avatar";
import {
  PhoneIcon,
  PhoneOffIcon,
  UsersIcon,
  VideoIcon,
} from "../components/Icons";
import { joinNames } from "../lib/utils";
import type { IncomingCall } from "../state/useCall";

interface Props {
  incoming: IncomingCall;
  selfId: string;
  onAccept: () => void;
  onReject: () => void;
}

/**
 * Full-screen incoming call UI.
 *
 * The caller's own avatar is the backdrop (blurred and dimmed) as well as the
 * focal point, so you recognise who's calling before reading any text —
 * personalised per caller, as requested.
 */
export function IncomingCallScreen({
  incoming,
  selfId,
  onAccept,
  onReject,
}: Props) {
  const { from, video, type, participants } = incoming;

  const otherInvitees = useMemo(
    () =>
      participants
        .filter((p) => p.id !== selfId && p.id !== from.id)
        .map((p) => p.displayName),
    [participants, selfId, from.id]
  );

  return (
    <div className="relative flex min-h-full flex-col items-center justify-between overflow-hidden px-6 py-12 safe-top safe-bottom">
      {/* Caller's photo as an ambient, blurred backdrop */}
      {from.avatarUrl && (
        <img
          src={from.avatarUrl}
          alt=""
          aria-hidden
          className="pointer-events-none absolute inset-0 h-full w-full scale-125 object-cover opacity-25 blur-3xl"
        />
      )}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-ink-950/70 via-ink-950/40 to-ink-950"
      />

      {/* ---------------------------------------------------- caller info */}
      <div className="relative z-10 flex flex-1 flex-col items-center justify-center text-center">
        <p className="mb-1 flex items-center gap-2 text-sm font-medium uppercase tracking-[0.18em] text-accent-400">
          {type === "group" ? (
            <UsersIcon className="h-4 w-4" />
          ) : video ? (
            <VideoIcon className="h-4 w-4" />
          ) : (
            <PhoneIcon className="h-4 w-4" />
          )}
          Incoming {type === "group" ? "group " : ""}
          {video ? "video" : "audio"} call
        </p>

        {/* pulsing rings behind the avatar */}
        <div className="relative my-8 flex items-center justify-center">
          <span
            aria-hidden
            className="absolute h-40 w-40 rounded-full bg-accent-400/25 animate-pulse-ring"
          />
          <span
            aria-hidden
            className="absolute h-40 w-40 rounded-full bg-accent-400/20 animate-pulse-ring"
            style={{ animationDelay: "0.65s" }}
          />
          <span
            aria-hidden
            className="absolute h-40 w-40 rounded-full bg-accent-400/15 animate-pulse-ring"
            style={{ animationDelay: "1.3s" }}
          />
          <Avatar
            src={from.avatarUrl}
            name={from.displayName}
            id={from.id}
            size="h-40 w-40"
            className="relative z-10 drop-shadow-2xl"
            ring
          />
        </div>

        <h1 className="text-4xl font-semibold tracking-tight">
          {from.displayName}
        </h1>
        <p className="mt-1.5 text-sm text-slate-400">@{from.username}</p>

        {otherInvitees.length > 0 && (
          <p className="mt-4 max-w-xs text-sm text-slate-400">
            with {joinNames(otherInvitees, 2)}
          </p>
        )}

        <p className="mt-8 text-sm text-slate-400 animate-shimmer">Ringing…</p>
      </div>

      {/* ------------------------------------------------------- actions */}
      <div className="relative z-10 flex w-full max-w-xs items-end justify-between">
        <button
          type="button"
          onClick={onReject}
          className="group flex flex-col items-center gap-2.5"
          aria-label="Decline call"
        >
          <span className="flex h-[70px] w-[70px] items-center justify-center rounded-full bg-rose-500 text-white shadow-xl shadow-rose-500/30 transition group-hover:bg-rose-600 group-active:scale-95">
            <PhoneOffIcon className="h-7 w-7" />
          </span>
          <span className="text-xs font-medium text-slate-400">Decline</span>
        </button>

        <button
          type="button"
          onClick={onAccept}
          className="group flex flex-col items-center gap-2.5"
          aria-label="Accept call"
        >
          <span className="relative flex h-[70px] w-[70px] items-center justify-center rounded-full bg-emerald-500 text-white shadow-xl shadow-emerald-500/30 transition group-hover:bg-emerald-600 group-active:scale-95">
            <span
              aria-hidden
              className="absolute inset-0 rounded-full bg-emerald-400/40 animate-pulse-ring"
            />
            {video ? (
              <VideoIcon className="relative h-7 w-7" />
            ) : (
              <PhoneIcon className="relative h-7 w-7" />
            )}
          </span>
          <span className="text-xs font-medium text-slate-400">Accept</span>
        </button>
      </div>
    </div>
  );
}
