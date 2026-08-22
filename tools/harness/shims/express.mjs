/**
 * express shim: just enough Router to register the real routes and dispatch
 * requests through the real middleware chain (including requireAuth).
 */
function matchPath(pattern, actual) {
  const p = pattern.split("/").filter(Boolean);
  const a = actual.split("/").filter(Boolean);
  if (p.length !== a.length) return null;
  const params = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(":")) params[p[i].slice(1)] = decodeURIComponent(a[i]);
    else if (p[i] !== a[i]) return null;
  }
  return params;
}

export function Router() {
  const routes = [];
  const add = (method) => (path, ...handlers) =>
    routes.push({ method, path, handlers });

  const router = {
    get: add("GET"),
    post: add("POST"),
    put: add("PUT"),
    patch: add("PATCH"),
    delete: add("DELETE"),
    _routes: routes,

    /** Run a request through the chain; resolves to { status, body }. */
    async _dispatch(method, path, { headers = {}, body = undefined } = {}) {
      const route = routes
        .map((r) => ({ r, params: matchPath(r.path, path) }))
        .find(({ r, params }) => r.method === method && params);
      if (!route) return { status: 404, body: { error: "no such route" } };

      const req = {
        method,
        path,
        headers: Object.fromEntries(
          Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])
        ),
        body,
        params: route.params,
        query: {},
      };

      return await new Promise((resolve, reject) => {
        let settled = false;
        const res = {
          statusCode: 200,
          status(code) {
            this.statusCode = code;
            return this;
          },
          json(payload) {
            if (!settled) {
              settled = true;
              resolve({ status: this.statusCode, body: payload });
            }
            return this;
          },
          send(payload) {
            return this.json(payload);
          },
        };

        let i = 0;
        const next = (err) => {
          if (err) return reject(err);
          const h = route.r.handlers[i++];
          if (!h) {
            if (!settled) resolve({ status: 500, body: { error: "no handler responded" } });
            return;
          }
          try {
            h(req, res, next);
          } catch (e) {
            reject(e);
          }
        };
        next();
      });
    },
  };
  return router;
}

export default { Router, json: () => (_req, _res, next) => next() };
