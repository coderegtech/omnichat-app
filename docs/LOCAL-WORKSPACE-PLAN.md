# Direct local workspace implementation

The existing Next.js/Fastify/Electron stack, OmniRoute adapter, authentication,
Markdown renderer, CodeMirror editor, permission rules and filesystem sandbox
remain the foundation. The legacy imported-project workflow remains available.

## Gaps found

- Direct-folder sessions exist but are only held in memory, with a five-session
  eviction limit. Restarting loses conversations, model selection and decisions.
- The folder browser selects paths on the API host; Electron has no native picker.
- The agent proposes exact, conflict-checked changes, but has no enforced modes.
- Approved host commands cannot be stopped and their output arrives only at exit.
- Git exposes status/diff only. The direct workspace has no file editor panel.

## Implementation sequence

1. Persist direct-workspace metadata and bounded conversation state in application
   storage, without copying project folders. Restore sessions lazily; retain
   missing-folder entries for relinking. Add separate chats per linked root.
2. Enforce Ask, Plan, Agent and Review modes in the server. Keep approval,
   read-before-edit and conflict checks. Persist model choice and project memory.
3. Add native folder selection through the trusted Electron bridge, while retaining
   API root authorization. Browser access uses the existing authenticated local API;
   a remote API cannot access folders on the browser computer.
4. Extend the direct-workspace UI with project/chat navigation, search, file
   inspection/edit review, Git controls and cancellable command output.
5. Exercise persistence, mode enforcement, path/secret boundaries, stale edits and
   cancellation with automated tests; run type checks, browser tests and builds.

## Boundaries

The five implementation stages above are delivered. The final validation record
and the remaining release/platform checks are in `VERIFICATION.md`; runtime setup
and deliberately bounded behavior are in `DIRECT-LOCAL-WORKSPACE.md`.

Local host commands require the operator's explicit opt-in and per-command user
approval. A working directory is not an OS sandbox: approved scripts can access
the local account's files. This feature is for a trusted local companion deployment.
Do not expose it as a general-purpose hosted command endpoint.

No screenshots were attached to this request. Visual work follows the existing
dark/light design tokens and accessible components.
