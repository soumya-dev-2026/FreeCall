/**
 * Ringtone playback for incoming/outgoing calls.
 *
 * Browsers block autoplay until the user has interacted with the page. We try
 * to play the mp3 and, if that's blocked, fall back to a WebAudio-synthesized
 * ring (WebAudio can often start from a prior interaction's audio context).
 * Either way, the caller gets *some* audible feedback and never a crash.
 */

const RINGTONE_URL = "/sounds/ringtone.mp3";

class Ringer {
  private el: HTMLAudioElement | null = null;
  private ctx: AudioContext | null = null;
  private synthTimer: number | null = null;
  private playing = false;

  /** Play the custom mp3 on loop. `outgoing` uses a quieter volume. */
  async start(outgoing = false): Promise<void> {
    if (this.playing) return;
    this.playing = true;

    try {
      const el = new Audio(RINGTONE_URL);
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
