/**
 * In-call chat, presented as a bottom sheet over the video.
 *
 * Own messages are right-aligned in accent; others get the sender's name so
 * group calls stay readable. Uses KeyboardAvoidingView because a chat sheet
 * that hides behind the keyboard is worse than no chat at all.
 */

import { useEffect, useRef, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CloseIcon, SendIcon } from "./Icons";
import { colors, font, formatClockTime, radius, spacing } from "../theme";
import type { ChatMessage } from "../shared/types";

interface Props {
  visible: boolean;
  onClose: () => void;
  messages: ChatMessage[];
  selfId: string;
  onSend: (text: string) => void;
}

export function ChatPanel({
  visible,
  onClose,
  messages,
  selfId,
  onSend,
}: Props) {
  const [text, setText] = useState("");
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!visible || messages.length === 0) return;
    const t = setTimeout(
      () => listRef.current?.scrollToEnd({ animated: true }),
      60
    );
    return () => clearTimeout(t);
  }, [visible, messages.length]);

  const submit = () => {
    const clean = text.trim();
    if (!clean) return;
    onSend(clean);
    setText("");
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <Pressable style={styles.dismissArea} onPress={onClose} />

        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.sheet}
        >
          <View style={styles.header}>
            <Text style={styles.title}>Chat</Text>
            <Pressable
              onPress={onClose}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Close chat"
            >
              <CloseIcon size={22} color={colors.textDim} />
            </Pressable>
          </View>

          {messages.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                No messages yet. Say something.
              </Text>
            </View>
          ) : (
            <FlatList
              ref={listRef}
              data={messages}
              keyExtractor={(m) => m.id}
              contentContainerStyle={styles.list}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item, index }) => {
                const mine = item.from.id === selfId;
                const prev = messages[index - 1];
                const grouped = prev && prev.from.id === item.from.id;
                return (
                  <View
                    style={[
                      styles.row,
                      mine ? styles.rowMine : styles.rowTheirs,
                      { marginTop: grouped ? 3 : 10 },
                    ]}
                  >
                    <View
                      style={[
                        styles.bubble,
                        mine ? styles.bubbleMine : styles.bubbleTheirs,
                      ]}
                    >
                      {!mine && !grouped && (
                        <Text style={styles.sender}>
                          {item.from.displayName}
                        </Text>
                      )}
                      <Text style={styles.body}>{item.text}</Text>
                      <Text style={styles.time}>{formatClockTime(item.ts)}</Text>
                    </View>
                  </View>
                );
              }}
            />
          )}

          <View
            style={[
              styles.composer,
              { paddingBottom: Math.max(insets.bottom, spacing.md) },
            ]}
          >
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Message"
              placeholderTextColor={colors.textFaint}
              style={styles.input}
              multiline
              maxLength={2000}
              returnKeyType="send"
              blurOnSubmit={false}
              onSubmitEditing={submit}
            />
            <Pressable
              onPress={submit}
              disabled={!text.trim()}
              accessibilityRole="button"
              accessibilityLabel="Send message"
              style={({ pressed }) => [
                styles.send,
                {
                  opacity: !text.trim() ? 0.4 : pressed ? 0.8 : 1,
                },
              ]}
            >
              <SendIcon size={19} color="#fff" />
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)" },
  dismissArea: { flex: 1 },
  sheet: {
    maxHeight: "78%",
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  title: { color: colors.text, fontSize: font.lg, fontWeight: "600" },
  empty: { paddingVertical: spacing.xxl, alignItems: "center" },
  emptyText: { color: colors.textFaint, fontSize: font.sm },
  list: { padding: spacing.lg, paddingBottom: spacing.sm },
  row: { flexDirection: "row" },
  rowMine: { justifyContent: "flex-end" },
  rowTheirs: { justifyContent: "flex-start" },
  bubble: {
    maxWidth: "80%",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
  },
  bubbleMine: {
    backgroundColor: colors.accent,
    borderBottomRightRadius: radius.sm,
  },
  bubbleTheirs: {
    backgroundColor: colors.surfaceHi,
    borderBottomLeftRadius: radius.sm,
  },
  sender: {
    color: colors.accentLight,
    fontSize: font.xs,
    fontWeight: "700",
    marginBottom: 2,
  },
  body: { color: "#fff", fontSize: font.md, lineHeight: 20 },
  time: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 10,
    marginTop: 3,
    alignSelf: "flex-end",
  },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  input: {
    flex: 1,
    maxHeight: 110,
    minHeight: 44,
    color: colors.text,
    fontSize: font.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  send: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
});
