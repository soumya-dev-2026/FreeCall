#!/usr/bin/env node
/**
 * A dependency-free static server for the FreeCall browser demo.
 *
 *   node tools/demo/serve.mjs [port]
 *
 * Serves tools/demo/index.html plus the real assets/ringtone.mp3, on
 * http://localhost — which browsers treat as a secure context, so getUserMedia,
 * getDisplayMedia and Notification all work without a certificate. Two tabs are
 * opened, because a call needs two people.
 *
 * This exists so the call flow can be seen in a browser with nothing installed.
 * The full React app is `npm run dev:web`.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");

const ROUTES = {
  "/": { file: join(HERE, "index.html"), type: "text/html; charset=utf-8" },
  "/index.html": { file: join(HERE, "index.html"), type: "text/html; charset=utf-8" },
  "/ringtone.mp3": { file: join(REPO, "assets", "ringtone.mp3"), type: "audio/mpeg" },
};

const server = createServer(async (req, res) => {
  const path = (req.url ?? "/").split("?")[0];
  const route = ROUTES[path];

  if (!route) {
    res.writeHead(path === "/favicon.ico" ? 204 : 404).end();
    return;
  }

  try {
    const body = await readFile(route.file);
    res.writeHead(200, {
      "content-type": route.type,
      "content-length": body.length,
      // The page holds all state in memory; never serve a stale copy while editing.
      "cache-control": "no-store",
    });
    res.end(body);
  } catch (err) {
    res.writeHead(500, { "content-type": "text/plain" });
    res.end(`cannot read ${route.file}: ${err.message}\n`);
  }
});

/** Open a URL in the default browser, on whichever OS this is. */
function open(url) {
  const [cmd, args] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    /* no browser to open; the URL is printed anyway */
  }
}

/** Try `port`, then the next few, so a second run doesn't just fail. */
function listen(port, attemptsLeft = 8) {
  server.once("error", (err) => {
    if (err.code === "EADDRINUSE" && attemptsLeft > 0) {
      console.log(`  port ${port} is busy, trying ${port + 1}`);
      listen(port + 1, attemptsLeft - 1);
    } else {
      console.error(`  cannot listen on ${port}: ${err.message}`);
      process.exit(1);
    }
  });
  server.listen(port, "127.0.0.1", () => {
    const url = `http://localhost:${port}/`;
    console.log(`
  FreeCall demo
  -------------

  ${url}

  Two tabs are opening. Sign in as a different demo user in each, then call
  from one to the other. Wear headphones — two tabs on one machine means the
  speakers feed straight back into the microphones.

  Ctrl-C to stop.
`);
    open(url);
    // A moment apart, or some browsers collapse the two into one window focus.
    setTimeout(() => open(url), 900);
  });
}

const requested = Number.parseInt(process.argv[2] ?? "", 10);
listen(Number.isFinite(requested) ? requested : 8080);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    console.log("\n  stopped");
    server.close(() => process.exit(0));
  });
}
