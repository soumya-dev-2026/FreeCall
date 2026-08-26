import { SelfieSegmentation, type Results } from "@mediapipe/selfie_segmentation";

export type BackgroundMode = "none" | "blur" | "midnight" | "sunset";

export interface VirtualBackgroundProcessor {
  track: MediaStreamTrack;
  sourceTrack: MediaStreamTrack;
  setMode: (mode: Exclude<BackgroundMode, "none">) => void;
  stop: (stopSource?: boolean) => Promise<void>;
}

/** Segment and composite the caller locally, then expose a canvas video track. */
export async function createVirtualBackground(
  sourceTrack: MediaStreamTrack,
  initialMode: Exclude<BackgroundMode, "none">
): Promise<VirtualBackgroundProcessor> {
  const settings = sourceTrack.getSettings();
  const width = settings.width ?? 960;
  const height = settings.height ?? 540;
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = new MediaStream([sourceTrack]);
  await video.play();

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx || !canvas.captureStream) {
    throw new Error("Virtual backgrounds are not supported in this browser.");
  }

  let mode = initialMode;
  let running = true;
  let busy = false;
  let raf = 0;
  const segmenter = new SelfieSegmentation({
    locateFile: (file) => `/mediapipe/selfie_segmentation/${file}`,
  });
  segmenter.setOptions({ modelSelection: 1, selfieMode: true });
  segmenter.onResults((result: Results) => {
    ctx.save();
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(result.segmentationMask, 0, 0, width, height);
    ctx.globalCompositeOperation = "source-in";
    ctx.drawImage(result.image, 0, 0, width, height);
    ctx.globalCompositeOperation = "destination-over";
    if (mode === "blur") {
      ctx.filter = "blur(18px)";
      ctx.drawImage(result.image, -24, -24, width + 48, height + 48);
      ctx.filter = "none";
    } else {
      const gradient = ctx.createLinearGradient(0, 0, width, height);
      if (mode === "sunset") {
        gradient.addColorStop(0, "#fb7185");
        gradient.addColorStop(0.5, "#7c3aed");
        gradient.addColorStop(1, "#172554");
      } else {
        gradient.addColorStop(0, "#0f172a");
        gradient.addColorStop(0.55, "#172554");
        gradient.addColorStop(1, "#0f766e");
      }
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
    }
    ctx.restore();
    busy = false;
  });

  await segmenter.initialize();
  const render = async () => {
    if (!running) return;
    if (!busy && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      busy = true;
      try {
        await segmenter.send({ image: video });
      } catch {
        busy = false;
      }
    }
    raf = requestAnimationFrame(render);
  };
  raf = requestAnimationFrame(render);

  const track = canvas.captureStream(24).getVideoTracks()[0];
  if (!track) throw new Error("Could not create the virtual background video.");
  return {
    track,
    sourceTrack,
    setMode: (next) => { mode = next; },
    stop: async (stopSource = false) => {
      running = false;
      cancelAnimationFrame(raf);
      track.stop();
      video.pause();
      video.srcObject = null;
      if (stopSource) sourceTrack.stop();
      await segmenter.close();
    },
  };
}
