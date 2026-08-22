/**
 * Push notifications for incoming calls.
 *
 * Two transports, because the two clients need different ones:
 *   - Web Push (VAPID) for the browser, via the `web-push` package.
 *   - Expo's push service for the React Native app, via a plain HTTPS POST
 *     (no extra dependency — Node 18+ has global fetch).
 *
 * Both silently no-op when unconfigured, so the app works end-to-end without
 * any push infrastructure; you just don't get notified while backgrounded.
 */

import webpush from "web-push";
import { config, pushEnabled } from "./config";
import {
  expoTokensFor,
  pushSubsFor,
  removeExpoToken,
  removePushSub,
} from "./store";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

let configured = false;

export function initPush(): void {
  if (!pushEnabled()) {
    console.log(
      "[push] VAPID keys not set — Web Push disabled. " +
        "Run `npm run genkeys` in server/ and add them to .env to enable. " +
        "(Expo push for the mobile app works without VAPID.)"
    );
    return;
  }
  webpush.setVapidDetails(
    config.vapidSubject,
    config.vapidPublic,
    config.vapidPrivate
  );
  configured = true;
  console.log("[push] Web Push enabled.");
}

export interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  tag?: string;
  data?: Record<string, unknown>;
}

async function sendWebPush(
  userId: string,
  payload: PushPayload
): Promise<void> {
  if (!configured) return;
  const subs = pushSubsFor(userId);
  if (!subs.length) return;

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          sub as unknown as webpush.PushSubscription,
          JSON.stringify(payload),
          { TTL: 30, urgency: "high" }
        );
      } catch (err: unknown) {
        const status = (err as { statusCode?: number }).statusCode;
        // 404/410 mean the subscription is dead — drop it.
        if (status === 404 || status === 410) {
          removePushSub(userId, sub.endpoint);
        } else {
          console.warn("[push] web send failed:", (err as Error).message);
        }
      }
    })
  );
}

async function sendExpoPush(
  userId: string,
  payload: PushPayload
): Promise<void> {
  const tokens = expoTokensFor(userId);
  if (!tokens.length) return;

  const messages = tokens.map((to) => ({
    to,
    title: payload.title,
    body: payload.body,
    sound: "default" as const,
    priority: "high" as const,
    // Android channel created client-side with a call-style importance.
    channelId: "calls",
    ttl: 30,
    data: { ...(payload.data ?? {}), tag: payload.tag },
  }));

  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(messages),
    });

    if (!res.ok) {
      console.warn(`[push] expo send failed (${res.status})`);
      return;
    }

    // Expo reports per-message errors in the body; prune dead tokens.
    const body = (await res.json()) as {
      data?: { status: string; details?: { error?: string } }[];
    };
    body.data?.forEach((result, i) => {
      if (
        result.status === "error" &&
        result.details?.error === "DeviceNotRegistered"
      ) {
        removeExpoToken(userId, tokens[i]);
      }
    });
  } catch (err) {
    console.warn("[push] expo send failed:", (err as Error).message);
  }
}

export async function sendPushToUser(
  userId: string,
  payload: PushPayload
): Promise<void> {
  await Promise.all([
    sendWebPush(userId, payload),
    sendExpoPush(userId, payload),
  ]);
}
