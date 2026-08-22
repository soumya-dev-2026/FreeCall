/**
 * Icon set (mobile) — the same SVG path data as the web client, rendered with
 * react-native-svg. Keeping the geometry identical is what makes the two
 * clients feel like one product.
 */

import type { ReactNode } from "react";
import Svg, {
  Circle,
  Line,
  Path,
  Polygon,
  Polyline,
  Rect,
} from "react-native-svg";
import { colors } from "../theme";

export interface IconProps {
  size?: number;
  color?: string;
}

const S = 24;

function Wrap({
  size = 24,
  color = colors.text,
  children,
  filled = false,
}: IconProps & { children: ReactNode; filled?: boolean }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox={`0 0 ${S} ${S}`}
      fill={filled ? color : "none"}
      stroke={filled ? "none" : color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </Svg>
  );
}

export function MicIcon(p: IconProps) {
  return (
    <Wrap {...p}>
      <Path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
      <Path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <Line x1="12" y1="19" x2="12" y2="22" />
    </Wrap>
  );
}

export function MicOffIcon(p: IconProps) {
  return (
    <Wrap {...p}>
      <Line x1="2" y1="2" x2="22" y2="22" />
      <Path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V5a3 3 0 0 0-5.94-.6" />
      <Path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a6.96 6.96 0 0 1-.09 1.1" />
      <Line x1="12" y1="19" x2="12" y2="22" />
    </Wrap>
  );
}

export function VideoIcon(p: IconProps) {
  return (
    <Wrap {...p}>
      <Path d="m22 8-6 4 6 4V8z" />
      <Rect x="2" y="6" width="14" height="12" rx="2" ry="2" />
    </Wrap>
  );
}

export function VideoOffIcon(p: IconProps) {
  return (
    <Wrap {...p}>
      <Path d="M10.66 6H14a2 2 0 0 1 2 2v2.34l1 1L22 8v8" />
      <Path d="M16 16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h.34" />
      <Line x1="2" y1="2" x2="22" y2="22" />
    </Wrap>
  );
}

export function PhoneIcon(p: IconProps) {
  return (
    <Wrap {...p} filled>
      <Path d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.02-.24 11.36 11.36 0 0 0 3.56.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1 11.36 11.36 0 0 0 .57 3.56 1 1 0 0 1-.25 1.02l-2.2 2.21z" />
    </Wrap>
  );
}

export function PhoneOffIcon(p: IconProps) {
  return (
    <Wrap {...p}>
      <Path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-3.33-2.67" />
      <Path d="M5.09 5.09A2 2 0 0 1 7 3h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L11 11" />
      <Line x1="2" y1="2" x2="22" y2="22" />
    </Wrap>
  );
}

export function FlipCameraIcon(p: IconProps) {
  return (
    <Wrap {...p}>
      <Path d="M20 5h-3.2L15 3H9L7.2 5H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1z" />
      <Path d="M9.5 12.5a2.5 2.5 0 0 1 4.3-1.7M14.5 12.5a2.5 2.5 0 0 1-4.3 1.7" />
      <Path d="m13.2 9.6.6 1.2-1.3.2M10.8 15.4l-.6-1.2 1.3-.2" />
    </Wrap>
  );
}

export function ScreenShareIcon(p: IconProps) {
  const color = p.color ?? colors.text;
  return (
    <Wrap {...p}>
      <Rect x="2" y="3" width="20" height="13" rx="2" />
      <Path d="M8 21h8M12 17v4" />
      <Path d="m12 7-3 3h2v3h2v-3h2l-3-3z" fill={color} stroke="none" />
    </Wrap>
  );
}

export function ScreenShareOffIcon(p: IconProps) {
  return (
    <Wrap {...p}>
      <Path d="M2 3.5A2 2 0 0 1 4 3h16a2 2 0 0 1 2 2v9a2 2 0 0 1-1.2 1.83" />
      <Path d="M17 16H4a2 2 0 0 1-2-2V6" />
      <Path d="M8 21h8M12 17v4" />
      <Line x1="2" y1="2" x2="22" y2="22" />
    </Wrap>
  );
}

export function ChatIcon(p: IconProps) {
  return (
    <Wrap {...p}>
      <Path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </Wrap>
  );
}

export function UsersIcon(p: IconProps) {
  return (
    <Wrap {...p}>
      <Path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <Circle cx="9" cy="7" r="4" />
      <Path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </Wrap>
  );
}

export function ClockIcon(p: IconProps) {
  return (
    <Wrap {...p}>
      <Circle cx="12" cy="12" r="10" />
      <Polyline points="12 6 12 12 16 14" />
    </Wrap>
  );
}

export function SendIcon(p: IconProps) {
  return (
    <Wrap {...p}>
      <Line x1="22" y1="2" x2="11" y2="13" />
      <Polygon points="22 2 15 22 11 13 2 9 22 2" />
    </Wrap>
  );
}

export function CloseIcon(p: IconProps) {
  return (
    <Wrap {...p}>
      <Line x1="18" y1="6" x2="6" y2="18" />
      <Line x1="6" y1="6" x2="18" y2="18" />
    </Wrap>
  );
}

export function LogOutIcon(p: IconProps) {
  return (
    <Wrap {...p}>
      <Path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <Polyline points="16 17 21 12 16 7" />
      <Line x1="21" y1="12" x2="9" y2="12" />
    </Wrap>
  );
}

export function ArrowIncomingIcon(p: IconProps) {
  return (
    <Wrap {...p}>
      <Polyline points="15 9 9 9 9 15" />
      <Line x1="20" y1="20" x2="9" y2="9" />
    </Wrap>
  );
}

export function ArrowOutgoingIcon(p: IconProps) {
  return (
    <Wrap {...p}>
      <Polyline points="9 15 15 15 15 9" />
      <Line x1="4" y1="20" x2="15" y2="9" />
    </Wrap>
  );
}

export function SpeakerIcon(p: IconProps) {
  return (
    <Wrap {...p}>
      <Path d="M11 5 6 9H3v6h3l5 4V5z" />
      <Path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
    </Wrap>
  );
}
