/**
 * Media device helpers: acquiring the local stream, enumerating cameras, and
 * flipping between front/back on mobile.
 */

export interface MediaError extends Error {
  kind:
    | "denied"
    | "not-found"
    | "in-use"
    | "insecure-context"
    | "unsupported"
    | "unknown";
}

function mediaError(kind: MediaError["kind"], message: string): MediaError {
  return Object.assign(new Error(message), { kind }) as MediaError;
}

/** Translate the browser's opaque getUserMedia errors into actionable ones. */
export function describeMediaError(err: unknown): MediaError {
  if (!window.isSecureContext) {
    return mediaError(
      "insecure-context",
      "Camera and microphone need a secure context. Use https:// or localhost."
    );
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return mediaError(
      "unsupported",
      "This browser doesn't support camera/microphone capture."
    );
  }
  const name = (err as { name?: string })?.name ?? "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return mediaError(
        "denied",
        "Permission denied. Allow microphone (and camera) access, then try again."
      );
    case "NotFoundError":
    case "OverconstrainedError":
      return mediaError(
        "not-found",
        "No matching microphone or camera was found on this device."
      );
    case "NotReadableError":
    case "AbortError":
      return mediaError(
        "in-use",
        "Your microphone or camera is already in use by another app."
      );
    default:
      return mediaError(
        "unknown",
        (err as Error)?.message || "Could not access your microphone/camera."
      );
  }
}

export type Facing = "user" | "environment";

/**
 * Acquire the local stream. Audio is always requested (this is a calling app);
 * video is optional. If video is requested but unavailable, we retry with
 * audio-only rather than failing the whole call.
 */
export async function getLocalStream(opts: {
  video: boolean;
  facing?: Facing;
  deviceId?: string;
}): Promise<{ stream: MediaStream; videoFailed: boolean }> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw describeMediaError(new Error("unsupported"));
  }

  const audio: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };

  const buildVideo = (): MediaTrackConstraints => {
    const v: MediaTrackConstraints = {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30, max: 30 },
    };
    if (opts.deviceId) v.deviceId = { exact: opts.deviceId };
    else if (opts.facing) v.facingMode = { ideal: opts.facing };
    return v;
  };

  if (opts.video) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio,
        video: buildVideo(),
      });
      return { stream, videoFailed: false };
    } catch (err) {
      const e = describeMediaError(err);
      // Hard failures (permission/secure-context) should surface immediately.
      if (e.kind === "denied" || e.kind === "insecure-context") throw e;
      // Otherwise degrade to audio-only — a call without video still works.
    }
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio });
    return { stream, videoFailed: opts.video };
  } catch (err) {
    throw describeMediaError(err);
  }
}

/** All video input devices (labels are empty until permission is granted). */
export async function listCameras(): Promise<MediaDeviceInfo[]> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === "videoinput");
  } catch {
    return [];
  }
}

/** True when flipping cameras is meaningful (more than one camera present). */
export async function canFlipCamera(): Promise<boolean> {
  const cams = await listCameras();
  if (cams.length > 1) return true;
  // Some mobile browsers hide the second camera until permission is granted,
  // but do report facingMode support.
  const supported = navigator.mediaDevices.getSupportedConstraints?.();
  return Boolean(supported?.facingMode) && isProbablyMobile();
}

export function isProbablyMobile(): boolean {
  return (
    /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints ?? 0) > 1
  );
}

/**
 * Get a new video track for the opposite camera.
 * Prefers explicit deviceId cycling (reliable on desktop + Android) and falls
 * back to facingMode (needed on iOS Safari).
 */
export async function getFlippedVideoTrack(
  currentTrack: MediaStreamTrack | null,
  desiredFacing: Facing
): Promise<{ track: MediaStreamTrack; facing: Facing; deviceId?: string }> {
  const cams = await listCameras();
  const currentId = currentTrack?.getSettings().deviceId;

  // Try to pick a *different* camera by device id.
  if (cams.length > 1) {
    const next =
      cams.find((c) => c.deviceId !== currentId) ?? cams[0];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: { exact: next.deviceId },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      const track = stream.getVideoTracks()[0];
      const facing =
        (track.getSettings().facingMode as Facing | undefined) ?? desiredFacing;
      return { track, facing, deviceId: next.deviceId };
    } catch {
      /* fall through to facingMode */
    }
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: desiredFacing },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
  });
  const track = stream.getVideoTracks()[0];
  return {
    track,
    facing:
      (track.getSettings().facingMode as Facing | undefined) ?? desiredFacing,
    deviceId: track.getSettings().deviceId,
  };
}

/** Screen/tab/window capture. Returns null if the user cancels the picker. */
export async function getDisplayStream(): Promise<MediaStream | null> {
  const md = navigator.mediaDevices as MediaDevices & {
    getDisplayMedia?: (c?: DisplayMediaStreamOptions) => Promise<MediaStream>;
  };
  if (!md.getDisplayMedia) {
    throw mediaError(
      "unsupported",
      "Screen sharing isn't supported in this browser."
    );
  }
  try {
    return await md.getDisplayMedia({
      video: { frameRate: { ideal: 15, max: 30 } },
      // Sharing tab audio when the user opts in; harmless if unsupported.
      audio: false,
    });
  } catch (err) {
    const name = (err as { name?: string })?.name;
    if (name === "NotAllowedError" || name === "AbortError") return null;
    throw describeMediaError(err);
  }
}

export function stopStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((t) => {
    try {
      t.stop();
    } catch {
      /* ignore */
    }
  });
}
