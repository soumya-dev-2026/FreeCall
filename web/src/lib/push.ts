/**
 * Web Push registration.
 *
 * Everything degrades gracefully: if the browser lacks support, the server has
 * no VAPID keys, or the user declines permission, the app keeps working — it
 * just won't notify when backgrounded.
 */

import { api } from "./api";

export type PushStatus =
  | "unsupported"
  | "server-disabled"
  | "denied"
  | "granted"
  | "default"
  | "error";

export function pushSupported(): boolean {
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** Register the service worker (also needed for notification actions). */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js");
  } catch (err) {
    console.warn("[push] SW registration failed:", (err as Error).message);
    return null;
  }
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Ask for permission and subscribe. Safe to call more than once. */
export async function enablePush(): Promise<PushStatus> {
  if (!pushSupported()) return "unsupported";

  try {
    const { key } = await api.vapidPublicKey();
    if (!key) return "server-disabled";

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      return permission === "denied" ? "denied" : "default";
    }

    const reg =
      (await navigator.serviceWorker.getRegistration()) ??
      (await registerServiceWorker());
    if (!reg) return "error";
    await navigator.serviceWorker.ready;

    const existing = await reg.pushManager.getSubscription();
    const sub =
      existing ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
      }));

    await api.pushSubscribe(sub.toJSON());
    return "granted";
  } catch (err) {
    console.warn("[push] enable failed:", (err as Error).message);
    return "error";
  }
}

export async function disablePush(): Promise<void> {
  if (!pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await api.pushUnsubscribe(sub.endpoint).catch(() => {});
      await sub.unsubscribe().catch(() => {});
    }
  } catch {
    /* ignore */
  }
}

export function currentPermission(): PushStatus {
  if (!pushSupported()) return "unsupported";
  const p = Notification.permission;
  return p === "granted" ? "granted" : p === "denied" ? "denied" : "default";
}

/**
 * Show a local (non-push) notification — used when the tab is merely hidden,
 * where push isn't involved but the user still deserves a heads-up.
 */
export async function showLocalCallNotification(input: {
  title: string;
  body: string;
  icon?: string;
  callId: string;
}): Promise<void> {
  if (!("Notification" in window) || Notification.permission !== "granted") {
    return;
  }
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const options: NotificationOptions = {
      body: input.body,
      icon: input.icon ?? "/icon-192.png",
      badge: "/icon-192.png",
      tag: `call-${input.callId}`,
      data: { callId: input.callId, type: "incoming-call" },
      requireInteraction: true,
    };
    if (reg) {
      await reg.showNotification(input.title, {
        ...options,
        actions: [
          { action: "answer", title: "Answer" },
          { action: "decline", title: "Decline" },
        ],
      } as NotificationOptions);
    } else {
      new Notification(input.title, options);
    }
  } catch {
    /* ignore */
  }
}

export async function clearCallNotification(callId: string): Promise<void> {
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const notes = await reg?.getNotifications({ tag: `call-${callId}` });
    notes?.forEach((n) => n.close());
  } catch {
    /* ignore */
  }
}
