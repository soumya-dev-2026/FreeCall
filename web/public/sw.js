/* eslint-env serviceworker */
/**
 * FreeCall service worker.
 *
 * Two jobs:
 *  1. Receive Web Push messages and show an incoming-call notification with
 *     the caller's avatar, plus Answer / Decline action buttons.
 *  2. Focus (or open) the app when the notification is clicked, and tell the
 *     page which action the user chose.
 *
 * Deliberately does NOT cache app assets — a calling app should always run the
 * freshest code, and stale JS breaks signaling in confusing ways.
 */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "FreeCall", body: event.data ? event.data.text() : "" };
  }

  const isCall = payload?.data?.type === "incoming-call";

  const options = {
    body: payload.body || "",
    icon: payload.icon || "/icon-192.png",
    badge: "/icon-192.png",
    tag: payload.tag || "freecall",
    renotify: true,
    // Keep incoming-call notifications on screen until acted on.
    requireInteraction: isCall,
    vibrate: isCall ? [220, 120, 220, 120, 220] : undefined,
    data: payload.data || {},
    actions: isCall
      ? [
          { action: "answer", title: "Answer" },
          { action: "decline", title: "Decline" },
        ]
      : [],
  };

  event.waitUntil(
    self.registration.showNotification(payload.title || "FreeCall", options)
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const action = event.action || "open";
  const data = event.notification.data || {};

  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      // Reuse an existing tab when we have one.
      const client = all.find((c) => "focus" in c);
      if (client) {
        await client.focus();
        client.postMessage({
          source: "freecall-sw",
          action,
          callId: data.callId ?? null,
        });
        return;
      }

      // Otherwise open the app, passing the intent through the URL.
      const url =
        data.callId && action !== "decline"
          ? `/?callId=${encodeURIComponent(data.callId)}&action=${action}`
          : "/";
      await self.clients.openWindow(url);
    })()
  );
});
