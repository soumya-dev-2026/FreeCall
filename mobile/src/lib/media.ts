/**
 * Media acquisition + camera helpers (React Native).
 *
 * react-native-webrtc gives us a `mediaDevices` shim that looks like the web
 * API, with one very welcome addition: video tracks expose `_switchCamera()`,
 * so flipping the camera is a native-side swap that doesn't disturb the
 * transceiver at all — no replaceTrack, no renegotiation, nothing.
 */

import { Platform } from "react-native";
import {
  mediaDevices,
  type MediaStream,
  type MediaStreamTrack,
} from "react-native-webrtc";

export interface LocalMedia {
  stream: MediaStream;
  audio: MediaStreamTrack | null;
  video: MediaStreamTrack | null;
  /** True when we asked for video but only got audio. */
  videoDegraded: boolean;
}

export function describeMediaError(err: unknown): string {
  const e = err as { name?: string; message?: string };
  const name = e?.name ?? "";
  const msg = e?.message ?? String(err);

  if (/permission/i.test(msg) || name === "NotAllowedError") {
    return Platform.OS === "ios"
      ? "Microphone/camera access was denied. Enable it in Settings › FreeCall."
      : "Microphone/camera access was denied. Enable it in Android Settings › Apps › FreeCall › Permissions.";
  }
  if (name === "NotFoundError" || /not found|no device/i.test(msg)) {
    return "No microphone or camera was found on this device.";
  }
  if (name === "NotReadableError" || /in use|busy/i.test(msg)) {
    return "Your microphone or camera is already in use by another app.";
  }
  return msg || "Could not start audio/video.";
}

/**
 * Acquire local media, degrading to audio-only if the camera fails for a
 * reason other than an outright permission denial.
 */
export async function getLocalStream(wantVideo: boolean): Promise<LocalMedia> {
  const audioConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };

  if (wantVideo) {
    try {
      const stream = (await mediaDevices.getUserMedia({
        audio: audioConstraints,
        video: {
          facingMode: "user",
          width: { min: 640, ideal: 1280 },
          height: { min: 360, ideal: 720 },
          frameRate: { min: 15, ideal: 30 },
        },
      } as any)) as MediaStream;

      return {
        stream,
        audio: stream.getAudioTracks()[0] ?? null,
        video: stream.getVideoTracks()[0] ?? null,
        videoDegraded: false,
      };
    } catch (err) {
      const e = err as { name?: string; message?: string };
      const denied =
        e?.name === "NotAllowedError" || /permission/i.test(e?.message ?? "");
      if (denied) throw err;
      // Camera unavailable but mic might work — fall through to audio-only.
    }
  }

  const stream = (await mediaDevices.getUserMedia({
    audio: audioConstraints,
    video: false,
  } as any)) as MediaStream;

  return {
    stream,
    audio: stream.getAudioTracks()[0] ?? null,
    video: null,
    videoDegraded: wantVideo,
  };
}

/** Add a camera track to an existing audio-only stream. */
export async function getCameraTrack(): Promise<MediaStreamTrack> {
  const stream = (await mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: "user",
      width: { min: 640, ideal: 1280 },
      height: { min: 360, ideal: 720 },
      frameRate: { min: 15, ideal: 30 },
    },
  } as any)) as MediaStream;

  const track = stream.getVideoTracks()[0];
  if (!track) throw new Error("Camera returned no video track.");
  return track;
}

/**
 * Flip between front and back cameras.
 *
 * Unlike the web, this mutates the existing track in place — the same
 * MediaStreamTrack object keeps flowing through the same sender, so there is
 * nothing to re-signal. Returns false if the platform refused.
 */
export async function switchCamera(
  track: MediaStreamTrack | null
): Promise<boolean> {
  if (!track) return false;
  const anyTrack = track as unknown as {
    _switchCamera?: () => void;
    applyConstraints?: (c: unknown) => Promise<void>;
  };
  try {
    if (typeof anyTrack._switchCamera === "function") {
      anyTrack._switchCamera();
      return true;
    }
    if (typeof anyTrack.applyConstraints === "function") {
      await anyTrack.applyConstraints({
        facingMode: { exact: "environment" },
      });
      return true;
    }
  } catch (err) {
    console.warn("[media] switchCamera failed:", (err as Error).message);
  }
  return false;
}

/**
 * Screen capture.
 *
 * Android needs a MediaProjection foreground service (declared in app.json)
 * and iOS needs a Broadcast Upload Extension, which `expo prebuild` cannot
 * generate. So on iOS we report this as unsupported rather than crashing, and
 * the UI hides the button accordingly.
 */
export function canShareScreen(): boolean {
  return (
    Platform.OS === "android" &&
    typeof (mediaDevices as { getDisplayMedia?: unknown }).getDisplayMedia ===
      "function"
  );
}

export async function getScreenStream(): Promise<MediaStream> {
  if (!canShareScreen()) {
    throw new Error(
      Platform.OS === "ios"
        ? "Screen sharing on iOS needs a Broadcast Upload Extension, which isn't included in this build. Use the web app to share a screen."
        : "Screen sharing isn't available on this device."
    );
  }
  const md = mediaDevices as unknown as {
    getDisplayMedia: (c?: unknown) => Promise<MediaStream>;
  };
  return md.getDisplayMedia({ video: true, audio: false });
}

export function stopStream(stream: MediaStream | null): void {
  if (!stream) return;
  for (const t of stream.getTracks()) {
    try {
      t.stop();
    } catch {
      /* already stopped */
    }
  }
}
