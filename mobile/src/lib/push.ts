/**
 * Push notifications (Expo).
 *
 * Registers an Expo push token with our server so it can wake the app for an
 * incoming call. Everything here degrades quietly: Expo Go can't receive real
 * push tokens, simulators can't either, and the user may decline permission —
 * in all those cases calls still work while the app is in the foreground.
 */

import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { api } from "./api";

/** Show incoming-call notifications even while the app is foregrounded. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

let registered: string | null = null;

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync("calls", {
    name: "Incoming calls",
    importance: Notifications.AndroidImportance.MAX,
    sound: "default",
    vibrationPattern: [0, 700, 900, 700],
    lockscreenVisibility:
      Notifications.AndroidNotificationVisibility.PUBLIC,
    bypassDnd: true,
    enableVibrate: true,
  });
}

/**
 * Ask for permission, get a token, hand it to the server.
 * Returns the token on success, or null if push isn't available here.
 */
export async function registerForPush(): Promise<string | null> {
  if (registered) return registered;

  try {
    if (!Device.isDevice) return null; // Simulators can't get a token.

    await ensureAndroidChannel();

    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== "granted") {
      const asked = await Notifications.requestPermissionsAsync();
      status = asked.status;
    }
    if (status !== "granted") return null;

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      (Constants as { easConfig?: { projectId?: string } }).easConfig
        ?.projectId;

    const { data } = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    if (!data) return null;

    await api.registerExpoToken(data);
    registered = data;
    return data;
  } catch (err) {
    // Most commonly: running in Expo Go, or no EAS projectId configured.
    console.warn("[push] registration skipped:", (err as Error).message);
    return null;
  }
}

export async function unregisterPush(): Promise<void> {
  const token = registered;
  registered = null;
  if (!token) return;
  try {
    await api.unregisterExpoToken(token);
  } catch {
    /* logging out anyway */
  }
}

/**
 * Notification taps. The payload carries `{ type, callId }`, matching the
 * web service worker's postMessage shape, so both clients route calls the
 * same way.
 */
export interface CallNotificationData {
  type?: string;
  callId?: string;
}

export function onNotificationTap(
  handler: (data: CallNotificationData) => void
): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener((res) => {
    const data = res.notification.request.content.data as CallNotificationData;
    if (data) handler(data);
  });
  return () => sub.remove();
}

/** Clear any lingering incoming-call notifications once the call resolves. */
export async function dismissCallNotifications(): Promise<void> {
  try {
    await Notifications.dismissAllNotificationsAsync();
  } catch {
    /* ignore */
  }
}
