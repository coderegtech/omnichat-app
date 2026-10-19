# Coding workspace IDE integration

## Audit and compatibility plan

The existing React/Next.js coding workspace already owns revision-checked source edits, in-memory unsaved drafts, project imports and exports, linked-folder publishing, AI task proposals, and isolated Docker command approvals. The redesign preserves those API contracts and separates layout concerns into smaller presentation components.

The existing terminal is a bounded command runner over a saved source snapshot. It is not an interactive host shell. The Changes view displays actual AI proposals and does not imply Git status. Linked-folder edits are saved to the project snapshot; publishing to disk still requires the existing separate review. These distinctions remain visible in the interface.

The previous single-file textarea and mutually exclusive Editor/Review/Terminal area are being replaced with open-file tabs, a syntax-aware editor, and a resizable bottom panel. File search uses the loaded project files, including current unsaved drafts, and is scoped to this project snapshot. It is not a filesystem index.

`lib/coding-ide-store.ts` exposes current editor metadata and workspace callbacks to the app shell. It does not duplicate file contents or authentication state. The shell owns global navigation and shortcuts; the editor retains the save shortcut.

No backend, authentication, routing, provider configuration, or persistence contract changes are required by this layout.
