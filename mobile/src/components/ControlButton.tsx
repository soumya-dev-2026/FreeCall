/**
 * Round control button used across the call UI.
 *
 * `active` means the feature is engaged (mic on, camera on…) and gets the
 * light treatment; inactive controls are translucent. `danger` is reserved for
 * hang up, so it's never confused with anything else.
 */

import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, font } from "../theme";

interface Props {
  onPress: () => void;
  icon: (color: string, size: number) => ReactNode;
  label?: string;
  active?: boolean;
  danger?: boolean;
  accent?: boolean;
  disabled?: boolean;
  size?: number;
  badge?: number;
}

export function ControlButton({
  onPress,
  icon,
  label,
  active = false,
  danger = false,
  accent = false,
  disabled = false,
  size = 60,
  badge = 0,
}: Props) {
  const bg = danger
    ? colors.danger
    : accent
      ? colors.success
      : active
        ? "#ffffff"
        : colors.white10;
  const fg = danger || accent ? "#fff" : active ? colors.bg : colors.text;

  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled, selected: active }}
        onPress={onPress}
        disabled={disabled}
        style={({ pressed }) => [
          styles.button,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: bg,
            opacity: disabled ? 0.35 : pressed ? 0.75 : 1,
            borderWidth: active || danger || accent ? 0 : 1,
            borderColor: colors.border,
          },
        ]}
      >
        {icon(fg, Math.round(size * 0.42))}
        {badge > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{badge > 9 ? "9+" : badge}</Text>
          </View>
        )}
      </Pressable>
      {label ? <Text style={styles.label}>{label}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", width: 76 },
  button: { alignItems: "center", justifyContent: "center" },
  label: {
    marginTop: 6,
    color: colors.textDim,
    fontSize: font.xs,
    textAlign: "center",
  },
  badge: {
    position: "absolute",
    top: -2,
    right: -2,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: colors.bg,
  },
  badgeText: { color: "#fff", fontSize: 10, fontWeight: "700" },
});
