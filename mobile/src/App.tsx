/**
 * App root.
 *
 * There's no navigation library here on purpose: a calling app has exactly
 * four states (loading, signed out, ringing, in a call), and the call phase
 * already models them. Rendering straight from that phase means the incoming
 * call screen can never be buried under a navigation stack.
 */

import { useEffect } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "./state/AuthContext";
import { useCall } from "./state/useCall";
import { CallScreen } from "./screens/CallScreen";
import { HomeScreen } from "./screens/HomeScreen";
import { IncomingCallScreen } from "./screens/IncomingCallScreen";
import { LoginScreen } from "./screens/LoginScreen";
import { onNotificationTap } from "./lib/push";
import { colors, font, spacing } from "./theme";

function Root() {
  const { user, socket, loading } = useAuth();
  const call = useCall(socket, user?.id ?? null);

  /**
   * Tapping the push notification just brings the app forward; the socket
   * reconnects and `call:incoming` replays, so there's nothing to do beyond
   * making sure we don't sit on a stale screen.
   */
  useEffect(() => {
    return onNotificationTap(() => {
      /* Foregrounding is enough — signaling re-delivers the call state. */
    });
  }, []);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} size="large" />
        <Text style={styles.loadingText}>Starting FreeCall…</Text>
      </View>
    );
  }

  if (!user) return <LoginScreen />;
  if (call.phase === "incoming") return <IncomingCallScreen call={call} />;
  if (call.phase === "outgoing" || call.phase === "active")
    return <CallScreen call={call} />;
  return <HomeScreen call={call} />;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <AuthProvider>
        <Root />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
  },
  loadingText: {
    color: colors.textDim,
    fontSize: font.sm,
    marginTop: spacing.md,
  },
});
