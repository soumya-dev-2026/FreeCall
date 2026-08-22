#!/usr/bin/env python3
"""
Generates the FreeCall custom ringtone as a WAV file (later encoded to mp3).

Design goals: warm and musical rather than a harsh electronic beep. The pattern
is a gentle rising arpeggio (a major-add9 shape) played twice per ring cycle,
with a soft bell-like envelope, light detune for warmth, and a decaying echo.
The cycle repeats with silence between rings so it loops naturally.
"""
import math
import struct
import wave

SR = 44100          # sample rate
CYCLES = 2          # number of ring cycles in the file
GAP = 1.6           # silence between ring cycles (seconds)

# A pleasant rising arpeggio: A4, C#5, E5, A5 (A major triad + octave)
MELODY = [440.00, 554.37, 659.25, 880.00]
NOTE_DUR = 0.26     # length of each note
NOTE_GAP = 0.015    # tiny separation between notes


def bell_envelope(t, dur):
    """Soft attack, long exponential decay — like a struck bell/chime."""
    attack = 0.012
    if t < attack:
        return t / attack
    decay_t = t - attack
    return math.exp(-3.2 * decay_t / max(dur - attack, 1e-6))


def note_samples(freq, dur):
    """One note: fundamental + soft harmonics + slight detune for warmth."""
    n = int(SR * dur)
    out = []
    for i in range(n):
        t = i / SR
        env = bell_envelope(t, dur)
        # fundamental, plus quieter 2nd and 3rd harmonics for a chime timbre
        v = math.sin(2 * math.pi * freq * t)
        v += 0.34 * math.sin(2 * math.pi * freq * 2 * t)
        v += 0.14 * math.sin(2 * math.pi * freq * 3 * t)
        # gentle detuned copy adds chorus-like warmth
        v += 0.18 * math.sin(2 * math.pi * (freq * 1.003) * t)
        out.append(v * env * 0.24)
    return out


def build_phrase():
    """The arpeggio, played once."""
    buf = []
    for f in MELODY:
        buf.extend(note_samples(f, NOTE_DUR))
        buf.extend([0.0] * int(SR * NOTE_GAP))
    return buf


def add_echo(buf, delay_s=0.19, decay=0.28, taps=3):
    """Simple feedback echo so the ring feels spacious, not dry."""
    out = list(buf)
    delay = int(SR * delay_s)
    for tap in range(1, taps + 1):
        amp = decay ** tap
        shift = delay * tap
        # extend so the tail isn't clipped
        while len(out) < len(buf) + shift:
            out.append(0.0)
        for i, v in enumerate(buf):
            out[i + shift] += v * amp
    return out


def main():
    phrase = build_phrase()

    # A ring cycle = arpeggio, short pause, arpeggio again (classic double ring)
    cycle = list(phrase) + [0.0] * int(SR * 0.14) + list(phrase)
    cycle = add_echo(cycle)
    cycle.extend([0.0] * int(SR * GAP))

    audio = cycle * CYCLES

    # Normalize to a comfortable level and soft-clip to avoid harsh distortion
    peak = max(abs(v) for v in audio) or 1.0
    target = 0.82
    scaled = []
    for v in audio:
        x = (v / peak) * target
        x = math.tanh(x * 1.08) / math.tanh(1.08)  # gentle saturation
        scaled.append(x * target)

    # Fade the very start/end so looping has no click
    fade = int(SR * 0.02)
    for i in range(min(fade, len(scaled))):
        scaled[i] *= i / fade
        scaled[-(i + 1)] *= i / fade

    frames = b"".join(
        struct.pack("<hh", int(v * 32767), int(v * 32767)) for v in scaled
    )

    with wave.open("ringtone.wav", "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(frames)

    print(f"wrote ringtone.wav  ({len(scaled)/SR:.2f}s, {CYCLES} ring cycles)")


if __name__ == "__main__":
    main()
