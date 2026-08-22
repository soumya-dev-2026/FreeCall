# FreeCall mobile client

React Native via Expo, with `react-native-webrtc` for media. Same server, same
contract, same features as the web client — plus a native camera flip and an
Android screen share.

## Expo Go will not work

`react-native-webrtc` ships native code, so this app has to be built. That's the
one setup step that surprises people, so it's first:

```bash
npm install                 # or `npm run install:all` from the repo root
npx expo prebuild           # generates android/ and ios/ (both gitignored)
npm run android             # or: npm run ios
```

Requirements are the usual native ones: Android Studio with an SDK and a device
or emulator for Android; Xcode and CocoaPods for iOS. After the first build,
`npm start` (`expo start --dev-client`) attaches the dev server to the installed
build for fast JS reloads. Re-run `prebuild` only when you change `app.json`
plugins or native config.

## Point it at your server

A phone can't reach your computer's `localhost`. Set your machine's LAN IP in
`app.json`:

```json
"extra": { "serverUrl": "http://192.168.1.100:4000" }
```

Then confirm the server is reachable from the phone's browser at
`http://<that-ip>:4000/health` before debugging anything else — a wrong IP looks
exactly like a broken socket. The server's CORS policy already allows LAN IP
origins in dev, and native apps send no `Origin` header at all, so nothing else
needs configuring.

## Screens and files

No navigation library: `App.tsx` renders straight from the call phase (loading,
signed out, incoming, outgoing/active, home). That's deliberate — it makes it
impossible for an incoming-call screen to end up buried under a navigation
stack.

| File | Responsibility |
|------|----------------|
| `src/state/useCall.ts` | Call state machine and socket handlers (mirrors the web client). |
| `src/lib/peer.ts` | One `RTCPeerConnection` per peer, same glare-free initiator rule. |
| `src/lib/media.ts` | `mediaDevices` wrappers, `_switchCamera()`, Android screen capture. |
| `src/lib/ringer.ts` | Ringtone via `expo-av`, with vibration. |
| `src/lib/push.ts` | Expo push token registration, the `calls` Android channel, tap handling. |
| `src/lib/api.ts` | REST client; token in `AsyncStorage`. |
| `src/theme.ts` | Colors, spacing and type scale — the RN equivalent of the web Tailwind theme. |
| `src/shared/types.ts` | Verbatim copy of `../../shared/types.ts`. Do not edit here. |

`npm run typecheck` runs `tsc --noEmit`. Also run `python3 tools/check.py .` from
the repo root, which is what catches the shared-types copy drifting.

## Platform differences that are intentional

**Screen sharing is Android-only.** Android has MediaProjection, which
`react-native-webrtc` exposes through `getDisplayMedia`. iOS needs a Broadcast
Upload Extension — a separate native target that `expo prebuild` can't generate —
so `canShareScreen()` returns false there and the button is hidden rather than
shown-and-broken.

**Camera flip uses the native path.** `react-native-webrtc` video tracks expose
`_switchCamera()`, which swaps the camera in place with no new track and no
renegotiation. `media.ts` falls back to re-acquiring with
`facingMode: { exact: "environment" }` if that method is ever missing.

**Push needs a device and an EAS project.** Simulators can't get an Expo push
token, and `getExpoPushTokenAsync` needs an EAS `projectId` — run
`eas init` (or add `extra.eas.projectId` to `app.json`) if you want push. For
Android delivery you also need an FCM server key uploaded to your Expo project;
[Expo's FCM setup guide](https://docs.expo.dev/push-notifications/fcm-credentials/)
covers it. Without any of this the app still rings normally whenever it's
running — push only matters for a backgrounded app.

The server sends push through Expo's HTTPS API and needs no credentials of its
own, so there is nothing to configure on that side.

## Permissions

`app.json` already declares camera, microphone, notifications, wake lock and the
Android media-projection foreground service, with usage strings for iOS. The
`@config-plugins/react-native-webrtc` plugin adds the rest of the native WebRTC
wiring at prebuild time. iOS background modes include `audio` and `voip` so a
call survives the screen locking.
