/**
 * Active / outgoing call screen.
 *
 * Video tiles are driven by the *signaled* media state, not by inspecting the
 * remote track. Because we pre-create sendrecv transceivers, a peer with the
 * camera off still has a live-but-empty video track, so `track.muted` isn't a
 * reliable signal — `participant.media` is.
 */

import { useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { RTCView } from "react-native-webrtc";
import { Avatar } from "../components/Avatar";
import { ChatPanel } from "../components/ChatPanel";
import { ControlButton } from "../components/ControlButton";
import {
  ChatIcon,
  FlipCameraIcon,
  MicIcon,
  MicOffIcon,
  PhoneOffIcon,
  ScreenShareIcon,
  ScreenShareOffIcon,
  VideoIcon,
  VideoOffIcon,
} from "../components/Icons";
import type { CallController, Participant } from "../state/useCall";
import { useAuth } from "../state/AuthContext";
import {
  colors,
  font,
  formatDuration,
  joinNames,
  radius,
  spacing,
} from "../theme";

interface Props {
  call: CallController;
}

/** A single remote participant: video when they're sending it, avatar when not. */
function RemoteTile({
  p,
  width,
  height,
}: {
  p: Participant;
  width: number;
  height: number;
}) {
  const showVideo = Boolean(p.stream) && (p.media.video || p.media.screen);
  const connecting = p.connState !== "connected" && p.connState !== "completed";

  return (
    <View style={[styles.tile, { width, height }]}>
      {showVideo && p.stream ? (
        <RTCView
          streamURL={p.stream.toURL()}
          style={styles.video}
          objectFit={p.media.screen ? "contain" : "cover"}
        />
      ) : (
        <View style={styles.tileFallback}>
          <Avatar
            userId={p.user.id}
            name={p.user.displayName}
            uri={p.user.avatarUrl}
            size={Math.min(96, Math.round(Math.min(width, height) * 0.34))}
          />
        </View>
      )}

      <View style={styles.tileLabel}>
        <Text style={styles.tileName} numberOfLines={1}>
          {p.user.displayName}
        </Text>
        {!p.media.audio && <MicOffIcon size={13} color={colors.danger} />}
        {p.media.screen && <Text style={styles.tileTag}>screen</Text>}
      </View>

      {connecting && (
        <View style={styles.connecting}>
          <Text style={styles.connectingText}>
            {p.connState === "failed"
              ? "Connection failed — retrying"
              : "Connecting…"}
          </Text>
        </View>
      )}
    </View>
  );
}

export function CallScreen({ call }: Props) {
  const { user } = useAuth();
  const { width, height } = useWindowDimensions();
  const [chatOpen, setChatOpen] = useState(false);

  const openChat = (open: boolean) => {
    setChatOpen(open);
    call.setChatOpen(open);
  };

  const remotes = call.participants;
  const outgoing = call.phase === "outgoing";

  /* Tile geometry: 1 full-bleed, 2 stacked, 3+ in a 2-column grid. */
  const grid = useMemo(() => {
    const n = Math.max(1, remotes.length);
    const available = height - 260;
    if (n === 1) return { w: width, h: available, cols: 1 };
    if (n === 2) return { w: width, h: available / 2, cols: 1 };
    const cols = 2;
    const rows = Math.ceil(n / cols);
    return { w: width / cols, h: available / Math.min(rows, 3), cols };
  }, [remotes.length, width, height]);

  const showLocalVideo = call.localStream && (call.camOn || call.screenOn);

  const title = outgoing
    ? joinNames(call.ringingUsers.map((u) => u.displayName)) || "Calling…"
    : joinNames(remotes.map((p) => p.user.displayName)) || "Call";

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
        {/* ------------------------------------------------------ header */}
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {title}
            </Text>
            <Text style={styles.headerSub}>
              {outgoing
                ? "Ringing…"
                : `${formatDuration(call.elapsed)}${
                    call.callType === "group"
                      ? `  ·  ${remotes.length + 1} people`
                      : ""
                  }`}
            </Text>
          </View>
        </View>

        {/* ------------------------------------------------------ stage */}
        {outgoing ? (
          <View style={styles.outgoing}>
            <View style={styles.outgoingAvatars}>
              {call.ringingUsers.slice(0, 3).map((u, i) => (
                <Avatar
                  key={u.id}
                  userId={u.id}
                  name={u.displayName}
                  uri={u.avatarUrl}
                  size={call.ringingUsers.length > 1 ? 88 : 128}
                  ring
                  style={i > 0 ? { marginLeft: -18 } : undefined}
                />
              ))}
            </View>
            <Text style={styles.outgoingName}>{title}</Text>
            <Text style={styles.outgoingHint}>
              {call.isVideoCall ? "Video call" : "Audio call"} · waiting for an
              answer
            </Text>
          </View>
        ) : remotes.length === 0 ? (
          <View style={styles.outgoing}>
            <Text style={styles.outgoingHint}>Waiting for others to join…</Text>
          </View>
        ) : grid.cols === 1 ? (
          <ScrollView contentContainerStyle={styles.stageStack}>
            {remotes.map((p) => (
              <RemoteTile key={p.user.id} p={p} width={grid.w} height={grid.h} />
            ))}
          </ScrollView>
        ) : (
          <ScrollView contentContainerStyle={styles.stageGrid}>
            {remotes.map((p) => (
              <RemoteTile key={p.user.id} p={p} width={grid.w} height={grid.h} />
            ))}
          </ScrollView>
        )}

        {/* ------------------------------------------- local preview PiP */}
        {showLocalVideo && call.localStream && (
          <View style={styles.pip} key={call.localVersion}>
            <RTCView
              streamURL={call.localStream.toURL()}
              style={styles.video}
              objectFit="cover"
              mirror={call.frontCamera && !call.screenOn}
              zOrder={1}
            />
            {call.screenOn && (
              <View style={styles.pipTag}>
                <Text style={styles.pipTagText}>Sharing</Text>
              </View>
            )}
          </View>
        )}

        {call.statusNote && (
          <View style={styles.note}>
            <Text style={styles.noteText}>{call.statusNote}</Text>
          </View>
        )}

        {/* ---------------------------------------------------- controls */}
        <View style={styles.controls}>
          <View style={styles.controlRow}>
            <ControlButton
              onPress={call.toggleMic}
              active={call.micOn}
              label={call.micOn ? "Mute" : "Unmute"}
              icon={(c, s) =>
                call.micOn ? (
                  <MicIcon size={s} color={c} />
                ) : (
                  <MicOffIcon size={s} color={c} />
                )
              }
            />
            <ControlButton
              onPress={() => void call.toggleCamera()}
              active={call.camOn}
              label={call.camOn ? "Camera" : "Camera"}
              icon={(c, s) =>
                call.camOn ? (
                  <VideoIcon size={s} color={c} />
                ) : (
                  <VideoOffIcon size={s} color={c} />
                )
              }
            />
            <ControlButton
              onPress={() => void call.flipCamera()}
              disabled={!call.camOn || call.screenOn}
              label="Flip"
              icon={(c, s) => <FlipCameraIcon size={s} color={c} />}
            />
            {call.canShare && (
              <ControlButton
                onPress={() => void call.toggleScreenShare()}
                active={call.screenOn}
                label="Share"
                icon={(c, s) =>
                  call.screenOn ? (
                    <ScreenShareOffIcon size={s} color={c} />
                  ) : (
                    <ScreenShareIcon size={s} color={c} />
                  )
                }
              />
            )}
            <ControlButton
              onPress={() => openChat(true)}
              label="Chat"
              badge={call.unread}
              icon={(c, s) => <ChatIcon size={s} color={c} />}
            />
          </View>

          <Pressable
            onPress={call.hangUp}
            accessibilityRole="button"
            accessibilityLabel="Hang up"
            style={({ pressed }) => [
              styles.hangUp,
              { opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <PhoneOffIcon size={28} color="#fff" />
            <Text style={styles.hangUpText}>
              {outgoing ? "Cancel" : "Hang up"}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>

      <ChatPanel
        visible={chatOpen}
        onClose={() => openChat(false)}
        messages={call.messages}
        selfId={user?.id ?? ""}
        onSend={call.sendMessage}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#04060c" },
  safe: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  headerText: { flex: 1 },
  headerTitle: { color: colors.text, fontSize: font.lg, fontWeight: "700" },
  headerSub: { color: colors.textDim, fontSize: font.sm, marginTop: 2 },
  outgoing: { flex: 1, alignItems: "center", justifyContent: "center" },
  outgoingAvatars: {
    flexDirection: "row",
    marginBottom: spacing.xl,
  },
  outgoingName: {
    color: colors.text,
    fontSize: font.xl,
    fontWeight: "700",
    textAlign: "center",
    paddingHorizontal: spacing.xl,
  },
  outgoingHint: {
    color: colors.textDim,
    fontSize: font.sm,
    marginTop: 6,
    textAlign: "center",
    paddingHorizontal: spacing.xl,
  },
  stageStack: { flexGrow: 1, justifyContent: "center" },
  stageGrid: {
    flexGrow: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    alignContent: "center",
  },
  tile: {
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(0,0,0,0.6)",
    overflow: "hidden",
    justifyContent: "center",
  },
  video: { flex: 1, backgroundColor: "#000" },
  tileFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceAlt,
  },
  tileLabel: {
    position: "absolute",
    left: spacing.sm,
    bottom: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    maxWidth: "88%",
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.sm,
    backgroundColor: colors.chip,
  },
  tileName: { color: "#fff", fontSize: font.xs, fontWeight: "600" },
  tileTag: {
    color: colors.accentLight,
    fontSize: 10,
    textTransform: "uppercase",
    fontWeight: "700",
  },
  connecting: {
    position: "absolute",
    top: spacing.sm,
    alignSelf: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.chip,
  },
  connectingText: { color: colors.textDim, fontSize: font.xs },
  pip: {
    position: "absolute",
    right: spacing.md,
    top: 96,
    width: 104,
    height: 150,
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: "#000",
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  pipTag: {
    position: "absolute",
    left: 4,
    bottom: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: colors.chip,
  },
  pipTagText: { color: "#fff", fontSize: 9, fontWeight: "700" },
  note: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    bottom: 220,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.chip,
  },
  noteText: { color: colors.text, fontSize: font.sm, textAlign: "center" },
  controls: {
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    backgroundColor: "rgba(8,11,20,0.9)",
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  controlRow: {
    flexDirection: "row",
    justifyContent: "center",
    flexWrap: "wrap",
    rowGap: spacing.md,
  },
  hangUp: {
    marginTop: spacing.lg,
    marginHorizontal: spacing.xl,
    height: 58,
    borderRadius: radius.pill,
    backgroundColor: colors.danger,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  hangUpText: { color: "#fff", fontSize: font.md, fontWeight: "700" },
});
