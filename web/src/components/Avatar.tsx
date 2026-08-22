import { useState } from "react";
import { colorFor, cx, initialsOf } from "../lib/utils";

interface AvatarProps {
  src?: string;
  name: string;
  id?: string;
  /** Tailwind size classes, e.g. "h-12 w-12" */
  size?: string;
  className?: string;
  /** Show a presence dot */
  online?: boolean;
  ring?: boolean;
}

/**
 * Avatar with a graceful fallback: if the image fails (or there is none) we
 * render coloured initials instead, so the incoming-call screen is never a
 * broken-image icon.
 */
export function Avatar({
  src,
  name,
  id,
  size = "h-12 w-12",
  className,
  online,
  ring,
}: AvatarProps) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(src) && !failed;

  return (
    <div className={cx("relative shrink-0", size, className)}>
      {showImage ? (
        <img
          src={src}
          alt=""
          onError={() => setFailed(true)}
          className={cx(
            "h-full w-full rounded-full object-cover bg-ink-700",
            ring && "ring-2 ring-white/20"
          )}
        />
      ) : (
        <div
          className={cx(
            "flex h-full w-full items-center justify-center rounded-full font-semibold text-white",
            colorFor(id ?? name),
            ring && "ring-2 ring-white/20"
          )}
        >
          <span className="text-[0.42em] leading-none tracking-wide">
            {initialsOf(name)}
          </span>
        </div>
      )}

      {online !== undefined && (
        <span
          className={cx(
            "absolute bottom-0 right-0 block rounded-full border-2 border-ink-900",
            "h-[28%] w-[28%] min-h-[10px] min-w-[10px]",
            online ? "bg-emerald-400" : "bg-slate-500"
          )}
          aria-label={online ? "Online" : "Offline"}
        />
      )}
    </div>
  );
}
