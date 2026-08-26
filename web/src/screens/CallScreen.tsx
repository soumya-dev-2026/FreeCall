import { useMemo, useState } from "react";
import { Avatar } from "../components/Avatar";
import { AudioSink, Video } from "../components/Video";
import { ChatPanel } from "../components/ChatPanel";
import {
  ChatIcon,
  FlipCameraIcon,
  MicIcon,
  MicOffIcon,
  PhoneOffIcon,
  ScreenShareIcon,
  ScreenShareOffIcon,
  SpinnerIcon,
  UsersIcon,
  VideoIcon,
  VideoOffIcon,
} from "../components/Icons";
import { cx, formatDuration, joinNames } from "../lib/utils";
import { isProbablyMobile } from "../lib/media";
import type { CallController, Participant } from "../state/useCall";
import type { AuthUser } from "../shared/types";

interface Props {
  call: CallController;
  self: AuthUser;
}

/** Grid columns that keep tiles reasonably square for 1–6 participants. */
function gridClass(count: number): string {
  if (count <= 1) return "grid-cols-1";
  if (count === 2) return "grid-cols-1 sm:grid-cols-2";
  if (count <= 4) return "grid-cols-2";
  return "grid-cols-2 sm:grid-cols-3";
}

function PeerTile({ p }: { p: Participant }) {
  const showVideo =
    Boolean(p.stream?.getVideoTracks().length) &&
    (p.media.video || p.media.screen);
  const connecting =
    p.connState === "new" ||
    p.connState === "connecting" ||
    p.connState === "disconnected";

  return (
    <div className="relative flex min-h-0 items-center justify-center overflow-hidden rounded-2xl bg-ink-800/70 ring-1 ring-white/10">
      {showVideo ? (
        <Video
          stream={p.stream}
          muted
          fit={p.media.screen ? "contain" : "cover"}
        />
      ) : (
        <div className="flex flex-col items-center gap-3 p-4">
          <Avatar
            src={p.user.avatarUrl}
            name={p.user.displayName}
            id={p.user.id}
            size="h-20 w-20 sm:h-24 sm:w-24"
            ring
          />
          <p className="max-w-full truncate text-sm font-medium">
            {p.user.displayName}
          </p>
        </div>
      )}

      {/* name + status chips */}
      <div className="pointer-events-none absolute inset-x-2 bottom-2 flex items-center gap-1.5">
        {showVideo && (
          <span className="max-w-[60%] truncate rounded-lg bg-black/55 px-2 py-1 text-xs font-medium backdrop-blur">
            {p.user.displayName}
          </span>
        )}
        {!p.media.audio && (
          <span
            className="flex items-center gap-1 rounded-lg bg-black/55 px-1.5 py-1 text-xs backdrop-blur"
            title={`${p.user.displayName} is muted`}
          >
            <MicOffIcon className="h-3.5 w-3.5 text-rose-400" />
          </span>
        )}
        {p.media.screen && (
          <span className="flex items-center gap-1 rounded-lg bg-accent-500/85 px-2 py-1 text-[11px] font-medium backdrop-blur">
            <ScreenShareIcon className="h-3.5 w-3.5" />
            Sharing
          </span>
        )}
      </div>

      {connecting && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-ink-950/60 backdrop-blur-sm">
          <SpinnerIcon className="h-6 w-6 text-accent-400" />
          <p className="text-xs text-slate-300">
            {p.connState === "disconnected" ? "Reconnecting…" : "Connecting…"}
          </p>
        </div>
      )}

      {p.connState === "failed" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-ink-950/70 p-3 text-center backdrop-blur-sm">
          <p className="text-sm font-medium text-rose-300">Connection failed</p>
          <p className="text-xs text-slate-400">
            A TURN server is usually needed on restrictive networks.
          </p>
        </div>
      )}
    </div>
  );
}

export function CallScreen({ call, self }: Props) {
  const [chatOpen, setChatOpenLocal] = useState(false);
  const mobile = useMemo(() => isProbablyMobile(), []);

  const {
    phase,
    callType,
    participants,
    ringingUsers,
    localStream,
    micOn,
    camOn,
    screenOn,
    facing,
    canFlip,
    messages,
    unread,
    elapsed,
    statusNote,
  } = call;

  const openChat = (open: boolean) => {
    setChatOpenLocal(open);
    call.setChatOpen(open);
  };

  const showLocalVideo = Boolean(localStream?.getVideoTracks().length) &&
    (camOn || screenOn);

  const ringing = phase === "outgoing";
  const peerCount = participants.length;

  const headline = ringing
    ? joinNames(ringingUsers.map((u) => u.displayName), 2) || "Calling…"
    : peerCount === 1
    ? participants[0].user.displayName
    : `${peerCount + 1} people`;

  const subline = ringing
    ? "Ringing…"
    : peerCount === 0
    ? "Waiting for others to join…"
    : formatDuration(elapsed);

  return (
    <div className="flex h-full min-h-0 flex-col sm:flex-row">
      {/* Remote audio always mounted, independent of the video grid */}
      {participants.map((p) => (
        <AudioSink key={`a-${p.user.id}`} stream={p.stream} />
      ))}

      <div className="relative flex min-h-0 flex-1 flex-col">
        {/* ------------------------------------------------------ header */}
        <header className="relative z-10 flex items-center justify-between gap-3 px-4 py-3 safe-top">
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold">{headline}</h1>
            <p
              className={cx(
                "text-xs",
                ringing ? "text-accent-400 animate-shimmer" : "text-slate-400"
              )}
            >
              {subline}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {callType === "group" && (
              <span className="flex items-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1.5 text-xs font-medium">
                <UsersIcon className="h-4 w-4" />
                {peerCount + 1}
              </span>
            )}
          </div>
        </header>

        {/* ------------------------------------------------ video / grid */}
        <main className="relative min-h-0 flex-1 px-3 pb-2">
          {ringing || peerCount === 0 ? (
            /* Outgoing / waiting state: show who we're calling */
            <div className="flex h-full flex-col items-center justify-center gap-6 text-center">
              <div className="relative flex items-center justify-center">
                {ringingUsers.slice(0, 3).map((u, i) => (
                  <span
                    key={u.id}
                    aria-hidden
                    className="absolute h-32 w-32 rounded-full bg-accent-400/20 animate-pulse-ring"
                    style={{ animationDelay: `${i * 0.6}s` }}
                  />
                ))}
                <div className="relative z-10 flex -space-x-4">
                  {(ringingUsers.length
                    ? ringingUsers
                    : participants.map((p) => p.user)
                  )
                    .slice(0, 3)
                    .map((u) => (
                      <Avatar
                        key={u.id}
                        src={u.avatarUrl}
                        name={u.displayName}
                        id={u.id}
                        size="h-28 w-28"
                        ring
                      />
                    ))}
                </div>
              </div>
              <div>
                <p className="text-xl font-semibold">{headline}</p>
                <p className="mt-1 text-sm text-slate-400">{subline}</p>
              </div>
            </div>
          ) : (
            <div
              className={cx(
                "grid h-full min-h-0 gap-2.5",
                gridClass(peerCount)
              )}
            >
              {participants.map((p) => (
                <PeerTile key={p.user.id} p={p} />
              ))}
            </div>
          )}

          {/* ------------------------------------- local picture-in-picture */}
          <div
            className={cx(
              "absolute right-5 z-20 overflow-hidden rounded-xl shadow-2xl ring-1 ring-white/15 transition-all",
              "h-32 w-24 sm:h-40 sm:w-[7.5rem]",
              chatOpen && !mobile ? "bottom-4" : "bottom-4"
            )}
          >
            {showLocalVideo ? (
              <Video
                stream={localStream}
                muted
                mirrored={facing === "user" && !screenOn}
                fit={screenOn ? "contain" : "cover"}
              />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-ink-800">
                <Avatar
                  src={self.avatarUrl}
                  name={self.displayName}
                  id={self.id}
                  size="h-12 w-12"
                />
                <span className="text-[10px] text-slate-400">Camera off</span>
              </div>
            )}
            <span className="absolute left-1.5 top-1.5 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-medium backdrop-blur">
              You
            </span>
            {!micOn && (
              <span className="absolute right-1.5 top-1.5 rounded-md bg-black/55 p-1 backdrop-blur">
                <MicOffIcon className="h-3 w-3 text-rose-400" />
              </span>
            )}
          </div>

          {/* transient status toast */}
          {statusNote && (
            <div
              role="status"
              className="absolute left-1/2 top-2 z-30 max-w-[90%] -translate-x-1/2 animate-slide-up rounded-xl bg-ink-800/95 px-4 py-2 text-center text-sm text-slate-200 shadow-xl ring-1 ring-white/10 backdrop-blur"
            >
              {statusNote}
            </div>
          )}
        </main>

        {/* ----------------------------------------------- control bar */}
        <footer className="relative z-10 px-4 pb-5 pt-2 safe-bottom">
          <div className="mx-auto flex max-w-lg items-center justify-center gap-2.5 sm:gap-3.5">
            <button
              type="button"
              onClick={call.toggleMic}
              className={micOn ? "ctrl-on" : "ctrl-off"}
              aria-label={micOn ? "Mute microphone" : "Unmute microphone"}
              aria-pressed={!micOn}
              title={micOn ? "Mute" : "Unmute"}
            >
              {micOn ? <MicIcon /> : <MicOffIcon />}
            </button>

            <button
              type="button"
              onClick={() => void call.toggleCamera()}
              className={camOn ? "ctrl-on" : "ctrl-off"}
              aria-label={camOn ? "Turn camera off" : "Turn camera on"}
              aria-pressed={!camOn}
              title={camOn ? "Camera off" : "Camera on"}
              disabled={screenOn}
            >
              {camOn ? <VideoIcon /> : <VideoOffIcon />}
            </button>

            {canFlip && (
              <button
                type="button"
                onClick={() => void call.flipCamera()}
                className="ctrl-on"
                aria-label="Switch camera"
                title={
                  facing === "user"
                    ? "Switch to back camera"
                    : "Switch to front camera"
                }
                disabled={!camOn || screenOn || call.backgroundMode !== "none"}
              >
                <FlipCameraIcon />
              </button>
            )}

            <label className="relative">
              <span className="sr-only">Virtual background</span>
              <select
                value={call.backgroundMode}
                onChange={(event) => void call.changeBackground(event.target.value as "none" | "blur" | "midnight" | "sunset")}
                disabled={!camOn || screenOn}
                className="h-11 max-w-[7.5rem] rounded-full border border-white/10 bg-ink-800 px-3 text-xs text-white outline-none disabled:cursor-not-allowed disabled:opacity-40 sm:max-w-none"
                title="Virtual background"
                aria-label="Virtual background"
              >
                <option value="none">Background: none</option>
                <option value="blur">Background: blur</option>
                <option value="midnight">Background: midnight</option>
                <option value="sunset">Background: sunset</option>
              </select>
            </label>

            <button
              type="button"
              onClick={() => void call.toggleScreenShare()}
              className={screenOn ? "ctrl-accent" : "ctrl-on"}
              aria-label={screenOn ? "Stop sharing screen" : "Share screen"}
              aria-pressed={screenOn}
              title={screenOn ? "Stop sharing" : "Share screen"}
            >
              {screenOn ? <ScreenShareOffIcon /> : <ScreenShareIcon />}
            </button>

            <button
              type="button"
              onClick={() => openChat(!chatOpen)}
              className={cx("relative", chatOpen ? "ctrl-accent" : "ctrl-on")}
              aria-label="Toggle chat"
              aria-pressed={chatOpen}
              title="Chat"
            >
              <ChatIcon />
              {unread > 0 && !chatOpen && (
                <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={call.hangUp}
              className="ctrl-danger"
              aria-label="Hang up"
              title="Hang up"
            >
              <PhoneOffIcon />
            </button>
          </div>
        </footer>
      </div>

      <ChatPanel
        messages={messages}
        selfId={self.id}
        open={chatOpen}
        onClose={() => openChat(false)}
        onSend={call.sendMessage}
      />
    </div>
  );
}
