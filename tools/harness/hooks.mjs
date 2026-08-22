/**
 * Module hooks that let the real server TypeScript run under plain Node with
 * no node_modules: extensionless relative imports get ".ts" appended, and the
 * handful of npm packages the server touches at runtime resolve to the tiny
 * shims in ./shims/.
 */
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve as pathResolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Bare specifier -> shim file. Only what the server imports at runtime. */
const SHIMS = new Set([
  "bcryptjs",
  "uuid",
  "jsonwebtoken",
  "dotenv",
  "web-push",
  "express",
]);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (SHIMS.has(specifier)) {
      return {
        url: pathToFileURL(pathResolve(HERE, "shims", `${specifier}.mjs`)).href,
        shortCircuit: true,
      };
    }

    if (specifier.startsWith(".") && context.parentURL) {
      const parentDir = dirname(fileURLToPath(context.parentURL));
      const base = pathResolve(parentDir, specifier);
      for (const candidate of [`${base}.ts`, `${base}/index.ts`]) {
        if (existsSync(candidate)) {
          return { url: pathToFileURL(candidate).href, shortCircuit: true };
        }
      }
    }

    return nextResolve(specifier, context);
  },
});
