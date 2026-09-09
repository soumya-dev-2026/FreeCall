import assert from 'node:assert/strict';
import gateway from '../../web/public/_worker.js';
const env = { SERVER_ORIGIN: 'https://backend.example', ASSETS: { fetch: () => new Response('asset') } };
let calls = 0;
globalThis.fetch = async (request, options) => {
  calls++;
  assert.equal(options.cf.cacheTtl, -1);
  assert.equal(request.url, 'https://backend.example/api/auth/login');
  assert.equal(request.headers.get('Origin'), null);
  assert.equal(request.headers.get('Cookie'), null);
  assert.equal(request.headers.get('Authorization'), 'Bearer test');
  assert.equal(await request.text(), '{"test":true}');
  return Response.json({ ok: true });
};
const response = await gateway.fetch(new Request('https://app.example/api/auth/login', {
  method: 'POST', headers: { Origin: 'https://app.example', Cookie: 'private=1', Authorization: 'Bearer test' },
  body: '{"test":true}',
}), env);
assert.equal(response.status, 200);
assert.equal(response.headers.get('Cache-Control'), 'no-store');
assert.deepEqual(await response.json(), { ok: true });
assert.equal((await gateway.fetch(new Request('https://app.example/api/auth/login', {
  headers: { Origin: 'https://other.example' },
}), env)).status, 403);
assert.equal(calls, 1);
assert.equal(await (await gateway.fetch(new Request('https://app.example/'), env)).text(), 'asset');
class Socket {
  events = {};
  sent = [];
  accept() { this.accepted = true; }
  addEventListener(name, listener) { this.events[name] = listener; }
  send(data) { this.sent.push(data); }
  close(code) { this.closed = code; }
}
const upstream = new Socket();
const client = new Socket();
const server = new Socket();
globalThis.WebSocketPair = class { constructor() { return { 0: client, 1: server }; } };
const NativeResponse = globalThis.Response;
globalThis.Response = class extends NativeResponse {
  constructor(body, init) {
    if (init?.status === 101) return { status: 101, webSocket: init.webSocket };
    super(body, init);
  }
};
const upgrade = { status: 101, webSocket: upstream };
globalThis.fetch = async (request, options) => {
  assert.equal(options.cf, undefined, 'WebSocket upgrades must bypass cache overrides');
  assert.equal(request.url, 'https://backend.example/socket.io/?EIO=4&transport=websocket');
  assert.equal(request.headers.get('Upgrade'), 'websocket');
  return upgrade;
};
assert.equal((await gateway.fetch(new Request('https://app.example/socket.io/?EIO=4&transport=websocket', {
  headers: { Upgrade: 'websocket' },
}), env)).webSocket, client);
assert.equal(upstream.accepted, true);
assert.equal(server.accepted, true);
server.events.message({ data: 'client-auth' });
upstream.events.message({ data: 'server-accepted' });
assert.deepEqual(upstream.sent, ['client-auth']);
assert.deepEqual(server.sent, ['server-accepted']);
server.events.close({ code: 1006, reason: '' });
assert.equal(upstream.closed, 1000);
globalThis.Response = NativeResponse;
globalThis.fetch = async () => { throw new Error('offline'); };
assert.equal((await gateway.fetch(new Request('https://app.example/health'), env)).status, 502);
console.log('Gateway checks passed: body/auth forwarding, origin guard, no cache, assets, WebSocket upgrade, outage response');
