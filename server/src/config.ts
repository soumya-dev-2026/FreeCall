import dotenv from "dotenv";
dotenv.config();

function list(v: string | undefined): string[] {
  return (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  clientOrigins: list(process.env.CLIENT_ORIGINS).length
    ? list(process.env.CLIENT_ORIGINS)
    : ["http://localhost:5173", "http://localhost:4173"],
  jwtSecret: process.env.JWT_SECRET ?? "dev-super-secret-change-me",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "7d",

  stunUrls: list(process.env.STUN_URLS).length
    ? list(process.env.STUN_URLS)
    : ["stun:stun.l.google.com:19302"],
  turnUrl: process.env.TURN_URL ?? "",
  turnUsername: process.env.TURN_USERNAME ?? "",
  turnCredential: process.env.TURN_CREDENTIAL ?? "",

  vapidPublic: process.env.VAPID_PUBLIC_KEY ?? "",
  vapidPrivate: process.env.VAPID_PRIVATE_KEY ?? "",
  vapidSubject: process.env.VAPID_SUBJECT ?? "mailto:admin@freecall.example",
};

/** Build the ICE server list clients should use. */
export function iceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [{ urls: config.stunUrls }];
  if (config.turnUrl) {
    servers.push({
      urls: config.turnUrl,
      username: config.turnUsername,
      credential: config.turnCredential,
    });
  }
  return servers;
}

export const pushEnabled = () =>
  Boolean(config.vapidPublic && config.vapidPrivate);
