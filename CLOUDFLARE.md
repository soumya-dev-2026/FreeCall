# Cloudflare deployment

The web app and same-origin gateway deploy to **freecall-caller.pages.dev**.
The existing Express/Socket.IO service stays at
**https://freecall-server.onrender.com**. Cloudflare Pages does not execute
`server/dist`: server changes require a separate Render deployment through the
existing `render.yaml` workflow. Native app changes require a new mobile build.

`wrangler.toml` defines the Pages project, asset folder, and gateway upstream.
`web/public/_worker.js` proxies `/api/*`, `/socket.io/*`, and `/health`, preserving
WebSocket upgrades and disabling response caching. Browser API requests use
the current origin in production; local development still uses port 4000.
`VITE_SERVER_URL` can override that for other deployment arrangements.

From the repository root, with Wrangler authenticated:

```sh
npm ci
npm test
npm run test:media
node tools/harness/gateway.mjs
python3 tools/check.py .
npm run build:web
npx wrangler pages deploy web/dist --project-name freecall-caller --branch main
node tools/harness/live.mjs https://freecall-caller.pages.dev
```

The live smoke check creates two isolated QA accounts in the in-memory server,
then tests login, authenticated API access, WebSocket and polling connections,
call acceptance, media-state and ICE relay in both directions, and hangup.
It does not capture actual audio/video or contact existing users.

Before treating calling as verified on real devices, test speech and moving
video in both directions, mute/unmute, camera off/on, and hangup. Repeat on
separate networks. Configure TURN on the backend for restrictive networks.
The Render service may take time to wake from idle; server restarts clear
registered accounts and history because storage is currently in memory.

## Verified release — 2026-09-09

Production: https://freecall-caller.pages.dev
Deployment: https://8ea2b07c.freecall-caller.pages.dev

- 113 signaling assertions pass; all six injected server faults are detected.
- Eight web/mobile negotiation model cases pass.
- Gateway tests cover authentication/body forwarding, cross-origin rejection,
  cache bypass, bidirectional WebSocket frames, close handling, and outages.
- Web/server builds, all three typechecks, and the cross-package checker pass.
- Root workspace npm audit reports zero vulnerabilities after dependency fixes.
  This audits local web/server dependencies, not the existing Render runtime
  or the separate mobile dependency tree.
- The public URL passes the live smoke check with authenticated WebSocket and
  polling connections, acceptance, bidirectional media-state/ICE relay, and
  hangup. HTTPS HTML and JavaScript asset requests return 200.
- Real camera/microphone playback is unverified. The live backend reports no
  TURN server. Server and native changes in this workspace are not deployed
  by the Cloudflare Pages upload.

WebSocket upgrades must not receive HTTP cache overrides. Regular API and
polling requests use `cacheTtl: -1`, rather than zero, plus `no-store` responses.
