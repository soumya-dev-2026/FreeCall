#!/usr/bin/env python3
"""
Proves the harness has teeth: injects a known regression into a throwaway copy
of server/src, runs the suite against it, and requires the report to turn red.

The real source tree is only ever read, never modified.

Usage, from the repo root:
    python3 tools/harness/faults.py
"""
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parents[1]
REAL = REPO / "server" / "src"

# Each fault is (label, [(file, find, replace), ...]). An empty edit list is the
# control run, which must stay green.
FAULTS = [
    ("control (unmodified server)", []),

    ("every peer thinks it is the offerer", [
        ("socket.ts", "  return selfId < otherId;", "  return true;"),
    ]),

    ("answering forgets to silence the other devices", [
        ("socket.ts",
         '      stopRingingElsewhere(call.id, "Answered on another device");\n', ""),
    ]),

    ("signaling is relayed without checking membership", [
        ("socket.ts",
         "      return call.invitedIds.has(userId) && call.invitedIds.has(toUserId);",
         "      return true;"),
    ]),

    ("the ring timeout is not re-armed after an answer", [
        ("socket.ts",
         "      armRingTimeout(call);\n\n      const meUser = publicUser(userId)!;",
         "\n      const meUser = publicUser(userId)!;"),
    ]),

    # handleLeave and finishCall each guard on call.ended, so removing one alone
    # is masked by the other. Only dropping both is a behavioural regression.
    ("both of the hang-up re-entry guards are dropped", [
        ("socket.ts",
         "const handleLeave = (callId: string) => {\n      const call = getCall(callId);\n"
         "      if (!call || call.ended) return;",
         "const handleLeave = (callId: string) => {\n      const call = getCall(callId);\n"
         "      if (!call) return;"),
        ("socket.ts", "      if (call.ended) return;\n      const invited", "      const invited"),
    ]),

    ("hanging up leaves the call record live", [
        ("socket.ts", "      endCall(call.id);\n      recordHistory(call, status);",
         "      recordHistory(call, status);"),
    ]),
]


def run_one(label, edits):
    sandbox = pathlib.Path(tempfile.mkdtemp(prefix="freecall-fault-"))
    src = sandbox / "src"
    shutil.copytree(REAL, src)
    try:
        return _run(label, edits, src)
    finally:
        shutil.rmtree(sandbox, ignore_errors=True)


def _run(label, edits, tmp):
    for filename, find, replace in edits:
        target = tmp / filename
        text = target.read_text()
        hits = text.count(find)
        if hits == 0:
            return label, "SKIPPED", f"injection point not found in {filename}"
        if hits > 1:
            return label, "AMBIGUOUS", f"injection point matches {hits}x in {filename}"
        target.write_text(text.replace(find, replace, 1))

    proc = subprocess.run(
        ["node", "--experimental-strip-types", "--import", "./hooks.mjs", "run.mjs"],
        cwd=HERE,
        env={**os.environ, "SRC": str(tmp)},
        capture_output=True,
        text=True,
    )
    out = proc.stdout + proc.stderr
    reds = [line.strip()[2:] for line in out.splitlines() if line.strip().startswith("x ")]
    green = "ALL GREEN" in out

    if "TypeError" in out or "ReferenceError" in out or proc.returncode not in (0, 1):
        return label, "CRASHED", "the runner threw instead of finishing its report"

    if not edits:
        total = re.search(r"ALL GREEN — (\d+)", out)
        if green:
            return label, "OK", f"{total.group(1)} assertions passed"
        return label, "BROKEN", f"the control must be green, but {len(reds)} failed"

    if green:
        return label, "UNDETECTED", "the suite stayed green — it does not cover this"

    shown = "; ".join(reds[:2]) + ("; …" if len(reds) > 2 else "")
    return label, "CAUGHT", f"{len(reds)} red: {shown}"


results = [run_one(*fault) for fault in FAULTS]
width = max(len(r[0]) for r in results)

print()
for label, verdict, detail in results:
    print(f"{verdict:<11} {label:<{width}}  {detail}")

problems = [r for r in results if r[1] not in ("OK", "CAUGHT")]
print()
print(
    "The control is green and every injected regression turns the report red."
    if not problems
    else f"{len(problems)} problem(s) with the suite itself — see above."
)

sys.exit(1 if problems else 0)
