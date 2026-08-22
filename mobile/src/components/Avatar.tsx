/**
 * Avatar with graceful fallback.
 *
 * The incoming-call screen leans on the caller's picture, so this always
 * renders something: the image when it loads, coloured initials when it
 * doesn't. The colour is derived from the user id so it's stable per person.
 */

import { useState } from "react";
import { Image, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { colors, colorFor, initialsOf } from "../theme";

interface Props {
  userId: string;
  name: string;
  uri?: string;
  size?: number;
  /** Show a small online/offline dot in the corner. */
  online?: boolean;
  showPresence?: boolean;
  ring?: boolean;
  style?: ViewStyle;
}

export function Avatar({
  userId,
  name,
  uri,
  size = 48,
  online,
  showPresence = false,
  ring = false,
  style,
}: Props) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(uri) && !failed;
  const dot = Math.max(9, Math.round(size * 0.24));

  return (
    <View style={[{ width: size, height: size }, style]}>
      <View
        style={[
          styles.frame,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: colorFor(userId),
            borderWidth: ring ? 2 : 0,
            borderColor: colors.white20,
          },
        ]}
      >
        {showImage ? (
          <Image
            source={{ uri }}
            style={{ width: size, height: size, borderRadius: size / 2 }}
            onError={() => setFailed(true)}
          />
        ) : (
          <Text
            style={[styles.initials, { fontSize: Math.round(size * 0.38) }]}
            numberOfLines={1}
          >
            {initialsOf(name)}
          </Text>
        )}
      </View>

      {showPresence && (
        <View
          style={[
            styles.dot,
            {
              width: dot,
              height: dot,
              borderRadius: dot / 2,
              backgroundColor: online ? colors.success : colors.textFaint,
            },
          ]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  initials: {
    color: "#fff",
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  dot: {
    position: "absolute",
    right: 0,
    bottom: 0,
    borderWidth: 2,
    borderColor: colors.bg,
  },
});
