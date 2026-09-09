import { useEffect, useRef, useState } from "react";
import { cx } from "../lib/utils";

interface VideoProps {
  stream: MediaStream | null;
  muted?: boolean;
  /** Mirror the picture — right for a front-facing camera preview. */
  mirrored?: boolean;
  className?: string;
  /** "cover" fills the tile (camera); "contain" fits it (shared screens). */
  fit?: "cover" | "contain";
}

/**
 * A <video> element bound to a MediaStream.
 *
 * Two details that matter in practice: `srcObject` must be set imperatively
 * (React can't do it via props), and `play()` can reject on mobile if it races
 * with a layout change — so the rejection is swallowed rather than logged as an
 * error, since the element usually starts playing on the next tick anyway.
 */
export function Video({
  stream,
  muted = false,
  mirrored = false,
  className,
  fit = "cover",
}: VideoProps) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) {
      el.srcObject = stream;
    }
    if (stream) {
      const p = el.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    }
  }, [stream]);

  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted={muted}
      className={cx(
        "h-full w-full bg-ink-950",
        fit === "cover" ? "object-cover" : "object-contain",
        mirrored && "scale-x-[-1]",
        className
      )}
    />
  );
}

interface AudioProps {
  stream: MediaStream | null;
}

/**
 * Hidden <audio> sink for a remote peer.
 *
 * In a mesh call we render remote audio separately from video so that audio
 * keeps playing even when a participant's video tile isn't mounted (e.g. they
 * scrolled out of the grid, or the call is audio-only).
 */
export function AudioSink({ stream }: AudioProps) {
  const ref = useRef<HTMLAudioElement>(null);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let disposed = false;
    el.srcObject = stream;
    setBlocked(false);
    const play = () => {
      if (!stream) return;
      void el.play().then(
        () => { if (!disposed) setBlocked(false); },
        () => { if (!disposed) setBlocked(true); }
      );
    };
    play();
    // Tracks can arrive separately on the same stable MediaStream object.
    stream?.addEventListener("addtrack", play);
    return () => {
      disposed = true;
      stream?.removeEventListener("addtrack", play);
      el.srcObject = null;
    };
  }, [stream]);

  return (
    <>
      <audio ref={ref} autoPlay className="hidden" />
      {blocked && (
        <button
          type="button"
          className="fixed left-1/2 top-20 z-50 -translate-x-1/2 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-black shadow-lg"
          onClick={() => {
            void ref.current?.play().then(
              () => setBlocked(false),
              () => setBlocked(true)
            );
          }}
        >
          Tap to hear call audio
        </button>
      )}
    </>
  );
}
