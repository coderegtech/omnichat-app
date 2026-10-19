# Coding projects in OmniChat

Projects is the default web workspace. It provides a source tree, file editor, model-driven coding tasks, change review, and an approved Docker command runner. The Electron shell uses the same web workspace. The Expo native app currently supports chat; use the responsive web app for coding on a phone.

The [IDE workspace guide](IDE-WORKSPACE.md) covers CodeMirror editing, open-file tabs, quick open, current-project search, the Changes/Terminal bottom panel, resizing, and keyboard shortcuts.

## Choose how to work

**Imported copy:** Create a project and import a source folder or an exported OmniChat project JSON bundle. Files are stored in PostgreSQL. Edit files, save, submit a coding task, and review its proposed replacements or deletions before selecting **Apply all**. Export the project as JSON to retain or transfer the resulting source. Importing never modifies the original folder.

**Linked local folder:** Select **Link local folder** and enter a folder inside an account-authorized root on the computer running the API. Linking creates a source snapshot. Editor saves and applied AI proposals update that snapshot. **Publish to folder** shows the exact disk changes; **Publish reviewed changes** writes them to the linked folder after checking the reviewed version and original file hashes. This supports editing existing local projects without automatically applying model changes to disk.

If an external editor changes a tracked file, publication stops with a conflict. Export any workspace changes you want to preserve before using **Refresh from folder**: refresh replaces the workspace snapshot with disk contents and invalidates pending proposals. Publishing uses individual file replacement and best-effort rollback, not an atomic transaction across the filesystem and database. If publication reports an uncertain or partial result, inspect the folder and export your workspace before refreshing.

## Authorize local folders

The API operator assigns roots to exact account email addresses in the root `.env`. For example:

```dotenv
CODING_LOCAL_PROJECTS='[{"email":"you@example.com","path":"C:/Projects","label":"My projects"}]'
```

Use the email you registered in OmniChat and an existing directory you intend that account to access. Restart `pnpm dev` after changing this setting. The default is `[]`, so no account receives local filesystem access automatically. Paths refer to the API computer, not a remote browser or phone. Authorization is checked again when reading, refreshing, or publishing linked folders. Overlapping project links are rejected.

The standard Compose deployment does not mount your source folders or the Docker socket. For local folder access and sandbox execution, run the API on the host with the README development setup. A containerized API needs explicitly configured source mounts and account roots inside the container; these are not granted by default.

## Coding tasks and review

Choose a chat-capable model, describe the task, and select **Start coding task**. The agent can list, read, and search the bounded source snapshot, propose full file replacements or deletions, and suggest Node/npm/pnpm commands. It must inspect existing files before proposing changes. Runs persist their status, summary, and actions, and can be cancelled.

The gateway integration uses a validated JSON action protocol over chat completions. It does not require provider-native tool calling. Models must follow structured instructions; malformed responses produce a visible error with no applied file changes. A run is limited to eight model turns, forty actions, six command proposals, and a five-minute timeout. Context is bounded using available model metadata. Source files are sent through your configured OmniRoute gateway when you start a coding task.

**Apply all** validates file identities and revisions before updating the workspace. Concurrent edits cause a conflict instead of being overwritten. Applying a proposal does not execute commands or publish to a linked folder. Those are separate user actions.

## Run tests and commands

Enable the optional executor in the root `.env` and pull its image explicitly:

```dotenv
CODING_EXECUTOR=docker
CODING_EXECUTOR_IMAGE=node:22-bookworm-slim
```

```sh
docker pull node:22-bookworm-slim
pnpm dev
```

Docker Desktop must use Linux containers, and the API process must be allowed to call Docker. Open **Terminal**, choose a program and arguments, then select **Review & run** and **Run in sandbox**. Each command receives the saved project snapshot in a disposable container. Unsaved editor drafts are not included.

The runner uses a non-root user, no network, no host mounts or application credentials, a read-only root filesystem, temporary writable directories, dropped capabilities, and CPU/memory/process limits. Each command has a 60-second timeout and bounded output. There can be two jobs globally and one per project. Cancellation retains partial output and removes the job container. Files generated or modified by a command are discarded when the sandbox ends.

The default image includes Node and npm. Dependencies are not automatically installed; network access is disabled, and `node_modules` is excluded from project imports. Builds needing packages or pnpm require an operator-prepared image with the necessary tools and dependencies available. The terminal is not an unrestricted host shell. To iterate after a test failure, start another coding task: it receives the latest three recorded command outputs, capped at 4,000 characters each. It does not automatically rerun tests.

## Local agent (live folder)

**Local agent** in the activity bar works directly on a folder on the API computer, like a terminal coding agent. It does not import or snapshot the project. Bind a folder inside one of your `CODING_LOCAL_PROJECTS` roots. The binding is kept in API memory for the session and is forgotten when the API restarts.

- On bind, the agent pins `CLAUDE.md` (or `AGENTS.md`) as standing instructions, capped at 8,000 characters. It also sees the top-level file names. Nothing else is read until the model calls a tool.
- Read tools: `list_dir`, `read_file` (line ranges), `search_text` (with glob), and read-only `git_status` and `git_diff`. Results are capped. `node_modules`, `.git`, `dist`, `build` and similar directories are skipped. `.env*`, keys and credential files are hidden and denied unless you add an explicit allow-read rule, or confirm when adding one with **Add to context**.
- Paths must be relative. `..`, absolute paths and links whose real location leaves the folder are rejected.
- `edit_file` replaces exactly one occurrence of the expected text and fails if the text is missing or not unique. `write_file` creates or overwrites a file. Both show a diff card and wait for **Accept**, unless a session rule allows edits for that path, for example `src/`. Accept writes only if the file is unchanged since the diff was made. `delete_file` and commands always ask per call.
- Commands are disabled unless the operator sets `CODING_WORKSPACE_COMMANDS=true`. Approved commands are limited to npm, pnpm, yarn, npx and node. Arguments may not contain shell syntax. Commands run on the host in the bound folder, with sensitive environment variables removed, and with a two-minute timeout.
- When a tool fails, the error goes back to the model and the turn stops. Use **Continue** after deciding on pending changes.

The Docker Compose API cannot see host folders. Run the API on the host (`pnpm dev`) to use Local agent, or mount the folder into the API container and configure a matching root.

## Current boundaries

- Source snapshots support up to 200 text files, 100 KiB per file and 2 MiB total. Large repositories need a smaller selected source folder.
- Secret paths, private-key material, traversal, repository internals, dependencies and common build outputs are blocked or skipped. Local scanning rejects symlinks, junctions and hard-linked files. It does not implement every `.gitignore` rule or detect every possible secret embedded in ordinary source files; review what you import.
- There is no Git commit, branch, worktree or pull-request workflow yet. Keep normal version-control backups for local projects.
- Coding runs and command cancellation currently assume a single API process. Local folder linking is intended for a trusted local deployment, not a hostile multi-tenant host.
- Automated model tests use fixtures. Live provider coding quality and credentials must be validated by an intentional user task.
