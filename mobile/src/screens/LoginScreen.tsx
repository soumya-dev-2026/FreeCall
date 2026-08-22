/**
 * Login / register.
 *
 * One screen with a mode toggle rather than two, because on a phone the
 * fastest path to a call is fewer taps. Demo credentials are shown inline so
 * the app is testable the moment it launches.
 */

import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PhoneIcon } from "../components/Icons";
import { useAuth } from "../state/AuthContext";
import { SERVER_URL } from "../lib/api";
import { colors, font, radius, spacing } from "../theme";

export function LoginScreen() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      if (mode === "login") {
        await login(username.trim(), password);
      } else {
        await register({
          username: username.trim(),
          displayName: displayName.trim() || username.trim(),
          password,
        });
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const fillDemo = (name: string) => {
    setMode("login");
    setUsername(name);
    setPassword("password");
    setError(null);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.brand}>
            <View style={styles.logo}>
              <PhoneIcon size={26} color="#fff" />
            </View>
            <Text style={styles.title}>FreeCall</Text>
            <Text style={styles.subtitle}>
              Free 1-to-1 and group calls over WebRTC
            </Text>
          </View>

          <View style={styles.card}>
            <View style={styles.tabs}>
              {(["login", "register"] as const).map((m) => (
                <Pressable
                  key={m}
                  onPress={() => {
                    setMode(m);
                    setError(null);
                  }}
                  style={[styles.tab, mode === m && styles.tabActive]}
                >
                  <Text
                    style={[
                      styles.tabText,
                      mode === m && styles.tabTextActive,
                    ]}
                  >
                    {m === "login" ? "Sign in" : "Create account"}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.label}>Username</Text>
            <TextInput
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="alice"
              placeholderTextColor={colors.textFaint}
              style={styles.input}
              returnKeyType="next"
            />

            {mode === "register" && (
              <>
                <Text style={styles.label}>Display name</Text>
                <TextInput
                  value={displayName}
                  onChangeText={setDisplayName}
                  placeholder="Alice Anderson"
                  placeholderTextColor={colors.textFaint}
                  style={styles.input}
                  returnKeyType="next"
                />
              </>
            )}

            <Text style={styles.label}>Password</Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder="••••••••"
              placeholderTextColor={colors.textFaint}
              style={styles.input}
              returnKeyType="go"
              onSubmitEditing={submit}
            />

            {error && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <Pressable
              onPress={submit}
              disabled={busy || !username.trim() || !password}
              style={({ pressed }) => [
                styles.primary,
                {
                  opacity:
                    busy || !username.trim() || !password
                      ? 0.5
                      : pressed
                        ? 0.85
                        : 1,
                },
              ]}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryText}>
                  {mode === "login" ? "Sign in" : "Create account"}
                </Text>
              )}
            </Pressable>
          </View>

          <View style={styles.demo}>
            <Text style={styles.demoTitle}>Demo accounts (password: password)</Text>
            <View style={styles.demoRow}>
              {["alice", "bob", "carol"].map((name) => (
                <Pressable
                  key={name}
                  onPress={() => fillDemo(name)}
                  style={styles.demoChip}
                >
                  <Text style={styles.demoChipText}>{name}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.server}>Server: {SERVER_URL}</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    justifyContent: "center",
    padding: spacing.xl,
  },
  brand: { alignItems: "center", marginBottom: spacing.xl },
  logo: {
    width: 56,
    height: 56,
    borderRadius: radius.lg,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  title: {
    color: colors.text,
    fontSize: font.xxl,
    fontWeight: "700",
    letterSpacing: -0.5,
  },
  subtitle: {
    color: colors.textDim,
    fontSize: font.sm,
    marginTop: 4,
    textAlign: "center",
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  tabs: {
    flexDirection: "row",
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: 3,
    marginBottom: spacing.lg,
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    alignItems: "center",
  },
  tabActive: { backgroundColor: colors.surfaceHi },
  tabText: { color: colors.textDim, fontSize: font.sm, fontWeight: "600" },
  tabTextActive: { color: colors.text },
  label: {
    color: colors.textDim,
    fontSize: font.xs,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  input: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: Platform.OS === "ios" ? 13 : 10,
    color: colors.text,
    fontSize: font.md,
    marginBottom: spacing.md,
  },
  errorBox: {
    backgroundColor: "rgba(244,63,94,0.12)",
    borderWidth: 1,
    borderColor: "rgba(244,63,94,0.35)",
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  errorText: { color: "#fda4af", fontSize: font.sm, lineHeight: 19 },
  primary: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryText: { color: "#fff", fontSize: font.md, fontWeight: "700" },
  demo: { marginTop: spacing.xl, alignItems: "center" },
  demoTitle: { color: colors.textFaint, fontSize: font.xs },
  demoRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  demoChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  demoChipText: { color: colors.textDim, fontSize: font.sm },
  server: {
    color: colors.textFaint,
    fontSize: 10,
    marginTop: spacing.md,
  },
});
