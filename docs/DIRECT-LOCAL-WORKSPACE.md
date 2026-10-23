# Direct local coding workspace

**Projects** opens the direct local workspace by default. **Add Local Project** links an original
folder on the computer running the API. Electron offers a native folder picker;
the browser offers an authorized-root browser. Neither copies the project into
OmniChat. Existing imported projects remain under **Saved projects**; ordinary chat remains available.

## Updating an existing Docker installation

A running Docker image does not pick up source edits. With the existing database
running, rebuild and replace only the application services, then reload the browser:

```sh
docker compose build web api
docker compose up -d --no-deps --wait api web
```

These commands retain the existing database and attachment volumes. The standard
Docker configuration still has no access to Windows project folders; use the
authorized local companion configuration below for direct host-folder access.

## Configure the trusted local companion

Run the existing API and web app on the local development computer. Configure
`CODING_LOCAL_PROJECTS` with the signed-in account email and approved absolute
roots, as described in `CODING-WORKSPACE.md`. Choosing a folder in Electron does
not bypass this authorization. A remotely hosted API cannot read folders on the
browser computer. Use the local instance for local development.

`CODING_WORKSPACE_COMMANDS=true` enables local commands, terminals and Git
mutations. Leave it unset on hosted deployments. Bind the companion to loopback
and restrict the web origin to the trusted local frontend. Commands execute as
the API account: the project working directory is not an operating-system sandbox.
Package scripts and terminal commands can access other files and the network.
Every agent command, terminal command and Git mutation has an explicit approval.

The native terminal uses [node-pty](https://github.com/microsoft/node-pty) and the
web display uses [xterm.js](https://xtermjs.org/docs/). Shells are PowerShell/CMD on
Windows and Bash/sh/zsh on Unix where installed. Four terminal tabs per chat are
supported, with bounded output, resizing, interruption and process cleanup.
Commands are submitted through a review form; this is not unrestricted raw
keyboard input for full-screen applications. Idle detached terminals expire after
30 minutes. Terminal processes do not survive companion restarts.

## Projects, conversations and review

- Project navigation groups saved chats by canonical directory. Search filters
  project names, paths and chat titles. Pin chats and create another chat with the
  plus button beside a project. Tab navigation works with the keyboard.
- Settings support project rename, chat rename, shared project memory and relinking.
  Missing directories remain listed. Relinking clears old model file context and
  pending changes. Removing a chat or unlinking a project never deletes source files.
- Ask, Plan and Review modes permit read/search tools only. Agent mode can propose
  file changes or commands. Enforcement is on the server, including manual saves.
- Responses stream through the existing OmniRoute adapter. Reported token counts
  appear in the transcript; unavailable provider pricing is not invented. Models
  without native tool calling use the validated JSON action protocol.
- Files are read on demand. Open a source file to inspect/edit it, then review the
  original and modified content before saving. Drafts survive panel/file/chat
  switches in memory. Reloading warns about unsaved file drafts. Save fails if the
  original content changed on disk.
- AI proposals have unified/split diffs, line-change totals and Accept/Reject
  controls with optional review comments. Explicit allow-edit rules still apply only in Agent mode. Commands and
  deletes always require a decision. Commands expose live output and Stop.
- Git shows real branch/status, working and staged diffs, recent commits and
  branches, plus comparison of a selected commit with HEAD. Stage/unstage individual files, commit, create/switch branches and
  approve push/pull. Pull is fast-forward-only; switching branches requires a clean
  tree. No force push, reset, branch deletion or automatic push is implemented.
  Git mutations disable hooks and commit signing; use an external Git client when
  those are required. Local Git identity/remote configuration remains yours.

## Storage and security

Session metadata, model selection, permissions, project memory, bounded model
context, transcript and pending proposals live under
`UPLOAD_DIR/workspace-state/<hashed-user-id>/`. Include this directory in backups.
It contains user-provided text and inspected source context; protect its filesystem
permissions just like the database. It contains no full project snapshot. Files
are written atomically with private creation modes. No database migration is needed.

One API process owns active sessions and terminals. Authorization is checked again
on restore and each filesystem/command operation. State files are application data,
not a synchronization mechanism for multiple API replicas. Chat transcripts retain
the latest 1,500 events and model context is bounded; this is not an unlimited
historical archive.

Traversal, escaping symlinks, hard-linked file reads, Git-internal paths and Windows
special path syntax are blocked. Secret paths are excluded from model discovery
and Git diffs. Common credential formats are redacted from model context and command
summaries; redaction is best effort and does not replace reviewing context before
sending it to a provider. Explicit secret-file attachments keep their confirmation.
Approved local processes retain the local account's filesystem capabilities.

New file creation refuses to replace a concurrently created target. Concurrent
workspace saves to the same path are serialized and recheck their original content.
Existing file saves compare content again immediately before atomic replacement. An unrelated
external process can still race that last check; filesystem operations do not offer
a cross-process compare-and-swap transaction. Use Git commits for recovery.

## Verification

The companion regression tests exercise restart persistence, relinking, ownership,
mode enforcement, stale changes, cancelled commands, real native PTY cleanup and
Git operations in disposable repositories. Browser tests use explicit API fixtures;
they do not make paid provider calls. See `LOCAL-WORKSPACE-PLAN.md` for the initial
gap analysis and `VERIFICATION.md` for the final recorded results.

Release validation still requires macOS/Linux native testing, native folder-dialog
interaction, installed-shell coverage, real provider generation and authenticated
remote push/pull. The existing ordinary chat supplies attachments, message branching,
editing and regeneration; those controls are not yet unified with local-agent chats.
Provider credentials remain in the existing server/gateway configuration.
