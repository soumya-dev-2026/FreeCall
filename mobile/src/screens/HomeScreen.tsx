/**
 * Home — contacts with live presence, plus call history.
 *
 * Tapping a contact starts a direct call. Long-pressing enters selection mode
 * for group calls, which keeps the common case (one tap to call) fast while
 * still exposing the group feature.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Avatar } from "../components/Avatar";
import {
  ArrowIncomingIcon,
  ArrowOutgoingIcon,
  ClockIcon,
  LogOutIcon,
  PhoneIcon,
  UsersIcon,
  VideoIcon,
} from "../components/Icons";
import { api } from "../lib/api";
import { useAuth } from "../state/AuthContext";
import { usePresence } from "../state/usePresence";
import type { CallController } from "../state/useCall";
import {
  colors,
  font,
  formatDuration,
  formatRelative,
  joinNames,
  radius,
  spacing,
} from "../theme";
import type { CallHistoryEntry, PublicUser } from "../shared/types";

type Tab = "contacts" | "history";

interface Props {
  call: CallController;
}

export function HomeScreen({ call }: Props) {
  const { user, socket, connected, logout } = useAuth();
  const { users, loading, error, refresh } = usePresence(socket, Boolean(user));
  const [tab, setTab] = useState<Tab>("contacts");
  const [selected, setSelected] = useState<string[]>([]);
  const [history, setHistory] = useState<CallHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const { history: list } = await api.history();
      setHistory(list);
    } catch {
      /* surfaced by the empty state */
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory, call.historyVersion]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refresh(), loadHistory()]);
    setRefreshing(false);
  }, [refresh, loadHistory]);

  const selectionMode = selected.length > 0;

  const toggleSelect = (id: string) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const selectedUsers = useMemo(
    () => users.filter((u) => selected.includes(u.id)),
    [users, selected]
  );

  const startWith = (targets: PublicUser[], video: boolean) => {
    if (!targets.length) return;
    setSelected([]);
    void call.startCall(targets, video);
  };

  const onlineCount = users.filter((u) => u.online).length;

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      {/* ------------------------------------------------------- header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          {user && (
            <Avatar
              userId={user.id}
              name={user.displayName}
              uri={user.avatarUrl}
              size={40}
            />
          )}
          <View style={styles.headerText}>
            <Text style={styles.headerName} numberOfLines={1}>
              {user?.displayName ?? ""}
            </Text>
            <View style={styles.statusRow}>
              <View
                style={[
                  styles.statusDot,
                  {
                    backgroundColor: connected
                      ? colors.success
                      : colors.warning,
                  },
                ]}
              />
              <Text style={styles.statusText}>
                {connected ? "Connected" : "Reconnecting…"}
              </Text>
            </View>
          </View>
        </View>
        <Pressable
          onPress={() => void logout()}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Sign out"
          style={styles.iconButton}
        >
          <LogOutIcon size={20} color={colors.textDim} />
        </Pressable>
      </View>

      {/* --------------------------------------------------------- tabs */}
      <View style={styles.tabs}>
        <Pressable
          onPress={() => setTab("contacts")}
          style={[styles.tab, tab === "contacts" && styles.tabActive]}
        >
          <UsersIcon
            size={16}
            color={tab === "contacts" ? colors.text : colors.textFaint}
          />
          <Text
            style={[styles.tabText, tab === "contacts" && styles.tabTextActive]}
          >
            Contacts{onlineCount ? ` · ${onlineCount} online` : ""}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setTab("history")}
          style={[styles.tab, tab === "history" && styles.tabActive]}
        >
          <ClockIcon
            size={16}
            color={tab === "history" ? colors.text : colors.textFaint}
          />
          <Text
            style={[styles.tabText, tab === "history" && styles.tabTextActive]}
          >
            History
          </Text>
        </Pressable>
      </View>

      {/* ------------------------------------------------------- content */}
      {tab === "contacts" ? (
        <FlatList
          data={users}
          keyExtractor={(u) => u.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.textDim}
            />
          }
          ListEmptyComponent={
            loading ? (
              <ActivityIndicator
                color={colors.textDim}
                style={styles.spinner}
              />
            ) : (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>
                  {error ? "Can't reach the server" : "No one else here yet"}
                </Text>
                <Text style={styles.emptyText}>
                  {error ??
                    "Register another account on a second device to call it."}
                </Text>
              </View>
            )
          }
          renderItem={({ item }) => {
            const isSelected = selected.includes(item.id);
            return (
              <Pressable
                onPress={() =>
                  selectionMode ? toggleSelect(item.id) : startWith([item], false)
                }
                onLongPress={() => toggleSelect(item.id)}
                style={({ pressed }) => [
                  styles.row,
                  isSelected && styles.rowSelected,
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Avatar
                  userId={item.id}
                  name={item.displayName}
                  uri={item.avatarUrl}
                  size={48}
                  online={item.online}
                  showPresence
                  ring={isSelected}
                />
                <View style={styles.rowText}>
                  <Text style={styles.rowName} numberOfLines={1}>
                    {item.displayName}
                  </Text>
                  <Text style={styles.rowSub} numberOfLines={1}>
                    {item.online
                      ? "Online"
                      : item.lastSeen
                        ? `Last seen ${formatRelative(item.lastSeen)}`
                        : "Offline"}
                  </Text>
                </View>

                {!selectionMode && (
                  <View style={styles.rowActions}>
                    <Pressable
                      onPress={() => startWith([item], false)}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={`Audio call ${item.displayName}`}
                      style={styles.callButton}
                    >
                      <PhoneIcon size={17} color="#fff" />
                    </Pressable>
                    <Pressable
                      onPress={() => startWith([item], true)}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={`Video call ${item.displayName}`}
                      style={[
                        styles.callButton,
                        { backgroundColor: colors.surfaceHi },
                      ]}
                    >
                      <VideoIcon size={17} color={colors.text} />
                    </Pressable>
                  </View>
                )}

                {selectionMode && (
                  <View
                    style={[styles.check, isSelected && styles.checkOn]}
                  >
                    {isSelected && <Text style={styles.checkMark}>✓</Text>}
                  </View>
                )}
              </Pressable>
            );
          }}
        />
      ) : (
        <FlatList
          data={history}
          keyExtractor={(h) => h.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.textDim}
            />
          }
          ListEmptyComponent={
            historyLoading ? (
              <ActivityIndicator
                color={colors.textDim}
                style={styles.spinner}
              />
            ) : (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>No calls yet</Text>
                <Text style={styles.emptyText}>
                  Your call history will show up here.
                </Text>
              </View>
            )
          }
          renderItem={({ item }) => {
            const others = item.participants.filter((p) => p.id !== user?.id);
            const outgoing = item.initiatorId === user?.id;
            const missed = item.status === "missed";
            const primary = others[0];
            const label = joinNames(others.map((o) => o.displayName)) || "Unknown";
            const detail =
              item.status === "completed"
                ? formatDuration(item.durationSec)
                : item.status === "missed"
                  ? outgoing
                    ? "No answer"
                    : "Missed"
                  : item.status === "rejected"
                    ? "Declined"
                    : "Canceled";

            return (
              <Pressable
                onPress={() => {
                  const targets = users.filter((u) =>
                    others.some((o) => o.id === u.id)
                  );
                  if (targets.length) startWith(targets, item.video);
                }}
                style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
              >
                <Avatar
                  userId={primary?.id ?? item.id}
                  name={primary?.displayName ?? "?"}
                  uri={primary?.avatarUrl}
                  size={44}
                />
                <View style={styles.rowText}>
                  <Text
                    style={[styles.rowName, missed && { color: colors.danger }]}
                    numberOfLines={1}
                  >
                    {label}
                    {item.type === "group" ? "  ·  Group" : ""}
                  </Text>
                  <View style={styles.historyMeta}>
                    {outgoing ? (
                      <ArrowOutgoingIcon
                        size={13}
                        color={missed ? colors.danger : colors.textFaint}
                      />
                    ) : (
                      <ArrowIncomingIcon
                        size={13}
                        color={missed ? colors.danger : colors.success}
                      />
                    )}
                    <Text style={styles.rowSub}>
                      {detail} · {formatRelative(item.startedAt)}
                      {item.video ? " · Video" : ""}
                    </Text>
                  </View>
                </View>
              </Pressable>
            );
          }}
        />
      )}

      {/* --------------------------------------- group-call action bar */}
      {selectionMode && (
        <View style={styles.groupBar}>
          <View style={styles.groupInfo}>
            <Text style={styles.groupCount}>
              {selected.length} selected
            </Text>
            <Text style={styles.groupNames} numberOfLines={1}>
              {joinNames(selectedUsers.map((u) => u.displayName), 3)}
            </Text>
          </View>
          <Pressable
            onPress={() => setSelected([])}
            style={styles.groupCancel}
            accessibilityRole="button"
          >
            <Text style={styles.groupCancelText}>Clear</Text>
          </Pressable>
          <Pressable
            onPress={() => startWith(selectedUsers, false)}
            style={styles.groupCall}
            accessibilityRole="button"
            accessibilityLabel="Start group audio call"
          >
            <PhoneIcon size={18} color="#fff" />
          </Pressable>
          <Pressable
            onPress={() => startWith(selectedUsers, true)}
            style={[styles.groupCall, { backgroundColor: colors.accent }]}
            accessibilityRole="button"
            accessibilityLabel="Start group video call"
          >
            <VideoIcon size={18} color="#fff" />
          </Pressable>
        </View>
      )}

      {call.error && (
        <View style={styles.toast}>
          <Text style={styles.toastText}>{call.error}</Text>
          <Pressable onPress={call.clearError} hitSlop={8}>
            <Text style={styles.toastDismiss}>Dismiss</Text>
          </Pressable>
        </View>
      )}
      {!call.error && call.statusNote && (
        <View style={[styles.toast, styles.toastNeutral]}>
          <Text style={styles.toastText}>{call.statusNote}</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    paddingTop: spacing.sm,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", flex: 1 },
  headerText: { marginLeft: spacing.md, flex: 1 },
  headerName: { color: colors.text, fontSize: font.lg, fontWeight: "700" },
  statusRow: { flexDirection: "row", alignItems: "center", marginTop: 2 },
  statusDot: { width: 7, height: 7, borderRadius: 4, marginRight: 6 },
  statusText: { color: colors.textDim, fontSize: font.xs },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceAlt,
  },
  tabs: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabActive: { backgroundColor: colors.surfaceHi, borderColor: colors.borderStrong },
  tabText: { color: colors.textFaint, fontSize: font.sm, fontWeight: "600" },
  tabTextActive: { color: colors.text },
  list: { paddingHorizontal: spacing.lg, paddingBottom: 120 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowSelected: {
    borderColor: colors.accent,
    backgroundColor: "rgba(91,124,250,0.10)",
  },
  rowText: { flex: 1, marginLeft: spacing.md, marginRight: spacing.sm },
  rowName: { color: colors.text, fontSize: font.md, fontWeight: "600" },
  rowSub: { color: colors.textDim, fontSize: font.xs, marginTop: 2 },
  rowActions: { flexDirection: "row", gap: spacing.sm },
  callButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.success,
    alignItems: "center",
    justifyContent: "center",
  },
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  checkOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  checkMark: { color: "#fff", fontSize: 13, fontWeight: "700" },
  historyMeta: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 },
  spinner: { marginTop: spacing.xxl },
  empty: { alignItems: "center", paddingTop: spacing.xxl * 1.5 },
  emptyTitle: { color: colors.text, fontSize: font.md, fontWeight: "600" },
  emptyText: {
    color: colors.textFaint,
    fontSize: font.sm,
    marginTop: 6,
    textAlign: "center",
    paddingHorizontal: spacing.xl,
    lineHeight: 19,
  },
  groupBar: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.xl,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.xl,
    backgroundColor: colors.surfaceHi,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  groupInfo: { flex: 1 },
  groupCount: { color: colors.text, fontSize: font.sm, fontWeight: "700" },
  groupNames: { color: colors.textDim, fontSize: font.xs, marginTop: 1 },
  groupCancel: { paddingHorizontal: spacing.sm },
  groupCancelText: { color: colors.textDim, fontSize: font.sm },
  groupCall: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.success,
    alignItems: "center",
    justifyContent: "center",
  },
  toast: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.xl,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: "rgba(244,63,94,0.16)",
    borderWidth: 1,
    borderColor: "rgba(244,63,94,0.4)",
  },
  toastNeutral: {
    backgroundColor: colors.surfaceHi,
    borderColor: colors.borderStrong,
  },
  toastText: { color: colors.text, fontSize: font.sm, flex: 1, lineHeight: 19 },
  toastDismiss: { color: colors.accentLight, fontSize: font.sm, fontWeight: "600" },
});
