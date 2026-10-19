# OmniChat IDE workspace

Implemented in the existing OmniRoute-powered application, 19 October 2026. The preceding [architecture audit](IDE-AUDIT.md) maps the existing components and the contracts preserved by this redesign.

## Architecture and design

The application remains a Next.js 15 / React 19 frontend with Zustand client state, TanStack Query server state, Radix dialogs and menus, Lucide icons, and CSS theme tokens. Fastify, Prisma/PostgreSQL, the OmniRoute adapter, authenticated API requests, and the Electron bridge retain their existing contracts. The application still uses its existing `/` route. No backend schema, gateway credential, environment-variable convention, or API payload changed for the IDE redesign.

The shell now has a compact OmniChat / OmniRoute title bar, activity rail, workspace tabs, a command palette, contextual sidebars and a real-state status bar. Projects uses its file explorer as the primary sidebar; Chat uses conversation history. This avoids stacking two sidebars in the coding view. Media, model discovery, uploads, web search, connection details, account settings and conversation controls remain reachable from the rail.

The coding view combines a tabbed editor, the coding partner, and a resizable bottom panel containing the existing command runner and change review. Neutral gray surfaces, teal accents, compact spacing and subtle borders replace the larger navigation cards. Existing light/dark/system preferences remain supported. Narrow screens use a modal navigation drawer and Code / Coding partner views.

## Functional interactions

- Open multiple source files, switch tabs, close tabs, and reopen retained drafts. Open file editors retain selection, scroll and undo history while switching file tabs. Closing an editor keeps its draft but discards its editor instance and undo history.
- Edit with CodeMirror line numbers, syntax highlighting, selection, undo/redo, indentation, folding and editor search. Language detection covers JavaScript/TypeScript/JSX, JSON, CSS, HTML, Markdown and Python; other source files remain editable as plain text. The editor loads on demand.
- Search the actual current project's file contents, including unsaved drafts, and jump to matching lines. Results are capped at 200 matching lines. Quick open filters actual project paths.
- Resize the file explorer and conversation sidebar on desktop. Resize, collapse and reopen the bottom panel using pointer or keyboard separators. The bottom panel stays bounded so the editor remains accessible.
- Run the same authenticated coding tasks, review proposals, apply revision-checked file edits, approve isolated commands, and publish separately to authorized local folders.
- Switch workspace views without discarding drafts. Chat preserves unsent text, attachments, selected branches and pending edits per conversation. Switching away from Chat leaves its stream mounted; switching conversations still cancels the previous generation. Sign-out clears private drafts.
- Use existing conversation search, folders, pinning, rename/settings, deletion, import/export, regeneration and provider/model selection. Fenced Markdown code blocks now show language labels alongside copy controls.
- The status bar reports actual gateway discovery state, current project/file, selected model and unsaved state. It does not invent Git branches, diagnostic counts or execution results.

Source and draft content stays in account-scoped memory or the existing backend. It is not written to local storage to preserve layout. Unsaved drafts and layout dimensions do not survive a page reload; the app warns before leaving when project drafts exist. Saved file changes are stored in the project snapshot. Only the separate reviewed publication action writes to a linked folder.

## Keyboard controls

| Shortcut | Action |
| --- | --- |
| Ctrl/Cmd + Shift + P | Command palette |
| Ctrl/Cmd + P | Quick open current-project files |
| Ctrl/Cmd + B | Toggle the current explorer or conversation sidebar |
| Ctrl/Cmd + J | Toggle project bottom panel |
| Ctrl/Cmd + S | Save the active project file to its snapshot |
| Ctrl/Cmd + K | Existing new-conversation action |
| Ctrl/Cmd + W | Close an internal tab in Electron; browser tab closing remains browser-owned |
| Escape | Close modal dialogs and navigation |

File and workspace tab lists support arrow-key navigation. Resizing separators support arrow keys. The command palette supports filtering, up/down selection, Enter and Escape, and lists only available actions. Global workspace shortcuts do not run through an open dialog.

## Changed files

New frontend files:

- `components/ide-shell.tsx`, `ide-shell.css`: activity rail, workspace tabs, command palette, resize control and shell styling.
- `components/coding-editor.tsx`: CodeMirror wrapper and theme integration.
- `components/coding-ide-controls.tsx`, `coding-ide.css`: source tabs, search, resizers, bottom-panel layout.
- `components/coding-panels.tsx`: extracted real command and proposal-review panels.
- `lib/coding-ide-store.ts`: shell-facing current-project state and actions.
- `lib/coding-language.ts`: language labels shared without loading the editor bundle.
- `lib/chat-drafts.ts`: account-scoped, per-conversation composer state.

Modified frontend files:

- `components/omnichat.tsx`: integrates the new frame while reusing authentication, history and model requests.
- `components/coding-workspace.tsx`: integrates tabs, search, retained editors, bottom panels and scoped drafts.
- `components/chat.tsx`: retained chat state and language-labelled code blocks.
- `components/settings.tsx`: adds IDE keyboard shortcuts to preferences.
- `app/globals.css`, `app/layout.tsx`: theme foundation and application metadata.
- `next.config.mjs`: hides the development-only Next.js badge, which otherwise overlapped the rail's Settings button.
- `e2e/coding.spec.ts`, `e2e/workspace.spec.ts`, `tests/markdown.test.tsx`: preserved journeys and IDE regressions.
- `apps/web/package.json` and the root `pnpm-lock.yaml`: editor dependencies.

Documentation: this guide, `IDE-AUDIT.md`, `IDE-CODING-NOTES.md`, README, `CODING-WORKSPACE.md` and `VERIFICATION.md`. No existing feature source files were removed.

## Dependencies

The editor adds `@uiw/react-codemirror`, `@codemirror/view`, and six language packages: `@codemirror/lang-javascript`, `lang-json`, `lang-css`, `lang-html`, `lang-markdown`, and `lang-python`. The modular CodeMirror integration supplies editing behavior that the old textarea lacked. It is dynamically imported when a source editor is displayed. The React wrapper uses CodeMirror 6 and supports theme configuration. [Official React CodeMirror repository](https://github.com/uiwjs/react-codemirror)

No new state manager, icon library, terminal backend, routing system or UI framework was introduced.

## Verification and boundaries

See the dated [verification record](VERIFICATION.md) for commands and results. Browser fixtures are test-only; they are not installed as application data. The IDE screenshot uses a clearly named Fixture project.

Git status/branches, a debugger, language-server diagnostics, extension execution and a PTY terminal are not implemented because corresponding backends do not exist. They have no decorative activity buttons or fabricated status indicators. The terminal remains the approved, network-disabled Docker command runner. Local folder access still requires account/root configuration, and package-dependent tests need a suitable preloaded image. See [coding setup](CODING-WORKSPACE.md).

This web redesign also appears in Electron through the shared web application; Expo native screens were not redesigned. No signed native installer, new Docker production image or live provider generation was produced as part of this UI change. A full accessibility audit and physical-device verification remain release work. Further development can add Git support, a language server and configurable persistent layout preferences without changing the current authentication and review boundaries.
