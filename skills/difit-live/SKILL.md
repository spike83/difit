---
name: difit-live
description: Run a live review in difit, the local diff viewer, where the user comments in the browser and the agent answers while the server keeps running. Use when the user names difit or asks to show or review changes in difit ("show me in difit", "open this in difit", "watch my difit comments"), for a diff, branch, PR, commit or a newly written file. Requires the spike83/difit fork and the bundled difit-review.py helper.
---

# difit live review

difit shows the diff in the browser. The user comments on lines, ranges or whole files. A watcher process turns new comments into events, and the agent answers each one in the same thread: a reply, a question back, or a fix followed by resolving the thread with a note. The server keeps running through the whole review, and the comments survive restarts.

This skill needs the fork (`--title`, comment history, agent status) and `scripts/difit-review.py` on `PATH`. Check with `difit --help | grep -- --title` and `command -v difit-review.py`. If either is missing, tell the user and point them to the fork's README instead of falling back to the npm build.

## 1. Start difit

Every launch passes `--title "<project>: <task>"`, for example `--title "billing-api: token refresh review"`. The title names the browser tab and keeps several reviews apart.

```bash
GIT_OPTIONAL_LOCKS=0 difit . --include-untracked --background --keep-alive --no-open --title "<project>: <task>"
```

- `--background` prints `{"port":4966,"url":"http://localhost:4966","pid":123}`. Give the user the URL right away and keep the port and pid.
- `--keep-alive` keeps the server up when the browser tab closes. Without it the review ends when the user reloads at the wrong moment.
- `GIT_OPTIONAL_LOCKS=0` is required: without it the `git status` behind each diff fetch creates `.git/index.lock` for a moment, difit sees that as a change, and the page reloads in a loop.
- Leave out `--include-untracked` when the repo has untracked files that aren't part of the review (local `.env` files, notes). The flag marks every untracked file intent-to-add. Use `git add -N <file>` for the files that belong in the review instead. Without the flag and without `< /dev/null`, `difit .` asks whether to include untracked files and waits for an answer, so pipe one in: `echo n | difit . ...`.

Pick the diff that matches the task:

| Task                                                     | Command                                                                            |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Uncommitted changes                                      | `difit .`                                                                          |
| A branch against main, with your edits during the review | `difit . origin/main --merge-base` in a worktree of the branch                     |
| A commit, static                                         | `difit <sha>`                                                                      |
| Two branches, static                                     | `difit feature main`                                                               |
| A GitHub PR, static                                      | `difit --pr <url>`                                                                 |
| A new file in a repo with no commits                     | `git init && git commit --allow-empty -m init`, then `difit . --include-untracked` |

Before starting, check whether a server for the same repo and diff already runs (`ps -eo pid,args | grep "[d]ifit "`). Reuse it instead of opening a second tab.

## 2. Start the watcher in the same turn

Start it right after difit, even for a quick "show me this file". Two background commands:

```bash
rm -f /tmp/difit-events-<port>.log /tmp/difit-cursor-<port>; difit-review.py watch <port>   # long-running
difit-review.py wait <port>                                                               # exits on the next event
```

`watch` polls the server every minute, and every 10 s for ten minutes after a new message. It appends one line per event to `/tmp/difit-events-<port>.log`:

```
NEW <thread-id> <file>:<line> | <first 200 chars of the message>
REOPENED <thread-id> <file>:<line> | <newest message>
SERVER_GONE
```

A comment on a whole file shows only `<file>` and sits on `line: 0` in the API.

`wait` blocks until events arrive, prints them and exits, which wakes you up. Handle the events, then start `wait` again. It keeps a cursor, so nothing written in between is lost. Don't poll with a recurring timer instead: it wakes the agent for nothing.

The watcher skips messages written by the agent that runs it. It finds `claude` or `codex` among its parent processes; set `DIFIT_AUTHOR` to override. A second agent that posts under a different name (`Codex`, `Claude-review`) counts as review input. Only one watcher runs per port.

If your agent runs commands in a sandbox that blocks loopback, run `difit`, `curl` to the server and every helper command that talks to it outside the sandbox. `wait` only reads files and works inside it.

## 3. Answer each event

The event line usually holds enough. For the whole thread: `curl -s localhost:<port>/api/comments-json`.

| Situation                   | Command                                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------- |
| It takes more than a minute | `difit-review.py working <port> <id>` first, so the user sees you on it                 |
| A question                  | `difit-review.py reply <port> <id> "<answer>"`                                          |
| The user has to decide      | `difit-review.py reply <port> <id> --todo "<question>"` puts it on the user's todo list |
| A change request            | make the edit, then `difit-review.py resolve <port> <id> "<what changed>"`              |
| Nothing to add              | `difit-review.py done <port> <id>`                                                      |

Resolving keeps the thread as history: greyed out, collapsed, with a Reopen button. Use it instead of a "Done" reply. A thread the user flagged as todo refuses the resolve unless you pass `--force`; leave those to the user. A reply to a resolved thread reopens it, from either side.

The user sees your progress as a chip on each message: seen, working, handled. A working chip turns orange after 30 minutes without a reply, so keep it accurate.

Sign comments you post with your own name, `author: "Claude"` or `author: "Codex"`. To post a new thread, build the JSON with `jq` so quotes and line breaks in the body survive:

```bash
difit comment add --port <port> "$(jq -n --arg f "$file" --argjson l "$line" --arg b "$body" \
  '{type:"thread",filePath:$f,position:{side:"new",line:$l},body:$b,author:"Claude"}')"
```

Then check `/api/comments-json` for the thread before you report it as posted. Never copy secrets from the diff into a comment.

## 4. Editing files during the review

Comments stick to line numbers. An edit that adds or removes lines moves the code under later comments. Don't count lines by hand:

```bash
difit-review.py snapshot <port> <file>   # before the edit
# ... edit ...
difit-review.py remap <port> <file>      # after: moves the anchors in place, IDs and state stay
```

Tell the user to click Refresh after you create or change files. A file the user marked as viewed comes back unviewed with a short note from `difit` on what changed. The watcher ignores those notes.

Don't run `difit-review.py sync` after your own changes: it marks every current message as seen, including one the user posted a second ago. Use it only when the user wants existing comments ignored.

## 5. Restarting and ending

Comments live in `<git dir>/difit/comments/` and are keyed by the selection as typed. A restart with the same arguments (`difit . origin/main --merge-base`, not the resolved hash) gets them back. For a different selection, carry them over:

```bash
difit-review.py export <port> /tmp/difit-export-<port>.json
kill <pid>
GIT_OPTIONAL_LOCKS=0 difit <new selection> --background --keep-alive --no-open --port <port> --title "<project>: <task>"
difit-review.py import <port> /tmp/difit-export-<port>.json
```

When difit is back on the same port within 30 s, the running watcher keeps working. Kill processes by PID, not with `pkill -f`, which can match your own shell.

`SERVER_GONE` means the user closed the review, unless you restarted difit yourself. Then don't start `wait` again: summarize what was handled and remove `/tmp/difit-events-<port>.log`, `/tmp/difit-cursor-<port>`, `/tmp/difit-watch-<port>.lock` and `/tmp/difit-snap-<port>/`. When the user ends the review in chat, kill `wait`, `watch` and difit by PID and remove the same files.

## Gotchas

- Two servers on the same worktree and the same selection share one comment file, and the last write wins. Give each review its own selection or worktree.
- After a branch switch a long-running `difit .` can keep serving the old diff. Compare `/api/diff` with `git diff --stat` and restart if they differ.
- With `--include-untracked`, the intent-to-add marks stay after the review, and `git commit -a` would commit those files. Run `git status --short` before committing and `git reset -q -- <file>` for anything that doesn't belong.
- To point at a section of a markdown file in a comment, link its heading (`[setup](#setup)`). A click scrolls to it in the preview.
