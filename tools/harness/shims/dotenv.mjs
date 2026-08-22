/** dotenv shim: parses ./.env from cwd if present, like the real thing. */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function config(opts = {}) {
  const file = opts.path ?? resolve(process.cwd(), ".env");
  if (!existsSync(file)) return { parsed: {} };
  const parsed = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([\w.-]+)\s*=\s*(.*)?\s*$/.exec(line);
    if (!m || line.trim().startsWith("#")) continue;
    let v = (m[2] ?? "").trim();
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    parsed[m[1]] = v;
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
  return { parsed };
}

export { config };
export default { config };
