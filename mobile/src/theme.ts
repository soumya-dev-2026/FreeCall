/**
 * Design tokens for the mobile app.
 *
 * React Native has no Tailwind, so the web client's palette is mirrored here
 * as plain constants and consumed via StyleSheet. Keeping the values identical
 * is what makes the two clients look like the same product.
 */

export const colors = {
  bg: "#080b14",
  surface: "#0d1220",
  surfaceAlt: "#151c2e",
  surfaceHi: "#1e273d",
  border: "rgba(255,255,255,0.10)",
  borderStrong: "rgba(255,255,255,0.18)",

  text: "#f1f5f9",
  textDim: "#94a3b8",
  textFaint: "#64748b",

  accent: "#5b7cfa",
  accentDark: "#4560e0",
  accentLight: "#7c9cff",

  success: "#10b981",
  danger: "#f43f5e",
  warning: "#f59e0b",

  overlay: "rgba(8,11,20,0.72)",
  chip: "rgba(0,0,0,0.55)",
  white10: "rgba(255,255,255,0.10)",
  white20: "rgba(255,255,255,0.20)",
  white05: "rgba(255,255,255,0.05)",
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  pill: 999,
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const font = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 22,
  xxl: 30,
  huge: 36,
};

/** Stable avatar colour per user id — matches the web client's palette. */
export function colorFor(id: string): string {
  const palette = [
    "#6366f1",
    "#8b5cf6",
    "#0ea5e9",
    "#10b981",
    "#f59e0b",
    "#f43f5e",
    "#14b8a6",
    "#d946ef",
  ];
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return palette[Math.abs(hash) % palette.length];
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return h > 0
    ? `${h}:${mm}:${String(sec).padStart(2, "0")}`
    : `${mm}:${String(sec).padStart(2, "0")}`;
}

export function formatRelative(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const d = new Date(ts);
  if (d.toDateString() === new Date().toDateString()) {
    return d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function formatClockTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function joinNames(names: string[], max = 2): string {
  if (names.length === 0) return "";
  if (names.length <= max) {
    return names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  }
  const rest = names.length - max;
  return `${names.slice(0, max).join(", ")} and ${rest} other${
    rest > 1 ? "s" : ""
  }`;
}
