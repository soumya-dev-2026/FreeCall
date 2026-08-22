#!/usr/bin/env python3
"""
Static consistency checker for the FreeCall monorepo.

npm installs are blocked in this environment, so `tsc --noEmit` isn't
available. This script substitutes for the mechanical half of what tsc would
catch, plus some cross-package checks tsc could never do:

  1. Every relative import resolves to a file that exists.
  2. Every named import is actually exported by the module it comes from.
  3. The three copies of shared/types.ts stay in sync.
  4. Socket.IO event names used by the server and both clients all appear in
     the shared event interfaces (no typo'd event that silently never fires).
  5. Every REST path a client calls exists in the server router, and every
     path in the router is documented in CONTRACT.md.

Usage:  python3 tools/check.py [repo_root]
Exit code is non-zero if any error is found.
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()

errors: list[str] = []
warnings: list[str] = []
checked_imports = 0
checked_names = 0


def err(msg: str) -> None:
    errors.append(msg)


def warn(msg: str) -> None:
    warnings.append(msg)


def rel(p: Path) -> str:
    try:
        return str(p.relative_to(ROOT)).replace(os.sep, "/")
    except ValueError:
        return str(p)


# --------------------------------------------------------------- file walk

SRC_DIRS = [
    ROOT / "server" / "src",
    ROOT / "web" / "src",
    ROOT / "mobile" / "src",
    ROOT / "shared",
]

EXTS = (".ts", ".tsx")


def source_files() -> list[Path]:
    out: list[Path] = []
    for d in SRC_DIRS:
        if not d.exists():
            continue
        for p in sorted(d.rglob("*")):
            if p.is_file() and p.suffix in EXTS and "node_modules" not in p.parts:
                out.append(p)
    return out


FILES = source_files()
TEXT: dict[Path, str] = {p: p.read_text(encoding="utf-8") for p in FILES}


# ------------------------------------------------------- 1 & 2: imports

# import ... from "x"  /  export ... from "x"
IMPORT_RE = re.compile(
    r"""(?:^|\n)\s*(?:import|export)\s+(?P<clause>[^;'"]*?)\s*from\s*["'](?P<mod>[^"']+)["']""",
    re.S,
)
# bare side-effect import:  import "x"
BARE_IMPORT_RE = re.compile(r"""(?:^|\n)\s*import\s*["'](?P<mod>[^"']+)["']""")


def resolve(module: str, importer: Path) -> Path | None:
    """Resolve a relative specifier the way a bundler would."""
    base = (importer.parent / module).resolve()
    candidates = [
        base,
        base.with_suffix(".ts"),
        base.with_suffix(".tsx"),
        base.with_suffix(".d.ts"),
        base / "index.ts",
        base / "index.tsx",
    ]
    # ".../foo.js" in TS ESM style should map to foo.ts
    if base.suffix == ".js":
        candidates.append(base.with_suffix(".ts"))
        candidates.append(base.with_suffix(".tsx"))
    for c in candidates:
        if c.is_file():
            return c
    # Asset imports (mp3/png) are handled by Metro, declared in assets.d.ts
    if base.suffix in (".mp3", ".png", ".jpg", ".css", ".webmanifest"):
        return base if base.is_file() else None
    return None


EXPORT_PATTERNS = [
    # export const/let/var/function/class/interface/type/enum NAME
    re.compile(
        r"^\s*export\s+(?:declare\s+)?(?:abstract\s+)?"
        r"(?:const|let|var|function\*?|async\s+function\*?|class|interface|type|enum)\s+"
        r"([A-Za-z_$][\w$]*)",
        re.M,
    ),
    # export { a, b as c }
]
EXPORT_BRACE_RE = re.compile(r"^\s*export\s*\{([^}]*)\}", re.M)
EXPORT_STAR_FROM_RE = re.compile(r"^\s*export\s*\*\s*from\s*[\"']([^\"']+)[\"']", re.M)
DEFAULT_EXPORT_RE = re.compile(r"^\s*export\s+default\b", re.M)


def exported_names(path: Path, _seen: set[Path] | None = None) -> set[str]:
    """Names a module exports, following `export * from` one level."""
    if _seen is None:
        _seen = set()
    if path in _seen:
        return set()
    _seen.add(path)

    text = TEXT.get(path)
    if text is None:
        try:
            text = path.read_text(encoding="utf-8")
        except OSError:
            return set()

    names: set[str] = set()
    for pat in EXPORT_PATTERNS:
        names.update(pat.findall(text))

    for group in EXPORT_BRACE_RE.findall(text):
        for piece in group.split(","):
            piece = piece.strip()
            if not piece:
                continue
            piece = re.sub(r"^type\s+", "", piece)
            if " as " in piece:
                piece = piece.split(" as ")[-1]
            names.add(piece.strip())

    if DEFAULT_EXPORT_RE.search(text):
        names.add("default")

    for mod in EXPORT_STAR_FROM_RE.findall(text):
        if mod.startswith("."):
            target = resolve(mod, path)
            if target:
                names.update(exported_names(target, _seen))

    return names


def parse_clause(clause: str) -> tuple[list[str], bool]:
    """Return (named imports, has_default_or_namespace) from an import clause."""
    clause = clause.strip()
    clause = re.sub(r"^type\s+", "", clause)
    named: list[str] = []
    other = False

    brace = re.search(r"\{([^}]*)\}", clause)
    if brace:
        for piece in brace.group(1).split(","):
            piece = piece.strip()
            if not piece:
                continue
            piece = re.sub(r"^type\s+", "", piece).strip()
            original = piece.split(" as ")[0].strip()
            named.append(original)
        before = clause[: brace.start()].strip().rstrip(",").strip()
    else:
        before = clause

    if before:
        other = True  # default import or `* as ns`
    return named, other


for path in FILES:
    text = TEXT[path]
    specs: list[tuple[str, str]] = [
        (m.group("clause"), m.group("mod")) for m in IMPORT_RE.finditer(text)
    ]
    specs += [("", m.group("mod")) for m in BARE_IMPORT_RE.finditer(text)]

    for clause, mod in specs:
        if not mod.startswith("."):
            continue  # bare package specifier — can't check without node_modules
        checked_imports += 1
        target = resolve(mod, path)
        if target is None:
            err(f"{rel(path)}: unresolved import \"{mod}\"")
            continue
        if target.suffix in (".mp3", ".png", ".jpg", ".css", ".webmanifest"):
            continue

        named, _ = parse_clause(clause)
        if not named:
            continue
        available = exported_names(target)
        if not available:
            continue  # couldn't parse exports; don't cry wolf
        for name in named:
            checked_names += 1
            if name not in available:
                err(
                    f'{rel(path)}: imports "{name}" from "{mod}" '
                    f"but {rel(target)} does not export it"
                )


# --------------------------------------------- 3: shared/types.ts copies

canonical = ROOT / "shared" / "types.ts"
copies = [
    ROOT / "server" / "src" / "shared" / "types.ts",
    ROOT / "web" / "src" / "shared" / "types.ts",
    ROOT / "mobile" / "src" / "shared" / "types.ts",
]

if canonical.is_file():
    canon_text = canonical.read_text(encoding="utf-8")
    canon_names = exported_names(canonical)
    for c in copies:
        if not c.is_file():
            err(f"missing shared types copy: {rel(c)}")
            continue
        # Exact text, not just a name subset: a payload field that drifts in one
        # copy is exactly the bug this file exists to prevent, and renamed
        # fields would slip past an export-name comparison.
        if c.read_text(encoding="utf-8") != canon_text:
            copy_names = exported_names(c)
            missing = canon_names - copy_names
            extra = copy_names - canon_names
            detail = []
            if missing:
                detail.append(f"missing: {', '.join(sorted(missing))}")
            if extra:
                detail.append(f"unexpected: {', '.join(sorted(extra))}")
            err(
                f"{rel(c)} differs from shared/types.ts"
                + (f" ({'; '.join(detail)})" if detail else " (payload/body drift)")
            )
else:
    err("shared/types.ts not found")


# ------------------------------------------- 3b: unused imports (noUnusedLocals)

# web/tsconfig.json sets noUnusedLocals + noUnusedParameters, so an unused
# import there is a build failure, not a style nit.
STRICT_UNUSED = ("web",)

for path in FILES:
    text = TEXT[path]
    # Strip imports before searching for usage so an import never counts as its
    # own reference. Comments are stripped too: a name mentioned only in a
    # doc comment is still unused as far as tsc is concerned.
    body = IMPORT_RE.sub("\n", text)
    body = re.sub(r"/\*.*?\*/", "", body, flags=re.S)
    body = re.sub(r"//[^\n]*", "", body)

    for m in IMPORT_RE.finditer(text):
        mod = m.group("mod")
        named, _ = parse_clause(m.group("clause"))
        # Use the local binding (after `as`) when there is one.
        locals_: list[str] = []
        brace = re.search(r"\{([^}]*)\}", m.group("clause"))
        if brace:
            for piece in brace.group(1).split(","):
                piece = re.sub(r"^\s*type\s+", "", piece.strip()).strip()
                if not piece:
                    continue
                locals_.append(piece.split(" as ")[-1].strip())
        for name in locals_:
            if re.search(rf"\b{re.escape(name)}\b", body):
                continue
            msg = f'{rel(path)}: imports "{name}" from "{mod}" but never uses it'
            if path.parts[0 : 0] or any(part in STRICT_UNUSED for part in path.parts):
                err(msg + " (web builds with noUnusedLocals)")
            else:
                warn(msg)


# ---------------------------------------------- 4: Socket.IO event names

types_src = TEXT.get(copies[0]) or (
    canonical.read_text(encoding="utf-8") if canonical.is_file() else ""
)


def interface_body(src: str, name: str) -> str:
    m = re.search(rf"export interface {name}\s*\{{", src)
    if not m:
        return ""
    i = m.end() - 1
    depth = 0
    for j in range(i, len(src)):
        if src[j] == "{":
            depth += 1
        elif src[j] == "}":
            depth -= 1
            if depth == 0:
                return src[i + 1 : j]
    return ""


EVENT_KEY_RE = re.compile(r"""["']([a-z]+:[a-z-]+)["']\s*:""")

s2c = set(EVENT_KEY_RE.findall(interface_body(types_src, "ServerToClientEvents")))
c2s = set(EVENT_KEY_RE.findall(interface_body(types_src, "ClientToServerEvents")))

if not s2c or not c2s:
    err("could not parse ServerToClientEvents / ClientToServerEvents from shared types")

known = s2c | c2s
# Socket.IO's own lifecycle events are not part of our contract.
BUILTIN = {
    "connect",
    "connect_error",
    "disconnect",
    "disconnecting",
    "error",
    "reconnect",
}

EVENT_USE_RE = re.compile(
    r"""\.(?:emit|on|off|once)\(\s*["']([a-zA-Z]+:[a-zA-Z-]+)["']"""
)
EVENT_TO_USE_RE = re.compile(
    r"""\.to\([^)]*\)\s*\.emit\(\s*["']([a-zA-Z]+:[a-zA-Z-]+)["']"""
)

used: dict[str, set[str]] = {}
for path in FILES:
    if "shared" in path.parts:
        continue
    text = TEXT[path]
    found = set(EVENT_USE_RE.findall(text)) | set(EVENT_TO_USE_RE.findall(text))
    for ev in found:
        used.setdefault(ev, set()).add(rel(path))

for ev, where in sorted(used.items()):
    if ev in BUILTIN or ev in known:
        continue
    err(
        f'event "{ev}" is used in {", ".join(sorted(where))} '
        f"but is not declared in the shared event interfaces"
    )

# Events declared but never emitted anywhere on the sending side.
server_files = [p for p in FILES if p.parts[-3:-1] == ("server", "src") or "server" in p.parts]
server_text = "\n".join(TEXT[p] for p in server_files)
client_text = "\n".join(
    TEXT[p] for p in FILES if "web" in p.parts or "mobile" in p.parts
)

for ev in sorted(s2c):
    if f'"{ev}"' not in server_text and f"'{ev}'" not in server_text:
        warn(f'server never emits declared event "{ev}"')
    if f'"{ev}"' not in client_text and f"'{ev}'" not in client_text:
        warn(f'no client listens for declared event "{ev}"')

for ev in sorted(c2s):
    if f'"{ev}"' not in server_text and f"'{ev}'" not in server_text:
        warn(f'server has no handler for declared event "{ev}"')

# Contract coverage
contract = ROOT / "CONTRACT.md"
contract_text = contract.read_text(encoding="utf-8") if contract.is_file() else ""
if contract_text:
    for ev in sorted(known):
        if ev not in contract_text:
            warn(f'event "{ev}" is not documented in CONTRACT.md')


# ------------------------------------------------------- 5: REST paths

routes_file = ROOT / "server" / "src" / "routes.ts"
server_paths: set[str] = set()
if routes_file.is_file():
    rtext = TEXT.get(routes_file, routes_file.read_text(encoding="utf-8"))
    for m in re.finditer(
        r"""api\.(get|post|put|patch|delete)\(\s*["']([^"']+)["']""", rtext
    ):
        server_paths.add(m.group(2))
else:
    err("server/src/routes.ts not found")


def normalize(path: str) -> str:
    """Turn "/users/abc" into "/users/:id" so params compare equal."""
    return re.sub(r"\$\{[^}]*\}", ":param", path)


client_api_files = [
    ROOT / "web" / "src" / "lib" / "api.ts",
    ROOT / "mobile" / "src" / "lib" / "api.ts",
    ROOT / "web" / "src" / "lib" / "push.ts",
    ROOT / "mobile" / "src" / "lib" / "push.ts",
]

REQUEST_RE = re.compile(r"""request<[^>]*>\(\s*[`"']([^`"']+)[`"']""")

server_norm = {normalize(p) for p in server_paths}
for f in client_api_files:
    if not f.is_file():
        continue
    text = TEXT.get(f, f.read_text(encoding="utf-8"))
    for p in REQUEST_RE.findall(text):
        n = normalize(p)
        if n in server_norm:
            continue
        # allow /users/:id style
        if any(
            len(n.split("/")) == len(sp.split("/"))
            and all(
                a == b or b.startswith(":")
                for a, b in zip(n.split("/"), sp.split("/"))
            )
            for sp in server_norm
        ):
            continue
        err(f'{rel(f)}: calls REST path "{p}" which the server does not define')

if contract_text:
    for p in sorted(server_paths):
        if p not in contract_text:
            warn(f'REST path "{p}" is not documented in CONTRACT.md')


# ------------------------------------------------------- reporting

def check_balance(path: Path, src: str) -> str | None:
    """
    Verify (), [] and {} balance, ignoring comments, strings, template
    literals and regex literals.

    `node --check` silently ignores .ts files (a deliberately corrupted file
    still exits 0), and tsc isn't installed, so this is the only guard against
    an edit that leaves a file structurally broken.
    """
    stack: list[tuple[str, int]] = []
    pairs = {")": "(", "]": "[", "}": "{"}
    line = 1
    i = 0
    n = len(src)
    # Tokens after which a `/` starts a regex rather than a division.
    prefix_ok = set("(,=:[!&|?{};+-*%~^<>") | {"\n"}
    prev_sig = "\n"

    while i < n:
        c = src[i]
        if c == "\n":
            line += 1
            i += 1
            continue
        # comments
        if c == "/" and i + 1 < n and src[i + 1] == "/":
            j = src.find("\n", i)
            i = n if j == -1 else j
            continue
        if c == "/" and i + 1 < n and src[i + 1] == "*":
            j = src.find("*/", i + 2)
            if j == -1:
                return f"unterminated block comment opened at line {line}"
            line += src.count("\n", i, j)
            i = j + 2
            continue
        # regex literal
        if c == "/" and prev_sig in prefix_ok:
            j = i + 1
            in_class = False
            while j < n:
                if src[j] == "\\":
                    j += 2
                    continue
                if src[j] == "\n":
                    break  # not a regex after all
                if src[j] == "[":
                    in_class = True
                elif src[j] == "]":
                    in_class = False
                elif src[j] == "/" and not in_class:
                    break
                j += 1
            if j < n and src[j] == "/":
                i = j + 1
                prev_sig = "x"
                continue
        # strings
        if c in "\"'":
            quote = c
            j = i + 1
            while j < n:
                if src[j] == "\\":
                    j += 2
                    continue
                if src[j] == quote:
                    break
                if src[j] == "\n":
                    return f"unterminated string at line {line}"
                j += 1
            i = j + 1
            prev_sig = "x"
            continue
        # template literal (may nest ${ ... } containing anything)
        if c == "`":
            j = i + 1
            depth = 0
            while j < n:
                if src[j] == "\\":
                    j += 2
                    continue
                if src[j] == "\n":
                    line += 1
                elif src[j] == "$" and j + 1 < n and src[j + 1] == "{":
                    depth += 1
                    j += 2
                    continue
                elif src[j] == "}" and depth:
                    depth -= 1
                elif src[j] == "`" and not depth:
                    break
                j += 1
            if j >= n:
                return f"unterminated template literal at line {line}"
            i = j + 1
            prev_sig = "x"
            continue

        if c in "([{":
            stack.append((c, line))
        elif c in ")]}":
            if not stack:
                return f"unexpected '{c}' at line {line}"
            open_c, open_line = stack.pop()
            if open_c != pairs[c]:
                return (
                    f"'{c}' at line {line} closes '{open_c}' "
                    f"opened at line {open_line}"
                )
        if not c.isspace():
            prev_sig = c
        i += 1

    if stack:
        open_c, open_line = stack[-1]
        return f"unclosed '{open_c}' opened at line {open_line}"
    return None


for path in FILES:
    # .tsx is skipped: JSX text is not JavaScript, so an apostrophe in prose
    # ("we'll generate one") reads as an unterminated string to any tokenizer
    # that isn't JSX-aware. A checker that cries wolf gets ignored, so we only
    # balance real .ts files and accept the reduced coverage on components.
    if path.suffix == ".tsx":
        continue
    problem = check_balance(path, TEXT[path])
    if problem:
        err(f"{rel(path)}: {problem}")


# ------------------------------------------------------------- reporting


print(f"scanned {len(FILES)} source files")
print(f"checked {checked_imports} relative imports, {checked_names} named imports")
print(f"contract events: {len(s2c)} server→client, {len(c2s)} client→server")
print(f"REST routes: {len(server_paths)}")
print()

if warnings:
    print(f"WARNINGS ({len(warnings)}):")
    for w in warnings:
        print(f"  ! {w}")
    print()

if errors:
    print(f"ERRORS ({len(errors)}):")
    for e in errors:
        print(f"  x {e}")
    sys.exit(1)

print("No errors found.")
