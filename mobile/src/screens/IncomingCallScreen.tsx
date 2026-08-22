/**
 * Incoming call — the screen this app is really built around.
 *
 * The caller's picture is used twice: blurred and scaled up as a full-bleed
 * backdrop, and sharp in the centre inside expanding rings. That's what makes
 * it feel personal rather than like a generic system alert. If the image can't
 * load, the Avatar falls back to coloured initials and the layout is unchanged.
 */

import { useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Avatar } from "../components/Avatar";
import { PhoneIcon, PhoneOffIcon, VideoIcon } from "../components/Icons";
import { colors, font, joinNames, radius, spacing } from "../theme";
import type { CallController } from "../state/useCall";

interface Props {
  call: CallController;
}

/** One expanding ring; `delay` staggers the three of them. */
function PulseRing({ delay, size }: { delay: number; size: number }) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(anim, {
          toValue: 1,
          duration: 2400,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(anim, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [anim, delay]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.ring,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          opacity: anim.interpolate({
            inputRange: [0, 0.15, 1],
            outputRange: [0, 0.5, 0],
          }),
          transform: [
            {
              scale: anim.interpolate({
                inputRange: [0, 1],
                outputRange: [0.85, 1.9],
              }),
            },
          ],
        },
      ]}
    />
  );
}

export function IncomingCallScreen({ call }: Props) {
  const inc = call.incoming;
  if (!inc) return null;

  const others = inc.participants.filter((p) => p.id !== inc.from.id);
  const avatarSize = 132;

  return (
    <View style={styles.root}>
      {/* Blurred backdrop built from the caller's own picture. */}
      {inc.from.avatarUrl ? (
        <Image
          source={{ uri: inc.from.avatarUrl }}
          style={styles.backdrop}
          blurRadius={40}
          resizeMode="cover"
        />
      ) : null}
      <View style={styles.scrim} />

      <SafeAreaView style={styles.safe}>
        <View style={styles.top}>
          <Text style={styles.kicker}>
            {inc.type === "group" ? "Incoming group call" : "Incoming call"}
            {inc.video ? " · Video" : ""}
          </Text>
        </View>

        <View style={styles.center}>
          <View style={styles.avatarWrap}>
            <PulseRing delay={0} size={avatarSize} />
            <PulseRing delay={800} size={avatarSize} />
            <PulseRing delay={1600} size={avatarSize} />
            <Avatar
              userId={inc.from.id}
              name={inc.from.displayName}
              uri={inc.from.avatarUrl}
              size={avatarSize}
              ring
            />
          </View>

          <Text style={styles.name}>{inc.from.displayName}</Text>
          <Text style={styles.username}>@{inc.from.username}</Text>

          {others.length > 0 && (
            <View style={styles.groupPill}>
              <Text style={styles.groupPillText}>
                with {joinNames(others.map((o) => o.displayName), 2)}
              </Text>
            </View>
          )}

          <Text style={styles.ringingText}>Ringing…</Text>
        </View>

        <View style={styles.actions}>
          <View style={styles.actionCol}>
            <Pressable
              onPress={call.rejectCall}
              accessibilityRole="button"
              accessibilityLabel="Decline call"
              style={({ pressed }) => [
                styles.action,
                { backgroundColor: colors.danger, opacity: pressed ? 0.8 : 1 },
              ]}
            >
              <PhoneOffIcon size={30} color="#fff" />
            </Pressable>
            <Text style={styles.actionLabel}>Decline</Text>
          </View>

          <View style={styles.actionCol}>
            <Pressable
              onPress={() => void call.acceptCall()}
              accessibilityRole="button"
              accessibilityLabel="Accept call"
              style={({ pressed }) => [
                styles.action,
                { backgroundColor: colors.success, opacity: pressed ? 0.8 : 1 },
              ]}
            >
              {inc.video ? (
                <VideoIcon size={30} color="#fff" />
              ) : (
                <PhoneIcon size={30} color="#fff" />
              )}
            </Pressable>
            <Text style={styles.actionLabel}>Accept</Text>
          </View>
        </View>

        {call.error && <Text style={styles.error}>{call.error}</Text>}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  backdrop: {
    position: "absolute",
    top: -80,
    left: -80,
    right: -80,
    bottom: -80,
    opacity: 0.4,
  },
  scrim: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(8,11,20,0.74)",
  },
  safe: { flex: 1, justifyContent: "space-between" },
  top: { alignItems: "center", paddingTop: spacing.xl },
  kicker: {
    color: colors.textDim,
    fontSize: font.sm,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    fontWeight: "700",
  },
  center: { alignItems: "center", paddingHorizontal: spacing.xl },
  avatarWrap: {
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xl,
  },
  ring: {
    position: "absolute",
    borderWidth: 2,
    borderColor: colors.accentLight,
  },
  name: {
    color: colors.text,
    fontSize: font.huge,
    fontWeight: "700",
    letterSpacing: -0.6,
    textAlign: "center",
  },
  username: { color: colors.textDim, fontSize: font.md, marginTop: 4 },
  groupPill: {
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.white10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  groupPillText: { color: colors.textDim, fontSize: font.sm },
  ringingText: {
    color: colors.textFaint,
    fontSize: font.sm,
    marginTop: spacing.xl,
    letterSpacing: 1,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "space-evenly",
    paddingBottom: spacing.xxl,
    paddingHorizontal: spacing.xl,
  },
  actionCol: { alignItems: "center" },
  action: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: "center",
    justifyContent: "center",
  },
  actionLabel: {
    color: colors.textDim,
    fontSize: font.sm,
    marginTop: spacing.sm,
  },
  error: {
    color: "#fda4af",
    fontSize: font.sm,
    textAlign: "center",
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.lg,
  },
});
