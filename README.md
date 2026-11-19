<h1 align="center">
  <img src="public/logo.png" alt="difit" width="260">
</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/difit"><img src="https://img.shields.io/npm/v/difit.svg" alt="npm version"></a>
  <a href="https://github.com/yoshiko-pg/difit/actions/workflows/pr.yml"><img src="https://github.com/yoshiko-pg/difit/actions/workflows/pr.yml/badge.svg" alt="CI"></a>
</p>

<p align="center">
  English | <a href="./README.ja.md">Japanese</a> | <a href="./README.zh.md">Chinese (Simplified)</a> | <a href="./README.ko.md">Korean</a>
</p>

![difit screenshot](docs/images/screenshot.png)

**difit** is a CLI tool that lets you view and review local git diffs with a GitHub-style viewer. In addition to clean visuals, comments can be copied as prompts for AI. The local code review tool for the AI era!

> **This is a fork** of [yoshiko-pg/difit](https://github.com/yoshiko-pg/difit). It adds a live review loop with an AI agent: comments are stored in the repository, threads keep their history, and the agent's progress shows on each message. See [Live review with an agent](#-live-review-with-an-agent-fork) for setup and workflow.

## ⚡ Quick Start

Try it first

```bash
npx difit  # View the latest commit diff in WebUI
```

Install and use

```bash
npm install -g difit
difit  # View the latest commit diff in WebUI
```

Enable use from AI agents

```bash
npx skills add yoshiko-pg/difit # Add the Skills to your agent
```

Installed skills include:

- `difit`: ask the user for a review in the difit viewer when the user explicitly opts in to difit
- `difit-review`: review a specific diff or PR and show the findings inside the difit viewer, when the user explicitly asks for difit

## 🚀 Usage

### Basic Usage

```bash
difit <target>                    # View single commit diff
difit <target> [compare-with]     # Compare two commits/branches
```

### Single commit review

```bash
difit          # HEAD (latest) commit
difit 6f4a9b7  # Specific commit
difit feature  # Latest commit on feature branch
```

### Compare two commits

```bash
difit @ main         # Compare with main branch (@ is alias for HEAD)
difit feature main   # Compare branches
difit . origin/main  # Compare working directory with remote main
```

### Special Arguments

difit supports special keywords for common diff scenarios:

```bash
difit .        # All uncommitted changes (staging area + unstaged)
difit staged   # Staging area changes
difit working  # Unstaged changes only
```

### GitHub PR

```bash
difit --pr https://github.com/owner/repo/pull/123
```

`--pr` mode fetches patches by running `gh pr diff --patch` under the hood.
It also imports unresolved inline review threads from the PR so they appear as startup comments in difit.

Authentication is handled by GitHub CLI:

1. **Login once** (recommended): `gh auth login`
2. **Token-based auth** (CI/non-interactive): set `GH_TOKEN` or `GITHUB_TOKEN`

#### GitHub Enterprise Server

For Enterprise Server PRs, authenticate GitHub CLI against your Enterprise host:

1. `gh auth login --hostname YOUR-ENTERPRISE-SERVER`
2. Or set `GH_HOST=YOUR-ENTERPRISE-SERVER` with `GH_TOKEN`/`GITHUB_TOKEN`

### Initial Comments

You can inject initial review comments when launching difit:

```bash
difit --comment '{"type":"thread","filePath":"src/example.ts","position":{"side":"new","line":10},"body":"The background for this change is..."}'
```

`--comment` is repeatable and accepts either a single JSON object or a JSON array. Supported types:

- `thread`: create a new thread at the specified diff position
- `reply`: add a reply to the latest existing thread at the same diff position

If the same comment already exists, difit skips importing it.

### Stdin

By using a pipe to pass unified diffs via stdin, you can view diffs from any tool with difit.

```bash
# View diffs from other tools
diff -u file1.txt file2.txt | difit

# Review saved patches
cat changes.patch | difit

# Compare against merge base
git diff --merge-base main feature | difit

# Review an entire existing file as newly added
git diff -- /dev/null path/to/file | difit

# Explicit stdin mode
git diff --cached | difit -
```

Stdin mode is selected with intent-first rules:

- `-` explicitly enables stdin mode
- If positional arguments (`<target>` / `[compare-with]`) or `--pr` are provided, difit treats the command as Git/PR mode and does not auto-read stdin
- Auto stdin detection applies only when no explicit mode is selected and stdin is a pipe/file/socket

## ⚙️ CLI Options

| Flag                  | Default         | Description                                                                                             |
| --------------------- | --------------- | ------------------------------------------------------------------------------------------------------- |
| `<target>`            | HEAD            | Commit hash, tag, HEAD~n, branch, or special arguments                                                  |
| `[compare-with]`      | -               | Optional second commit to compare with (shows diff between the two)                                     |
| `--merge-base`        | false           | Resolve the base revision with `git merge-base` before diffing (Git revision mode only)                 |
| `--pr <url>`          | -               | GitHub PR URL to review (e.g., https://github.com/owner/repo/pull/123)                                  |
| `--comment <json>`    | -               | Inject initial comments (repeatable; accepts a JSON object or array)                                    |
| `--port`              | 4966            | Preferred port; falls back to +1 if occupied                                                            |
| `--host`              | 127.0.0.1       | Host address to bind server to (use 0.0.0.0 for external access)                                        |
| `--no-open`           | false           | Don't automatically open browser                                                                        |
| `--clean`             | false           | Clear all existing comments and viewed files on startup                                                 |
| `--include-untracked` | false           | Automatically include untracked files in diff (only with `.` or `working`)                              |
| `--keep-alive`        | false           | Keep server running after browser disconnects (stop manually with Ctrl+C)                               |
| `--background`        | false           | Keep the server running in the background and output JSON connection info                               |
| `--context <lines>`   | git default (3) | Limit surrounding context lines per change (`0` shows changes only; not available with `--pr` or stdin) |
| `--title <title>`     | -               | Session title in the browser tab and the header, to tell several difit instances apart                  |

## 💬 Comment System

difit includes a review comment system that makes it easy to provide feedback to AI coding agents:

1. **Add Comments**: Click the comment button on any diff line or drag to select a range
2. **Edit Comments**: Edit existing comments with the edit button
3. **Generate Prompts**: Comments include a "Copy Prompt" button that formats the context for AI coding agents
4. **Copy All**: Use "Copy All Prompt" to copy all comments in a structured format
5. **Persistent Storage**: Comments are saved in `<git dir>/difit/comments/`, one file per selection as typed, so they survive a server restart

### Comment Prompt Format

```sh
src/components/Button.tsx:L42   # This line is automatically added
Make this variable name more descriptive
```

For range selections:

```sh
src/components/Button.tsx:L42-L48   # This line is automatically added
This section is unnecessary
```

## 🤖 Calling from Agents

You can install the following Skills to work with difit from AI agents.

```sh
npx skills add yoshiko-pg/difit
```

Installed skills include:

- `difit`: ask the user for a review in the difit viewer when the user explicitly opts in to difit
- `difit-review`: review a specific diff or PR and show the findings inside the difit viewer, when the user explicitly asks for difit

After code edits or automated review, the agent can start the difit server with the appropriate skill.

## 🔁 Live review with an agent (fork)

The upstream skills open difit once and read the comments when the server exits. The fork's `difit-live` skill keeps the review running: you comment in the browser while the agent works, and the agent answers in the same thread.

### Install difit from the fork

Requires Node.js 21 or newer and git.

```bash
git clone https://github.com/spike83/difit.git ~/git/difit
cd ~/git/difit
corepack enable          # provides the pinned pnpm
pnpm install
pnpm run build
mkdir -p ~/.local/bin
ln -sfn "$PWD/dist/cli/index.js" ~/.local/bin/difit
difit --help | grep -- --title   # the fork is on PATH
```

`~/.local/bin` must be on your `PATH`. To update, run `git pull && pnpm install && pnpm run build`. Running servers pick up client changes on the next page load; server changes need a restart.

### Install the skill

The skill lives in [`skills/difit-live`](skills/difit-live): `SKILL.md` tells the agent how to run the review, and `scripts/difit-review.py` (Python 3, no dependencies) talks to the difit API. Link both from the clone, so a `git pull` updates them:

```bash
# Claude Code
mkdir -p ~/.claude/skills
ln -sfn ~/git/difit/skills/difit-live ~/.claude/skills/difit-live
# Codex
mkdir -p ~/.codex/skills
ln -sfn ~/git/difit/skills/difit-live ~/.codex/skills/difit-live
# the helper
ln -sfn ~/git/difit/skills/difit-live/scripts/difit-review.py ~/.local/bin/difit-review.py
```

The watcher reads `/proc` to tell which agent runs it, so it works on Linux and WSL. Elsewhere, set `DIFIT_AUTHOR=Claude` (or `Codex`) in the agent's environment.

The skill is a template: adapt the title convention, the default flags and the rules to your own setup.

### How a review runs

1. **Ask for it.** "Show me the changes in difit" or "open the draft in difit". The agent starts difit in the background with a title such as `billing-api: token refresh review`, gives you the URL, and starts the comment watcher.
2. **Comment.** Click a line, drag over a range, or comment on a whole file from its header (`Shift+F`). Select text inside a line to quote it.
3. **The agent answers.** The watcher wakes the agent on each new comment. It marks the message as seen, then working, and replies, asks you to decide (the thread gets a todo flag), or makes the change and resolves the thread with a note on what it did. Each message shows the agent's state as a chip; a working chip without a reply for 30 minutes turns orange.
4. **Follow the changes.** Click Refresh when the agent edits files. Comments move with the code. A file you marked as viewed comes back unviewed, with a note from `difit` on what changed.
5. **Check the result.** Resolved threads stay as history: greyed out and collapsed, with Reopen. Replying to one reopens it, and the agent picks it up again.
6. **End it.** Close the tab or tell the agent you are done. The agent summarizes and stops the watcher.

The comments list (`Shift+L` or the 💬 button in the toolbar) shows every thread with the filters Open, Unread, Todos, Waiting on agent and Resolved.

| Key                     | Action                                              |
| ----------------------- | --------------------------------------------------- |
| `u` / `Shift+U`         | next / previous unread thread                       |
| `t`                     | toggle the todo flag of the thread under the cursor |
| `Shift+L`               | open the comments list                              |
| `d` / `r` (in the list) | resolve / reopen the selected thread                |

A message counts as read after it has been on screen for about 1.5 seconds.

### Under the hood

The helper uses the fork's comment API on the running server:

| Endpoint                         | Purpose                                                                           |
| -------------------------------- | --------------------------------------------------------------------------------- |
| `GET /api/comments-json`         | all threads with their messages and state                                         |
| `POST /api/comments/:id/replies` | reply (`{body, author, todo?}`); a reply to a resolved thread reopens it          |
| `POST /api/comments/:id/status`  | set an agent's state on messages (`{agent, state}`: `seen`, `working`, `handled`) |
| `PATCH /api/comments/:id`        | resolve with a note, reopen, set or clear todo, move the anchor                   |

Two agents can review together: each one signs its messages (`Claude`, `Codex`), and each watcher treats the other agent's messages as review input.

## 🎨 Syntax Highlighting Languages

- **JavaScript/TypeScript**: `.js`, `.jsx`, `.ts`, `.tsx`, `.svelte`
- **Web Technologies**: HTML, CSS, JSON, XML, Markdown
- **Shell Scripts**: `.sh`, `.bash`, `.zsh`, `.fish`
- **Backend Languages**: PHP, SQL, Ruby, Java, Groovy, Scala, Perl, Elixir, Haskell, Clojure
- **Systems Languages**: C, C++, C#, Rust, Go
- **Mobile Languages**: Swift, Kotlin, Dart
- **Infrastructure as Code**: Terraform (HCL), Nix
- **Others**: Python, Protobuf, YAML, Solidity, Vim script, GDScript

Markdown and AsciiDoc (`.adoc`, `.asciidoc`, `.asc`) files also have rendered views: Split, Diff and Full Preview. AsciiDoc support is fork-only; its images load from the repository.

## 🔍 Auto-collapsed Files

difit automatically identifies and collapses certain files to keep your view clean:

- **Deleted files**: Removed files are auto-collapsed since they don't require close review
- **Generated files**: Auto-generated code is collapsed by default. This includes:
  - Lock files (`package-lock.json`, `go.sum`, `Cargo.lock`, `Gemfile.lock`, etc.)
  - Minified files (`*.min.js`, `*.min.css`)
  - Source maps (`*.map`)
  - Generated code:
    - Orval (`*.msw.ts`, `*.zod.ts`, `*.api.ts`)
    - Dart (`*.g.dart`, `*.freezed.dart`)
    - C# (`*.g.cs`, `*.designer.cs`)
    - Protobuf (`*.pb.go`, `*.pb.cc`, `*.pb.h`)
  - Frameworks:
    - Ruby on Rails (`db/schema.rb`)
    - Laravel (`_ide_helper.php`)
    - Gradle (`gradle.lockfile`)
    - Python (`uv.lock`, `pdm.lock`)
  - Generic generated files (`*.generated.cs`, `*.generated.ts`, `*.generated.js`)
  - Content-based detection:
    - Files containing `@generated` marker
    - Files containing `DO NOT EDIT` header
    - Language-specific generated headers (Go, Python, etc.)

## 🛠️ Development

```bash
# Install dependencies
pnpm install

# Start development server (with hot reload)
# This runs both Vite dev server and CLI with NODE_ENV=development
pnpm run dev

# Build and start production server
pnpm run start <target>

# Build for production
pnpm run build

# Run tests
pnpm test

# Run typecheck, lint, and format
pnpm run check
pnpm run format
```

### Development Workflow

- **`pnpm run dev`**: Starts both Vite dev server (with hot reload) and CLI server simultaneously
- **`pnpm run start <target>`**: Builds everything and starts production server (for testing final build)
- **Development mode**: Uses Vite's dev server for hot reload and fast development
- **Production mode**: Serves built static files (used by npx and production builds)

## 🏗️ Architecture

- **CLI**: Commander.js for argument parsing with comprehensive validation
- **Backend**: Express server with simple-git for diff processing
- **GitHub Integration**: GitHub CLI (`gh pr diff --patch`) for PR patch retrieval
- **Frontend**: React 18 + TypeScript + Vite
- **Styling**: Tailwind CSS v4 with GitHub-like dark theme
- **Syntax Highlighting**: Prism.js with dynamic language loading
- **Testing**: Vitest for unit tests with co-located test files
- **Quality**: oxlint, oxfmt, lefthook pre-commit hooks

## 📋 Requirements

- Node.js ≥ 21.0.0
- Git repository with commits to review
- GitHub CLI (`gh`) for `--pr` mode

## 📄 License

MIT
