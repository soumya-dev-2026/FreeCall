/**
 * Ringtone + haptics (React Native).
 *
 * Uses expo-av to loop the same mp3 the web client plays, so both clients
 * sound like the same product. On top of the audio we run a vibration pattern,
 * because a phone in a pocket is far more likely to be felt than heard.
 */

import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from "expo-av";
import { Vibration } from "react-native";
import RINGTONE from "../assets/ringtone.mp3";

let sound: Audio.Sound | null = null;
let vibrating = false;

/**
 * Configure the audio session.
 *
 * `playsInSilentModeIOS` matters: an incoming call should ring even when the
 * ringer switch is flipped, and in-call audio must never be silenced.
 */
export async function configureAudioSession(inCall: boolean): Promise<void> {
  try {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: inCall,
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
      shouldDuckAndroid: false,
      playThroughEarpieceAndroid: false,
      interruptionModeIOS: InterruptionModeIOS.DoNotMix,
      interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
    });
  } catch (err) {
    console.warn("[ringer] audio mode failed:", (err as Error).message);
  }
}

async function unload(): Promise<void> {
  const s = sound;
  sound = null;
  if (!s) return;
  try {
    await s.stopAsync();
  } catch {
    /* may already be stopped */
  }
  try {
    await s.unloadAsync();
  } catch {
    /* ignore */
  }
}

/**
 * Start ringing. `incoming` rings loudly and vibrates; outgoing plays a quiet
 * progress tone with no vibration.
 */
export async function startRinging(incoming: boolean): Promise<void> {
  await stopRinging();
  // Outgoing ringing starts after capture; keep microphone recording enabled.
  await configureAudioSession(!incoming);

  try {
    const { sound: created } = await Audio.Sound.createAsync(
      RINGTONE,
      { shouldPlay: true, isLooping: true, volume: incoming ? 1.0 : 0.3 },
      null,
      false
    );
    sound = created;
  } catch (err) {
    console.warn("[ringer] playback failed:", (err as Error).message);
  }

  if (incoming) {
    vibrating = true;
    // [wait, vibrate, wait, vibrate, …] repeated until cancelled.
    Vibration.vibrate([0, 700, 900, 700, 1800], true);
  }
}

export async function stopRinging(): Promise<void> {
  if (vibrating) {
    vibrating = false;
    Vibration.cancel();
  }
  await unload();
}

/** Short confirmation buzz — used when a call connects or ends. */
export function pulse(): void {
  try {
    Vibration.vibrate(35);
  } catch {
    /* unsupported */
  }
}
