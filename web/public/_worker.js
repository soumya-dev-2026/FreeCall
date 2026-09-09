/** Same-origin API and WebSocket gateway for Cloudflare Pages. */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health" || url.pathname.startsWith("/api/") ||
        url.pathname.startsWith("/socket.io/")) {
      const origin = request.headers.get("Origin");
      if (origin && origin !== url.origin) {
        return new Response("Origin not allowed", { status: 403 });
      }
      const upstream = new URL(env.SERVER_ORIGIN || "https://freecall-server.onrender.com");
      url.protocol = upstream.protocol;
      url.host = upstream.host;
      const forwarded = new Request(url, request);
      const headers = forwarded.headers;
      // Origin was validated above; the upstream sees a server-side request.
      headers.delete("Origin");
      headers.delete("Cookie");
      headers.delete("Host");
      try {
        const isWebSocket = headers.get("Upgrade")?.toLowerCase() === "websocket";
        const response = await fetch(forwarded, isWebSocket
          ? { redirect: "manual" }
          : { redirect: "manual", cf: { cacheTtl: -1, cacheEverything: false } });
        if (response.status === 101 && response.webSocket) {
          // Terminate both legs explicitly so client frames reach the origin
          // as well as origin frames reaching the browser.
          const upstreamSocket = response.webSocket;
          const [client, server] = Object.values(new WebSocketPair());
          upstreamSocket.accept();
          server.accept();
          const close = (socket, code = 1011, reason = "Connection closed") => {
            try { socket.close(code === 1005 || code === 1006 ? 1000 : code, reason); }
            catch { /* already closed */ }
          };
          server.addEventListener("message", event => {
            try { upstreamSocket.send(event.data); }
            catch { close(server); close(upstreamSocket); }
          });
          upstreamSocket.addEventListener("message", event => {
            try { server.send(event.data); }
            catch { close(server); close(upstreamSocket); }
          });
          server.addEventListener("close", event => close(upstreamSocket, event.code, event.reason));
          upstreamSocket.addEventListener("close", event => close(server, event.code, event.reason));
          server.addEventListener("error", () => { close(server); close(upstreamSocket); });
          upstreamSocket.addEventListener("error", () => { close(server); close(upstreamSocket); });
          return new Response(null, { status: 101, webSocket: client });
        }
        const result = new Response(response.body, response);
        result.headers.set("Cache-Control", "no-store");
        return result;
      } catch {
        return Response.json({ error: "Calling server is temporarily unavailable. Please retry." }, {
          status: 502,
          headers: { "Cache-Control": "no-store" },
        });
      }
    }
    return env.ASSETS.fetch(request);
  },
};
