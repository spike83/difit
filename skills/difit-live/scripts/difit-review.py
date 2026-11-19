#!/usr/bin/env python3
"""
Helper for interactive difit review sessions.

  difit-review.py watch    <port>                 poll loop, appends compact events to /tmp/difit-events-<port>.log
  difit-review.py wait     <port>                 block until events arrive, print them and exit (resumes like follow)
  difit-review.py follow   <port>                 print events from the log, resuming where the last follow stopped
  difit-review.py new      <port>                 print every message this agent has not handled yet, mark them seen
  difit-review.py sync     <port>                 mark all current messages as seen (skip existing comments)
  difit-review.py working  <port> <id>...         tell the user you are working on these threads
  difit-review.py reply    <port> <id> [--todo] <text>   reply (marks the thread handled; --todo flags it for the user)
  difit-review.py done     <port> <id>...         mark threads handled without replying
  difit-review.py resolve  <port> <id> <note> [--force]  resolve with a note on what was done (kept as history)
  difit-review.py snapshot <port> <file>...        save a copy of working-tree files before editing them
  difit-review.py remap    <port> <file>...        move comment anchors after editing files (uncommitted edits)
  difit-review.py export   <port> <out.json>       save all threads with their state
  difit-review.py import   <port> <in.json>        merge saved threads back in

File arguments may be absolute or relative to the current directory; they are matched to
difit's paths relative to the file's git root.
Progress lives on the server, per message and agent (seen, working, handled), and difit keeps
it in <git dir>/difit/comments, so it survives restarts. A message needs this agent's attention
until the agent handled it: by a reply, done or resolve. A fresh watcher reports every such
message once; after that only new ones, and threads the user reopened.
The agent is Claude or Codex, whichever runs this helper (DIFIT_AUTHOR overrides); messages
by the other agent count as review input.
The watcher polls every minute, and every 10 s for ten minutes after a new message.
Events are one line each:
  NEW <thread-id> <file>:<line> | <first 200 chars>        (just <file> for a whole-file comment)
  REOPENED <thread-id> <file>:<line> | <newest message>
  SERVER_GONE
"""
import difflib
import fcntl
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

POLL_IDLE = 60
POLL_ACTIVE = 10
ACTIVE_FOR = 600
FAILURES_BEFORE_GONE = 3


def agent_name():
    if os.environ.get("DIFIT_AUTHOR"):
        return os.environ["DIFIT_AUTHOR"]
    pid = os.getppid()
    while pid > 1:
        try:
            stat = open(f"/proc/{pid}/stat").read()
        except OSError:
            break
        comm = stat[stat.index("(") + 1:stat.rindex(")")]
        if comm in ("claude", "codex"):
            return comm.capitalize()
        pid = int(stat[stat.rindex(")") + 2:].split()[1])
    return "Claude"


AUTHOR = agent_name()


def base(port):
    return f"http://localhost:{port}"


def events_path(port):
    return f"/tmp/difit-events-{port}.log"


def cursor_path(port):
    return f"/tmp/difit-cursor-{port}"


def lock_path(port):
    return f"/tmp/difit-watch-{port}.lock"


def snap_dir(port):
    return f"/tmp/difit-snap-{port}"


def request(port, path, method="GET", body=None):
    """(status, decoded JSON) for an API call; HTTP errors come back as their status."""
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(base(port) + path, data=data, method=method,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.load(e)
        except ValueError:
            return e.code, {}


def get(port):
    return request(port, "/api/comments-json")[1]


def thread_path(tid, suffix=""):
    return "/api/comments/" + urllib.parse.quote(tid, safe="") + suffix


def set_status(port, tid, state, message_ids=None):
    body = {"agent": AUTHOR, "state": state}
    if message_ids is not None:
        body["messageIds"] = message_ids
    return request(port, thread_path(tid, "/status"), "POST", body)


def author(m):
    return (m.get("author") or "").strip() or "User"


def state_of(m):
    return ((m.get("status") or {}).get(AUTHOR) or {}).get("state")


def location(t):
    """file:line, or just the file for a comment on the whole file (line 0)."""
    ln = t["position"]["line"]
    if ln == 0:
        return t["filePath"]
    return f"{t['filePath']}:" + (str(ln) if isinstance(ln, int) else f"{ln['start']}-{ln['end']}")


def pending(data, states):
    """(thread, its messages by others whose state for this agent is in states), active threads only."""
    for t in data["threads"]:
        if t.get("resolved"):
            continue
        # difit's own notes (a viewed file changed) are for the user.
        msgs = [m for m in t["messages"]
                if author(m) not in (AUTHOR, "difit") and state_of(m) in states]
        if msgs:
            yield t, msgs


def event_lines(t, msgs):
    def line(kind, m):
        return f"{kind} {t['id']} {location(t)} | {' '.join(m['body'].split())[:200]}"
    if any(state_of(m) == "open" for m in msgs):
        return [line("REOPENED", msgs[-1])]
    return [line("NEW", m) for m in msgs]


def report(port, states):
    """Event lines for pending messages; marks them seen."""
    out = []
    for t, msgs in pending(get(port), states):
        out += event_lines(t, msgs)
        set_status(port, t["id"], "seen", [m["id"] for m in msgs])
    return out


def append_event(port, text):
    with open(events_path(port), "a") as f:
        f.write(text + "\n")


def cmd_watch(port):
    lock = open(lock_path(port), "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        sys.exit(f"another watcher already runs on port {port}")
    failures = 0
    active_until = 0
    # The first pass also re-reports what an earlier session saw but never handled.
    states = (None, "open", "seen", "working")
    while True:
        try:
            lines = report(port, states)
        except (OSError, ValueError):
            failures += 1
            if failures >= FAILURES_BEFORE_GONE:
                append_event(port, "SERVER_GONE")
                return
            time.sleep(POLL_ACTIVE)
            continue
        failures = 0
        states = (None, "open")
        if lines:
            append_event(port, "\n".join(lines))
            active_until = time.time() + ACTIVE_FOR  # the user is reviewing: poll faster
        time.sleep(POLL_ACTIVE if time.time() < active_until else POLL_IDLE)


def cmd_follow(port, once=False):
    """Print event lines from the cursor on, so a re-armed Monitor misses nothing.

    With once, exit after the lines that are there once the first one arrived.
    """
    path = events_path(port)
    open(path, "a").close()
    try:
        pos = int(open(cursor_path(port)).read().strip() or 0)
    except (OSError, ValueError):
        pos = 0
    start = pos
    with open(path) as f:
        while True:
            if os.path.getsize(path) < pos:
                pos = start = 0  # log was truncated
            f.seek(pos)
            line = f.readline()
            if not line.endswith("\n"):
                if once and pos > start:
                    return
                time.sleep(1)
                continue
            print(line, end="", flush=True)
            pos = f.tell()
            with open(cursor_path(port), "w") as c:
                c.write(str(pos))


def cmd_new(port):
    lines = report(port, (None, "open", "seen", "working"))
    print("\n".join(lines) if lines else "(no messages waiting for you)")


def cmd_sync(port):
    for t, msgs in pending(get(port), (None, "open")):
        set_status(port, t["id"], "seen", [m["id"] for m in msgs])


def print_result(tid, result):
    status, data = result
    print(tid, status, "" if status < 300 else data.get("error", ""))


def cmd_status(port, state, ids):
    for tid in ids:
        print_result(tid, set_status(port, tid, state))


def cmd_reply(port, args):
    todo = "--todo" in args
    args = [a for a in args if a != "--todo"]
    if len(args) < 2:
        sys.exit("usage: reply <port> <thread-id> [--todo] <text>")
    tid, text = args[0], " ".join(args[1:])
    print_result(tid, request(port, thread_path(tid, "/replies"), "POST",
                              {"body": text, "author": AUTHOR, "todo": todo}))


def cmd_resolve(port, args):
    force = "--force" in args
    args = [a for a in args if a != "--force"]
    if len(args) < 2:
        sys.exit("usage: resolve <port> <thread-id> <note> [--force]")
    tid, note = args[0], " ".join(args[1:])
    print_result(tid, request(port, thread_path(tid), "PATCH",
                              {"resolve": True, "by": AUTHOR, "note": note, "force": force}))


def repo_path(f):
    """Return (absolute path, path relative to the file's git root)."""
    absf = os.path.abspath(f)
    root = subprocess.run(["git", "-C", os.path.dirname(absf), "rev-parse", "--show-toplevel"],
                          capture_output=True, text=True, check=True).stdout.strip()
    return absf, os.path.relpath(absf, root)


def cmd_snapshot(port, files):
    for f in files:
        absf, rel = repo_path(f)
        dst = os.path.join(snap_dir(port), rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copyfile(absf, dst)
        print("saved", rel)


def line_map(old_lines, new_lines):
    ops = difflib.SequenceMatcher(a=old_lines, b=new_lines, autojunk=False).get_opcodes()
    n = max(1, len(new_lines))

    def m(line):
        i = line - 1
        for tag, i1, i2, j1, j2 in ops:
            if i1 <= i < i2:
                if tag == "equal":
                    return j1 + (i - i1) + 1
                return min(j1 + 1, n)  # changed or deleted: anchor at start of the replacement
        return n
    return m


def cmd_remap(port, files):
    data = get(port)
    for f in files:
        absf, rel = repo_path(f)
        snap = os.path.join(snap_dir(port), rel)
        old = open(snap).read().splitlines()
        new = open(absf).read().splitlines()
        m = line_map(old, new)
        moved, newpos = [], {}
        for t in data["threads"]:
            if t["filePath"] != rel or t["position"].get("side") != "new":
                continue
            ln = t["position"]["line"]
            if ln == 0:  # a file comment has no line to move
                continue
            nl = m(ln) if isinstance(ln, int) else {"start": m(ln["start"]), "end": max(m(ln["start"]), m(ln["end"]))}
            if nl != ln:
                moved.append(t)
                newpos[t["id"]] = {"side": "new", "line": nl}
        for t in moved:
            request(port, thread_path(t["id"]), "PATCH", {"position": newpos[t["id"]]})
        shutil.copyfile(absf, snap)  # next remap starts from this version
        print(f"{rel}: moved {len(moved)} thread(s)")


def cmd_export(port, path):
    json.dump(get(port), open(path, "w"))
    print("exported to", path)


def cmd_import(port, path):
    data = json.load(open(path))
    status, _ = request(port, "/api/comments", "POST", {"threads": data["threads"], "merge": True})
    print(f"imported {len(data['threads'])} thread(s)" if status < 300 else f"import failed: {status}")


def main(argv):
    if len(argv) < 3:
        sys.exit(__doc__)
    cmd, port, rest = argv[1], argv[2], argv[3:]
    {
        "watch": lambda: cmd_watch(port),
        "wait": lambda: cmd_follow(port, once=True),
        "follow": lambda: cmd_follow(port),
        "new": lambda: cmd_new(port),
        "sync": lambda: cmd_sync(port),
        "working": lambda: cmd_status(port, "working", rest),
        "done": lambda: cmd_status(port, "handled", rest),
        "reply": lambda: cmd_reply(port, rest),
        "resolve": lambda: cmd_resolve(port, rest),
        "snapshot": lambda: cmd_snapshot(port, rest),
        "remap": lambda: cmd_remap(port, rest),
        "export": lambda: cmd_export(port, rest[0]),
        "import": lambda: cmd_import(port, rest[0]),
    }.get(cmd, lambda: sys.exit(__doc__))()


if __name__ == "__main__":
    main(sys.argv)
