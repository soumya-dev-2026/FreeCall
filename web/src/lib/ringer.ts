/**
 * Ringtone playback for incoming/outgoing calls.
 *
 * Browsers block autoplay until the user has interacted with the page. We try
 * to play the mp3 and, if that's blocked, fall back to a WebAudio-synthesized
 * ring (WebAudio can often start from a prior interaction's audio context).
 * Either way, the caller gets *some* audible feedback and never a crash.
 */

const RINGTONE_URL = "/sounds/ringtone.mp3";
const DB_NAME = "freecall-settings";
const STORE_NAME = "audio";
const CUSTOM_KEY = "ringtone";

function ringtoneStore(mode: IDBTransactionMode): Promise<IDBObjectStore> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result.transaction(STORE_NAME, mode).objectStore(STORE_NAME));
  });
}

async function customRingtone(): Promise<Blob | null> {
  const store = await ringtoneStore("readonly");
  return new Promise((resolve, reject) => {
    const request = store.get(CUSTOM_KEY);
    request.onsuccess = () => resolve(request.result instanceof Blob ? request.result : null);
    request.onerror = () => reject(request.error);
  });
}

export async function setCustomRingtone(file: File): Promise<void> {
  if (!file.type.startsWith("audio/")) throw new Error("Choose an audio file.");
  if (file.size > 8 * 1024 * 1024) throw new Error("Ringtone must be smaller than 8 MB.");
  const store = await ringtoneStore("readwrite");
  await new Promise<void>((resolve, reject) => {
    const request = store.put(file, CUSTOM_KEY);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function clearCustomRingtone(): Promise<void> {
  const store = await ringtoneStore("readwrite");
  await new Promise<void>((resolve, reject) => {
    const request = store.delete(CUSTOM_KEY);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function hasCustomRingtone(): Promise<boolean> {
  return Boolean(await customRingtone());
}

class Ringer {
  private el: HTMLAudioElement | null = null;
  private ctx: AudioContext | null = null;
  private synthTimer: number | null = null;
  private objectUrl: string | null = null;
  private playing = false;

  /** Play the custom mp3 on loop. `outgoing` uses a quieter volume. */
  async start(outgoing = false): Promise<void> {
    if (this.playing) return;
    this.playing = true;

    try {
      const custom = await customRingtone().catch(() => null);
      const objectUrl = custom ? URL.createObjectURL(custom) : null;
      const el = new Audio(objectUrl ?? RINGTONE_URL);
      this.objectUrl = objectUrl;
      el.loop = true;
      el.volume = outgoing ? 0.28 : 0.85;
      el.preload = "auto";
      this.el = el;
      await el.play();
    } catch {
      // Autoplay blocked or file missing — synthesize instead.
      this.el = null;
      this.startSynth(outgoing);
    }
  }

  stop(): void {
    this.playing = false;
    if (this.el) {
      try {
        this.el.pause();
        this.el.currentTime = 0;
      } catch {
        /* ignore */
      }
      this.el = null;
    }
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
    if (this.synthTimer !== null) {
      clearInterval(this.synthTimer);
      this.synthTimer = null;
    }
    if (this.ctx) {
      void this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }

  /** Fallback: a short arpeggio repeated on an interval, matching the mp3. */
  private startSynth(outgoing: boolean): void {
    try {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new Ctor();
      this.ctx = ctx;
      const gain = outgoing ? 0.06 : 0.16;

      const ring = () => {
        if (!this.playing || !this.ctx) return;
        const notes = [440, 554.37, 659.25, 880];
        notes.forEach((freq, i) => {
          const t0 = ctx.currentTime + i * 0.26;
          const osc = ctx.createOscillator();
          const env = ctx.createGain();
          osc.type = "sine";
          osc.frequency.value = freq;
          env.gain.setValueAtTime(0, t0);
          env.gain.linearRampToValueAtTime(gain, t0 + 0.02);
          env.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.34);
          osc.connect(env).connect(ctx.destination);
          osc.start(t0);
          osc.stop(t0 + 0.36);
        });
      };

      ring();
      this.synthTimer = window.setInterval(ring, 2600);
    } catch {
      /* no audio available — silent, but the UI still shows the call */
    }
  }
}

export const ringer = new Ringer();

/** Short vibration pattern for incoming calls on mobile. */
export function vibrateIncoming(): void {
  try {
    navigator.vibrate?.([220, 120, 220, 120, 220]);
  } catch {
    /* unsupported */
  }
}

export function stopVibrate(): void {
  try {
    navigator.vibrate?.(0);
  } catch {
    /* unsupported */
  }
}
